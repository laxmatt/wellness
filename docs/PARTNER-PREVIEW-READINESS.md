# Partner preview: what is left

The top sheet. Everything here points at a file that already holds the detail;
nothing is repeated. Two columns only: what Matt decides, and what we do once he
has. No research is proposed that has already failed.

## The state, in four numbers

- **20 products, 24 images, every one procedural placeholder.** No photograph on
  the site is real.
- **12 prototype attribute values across 8 products.** Half of them are on two
  records, Edge (4) and Infraredi (2).
- **4 records cannot name their own subject.** Detail in
  `LAUNCH-BLOCKING-CONFLICTS.md`.
- **The cases we have looked at behave honestly.** A withheld price shows no
  amount, an unconfirmed figure shows no value, and a product nobody can buy
  holds no badge. That is what the tests and the harness cover, not a survey of
  everything the site could do: four of the defects fixed in the last two days
  were found by review, after the work looked finished.

## 1. Images. The one that decides whether this is showable.

**Three** brands' terms have been read and all three require permission: Hooga
requires express written permission, Mito grants a personal non-commercial
licence only and directs other use to `info@mitoredlight.com`, Ice Barrel
requires written authorization. Renu's and LMNT's reads failed and AG1's was
never attempted, so **nothing is known about those three either way**. Full
matrix and citations: `docs/drafts/IMAGE-RIGHTS-MATRIX.md`.

An earlier version of this file said reading more terms pages would keep
returning no. Three refusals do not establish that, and some brands publish
press or affiliate asset packs precisely for this. What the three do establish
is narrower and still decisive: **for those three, permission has to be asked
for**, and no amount of further reading substitutes for asking.

So it is a decision, and the drafts for asking are written and waiting in
`docs/drafts/IMAGE-PERMISSION-EMAILS.md`:

| Option | What it costs | Owner |
| --- | --- | --- |
| **Ask.** One email per brand for showcase permission, starting with the Mito address their terms name. | Matt's time, and a wait. Some will say no. | **Matt** |
| **Commission or licence.** Stock or own photography for the products in the preview. | Money. | **Matt** |
| **Show the placeholders and say so.** Every one is already labelled "Demo image". | Nothing. It is honest and it looks like a prototype. | **Matt** |

The three emails are drafted, marked DO NOT SEND, with every blank named: the
site URL, the sender's details, how a demo would be shown, and the two recipient
addresses that are not on record. Two readings would supply those addresses.
Sending is Matt's, and only sending.

## 2. Configuration identity. The other credibility gap.

Four records, in priority order, with pages and exact questions in
`LAUNCH-BLOCKING-CONFLICTS.md`. All four need one reading each by Codex, and
three have already had an attempt fail, so none should be retried blind:

| Record | Blocked on | Attempt already made |
| --- | --- | --- |
| `plunge-original` | which variant the $6,790 is, and whether it heats | text extraction does not expose the selected variant; the `.json`/`.js` variant-list route is written up in `source-checks/2026-09-11-plunge-edge-reach-attempt.md` |
| `infraredi-flex-max` | which model this is; its price is the **Plus** price | product page returned an internal error 2026-09-11 |
| `the-cold-pod-88` | 85 or 88 gallons, one model or two | none |
| `joovv-solo-3` | which mounting the priced unit includes | buyer guide read; it answers a different question |

**Edge Theory Labs is closed out**, not open: the maker states it is out of
business, the record says so with a source, and the badge is withheld.

## 3. Matt's launch decisions, unchanged

Five, all in `LAUNCH-HANDOFF.md` §2 with the exact variable names: a domain, a
host, a privacy notice (four blanks in `docs/drafts/PRIVACY-DATA-INVENTORY.md`),
a contact route, and a retention window.

Only the retention window needs work from us afterwards, and it is a scheduled
delete.

## 4. What we can do without any of the above

Honestly, very little, and that is the point.

- **The preview itself runs now.** `npm run preview`, screenshots in
  `docs/preview/`, refreshed against every build.
- **Retention deletion**, the moment Matt names a window.
- **A contact page**, the moment he supplies an address.
- **Integrate any reading Codex supplies**, per record, same day.

No engineering task is currently **known** to block a partner preview. That is
not the same as none existing: every batch in this engagement has surfaced
defects nobody had listed, including a schema.org offer published for a maker
that had closed. The site is in a state worth showing; what it is most visibly
short of is photographs and four readings.

## What we should stop doing

Auditing the same ground. The catalogue's weak spots are written down in four
files with citations and dates, and another pass over those produces another
file rather than a better site.

Review of new work is a different thing and should continue: it is what caught
the closure claim generalised from a status flag, and the offer published to
search engines for a brand that had shut.
