import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Components and routes may only use semantic tokens. Palette names and hex
// colors belong in globals.css (and DemoArt, which is placeholder art).
const PALETTE = ["ivory", "paper", "ink", "line", "ember", "tide", "moss", "honey", "plum"];
const PREFIX = "(?:bg|text|border|divide|ring|from|via|to|placeholder|outline|decoration|fill|stroke)";
const ALLOW = new Set(["src/components/ui/DemoArt.tsx"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("design tokens", () => {
  const files = [...walk("src/components"), ...walk("src/app")].filter((f) => !ALLOW.has(f));

  it("components never reference palette names directly", () => {
    const offenders: string[] = [];
    const re = new RegExp(`\\b${PREFIX}-(?:${PALETTE.join("|")})(?:-[a-z]+)?(?![\\w-])`, "g");
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const hits = src.match(re);
      if (hits) offenders.push(`${f}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("components never hard-code hex colors", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/href="#[a-z-]+"/g, "").replace(/"#retailers"/g, ""))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("globals.css defines every semantic token the components use", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const defined = new Set([...css.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]));
    const used = new Set<string>();
    const re = new RegExp(`\\b${PREFIX}-([a-z][a-z-]*?)(?:/\\d+)?(?![\\w-])`, "g");
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(re)) used.add(m[1]);
    }
    const semantic = [...used].filter((u) => /^(surface|fg|edge|accent|secondary|positive|warm|tertiary|badge|control)(-|$)/.test(u));
    const missing = semantic.filter((u) => !defined.has(u));
    expect(missing).toEqual([]);
  });
});
