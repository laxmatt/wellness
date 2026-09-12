/**
 * The inventory page: upload, read, edit, approve, hide.
 *
 * It holds no rules of its own. Every reading, every refusal and every write is
 * the server's, which is the domain code the tests exercise; this draws what
 * comes back and sends what the operator typed. When it says a figure answers
 * no filter, that is because the record says `demo`, not because this page
 * decided to write that sentence.
 *
 * Text from a supplier file reaches the page through `textContent` only. A
 * product name out of a CSV is somebody else's text, and this never treats it
 * as markup.
 */

import type { Draft } from "@/domain/import/draft";
import { DRINK_FIELDS } from "@/domain/import/fields";
import { SUPPORTED_CURRENCIES, SUPPORTED_UNITS } from "@/domain/import/values";
import { EDITABLE_FIGURES, type FigureEdit, type RecordEdit } from "@/domain/inventory/edit";
import { OPERATOR_HEADER } from "@/domain/inventory/local-request";

type Figure = { key: string; label: string; value: unknown; unit: string | null; verification: string; note: string | null };
type Offer = { priceMinor: number; currency: string; url: string; lastChecked: string; merchantId: string };
type Record_ = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  statusWords: string;
  brandId: string;
  sourceRef: string | null;
  skus: Record<string, string>;
  offer: Offer | null;
  figures: Figure[];
};
type Standing = { title: string; detail: string };
type Refusal = { row: number; label: string; reasons: string[] };
type Preview = {
  fileName: string;
  headers: string[];
  delimiter: string;
  notes: string[];
  truncated: number;
  mapping: { columns: Record<string, string>; currency?: string; units?: Record<string, string>; servingsBasis?: boolean };
  unmapped: string[];
  drafts: Draft[];
  missingRequired: string[];
  totals: { rows: number; clean: number; withChecks: number; withBlockers: number };
  staged: { fatal: string[]; refusals: Refusal[]; records: { row: number; id: string; name: string; alreadyStaged: boolean }[]; merchantId: string | null } | null;
};

/**
 * What the operator has typed into the edit form, held here rather than in the
 * inputs.
 *
 * The form used to read its values from the saved record on every draw, and the
 * page redraws whenever a command is sent. So a refused save, or a tool that
 * could not be reached, put the saved values back into the boxes and threw away
 * everything the operator had typed, including the parts that were fine. The
 * draft lives until a save succeeds or the operator presses Cancel.
 */
type EditDraft = {
  id: string;
  name: string;
  description: string;
  offer: { price: string; url: string; lastChecked: string } | null;
  figures: { key: string; raw: string; basis: boolean }[];
};

type State = {
  records: Record_[];
  storefront: string;
  standingReview: Standing[];
  message: { text: string; bad: boolean; details: string[] } | null;
  file: { name: string; text: string } | null;
  supplier: string;
  pricedOn: string;
  currency: string;
  units: Record<string, string>;
  servingsBasis: boolean;
  columns: Record<string, string> | null;
  replace: boolean;
  preview: Preview | null;
  draft: EditDraft | null;
  fieldErrors: { field: string; message: string }[];
  busy: boolean;
};

const WITHHELD =
  "Every figure here is demo data or is not stated, so none of it answers a filter, ranks the product or reaches the assistant. That is what a figure from an invented file is worth. A figure becomes a fact when somebody records where it came from.";

const VERIFICATION_WORDS: Record<string, string> = {
  demo: "Demo data: invented, answers no filter",
  not_stated: "Not stated: the file was read and says nothing here",
  unknown: "Unverified",
  manufacturer_reported: "Maker reported",
  independently_verified: "Verified",
};

const state: State = {
  records: [],
  storefront: "",
  standingReview: [],
  message: null,
  file: null,
  supplier: "",
  pricedOn: new Date().toISOString().slice(0, 10),
  currency: "",
  units: {},
  servingsBasis: false,
  columns: null,
  replace: false,
  preview: null,
  draft: null,
  fieldErrors: [],
  busy: false,
};

let root: HTMLElement;
let doc: Document;

// ------------------------------------------------------------------ plumbing

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: { class?: string; text?: string; type?: string; value?: string; href?: string; placeholder?: string; checked?: boolean; disabled?: boolean } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (attrs.class) node.className = attrs.class;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.type && "type" in node) (node as HTMLInputElement).type = attrs.type;
  if (attrs.value !== undefined && "value" in node) (node as HTMLInputElement).value = attrs.value;
  if (attrs.href && "href" in node) (node as HTMLAnchorElement).href = attrs.href;
  if (attrs.placeholder && "placeholder" in node) (node as HTMLInputElement).placeholder = attrs.placeholder;
  if (attrs.checked !== undefined && "checked" in node) (node as HTMLInputElement).checked = attrs.checked;
  if (attrs.disabled !== undefined && "disabled" in node) (node as HTMLButtonElement).disabled = attrs.disabled;
  for (const child of children) node.append(child);
  return node;
}

/** Stable hooks for the browser check, so a test names a field rather than counting boxes. */
function mark<T extends HTMLElement>(node: T, data: Record<string, string>): T {
  for (const [key, value] of Object.entries(data)) node.dataset[key] = value;
  return node;
}

function button(text: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = el("button", { text, class: cls, disabled: state.busy });
  b.addEventListener("click", onClick);
  return b;
}

async function api(command: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", [OPERATOR_HEADER]: "1" },
    // Never anything but this page's own origin, and never a redirect.
    credentials: "omit",
    redirect: "error",
    body: JSON.stringify({ command, ...payload }),
  });
  return (await response.json()) as Record<string, unknown>;
}

/** Every command lands here, so a reply is read one way and the page redraws once. */
async function send(command: string, payload: Record<string, unknown> = {}, onOk?: (reply: Record<string, unknown>) => void): Promise<void> {
  state.busy = true;
  render();
  let reply: Record<string, unknown>;
  try {
    reply = await api(command, payload);
  } catch (e) {
    state.busy = false;
    state.message = { text: e instanceof Error ? e.message : "The tool could not be reached.", bad: true, details: [] };
    render();
    return;
  }
  state.busy = false;
  state.fieldErrors = (reply.fieldErrors as State["fieldErrors"]) ?? [];

  if (reply.ok !== true) {
    const errors = (reply.errors as string[]) ?? ["Refused."];
    const refusals = (reply.refusals as Refusal[]) ?? [];
    state.message = {
      text: errors[0],
      bad: true,
      details: [...errors.slice(1), ...refusals.flatMap((r) => r.reasons.map((x) => `Row ${r.row} (${r.label}): ${x}`))],
    };
    render();
    return;
  }

  if (Array.isArray(reply.records)) state.records = reply.records as Record_[];
  if (Array.isArray(reply.standingReview)) state.standingReview = reply.standingReview as Standing[];
  if (typeof reply.storefront === "string") state.storefront = reply.storefront;
  if (typeof reply.message === "string") {
    const refusals = (reply.refusals as Refusal[]) ?? [];
    state.message = { text: reply.message, bad: false, details: refusals.flatMap((r) => r.reasons.map((x) => `Row ${r.row} (${r.label}) was not staged: ${x}`)) };
  }
  onOk?.(reply);
  render();
}

const refresh = () => send("state");

/**
 * The answers that belong to one file, and nothing else.
 *
 * A unit, a currency, whether one packed item is one serving, and consent to
 * replace what is already staged are all statements about the file in front of
 * you. Carrying them to the next file means the second supplier's bare numbers
 * quietly take the first supplier's unit, and a tick that meant "replace these
 * five" silently means "replace those five". Who supplied the file and the date
 * the prices were current stay in their boxes, where they can be seen and
 * changed.
 */
function clearFileInterpretation(): void {
  state.columns = null;
  state.preview = null;
  state.currency = "";
  state.units = {};
  state.servingsBasis = false;
  state.replace = false;
}

async function preview(): Promise<void> {
  if (!state.file) return;
  await send(
    "preview",
    {
      fileName: state.file.name,
      text: state.file.text,
      mapping: state.columns ?? undefined,
      currency: state.currency || undefined,
      units: state.units,
      servingsBasis: state.servingsBasis,
      supplierName: state.supplier,
      pricedOn: state.pricedOn,
    },
    (reply) => {
      state.preview = reply as unknown as Preview;
      state.columns = (reply as unknown as Preview).mapping.columns;
      state.message = null;
    },
  );
}

// ------------------------------------------------------------------- drawing

function render(): void {
  root.replaceChildren();
  if (state.message) root.append(messagePanel(state.message));
  root.append(uploadSection());
  if (state.preview) root.append(previewSection(state.preview));
  root.append(recordsSection());
  root.append(standingSection());
}

function messagePanel(message: NonNullable<State["message"]>): HTMLElement {
  const panel = el("div", { class: `status ${message.bad ? "bad" : "ok"}` }, [el("p", { text: message.text })]);
  if (message.details.length > 0) {
    panel.append(el("ul", {}, message.details.map((d) => el("li", { text: d }))));
  }
  return panel;
}

const DEMO_CSV = "sku,product_name,brand,category,function,sugar_g,caffeine_mg,unit_price_usd,servings_per_pack,source_url\nNW-1001,\"Citrus Salt Sticks, 30 pack\",Northwind Hydration,wellness-drinks,electrolytes,0,0,45.00,30,https://example.invalid/northwind/citrus-salt\nNW-1002,\"Berry Sparkling Energy, 12 cans\",Northwind Hydration,wellness-drinks,energy,0,200,16.12,12,https://example.invalid/northwind/berry-sparkling\nNW-1003,\"Daily Greens Scoop, 30 servings\n(new formula)\",Northwind Hydration,wellness-drinks,greens,1,,99.00,30,https://example.invalid/northwind/daily-greens\nNW-1004,\"Lemon Hydration Sticks, 16 pack\",Northwind Hydration,wellness-drinks,\"electrolytes|hydration\",11,,24.99,16,https://example.invalid/northwind/lemon-hydration\nNW-1005,\"Root Beer Prebiotic, 12 cans\",Northwind Hydration,wellness-drinks,prebiotic,3,,35.99,12,https://example.invalid/northwind/root-beer\n";

function uploadSection(): HTMLElement {
  const section = el("section", {}, [el("h2", { text: "1. Add from a supplier file" })]);
  const panel = el("div", { class: "panel" });

  const file = mark(el("input", { type: "file" }), { control: "file" });
  file.setAttribute("accept", ".csv,.tsv,.txt,text/csv,text/plain");
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    const text = await chosen.text();
    clearFileInterpretation();
    state.file = { name: chosen.name, text };
    state.message = null;
    await preview();
  });

  const supplier = mark(el("input", { type: "text", value: state.supplier, placeholder: "Who supplied this file" }), { field: "supplier" });
  supplier.addEventListener("change", () => {
    state.supplier = supplier.value;
    void preview();
  });

  const priced = mark(el("input", { type: "date", value: state.pricedOn }), { field: "pricedOn" });
  priced.addEventListener("change", () => {
    state.pricedOn = priced.value;
    void preview();
  });

  panel.append(
    el("div", { class: "fields" }, [
      el("div", {}, [
        el("label", { text: "Supplier file (CSV or TSV)" }),
        file,
        mark(el("p", { class: "note", text: state.file ? `Reading ${state.file.name}.` : "Nothing chosen yet." }), { control: "fileName" }),
        el("p", {
          class: "note",
          text: "Choosing another file clears the units, the currency and the servings answer you gave for this one, and any consent to replace what is already staged. They are statements about one file.",
        }),
      ]),
      el("div", {}, [el("label", { text: "Supplied by" }), supplier, el("p", { class: "note", text: "A price belongs to a named merchant. The file rarely says which." })]),
      el("div", {}, [
        el("label", { text: "These prices were current on" }),
        priced,
        el("p", { class: "note", text: "The date you state, not the date you downloaded the file." }),
      ]),
    ]),
  );
  panel.prepend(el("p", { class: "note", text: "No supplier file yet? Try five fictional drinks. Loading the demo only previews them; you choose what to stage and approve." }), button("Try demo inventory", () => {
    clearFileInterpretation();
    state.file = { name: "supplier-a-northwind-SYNTHETIC.csv", text: DEMO_CSV };
    state.supplier = "Northwind Hydration (fictional demo)";
    state.pricedOn = "";
    state.message = null;
    void preview();
  }));
  section.append(panel);
  if (state.file) section.append(mappingPanel());
  return section;
}

function mappingPanel(): HTMLElement {
  const p = state.preview;
  const panel = el("div", { class: "panel" }, [el("h3", { text: "Which column means what" })]);
  if (!p) return panel;

  const notes = [...p.notes];
  if (p.truncated > 0) notes.push(`${p.truncated} rows past the row limit were not read.`);
  if (p.unmapped.length > 0) notes.push(`Columns nothing recognised, left unread: ${p.unmapped.join(", ")}.`);
  if (p.missingRequired.length > 0) notes.push(`No column fills ${p.missingRequired.join(", ")}, and a record cannot be built without it.`);
  for (const note of notes) panel.append(el("p", { class: "note", text: note }));

  const grid = el("div", { class: "grid" });
  for (const field of DRINK_FIELDS) {
    const row = el("div", { class: "panel" }, [el("label", { text: `${field.label}${field.required ? " (required)" : ""}` })]);
    const select = mark(doc.createElement("select"), { control: `column.${field.key}` });
    select.append(el("option", { value: "", text: "not mapped" }));
    for (const header of p.headers) {
      const option = el("option", { value: header, text: header });
      if (state.columns?.[field.key] === header) option.selected = true;
      select.append(option);
    }
    select.addEventListener("change", () => {
      const columns = { ...(state.columns ?? {}) };
      if (select.value === "") delete columns[field.key];
      else columns[field.key] = select.value;
      state.columns = columns;
      void preview();
    });
    row.append(select);

    if (field.kind === "measure") {
      const unit = mark(doc.createElement("select"), { control: `unit.${field.key}` });
      unit.append(el("option", { value: "", text: "unit: whatever the file states" }));
      for (const u of SUPPORTED_UNITS) {
        const option = el("option", { value: u, text: `unit: ${u}` });
        if (state.units[field.key] === u) option.selected = true;
        unit.append(option);
      }
      unit.addEventListener("change", () => {
        state.units = { ...state.units, [field.key]: unit.value };
        void preview();
      });
      row.append(unit);
    }
    if (field.kind === "money") {
      const currency = mark(doc.createElement("select"), { control: "currency" });
      currency.append(el("option", { value: "", text: "currency: whatever the file states" }));
      for (const c of SUPPORTED_CURRENCIES) {
        const option = el("option", { value: c, text: `currency: ${c}` });
        if (state.currency === c) option.selected = true;
        currency.append(option);
      }
      currency.addEventListener("change", () => {
        state.currency = currency.value;
        void preview();
      });
      row.append(currency);
    }
    if (field.kind === "count") {
      const label = el("label", { class: "note" });
      const box = mark(el("input", { type: "checkbox", checked: state.servingsBasis }), { control: "basis" });
      box.addEventListener("change", () => {
        state.servingsBasis = box.checked;
        void preview();
      });
      label.append(box, doc.createTextNode(" one item in a pack is one serving"));
      row.append(label);
    }
    row.append(el("p", { class: "note", text: field.review }));
    grid.append(row);
  }
  panel.append(grid);
  return panel;
}

function previewSection(p: Preview): HTMLElement {
  const section = el("section", {}, [el("h2", { text: "2. What the file says, row by row" })]);
  section.append(
    el("p", {
      class: "note",
      text: `${p.totals.rows} rows read: ${p.totals.clean} with nothing flagged, ${p.totals.withChecks} with something to check, ${p.totals.withBlockers} that cannot be read.`,
    }),
  );

  const refusedRows = new Map((p.staged?.refusals ?? []).map((r) => [r.row, r]));
  const stagedRows = new Map((p.staged?.records ?? []).map((r) => [r.row, r]));

  for (const draft of p.drafts) section.append(draftPanel(draft, refusedRows.get(draft.row), stagedRows.get(draft.row)));

  if (p.staged && p.staged.fatal.length > 0) {
    section.append(el("div", { class: "status bad" }, [el("p", { text: p.staged.fatal.join(" ") })]));
  }

  const ready = (p.staged?.records ?? []).length;
  const clashes = (p.staged?.records ?? []).filter((r) => r.alreadyStaged).length;
  const actions = el("div", { class: "actions" });
  if (clashes > 0) {
    const label = el("label", { class: "note" });
    const box = mark(el("input", { type: "checkbox", checked: state.replace }), { control: "replace" });
    box.addEventListener("change", () => {
      state.replace = box.checked;
    });
    label.append(box, doc.createTextNode(` replace the ${clashes} already staged (this resets an approved record to a draft and drops any edits)`));
    actions.append(label);
  }
  actions.append(
    button(
      ready === 0 ? "Nothing can be staged" : `Stage ${ready} draft${ready === 1 ? "" : "s"}`,
      () => {
        if (!state.file) return;
        void send(
          "stage",
          {
            fileName: state.file.name,
            text: state.file.text,
            mapping: state.columns ?? undefined,
            currency: state.currency || undefined,
            units: state.units,
            servingsBasis: state.servingsBasis,
            supplierName: state.supplier,
            pricedOn: state.pricedOn,
            replace: state.replace,
          },
          () => {
            clearFileInterpretation();
            state.file = null;
          },
        );
      },
      "primary",
    ),
  );
  if (ready === 0) (actions.lastChild as HTMLButtonElement).disabled = true;
  section.append(actions);
  section.append(el("p", { class: "note", text: "Staging writes drafts. A draft is not in the storefront until you approve it." }));
  return section;
}

function draftPanel(draft: Draft, refusal: Refusal | undefined, staged: { id: string } | undefined): HTMLElement {
  const kind = refusal ? "blocked" : draft.checks > 0 ? "checks" : "clean";
  const panel = el("div", { class: `draft ${kind}` }, [
    el("header", {}, [el("h3", { text: draft.label }), el("span", { class: "id", text: `row ${draft.row}` }), el("span", { class: "id", text: staged ? staged.id : "not staged" })]),
  ]);

  const table = el("table", {}, [el("tr", {}, [el("th", { text: "Field" }), el("th", { text: "In the file" }), el("th", { text: "Read as" })])]);
  for (const field of draft.fields) {
    const row = el("tr", {}, [
      el("td", { class: "k", text: field.field.label }),
      el("td", { class: "raw", text: field.raw === "" ? "(empty)" : field.raw }),
      el("td", { class: "val", text: field.value ? JSON.stringify("value" in field.value ? field.value.value : field.value) : "not read" }),
    ]);
    table.append(row);
    for (const flag of field.flags) {
      table.append(el("tr", {}, [el("td", {}), el("td", { class: `flag ${flag.severity}`, text: flag.message }), el("td", {})]));
    }
  }
  panel.append(table);

  if (refusal) {
    panel.append(el("p", { class: "flag blocker", text: "This row cannot become a record:" }));
    panel.append(el("ul", {}, refusal.reasons.map((r) => el("li", { class: "flag blocker", text: r }))));
  }
  return panel;
}

// ------------------------------------------------------------------- records

function recordsSection(): HTMLElement {
  const section = el("section", {}, [el("h2", { text: "3. Staged records" })]);
  if (state.records.length === 0) {
    section.append(el("p", { class: "note", text: "Nothing is staged yet." }));
    return section;
  }
  const published = state.records.filter((r) => r.status === "published").length;
  section.append(el("p", { class: "note", text: `${state.records.length} staged, ${published} in the storefront.` }));
  section.append(el("p", { class: "note", text: WITHHELD }));
  for (const record of state.records) section.append(state.draft?.id === record.id ? editForm(record, state.draft) : recordPanel(record));
  return section;
}

function recordPanel(record: Record_): HTMLElement {
  const panel = mark(el("div", { class: `record ${record.status}` }, [
    el("header", {}, [el("h3", { text: record.name }), el("span", { class: "pill", text: record.statusWords })]),
    el("p", { class: "id", text: record.id }),
  ]), { record: record.id, status: record.status });

  if (record.offer) {
    panel.append(
      el("p", { class: "meta", text: `${(record.offer.priceMinor / 100).toFixed(2)} ${record.offer.currency} at ${record.offer.merchantId}, stated current on ${record.offer.lastChecked}` }),
    );
    panel.append(el("p", { class: "meta" }, [el("a", { href: record.offer.url, text: record.offer.url })]));
  }
  const sku = Object.entries(record.skus)[0];
  if (sku) panel.append(el("p", { class: "meta", text: `supplier code ${sku[1]} at ${sku[0]}, which is not this record's id` }));
  if (record.sourceRef) panel.append(el("p", { class: "meta", text: record.sourceRef }));

  const table = el("table", {}, [el("tr", {}, [el("th", { text: "Figure" }), el("th", { text: "Value" }), el("th", { text: "What it is worth" })])]);
  for (const figure of record.figures) {
    table.append(
      el("tr", {}, [
        el("td", { class: "k", text: figure.label }),
        el("td", { class: "val", text: figure.value === null ? "nothing stated" : `${JSON.stringify(figure.value)}${figure.unit ? ` ${figure.unit}` : ""}` }),
        el("td", {}, [el("span", { class: `pill ${figure.verification}`, text: VERIFICATION_WORDS[figure.verification] ?? figure.verification })]),
      ]),
    );
  }
  panel.append(table);

  const actions = el("div", { class: "actions" });
  actions.append(
    button("Edit", () => {
      state.draft = draftFrom(record);
      state.fieldErrors = [];
      state.message = null;
      render();
    }),
  );
  if (record.status === "draft" || record.status === "hidden") actions.append(button("Approve", () => void send("status", { id: record.id, action: "approve" }), "primary"));
  if (record.status === "published") actions.append(button("Hide", () => void send("status", { id: record.id, action: "hide" })));
  if (record.status === "hidden") actions.append(button("Unhide", () => void send("status", { id: record.id, action: "unhide" })));
  if (record.status === "published" && state.storefront !== "") {
    actions.append(el("a", { href: `${state.storefront}/products/${record.slug}`, text: "Open in the storefront" }));
  }
  actions.append(
    button(
      "Remove",
      () => {
        if (window.confirm(`Remove ${record.name} from the preview catalogue? Nothing in catalog/ is touched.`)) void send("remove", { id: record.id });
      },
      "danger",
    ),
  );
  panel.append(actions);
  return panel;
}

function errorsFor(field: string): HTMLElement[] {
  return state.fieldErrors.filter((e) => e.field === field).map((e) => mark(el("p", { class: "err", text: e.message }), { error: field }));
}

/** The form's starting values, taken from the record once and then owned by the operator. */
function draftFrom(record: Record_): EditDraft {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    offer: record.offer ? { price: (record.offer.priceMinor / 100).toFixed(2), url: record.offer.url, lastChecked: record.offer.lastChecked } : null,
    figures: EDITABLE_FIGURES.filter((key) => record.figures.some((f) => f.key === key)).map((key) => {
      const figure = record.figures.find((f) => f.key === key)!;
      const raw = figure.value === null ? "" : Array.isArray(figure.value) ? (figure.value as string[]).join("|") : String(figure.value);
      return { key, raw, basis: false };
    }),
  };
}

/** Every box writes straight back into the draft, so a redraw cannot lose it. */
function bind(input: HTMLInputElement | HTMLTextAreaElement, read: (value: string) => void): void {
  input.addEventListener("input", () => read(input.value));
  input.addEventListener("change", () => read(input.value));
}

function editForm(record: Record_, draft: EditDraft): HTMLElement {
  const panel = mark(el("div", { class: `record ${record.status}` }, [el("header", {}, [el("h3", { text: `Editing ${record.name}` })]), el("p", { class: "id", text: record.id })]), {
    record: record.id,
    editing: "true",
  });

  const name = mark(el("input", { type: "text", value: draft.name }), { field: "name" });
  bind(name, (v) => {
    draft.name = v;
  });
  const description = doc.createElement("textarea");
  description.dataset.field = "description";
  description.value = draft.description;
  bind(description, (v) => {
    draft.description = v;
  });

  panel.append(el("div", {}, [el("label", { text: "Name" }), name, ...errorsFor("name")]));
  panel.append(el("div", {}, [el("label", { text: "Description" }), description, ...errorsFor("description")]));

  if (record.offer && draft.offer) {
    const offer = draft.offer;
    const price = mark(el("input", { type: "text", value: offer.price }), { field: "offer.price" });
    const url = mark(el("input", { type: "text", value: offer.url }), { field: "offer.url" });
    const checked = mark(el("input", { type: "date", value: offer.lastChecked }), { field: "offer.lastChecked" });
    bind(price, (v) => {
      offer.price = v;
    });
    bind(url, (v) => {
      offer.url = v;
    });
    bind(checked, (v) => {
      offer.lastChecked = v;
    });
    panel.append(
      el("div", { class: "fields" }, [
        el("div", {}, [el("label", { text: `Price (${record.offer.currency})` }), price, ...errorsFor("offer.price")]),
        el("div", {}, [el("label", { text: "Store link" }), url, ...errorsFor("offer.url")]),
        el("div", {}, [el("label", { text: "Stated current on" }), checked, ...errorsFor("offer.lastChecked")]),
      ]),
    );
  }

  const figures = el("div", { class: "fields" });
  for (const entry of draft.figures) {
    const figure = record.figures.find((f) => f.key === entry.key);
    if (!figure) continue;
    const field = DRINK_FIELDS.find((f) => f.key === entry.key);
    const input = mark(el("input", { type: "text", value: entry.raw, placeholder: "empty means the source does not state this" }), { field: entry.key });
    bind(input, (v) => {
      entry.raw = v;
    });
    const wrap = el("div", {}, [el("label", { text: `${figure.label}${field?.unit ? ` (${field.unit})` : ""}` }), input]);
    if (field?.kind === "count") {
      const basis = mark(el("input", { type: "checkbox", checked: entry.basis }), { field: `${entry.key}.basis` });
      basis.addEventListener("change", () => {
        entry.basis = basis.checked;
      });
      const label = el("label", { class: "note" });
      label.append(basis, doc.createTextNode(" one packed item is one serving"));
      wrap.append(label);
    }
    wrap.append(el("p", { class: "note", text: VERIFICATION_WORDS[figure.verification] ?? figure.verification }));
    for (const e of errorsFor(entry.key)) wrap.append(e);
    figures.append(wrap);
  }
  panel.append(el("label", { text: "Figures" }), figures);
  panel.append(el("p", { class: "note", text: "Changing a figure does not make it evidence. It stays demo data and its note records that you changed it." }));

  const actions = el("div", { class: "actions" });
  actions.append(
    button(
      "Save",
      () => {
        const edit: RecordEdit = { name: draft.name, description: draft.description };
        if (draft.offer) edit.offer = { ...draft.offer };
        edit.figures = draft.figures.map(({ key, raw, basis }): FigureEdit => ({ key, raw, servingsBasis: basis }));
        void send("edit", { id: record.id, edit }, (reply) => {
          // Only a save that landed may throw the typed values away.
          if (reply.ok === true) state.draft = null;
        });
      },
      "primary",
    ),
  );
  actions.append(
    button("Cancel", () => {
      state.draft = null;
      state.fieldErrors = [];
      state.message = null;
      render();
    }),
  );
  panel.append(actions);
  return panel;
}

function standingSection(): HTMLElement {
  const section = el("section", {}, [el("h2", { text: "What no file settles" })]);
  section.append(el("p", { class: "note", text: "These do not clear, however clean a file is. They are decisions, and this tool makes none of them." }));
  const list = doc.createElement("ol");
  for (const item of state.standingReview) list.append(el("li", {}, [el("strong", { text: item.title }), el("p", { class: "note", text: item.detail })]));
  section.append(list);
  return section;
}

export function start(document_: Document): void {
  doc = document_;
  const found = doc.getElementById("app");
  if (!found) throw new Error("No #app to draw into.");
  root = found;
  render();
  void refresh();
}
