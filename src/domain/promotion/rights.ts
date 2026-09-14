/**
 * Whether anybody may publish a picture, and what says so.
 *
 * A partner's feed carries an image URL. That is a fact about the feed and not
 * a grant: the merchant put a picture in a file they send to affiliates, and
 * nothing in the file says who took it, who owns it, or what an affiliate may
 * do with it. Publishing it because it arrived is the same reasoning as
 * publishing a photograph because it was visible on a website.
 *
 * So the default is unresolved, and unresolved blocks. The only thing that
 * clears it is somebody recording what they read: which grant, where it is,
 * who checked it, and when. That record names the exact image it covers,
 * because a partner replacing the picture behind a URL replaces the thing the
 * permission was about.
 *
 * Nothing here decides anything. It holds what a person wrote down and reports
 * the three states that follow from it.
 */

import { z } from "zod";
import { Id } from "@/domain/product";
import type { Product } from "@/domain/product";

/**
 * What a permission rests on.
 *
 * Four kinds, and a feed is not one of them. `partner_terms_reviewed` is the
 * one that covers an affiliate feed, and it means a person opened the
 * programme's terms, found the clause about creative, and wrote down where it
 * is. It does not mean the picture arrived in a feed.
 */
export const RightsBasis = z.enum([
  "written_permission",
  "licence_purchased",
  "partner_terms_reviewed",
  "own_photograph",
]);
export type RightsBasis = z.infer<typeof RightsBasis>;

export const RIGHTS_BASIS_WORDS: Record<RightsBasis, string> = {
  written_permission: "The rights holder said yes, in writing",
  licence_purchased: "A licence was bought for this use",
  partner_terms_reviewed: "The partner's own terms were read and permit this use",
  own_photograph: "This site took the photograph",
};

export const ImageRightsRecord = z.object({
  recordId: Id,
  /** The exact image this covers. A permission is about a picture, not about a slot on a record. */
  src: z.string().min(1),
  basis: RightsBasis,
  /** What was read and where it is, in enough detail that somebody else could check it. */
  evidence: z.string().min(20),
  recordedBy: z.string().min(1),
  recordedOn: z.iso.date(),
});
export type ImageRightsRecord = z.infer<typeof ImageRightsRecord>;

export type RightsState =
  /** Somebody recorded a permission covering the picture this record carries. */
  | "cleared"
  /** Nobody has recorded one. The default, and a blocker. */
  | "unresolved"
  /** A permission was recorded for a different picture than the one now here. */
  | "superseded"
  /** The record carries no image at all, so there is nothing to clear. */
  | "no_image";

export type ImageRightsView = {
  recordId: string;
  src?: string;
  /** What the record itself claims about the picture. `affiliate_feed` claims nothing. */
  imageKind?: string;
  /** Set on the record only when somebody wrote a licence onto it. */
  license?: string;
  state: RightsState;
  record?: ImageRightsRecord;
  /** Why this state, in the words the tool shows. */
  why: string;
};

export function imageRightsFor(product: Product, records: ImageRightsRecord[]): ImageRightsView {
  const image = product.images[0];
  const base = { recordId: product.id, src: image?.src, imageKind: image?.kind, license: image?.license };
  if (!image) {
    return { ...base, state: "no_image", why: "This record carries no image, so there is nothing to get permission for. A listing with no picture is a separate decision." };
  }
  const forRecord = records.filter((r) => r.recordId === product.id);
  const exact = forRecord.find((r) => r.src === image.src);
  if (exact) {
    return { ...base, state: "cleared", record: exact, why: `${RIGHTS_BASIS_WORDS[exact.basis]}. Recorded by ${exact.recordedBy} on ${exact.recordedOn}.` };
  }
  if (forRecord.length > 0) {
    const last = forRecord[forRecord.length - 1];
    return {
      ...base,
      state: "superseded",
      record: last,
      why: `A permission was recorded on ${last.recordedOn} for a different picture (${last.src}). The record now carries another one, and a permission about one photograph says nothing about the next.`,
    };
  }
  return {
    ...base,
    state: "unresolved",
    why:
      image.kind === "affiliate_feed"
        ? "This picture came from the partner's feed. A feed carrying an image is not permission to publish it: nothing in the file says who owns the photograph or what an affiliate may do with it. Record what the partner's terms actually say, or replace the picture."
        : "Nobody has recorded a permission for this picture.",
  };
}

/** The records that may not be published yet because of their pictures. */
export const rightsBlocked = (views: ImageRightsView[]): ImageRightsView[] => views.filter((v) => v.state === "unresolved" || v.state === "superseded");
