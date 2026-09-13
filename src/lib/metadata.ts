import type { Metadata } from "next";
import { SITE_NAME } from "./site";
import { SITE_URL } from "./site-url";

// Social metadata, built from copy that already exists on the page.
//
// Every route set a title and a description and none set OpenGraph, so a link
// to any page shared anywhere had only whatever a client could scrape, and
// nothing named the page rather than the site.
//
// No image. Every image in this catalogue is a procedural placeholder, and
// putting one behind `og:image` would present a generated pattern as a
// photograph of a product. That is why the card is `summary` rather than
// `summary_large_image`: the large variant is designed around an image this
// site does not have.
//
// The title here is the full one, site name included, because a card is read
// on its own with no tab or template around it. `path` matches the page's
// canonical, so a shared link and a canonical agree.
export function social({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path?: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const full = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  return {
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: full,
      description,
      ...(path ? { url: `${SITE_URL}${path}` } : {}),
    },
    twitter: {
      card: "summary",
      title: full,
      description,
    },
  };
}
