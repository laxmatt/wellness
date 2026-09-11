/**
 * Build a local operator tool into one file that opens from disk.
 *
 *   npm run import:demo        the supplier import demonstration
 *   npm run dashboard          the owner's learning dashboard
 *
 * Each page is one HTML file with its script inlined, so it runs from file://
 * with no server, no network and no build step at the operator's end. That is
 * the point rather than a convenience: a tool that needs a route could become a
 * route, and an unauthenticated admin page is exactly what these must not turn
 * into.
 *
 * The logic is not written twice. This bundles the same domain modules the
 * tests exercise, so a page cannot drift from what is proved.
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const TOOLS = {
  "import-demo": { source: join("src", "tools", "import-demo"), out: join("docs", "import-demo") },
  "learning-dashboard": { source: join("src", "tools", "learning-dashboard"), out: join("docs", "learning-dashboard") },
} as const;

async function main() {
  const name = process.argv[2];
  const tool = TOOLS[name as keyof typeof TOOLS];
  if (!tool) {
    console.error(`Usage: tsx scripts/build-local-tool.ts <${Object.keys(TOOLS).join(" | ")}>`);
    process.exit(2);
  }

  const result = await build({
    entryPoints: [join(ROOT, tool.source, "entry.ts")],
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
  const shell = readFileSync(join(ROOT, tool.source, "shell.html"), "utf8");
  if (!shell.includes("/* BUNDLE */")) throw new Error(`${name}: shell.html has no /* BUNDLE */ placeholder`);

  // The bundle carries no operator data and no markup, so inlining it is safe.
  // Refuse anyway if it ever contains a closing script tag, which would end the
  // element early and put the rest of the code on the page as text.
  if (js.includes("</script")) throw new Error(`${name}: the bundle contains a closing script tag and cannot be inlined`);

  const out = join(ROOT, tool.out, "index.html");
  mkdirSync(join(ROOT, tool.out), { recursive: true });
  writeFileSync(out, shell.replace("/* BUNDLE */", js), "utf8");
  console.log(`Wrote ${out} (${Math.round(js.length / 1024)} kB of script).`);
  console.log("Open it with: file://" + out);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
