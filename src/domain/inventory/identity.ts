/**
 * Names for staged records, and the one place a filename is decided.
 *
 * Two rules, both about not letting a supplier file decide anything important.
 *
 * A supplier's code identifies a line in their catalogue. It is kept so a
 * reviewer can trace a record back to the row it came from, and it is never our
 * id: the same drink reaches us under three codes from three suppliers, and one
 * of them reusing a code for a different drink next season would silently
 * overwrite a product here.
 *
 * And nothing read out of a file reaches a path. A filename is built from an id
 * this code derived and then checked against a pattern that admits no
 * separator, no dot and no space, so there is no traversal to defend against
 * rather than a defence to get right.
 */

export const PREVIEW_ID_PREFIX = "preview-";

/** What a preview id may look like, and the only shape a filename is built from. */
export const PREVIEW_ID = /^preview-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_NAME_PART = 60;

/** Lowercase, hyphen-separated, or nothing when the text holds no letters or digits. */
export function slugify(text: string): string | undefined {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? undefined : s;
}

function capped(slug: string): string {
  if (slug.length <= MAX_NAME_PART) return slug;
  const cut = slug.slice(0, MAX_NAME_PART);
  const boundary = cut.lastIndexOf("-");
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, "");
}

/**
 * The id a staged product takes.
 *
 * Derived, so two runs over the same file produce the same record rather than a
 * second copy of it. Prefixed, so it is visible as preview data everywhere it
 * appears and cannot collide with a real catalogue id. Shortened on a hyphen,
 * which can make two long names meet in the middle: that is a refusal where the
 * batch is assembled, never a suffix nobody asked for.
 */
export function previewProductId(brand: string, name: string): string | undefined {
  const b = slugify(brand);
  const n = slugify(name);
  if (!b || !n) return undefined;
  return `${PREVIEW_ID_PREFIX}${capped(`${b}-${n}`)}`;
}

export function previewBrandId(brand: string): string | undefined {
  const b = slugify(brand);
  return b ? `${PREVIEW_ID_PREFIX}brand-${capped(b)}` : undefined;
}

export function previewMerchantId(supplier: string): string | undefined {
  const s = slugify(supplier);
  return s ? `${PREVIEW_ID_PREFIX}supplier-${capped(s)}` : undefined;
}

export function isPreviewId(id: string): boolean {
  return PREVIEW_ID.test(id);
}

/** The filename for a record, or a thrown error. Nothing else builds one. */
export function previewFileName(id: string): string {
  if (!PREVIEW_ID.test(id)) {
    throw new Error(`"${id}" is not a preview record id. A preview id is "preview-" followed by lowercase words separated by single hyphens.`);
  }
  return `${id}.json`;
}
