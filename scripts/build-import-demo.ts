/**
 * Build the supplier import demonstration into one file that opens from disk.
 *
 *   npm run import:demo
 *
 * The page is one HTML file with the script inlined, so it runs from file://
 * with no server, no network and no build step at the operator's end. That is
 * the point rather than a convenience: a demonstration that needs a route could
 * become a route, and an unauthenticated admin page is exactly what this must
 * not turn into.
 *
 * The logic is not written twice. This bundles src/domain/import, the same
 * modules the tests exercise, so the page cannot drift from what is proved.
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "docs", "import-demo");
const OUT = join(OUT_DIR, "index.html");

async function main() {
  const result = await build({
    entryPoints: [join(ROOT, "src", "tools", "import-demo", "entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    platform: "browser",
    // Readable on purpose. Somebody asked to run this on their own machine
    // should be able to read what it does before they do.
    minify: false,
    legalComments: "none",
  });

  const js = result.outputFiles[0].text;
  const shell = readFileSync(join(ROOT, "src", "tools", "import-demo", "shell.html"), "utf8");
  if (!shell.includes("/* BUNDLE */")) throw new Error("shell.html has no /* BUNDLE */ placeholder");

  // The bundle carries no supplier data and no markup, so inlining it is safe.
  // Refuse anyway if it ever contains a closing script tag, which would end the
  // element early and put the rest of the code on the page as text.
  if (js.includes("</script")) throw new Error("the bundle contains a closing script tag and cannot be inlined");

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, shell.replace("/* BUNDLE */", js), "utf8");
  console.log(`Wrote ${OUT} (${Math.round(js.length / 1024)} kB of script).`);
  console.log("Open it with: file://" + OUT);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
