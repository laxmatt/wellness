import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { CompareProvider } from "@/components/compare/CompareProvider";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { SITE_URL, indexingAllowed } from "@/lib/site-url";
import { social } from "@/lib/metadata";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const SITE_DESCRIPTION =
  "Compare red light panels, cold plunges and wellness drinks on the specs that matter, with sources shown.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}. ${SITE_TAGLINE}`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  // The fallback for any route that sets none of its own. Every route that has
  // its own title and description now overrides this, so a shared product link
  // no longer reads as the home page.
  ...social({ title: `${SITE_NAME}. ${SITE_TAGLINE}`, description: SITE_DESCRIPTION, path: "/" }),
  // Off unless somebody switched indexing on for this deployment. Every page
  // inherits it, so a preview stays out of the index even when it was handed
  // production's environment, and a crawler is allowed in to read the tag.
  ...(indexingAllowed() ? {} : { robots: { index: false, follow: false } }),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${manrope.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <CompareProvider>{children}</CompareProvider>
      </body>
    </html>
  );
}
