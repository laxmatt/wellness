import type { BudgetSnapshot, CallOutcome, MeterConfig, OpenReservation, Reservation, ReserveResult, UncertainCharge, UsageStore } from "./UsageMeter";

// Single process only: correct for tests and for `next dev` on one machine,
// and wrong the moment a second instance exists. `isShared` is false so the
// route refuses to spend against a live model unless the operator has opted
// in for local development.
export class MemoryUsageStore implements UsageStore {
  readonly name = "memory";
  readonly isShared = false;

  private budget = new Map<string, { reserved: number; spent: number; uncertain: number }>();
  private sessions = new Map<string, number>();
  private clients = new Map<string, number>();
  private settled = new Set<string>();
  private uncertain = new Map<string, UncertainCharge>();
  private open = new Map<string, OpenReservation>();
  readonly records: { reservationId: string; outcome: CallOutcome; costUsd: number }[] = [];

  async init() {}

  private bucket(month: string) {
    const b = this.budget.get(month) ?? { reserved: 0, spent: 0, uncertain: 0 };
    this.budget.set(month, b);
    return b;
  }

  // JavaScript runs this to completion without interleaving, which is what
  // makes it atomic within one process.
  async reserve(sessionId: string, clientKey: string, month: string, hourBucket: string, estimateUsd: number, config: MeterConfig): Promise<ReserveResult> {
    const clientSlot = `${clientKey}|${hourBucket}`;
    const clientCount = this.clients.get(clientSlot) ?? 0;
    if (clientCount >= config.clientHourlyLimit) {
      return { ok: false, kind: "client_limit", reason: "Too many assistant requests from this connection in the last hour." };
    }
    const turns = this.sessions.get(sessionId) ?? 0;
    if (turns >= config.sessionTurnLimit) {
      return { ok: false, kind: "session_limit", reason: `This conversation reached its limit of ${config.sessionTurnLimit} replies.` };
    }
    const b = this.bucket(month);
    if (b.reserved + b.spent + b.uncertain + estimateUsd > config.monthlyCapUsd) {
      return { ok: false, kind: "monthly_cap", reason: "The assistant is at its budget for this month." };
    }
    b.reserved += estimateUsd;
    this.sessions.set(sessionId, turns + 1);
    this.clients.set(clientSlot, clientCount + 1);
    const id = `r_${month}_${sessionId}_${this.records.length}_${Math.random().toString(36).slice(2, 8)}`;
    // Recorded before the call, as the shared store does, so a reservation that
    // never settles is visible rather than lost with the process.
    this.open.set(id, { reservationId: id, month, sessionId, heldUsd: estimateUsd, at: new Date().toISOString() });
    return { ok: true, reservation: { id, month, sessionId, estimateUsd } };
  }

  async settle(reservation: Reservation, outcome: CallOutcome, costUsd: number) {
    if (this.settled.has(reservation.id)) return;
    this.settled.add(reservation.id);
    this.open.delete(reservation.id);
    const b = this.bucket(reservation.month);
    b.reserved = Math.max(0, b.reserved - reservation.estimateUsd);
    if (outcome.kind === "uncertain") {
      // Held, not written off. It keeps counting against the cap until an
      // operator checks the provider's record.
      b.uncertain += costUsd;
      this.uncertain.set(reservation.id, {
        reservationId: reservation.id,
        month: reservation.month,
        sessionId: reservation.sessionId,
        reason: outcome.reason,
        heldUsd: costUsd,
        at: new Date().toISOString(),
      });
    } else {
      b.spent += costUsd;
    }
    this.records.push({ reservationId: reservation.id, outcome, costUsd });
  }

  async snapshot(sessionId: string, month: string, config: MeterConfig): Promise<BudgetSnapshot> {
    const b = this.bucket(month);
    return {
      month,
      spentUsd: b.spent,
      reservedUsd: b.reserved,
      uncertainUsd: b.uncertain,
      capUsd: config.monthlyCapUsd,
      sessionTurns: this.sessions.get(sessionId) ?? 0,
      sessionTurnLimit: config.sessionTurnLimit,
    };
  }

  async listUncertain(month: string): Promise<UncertainCharge[]> {
    return [...this.uncertain.values()].filter((u) => u.month === month);
  }

  async listOpen(month: string, olderThanMs = 0): Promise<OpenReservation[]> {
    const cutoff = Date.now() - olderThanMs;
    return [...this.open.values()].filter((o) => o.month === month && Date.parse(o.at) <= cutoff);
  }

  async releaseOpen(reservationId: string): Promise<boolean> {
    const o = this.open.get(reservationId);
    if (!o) return false;
    this.open.delete(reservationId);
    const b = this.bucket(o.month);
    b.reserved = Math.max(0, b.reserved - o.heldUsd);
    return true;
  }

  async reconcile(reservationId: string, actualUsd: number): Promise<boolean> {
    const held = this.uncertain.get(reservationId);
    if (!held) return false;
    this.uncertain.delete(reservationId);
    const b = this.bucket(held.month);
    b.uncertain = Math.max(0, b.uncertain - held.heldUsd);
    b.spent += actualUsd;
    return true;
  }
}
