// The private live test's report, as text.
//
// This is in `src/` so it can be exercised without spending anything. It had to
// be: a refactor deleted the call that recorded each case, and the run of 21:37
// wrote a file with one row and the line "12 of 1" while the console showed all
// fifteen results. Nothing caught it, because the only thing that ever ran this
// code was a paid run.

export type CaseRecord = {
  category: string;
  note: string;
  text: string;
  reply: string;
  problems: string[];
  shown: number;
};

export type LedgerSnapshot = {
  spentUsd: number;
  uncertainUsd: number;
  store: string;
  credential: { mode: string; baseUrl?: string };
  uncertainCharges: { reservationId: string; reason: string; heldUsd: number }[];
};

export type ReportInput = {
  records: CaseRecord[];
  // How many cases the run intended to try. A run that stopped early has fewer
  // records than this, and the report says so rather than quietly rescaling.
  plannedCases: number;
  before: LedgerSnapshot | null;
  after: LedgerSnapshot | null;
  stoppedEarly?: { reason: string };
  model?: string;
  now?: Date;
  // What one record is. The 15-case suite records one conversation per case;
  // an evaluation run records a turn, and a conversation can have two, so the
  // counts differ and the heading has to say which it is counting.
  unit?: { one: string; many: string };
  // Conversations attempted, when that differs from the number of records.
  conversations?: number;
};

export function passCount(records: CaseRecord[]): number {
  return records.filter((r) => r.problems.length === 0).length;
}

export function reportStamp(now = new Date()): string {
  return now.toISOString().replace(/:/g, "-").slice(0, 16);
}

export function buildReport(input: ReportInput): string {
  const { records, plannedCases, before, after } = input;
  // Absent, the wording is the 15-case suite's, unchanged: its reports are
  // one conversation per record and they say so.
  const unit = input.unit;
  const many = unit?.many ?? "cases";
  const now = input.now ?? new Date();
  const pass = passCount(records);
  const spent = before && after ? after.spentUsd - before.spentUsd : null;
  const newlyUncertain =
    before && after ? after.uncertainCharges.filter((u) => !before.uncertainCharges.some((b) => b.reservationId === u.reservationId)) : [];

  const lines: string[] = [
    `# Live assistant test, ${now.toISOString()}`,
    "",
    `Model: \`${input.model ?? "gpt-4o-mini"}\`. Credential mode: \`${after?.credential.mode ?? "unknown"}\`. Ledger: \`${after?.store ?? "unknown"}\`.`,
    "",
  ];

  if (input.stoppedEarly) {
    lines.push(
      `**This run stopped early: ${input.stoppedEarly.reason}** ${records.length} of ${plannedCases} ${many} ran. The figures below cover only those.`,
      "",
    );
  }

  lines.push(
    "## Extraction",
    "",
    `${pass} of ${records.length} ${many} matched the constraints a careful person would have entered.` +
      (records.length === plannedCases ? "" : ` ${plannedCases} were planned.`) +
      (input.conversations !== undefined ? ` They come from ${input.conversations} conversations: a conversation runs more than one ${unit?.one ?? "turn"} when the site asks something or the shopper changes a requirement.` : ""),
    "",
    `| Category | ${unit ? `${unit.one[0].toUpperCase()}${unit.one.slice(1)}` : "Case"} | Result | Products shown |`,
    "| --- | --- | --- | --- |",
    ...records.map((r) => `| ${r.category} | ${r.note} | ${r.problems.length === 0 ? "ok" : r.problems.join("; ")} | ${r.shown} |`),
    "",
    "## Cost",
    "",
    spent === null
      ? "Not measured: no admin key was available to read the ledger."
      : [
          `Measured spend for ${records.length} ${unit ? unit.many : "single-turn conversations"}: **$${spent.toFixed(4)}**.`,
          "",
          records.length > 0
            ? `Observed cost per ${unit?.one ?? "conversation"}: **$${(spent / records.length).toFixed(5)}**.`
            : `No ${unit?.one ?? "conversation"} completed.`,
          "",
          "A real conversation runs several turns. Multiply by expected turns per session before setting the cap.",
        ].join("\n"),
    "",
  );

  if (newlyUncertain.length > 0) {
    lines.push(
      "## Unconfirmed charges",
      "",
      `${newlyUncertain.length} call(s) ended without a confirmed cost, holding $${(after?.uncertainUsd ?? 0).toFixed(4)} against the cap. The measured spend above is a lower bound until these are reconciled against the provider's usage record.`,
      "",
      "| Reservation | Held | Reason |",
      "| --- | --- | --- |",
      ...newlyUncertain.map((u) => `| \`${u.reservationId}\` | $${u.heldUsd.toFixed(5)} | ${u.reason} |`),
      "",
    );
  }

  lines.push("## Replies, verbatim", "", "Read these. No script judges whether the wording is right for the site.", "");
  for (const r of records) lines.push(`**${r.category}** | "${r.text}"`, "", `> ${r.reply.replace(/\n/g, " ")}`, "");

  return lines.join("\n");
}
