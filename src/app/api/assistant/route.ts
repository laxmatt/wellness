import { NextResponse } from "next/server";
import { z } from "zod";
import { AssistantRequest, type AssistantProductRef, type AssistantReply, type ProposedAction } from "@/domain/assistant";
import { categoryById } from "@/domain/categories";
import { attributeDef } from "@/domain/category";
import { formatMoney } from "@/domain/money";
import { describeConstraint } from "@/domain/personalization/describe";
import { applyPreferences } from "@/domain/personalization/match";
import { PreferenceSet } from "@/domain/personalization";
import type { ProductView } from "@/domain/view";
import { detectMedicalIntent } from "@/providers/ai/AIProvider";
import { OpenAIConversationProvider, type ConversationProvider, type GroundedProduct } from "@/providers/ai/OpenAIProvider";
import { ScriptedConversationProvider } from "@/providers/ai/ScriptedProvider";
import { FileUsageStore, USAGE_FILE, UsageMeter } from "@/providers/usage/UsageMeter";
import { getCatalog } from "@/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const meter = new UsageMeter(new FileUsageStore(USAGE_FILE));

const MEDICAL_REDIRECT =
  "I can compare these products by size, coverage, price, setup and the other specifications on this page, but I cannot determine which will treat a medical condition. That is a question for a clinician.";

// Only sourced facts are ever sent to the model. Placeholder values are not
// evidence, so they are withheld entirely rather than labelled and included.
function ground(view: ProductView, cat: NonNullable<ReturnType<typeof categoryById>>): GroundedProduct {
  const facts: GroundedProduct["facts"] = [];
  const notStated: string[] = [];
  for (const def of cat.attributeDefinitions) {
    const spec = view.specs.find((s) => s.key === def.key);
    const p = view.provenance[`attributes.${def.key}`];
    if (!spec || spec.raw === undefined || p?.verification === "demo") {
      notStated.push(def.shortLabel ?? def.label);
      continue;
    }
    facts.push({
      label: def.shortLabel ?? def.label,
      value: spec.formatted,
      evidence: p?.verification === "independently_verified" ? "sourced" : "manufacturer_claim",
    });
  }
  return {
    id: view.id,
    name: view.name,
    brand: view.brand.name,
    price: formatMoney(view.price.money),
    priceIsPlaceholder: view.price.isDemo,
    facts,
    notStated,
  };
}

function vocabulary(cat: NonNullable<ReturnType<typeof categoryById>>): string {
  const parts = cat.filters.map((f) => {
    const def = attributeDef(cat, f.key);
    if (def?.type === "enum") return `${f.key} (one of ${def.enumOptions?.map((o) => o.value).join("|")})`;
    if (def?.type === "boolean") return `${f.key} (true|false)`;
    if (def?.type === "list") return `${f.key} (list; use op "includes")`;
    if (f.key === "price") return "price (integer cents, use op lte)";
    return `${f.key} (number${def?.unit ? `, ${def.unit}` : ""})`;
  });
  return parts.join("; ");
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const parsed = AssistantRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unrecognised request.", detail: z.prettifyError(parsed.error) }, { status: 400 });
  }
  const { sessionId, categoryId, messages, hard, soft } = parsed.data;

  const cat = categoryById(categoryId);
  if (!cat) return NextResponse.json({ error: "Unknown category." }, { status: 404 });

  const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";

  // The medical boundary is enforced here, before and independently of any
  // model call, so it holds even when the model is unavailable or wrong.
  if (detectMedicalIntent(lastUser)) {
    const result = applyPreferences(views, cat, PreferenceSet.parse({ hard, soft, unmapped: [], medicalIntent: true }));
    return NextResponse.json(
      buildReply({
        text: MEDICAL_REDIRECT,
        mode: "live",
        views,
        cat,
        hard,
        soft,
        result,
        proposals: [],
        medicalRedirect: true,
        usage: meter.snapshot(sessionId),
      }) satisfies AssistantReply,
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const provider: ConversationProvider = apiKey ? new OpenAIConversationProvider(apiKey) : new ScriptedConversationProvider(cat);

  // Spend is checked before the call, never after, and only for a live model.
  if (provider.isLive) {
    const decision = meter.check(sessionId);
    if (!decision.allowed) {
      const result = applyPreferences(views, cat, PreferenceSet.parse({ hard, soft, unmapped: [], medicalIntent: false }));
      return NextResponse.json(
        buildReply({
          text: "The assistant is paused, but everything else on the page still works: use the filters and the comparison table to narrow things down.",
          mode: "unavailable",
          views,
          cat,
          hard,
          soft,
          result,
          proposals: [],
          medicalRedirect: false,
          notice: decision.reason,
          usage: meter.snapshot(sessionId),
        }) satisfies AssistantReply,
      );
    }
  }

  // The model sees only the shortlist it needs, sourced facts only.
  const priorResult = applyPreferences(views, cat, PreferenceSet.parse({ hard, soft, unmapped: [], medicalIntent: false }));
  const shortlistIds = priorResult.bestMatchId ? [priorResult.bestMatchId, ...priorResult.alternativeIds] : views.slice(0, 5).map((v) => v.id);
  const shortlist = views.filter((v) => shortlistIds.includes(v.id)).slice(0, 6);

  let intent;
  let notice: string | undefined;
  try {
    const res = await provider.converse({
      categoryName: cat.name,
      filterVocabulary: vocabulary(cat),
      products: shortlist.map((v) => ground(v, cat)),
      messages: messages.map((m) => ({ role: m.role, text: m.text })),
      activeConstraints: hard.map((c) => describeConstraint(cat, c)),
    });
    intent = res.intent;
    if (provider.isLive) meter.record(sessionId, res.model, res.inputTokens, res.outputTokens);
  } catch {
    const result = applyPreferences(views, cat, PreferenceSet.parse({ hard, soft, unmapped: [], medicalIntent: false }));
    return NextResponse.json(
      buildReply({
        text: "I could not reach the assistant just now. The filters and comparison on this page are unaffected.",
        mode: "unavailable",
        views,
        cat,
        hard,
        soft,
        result,
        proposals: [],
        medicalRedirect: false,
        notice: "Assistant temporarily unavailable.",
        usage: meter.snapshot(sessionId),
      }) satisfies AssistantReply,
    );
  }

  // Constraints the model proposes are validated against real filter keys and
  // are never applied here. They travel back as proposals for the shopper.
  const validKeys = new Set<string>([...cat.attributeDefinitions.map((a) => a.key), "price"]);
  const proposedHard = intent.hard.filter((c) => validKeys.has(c.key));
  const proposedSoft = intent.soft.filter((s) => validKeys.has(s.key));

  const changed =
    JSON.stringify(proposedHard) !== JSON.stringify(hard) || JSON.stringify(proposedSoft) !== JSON.stringify(soft);

  const proposals: ProposedAction[] = [];
  if (changed && (proposedHard.length > 0 || proposedSoft.length > 0)) {
    // Run the engine against the proposed constraints so the shopper is told
    // how many products would remain before deciding to apply anything.
    const preview = applyPreferences(views, cat, PreferenceSet.parse({ hard: proposedHard, soft: proposedSoft, unmapped: [], medicalIntent: false }));
    const matchingIds = views.filter((v) => (preview.explanations[v.id]?.misses.length ?? 0) === 0).map((v) => v.id);
    const constraintText = proposedHard.length > 0 ? proposedHard.map((c) => describeConstraint(cat, c)).join(", ") : "what I am ranking for";
    proposals.push({
      kind: "apply_preferences",
      summary: `Narrow to ${constraintText} (${matchingIds.length} of ${views.length} products)`,
      hard: proposedHard,
      soft: proposedSoft,
      matchingIds,
      matchCount: matchingIds.length,
    });
  }
  const compareIds = intent.suggestCompare.filter((id) => views.some((v) => v.id === id));
  if (compareIds.length > 1) {
    proposals.push({
      kind: "add_to_compare",
      summary: `Compare ${compareIds.length} of these side by side`,
      productIds: compareIds.slice(0, 4),
    });
  }

  // Results shown alongside the reply come from the engine, using the
  // constraints already agreed, not the ones just proposed.
  const result = applyPreferences(views, cat, PreferenceSet.parse({ hard, soft, unmapped: intent.unmapped, medicalIntent: false }));

  if (result.bestMatchId === null && hard.length > 0 && result.relaxations.length > 0) {
    for (const r of result.relaxations.slice(0, 2)) {
      proposals.push({ kind: "relax_constraint", summary: `Set aside ${r.keptLabel} and show the closest option`, key: r.keptKey });
    }
  }

  if (intent.unmapped.length > 0) {
    notice = `Not something this site compares: ${intent.unmapped.join(", ")}.`;
  }

  return NextResponse.json(
    buildReply({
      text: intent.medicalIntent ? MEDICAL_REDIRECT : intent.reply,
      mode: provider.isLive ? "live" : "prototype",
      views,
      cat,
      hard,
      soft,
      result,
      proposals,
      question: intent.question,
      medicalRedirect: intent.medicalIntent,
      notice,
      usage: meter.snapshot(sessionId),
    }) satisfies AssistantReply,
  );
}

function buildReply(args: {
  text: string;
  mode: AssistantReply["mode"];
  views: ProductView[];
  cat: NonNullable<ReturnType<typeof categoryById>>;
  hard: AssistantRequest["hard"];
  soft: AssistantRequest["soft"];
  result: ReturnType<typeof applyPreferences>;
  proposals: ProposedAction[];
  question?: { text: string; options: string[] };
  medicalRedirect: boolean;
  notice?: string;
  usage: ReturnType<UsageMeter["snapshot"]>;
}): AssistantReply {
  const byId = new Map(args.views.map((v) => [v.id, v]));
  const ids = args.result.bestMatchId ? [args.result.bestMatchId, ...args.result.alternativeIds] : [];
  const matchingIds = args.views
    .filter((v) => (args.result.explanations[v.id]?.misses.length ?? 0) === 0)
    .map((v) => v.id);
  const products: AssistantProductRef[] = ids
    .map((id) => byId.get(id))
    .filter((v): v is ProductView => v !== undefined)
    .map((v) => ({
      productId: v.id,
      slug: v.slug,
      name: v.name,
      brand: v.brand.name,
      price: formatMoney(v.price.money),
      priceIsPlaceholder: v.price.isDemo,
      fits: args.result.explanations[v.id]?.fits ?? [],
      misses: args.result.explanations[v.id]?.misses ?? [],
    }));

  return {
    text: args.text,
    mode: args.mode,
    question: args.question,
    products,
    matchingIds,
    proposals: args.proposals,
    activeConstraints: args.result.constraintLabels,
    medicalRedirect: args.medicalRedirect,
    notice: args.notice,
    usage: {
      sessionTurns: args.usage.sessionTurns,
      sessionTurnLimit: args.usage.sessionTurnLimit,
      monthlySpendUsd: args.usage.monthlySpendUsd,
      monthlyCapUsd: args.usage.monthlyCapUsd,
    },
  };
}
