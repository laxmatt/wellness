import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { CompareProvider } from "@/components/compare/CompareProvider";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}. ${SITE_TAGLINE}`, template: `%s | ${SITE_NAME}` },
  description: "Compare red light panels, cold plunges and wellness drinks on the specs that matter, with sources shown.",
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
