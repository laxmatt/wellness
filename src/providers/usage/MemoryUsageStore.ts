import type { BudgetSnapshot, MeterConfig, Reservation, ReserveResult, UsageStore } from "./UsageMeter";

// Single process only: correct for tests and for `next dev` on one machine,
// and wrong the moment a second instance exists. `isShared` is false so the
// route refuses to spend against a live model unless the operator has opted
// in for local development.
export class MemoryUsageStore implements UsageStore {
  readonly name = "memory";
  readonly isShared = false;

  private budget = new Map<string, { reserved: number; spent: number }>();
  private sessions = new Map<string, number>();
  private settled = new Set<string>();
  readonly records: { reservationId: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }[] = [];

  async init() {}

  // JavaScript runs this to completion without interleaving, which is what
  // makes it atomic within one process.
  async reserve(sessionId: string, month: string, estimateUsd: number, config: MeterConfig): Promise<ReserveResult> {
    const turns = this.sessions.get(sessionId) ?? 0;
    if (turns >= config.sessionTurnLimit) {
      return { ok: false, kind: "session_limit", reason: `This conversation reached its limit of ${config.sessionTurnLimit} replies.` };
    }
    const b = this.budget.get(month) ?? { reserved: 0, spent: 0 };
    if (b.reserved + b.spent + estimateUsd > config.monthlyCapUsd) {
      return { ok: false, kind: "monthly_cap", reason: "The assistant is at its budget for this month." };
    }
    b.reserved += estimateUsd;
    this.budget.set(month, b);
    this.sessions.set(sessionId, turns + 1);
    const id = `r_${month}_${sessionId}_${this.records.length}_${Math.random().toString(36).slice(2, 8)}`;
    return { ok: true, reservation: { id, month, sessionId, estimateUsd } };
  }

  async settle(reservation: Reservation, actualUsd: number, model: string, inputTokens: number, outputTokens: number) {
    if (this.settled.has(reservation.id)) return;
    this.settled.add(reservation.id);
    const b = this.budget.get(reservation.month) ?? { reserved: 0, spent: 0 };
    b.reserved = Math.max(0, b.reserved - reservation.estimateUsd);
    b.spent += actualUsd;
    this.budget.set(reservation.month, b);
    this.records.push({ reservationId: reservation.id, model, inputTokens, outputTokens, costUsd: actualUsd });
  }

  async snapshot(sessionId: string, month: string, config: MeterConfig): Promise<BudgetSnapshot> {
    const b = this.budget.get(month) ?? { reserved: 0, spent: 0 };
    return {
      month,
      spentUsd: b.spent,
      reservedUsd: b.reserved,
      capUsd: config.monthlyCapUsd,
      sessionTurns: this.sessions.get(sessionId) ?? 0,
      sessionTurnLimit: config.sessionTurnLimit,
    };
  }
}
