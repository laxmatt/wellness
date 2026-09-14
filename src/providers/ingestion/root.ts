/**
 * Where the ingestion workspace lives.
 *
 * `ingestion/` beside the catalogue, unless `INGESTION_DIR` names another
 * directory, which exists so a check can run against an empty workspace
 * without touching somebody's. It is resolved inside the project and refused
 * otherwise: a path out of an environment variable is still a path, and the
 * store's own two locks are about record ids rather than about its root.
 */

import { resolve, sep } from "node:path";

export function ingestionRoot(root = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  const named = env.INGESTION_DIR?.trim();
  if (!named) return resolve(root, "ingestion");
  const path = resolve(root, named);
  if (!path.startsWith(resolve(root) + sep)) {
    throw new Error(`INGESTION_DIR has to name a directory inside this project. It says "${named}", which resolves to ${path}.`);
  }
  return path;
}
