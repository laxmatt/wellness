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
import { engineSummary } from "@/domain/match-claims";
import { FIXED_LIMITATION, clarifyingQuestion, composeReply } from "@/domain/reply-composer";
import { toEngineConstraints } from "@/domain/model-constraints";
import { isMoneyKey, moneyContractText } from "@/domain/money-contract";
import { formatMoney } from "@/domain/money";
import { PreferenceSet, type HardConstraint, type SoftPreference } from "@/domain/personalization";
import { describeConstraint } from "@/domain/personalization/describe";
import { applyPreferences } from "@/domain/personalization/match";
import type { ProductView } from "@/domain/view";
import { detectMedicalIntent } from "@/providers/ai/AIProvider";
import { buildRejection, captureRejectedIntent } from "@/providers/ai/diagnostics";
import { OpenAIConversationProvider, ProviderCallError, type ConversationProvider, type ConverseInput, type GroundedProduct } from "@/providers/ai/OpenAIProvider";
import { ScriptedConversationProvider } from "@/providers/ai/ScriptedProvider";
import { getMeter } from "@/providers/usage";
import type { CallOutcome } from "@/providers/usage/UsageMeter";
import { getCatalog } from "@/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDICAL_REDIRECT =
  "I can compare these products by size, coverage, price, setup and the other specifications on this page, but I cannot determine which will treat a medical condition. That is a question for a clinician.";

const UNREADABLE_TEXT = "I could not read that reliably. Could you say it another way?";

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
  // A placeholder price is demo data. It used to be sent with a warning label
  // and the model quoted it to a shopper as "$139" anyway. Labels are advice;
  // withholding is not. It is listed as not stated, like any other value the
  // catalogue does not really have.
  const priceIsPlaceholder = view.price.isDemo;
  if (priceIsPlaceholder) notStated.push("price");
  return {
    id: view.id,
    name: view.name,
    brand: view.brand.name,
    price: priceIsPlaceholder ? null : formatMoney(view.price.money),
    priceIsPlaceholder,
    facts,
    notStated,
  };
}

// What the model is told it may filter on.
//
// An enum key has always carried its allowed values. A list key did not, so
// "electrolytes" had no visible home: the model was shown `function (list; use
// op "includes")` and no indication that "electrolytes" was one of the values
// it could take. The site's own filter chips derive those values from the
// products, in src/domain/filters.ts, and this now does the same, from the same
// views the shortlist is drawn from.
//
// The price line used to read "integer cents, use op lte", which contradicted
// the MONEY block twice over: money crosses this boundary in dollars, not
// cents, and "lte" is not the operator for every budget. The MONEY block owns
// that contract, so this says nothing about it.
function vocabulary(cat: CategoryDefinition, views: ProductView[]): string {
  const listValues = (key: string): string[] => {
    const values = new Set<string>();
    for (const v of views) {
      const raw = v.attributes[key];
      if (Array.isArray(raw)) for (const x of raw as string[]) values.add(String(x));
    }
    return [...values].sort();
  };

  return cat.filters
    .map((f) => {
      const def = attributeDef(cat, f.key);
      if (def?.type === "enum") return `${f.key} (one of ${def.enumOptions?.map((o) => o.value).join("|")})`;
      if (def?.type === "boolean") return `${f.key} (true|false)`;
      if (def?.type === "list") {
        const values = listValues(f.key);
        const shown = values.length > 0 ? `; values include ${values.join("|")}` : "";
        return `${f.key} (list; use op "includes"${shown})`;
      }
      if (isMoneyKey(cat, f.key)) return `${f.key} (money; see the MONEY block)`;
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
    return NextResponse.json(reply({ text: MEDICAL_REDIRECT, mode: "live", cat, outcome: agreed, totalProducts: views.length, proposals: [], medicalRedirect: true }));
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
        totalProducts: views.length,
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
        totalProducts: views.length,
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
    filterVocabulary: vocabulary(cat, views),
    products: shortlist.map((v) => ground(v, cat)),
    // The model is told how much it cannot see, so it cannot report a
    // shortlist's emptiness as the category's.
    catalogueSize: views.length,
    moneyContract: moneyContractText(cat),
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
        totalProducts: views.length,
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
          totalProducts: views.length,
          proposals: [],
          medicalRedirect: false,
          notice: `The assistant is not configured for rate limiting, so it has not been enabled. ${client.reason}`,
        }),
      );
    }
    reservation = await meter.reserve(sessionId, client.key);
    if (!reservation.ok) {
      return NextResponse.json(
        reply({ text: CAPPED_TEXT, mode: "unavailable", cat, outcome: agreed, totalProducts: views.length, proposals: [], medicalRedirect: false, notice: reservation.reason }),
      );
    }
  }

  let intent;
  let unreadable = false;
  try {
    const res = await provider.converse(bounded);
    intent = res.intent;
    unreadable = res.status === "unreadable";
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
        totalProducts: views.length,
        proposals: [],
        medicalRedirect: false,
        notice: "Assistant temporarily unavailable.",
      }),
    );
  }

  // A reply the provider sent but nothing could be read from is a failure, not
  // an answer. Its empty `hard` and `soft` mean "nothing was understood", and
  // treating them as the shopper's new preferences proposed clearing every
  // filter they had set, on the strength of a reply we could not read. So the
  // agreed preferences stand, nothing is proposed, and the failure is named.
  if (unreadable) {
    return NextResponse.json(
      reply({
        text: UNREADABLE_TEXT,
        mode: provider.isLive ? "live" : "prototype",
        cat,
        outcome: agreed,
        totalProducts: views.length,
        proposals: [],
        medicalRedirect: false,
        failure: "unreadable_reply",
        notice: "The assistant's answer could not be read, so nothing has been changed. Your filters are as you left them.",
      }),
    );
  }

  const validKeys = new Set<string>([...cat.attributeDefinitions.map((a) => a.key), "price"]);
  const knownHard = intent.hard.filter((c) => validKeys.has(c.key));
  const knownSoft = intent.soft.filter((s) => validKeys.has(s.key));

  // Money becomes integer minor units here, in code, once. A constraint that
  // cannot be converted is never guessed at and never dropped: the whole reply
  // fails visibly, because a silently missing budget is what turned "under
  // $700" into a search for products under seven dollars.
  const converted = toEngineConstraints(cat, knownHard, knownSoft);
  if (!converted.ok) {
    captureRejectedIntent(
      buildRejection({
        model: "route",
        finishReason: null,
        error: new z.ZodError(
          converted.problems.map((p) => ({ code: "custom" as const, path: [p.where, p.index, "value"], message: p.reason, input: undefined })),
        ),
        rawContent: JSON.stringify({ hard: knownHard, soft: knownSoft }),
      }),
    );
    return NextResponse.json(
      reply({
        text: UNREADABLE_TEXT,
        mode: provider.isLive ? "live" : "prototype",
        cat,
        outcome: agreed,
        totalProducts: views.length,
        proposals: [],
        medicalRedirect: false,
        failure: "unconvertible_constraint",
        // Named by what actually failed. Every conversion failure used to be
        // reported as a budget, which is wrong the moment a non-money
        // comparison arrives with no value to compare against.
        notice: converted.problems.some((p) => isMoneyKey(cat, p.key))
          ? "The assistant did not state a budget in a form this site can use, so nothing has been changed. Your filters are as you left them."
          : "The assistant did not state a filter in a form this site can use, so nothing has been changed. Your filters are as you left them.",
      }),
    );
  }

  const proposedHard = converted.hard;
  const proposedSoft = converted.soft;
  const changed = JSON.stringify(proposedHard) !== JSON.stringify(hard) || JSON.stringify(proposedSoft) !== JSON.stringify(soft);

  // When the model proposes new constraints, everything shown describes those
  // constraints. Showing the old ranking next to a new proposal is what made
  // the reply, the cards and the proposal disagree.
  // Dropping every constraint is a change like any other. Requiring a non-empty
  // proposal meant "actually, show me everything" produced no proposal at all:
  // the shopper was told the filters were still there with no way to clear them.
  const clearing = changed && proposedHard.length === 0 && proposedSoft.length === 0 && (hard.length > 0 || soft.length > 0);
  const shown = changed && (proposedHard.length > 0 || proposedSoft.length > 0 || clearing) ? evaluate(views, cat, proposedHard, proposedSoft, intent.unmapped) : agreed;

  const proposals: ProposedAction[] = [];
  if (shown !== agreed && !intent.medicalIntent) {
    const constraintText = proposedHard.length > 0 ? proposedHard.map((c) => describeConstraint(cat, c)).join(", ") : "what I am ranking for";
    proposals.push({
      kind: "apply_preferences",
      summary: clearing
        ? `Clear every filter and show all ${shown.matching.length} products`
        : `Narrow to ${constraintText} (${shown.matching.length} of ${views.length} products)`,
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

  // The model's prose is checked against the engine's own count before it is
  // shown. A reply that says nothing matches while the cards show a match is
  // replaced by the engine's sentence: what the shopper reads and what the
  // shopper sees now come from the same computation.
  // The shopper reads this site's own words, composed from the catalogue and
  // the engine's result. The model's prose is not displayed: its job is to turn
  // a sentence into preferences, and everything factual is rendered here.
  //
  // The medical refusal is this site's decision, taken before the model was
  // called, and the model's own `medicalIntent` flag does not reopen it. A live
  // run had the model flag "which one is healthiest?" as medical: the site's
  // detector says otherwise, there is a test for it, and a shopper asking which
  // drink is healthiest is asking a shopping question this site cannot answer,
  // not a clinical one. Treatment and diagnosis requests are unaffected: they
  // are caught by detectMedicalIntent before any of this runs.
  //
  // The flag is not ignored, though. When the model raises it and this site
  // does not, nothing it extracted is applied and the shopper gets the fixed
  // clarification, so a sentence one of them found troubling never turns into a
  // filter.
  const modelFlaggedOnly = intent.medicalIntent;
  const composed = modelFlaggedOnly
    ? FIXED_LIMITATION
    : composeReply({
        cat,
        hard: shown.hard,
        soft: shown.soft,
        unmapped: intent.unmapped,
        matchCount: shown.matching.length,
        totalProducts: views.length,
        changed,
        clearing,
        lastUserText: lastUser,
      });

  return NextResponse.json(
    reply({
      text: composed,
      mode: provider.isLive ? "live" : "prototype",
      cat,
      outcome: shown,
      totalProducts: views.length,
      proposals,
      // Composed from the category's own filters and labels. The model's own
      // question text and options are not displayed: they are free text on the
      // way to the screen, and a question can carry a claim as easily as a
      // sentence can.
      question: intent.question && !modelFlaggedOnly ? clarifyingQuestion(cat, [...shown.hard.map((c) => c.key), ...shown.soft.map((p) => p.key)]) : undefined,
      // False here always: the only path that sets it is the detector's, which
      // returned before the model was called.
      medicalRedirect: false,
      notice: undefined,
    }),
  );
}

function toRef(v: ProductView, outcome: Outcome, cat: CategoryDefinition): AssistantProductRef {
  return {
    productId: v.id,
    slug: v.slug,
    name: v.name,
    brand: v.brand.name,
    price: formatMoney(v.price.money),
    priceIsPlaceholder: v.price.isDemo,
    // Rendered here from the catalogue, with the attribution attached, so what
    // the shopper reads as fact never passes through the model at all.
    facts: renderFacts(v, cat),
    fits: outcome.result.explanations[v.id]?.fits ?? [],
    misses: outcome.result.explanations[v.id]?.misses ?? [],
  };
}

// The site's own rendering of a product's facts: value, and who says so.
function renderFacts(view: ProductView, cat: CategoryDefinition): AssistantProductRef["facts"] {
  const out: AssistantProductRef["facts"] = [];
  for (const def of cat.attributeDefinitions.slice(0, 24)) {
    const spec = view.specs.find((sp) => sp.key === def.key);
    const p = view.provenance[`attributes.${def.key}`];
    if (!spec || spec.raw === undefined || p?.verification === "demo") continue;
    out.push({
      label: def.shortLabel ?? def.label,
      value: spec.formatted,
      attribution:
        p?.verification === "independently_verified"
          ? "verified by this site"
          : p?.verification === "manufacturer_reported"
            ? "reported by the maker"
            : "source not recorded",
    });
    if (out.length >= 4) break;
  }
  return out;
}

function reply(args: {
  text: string;
  mode: AssistantReply["mode"];
  cat: CategoryDefinition;
  outcome: Outcome;
  proposals: ProposedAction[];
  question?: { text: string; options: string[] };
  medicalRedirect: boolean;
  failure?: AssistantReply["failure"];
  totalProducts: number;
  notice?: string;
}): AssistantReply {
  const { outcome } = args;
  return {
    text: args.text,
    // Authored here, from the same evaluation the cards come from, on every
    // reply including the ones the model never reached.
    matchSummary: engineSummary(outcome.matching.length, args.totalProducts),
    failure: args.failure,
    mode: args.mode,
    question: args.question,
    // Cards, matching set and proposal all come from one evaluation.
    products: outcome.matching.slice(0, 3).map((v) => toRef(v, outcome, args.cat)),
    matchingIds: outcome.matching.map((v) => v.id),
    unconfirmedPrice: outcome.unconfirmed.slice(0, 3).map((v) => toRef(v, outcome, args.cat)),
    proposals: args.proposals,
    activeConstraints: outcome.result.constraintLabels,
    medicalRedirect: args.medicalRedirect,
    notice: args.notice,
  };
}
