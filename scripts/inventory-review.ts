/**
 * The local review flow, as one command.
 *
 *   WELLNESS_PREVIEW_INVENTORY=1 npm run inventory:review
 *
 * Starts the operator tool and the storefront in development mode, on this
 * machine, and stops both together.
 *
 * Development mode is the point, not a shortcut. A production build renders the
 * category and product pages once, at build time, so a record approved
 * afterwards does not appear on them and a record hidden afterwards is still
 * listed on a page whose link now leads nowhere. `next dev` renders each
 * request, the catalogue notices a change in `catalog-preview/` when it is
 * asked for, and an approval reaches the page on the next reload with nothing
 * restarted. That is checked end to end by `e2e/inventory-admin.mts`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { PREVIEW_INVENTORY_FLAG, previewInventoryDecision } from "@/lib/preview-inventory";

const decision = previewInventoryDecision(process.env);
if (!decision.allowed) {
  console.error(`Refused.\n  ${decision.reason}\n\nStart it with:\n\n  ${PREVIEW_INVENTORY_FLAG}=1 npm run inventory:review`);
  process.exit(1);
}

const toolPort = process.env.INVENTORY_PORT ?? "4319";
const sitePort = process.env.STOREFRONT_PORT ?? "3000";
const storefront = `http://127.0.0.1:${sitePort}`;

const children: ChildProcess[] = [];

function start(label: string, command: string, args: string[]): void {
  const child = spawn(command, args, {
    env: { ...process.env, STOREFRONT_URL: storefront, INVENTORY_PORT: toolPort },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const write = (prefix: string) => (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) if (line.trim() !== "") console.log(`${prefix} ${line}`);
  };
  child.stdout?.on("data", write(`[${label}]`));
  child.stderr?.on("data", write(`[${label}]`));
  child.on("exit", (code) => {
    console.log(`[${label}] stopped${code === null ? "" : ` (${code})`}.`);
    stop();
  });
  children.push(child);
}

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

start("tool", "npx", ["tsx", "scripts/inventory-server.ts"]);
// Loopback for the storefront too. The preview catalogue holds invented
// products, and Next will otherwise serve them to everything on the local
// network as well.
start("site", "npx", ["next", "dev", "-H", "127.0.0.1", "-p", sitePort]);

console.log(`\nInventory tool:  http://127.0.0.1:${toolPort}`);
console.log(`Storefront:      ${storefront}`);
console.log("\nApprove a record in the tool and reload the storefront. Nothing needs restarting.");
console.log("Stop both with Ctrl-C.\n");
