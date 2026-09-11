import { SITE_NAME, SITE_TAGLINE } from "./site";
import { SITE_URL } from "./site-url";

/**
 * Structured data, and the one safe way to put it on a page.
 *
 * Everything here is a claim made to a search engine, and a search engine will
 * quote it back to people who never visit the site. So two rules hold.
 *
 * It says only what the page says. No rating, because nothing here is rated. No
 * image, because every image in this catalogue is a procedural placeholder and
 * presenting one as a photograph of a product would be a lie told in a format
 * designed to be trusted. No search action, because this site has no search
 * endpoint to point one at. A field this site cannot fill is absent, not empty.
 *
 * And it is embedded as data. See `jsonLdScript`.
 */

/**
 * JSON, safe to sit inside a script element.
 *
 * `JSON.stringify` does not escape `<`, so a value containing `</script>` ends
 * the element early and everything after it becomes markup on the page. Nothing
 * in this catalogue contains one today; the supplier import work means
 * catalogue text will not always be written by hand, and a defence added after
 * the first such value arrives is added too late.
 *
 * U+2028 and U+2029 are valid in JSON and were, for years, line terminators in
 * JavaScript. They are escaped for the same reason: a parser that disagrees
 * with the writer about where a string ends is the whole problem.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const absolute = (path: string) => `${SITE_URL}${path}`;

/**
 * The trail already drawn at the top of the page, said again in a form a
 * machine reads. It mirrors the rendered breadcrumb exactly: the same labels in
 * the same order, so the markup cannot describe a navigation the page does not
 * have.
 */
export function breadcrumbList(items: { name: string; path?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.path ? { item: absolute(item.path) } : {}),
    })),
  };
}

/**
 * Who publishes this, on the home page only.
 *
 * No logo: the only images here are placeholders. No sameAs: this site has no
 * account anywhere to link to, and listing one that does not exist is how a
 * knowledge panel ends up pointing at somebody else. No SearchAction: that
 * markup tells a search engine it can send queries to a search URL, and this
 * site has no such URL.
 */
export function publisher() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_TAGLINE,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };
}

/**
 * The products a category page lists, in the order it lists them.
 *
 * An ItemList of names and links, which is what the page is: a ranked
 * comparison. It carries no price and no rating, because those belong to the
 * product pages it links to and repeating them here would be two places to keep
 * true instead of one.
 *
 * Built from the same array the grid renders, so the list and the page cannot
 * disagree about what is on it or what order it is in.
 */
export function categoryItemList(name: string, path: string, products: { name: string; slug: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: absolute(path),
    numberOfItems: products.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.name,
      url: absolute(`/products/${p.slug}`),
    })),
  };
}
