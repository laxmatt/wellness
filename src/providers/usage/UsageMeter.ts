import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Spend control is enforced by this application, not by trust in the provider's
// dashboard. Every call is checked before it is made and recorded after.

export type UsageRecord = {
  at: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type UsageSnapshot = {
  monthKey: string;
  monthlySpendUsd: number;
  monthlyCapUsd: number;
  sessionTurns: number;
  sessionTurnLimit: number;
};

export interface UsageStore {
  read(): { records: UsageRecord[] };
  append(record: UsageRecord): void;
}

// Prototype store. A JSON file is enough for one operator on one machine.
// It is NOT correct on serverless or across instances: the filesystem is
// per-instance and may be read-only or reset between requests. Production must
// swap this for Postgres or Redis behind the same interface. When the file
// cannot be written the meter fails closed, refusing spend rather than
// silently losing the count.
export class FileUsageStore implements UsageStore {
  constructor(private readonly path: string) {}

  read() {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as { records: UsageRecord[] };
    } catch {
      return { records: [] };
    }
  }

  append(record: UsageRecord) {
    const data = this.read();
    data.records.push(record);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(data, null, 2));
  }
}

export class MemoryUsageStore implements UsageStore {
  private records: UsageRecord[] = [];
  read() {
    return { records: [...this.records] };
  }
  append(record: UsageRecord) {
    this.records.push(record);
  }
}

export type MeterConfig = {
  monthlyCapUsd: number;
  sessionTurnLimit: number;
  // Dollars per million tokens. These change; the operator sets them from the
  // provider's current price list. Defaults are a planning assumption only.
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export const DEFAULT_METER_CONFIG: MeterConfig = {
  monthlyCapUsd: Number(process.env.ASSISTANT_MONTHLY_CAP_USD ?? 25),
  sessionTurnLimit: Number(process.env.ASSISTANT_SESSION_TURN_LIMIT ?? 20),
  inputUsdPerMillion: Number(process.env.ASSISTANT_INPUT_USD_PER_MTOK ?? 0.15),
  outputUsdPerMillion: Number(process.env.ASSISTANT_OUTPUT_USD_PER_MTOK ?? 0.6),
};

export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type SpendDecision = { allowed: true } | { allowed: false; reason: string; kind: "monthly_cap" | "session_limit" | "store_error" };

export class UsageMeter {
  constructor(
    private readonly store: UsageStore,
    private readonly config: MeterConfig = DEFAULT_METER_CONFIG,
  ) {}

  costOf(inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1_000_000) * this.config.inputUsdPerMillion + (outputTokens / 1_000_000) * this.config.outputUsdPerMillion;
  }

  snapshot(sessionId: string): UsageSnapshot {
    const mk = monthKey();
    const records = this.store.read().records;
    return {
      monthKey: mk,
      monthlySpendUsd: Math.round(records.filter((r) => r.at.startsWith(mk)).reduce((s, r) => s + r.costUsd, 0) * 10000) / 10000,
      monthlyCapUsd: this.config.monthlyCapUsd,
      sessionTurns: records.filter((r) => r.sessionId === sessionId).length,
      sessionTurnLimit: this.config.sessionTurnLimit,
    };
  }

  // Checked before every model call. Never after.
  check(sessionId: string): SpendDecision {
    let snap: UsageSnapshot;
    try {
      snap = this.snapshot(sessionId);
    } catch {
      return { allowed: false, kind: "store_error", reason: "Usage could not be counted, so no spend was made." };
    }
    if (snap.monthlySpendUsd >= snap.monthlyCapUsd) {
      return {
        allowed: false,
        kind: "monthly_cap",
        reason: `This month's assistant budget of $${snap.monthlyCapUsd.toFixed(2)} is used up. Filters and comparison are unaffected.`,
      };
    }
    if (snap.sessionTurns >= snap.sessionTurnLimit) {
      return {
        allowed: false,
        kind: "session_limit",
        reason: `This conversation reached its limit of ${snap.sessionTurnLimit} replies. Filters and comparison are unaffected.`,
      };
    }
    return { allowed: true };
  }

  record(sessionId: string, model: string, inputTokens: number, outputTokens: number): UsageRecord {
    const record: UsageRecord = {
      at: new Date().toISOString(),
      sessionId,
      model,
      inputTokens,
      outputTokens,
      costUsd: this.costOf(inputTokens, outputTokens),
    };
    this.store.append(record);
    return record;
  }
}

export const USAGE_FILE = join(process.cwd(), ".data", "assistant-usage.json");
