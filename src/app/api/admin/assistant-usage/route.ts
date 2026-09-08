import { NextResponse } from "next/server";
import { DEFAULT_METER_CONFIG } from "@/providers/usage/UsageMeter";
import { getMeter } from "@/providers/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator view of assistant spend. Money is business information, so it lives
// here behind a key rather than in the customer-facing panel, which only ever
// says whether the assistant is available.
export async function GET(req: Request) {
  const expected = process.env.ADMIN_ACCESS_KEY;
  if (!expected) {
    return NextResponse.json({ error: "ADMIN_ACCESS_KEY is not configured." }, { status: 503 });
  }
  const supplied = req.headers.get("x-admin-key") ?? new URL(req.url).searchParams.get("key");
  if (supplied !== expected) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const meter = getMeter();
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  try {
    const snapshot = await meter.snapshot(sessionId);
    return NextResponse.json({
      ledger: { store: meter.storeName, shared: meter.isShared },
      month: snapshot.month,
      spentUsd: Number(snapshot.spentUsd.toFixed(6)),
      // Held for requests that started but have not reconciled yet.
      reservedUsd: Number(snapshot.reservedUsd.toFixed(6)),
      capUsd: snapshot.capUsd,
      remainingUsd: Number(Math.max(0, snapshot.capUsd - snapshot.spentUsd - snapshot.reservedUsd).toFixed(6)),
      worstCasePerRequestUsd: Number(meter.worstCaseUsd.toFixed(6)),
      config: {
        sessionTurnLimit: DEFAULT_METER_CONFIG.sessionTurnLimit,
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
