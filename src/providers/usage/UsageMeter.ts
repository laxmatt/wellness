// Spend control is enforced by this application, before any request is made.
//
// A counter that is read, checked and then written is not enough: two requests
// arriving together both read the same total, both decide there is room, and
// both spend. So the budget is held as a reservation. A request reserves the
// most it could possibly cost, in one atomic step that refuses when the cap
// would be exceeded, makes the call, then reconciles the reservation against
// what was actually used.

export type MeterConfig = {
  monthlyCapUsd: number;
  sessionTurnLimit: number;
  // Requests per client per hour. The session limit is a convenience limit
  // (see docs/ASSISTANT.md); this one is keyed on something the caller does
  // not choose, so it is the limit that actually bounds abuse.
  clientHourlyLimit: number;
  // Dollars per million tokens. These change; the operator sets them from the
  // provider's current price list. Defaults are a planning assumption only.
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  // Worst-case request size. The route must enforce these on the request it
  // actually sends, or the reservation stops bounding the charge.
  maxInputTokens: number;
  maxOutputTokens: number;
  // Multiplier applied to the reservation to absorb the difference between
  // our token estimate and the provider's own count.
  estimateSafetyFactor: number;
};

export const DEFAULT_METER_CONFIG: MeterConfig = {
  monthlyCapUsd: Number(process.env.ASSISTANT_MONTHLY_CAP_USD ?? 25),
  sessionTurnLimit: Number(process.env.ASSISTANT_SESSION_TURN_LIMIT ?? 20),
  clientHourlyLimit: Number(process.env.ASSISTANT_CLIENT_HOURLY_LIMIT ?? 30),
  inputUsdPerMillion: Number(process.env.ASSISTANT_INPUT_USD_PER_MTOK ?? 0.15),
  outputUsdPerMillion: Number(process.env.ASSISTANT_OUTPUT_USD_PER_MTOK ?? 0.6),
  maxInputTokens: Number(process.env.ASSISTANT_MAX_INPUT_TOKENS ?? 6000),
  maxOutputTokens: Number(process.env.ASSISTANT_MAX_OUTPUT_TOKENS ?? 500),
  estimateSafetyFactor: Number(process.env.ASSISTANT_ESTIMATE_SAFETY_FACTOR ?? 1.3),
};

export type Reservation = { id: string; month: string; sessionId: string; estimateUsd: number };

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; kind: "monthly_cap" | "session_limit" | "client_limit" | "store_error"; reason: string };

// How a call ended, for accounting. The distinction matters: a request the
// provider never processed costs nothing, while one that may have been
// processed must not be written off as free.
export type CallOutcome =
  | { kind: "billed"; model: string; inputTokens: number; outputTokens: number }
  // Rejected before inference: connection refused, bad request, auth failure,
  // rate limit. The provider does not charge for these.
  | { kind: "not_billed"; reason: string }
  // Sent, and we do not know what happened: a timeout, a dropped connection,
  // a server error, an unreadable response. The provider may have charged.
  | { kind: "uncertain"; reason: string };

export type UncertainCharge = {
  reservationId: string;
  month: string;
  sessionId: string;
  reason: string;
  heldUsd: number;
  at: string;
};

export type BudgetSnapshot = {
  month: string;
  spentUsd: number;
  reservedUsd: number;
  // Held against calls whose cost we could not confirm. Counts against the cap
  // until an operator reconciles it against the provider's own record.
  uncertainUsd: number;
  capUsd: number;
  sessionTurns: number;
  sessionTurnLimit: number;
};

export interface UsageStore {
  readonly name: string;
  // True when the store is shared across every instance of the application.
  readonly isShared: boolean;
  init(): Promise<void>;
  reserve(sessionId: string, clientKey: string, month: string, hourBucket: string, estimateUsd: number, config: MeterConfig): Promise<ReserveResult>;
  settle(reservation: Reservation, outcome: CallOutcome, costUsd: number): Promise<void>;
  snapshot(sessionId: string, month: string, config: MeterConfig): Promise<BudgetSnapshot>;
  listUncertain(month: string): Promise<UncertainCharge[]>;
  // Operator action: replace a held uncertain amount with the real figure from
  // the provider's usage record. Returns false when the id is unknown or was
  // already reconciled.
  reconcile(reservationId: string, actualUsd: number): Promise<boolean>;
}

export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function hourKey(d = new Date()): string {
  return `${monthKey(d)}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
}

// Rough token count. Deliberately generous: it feeds a reservation, and the
// safety factor above absorbs the rest. It is never used for billing.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class UsageMeter {
  constructor(
    private readonly store: UsageStore,
    readonly config: MeterConfig = DEFAULT_METER_CONFIG,
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

  // The most a single request may cost, given the limits the route enforces on
  // the request it sends, plus a margin for estimate error.
  get worstCaseUsd(): number {
    return this.costOf(this.config.maxInputTokens, this.config.maxOutputTokens) * this.config.estimateSafetyFactor;
  }

  async reserve(sessionId: string, clientKey: string): Promise<ReserveResult> {
    try {
      await this.store.init();
      return await this.store.reserve(sessionId, clientKey, monthKey(), hourKey(), this.worstCaseUsd, this.config);
    } catch {
      // Never spend when the ledger cannot be reached.
      return { ok: false, kind: "store_error", reason: "Usage could not be counted, so no request was made." };
    }
  }

  // Never assumes a failure was free. Only outcomes we can show were rejected
  // before inference settle at zero.
  async settle(reservation: Reservation, outcome: CallOutcome): Promise<void> {
    const cost = outcome.kind === "billed" ? this.costOf(outcome.inputTokens, outcome.outputTokens) : outcome.kind === "uncertain" ? reservation.estimateUsd : 0;
    try {
      await this.store.settle(reservation, outcome, cost);
    } catch {
      // The reservation stands, so the budget is over-counted rather than
      // under-counted. That is the safe direction to fail.
    }
  }

  async snapshot(sessionId: string): Promise<BudgetSnapshot> {
    await this.store.init();
    return this.store.snapshot(sessionId, monthKey(), this.config);
  }

  async listUncertain(): Promise<UncertainCharge[]> {
    await this.store.init();
    return this.store.listUncertain(monthKey());
  }

  async reconcile(reservationId: string, actualUsd: number): Promise<boolean> {
    await this.store.init();
    return this.store.reconcile(reservationId, actualUsd);
  }
}
