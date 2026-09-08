// Spend control, as enforced by this application before any request is made.
//
// A counter that is read, checked and then written is not enough: two requests
// arriving together both read the same total, both decide there is room, and
// both spend. So the budget is held as a reservation. A request reserves an
// estimate of its cost, in one atomic step that refuses when the cap would be
// exceeded, makes the call, then reconciles the reservation against what was
// actually used.
//
// What this is NOT: a guaranteed ceiling on the provider's bill. The
// reservation is computed from our own token estimate, and the provider counts
// tokens with a different tokenizer at prices we hold as configuration. It is a
// conservative estimate that fails in the safe direction. The only enforceable
// ceiling is the hard spend limit set at the provider. See docs/ASSISTANT.md.

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
  // Largest request the route will send. `maxOutputTokens` is passed to the
  // provider as `max_tokens` and is a real cap. `maxInputTokens` is checked
  // against our own estimate of the prompt, so it caps the estimate, not the
  // provider's count of the same text.
  maxInputTokens: number;
  maxOutputTokens: number;
  // Multiplier applied to the reservation to absorb the difference between our
  // token estimate and the provider's own count. A margin, not a proof.
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

// Rough token count, from characters. This is not the provider's tokenizer and
// will disagree with it, in both directions: text that tokenizes badly (long
// identifiers, unusual scripts, dense punctuation) uses more tokens per
// character than this assumes. It feeds a reservation and is never used for
// billing. Raise `estimateSafetyFactor` to widen the margin it leaves.
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

  // What one request is expected to cost at the configured limits, widened by
  // the safety factor. Reserved before the call and released after it.
  //
  // Not a guarantee. It rests on three things that are outside this code: our
  // token estimate matching the provider's count closely enough, the configured
  // prices being current, and the provider reporting usage honestly. A request
  // whose prompt tokenizes worse than estimated costs more than this reserved.
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
