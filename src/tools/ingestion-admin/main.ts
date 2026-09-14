/**
 * The ingestion page: a file, a mapping, what the mapping would do, and only
 * then a draft.
 *
 * It holds no rules. Every reading, refusal, merge and write is the server's,
 * which is the domain code the tests exercise; this draws what comes back and
 * sends what the administrator chose. Where it says a filter is unfilled or an
 * extraction is unapproved, that is the report saying so.
 *
 * Two habits, both learned the hard way in the inventory tool.
 *
 * Text from a partner's file reaches the page through `textContent` only. A
 * product title out of a CSV is somebody else's text and is never markup here.
 *
 * What the administrator has typed lives in this state, not in the inputs, and
 * survives a redraw. A failed save that empties the form throws away the work
 * and keeps the mistake.
 */

import type { Preflight, RecordPlan } from "@/domain/ingestion/preflight";
import type { PromotionPlan, RecordReview, ShadowReview } from "@/domain/promotion/plan";
import { RIGHTS_BASIS_WORDS, type RightsBasis } from "@/domain/promotion/rights";
import { SHADOW_CHOICE_WORDS, type FieldSide, type ShadowChoice } from "@/domain/promotion/shadow";
import type { AttributeRule, ColumnMapping, ExclusionRule, FieldOwnership, Grouping, MappingProfile, PartnerSource } from "@/domain/ingestion/profile";
import type { Suggestion } from "@/domain/ingestion/suggest";
import { OPERATOR_HEADER } from "@/domain/inventory/local-request";

type ProfileSummary = { version: number; createdOn: string; createdBy: string; note: string; approved: boolean; approvedBy?: string; approvedOn?: string; profile: MappingProfile };
type SourceRow = {
  source: PartnerSource;
  profiles: ProfileSummary[];
  lastSuccessfulRefresh: string | null;
  lastProfileVersion: number | null;
  lastFile: string | null;
  uploads: number;
  records: number;
};
type DraftRow = {
  id: string;
  name: string;
  description: string;
  status: string;
  brandId: string;
  categoryId: string;
  note: string | null;
  price: number | null;
  quoteOnly: boolean;
  availability: string;
  url: string | null;
  image: string | null;
  attributes: { key: string; value: unknown; verification: string; note: string | null }[];
};
type PlanRow = {
  planId: string;
  signedBy: string;
  signedOn: string;
  sourceId: string;
  profileVersion: number;
  uploadFile: string | null;
  families: number;
  records: number;
  executed: boolean;
  stillCurrent: boolean;
  selfConsistent: boolean;
  document: string;
};
type Promotion = {
  familyIds: string[];
  shadows: Record<string, { choice: ShadowChoice; fields: Record<string, FieldSide>; note: string }>;
  reviewer: string;
  plan: PromotionPlan | null;
  /** Cleared whenever a choice changes, so a stale report never sits beside new choices. */
  stale: boolean;
  document: string | null;
  rightsForm: { recordId: string; src: string; basis: RightsBasis; evidence: string } | null;
};
type ServerState = {
  today: string;
  formats: { format: string; label: string; supported: boolean; note: string }[];
  targets: { target: string; label: string; catalogPath: string; required: boolean; note: string }[];
  sources: SourceRow[];
  drafts: DraftRow[];
  plans: PlanRow[];
};
type CategoryInfo = {
  id: string;
  name: string;
  attributes: { key: string; label: string; type: string; unit: string | null; options: string[] | null; filterable: boolean }[];
  filters: { key: string; label: string; kind: string }[];
};
type Inspect = {
  fileName: string;
  rows: number;
  truncated: number;
  readerNotes: string[];
  columns: { name: string; populated: number; samples: string[] }[];
  suggestion: Suggestion;
  category: CategoryInfo;
};

type DraftProfile = {
  note: string;
  grouping: Grouping;
  columns: ColumnMapping[];
  attributes: AttributeRule[];
  exclusions: ExclusionRule[];
  families: MappingProfile["families"];
  proposedFilters: MappingProfile["proposedFilters"];
};

type State = {
  server: ServerState | null;
  sourceId: string;
  file: { name: string; text: string } | null;
  inspect: Inspect | null;
  profile: DraftProfile | null;
  preflight: Preflight | null;
  /** The version the administrator is working against for approve and import. */
  version: number | null;
  approver: string;
  edit: { id: string; name: string; description: string } | null;
  newSource: Record<string, string> | null;
  promotion: Promotion;
  message: { text: string; bad: boolean; details: string[] } | null;
  busy: boolean;
};

const OWNERSHIPS: FieldOwnership[] = ["feed", "editorial", "review_on_change"];
const OWNERSHIP_WORDS: Record<FieldOwnership, string> = {
  feed: "feed decides",
  editorial: "we decide, no file changes it",
  review_on_change: "a person applies a change",
};

const state: State = {
  server: null,
  sourceId: "",
  file: null,
  inspect: null,
  profile: null,
  preflight: null,
  version: null,
  approver: "",
  edit: null,
  newSource: null,
  promotion: { familyIds: [], shadows: {}, reviewer: "", plan: null, stale: false, document: null, rightsForm: null },
  message: null,
  busy: false,
};

let root: HTMLElement;

// --------------------------------------------------------------------- DOM

type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") node.addEventListener(key.replace(/^on/, ""), value as EventListener);
    else if (typeof value === "boolean") { if (value) node.setAttribute(key, ""); }
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}

const text_ = (tag: keyof HTMLElementTagNameMap, className: string, content: string): HTMLElement => el(tag as "p", className ? { class: className } : {}, [content]);

function select(value: string, options: { value: string; label: string }[], onChange: (v: string) => void, attrs: Attrs = {}): HTMLSelectElement {
  const node = el("select", { ...attrs, onchange: (e) => onChange((e.target as HTMLSelectElement).value) });
  for (const o of options) {
    const option = el("option", { value: o.value, ...(o.value === value ? { selected: true } : {}) }, [o.label]);
    node.append(option);
  }
  node.value = value;
  return node;
}

function field(label: string, control: Node, note?: string): HTMLElement {
  return el("div", {}, [text_("label", "", label), control, ...(note ? [text_("p", "note", note)] : [])]);
}

// ------------------------------------------------------------------ sending

async function send(command: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  state.busy = true;
  render();
  try {
    const res = await fetch("/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", [OPERATOR_HEADER]: "1" },
      body: JSON.stringify({ command, ...payload }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (body.ok === false) {
      const errors = (body.errors as string[]) ?? ["Something went wrong."];
      const extra = [
        ...((body.blockers as string[]) ?? []),
        ...((body.refusals as string[]) ?? []),
        ...(((body.fieldErrors as { field: string; message: string }[]) ?? []).map((f) => `${f.field}: ${f.message}`)),
      ];
      state.message = { text: errors[0], bad: true, details: [...errors.slice(1), ...extra] };
    } else if (typeof body.message === "string") {
      state.message = { text: body.message, bad: false, details: [] };
    }
    if (body.sources) state.server = body as unknown as ServerState;
    if (body.preflight) state.preflight = body.preflight as Preflight;
    return body;
  } catch (e) {
    state.message = { text: `The tool could not be reached: ${e instanceof Error ? e.message : String(e)}`, bad: true, details: [] };
    return { ok: false };
  } finally {
    state.busy = false;
    render();
  }
}

const currentSource = (): SourceRow | undefined => state.server?.sources.find((s) => s.source.id === state.sourceId);

// ------------------------------------------------------------------ sections

function messageBox(): HTMLElement | null {
  if (!state.message) return null;
  const box = el("div", { class: `status ${state.message.bad ? "bad" : "ok"}`, "data-testid": "message" }, [text_("p", "", state.message.text)]);
  if (state.message.details.length > 0) {
    const list = el("ul");
    for (const d of state.message.details) list.append(el("li", {}, [d]));
    box.append(list);
  }
  return box;
}

function sourceSection(): HTMLElement {
  const server = state.server!;
  const panel = el("section", { class: "panel", "data-testid": "sources" }, [text_("h2", "", "1. Partner source")]);

  panel.append(
    field(
      "Source",
      select(
        state.sourceId,
        [{ value: "", label: "Choose a partner…" }, ...server.sources.map((s) => ({ value: s.source.id, label: `${s.source.name} (${s.source.format.toUpperCase()})` }))],
        (v) => {
          state.sourceId = v;
          state.inspect = null;
          state.profile = null;
          state.preflight = null;
          state.version = null;
          render();
        },
        { "data-testid": "source-select" },
      ),
    ),
  );

  const row = currentSource();
  if (row) {
    panel.append(
      text_(
        "p",
        "note",
        `${row.source.relationship === "manufacturer" ? "The maker's own feed" : "A shop's feed"}, into ${row.source.categoryId}. ` +
          `Links are recorded as ${row.source.affiliate.status.replace("_", "-")}${row.source.affiliate.network ? ` on ${row.source.affiliate.network}` : ""}. ` +
          `${row.records} records tracked. Last import ${row.lastSuccessfulRefresh ?? "never"}${row.lastProfileVersion ? `, with mapping v${row.lastProfileVersion}` : ""}.`,
      ),
    );
    if (row.profiles.length > 0) {
      const table = el("table", { "data-testid": "profile-versions" });
      table.append(el("tr", {}, [text_("th", "", "Version"), text_("th", "", "Saved"), text_("th", "", "Approved"), text_("th", "", "Note")]));
      for (const p of row.profiles) {
        table.append(
          el("tr", { "data-testid": `profile-v${p.version}` }, [
            text_("td", "mono", `v${p.version}`),
            text_("td", "", `${p.createdOn} by ${p.createdBy}`),
            el("td", {}, [el("span", { class: `pill ${p.approved ? "ok" : "warn"}` }, [p.approved ? `approved by ${p.approvedBy} on ${p.approvedOn}` : "not approved"])]),
            el("td", {}, [
              text_("p", "note", p.note),
              el("button", {
                "data-testid": `load-v${p.version}`,
                onclick: () => {
                  // The saved decision, back in the editor. A version is never
                  // edited in place: changing this and saving writes a new one.
                  state.profile = {
                    note: p.note,
                    grouping: { ...p.profile.grouping },
                    columns: p.profile.columns.map((c) => ({ ...c })),
                    attributes: p.profile.attributes.map((a) => ({ ...a })),
                    exclusions: p.profile.exclusions.map((e) => ({ ...e })),
                    families: p.profile.families.map((f) => ({ ...f })),
                    proposedFilters: p.profile.proposedFilters,
                  };
                  state.version = p.version;
                  state.preflight = null;
                  render();
                },
              }, [`Load v${p.version} into the editor`]),
            ]),
          ]),
        );
      }
      panel.append(table);
    }
  }

  const actions = el("div", { class: "actions" });
  actions.append(
    el("button", { onclick: () => { state.newSource = state.newSource ? null : blankSource(); render(); }, "data-testid": "new-source" }, [state.newSource ? "Cancel new source" : "Add a partner source"]),
  );
  panel.append(actions);
  if (state.newSource) panel.append(newSourceForm());
  return panel;
}

const blankSource = (): Record<string, string> => ({
  id: "",
  name: "",
  format: "csv",
  merchantId: "",
  merchantName: "",
  merchantWebsite: "",
  categoryId: "",
  relationship: "retailer",
  idPrefix: "",
  defaultBrand: "",
  affiliateStatus: "unknown",
  affiliateNetwork: "",
  programRef: "",
  linkPrefix: "",
  priceCurrency: "",
  allowQuoteOnly: "no",
  notes: "",
});

function newSourceForm(): HTMLElement {
  const form = state.newSource!;
  const set = (key: string) => (e: Event) => { form[key] = (e.target as HTMLInputElement).value; };
  const box = el("div", { class: "fields", "data-testid": "new-source-form" });
  const input = (key: string, label: string, note?: string) =>
    box.append(field(label, el("input", { type: "text", value: form[key], oninput: set(key), "data-testid": `source-${key}` }), note));

  input("id", "Source id", "Lowercase letters, digits and hyphens. Used in filenames.");
  input("name", "Name");
  input("merchantId", "Merchant id");
  input("merchantName", "Merchant name");
  input("merchantWebsite", "Merchant website");
  input("categoryId", "Category id");
  input("idPrefix", "Record id prefix");
  input("defaultBrand", "Default brand", "Used where the file states none. A person's statement, recorded as one.");
  box.append(field("Format", select(form.format, (state.server?.formats ?? []).map((f) => ({ value: f.format, label: `${f.label}${f.supported ? "" : " (not read yet)"}` })), (v) => { form.format = v; render(); }, { "data-testid": "source-format" })));
  box.append(field("Relationship", select(form.relationship, [{ value: "retailer", label: "A shop" }, { value: "manufacturer", label: "The maker" }], (v) => { form.relationship = v; }, { "data-testid": "source-relationship" }), "Decides how a specification from this file is attributed."));
  box.append(field("Link status", select(form.affiliateStatus, [{ value: "unknown", label: "unknown" }, { value: "non_affiliate", label: "non_affiliate" }, { value: "affiliate", label: "affiliate" }], (v) => { form.affiliateStatus = v; render(); }, { "data-testid": "source-affiliate" })));
  input("affiliateNetwork", "Network", "Required when links are affiliate.");
  input("programRef", "Programme reference", "Required when links are affiliate.");
  input("linkPrefix", "Issued links start with", "A row whose link does not start with this is refused rather than linked to something nobody issued.");
  input("priceCurrency", "Currency where the file states none");
  box.append(field("Quote-only listings", select(form.allowQuoteOnly, [{ value: "no", label: "refuse a row with no price" }, { value: "yes", label: "allow, this merchant quotes" }], (v) => { form.allowQuoteOnly = v; }, { "data-testid": "source-quote" })));
  input("notes", "Notes");

  const wrap = el("div", {}, [box]);
  wrap.append(
    el("div", { class: "actions" }, [
      el("button", {
        class: "primary",
        "data-testid": "save-source",
        onclick: async () => {
          const source = {
            id: form.id.trim(),
            name: form.name.trim(),
            format: form.format,
            merchantId: form.merchantId.trim(),
            merchantName: form.merchantName.trim(),
            ...(form.merchantWebsite.trim() ? { merchantWebsite: form.merchantWebsite.trim() } : {}),
            categoryId: form.categoryId.trim(),
            relationship: form.relationship,
            ...(form.priceCurrency.trim() ? { priceCurrency: form.priceCurrency.trim().toUpperCase() } : {}),
            idPrefix: form.idPrefix.trim(),
            defaultBrand: form.defaultBrand.trim(),
            affiliate: {
              status: form.affiliateStatus,
              ...(form.affiliateNetwork.trim() ? { network: form.affiliateNetwork.trim() } : {}),
              ...(form.programRef.trim() ? { programRef: form.programRef.trim() } : {}),
              ...(form.linkPrefix.trim() ? { linkPrefix: form.linkPrefix.trim() } : {}),
            },
            allowQuoteOnly: form.allowQuoteOnly === "yes",
            notes: form.notes,
          };
          const reply = await send("saveSource", { source });
          if (reply.ok !== false) {
            state.sourceId = source.id;
            state.newSource = null;
            render();
          }
        },
      }, ["Save this source"]),
    ]),
  );
  return wrap;
}

function fileSection(): HTMLElement {
  const panel = el("section", { class: "panel", "data-testid": "file" }, [text_("h2", "", "2. The file")]);
  const input = el("input", { type: "file", accept: ".csv,.tsv,text/csv,text/plain", "data-testid": "file-input" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const body = await file.text();
    // A new file resets everything derived from the last one. Carrying a
    // mapping over from a different file is how a column silently maps to the
    // wrong thing.
    state.file = { name: file.name, text: body };
    state.inspect = null;
    state.profile = null;
    state.preflight = null;
    state.version = null;
    const reply = await send("inspect", { sourceId: state.sourceId, fileName: file.name, text: body });
    if (reply.ok !== false) {
      state.inspect = reply as unknown as Inspect;
      state.profile = {
        note: "",
        grouping: state.inspect.suggestion.grouping,
        columns: state.inspect.suggestion.columns,
        attributes: [],
        exclusions: [],
        families: [],
        proposedFilters: [],
      };
      render();
    }
  });
  panel.append(field("Upload a file", input, "Read in memory. The file is kept only when an import succeeds, and it is refused outright if it looks like it carries a key."));
  if (state.file) panel.append(text_("p", "note", `${state.file.name}, ${Math.round(state.file.text.length / 1000)} kB.`));
  if (state.inspect) {
    panel.append(text_("p", "", `${state.inspect.rows} rows, ${state.inspect.columns.length} columns${state.inspect.truncated > 0 ? `, ${state.inspect.truncated} rows past the limit not read` : ""}.`));
    for (const note of state.inspect.readerNotes) panel.append(text_("p", "note", note));
    const table = el("table", { "data-testid": "columns" });
    table.append(el("tr", {}, [text_("th", "", "Column"), text_("th", "", "Filled"), text_("th", "", "First few values")]));
    for (const c of state.inspect.columns) {
      table.append(
        el("tr", {}, [
          text_("td", "mono", c.name),
          text_("td", "", `${c.populated} of ${state.inspect.rows}`),
          text_("td", "mono", c.samples.map((s) => (s.length > 90 ? `${s.slice(0, 90)}…` : s)).join(" | ") || "—"),
        ]),
      );
    }
    panel.append(el("details", {}, [el("summary", {}, [`All ${state.inspect.columns.length} detected columns`]), table]));
  }
  return panel;
}

function columnOptions(): { value: string; label: string }[] {
  return [{ value: "", label: "— not mapped —" }, ...(state.inspect?.columns ?? []).map((c) => ({ value: c.name, label: `${c.name} (${c.populated} filled)` }))];
}

function mappingSection(): HTMLElement {
  const profile = state.profile!;
  const server = state.server!;
  const panel = el("section", { class: "panel", "data-testid": "mapping" }, [text_("h2", "", "3. Map the file onto the product model")]);

  const grouping = el("div", { class: "fields" });
  grouping.append(field("Rows are grouped by", select(profile.grouping.mode, [{ value: "url_path", label: "the path of an address in a column" }, { value: "column", label: "an exact value in a column" }], (v) => { profile.grouping.mode = v as Grouping["mode"]; render(); }, { "data-testid": "grouping-mode" })));
  grouping.append(field("Grouping column", select(profile.grouping.column, columnOptions(), (v) => { profile.grouping.column = v; render(); }, { "data-testid": "grouping-column" })));
  grouping.append(field("A group is represented by", select(profile.grouping.representative, [{ value: "cheapest", label: "its cheapest row" }, { value: "first", label: "its first row" }], (v) => { profile.grouping.representative = v as Grouping["representative"]; render(); }, { "data-testid": "grouping-representative" })));
  panel.append(grouping, text_("p", "note", "A feed of many rows is not many products when one thing is sold in many configurations. Which rows make one product is stated here, not guessed."));

  const table = el("table", { "data-testid": "target-table" });
  table.append(el("tr", {}, [text_("th", "", "Field"), text_("th", "", "Column"), text_("th", "", "Owner"), text_("th", "", "Lands in")]));
  for (const target of server.targets) {
    const mapping = profile.columns.find((c) => c.target === target.target);
    table.append(
      el("tr", { "data-testid": `target-${target.target}` }, [
        el("td", {}, [text_("strong", "", target.label), ...(target.required ? [el("span", { class: "pill warn" }, ["required"])] : []), text_("p", "note", target.note)]),
        el("td", {}, [
          select(mapping?.column ?? "", columnOptions(), (v) => {
            profile.columns = profile.columns.filter((c) => c.target !== target.target);
            if (v !== "") profile.columns.push({ target: target.target as ColumnMapping["target"], column: v, ownership: mapping?.ownership ?? "review_on_change" });
            state.preflight = null;
            render();
          }, { "data-testid": `column-${target.target}` }),
        ]),
        el("td", {}, [
          select(mapping?.ownership ?? "review_on_change", OWNERSHIPS.map((o) => ({ value: o, label: OWNERSHIP_WORDS[o] })), (v) => {
            const found = profile.columns.find((c) => c.target === target.target);
            if (found) found.ownership = v as FieldOwnership;
            state.preflight = null;
            render();
          }, { "data-testid": `ownership-${target.target}` }),
        ]),
        text_("td", "mono", target.catalogPath),
      ]),
    );
  }
  panel.append(table);
  return panel;
}

function attributeSection(): HTMLElement {
  const profile = state.profile!;
  const category = state.inspect!.category;
  const panel = el("section", { class: "panel", "data-testid": "attributes" }, [
    text_("h2", "", `4. Fill ${category.name}'s approved attributes`),
    text_("p", "note", "Only attributes this category already defines. A filter the category does not have is proposed below and never added here: that is a change to what the site compares products on, and it is made in a commit somebody reviews."),
  ]);

  const table = el("table", { "data-testid": "attribute-table" });
  table.append(el("tr", {}, [text_("th", "", "Attribute"), text_("th", "", "Filled from"), text_("th", "", "Column"), text_("th", "", "Pattern"), text_("th", "", "Owner"), text_("th", "", "Approved")]));
  for (const attr of category.attributes) {
    const rule = profile.attributes.find((a) => a.key === attr.key);
    const isExtract = rule?.from === "extract";
    const replace = (next: AttributeRule | undefined) => {
      profile.attributes = profile.attributes.filter((a) => a.key !== attr.key);
      if (next) profile.attributes.push(next);
      state.preflight = null;
      render();
    };
    table.append(
      el("tr", { "data-testid": `attribute-${attr.key}` }, [
        el("td", {}, [
          text_("strong", "", attr.label),
          text_("p", "note", `${attr.key} · ${attr.type}${attr.unit ? ` in ${attr.unit}` : ""}${attr.options ? ` · ${attr.options.join(", ")}` : ""}${attr.filterable ? " · filterable" : ""}`),
        ]),
        el("td", {}, [
          select(rule?.from ?? "", [{ value: "", label: "— nothing —" }, { value: "column", label: "a whole column" }, { value: "extract", label: "a pattern over a column" }], (v) => {
            if (v === "") return replace(undefined);
            if (v === "column") return replace({ from: "column", key: attr.key, column: rule?.column ?? "", ownership: rule?.ownership ?? "review_on_change" });
            return replace({ from: "extract", key: attr.key, column: rule?.column ?? "", pattern: isExtract ? rule.pattern : "", flags: "i", ownership: rule?.ownership ?? "review_on_change", approved: false });
          }, { "data-testid": `attr-from-${attr.key}` }),
        ]),
        el("td", {}, rule ? [select(rule.column, columnOptions(), (v) => replace({ ...rule, column: v }), { "data-testid": `attr-column-${attr.key}` })] : []),
        el("td", {}, isExtract ? [el("input", { type: "text", class: "mono", value: rule.pattern, "data-testid": `attr-pattern-${attr.key}`, oninput: (e) => { (rule as { pattern: string }).pattern = (e.target as HTMLInputElement).value; state.preflight = null; } })] : []),
        el("td", {}, rule ? [select(rule.ownership, OWNERSHIPS.map((o) => ({ value: o, label: OWNERSHIP_WORDS[o] })), (v) => replace({ ...rule, ownership: v as FieldOwnership }), { "data-testid": `attr-ownership-${attr.key}` })] : []),
        el("td", {}, isExtract ? [el("input", { type: "checkbox", "data-testid": `attr-approved-${attr.key}`, ...(rule.approved ? { checked: true } : {}), onchange: (e) => replace({ ...rule, approved: (e.target as HTMLInputElement).checked }) })] : []),
      ]),
    );
  }
  panel.append(table);
  panel.append(text_("p", "note", "An extraction rule is shown with the text it ran over, what it matched and how, before anybody approves it. Nothing unapproved is ever written."));
  return panel;
}

function exclusionSection(): HTMLElement {
  const profile = state.profile!;
  const panel = el("section", { class: "panel", "data-testid": "exclusions" }, [text_("h2", "", "5. Rows that are not products of ours")]);

  for (const [i, rule] of profile.exclusions.entries()) {
    const row = el("div", { class: "fields", "data-testid": `exclusion-${i}` });
    row.append(field("Column", select(rule.column, columnOptions(), (v) => { rule.column = v; state.preflight = null; render(); })));
    row.append(field("Test", select(rule.op, [{ value: "not_equals", label: "is not exactly" }, { value: "equals", label: "is exactly" }, { value: "empty", label: "is empty" }, { value: "not_empty", label: "is not empty" }, { value: "starts_with", label: "starts with" }, { value: "not_starts_with", label: "does not start with" }], (v) => { rule.op = v as ExclusionRule["op"]; state.preflight = null; render(); })));
    row.append(field("Value", el("input", { type: "text", value: rule.value ?? "", oninput: (e) => { rule.value = (e.target as HTMLInputElement).value; state.preflight = null; }, "data-testid": `exclusion-value-${i}` })));
    row.append(field("Because", el("input", { type: "text", value: rule.reason, oninput: (e) => { rule.reason = (e.target as HTMLInputElement).value; state.preflight = null; }, "data-testid": `exclusion-reason-${i}` }), "Shown beside every row this drops."));
    const wrap = el("div", { class: "panel" }, [row]);
    wrap.append(el("div", { class: "actions" }, [el("button", { class: "danger", onclick: () => { profile.exclusions.splice(i, 1); state.preflight = null; render(); } }, ["Remove this rule"])]));
    panel.append(wrap);
  }
  panel.append(
    el("div", { class: "actions" }, [
      el("button", { "data-testid": "add-exclusion", onclick: () => { profile.exclusions.push({ column: "", op: "not_equals", value: "", reason: "" }); render(); } }, ["Add an exclusion"]),
    ]),
  );
  return panel;
}

function familySection(): HTMLElement {
  const profile = state.profile!;
  const panel = el("section", { class: "panel", "data-testid": "families-editor" }, [
    text_("h2", "", "6. Pages that are one product in another finish"),
    text_(
      "p",
      "note",
      "A merchant sometimes sells one product on two pages. Both pages stay records, with their own price, stock, pictures and link; only one of them is a thing a shopper chooses between. Written out pair by pair, because a rule matching titles would fold two different products together the day their names happened to agree and nothing would show that it had. Record ids are the ones in the report below.",
    ),
  ]);

  for (const [i, rule] of profile.families.entries()) {
    const row = el("div", { class: "fields", "data-testid": `family-rule-${i}` });
    row.append(field("This record", el("input", { type: "text", class: "mono", value: rule.member, oninput: (e) => { rule.member = (e.target as HTMLInputElement).value.trim(); state.preflight = null; }, "data-testid": `family-member-${i}` })));
    row.append(field("is compared as part of", el("input", { type: "text", class: "mono", value: rule.family, oninput: (e) => { rule.family = (e.target as HTMLInputElement).value.trim(); state.preflight = null; }, "data-testid": `family-of-${i}` })));
    row.append(field("Because", el("input", { type: "text", value: rule.because, oninput: (e) => { rule.because = (e.target as HTMLInputElement).value; state.preflight = null; }, "data-testid": `family-because-${i}` }), "Written onto the record and shown wherever the grouping is."));
    const wrap = el("div", { class: "panel" }, [row]);
    wrap.append(el("div", { class: "actions" }, [el("button", { class: "danger", onclick: () => { profile.families.splice(i, 1); state.preflight = null; render(); } }, ["Remove this grouping"])]));
    panel.append(wrap);
  }
  panel.append(
    el("div", { class: "actions" }, [
      el("button", { "data-testid": "add-family", onclick: () => { profile.families.push({ member: "", family: "", because: "" }); render(); } }, ["Add a grouping"]),
    ]),
  );
  return panel;
}

function actionsSection(): HTMLElement {
  const row = currentSource()!;
  const panel = el("section", { class: "panel", "data-testid": "actions" }, [text_("h2", "", "7. Check, save, approve, import")]);
  panel.append(field("Note on this version", el("input", { type: "text", value: state.profile!.note, oninput: (e) => { state.profile!.note = (e.target as HTMLInputElement).value; }, "data-testid": "profile-note" })));

  const buttons = el("div", { class: "actions" });
  buttons.append(
    el("button", {
      "data-testid": "check",
      ...(state.busy ? { disabled: true } : {}),
      onclick: () => send("preflight", { sourceId: state.sourceId, fileName: state.file!.name, text: state.file!.text, profile: state.profile }),
    }, ["Check this mapping"]),
  );
  buttons.append(
    el("button", {
      "data-testid": "save-profile",
      ...(state.busy ? { disabled: true } : {}),
      onclick: async () => {
        const reply = await send("saveProfile", { sourceId: state.sourceId, profile: state.profile });
        if (typeof reply.version === "number") { state.version = reply.version; render(); }
      },
    }, ["Save as a new version"]),
  );

  const unapproved = row.profiles.filter((p) => !p.approved);
  if (unapproved.length > 0) {
    buttons.append(el("input", { type: "text", value: state.approver, placeholder: "who approves", "data-testid": "approver", oninput: (e) => { state.approver = (e.target as HTMLInputElement).value; } }));
    buttons.append(
      el("button", {
        class: "primary",
        "data-testid": "approve-profile",
        ...(state.busy ? { disabled: true } : {}),
        onclick: () => send("approveProfile", { sourceId: state.sourceId, version: state.version ?? unapproved.at(-1)!.version, by: state.approver }),
      }, [`Approve v${state.version ?? unapproved.at(-1)!.version}`]),
    );
  }

  const approved = row.profiles.filter((p) => p.approved);
  if (approved.length > 0) {
    const latest = approved.at(-1)!.version;
    buttons.append(
      el("button", {
        class: "primary",
        "data-testid": "import",
        ...(state.busy ? { disabled: true } : {}),
        onclick: () => send("import", { sourceId: state.sourceId, version: latest, fileName: state.file!.name, text: state.file!.text }),
      }, [`Import drafts with v${latest}`]),
    );
  }
  panel.append(buttons);
  panel.append(text_("p", "note", "Checking writes nothing. Saving writes a version nobody has approved. Approving writes no records. Importing writes drafts, in ingestion/, which the site does not read."));
  return panel;
}

// ------------------------------------------------------------------- report

function coverageTable(report: Preflight): HTMLElement {
  const table = el("table", { "data-testid": "coverage" });
  table.append(el("tr", {}, [text_("th", "", "Filter"), text_("th", "", "Filled by"), text_("th", "", "Records with a value"), text_("th", "", "")]));
  for (const c of report.filterCoverage) {
    table.append(
      el("tr", { "data-testid": `coverage-${c.key}` }, [
        el("td", {}, [text_("strong", "", c.label), text_("p", "note", `${c.key} · ${c.kind}`)]),
        el("td", {}, [el("span", { class: `pill ${c.covered === "unmapped" ? "bad" : c.covered === "extracted" ? "warn" : "ok"}` }, [c.covered])]),
        text_("td", "", `${c.withValue} of ${c.of}`),
        text_("td", "note", c.note),
      ]),
    );
  }
  return table;
}

function planRow(plan: RecordPlan): HTMLElement {
  const row = el("div", { class: `row ${plan.action}`, "data-testid": `plan-${plan.id}` });
  const head = el("header", {}, [text_("strong", "", plan.name), el("span", { class: `pill ${plan.action === "conflict" || plan.action === "failed" ? "bad" : plan.action === "added" ? "ok" : "warn"}` }, [plan.action]), text_("span", "mono", plan.id)]);
  if (plan.shadowsCatalog) head.append(el("span", { class: "pill warn" }, ["shadows a catalogue record"]));
  row.append(head);
  row.append(text_("p", "note", `${plan.rows.length} ${plan.rows.length === 1 ? "row" : "rows"}, represented by row ${plan.representativeRow}. ${plan.groupNote}`));

  for (const failure of plan.failures) row.append(text_("p", "err", failure));
  for (const error of plan.valueErrors) row.append(text_("p", "err", `${error.field}: ${error.reason} (the file says ${JSON.stringify(error.raw)})`));

  const moved = plan.outcomes.filter((o) => o.outcome !== "unchanged");
  if (moved.length > 0) {
    const table = el("table");
    table.append(el("tr", {}, [text_("th", "", "Field"), text_("th", "", "What happened"), text_("th", "", "File says"), text_("th", "", "Record says"), text_("th", "", "Last import")]));
    for (const o of moved) {
      table.append(
        el("tr", { "data-testid": `outcome-${plan.id}-${o.key}` }, [
          el("td", {}, [text_("strong", "", o.label), text_("p", "note", OWNERSHIP_WORDS[o.ownership])]),
          el("td", {}, [el("span", { class: `pill ${o.outcome === "conflict" ? "bad" : o.outcome === "written" ? "ok" : "warn"}` }, [o.outcome]), text_("p", "note", o.why)]),
          text_("td", "mono", display(o.incoming)),
          text_("td", "mono", display(o.current)),
          text_("td", "mono", display(o.last)),
        ]),
      );
    }
    row.append(table);
  }
  if (plan.productDifferences.length > 0) row.append(text_("p", "note", `Record fields that would move: ${plan.productDifferences.join(", ")}.`));
  return row;
}

function display(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  return JSON.stringify(v);
}

function reportSection(): HTMLElement {
  const report = state.preflight!;
  const panel = el("section", { class: "panel", "data-testid": "preflight" }, [text_("h2", "", "What this mapping would do")]);

  panel.append(
    text_(
      "p",
      "",
      `${report.rows} rows, ${report.excluded.length} excluded, ${report.plans.length} records. ` +
        `${report.counts.added} to add, ${report.counts.changed} to change, ${report.counts.unchanged} unchanged, ` +
        `${report.counts.conflict} in conflict, ${report.counts.review} waiting on review, ${report.counts.failed} that cannot be built.`,
    ),
  );
  panel.append(
    el("p", { "data-testid": "comparison-counts" }, [
      `${report.sourceRecords} source records, ${report.comparisonFamilies.length} things a shopper chooses between. ` +
        `Every page stays a record with its own price, stock, pictures and link; the family layer decides how many of them are comparable models.`,
    ]),
  );
  const grouped = report.comparisonFamilies.filter((f) => f.members.length > 0);
  if (grouped.length > 0) {
    const table = el("table", { "data-testid": "families" });
    table.append(el("tr", {}, [text_("th", "", "Compared as"), text_("th", "", "Configurations of it"), text_("th", "", "Why")]));
    for (const family of grouped) {
      for (const member of family.members) {
        table.append(
          el("tr", { "data-testid": `family-${member.id}` }, [
            el("td", {}, [text_("strong", "", family.name), text_("p", "mono", family.id)]),
            el("td", {}, [text_("span", "", member.name), text_("p", "mono", member.id)]),
            text_("td", "note", member.because),
          ]),
        );
      }
    }
    panel.append(table);
  }
  panel.append(
    el("p", { class: "note", "data-testid": "staleness" }, [
      report.lastSuccessfulRefresh
        ? `Last successful refresh ${report.lastSuccessfulRefresh}${report.stalenessDays !== undefined ? `, ${report.stalenessDays} ${report.stalenessDays === 1 ? "day" : "days"} ago` : ""}.`
        : "This source has never been imported, so there is no record of what a previous import wrote.",
    ]),
  );

  for (const blocker of report.blockers) panel.append(text_("p", "err", blocker));
  for (const problem of report.problems) panel.append(text_("p", "err", `${problem.where}: ${problem.message}`));

  panel.append(text_("h3", "", "Filter coverage"), coverageTable(report));

  if (report.excluded.length > 0) {
    const table = el("table", { "data-testid": "excluded" });
    table.append(el("tr", {}, [text_("th", "", "Row"), text_("th", "", "Column"), text_("th", "", "Value"), text_("th", "", "Why")]));
    for (const e of report.excluded.slice(0, 50)) {
      table.append(el("tr", {}, [text_("td", "mono", String(e.row)), text_("td", "mono", e.column), text_("td", "mono", display(e.value)), text_("td", "note", e.reason)]));
    }
    panel.append(el("details", { "data-testid": "excluded-details" }, [el("summary", {}, [`${report.excluded.length} rows excluded`]), table]));
  }

  if (report.extractions.length > 0) {
    const list = el("div", { "data-testid": "extractions" });
    for (const x of report.extractions.slice(0, 40)) {
      const box = el("div", { class: "row" }, [
        el("header", {}, [text_("strong", "", x.key), el("span", { class: `pill ${x.reviewState === "approved" ? "ok" : x.reviewState === "refused" ? "bad" : "warn"}` }, [x.reviewState]), ...(x.confidence ? [el("span", { class: "pill" }, [x.confidence])] : [])]),
        text_("p", "note", `From "${x.column}" by ${x.pattern}`),
        text_("p", "mono", x.sourceText),
        text_("p", "", x.matchedText !== undefined ? `Matched: ${x.matchedText} → ${display(x.value)}` : "Matched nothing."),
      ]);
      for (const note of x.notes) box.append(text_("p", "note", note));
      list.append(box);
    }
    panel.append(el("details", {}, [el("summary", {}, [`${report.extractions.length} extraction results`]), list]));
  }

  if (report.valueErrors.length > 0) {
    const list = el("ul", { "data-testid": "value-errors" });
    for (const e of report.valueErrors.slice(0, 60)) list.append(el("li", {}, [`${e.id} · ${e.field}: ${e.reason}`]));
    panel.append(el("details", {}, [el("summary", {}, [`${report.valueErrors.length} values that could not be normalised`]), list]));
  }

  if (report.withdrawn.length > 0) {
    panel.append(text_("h3", "", "No longer in the file"));
    panel.append(text_("p", "note", `${report.withdrawn.join(", ")}. Reported and left alone: a partner dropping a line for a week is not this site deciding the product is gone.`));
  }

  panel.append(text_("h3", "", "Record by record"));
  for (const plan of report.plans) panel.append(planRow(plan));
  return panel;
}

function draftsSection(): HTMLElement {
  const server = state.server!;
  const panel = el("section", { class: "panel", "data-testid": "drafts" }, [text_("h2", "", `Drafts in the workspace (${server.drafts.length})`)]);
  panel.append(text_("p", "note", "These live in ingestion/drafts. The site does not read that directory, so nothing here is one query change away from being served. Promoting a draft into the catalogue is a separate decision with no button here."));

  for (const draft of server.drafts) {
    const box = el("div", { class: "row", "data-testid": `draft-${draft.id}` });
    box.append(
      el("header", {}, [
        text_("strong", "", draft.name),
        el("span", { class: "pill" }, [draft.status]),
        el("span", { class: "pill" }, [draft.quoteOnly ? "price on request" : draft.price !== null ? `$${(draft.price / 100).toLocaleString("en-US")}` : "no price"]),
        el("span", { class: "pill" }, [draft.availability]),
        text_("span", "mono", draft.id),
      ]),
    );
    if (state.edit?.id === draft.id) {
      const form = state.edit;
      box.append(field("Name", el("input", { type: "text", value: form.name, "data-testid": `edit-name-${draft.id}`, oninput: (e) => { form.name = (e.target as HTMLInputElement).value; } })));
      box.append(field("Description", el("textarea", { "data-testid": `edit-description-${draft.id}`, oninput: (e) => { form.description = (e.target as HTMLTextAreaElement).value; } }, [form.description])));
      box.append(
        el("div", { class: "actions" }, [
          el("button", {
            class: "primary",
            "data-testid": `save-edit-${draft.id}`,
            onclick: async () => {
              const reply = await send("edit", { id: draft.id, name: form.name, description: form.description, by: state.approver || "operator" });
              // The form stays until the save succeeds. A refused save that
              // emptied it would throw away the work and keep the mistake.
              if (reply.ok !== false) { state.edit = null; render(); }
            },
          }, ["Save this edit"]),
          el("button", { onclick: () => { state.edit = null; render(); } }, ["Cancel"]),
        ]),
      );
    } else {
      box.append(text_("p", "", draft.description.length > 300 ? `${draft.description.slice(0, 300)}…` : draft.description));
      if (draft.note) box.append(text_("p", "note", draft.note));
      const attrs = draft.attributes.filter((a) => a.value !== null);
      if (attrs.length > 0) box.append(text_("p", "note", `Attributes: ${attrs.map((a) => `${a.key}=${display(a.value)} (${a.verification})`).join(", ")}`));
      else box.append(text_("p", "note", "No attributes. Where a file states no specification, this record holds none."));
      box.append(
        el("div", { class: "actions" }, [
          el("button", { "data-testid": `edit-${draft.id}`, onclick: () => { state.edit = { id: draft.id, name: draft.name, description: draft.description }; render(); } }, ["Edit this listing"]),
        ]),
      );
    }
    panel.append(box);
  }
  return panel;
}


// -------------------------------------------------- promotion review (dry run)

const touchPlan = (): void => {
  // A report is about the choices that produced it. Keeping one on screen
  // beside changed choices is how somebody signs the plan they were not looking
  // at, so it is marked stale and worked out again.
  if (state.promotion.plan) state.promotion.stale = true;
  render();
};

function familyPicker(): HTMLElement {
  const promotion = state.promotion;
  const selectable = promotion.plan?.selectable ?? [];
  const panel = el("div", { class: "panel", "data-testid": "family-picker" });

  if (selectable.length === 0) {
    panel.append(text_("p", "note", "Press the button below once and the families in this workspace appear here to choose from."));
  }
  for (const family of selectable) {
    const row = el("div", { class: "row", "data-testid": `pick-${family.id}` });
    const box = el("input", {
      type: "checkbox",
      "data-testid": `pick-box-${family.id}`,
      ...(promotion.familyIds.includes(family.id) ? { checked: true } : {}),
      onchange: (e) => {
        const on = (e.target as HTMLInputElement).checked;
        promotion.familyIds = on ? [...promotion.familyIds, family.id] : promotion.familyIds.filter((id) => id !== family.id);
        touchPlan();
      },
    });
    const head = el("header", {}, [box, text_("strong", "", family.name), text_("span", "mono", family.id)]);
    if (family.shadowIds.length > 0) head.append(el("span", { class: "pill warn" }, [`${family.shadowIds.length} already in the catalogue`]));
    row.append(head);
    // Configurations are listed and are not selectable on their own. That is
    // the whole prevention: there is no control here that selects a blackout
    // finish without the model it is a finish of.
    row.append(
      text_(
        "p",
        "note",
        family.memberIds.length === 0
          ? "One record."
          : `Comes with ${family.memberIds.length} ${family.memberIds.length === 1 ? "configuration" : "configurations"}: ${family.memberIds.join(", ")}. A family is taken whole.`,
      ),
    );
    panel.append(row);
  }
  return panel;
}

function rightsForm(): HTMLElement {
  const form = state.promotion.rightsForm!;
  const box = el("div", { class: "panel", "data-testid": "rights-form" }, [
    text_("h3", "", `Permission for ${form.recordId}`),
    text_("p", "mono", form.src),
    text_("p", "note", "A feed carrying a picture is not permission to publish it. Record what you read, where it is, and what it covers."),
  ]);
  box.append(
    field(
      "This rests on",
      select(form.basis, (Object.keys(RIGHTS_BASIS_WORDS) as RightsBasis[]).map((b) => ({ value: b, label: RIGHTS_BASIS_WORDS[b] })), (v) => {
        form.basis = v as RightsBasis;
      }, { "data-testid": "rights-basis" }),
    ),
  );
  box.append(
    field(
      "What you read, and where it is",
      el("textarea", { "data-testid": "rights-evidence", oninput: (e) => { form.evidence = (e.target as HTMLTextAreaElement).value; } }, [form.evidence]),
      "At least a sentence, detailed enough that somebody else could check it.",
    ),
  );
  box.append(
    el("div", { class: "actions" }, [
      el("button", {
        class: "primary",
        "data-testid": "save-rights",
        onclick: async () => {
          const reply = await send("recordRights", { recordId: form.recordId, src: form.src, basis: form.basis, evidence: form.evidence, recordedBy: state.promotion.reviewer || "operator" });
          if (reply.ok !== false) {
            state.promotion.rightsForm = null;
            state.promotion.stale = true;
            render();
          }
        },
      }, ["Record this permission"]),
      el("button", { onclick: () => { state.promotion.rightsForm = null; render(); } }, ["Cancel"]),
    ]),
  );
  return box;
}

function recordCard(record: RecordReview): HTMLElement {
  const box = el("div", { class: "row", "data-testid": `review-${record.id}` });
  const head = el("header", {}, [
    text_("strong", "", record.name),
    el("span", { class: "pill" }, [record.role]),
    el("span", { class: "pill" }, [record.price.display]),
    el("span", { class: "pill" }, [record.availability]),
    text_("span", "mono", record.id),
  ]);
  if (record.shadowsCatalog) head.append(el("span", { class: "pill warn" }, ["already in the catalogue"]));
  box.append(head);
  box.append(text_("p", "note", `Price checked ${record.price.lastChecked}. Link ${record.link.url} (${record.link.affiliateStatus}${record.link.network ? `, ${record.link.network}` : ""}).`));
  box.append(text_("p", "note", `Provenance: ${record.provenance.kind}, ${record.provenance.method}${record.provenance.ref ? `, ${record.provenance.ref}` : ""}.`));

  const rights = el("p", { "data-testid": `rights-${record.id}` }, [
    el("span", { class: `pill ${record.image.state === "cleared" ? "ok" : "bad"}` }, [`image rights: ${record.image.state}`]),
  ]);
  box.append(rights, text_("p", "note", record.image.why));
  if (record.image.src && record.image.state !== "cleared") {
    box.append(
      el("div", { class: "actions" }, [
        el("button", {
          "data-testid": `record-rights-${record.id}`,
          onclick: () => {
            state.promotion.rightsForm = { recordId: record.id, src: record.image.src!, basis: "partner_terms_reviewed", evidence: "" };
            render();
          },
        }, ["Record a permission for this picture"]),
      ]),
    );
  }

  const mapped = record.comparison.filter((c) => c.state === "mapped");
  const missing = record.comparison.filter((c) => c.state === "missing");
  box.append(
    text_("p", "note", `Comparison fields present: ${mapped.map((c) => `${c.label} (${c.display})`).join(", ") || "none"}.`),
    text_("p", "note", `Missing: ${missing.map((c) => c.label).join(", ") || "none"}.`),
  );
  if (record.editorial.changes.length > 0) {
    box.append(text_("p", "note", `Changed here since the last import: ${record.editorial.changes.map((c) => c.label).join(", ")}.`));
  }
  for (const conflict of record.editorial.conflicts) {
    box.append(text_("p", "err", `Open conflict on ${conflict.label}: the file says ${display(conflict.incoming)}, this site says ${display(conflict.current)}.`));
  }
  return box;
}

function shadowCard(shadow: ShadowReview): HTMLElement {
  const held = state.promotion.shadows[shadow.id] ?? { choice: "unresolved" as ShadowChoice, fields: {}, note: "" };
  const box = el("div", { class: `row ${shadow.problems.length > 0 ? "conflict" : "added"}`, "data-testid": `shadow-${shadow.id}` });
  box.append(el("header", {}, [text_("strong", "", shadow.id), el("span", { class: `pill ${shadow.problems.length > 0 ? "bad" : "ok"}` }, [held.choice])]));
  box.append(text_("p", "note", `The catalogue holds "${shadow.diff.existingName}". The workspace holds "${shadow.diff.draftName}". Nothing is chosen for you.`));

  for (const choice of ["keep_existing", "replace_with_draft", "merge_fields"] as ShadowChoice[]) {
    const label = el("label", { style: "font-weight:400" });
    label.append(
      el("input", {
        type: "radio",
        name: `shadow-${shadow.id}`,
        "data-testid": `shadow-${shadow.id}-${choice}`,
        ...(held.choice === choice ? { checked: true } : {}),
        onchange: () => {
          state.promotion.shadows[shadow.id] = { ...held, choice };
          touchPlan();
        },
      }),
      document.createTextNode(` ${SHADOW_CHOICE_WORDS[choice]}`),
    );
    box.append(label);
  }

  const table = el("table", { "data-testid": `shadow-diff-${shadow.id}` });
  table.append(el("tr", {}, [text_("th", "", "Field"), text_("th", "", "Catalogue"), text_("th", "", "Workspace"), text_("th", "", "Take")]));
  for (const f of shadow.diff.fields) {
    const cell = el("td");
    if (f.locked) cell.append(el("span", { class: "pill" }, ["editorial, locked to the workspace"]));
    else if (f.same) cell.append(text_("span", "note", "same"));
    else if (held.choice === "merge_fields") {
      cell.append(
        select(held.fields[f.key] ?? "", [{ value: "", label: "— choose —" }, { value: "existing", label: "catalogue" }, { value: "draft", label: "workspace" }], (v) => {
          const fields = { ...held.fields };
          if (v === "") delete fields[f.key];
          else fields[f.key] = v as FieldSide;
          state.promotion.shadows[shadow.id] = { ...held, fields };
          touchPlan();
        }, { "data-testid": `shadow-field-${shadow.id}-${f.key}` }),
      );
    } else cell.append(text_("span", "note", held.choice === "keep_existing" ? "catalogue" : held.choice === "replace_with_draft" ? "workspace" : "—"));
    table.append(el("tr", {}, [text_("td", "", f.label), text_("td", "mono", display(f.existing)), text_("td", "mono", display(f.draft)), cell]));
  }
  box.append(table);

  if (shadow.outcome) {
    box.append(text_("p", "note", `This would keep the ${shadow.outcome.from === "existing" ? "catalogue record" : shadow.outcome.from === "draft" ? "workspace draft" : "merged record"}.`));
    if (shadow.outcome.discards.length > 0) box.append(text_("p", "note", `Given up: ${shadow.outcome.discards.map((d) => d.label).join(", ")}.`));
  }
  for (const problem of shadow.problems) box.append(text_("p", "err", problem.message));
  return box;
}

function promotionSection(): HTMLElement {
  const promotion = state.promotion;
  const panel = el("section", { class: "panel", "data-testid": "promotion" }, [
    text_("h2", "", "Promotion review (dry run)"),
    text_(
      "p",
      "note",
      "Works out what promoting some families into the catalogue would do, and writes none of it. Signing records a decision in ingestion/plans and performs no catalogue write. There is no command in this tool that carries a plan out.",
    ),
  ]);

  panel.append(familyPicker());
  panel.append(
    el("div", { class: "actions" }, [
      el("button", {
        class: "primary",
        "data-testid": "build-plan",
        ...(state.busy ? { disabled: true } : {}),
        onclick: async () => {
          const reply = await send("plan", {
            sourceId: state.sourceId,
            familyIds: promotion.familyIds,
            shadows: Object.entries(promotion.shadows).map(([id, r]) => ({ id, ...r })),
            reviewer: promotion.reviewer,
          });
          if (reply.ok !== false) {
            promotion.plan = reply.plan as PromotionPlan;
            promotion.stale = false;
            render();
          }
        },
      }, ["Work out what this would do"]),
    ]),
  );

  if (promotion.rightsForm) panel.append(rightsForm());
  if (promotion.stale) panel.append(text_("p", "err", "The choices have changed since this was worked out. Work it out again before signing."));

  const plan = promotion.plan;
  if (!plan) return panel;

  panel.append(
    el("p", { "data-testid": "promotion-counts" }, [
      `${plan.sourceRecords} source records, ${plan.comparisonFamilies} comparison families, ${plan.selectedFamilyIds.length} selected, ${plan.selectedRecordIds.length} records in the selection.`,
    ]),
  );
  panel.append(
    text_(
      "p",
      "note",
      `The catalogue afterwards, if this were ever carried out: ${plan.hypotheticalProducts} products, ${plan.hypotheticalFamilies} comparable models in this category. Read from ${plan.uploadFile ?? "no recorded file"} through mapping v${plan.profileVersion}.`,
    ),
  );

  if (plan.blockers.length > 0) {
    const list = el("ul", { "data-testid": "promotion-blockers" });
    for (const blocker of plan.blockers) list.append(el("li", { class: "err", "data-testid": `blocker-${blocker.code}` }, [`${blocker.code}: ${blocker.message}`]));
    panel.append(text_("h3", "", `${plan.blockers.length} unresolved`), list);
  } else {
    panel.append(text_("p", "note", "Nothing unresolved. Signing is still not promoting, and promoting is still not publishing."));
  }

  for (const family of plan.families) {
    panel.append(text_("h3", "", `${family.name} (${family.records.length} records)`));
    for (const record of family.records) panel.append(recordCard(record));
  }

  if (plan.shadows.length > 0) {
    panel.append(text_("h3", "", "Records the catalogue already holds"));
    for (const shadow of plan.shadows) panel.append(shadowCard(shadow));
  }

  for (const issue of plan.catalogueIssues) panel.append(text_("p", "err", `The catalogue this would produce: ${issue}`));
  for (const issue of plan.familyIntegrityIssues) panel.append(text_("p", "err", `Family integrity: ${issue}`));

  panel.append(text_("p", "mono", `Plan identifier: ${plan.planId}`));
  const actions = el("div", { class: "actions" });
  actions.append(el("input", { type: "text", value: promotion.reviewer, placeholder: "who signs this", "data-testid": "plan-reviewer", oninput: (e) => { promotion.reviewer = (e.target as HTMLInputElement).value; } }));
  actions.append(
    el("button", {
      class: "primary",
      "data-testid": "sign-plan",
      ...(plan.blockers.length > 0 || promotion.stale || state.busy ? { disabled: true } : {}),
      onclick: async () => {
        const reply = await send("sign", {
          sourceId: state.sourceId,
          familyIds: promotion.familyIds,
          shadows: Object.entries(promotion.shadows).map(([id, r]) => ({ id, ...r })),
          reviewer: promotion.reviewer,
        });
        if (reply.ok !== false) {
          promotion.document = typeof reply.document === "string" ? reply.document : null;
          promotion.plan = null;
          render();
        }
      },
    }, ["Sign this plan"]),
  );
  // Present, and it does nothing, because carrying a plan out is not in this
  // batch. A button that quietly was not there would read as an oversight.
  actions.append(el("button", { disabled: true, "data-testid": "execute-plan", title: "Out of scope" }, ["Carry this plan out — not built"]));
  panel.append(actions);
  panel.append(text_("p", "note", "Carrying a plan out would write to catalog/. No code in this project does that, and this button is here to say so rather than to hide it."));
  return panel;
}

function historySection(): HTMLElement {
  const plans = state.server?.plans ?? [];
  const panel = el("section", { class: "panel", "data-testid": "plan-history" }, [text_("h2", "", `Signed plans (${plans.length})`)]);
  panel.append(text_("p", "note", "A record of decisions, in ingestion/plans. Written once, never edited, and never touched by an import. None of them has been carried out."));
  if (state.promotion.document) {
    panel.append(el("pre", { "data-testid": "plan-document", class: "mono" }, [state.promotion.document]));
  }
  for (const row of plans) {
    const box = el("div", { class: "row", "data-testid": `plan-${row.planId}` });
    box.append(
      el("header", {}, [
        text_("strong", "", row.planId),
        el("span", { class: "pill" }, [`signed by ${row.signedBy} on ${row.signedOn}`]),
        el("span", { class: `pill ${row.stillCurrent ? "ok" : "warn"}` }, [row.stillCurrent ? "matches the current file" : "the workspace has moved on"]),
        el("span", { class: `pill ${row.selfConsistent ? "ok" : "bad"}` }, [row.selfConsistent ? "names itself" : "does not name itself"]),
        el("span", { class: "pill" }, [row.executed ? "carried out" : "not carried out"]),
      ]),
    );
    box.append(text_("p", "note", `${row.families} families, ${row.records} records, mapping v${row.profileVersion}, file ${row.uploadFile ?? "not recorded"}.`));
    box.append(el("details", {}, [el("summary", {}, ["Read the plan"]), el("pre", { class: "mono" }, [row.document])]));
    panel.append(box);
  }
  return panel;
}

// ------------------------------------------------------------------ drawing

function render(): void {
  root.replaceChildren();
  const message = messageBox();
  if (message) root.append(message);
  if (!state.server) {
    root.append(text_("p", "", "Loading…"));
    return;
  }
  root.append(sourceSection());
  if (state.sourceId !== "") root.append(fileSection());
  if (state.inspect && state.profile) {
    root.append(mappingSection(), attributeSection(), exclusionSection(), familySection(), actionsSection());
  }
  if (state.preflight) root.append(reportSection());
  root.append(draftsSection());
  if (state.sourceId !== "" && (state.server.drafts.length > 0 || (state.server.plans?.length ?? 0) > 0)) {
    root.append(promotionSection(), historySection());
  }
}

export function start(doc: Document): void {
  root = doc.getElementById("app")!;
  render();
  void send("state");
}
