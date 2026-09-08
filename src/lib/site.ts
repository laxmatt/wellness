export const SITE_NAME = "Wellness Compare";
export const SITE_TAGLINE = "The specs, side by side.";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/red-light", label: "Red Light" },
  { href: "/cold-plunge", label: "Cold Plunge" },
  { href: "/wellness-drinks", label: "Wellness Drinks" },
  { href: "/compare", label: "Compare" },
  { href: "/brands", label: "Brands" },
  { href: "/how-we-choose", label: "How We Choose" },
] as const;

export const MAX_COMPARE = 4;
