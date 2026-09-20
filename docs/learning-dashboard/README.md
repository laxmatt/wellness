# What we have learned: the owner's dashboard

A private page for answering two questions: what have we learned, and what
should we improve next. It runs from a file on your own disk.

## How to open it

```
open docs/learning-dashboard/index.html
```

No server, no login, no install. One HTML file with its script inside it.

## What is on it

**Four questions with no figures.** How people find the site, which categories
and products they look at, where they get stuck, and how often they leave for a
merchant. Every one of them says "not connected" and shows what a figure would
be made of, because **nothing in this project records anything**. The typed
events in `src/domain/analytics.ts` describe what could be recorded and
`getAnalytics()` builds a provider that would write them to the console, but
nothing calls it. No event has ever been emitted and no store exists.

That is why those panels show no figure rather than a zero. A zero would say
nobody arrived, nobody clicked and nobody got stuck. Nobody knows any of those
things, because nobody counted.

**A register you can write in.** Observations, what you think they mean, what
should change, and what happened. This is the part with real content, because a
person writes it.

## The rules the register is built around

Each entry names where it came from, and two different things are shown about
that source. **Observed** is whether somebody actually looked at something.
**Measured** is whether an instrument counted it. Watching three people use the
site is observed and not measured, and both of those are true at once.

A sample size and a date range belong to anything somebody looked at: "3 of 5
people" on a Tuesday is evidence with a sample in it. Only reasoning, where
nothing was observed at all, is refused them, because there is nothing for a
sample to be a sample of.

An outcome can only be recorded once the status says the change was made or
dropped. A proposal is not a result.

A proposed change is optional. Writing down what you saw before you know what to
do about it is the most common and most useful thing to record, and demanding a
remedy first is a good way to lose the observation.

There is no score anywhere on the page. A count of notes says nothing about how
the site is doing, and a number that looked like it did would be the most
misleading thing this tool could produce.

## Where the notes live

In this browser, on this machine, under one key in local storage. That is
convenient and it is not a backup: clearing site data, another browser or another
machine all start empty.

**Save the register to a file** and keep that file.

Loading a file never changes anything on its own. It is read, checked, and shown
to you: how many entries it holds, how many are here now, and anything that was
wrong with it. Then you choose to add them to what is here or to replace what is
here, and replacing is only ever something you press. A file whose entries were
all rejected offers no replace button at all, because that would empty the
register.

An entry that does not validate is left out and named rather than quietly
repaired, because a backup that changes on the way back in is not one. The two
exceptions are a missing id and a repeated id: both are fields the tool writes
itself, both can be fixed without guessing at anything you wrote, and dropping
the entry would lose a note. They are given an id and the change is reported.

**If the saved notes cannot be read** the page says so, refuses to write
anything over them, and offers the raw text as a file so you can rescue it.
Nothing is overwritten until you say you have a copy.

The same holds when only *part* of them reads. The readable entries are shown,
because they are useful, but the stored text held more than that, so nothing is
written back until you decide. Saving an entry while that warning stands is
refused and says why. Only pressing "keep the readable ones" replaces what is
stored, and by then you have been told what will be lost and offered the raw
text to keep.

`example-register.json` in this folder is a saved file you can load to see it
work. Its entries are invented and marked.

## Examples

"Load example entries" adds three invented entries, tagged EXAMPLE, counted
apart from your own, and each one saying in its reference that it is not an
observation about this site. "Remove the examples" takes them away without
touching anything you wrote.

## What it never holds

- Anything a visitor typed, to the assistant or into a filter.
- Anything identifying a visitor: an address, a fingerprint, a stable id.
- A full referring URL with its query string.
- A purchase. This site cannot see purchases: there is no affiliate programme
  and no merchant reporting. A click-out is a click-out.
- Any secret or credential.

## What this is not

It is not a production admin page. There is no route and no authentication, and
that is deliberate: a local file cannot be left exposed. If this ever becomes a
page on the site, authentication has to be built first, and that work does not
exist.

It is not connected to Search Console or Bing Webmaster Tools. Neither account
exists. When one does, those rows stop saying "not connected" and the panels can
carry real figures with a date range and a sample beside them.

## Rebuilding it

```
npm run dashboard
```

Generated from `src/tools/learning-dashboard/` and bundling
`src/domain/learning/`, which is the same code the tests exercise. Committed so
that opening it needs no tooling. Do not edit it by hand.

Checks:

```
npx vitest run src/__tests__/learning-register.test.ts   # validation, persistence, summaries
npm run dashboard && npx tsx e2e/learning-dashboard.mts  # the page itself, in a browser
```
