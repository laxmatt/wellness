import { describe, expect, it } from "vitest";
import { ModelIntent } from "@/domain/assistant";
import { CONDITION_OPS } from "@/domain/category";
import { SOFT_DIRECTIONS } from "@/domain/personalization";
import { STRICT_UNSUPPORTED_KEYWORDS, intentJsonSchema, responseFormat } from "@/providers/ai/OpenAIProvider";

// Strict structured outputs reject a schema they cannot compile, so the shape
// of the schema is worth checking before a request is ever sent. What cannot be
// checked here is whether this account and model accept it at all; see
// docs/ASSISTANT.md.

type Node = Record<string, unknown>;

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const n = node as Node;
  visit(n);
  for (const v of Object.values(n)) walk(v, visit);
}

const schema = intentJsonSchema();

describe("the schema obeys strict mode's constraints", () => {
  it("closes every object", () => {
    walk(schema, (n) => {
      if (n.type === "object") expect(n.additionalProperties).toBe(false);
    });
  });

  it("requires every property of every object", () => {
    walk(schema, (n) => {
      if (n.type !== "object" || !n.properties) return;
      const keys = Object.keys(n.properties as Node).sort();
      expect([...((n.required as string[]) ?? [])].sort()).toEqual(keys);
    });
  });

  it("uses none of the keywords this schema declines", () => {
    const found: string[] = [];
    walk(schema, (n) => {
      for (const k of STRICT_UNSUPPORTED_KEYWORDS) if (k in n) found.push(k);
    });
    expect(found).toEqual([]);
  });

  it("expresses an optional value as nullable rather than by omitting it", () => {
    const hard = (schema.properties as Node).hard as Node;
    const item = hard.items as Node;
    const value = (item.properties as Node).value as Node;
    expect((value.anyOf as Node[]).some((v) => v.type === "null")).toBe(true);
  });

  it("does not put anyOf at the root", () => {
    expect(schema.anyOf).toBeUndefined();
    expect(schema.type).toBe("object");
  });
});

describe("the schema and the validator describe the same contract", () => {
  it("carries the same operators", () => {
    const hard = (schema.properties as Node).hard as Node;
    const op = ((hard.items as Node).properties as Node).op as Node;
    expect(op.enum).toEqual([...CONDITION_OPS]);
  });

  it("carries the same soft directions", () => {
    const soft = (schema.properties as Node).soft as Node;
    const direction = ((soft.items as Node).properties as Node).direction as Node;
    expect(direction.enum).toEqual([...SOFT_DIRECTIONS]);
  });

  it("carries the money object the converter expects", () => {
    const hard = (schema.properties as Node).hard as Node;
    const value = (((hard.items as Node).properties as Node).value as Node).anyOf as Node[];
    const money = value.find((v) => v.type === "object");
    expect(money).toBeTruthy();
    expect(Object.keys(money!.properties as Node).sort()).toEqual(["amount", "currency"]);
  });

  it("leaves the counts and ranges to Zod, which still refuses them", () => {
    const ok = { reply: "Sure.", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] };
    const tooMany = Array.from({ length: 9 }, () => ({ key: "price", op: "lte", value: 1 }));
    expect(ModelIntent.safeParse({ ...ok, hard: tooMany }).success).toBe(false);
    expect(ModelIntent.safeParse({ ...ok, soft: [{ key: "price", direction: "prefer_low", weight: 5 }] }).success).toBe(false);
  });
});

describe("the request is unchanged unless an operator opts in", () => {
  it("sends json_object by default", () => {
    expect(responseFormat({} as NodeJS.ProcessEnv)).toEqual({ type: "json_object" });
  });

  it("sends the strict schema only when asked", () => {
    const format = responseFormat({ ASSISTANT_RESPONSE_FORMAT: "json_schema" } as unknown as NodeJS.ProcessEnv);
    expect(format.type).toBe("json_schema");
    const js = format.json_schema as Node;
    expect(js.strict).toBe(true);
    expect(js.name).toBe("model_intent");
  });

  it("ignores a value it does not recognise", () => {
    expect(responseFormat({ ASSISTANT_RESPONSE_FORMAT: "yaml" } as unknown as NodeJS.ProcessEnv)).toEqual({ type: "json_object" });
  });
});
