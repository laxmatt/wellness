import { z } from "zod";
import { attributeDef, type CategoryDefinition } from "./category";

// The unit contract at the boundary between the model and the engine.
//
// The engine stores and compares money in integer minor units: `price` is
// cents, and so is every attribute declared `USD_minor`. A live run showed the
// model answering "under $700" with `{"key":"price","op":"lte","value":700}`,
// which the engine read as $7.00 and matched nothing. The engine was right, the
// summary was right, and the shopper was told their budget matched nothing when
// it matched something. Nothing in the stack could notice, because 700 is a
// perfectly good number of cents.
//
// So the model no longer sends a number for money. It sends an amount with its
// currency, and this file converts it. Two rules, both absolute:
//
//   1. Money crosses the boundary as {"amount": 700, "currency": "USD"}, in
//      whole currency units, and code multiplies. The model never sends cents.
//   2. A bare number for a money key is refused, not interpreted. Guessing the
//      unit from the size of the number is how "under $5" and "under $500"
//      become the same request.

export const MONEY_CURRENCY = "USD" as const;

export const ModelMoney = z.object({
  // Dollars, as a person says them: 700, 5000, 1.99. Not cents.
  amount: z.number().finite().min(0).max(1_000_000),
  currency: z.literal(MONEY_CURRENCY),
});
export type ModelMoney = z.infer<typeof ModelMoney>;

export function isMoneyKey(cat: CategoryDefinition, key: string): boolean {
  return key === "price" || attributeDef(cat, key)?.unit === "USD_minor";
}

// Every money key in a category, so the model's instructions can name them
// rather than describing the rule in the abstract.
export function moneyKeys(cat: CategoryDefinition): string[] {
  const keys = cat.filters.map((f) => f.key).filter((k) => isMoneyKey(cat, k));
  return keys.includes("price") ? keys : ["price", ...keys];
}

/**
 * Dollars to integer cents, deterministically.
 *
 * Decimal arithmetic in floating point is not exact: 19.99 * 100 is
 * 1998.9999999999998, and 2.675 * 100 is 267.49999999999994. Rounding those
 * naively loses a cent on prices people actually type. So the amount is scaled
 * through its decimal string instead, and only then rounded, half away from
 * zero.
 */
export function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError("A money amount must be a finite number.");
  const negative = amount < 0;
  const [whole, fraction = ""] = Math.abs(amount).toFixed(10).split(".");
  // Integer arithmetic on the decimal string, so 19.99 cannot become 1998.
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  const remainder = Number(`0.${fraction.slice(2) || "0"}`);
  const rounded = cents + (remainder >= 0.5 ? 1 : 0);
  return negative ? -rounded : rounded;
}

export type MoneyConversion =
  | { ok: true; minorUnits: number }
  | { ok: false; reason: string };

/**
 * The value of one constraint on a money key, converted for the engine.
 *
 * A bare number is refused rather than interpreted. That refusal is the whole
 * point: it is the difference between a wrong answer and a visible failure.
 */
export function moneyValueToMinorUnits(value: unknown, key: string): MoneyConversion {
  const parsed = ModelMoney.safeParse(value);
  if (parsed.success) return { ok: true, minorUnits: dollarsToCents(parsed.data.amount) };

  if (typeof value === "number") {
    return {
      ok: false,
      reason: `"${key}" is money and must be sent as {"amount": <dollars>, "currency": "USD"}, not as the bare number ${value}. The unit is not guessed from the size of the number.`,
    };
  }
  if (value && typeof value === "object" && "currency" in value && (value as { currency?: unknown }).currency !== MONEY_CURRENCY) {
    return { ok: false, reason: `"${key}" only accepts ${MONEY_CURRENCY} amounts.` };
  }
  return { ok: false, reason: `"${key}" is money and must be sent as {"amount": <dollars>, "currency": "${MONEY_CURRENCY}"}.` };
}

// How the money contract is described to the model, generated from the same
// constants the converter uses.
export function moneyContractText(cat: CategoryDefinition): string {
  const keys = moneyKeys(cat).filter((k) => cat.filters.some((f) => f.key === k) || k === "price");
  return [
    `MONEY: ${keys.join(", ")} ${keys.length === 1 ? "is" : "are"} money.`,
    `Send money as an object in whole dollars, never as a number of cents and never as a bare number:`,
    `- {"key": "${keys[0]}", "op": "lte", "value": {"amount": 700, "currency": "${MONEY_CURRENCY}"}} means "under $700".`,
    `- {"key": "${keys[0]}", "op": "lte", "value": {"amount": 1.99, "currency": "${MONEY_CURRENCY}"}} means "under $1.99".`,
    `A bare number for one of these keys is rejected outright, because "500" cannot be told apart from "$5.00".`,
  ].join("\n");
}
