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
  // A worked example for each money key, at that key's own magnitude. The
  // block used to show two examples, both on `price`, both at 700, and a
  // per-serving budget of "$1.60" came back as {"amount": 160}: the shopper's
  // decimal, sent as minor units in a field the contract says is dollars. One
  // example per key, and a decimal wherever amounts are small, so the shape is
  // shown at the size the shopper will use it.
  const lines = keys.map((key) => {
    const small = /per_serving|_minor$/.test(key);
    const under = small ? 1.6 : 700;
    const orLess = small ? 2 : 700;
    // The amount as JSON, and the amount as a person writes it. "$1.6" is
    // nobody's budget.
    const written = (n: number) => (Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toFixed(2)}`);
    return [
      `- {"key": "${key}", "op": "lt", "value": {"amount": ${under}, "currency": "${MONEY_CURRENCY}"}} means "under ${written(under)}", which excludes ${written(under)} exactly.`,
      `- {"key": "${key}", "op": "lte", "value": {"amount": ${orLess}, "currency": "${MONEY_CURRENCY}"}} means "${written(orLess)} or less", which includes ${written(orLess)} exactly.`,
    ].join("\n");
  });
  // A key named "_minor" says how this site stores the number, not what you
  // send. Nothing in this contract is ever in minor units.
  const minorNamed = keys.filter((k) => k.endsWith("_minor"));
  const minorNote =
    minorNamed.length > 0
      ? `The name "${minorNamed[0]}" describes how this site stores the value internally. It does not change what you send: the amount is always in whole dollars, so $1.60 is {"amount": 1.6}, never {"amount": 160}.`
      : "";
  return [
    `MONEY: ${keys.join(", ")} ${keys.length === 1 ? "is" : "are"} money.`,
    `Send money as an object with the amount in dollars, exactly as the shopper says it. Never a number of cents, never a bare number, and never rescaled:`,
    ...lines,
    `Choose the operator by what the shopper said. "Under", "below" and "less than" are lt. "Up to", "at most", "no more than" and "or less" are lte. A budget written one way is not the other.`,
    `Decimals stay decimals: "$1.99" is {"amount": 1.99}, not 199. "$1.60 a serving" is {"amount": 1.6}, not 160.`,
    minorNote,
    `A bare number for one of these keys is rejected outright, because "500" cannot be told apart from "$5.00".`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
