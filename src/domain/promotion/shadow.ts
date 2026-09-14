/**
 * A draft and a catalogue record with the same id, and the three things a
 * reviewer may say about them.
 *
 * Five Sweat Kingdom records were built by hand months before this flow
 * existed, through `src/domain/intake/awin-sweat-kingdom.ts`, and they are in
 * `catalog/` now. The ingestion workspace holds drafts with the same ids. That
 * is not a bug and it is not resolvable by a rule: the hand-built record may
 * carry a better name, the draft carries this month's price, and which of those
 * a reviewer wants is a judgement about the two records in front of them.
 *
 * So there is no default. `unresolved` is the starting state, it blocks, and
 * nothing is ever chosen on a reviewer's behalf. The three answers are:
 *
 * - **keep existing** — the catalogue record stands and the draft is not
 *   promoted. What the draft would have brought is listed, because that is the
 *   cost of the choice.
 * - **replace with draft** — the draft stands. Everything the catalogue record
 *   says that the draft does not is listed, for the same reason.
 * - **merge fields** — field by field, and every field where the two disagree
 *   has to be named. A merge with unnamed fields is not a merge, it is a
 *   replace with a default nobody stated, which is the thing this exists to
 *   prevent.
 *
 * One exception, and it runs the other way. A field the mapping profile calls
 * editorial belongs to this site: it is never taken from the catalogue record
 * by a merge, it is not offered as a choice, and the plan says it is locked.
 */

import { z } from "zod";
import type { FieldOwnership, MappingProfile } from "@/domain/ingestion/profile";
import { fieldsFromProduct } from "@/domain/ingestion/record";
import { ATTR_PREFIX } from "@/domain/ingestion/build";
import { Id, type Product } from "@/domain/product";
import type { AttributeMap, AttributeValue } from "@/domain/attributes";

export const ShadowChoice = z.enum(["unresolved", "keep_existing", "replace_with_draft", "merge_fields"]);
export type ShadowChoice = z.infer<typeof ShadowChoice>;

export const SHADOW_CHOICE_WORDS: Record<ShadowChoice, string> = {
  unresolved: "Nobody has decided yet",
  keep_existing: "Keep the catalogue record, do not promote the draft",
  replace_with_draft: "Replace the catalogue record with the draft",
  merge_fields: "Take some fields from each, named one by one",
};

export const FieldSide = z.enum(["existing", "draft"]);
export type FieldSide = z.infer<typeof FieldSide>;

export const ShadowResolution = z.object({
  id: Id,
  choice: ShadowChoice.default("unresolved"),
  /** Only for a merge, and only for fields the two records disagree on. */
  fields: z.record(z.string(), FieldSide).default({}),
  note: z.string().default(""),
});
export type ShadowResolution = z.infer<typeof ShadowResolution>;

export type ShadowField = {
  key: string;
  label: string;
  ownership: FieldOwnership;
  existing?: unknown;
  draft?: unknown;
  same: boolean;
  /** This site owns it. A merge never takes it from the catalogue record. */
  locked: boolean;
};

export type ShadowDiff = {
  id: string;
  existingName: string;
  draftName: string;
  fields: ShadowField[];
  /** Fields a reviewer has to name before a merge is a decision. */
  contested: string[];
};

const LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  brand: "Brand",
  price: "Price",
  availability: "Availability",
  image: "Image",
  link: "Merchant link",
  merchant_sku: "Merchant SKU",
  mpn: "Manufacturer part number",
  family: "Compared as part of",
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const labelFor = (key: string): string => LABELS[key] ?? (key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key);

function ownershipOf(key: string, profile: MappingProfile): FieldOwnership {
  if (key.startsWith(ATTR_PREFIX)) return profile.attributes.find((a) => a.key === key.slice(ATTR_PREFIX.length))?.ownership ?? "review_on_change";
  // The family layer is the profile's own decision, not the feed's and not a
  // catalogue record's. A merge never takes it from the older record.
  if (key === "family") return "editorial";
  return profile.columns.find((c) => c.target === key)?.ownership ?? "review_on_change";
}

/** Field by field, what the catalogue record and the draft each say. */
export function shadowDiff(existing: Product, draft: Product, profile: MappingProfile, merchantId: string): ShadowDiff {
  const left = fieldsFromProduct(existing, merchantId).fields;
  const right = fieldsFromProduct(draft, merchantId).fields;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();

  const fields: ShadowField[] = keys.map((key) => {
    const ownership = ownershipOf(key, profile);
    return {
      key,
      label: labelFor(key),
      ownership,
      existing: left[key],
      draft: right[key],
      same: same(left[key], right[key]),
      locked: ownership === "editorial",
    };
  });

  return {
    id: draft.id,
    existingName: existing.name,
    draftName: draft.name,
    fields,
    contested: fields.filter((f) => !f.same && !f.locked).map((f) => f.key),
  };
}

export type ResolutionProblem = { id: string; message: string };

/** Everything that stops a shadow resolution from being a decision. */
export function resolutionProblems(diff: ShadowDiff, resolution: ShadowResolution | undefined): ResolutionProblem[] {
  if (!resolution || resolution.choice === "unresolved") {
    return [
      {
        id: diff.id,
        message: `"${diff.id}" is in the catalogue already and also in the workspace. Say whether to keep the catalogue record, replace it with the draft, or merge them field by field. Nothing is chosen for you and nothing is overwritten until you choose.`,
      },
    ];
  }
  if (resolution.choice !== "merge_fields") return [];
  const unnamed = diff.contested.filter((key) => resolution.fields[key] === undefined);
  if (unnamed.length === 0) return [];
  return [
    {
      id: diff.id,
      message: `A merge names every field the two records disagree on. ${unnamed.length} ${unnamed.length === 1 ? "is" : "are"} unnamed: ${unnamed.map((k) => labelFor(k)).join(", ")}. A merge with a default nobody stated is a replace wearing a merge's name.`,
    },
  ];
}

/**
 * One field of the catalogue record, laid onto the draft.
 *
 * Whole values, provenance and all. Taking an existing attribute's number and
 * leaving the draft's source note beside it would produce a record citing a
 * file for a figure that file never carried.
 */
function takeExisting(draft: Product, existing: Product, key: string, merchantId: string): Product {
  const offer = draft.offers[0];
  const theirs = existing.offers[0];
  const withOffer = (patch: Partial<typeof offer>): Product => ({ ...draft, offers: offer ? [{ ...offer, ...patch }] : draft.offers });

  if (key.startsWith(ATTR_PREFIX)) {
    const attrKey = key.slice(ATTR_PREFIX.length);
    const value: AttributeValue | undefined = existing.attributes[attrKey];
    const attributes: AttributeMap = { ...draft.attributes };
    if (value) attributes[attrKey] = value;
    else delete attributes[attrKey];
    return { ...draft, attributes };
  }

  switch (key) {
    case "name":
      return { ...draft, name: existing.name };
    case "description":
      return { ...draft, description: existing.description };
    case "brand":
      return { ...draft, brandId: existing.brandId };
    case "price":
      return withOffer(
        theirs?.priceMinor !== undefined
          ? { priceMinor: theirs.priceMinor, currency: theirs.currency, quoteOnly: undefined }
          : { priceMinor: undefined, quoteOnly: true },
      );
    case "availability":
      return { ...withOffer({ availability: theirs?.availability ?? "unknown" }), availability: existing.availability };
    case "image":
      // The whole asset, so its own source note and any licence travel with it.
      return { ...draft, images: existing.images.length > 0 ? existing.images : [] };
    case "link":
      return theirs ? withOffer({ url: theirs.url }) : draft;
    case "merchant_sku": {
      const skus = { ...draft.identifiers.merchantSkus };
      const theirSku = existing.identifiers.merchantSkus[merchantId];
      if (theirSku === undefined) delete skus[merchantId];
      else skus[merchantId] = theirSku;
      return { ...draft, identifiers: { ...draft.identifiers, merchantSkus: skus } };
    }
    case "mpn":
      return { ...draft, identifiers: { ...draft.identifiers, mpn: existing.identifiers.mpn } };
    default:
      return draft;
  }
}

export type Resolved = {
  /** What the catalogue would hold, if this plan were ever executed. Nothing writes it. */
  product: Product;
  /** Which record this is, so a plan reads without a reader holding the rule in their head. */
  from: "existing" | "draft" | "merged";
  /** Fields taken from the catalogue record by a merge. */
  tookExisting: string[];
  /** Work in the draft this choice would discard. */
  discards: { key: string; label: string; value: unknown }[];
};

export function resolveShadow(existing: Product, draft: Product, diff: ShadowDiff, resolution: ShadowResolution, merchantId: string): Resolved {
  const contested = diff.fields.filter((f) => !f.same);
  if (resolution.choice === "keep_existing") {
    return {
      product: existing,
      from: "existing",
      tookExisting: contested.map((f) => f.key),
      discards: contested.map((f) => ({ key: f.key, label: f.label, value: f.draft })),
    };
  }
  if (resolution.choice === "replace_with_draft") {
    return {
      product: draft,
      from: "draft",
      tookExisting: [],
      discards: contested.map((f) => ({ key: f.key, label: f.label, value: f.existing })),
    };
  }

  // A merge starts from the draft, because the draft is where this month's
  // price, this month's link and any editorial work live, and moves named
  // fields back. A locked field is never among them.
  const take = diff.contested.filter((key) => resolution.fields[key] === "existing");
  let product = draft;
  for (const key of take) product = takeExisting(product, existing, key, merchantId);
  return {
    product,
    from: "merged",
    tookExisting: take,
    discards: take.map((key) => {
      const field = diff.fields.find((f) => f.key === key)!;
      return { key, label: field.label, value: field.draft };
    }),
  };
}
