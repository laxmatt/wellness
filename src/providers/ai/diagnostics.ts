import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ZodError } from "zod";

// Why a rejected reply was rejected, for the private live test only.
//
// When `ModelIntent` refuses a payload the shopper sees a fixed sentence and the
// payload is gone. That is right for a live site and useless for diagnosis: two
// runs established that seven of fifteen replies were discarded and neither
// could say which field caused it.
//
// So this exists, and it is off unless an operator turns it on:
//
//   - It writes nothing unless `ASSISTANT_DIAGNOSTICS_FILE` names a path.
//   - It refuses to run when `NODE_ENV` is "production", so setting the
//     variable on a deployed host does nothing.
//   - It records the model's rejected output, the validator's complaint and the
//     provider's finish reason. It never records the conversation, the
//     shortlist, request headers, environment variables or any credential.
//
// The conversation is deliberately excluded. The synthetic test's own sentences
// are already in the repository; a real visitor's are not, and a diagnostic
// file is exactly where they must never end up.

export type RejectionIssue = { path: string; code: string; message: string };

export type RejectedIntent = {
  at: string;
  model: string;
  finishReason: string | null;
  // What the validator objected to, field by field.
  issues: RejectionIssue[];
  // The model's own output, as received. Not the prompt, not the conversation.
  rawContent: string;
  rawContentTruncated: boolean;
};

const MAX_RAW_CHARS = 8000;

export function diagnosticsTarget(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV === "production") return null;
  const path = env.ASSISTANT_DIAGNOSTICS_FILE?.trim();
  return path ? path : null;
}

export function issuesOf(error: ZodError): RejectionIssue[] {
  return error.issues.map((i) => ({
    path: i.path.length > 0 ? i.path.join(".") : "(root)",
    code: i.code,
    message: i.message,
  }));
}

export function buildRejection(args: {
  model: string;
  finishReason: string | null;
  error: ZodError;
  rawContent: string;
  now?: Date;
}): RejectedIntent {
  const raw = args.rawContent ?? "";
  return {
    at: (args.now ?? new Date()).toISOString(),
    model: args.model,
    finishReason: args.finishReason,
    issues: issuesOf(args.error),
    rawContent: raw.slice(0, MAX_RAW_CHARS),
    rawContentTruncated: raw.length > MAX_RAW_CHARS,
  };
}

// Never throws. A diagnostic that can break a request is worse than no
// diagnostic, and this runs on the path a shopper is waiting on.
export function captureRejectedIntent(rejection: RejectedIntent, env: NodeJS.ProcessEnv = process.env): boolean {
  const target = diagnosticsTarget(env);
  if (!target) return false;
  try {
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, `${JSON.stringify(rejection)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}
