/**
 * Screenshots of the built site, desktop and mobile, for review.
 *
 *   npm run preview:shots
 *
 * Nothing is paid for and nothing leaves localhost: a production build, the
 * container's Chromium, and no model. Writes PNGs into docs/preview/shots and
 * fails if the server on :3000 is not serving the build in .next, so a set of
 * screenshots can never quietly describe an older build.
 */
import { chromium, type Page } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.ASSISTANT_TEST_BASE_URL ?? "http://localhost:3000";
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const OUT = join(process.cwd(), "docs/preview/shots");

// Scale 1, not 2. These are committed to the repository, and a set at scale 2
// ran to 28 MB. At 1 they are still comfortably readable and a tenth the size.
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

type Shot = { name: string; path: string; full?: boolean; prepare?: (page: Page) => Promise<void> };

const SHOTS: Shot[] = [
  { name: "home", path: "/", full: true },
  { name: "category-red-light", path: "/red-light", full: true },
  { name: "category-cold-plunge", path: "/cold-plunge", full: true },
  { name: "category-wellness-drinks", path: "/wellness-drinks", full: true },
  { name: "product-renu", path: "/products/renu-therapy-cold-stoic-2-0", full: true },
  { name: "product-plunge-no-price", path: "/products/plunge-original", full: true },
  // Not fullPage. The compare table lives in a `max-h-[calc(100dvh-6rem)]`
  // box that scrolls internally so the product header stays put, and a
  // fullPage capture resizes the viewport, which makes `dvh` grow and produces
  // a picture nobody would ever see. Two shots at the real viewport instead:
  // the table as it opens, and the table scrolled to its end.
  { name: "compare", path: "/compare?ids=renu-cold-stoic-2,plunge-original,ice-barrel-500" },
  {
    name: "compare-scrolled",
    path: "/compare?ids=renu-cold-stoic-2,plunge-original,ice-barrel-500",
    prepare: async (page) => {
      await page.evaluate(() => {
        const box = document.querySelector("table")?.closest("div");
        if (box) box.scrollTop = box.scrollHeight;
      });
      await page.waitForTimeout(200);
    },
  },
  { name: "how-we-choose", path: "/how-we-choose", full: true },
  { name: "disclosure", path: "/disclosure", full: true },
];

async function shoot(page: Page, shot: Shot, suffix: string) {
  const res = await page.goto(`${BASE}${shot.path}`, { waitUntil: "domcontentloaded" });
  if (!res || res.status() !== 200) throw new Error(`${shot.path} returned ${res?.status()}`);
  // Fonts and images settled, without waiting on a socket that never idles:
  // the assistant tray keeps a connection open on some pages.
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  if (shot.prepare) await shot.prepare(page);
  const file = join(OUT, `${shot.name}-${suffix}.png`);
  await page.screenshot({ path: file, fullPage: shot.full ?? false });
  console.log(`wrote ${file.replace(process.cwd() + "/", "")}`);
}

const expected = (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
const home = await (await fetch(BASE)).text();
if (!home.includes(expected)) {
  console.error(`The server on ${BASE} is not serving the build in .next (expected ${expected}).`);
  process.exit(1);
}
console.log(`serving build ${expected}`);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXECUTABLE });
try {
  for (const [suffix, viewport] of [["desktop", DESKTOP], ["mobile", PHONE]] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    for (const shot of SHOTS) await shoot(page, shot, suffix);
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(join(OUT, "BUILD.txt"), `${expected}\n`, "utf8");

// Stamp the gallery, rather than have it fetch BUILD.txt: a page opened from
// a file:// URL cannot fetch a sibling file, so the id would always read as
// unstamped in the one situation the gallery exists for.
const galleryPath = join(process.cwd(), "docs/preview/index.html");
const gallery = await readFile(galleryPath, "utf8");
const stamped = gallery
  .replace(/(<code id="build">)[^<]*(<\/code>)/, `$1${expected}$2`)
  .replace(/(<span id="captured">)[^<]*(<\/span>)/, `$1${new Date().toISOString().slice(0, 10)}$2`);
if (stamped !== gallery) {
  await writeFile(galleryPath, stamped, "utf8");
  console.log("stamped docs/preview/index.html");
}
console.log("done");
