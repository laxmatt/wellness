import { z } from "zod";

export const Market = z.enum(["US"]);
export type Market = z.infer<typeof Market>;

export const Currency = z.enum(["USD"]);
export type Currency = z.infer<typeof Currency>;

export const Language = z.enum(["en"]);
export type Language = z.infer<typeof Language>;

// All amounts are integer minor units (cents). Never floats.
export const Money = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: Currency,
});
export type Money = z.infer<typeof Money>;

export function usd(dollars: number): Money {
  return { amountMinor: Math.round(dollars * 100), currency: "USD" };
}

export function formatMoney(m: Money, opts: { compact?: boolean } = {}): string {
  const dollars = m.amountMinor / 100;
  const hasCents = m.amountMinor % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: hasCents && !opts.compact ? 2 : 0,
    maximumFractionDigits: hasCents && !opts.compact ? 2 : 0,
  }).format(dollars);
}
