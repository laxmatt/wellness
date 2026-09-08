import { NextResponse } from "next/server";
import { z } from "zod";
import { AssistantRequest, type AssistantProductRef, type AssistantReply, type ProposedAction } from "@/domain/assistant";
import { categoryById } from "@/domain/categories";
import type { CategoryDefinition, Condition } from "@/domain/category";
import { attributeDef } from "@/domain/category";
import { resolveClientIdentity } from "@/domain/client-identity";
import { resolveCredential } from "@/domain/credential";
import { boundInput } from "@/domain/request-bounds";
import { matchesAll, unconfirmedByPrice } from "@/domain/conditions";
import { formatMoney } from "@/domain/money";
import { PreferenceSet, type HardConstraint, type SoftPreference } from "@/domain/personalization";
import { describeConstraint } from "@/domain/personalization/describe";
import { applyPreferences } from "@/domain/personalization/match";
import type { ProductView } from "@/domain/view";
import { detectMedicalIntent } from "@/providers/ai/AIProvider";
import { OpenAIConversationProvider, ProviderCallError, type ConversationProvider, type ConverseInput, type GroundedProduct } from "@/providers/ai/OpenAIProvider";
import { ScriptedConversationProvider } from "@/providers/ai/ScriptedProvider";
import { getMeter } from "@/providers/usage";
import type { CallOutcome } from "@/providers/usage/UsageMeter";
import { getCatalog } from "@/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDICAL_REDIRECT =
  "I can compare these products by size, coverage, price, setup and the other specifications on this page, but I cannot determine which will treat a medical condition. That is a question for a clinician.";

const CAPPED_TEXT =
  "The assistant is not available right now. Everything else on this page still works: use the filters and the comparison table to narrow things down.";

// Only sourced facts are ever sent to the model. Placeholder values are not
// evidence, so they are withheld entirely rather than labelled and included.
function ground(view: ProductView, cat: CategoryDefinition): GroundedProduct {
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
      // Only what the manufacturer actually reported is labelled as their
      // claim. A value whose provenance is recorded as unknown, or not
      // recorded at all, is neither verified nor claimed by anyone, and
      // calling it a manufacturer claim invents an attribution.
      evidence:
        p?.verification === "independently_verified"
          ? "sourced"
          : p?.verification === "manufacturer_reported"
            ? "manufacturer_claim"
            : "unattributed",
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

function vocabulary(cat: CategoryDefinition): string {
  return cat.filters
    .map((f) => {
      const def = attributeDef(cat, f.key);
      if (def?.type === "enum") return `${f.key} (one of ${def.enumOptions?.map((o) => o.value).join("|")})`;
      if (def?.type === "boolean") return `${f.key} (true|false)`;
      if (def?.type === "list") return `${f.key} (list; use op "includes")`;
      if (f.key === "price") return "price (integer cents, use op lte)";
      return `${f.key} (number${def?.unit ? `, ${def.unit}` : ""})`;
    })
    .join("; ");
}

// One computation. The reply text, the product cards, the proposal and the
// applied filter all read from this, so the panel cannot show three different
// answers to the same question.
type Outcome = {
  hard: HardConstraint[];
  soft: SoftPreference[];
  result: ReturnType<typeof applyPreferences>;
  matching: ProductView[];
  // Products excluded only because their price is not verified. They may
  // qualify; we cannot say they do, so they are listed apart.
  unconfirmed: ProductView[];
};

function evaluate(views: ProductView[], cat: CategoryDefinition, hard: HardConstraint[], soft: SoftPreference[], unmapped: string[] = []): Outcome {
  const result = applyPreferences(views, cat, PreferenceSet.parse({ hard, soft, unmapped, medicalIntent: false }));
  const order = new Map((result.bestMatchId ? [result.bestMatchId, ...result.alternativeIds] : []).map((id, i) => [id, i]));
  // Hard constraints decide what matches. Soft preferences only order the
  // result: treating an unmet preference as a miss would quietly turn "I would
  // prefer full body" into a filter and hide products the shopper asked to see.
  const matching = views
    .filter((v) => matchesAll(v, cat, hard as Condition[]))
    .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  return { hard, soft, result, matching, unconfirmed: unconfirmedByPrice(views, cat, hard as Condition[]) };
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
  const agreed = evaluate(views, cat, hard, soft);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";

  // The medical boundary is enforced here, before and independently of any
  // model call, so it holds even when the model is unavailable or wrong.
  if (detectMedicalIntent(lastUser)) {
    return NextResponse.json(reply({ text: MEDICAL_REDIRECT, mode: "live", cat, outcome: agreed, proposals: [], medicalRedirect: true }));
  }

  const meter = getMeter();
  const credential = resolveCredential();

  // A misconfigured credential is never resolved by falling back to something
  // that might work. It stops here, with the reason on screen for the operator.
  if (credential.mode === "misconfigured") {
    return NextResponse.json(
      reply({
        text: CAPPED_TEXT,
        mode: "unavailable",
        cat,
        outcome: agreed,
        proposals: [],
        medicalRedirect: false,
        notice: `The assistant is not configured correctly, so it has not been enabled. ${credential.reason}`,
      }),
    );
  }

  const provider: ConversationProvider =
    credential.mode === "none"
      ? new ScriptedConversationProvider(cat)
      : new OpenAIConversationProvider(credential.mode === "proxy" ? null : credential.apiKey, undefined, credential.baseUrl);

  // A live model may only run against a ledger shared by every instance,
  // otherwise each instance would enforce its own private cap.
  if (provider.isLive && !meter.isShared && process.env.ASSISTANT_ALLOW_UNSHARED_LEDGER !== "1") {
    return NextResponse.json(
      reply({
        text: CAPPED_TEXT,
        mode: "unavailable",
        cat,
        outcome: agreed,
        proposals: [],
        medicalRedirect: false,
        notice: "The assistant is not configured for shared spend tracking, so it has not been enabled.",
      }),
    );
  }

  // The model sees only a shortlist, sourced facts only.
  const shortlist = (agreed.matching.length > 0 ? agreed.matching : views).slice(0, 6);
  const full: ConverseInput = {
    categoryName: cat.name,
    filterVocabulary: vocabulary(cat),
    products: shortlist.map((v) => ground(v, cat)),
    // The model is told how much it cannot see, so it cannot report a
    // shortlist's emptiness as the category's.
    catalogueSize: views.length,
    messages: messages.map((m) => ({ role: m.role, text: m.text })),
    activeConstraints: hard.map((c) => describeConstraint(cat, c)),
  };

  // Held to the size the reservation pays for, before any budget is taken.
  const bounded = boundInput(provider, full, meter.config.maxInputTokens);
  if (!bounded) {
    return NextResponse.json(
      reply({
        text: "That is more than I can read at once. Try asking about one thing at a time.",
        mode: provider.isLive ? "live" : "prototype",
        cat,
        outcome: agreed,
        proposals: [],
        medicalRedirect: false,
        notice: "The message was too long to send.",
      }),
    );
  }

  // Budget is reserved before the call and reconciled after it, so requests
  // arriving together cannot both spend the same headroom.
  let reservation = null as Awaited<ReturnType<typeof meter.reserve>> | null;
  if (provider.isLive) {
    // A per-connection limit is only real if the connection cannot be forged,
    // so an unidentifiable caller stops the request rather than falling back
    // to a header they control.
    const client = resolveClientIdentity(req.headers);
    if (!client.ok) {
      return NextResponse.json(
        reply({
          text: CAPPED_TEXT,
          mode: "unavailable",
          cat,
          outcome: agreed,
          proposals: [],
          medicalRedirect: false,
          notice: `The assistant is not configured for rate limiting, so it has not been enabled. ${client.reason}`,
        }),
      );
    }
    reservation = await meter.reserve(sessionId, client.key);
    if (!reservation.ok) {
      return NextResponse.json(
        reply({ text: CAPPED_TEXT, mode: "unavailable", cat, outcome: agreed, proposals: [], medicalRedirect: false, notice: reservation.reason }),
      );
    }
  }

  let intent;
  try {
    const res = await provider.converse(bounded);
    intent = res.intent;
    if (reservation?.ok) {
      // A reply with no usable token counts is not a free reply. The estimate
      // stays held rather than being released on an assumption.
      const outcome: CallOutcome = res.usage
        ? { kind: "billed", model: res.model, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens }
        : { kind: "uncertain", reason: "The provider replied without reporting token usage." };
      await meter.settle(reservation.reservation, outcome);
    }
  } catch (e) {
    // A failure is not automatically free. Only what the provider rejected
    // before inference settles at zero; anything that was sent and then went
    // dark is held as uncertain until an operator checks the provider's record.
    const outcome: CallOutcome =
      e instanceof ProviderCallError
        ? { kind: e.billable, reason: e.message }
        : { kind: "uncertain", reason: e instanceof Error ? e.message : "The call failed for an unknown reason." };
    if (reservation?.ok) await meter.settle(reservation.reservation, outcome);
    return NextResponse.json(
      reply({
        text: "I could not reach the assistant just now. The filters and comparison on this page are unaffected.",
        mode: "unavailable",
        cat,
        outcome: agreed,
        proposals: [],
        medicalRedirect: false,
        notice: "Assistant temporarily unavailable.",
      }),
    );
  }

  const validKeys = new Set<string>([...cat.attributeDefinitions.map((a) => a.key), "price"]);
  const proposedHard = intent.hard.filter((c) => validKeys.has(c.key));
  const proposedSoft = intent.soft.filter((s) => validKeys.has(s.key));
  const changed = JSON.stringify(proposedHard) !== JSON.stringify(hard) || JSON.stringify(proposedSoft) !== JSON.stringify(soft);

  // When the model proposes new constraints, everything shown describes those
  // constraints. Showing the old ranking next to a new proposal is what made
  // the reply, the cards and the proposal disagree.
  const shown = changed && (proposedHard.length > 0 || proposedSoft.length > 0) ? evaluate(views, cat, proposedHard, proposedSoft, intent.unmapped) : agreed;

  const proposals: ProposedAction[] = [];
  if (shown !== agreed) {
    const constraintText = proposedHard.length > 0 ? proposedHard.map((c) => describeConstraint(cat, c)).join(", ") : "what I am ranking for";
    proposals.push({
      kind: "apply_preferences",
      summary: `Narrow to ${constraintText} (${shown.matching.length} of ${views.length} products)`,
      hard: proposedHard,
      soft: proposedSoft,
      matchingIds: shown.matching.map((v) => v.id),
      matchCount: shown.matching.length,
    });
  }

  const compareIds = intent.suggestCompare.filter((id) => shown.matching.some((v) => v.id === id));
  if (compareIds.length > 1) {
    proposals.push({ kind: "add_to_compare", summary: `Compare ${compareIds.length} of these side by side`, productIds: compareIds.slice(0, 4) });
  }

  if (shown.matching.length === 0 && shown.hard.length > 0 && shown.result.relaxations.length > 0) {
    for (const r of shown.result.relaxations.slice(0, 2)) {
      proposals.push({ kind: "relax_constraint", summary: `Set aside ${r.keptLabel} and show the closest option`, key: r.keptKey });
    }
  }

  return NextResponse.json(
    reply({
      text: intent.medicalIntent ? MEDICAL_REDIRECT : intent.reply,
      mode: provider.isLive ? "live" : "prototype",
      cat,
      outcome: shown,
      proposals,
      question: intent.question,
      medicalRedirect: intent.medicalIntent,
      notice: intent.unmapped.length > 0 ? `Not something this site compares: ${intent.unmapped.join(", ")}.` : undefined,
    }),
  );
}

function toRef(v: ProductView, outcome: Outcome): AssistantProductRef {
  return {
    productId: v.id,
    slug: v.slug,
    name: v.name,
    brand: v.brand.name,
    price: formatMoney(v.price.money),
    priceIsPlaceholder: v.price.isDemo,
    fits: outcome.result.explanations[v.id]?.fits ?? [],
    misses: outcome.result.explanations[v.id]?.misses ?? [],
  };
}

function reply(args: {
  text: string;
  mode: AssistantReply["mode"];
  cat: CategoryDefinition;
  outcome: Outcome;
  proposals: ProposedAction[];
  question?: { text: string; options: string[] };
  medicalRedirect: boolean;
  notice?: string;
}): AssistantReply {
  const { outcome } = args;
  return {
    text: args.text,
    mode: args.mode,
    question: args.question,
    // Cards, matching set and proposal all come from one evaluation.
    products: outcome.matching.slice(0, 3).map((v) => toRef(v, outcome)),
    matchingIds: outcome.matching.map((v) => v.id),
    unconfirmedPrice: outcome.unconfirmed.slice(0, 3).map((v) => toRef(v, outcome)),
    proposals: args.proposals,
    activeConstraints: outcome.result.constraintLabels,
    medicalRedirect: args.medicalRedirect,
    notice: args.notice,
  };
}
