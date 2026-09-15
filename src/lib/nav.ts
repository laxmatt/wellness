import { categories } from "@/domain/categories";

/**
 * The header, the footer and the phone menu, from one list.
 *
 * The categories in it are the published ones, read rather than retyped.
 * Saunas launched with a hand-written list here that nobody updated, so the
 * category had pages, a home card and an Explore entry and no way into it from
 * the bar at the top of every page. A list derived from the same array that
 * decides what is published cannot fall behind it again.
 */
export const NAV: readonly { href: string; label: string }[] = [
  { href: "/explore", label: "Explore" },
  ...categories.map((c) => ({ href: `/${c.slug}`, label: c.navLabel })),
  { href: "/compare", label: "Compare" },
  { href: "/brands", label: "Brands" },
  { href: "/how-we-choose", label: "How We Choose" },
];
