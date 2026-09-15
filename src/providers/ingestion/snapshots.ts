/**
 * Where `npm run fetch:shopify` leaves the catalogues the tool can read from
 * disk, and the only way a caller gets to name one.
 *
 * `intake/shopify/` beside the catalogue, unless `SNAPSHOT_DIR` names another
 * directory, which exists so a check can run against a generated snapshot
 * without writing into somebody's real intake. The same rule as the ingestion
 * root: a path out of an environment variable is still a path, so it is
 * resolved inside the project and refused otherwise.
 *
 * The reason this is a module rather than two lines in the server: the server
 * must never accept a path from a request. A caller names a partner, this
 * composes the file, and the composition is checked against the directory it
 * was supposed to land in. There is no other way in.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export function snapshotDir(root = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  const named = env.SNAPSHOT_DIR?.trim();
  if (!named) return resolve(root, "intake", "shopify");
  const path = resolve(root, named);
  if (!path.startsWith(resolve(root) + sep)) {
    throw new Error(`SNAPSHOT_DIR has to name a directory inside this project. It says "${named}", which resolves to ${path}.`);
  }
  return path;
}

export type SnapshotOnDisk = { sourceId: string; fileName: string; bytes: number; modified: string };

/** Every snapshot on this machine, for the tool to offer beside the partner it belongs to. */
export function snapshotsOnDisk(dir = snapshotDir()): SnapshotOnDisk[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const stat = statSync(join(dir, f));
      return { sourceId: f.replace(/\.json$/, ""), fileName: f, bytes: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

/**
 * The snapshot for one partner, named by the partner.
 *
 * The id is the only thing that comes from outside, and it is a source id this
 * server already holds. Everything a path could be is decided here: the
 * directory, the extension, and a comparison that refuses anything whose
 * resolved form is not the file directly inside that directory. A traversal, an
 * absolute path or a separator in the id all fail the same way, with the same
 * sentence, and read nothing.
 */
export function snapshotFor(sourceId: string, dir = snapshotDir()): { ok: true; path: string; name: string } | { ok: false; reason: string } {
  // The id has to be a name, not a route to one. Checked before it is joined to
  // anything: `nested/secret` resolves to a real file inside the directory and
  // would have passed a containment check on its own, which is the flaw in
  // deciding this after the join rather than before it.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceId)) {
    return { ok: false, reason: `"${sourceId}" is not a partner id. A snapshot is named by its partner, in lower case letters, digits and hyphens, and never by a path.` };
  }
  const name = `${sourceId}.json`;
  const path = resolve(dir, name);
  if (path !== join(dir, name) || !path.startsWith(resolve(dir) + sep)) {
    return { ok: false, reason: `"${sourceId}" does not name a file inside the snapshot directory, so nothing was read.` };
  }
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `There is no snapshot for "${sourceId}" on this machine. Run \`npm run fetch:shopify -- ${sourceId}\` where the store is reachable; it writes the file this reads.`,
    };
  }
  return { ok: true, path, name };
}
