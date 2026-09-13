import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ModelIntent } from "@/domain/assistant";
import { buildRejection, captureRejectedIntent, diagnosticsTarget, issuesOf } from "@/providers/ai/diagnostics";

// Diagnostics exist to answer one question the live runs could not: which field
// of a rejected reply the validator objected to. They must answer it without
// writing a visitor's words or a credential anywhere.

function rejection(payload: unknown, over: Partial<Parameters<typeof buildRejection>[0]> = {}) {
  const parsed = ModelIntent.safeParse(payload);
  if (parsed.success) throw new Error("test payload was supposed to be rejected");
  return buildRejection({
    model: "gpt-4o-mini",
    finishReason: "stop",
    error: parsed.error,
    rawContent: JSON.stringify(payload),
    now: new Date("2026-09-08T20:00:00Z"),
    ...over,
  });
}

describe("what a rejection records", () => {
  it("names the field and the reason, not just that it failed", () => {
    const r = rejection({ reply: "ok", hard: [{ key: "price", op: "less_than", value: 50000 }] });
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0].path).toBe("hard.0.op");
    expect(r.issues[0].message).toBeTruthy();
    expect(r.issues[0].code).toBeTruthy();
  });

  it("distinguishes a bad direction from a bad operator", () => {
    const r = rejection({ reply: "ok", soft: [{ key: "price", direction: "lower", weight: 0.5 }] });
    expect(r.issues.map((i) => i.path)).toContain("soft.0.direction");
  });

  it("keeps the finish reason, so a truncated reply is distinguishable", () => {
    const r = rejection({ reply: "ok", hard: [{ key: "price", op: "nope" }] }, { finishReason: "length" });
    expect(r.finishReason).toBe("length");
  });

  it("keeps the model's output so the offending value can be read", () => {
    const r = rejection({ reply: "ok", hard: [{ key: "price", op: "under", value: 50000 }] });
    expect(r.rawContent).toContain("under");
    expect(r.rawContentTruncated).toBe(false);
  });

  it("truncates a very long output rather than writing it whole", () => {
    const long = "x".repeat(20000);
    const r = rejection({ reply: "ok", hard: [{ key: "price", op: "under" }] }, { rawContent: long });
    expect(r.rawContent.length).toBeLessThanOrEqual(8000);
    expect(r.rawContentTruncated).toBe(true);
  });

  it("carries no conversation, no shortlist and no environment", () => {
    const r = rejection({ reply: "ok", hard: [{ key: "price", op: "under" }] });
    const keys = Object.keys(r).sort();
    expect(keys).toEqual(["at", "finishReason", "issues", "model", "rawContent", "rawContentTruncated"].sort());
  });
});

describe("when diagnostics are allowed to write", () => {
  it("writes nothing unless a file is named", () => {
    expect(diagnosticsTarget({ NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(diagnosticsTarget({ NODE_ENV: "test", ASSISTANT_DIAGNOSTICS_FILE: "  " } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("stays on under a production build, which is the runtime the private test uses", () => {
    // next start sets NODE_ENV=production. A gate on that disabled diagnostics
    // in the only runtime they are for.
    const env = { NODE_ENV: "production", ASSISTANT_DIAGNOSTICS_FILE: "/tmp/x.jsonl" } as unknown as NodeJS.ProcessEnv;
    expect(diagnosticsTarget(env)).toBe("/tmp/x.jsonl");
  });

  it("refuses on a deployed host even when the file is named", () => {
    for (const marker of [{ VERCEL: "1" }, { ASSISTANT_DEPLOYED: "1" }]) {
      const env = { NODE_ENV: "production", ASSISTANT_DIAGNOSTICS_FILE: "/tmp/x.jsonl", ...marker } as unknown as NodeJS.ProcessEnv;
      expect(diagnosticsTarget(env)).toBeNull();
    }
  });

  it("appends one JSON line per rejection when enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "assistant-diag-"));
    const file = join(dir, "nested", "rejected.jsonl");
    const env = { NODE_ENV: "test", ASSISTANT_DIAGNOSTICS_FILE: file } as unknown as NodeJS.ProcessEnv;
    const r = rejection({ reply: "ok", hard: [{ key: "price", op: "under", value: 1 }] });

    expect(captureRejectedIntent(r, env)).toBe(true);
    expect(captureRejectedIntent(r, env)).toBe(true);

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.issues[0].path).toBe("hard.0.op");
    expect(first.model).toBe("gpt-4o-mini");
  });

  it("never throws, and writes nothing, when the path cannot be written", () => {
    // A regular file standing where a directory would have to be. mkdir fails
    // with ENOTDIR, which is the shape of every real failure here: the request
    // must survive it.
    const dir = mkdtempSync(join(tmpdir(), "assistant-diag-"));
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    const target = join(blocker, "rejected.jsonl");
    const env = { NODE_ENV: "test", ASSISTANT_DIAGNOSTICS_FILE: target } as unknown as NodeJS.ProcessEnv;
    const r = rejection({ reply: "ok", hard: [{ key: "price", op: "under" }] });

    expect(() => captureRejectedIntent(r, env)).not.toThrow();
    expect(captureRejectedIntent(r, env)).toBe(false);
    expect(existsSync(target)).toBe(false);
  });
});

describe("issuesOf", () => {
  it("labels a root-level failure rather than leaving an empty path", () => {
    const err = z.object({ a: z.string() }).safeParse("not an object");
    if (err.success) throw new Error("expected failure");
    expect(issuesOf(err.error)[0].path).toBe("(root)");
  });
});
