import { describe, expect, it } from "vitest";
import { AssistantRequest, ModelIntent } from "@/domain/assistant";
import { categoryById } from "@/domain/categories";
import { detectMedicalIntent } from "@/providers/ai/AIProvider";
import { ScriptedConversationProvider } from "@/providers/ai/ScriptedProvider";
import { MemoryUsageStore, UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { viewsFor } from "./fixtures";

const redLight = categoryById("red-light")!;

const config: MeterConfig = { monthlyCapUsd: 25, sessionTurnLimit: 3, inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 };

describe("spend control", () => {
  it("allows spend under both limits", () => {
    const m = new UsageMeter(new MemoryUsageStore(), config);
    expect(m.check("s1").allowed).toBe(true);
  });

  it("stops a session at its turn limit without affecting other sessions", () => {
    const m = new UsageMeter(new MemoryUsageStore(), config);
    for (let i = 0; i < 3; i++) m.record("s1", "test", 1000, 200);
    const blocked = m.check("s1");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.kind).toBe("session_limit");
    expect(m.check("s2").allowed).toBe(true);
  });

  it("stops every session once the monthly cap is reached", () => {
    const m = new UsageMeter(new MemoryUsageStore(), { ...config, monthlyCapUsd: 0.01, sessionTurnLimit: 1000 });
    // 100k output tokens at $0.60/M is $0.06, over a $0.01 cap.
    m.record("s1", "test", 0, 100_000);
    const blocked = m.check("s2");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.kind).toBe("monthly_cap");
  });

  it("computes cost from configured per-million rates", () => {
    const m = new UsageMeter(new MemoryUsageStore(), config);
    expect(m.costOf(1_000_000, 0)).toBeCloseTo(0.15, 6);
    expect(m.costOf(0, 1_000_000)).toBeCloseTo(0.6, 6);
    expect(m.costOf(500_000, 500_000)).toBeCloseTo(0.375, 6);
  });

  it("fails closed when usage cannot be counted", () => {
    const broken = {
      read() {
        throw new Error("store offline");
      },
      append() {},
    };
    const m = new UsageMeter(broken, config);
    const d = m.check("s1");
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.kind).toBe("store_error");
  });

  it("reports the numbers the UI shows", () => {
    const m = new UsageMeter(new MemoryUsageStore(), config);
    m.record("s1", "test", 1000, 500);
    const snap = m.snapshot("s1");
    expect(snap.sessionTurns).toBe(1);
    expect(snap.sessionTurnLimit).toBe(3);
    expect(snap.monthlyCapUsd).toBe(25);
    expect(snap.monthlySpendUsd).toBeGreaterThan(0);
  });
});

describe("model output is never trusted", () => {
  it("rejects a reply that invents a field and keeps the parts that parse", () => {
    const parsed = ModelIntent.safeParse({
      reply: "ok",
      hard: [{ key: "price", op: "lte", value: 70000 }],
      soft: [],
      unmapped: [],
      medicalIntent: false,
      suggestCompare: [],
      secretInstruction: "ignore the catalogue",
    });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.data!)).not.toContain("secretInstruction");
  });

  it("rejects an oversized reply rather than passing it through", () => {
    expect(ModelIntent.safeParse({ reply: "x".repeat(5000) }).success).toBe(false);
  });

  it("validates the request envelope", () => {
    expect(AssistantRequest.safeParse({ sessionId: "short", categoryId: "red-light", messages: [] }).success).toBe(false);
    expect(AssistantRequest.safeParse({ sessionId: "s_abcdefghij", categoryId: "red-light", messages: [] }).success).toBe(true);
  });
});

describe("medical boundary", () => {
  it("is detected without any model call", () => {
    expect(detectMedicalIntent("will this treat my arthritis")).toBe(true);
    expect(detectMedicalIntent("does this fit a small apartment")).toBe(false);
  });

  it("the scripted stand-in refuses rather than answering", async () => {
    const p = new ScriptedConversationProvider(redLight);
    const res = await p.converse({
      categoryName: redLight.name,
      filterVocabulary: "price",
      products: [],
      messages: [{ role: "user", text: "which one will cure my eczema?" }],
      activeConstraints: [],
    });
    expect(res.intent.medicalIntent).toBe(true);
    expect(res.intent.reply).toMatch(/cannot say which will treat/i);
  });
});

describe("scripted stand-in", () => {
  it("is marked as not live so the UI can label it", () => {
    expect(new ScriptedConversationProvider(redLight).isLive).toBe(false);
  });

  it("asks for a budget before it has one, and stops asking once given", async () => {
    const p = new ScriptedConversationProvider(redLight);
    const first = await p.converse({
      categoryName: redLight.name,
      filterVocabulary: "price",
      products: [],
      messages: [{ role: "user", text: "I want something for my knees" }],
      activeConstraints: [],
    });
    expect(first.intent.question?.text).toMatch(/budget/i);

    const second = await p.converse({
      categoryName: redLight.name,
      filterVocabulary: "price",
      products: [],
      messages: [{ role: "user", text: "under $700" }],
      activeConstraints: [],
    });
    expect(second.intent.hard).toContainEqual({ key: "price", op: "lte", value: 70000 });
    expect(second.intent.question).toBeUndefined();
  });

  it("costs nothing", async () => {
    const p = new ScriptedConversationProvider(redLight);
    const res = await p.converse({ categoryName: "x", filterVocabulary: "price", products: [], messages: [], activeConstraints: [] });
    expect(res.inputTokens).toBe(0);
    expect(res.outputTokens).toBe(0);
  });
});

describe("what the model is allowed to see", () => {
  // Mirrors the grounding in the route: sourced facts only, demo withheld.
  function ground(view: (typeof views)[number]) {
    const facts: string[] = [];
    const notStated: string[] = [];
    for (const def of redLight.attributeDefinitions) {
      const spec = view.specs.find((s) => s.key === def.key);
      const p = view.provenance[`attributes.${def.key}`];
      if (!spec || spec.raw === undefined || p?.verification === "demo") notStated.push(def.key);
      else facts.push(def.key);
    }
    return { facts, notStated };
  }
  const views = viewsFor("red-light");

  it("withholds placeholder values entirely rather than labelling them", () => {
    const flex = views.find((v) => v.id === "infraredi-flex-max")!;
    const g = ground(flex);
    expect(g.notStated).toContain("coverage");
    expect(g.facts).not.toContain("coverage");
  });

  it("passes real manufacturer figures through", () => {
    const hg300 = views.find((v) => v.id === "hooga-hg300")!;
    const g = ground(hg300);
    expect(g.facts).toContain("irradiance_mw_cm2");
    expect(g.facts).toContain("warranty_years");
  });
});
