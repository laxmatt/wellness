import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdmin } from "@/domain/admin-auth";
import { resolveCredential } from "@/domain/credential";
import { DEFAULT_METER_CONFIG } from "@/providers/usage/UsageMeter";
import { getMeter } from "@/providers/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator view of assistant spend. Money is business information, so it lives
// here behind a key rather than in the customer-facing panel, which only ever
// says whether the assistant is available.
export async function GET(req: Request) {
  const auth = authorizeAdmin(req.headers, req.url);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const meter = getMeter();
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  try {
    const snapshot = await meter.snapshot(sessionId);
    const uncertain = await meter.listUncertain();
    // Reservations that took budget and never recorded an outcome. In flight
    // requests are excluded by age, so anything listed here is orphaned.
    const open = await meter.listOpen();
    return NextResponse.json({
      ledger: { store: meter.storeName, shared: meter.isShared },
      // Which credential the next request would use. Never the value itself.
      credential: credentialSummary(),
      month: snapshot.month,
      spentUsd: round(snapshot.spentUsd),
      // Held for requests that started but have not reconciled yet.
      reservedUsd: round(snapshot.reservedUsd),
      // Held for calls that may have been charged but could not be measured.
      // Counts against the cap until reconciled against the provider's record.
      uncertainUsd: round(snapshot.uncertainUsd),
      capUsd: snapshot.capUsd,
      remainingUsd: round(Math.max(0, snapshot.capUsd - snapshot.spentUsd - snapshot.reservedUsd - snapshot.uncertainUsd)),
      worstCasePerRequestUsd: round(meter.worstCaseUsd),
      uncertainCharges: uncertain.map((u) => ({
        reservationId: u.reservationId,
        sessionId: u.sessionId,
        reason: u.reason,
        heldUsd: round(u.heldUsd),
        at: u.at,
      })),
      openReservations: open.map((o) => ({
        reservationId: o.reservationId,
        sessionId: o.sessionId,
        heldUsd: round(o.heldUsd),
        at: o.at,
      })),
      config: {
        sessionTurnLimit: DEFAULT_METER_CONFIG.sessionTurnLimit,
        clientHourlyLimit: DEFAULT_METER_CONFIG.clientHourlyLimit,
        maxInputTokens: DEFAULT_METER_CONFIG.maxInputTokens,
        maxOutputTokens: DEFAULT_METER_CONFIG.maxOutputTokens,
        estimateSafetyFactor: DEFAULT_METER_CONFIG.estimateSafetyFactor,
        inputUsdPerMillion: DEFAULT_METER_CONFIG.inputUsdPerMillion,
        outputUsdPerMillion: DEFAULT_METER_CONFIG.outputUsdPerMillion,
        pricesAreVerified: process.env.ASSISTANT_PRICES_VERIFIED === "1",
      },
      ...(sessionId ? { session: { id: sessionId, turns: snapshot.sessionTurns, limit: snapshot.sessionTurnLimit } } : {}),
    });
  } catch {
    return NextResponse.json({ error: "The usage ledger could not be read." }, { status: 503 });
  }
}

const Reconcile = z.object({
  action: z.literal("reconcile"),
  reservationId: z.string().min(1).max(200),
  // What the provider's own usage record shows for this call, in dollars.
  actualUsd: z.number().min(0).max(1000),
});

// Closes an orphaned reservation: budget taken by a request that died before
// recording any outcome. A missing outcome is not a zero cost, so the operator
// must say which it is. Without `actualUsd` the estimate moves into held
// uncertainty and keeps counting against the cap; with it, the figure the
// operator read from the provider's record is recorded as spend, which may be
// zero but only as a statement.
const Release = z.object({
  action: z.literal("release"),
  reservationId: z.string().min(1).max(200),
  actualUsd: z.number().min(0).max(1000).optional(),
});

const AdminAction = z.discriminatedUnion("action", [Reconcile, Release]);

// Closes out a held uncertain charge with the figure from the provider's usage
// page. This is an operator judgement, not something the application can
// determine, which is why the charge is held until someone does it.
export async function POST(req: Request) {
  const auth = authorizeAdmin(req.headers, req.url);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  const parsed = AdminAction.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Unrecognised request.", detail: z.prettifyError(parsed.error) }, { status: 400 });

  try {
    if (parsed.data.action === "release") {
      const resolution = parsed.data.actualUsd === undefined ? ({ kind: "unknown" } as const) : ({ kind: "confirmed", actualUsd: parsed.data.actualUsd } as const);
      const result = await getMeter().closeOpen(parsed.data.reservationId, resolution);
      if (!result.ok) {
        const status = result.reason === "too_recent" ? 409 : 404;
        const error =
          result.reason === "too_recent"
            ? "That reservation is recent enough to still be in flight. Wait for it to settle rather than closing its accounting underneath it."
            : result.reason === "already_settled"
              ? "That reservation already recorded an outcome."
              : "No open reservation with that id.";
        return NextResponse.json({ error }, { status });
      }
      return NextResponse.json({
        released: parsed.data.reservationId,
        movedTo: result.movedTo,
        amountUsd: round(result.amountUsd),
        note:
          result.movedTo === "uncertain"
            ? "Held as an uncertain charge, not written off. Reconcile it against the provider's record."
            : "Recorded as spend at the amount you confirmed.",
      });
    }
    const done = await getMeter().reconcile(parsed.data.reservationId, parsed.data.actualUsd);
    if (!done) return NextResponse.json({ error: "No unreconciled charge with that reservation id." }, { status: 404 });
    return NextResponse.json({ reconciled: parsed.data.reservationId, actualUsd: round(parsed.data.actualUsd) });
  } catch {
    return NextResponse.json({ error: "The usage ledger could not be written." }, { status: 503 });
  }
}

function round(n: number) {
  return Number(n.toFixed(6));
}

// Reports the mode and, in api_key mode, only that a key is present. The key
// itself is never read into a response body.
function credentialSummary(): { mode: string; baseUrl?: string; reason?: string } {
  const c = resolveCredential();
  if (c.mode === "misconfigured") return { mode: c.mode, reason: c.reason };
  if (c.mode === "none") return { mode: c.mode };
  return { mode: c.mode, baseUrl: c.baseUrl };
}
