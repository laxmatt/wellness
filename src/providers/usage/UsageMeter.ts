// Spend control is enforced by this application, before any request is made.
//
// A counter that is read, checked and then written is not enough: two requests
// arriving together both read the same total, both decide there is room, and
// both spend. So the budget is held as a reservation. A request reserves the
// most it could possibly cost, in one atomic step that refuses when the cap
// would be exceeded, makes the call, then reconciles the reservation against
// what was actually used. Concurrency can never spend past the cap; the worst
// case is that requests are refused while reservations are outstanding.

export type MeterConfig = {
  monthlyCapUsd: number;
  sessionTurnLimit: number;
  // Dollars per million tokens. These change; the operator sets them from the
  // provider's current price list. Defaults are a planning assumption only.
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  // Worst-case request size, used for the reservation.
  maxInputTokens: number;
  maxOutputTokens: number;
};

export const DEFAULT_METER_CONFIG: MeterConfig = {
  monthlyCapUsd: Number(process.env.ASSISTANT_MONTHLY_CAP_USD ?? 25),
  sessionTurnLimit: Number(process.env.ASSISTANT_SESSION_TURN_LIMIT ?? 20),
  inputUsdPerMillion: Number(process.env.ASSISTANT_INPUT_USD_PER_MTOK ?? 0.15),
  outputUsdPerMillion: Number(process.env.ASSISTANT_OUTPUT_USD_PER_MTOK ?? 0.6),
  maxInputTokens: Number(process.env.ASSISTANT_MAX_INPUT_TOKENS ?? 6000),
  maxOutputTokens: Number(process.env.ASSISTANT_MAX_OUTPUT_TOKENS ?? 500),
};

export type Reservation = { id: string; month: string; sessionId: string; estimateUsd: number };

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; kind: "monthly_cap" | "session_limit" | "store_error"; reason: string };

export type BudgetSnapshot = {
  month: string;
  spentUsd: number;
  reservedUsd: number;
  capUsd: number;
  sessionTurns: number;
  sessionTurnLimit: number;
};

// Every implementation must make reserve() atomic against concurrent callers.
export interface UsageStore {
  readonly name: string;
  // True when the store is shared across every instance of the application.
  readonly isShared: boolean;
  init(): Promise<void>;
  reserve(sessionId: string, month: string, estimateUsd: number, config: MeterConfig): Promise<ReserveResult>;
  // Releases the reservation and records what was really spent. Must be safe
  // to call once per reservation, and must run even when the call failed.
  settle(reservation: Reservation, actualUsd: number, model: string, inputTokens: number, outputTokens: number): Promise<void>;
  snapshot(sessionId: string, month: string, config: MeterConfig): Promise<BudgetSnapshot>;
}

export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class UsageMeter {
  constructor(
    private readonly store: UsageStore,
    private readonly config: MeterConfig = DEFAULT_METER_CONFIG,
  ) {}

  get storeName() {
    return this.store.name;
  }

  get isShared() {
    return this.store.isShared;
  }

  costOf(inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1_000_000) * this.config.inputUsdPerMillion + (outputTokens / 1_000_000) * this.config.outputUsdPerMillion;
  }

  // The most a single request could cost, reserved up front.
  get worstCaseUsd(): number {
    return this.costOf(this.config.maxInputTokens, this.config.maxOutputTokens);
  }

  async reserve(sessionId: string): Promise<ReserveResult> {
    try {
      await this.store.init();
      return await this.store.reserve(sessionId, monthKey(), this.worstCaseUsd, this.config);
    } catch {
      // Never spend when the ledger cannot be reached.
      return { ok: false, kind: "store_error", reason: "Usage could not be counted, so no request was made." };
    }
  }

  async settle(reservation: Reservation, model: string, inputTokens: number, outputTokens: number): Promise<void> {
    try {
      await this.store.settle(reservation, this.costOf(inputTokens, outputTokens), model, inputTokens, outputTokens);
    } catch {
      // The reservation stands. Budget is over-counted until the month rolls
      // over, which is the safe direction to fail.
    }
  }

  async snapshot(sessionId: string): Promise<BudgetSnapshot> {
    await this.store.init();
    return this.store.snapshot(sessionId, monthKey(), this.config);
  }
}
