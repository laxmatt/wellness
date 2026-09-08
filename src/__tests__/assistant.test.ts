import { describe, expect, it } from "vitest";
import { AssistantRequest, ModelIntent } from "@/domain/assistant";
import { categoryById } from "@/domain/categories";
import { detectMedicalIntent } from "@/providers/ai/AIProvider";
import { ScriptedConversationProvider } from "@/providers/ai/ScriptedProvider";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, hourKey, monthKey, type MeterConfig, type UsageStore } from "@/providers/usage/UsageMeter";
import { viewsFor } from "./fixtures";

const redLight = categoryById("red-light")!;

const config: MeterConfig = {
  monthlyCapUsd: 25,
  sessionTurnLimit: 3,
  clientHourlyLimit: 100,
  inputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
  maxInputTokens: 6000,
  maxOutputTokens: 500,
  estimateSafetyFactor: 1,
};

const meterWith = (over: Partial<MeterConfig> = {}) => {
  const store = new MemoryUsageStore();
  return { store, meter: new UsageMeter(store, { ...config, ...over }) };
};

const billed = (inputTokens: number, outputTokens: number) => ({ kind: "billed" as const, model: "test", inputTokens, outputTokens });

describe("spend control", () => {
  it("reserves the worst case a request could cost, not the average", async () => {
    const { meter } = meterWith();
    // 6000 in + 500 out at the configured rates.
    expect(meter.worstCaseUsd).toBeCloseTo(0.0009 + 0.0003, 6);
    const r = await meter.reserve("s1", "c1");
    expect(r.ok).toBe(true);
  });

  it("adds a safety margin so an under-estimated prompt cannot slip past the cap", () => {
    const { meter } = meterWith({ estimateSafetyFactor: 1.3 });
    expect(meter.worstCaseUsd).toBeCloseTo((0.0009 + 0.0003) * 1.3, 6);
  });

  it("reconciles the reservation against what was actually used", async () => {
    const { meter } = meterWith();
    const r = await meter.reserve("s1", "c1");
    if (!r.ok) throw new Error("expected a reservation");
    let snap = await meter.snapshot("s1");
    expect(snap.reservedUsd).toBeCloseTo(meter.worstCaseUsd, 6);
    expect(snap.spentUsd).toBe(0);

    await meter.settle(r.reservation, billed(1000, 100));
    snap = await meter.snapshot("s1");
    expect(snap.reservedUsd).toBe(0);
    expect(snap.spentUsd).toBeCloseTo(meter.costOf(1000, 100), 6);
  });

  it("concurrent requests cannot both take the last of the budget", async () => {
    // Room for exactly two worst-case requests.
    const probe = new UsageMeter(new MemoryUsageStore(), config);
    const cap = probe.worstCaseUsd * 2;
    const { meter } = meterWith({ monthlyCapUsd: cap, sessionTurnLimit: 100 });

    // Ten requests started together, before any of them settles.
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => meter.reserve(`s${i}`, `c${i}`)));
    const granted = results.filter((r) => r.ok);
    expect(granted.length).toBe(2);

    const snap = await meter.snapshot("s0");
    expect(snap.reservedUsd).toBeLessThanOrEqual(cap);
    for (const r of results) if (!r.ok) expect(r.kind).toBe("monthly_cap");
  });

  it("releases the reservation when the provider rejected the call before inference", async () => {
    const probe = new UsageMeter(new MemoryUsageStore(), config);
    const { meter } = meterWith({ monthlyCapUsd: probe.worstCaseUsd, sessionTurnLimit: 100 });
    const first = await meter.reserve("s1", "c1");
    if (!first.ok) throw new Error("expected a reservation");
    expect((await meter.reserve("s2", "c2")).ok).toBe(false);

    // A 400 or a refused connection is not charged, so the budget gets it back.
    await meter.settle(first.reservation, { kind: "not_billed", reason: "The provider returned 400." });
    const snap = await meter.snapshot("s1");
    expect(snap.spentUsd).toBe(0);
    expect(snap.uncertainUsd).toBe(0);
    expect((await meter.reserve("s3", "c3")).ok).toBe(true);
  });

  it("holds an uncertain charge instead of settling a timeout at zero", async () => {
    const { meter } = meterWith({ sessionTurnLimit: 100 });
    const r = await meter.reserve("s1", "c1");
    if (!r.ok) throw new Error("expected a reservation");

    await meter.settle(r.reservation, { kind: "uncertain", reason: "The request timed out." });
    const snap = await meter.snapshot("s1");
    // Not written off as free: the estimate is retained.
    expect(snap.spentUsd).toBe(0);
    expect(snap.uncertainUsd).toBeCloseTo(meter.worstCaseUsd, 6);
    expect(snap.reservedUsd).toBe(0);

    const held = await meter.listUncertain();
    expect(held).toHaveLength(1);
    expect(held[0].reservationId).toBe(r.reservation.id);
    expect(held[0].heldUsd).toBeCloseTo(meter.worstCaseUsd, 6);
  });

  it("counts held uncertain charges against the cap until they are reconciled", async () => {
    const probe = new UsageMeter(new MemoryUsageStore(), config);
    const { meter } = meterWith({ monthlyCapUsd: probe.worstCaseUsd, sessionTurnLimit: 100 });
    const first = await meter.reserve("s1", "c1");
    if (!first.ok) throw new Error("expected a reservation");
    await meter.settle(first.reservation, { kind: "uncertain", reason: "timeout" });

    // The held amount still occupies the budget, so the next request is refused.
    const blocked = await meter.reserve("s2", "c2");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.kind).toBe("monthly_cap");

    // An operator checks the provider's record: the call was never charged.
    expect(await meter.reconcile(first.reservation.id, 0)).toBe(true);
    const snap = await meter.snapshot("s1");
    expect(snap.uncertainUsd).toBe(0);
    expect(snap.spentUsd).toBe(0);
    expect((await meter.reserve("s3", "c3")).ok).toBe(true);
  });

  it("reconciling replaces the held estimate with the real figure, once", async () => {
    const { meter } = meterWith({ sessionTurnLimit: 100 });
    const r = await meter.reserve("s1", "c1");
    if (!r.ok) throw new Error("expected a reservation");
    await meter.settle(r.reservation, { kind: "uncertain", reason: "unreadable response" });

    expect(await meter.reconcile(r.reservation.id, 0.0004)).toBe(true);
    const snap = await meter.snapshot("s1");
    expect(snap.uncertainUsd).toBe(0);
    expect(snap.spentUsd).toBeCloseTo(0.0004, 6);

    // A second attempt changes nothing, so a repeated operator action is safe.
    expect(await meter.reconcile(r.reservation.id, 0.0004)).toBe(false);
    expect((await meter.snapshot("s1")).spentUsd).toBeCloseTo(0.0004, 6);
    expect(await meter.reconcile("r_unknown", 1)).toBe(false);
  });

  it("settling twice never double-counts", async () => {
    const { meter, store } = meterWith();
    const r = await meter.reserve("s1", "c1");
    if (!r.ok) throw new Error("expected a reservation");
    await meter.settle(r.reservation, billed(1000, 100));
    await meter.settle(r.reservation, billed(1000, 100));
    expect(store.records.length).toBe(1);
    const snap = await meter.snapshot("s1");
    expect(snap.spentUsd).toBeCloseTo(meter.costOf(1000, 100), 6);
  });

  it("stops a session at its turn limit without affecting other sessions", async () => {
    const { meter } = meterWith();
    for (let i = 0; i < 3; i++) {
      const r = await meter.reserve("s1", "c1");
      if (r.ok) await meter.settle(r.reservation, billed(10, 10));
    }
    const blocked = await meter.reserve("s1", "c1");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.kind).toBe("session_limit");
    expect((await meter.reserve("s2", "c1")).ok).toBe(true);
  });

  it("stops a client at its hourly limit even when it invents a new session each time", async () => {
    // The session id comes from the browser and is changeable, so the turn
    // limit alone is a convenience limit. The client key is not chosen by the
    // caller, so this is the limit that actually bounds a single abuser.
    const { meter } = meterWith({ clientHourlyLimit: 4, sessionTurnLimit: 100 });
    for (let i = 0; i < 4; i++) {
      expect((await meter.reserve(`fresh-session-${i}`, "1.2.3.4")).ok).toBe(true);
    }
    const blocked = await meter.reserve("fresh-session-5", "1.2.3.4");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.kind).toBe("client_limit");

    // A different connection is unaffected.
    expect((await meter.reserve("fresh-session-6", "5.6.7.8")).ok).toBe(true);
  });

  it("buckets the client limit by hour, not for all time", () => {
    const a = hourKey(new Date("2026-01-05T10:59:00Z"));
    const b = hourKey(new Date("2026-01-05T11:00:00Z"));
    expect(a).not.toBe(b);
    expect(monthKey(new Date("2026-01-05T11:00:00Z"))).toBe("2026-01");
  });

  it("computes cost from configured per-million rates", () => {
    const { meter } = meterWith();
    expect(meter.costOf(1_000_000, 0)).toBeCloseTo(0.15, 6);
    expect(meter.costOf(0, 1_000_000)).toBeCloseTo(0.6, 6);
    expect(meter.costOf(500_000, 500_000)).toBeCloseTo(0.375, 6);
  });

  it("fails closed when the ledger cannot be reached", async () => {
    const broken: UsageStore = {
      name: "broken",
      isShared: true,
      async init() {
        throw new Error("ledger offline");
      },
      async reserve() {
        throw new Error("ledger offline");
      },
      async settle() {},
      async snapshot() {
        throw new Error("ledger offline");
      },
      async listUncertain() {
        throw new Error("ledger offline");
      },
      async listOpen() {
        throw new Error("ledger offline");
      },
      async closeOpen(): Promise<never> {
        throw new Error("ledger offline");
      },
      async reconcile() {
        throw new Error("ledger offline");
      },
    };
    const m = new UsageMeter(broken, config);
    const d = await m.reserve("s1", "c1");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.kind).toBe("store_error");
  });

  it("marks an in-process ledger as not shared, which gates live use", () => {
    expect(new MemoryUsageStore().isShared).toBe(false);
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
      catalogueSize: 0,
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
      catalogueSize: 0,
      messages: [{ role: "user", text: "I want something for my knees" }],
      activeConstraints: [],
    });
    expect(first.intent.question?.text).toMatch(/budget/i);

    const second = await p.converse({
      categoryName: redLight.name,
      filterVocabulary: "price",
      products: [],
      catalogueSize: 0,
      messages: [{ role: "user", text: "under $700" }],
      activeConstraints: [],
    });
    expect(second.intent.hard).toContainEqual({ key: "price", op: "lte", value: 70000 });
    expect(second.intent.question).toBeUndefined();
  });

  it("costs nothing", async () => {
    const p = new ScriptedConversationProvider(redLight);
    const res = await p.converse({ categoryName: "x", filterVocabulary: "price", products: [],
      catalogueSize: 0, messages: [], activeConstraints: [] });
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
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
