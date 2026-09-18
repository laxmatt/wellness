# Mito Red Light MitoMIN 2.0: manufacturer page reading

| | |
| --- | --- |
| Product | `mito-mitomin-2` |
| Page | https://mitoredlight.com/products/mitomin |
| Read on | 2026-09-09, at 17:34 Pacific |
| Read by | Codex, using its own web tool, and supplied to this repository |
| Read by this repository | No. Nothing here fetched anything. |

## What the page stated

$249. Sixty LEDs at 660 nm and 850 nm in a 50:50 ratio, 85 W consumption.
12 by 9 by 3 in. Targeted coverage. A built-in tabletop kickstand with 180
degrees of adjustment. A 1 to 20 minute timer. Red, near-infrared and combined
modes. A full 2-year warranty and a 60-day returns headline. No Bluetooth and
no WiFi.

Two irradiance figures, and two weights that disagree.

## What was recorded

- **$249**, read. The record already carried $249 relayed; the amount has not
  changed and what it is worth has.
- **Dimensions 12 by 9 by 3 in**, read. The record had no panel dimensions at
  all: its footprint class was inferred from a reported treatment area standing
  in for them. The class is unchanged, "compact", and now rests on the panel.
- **Power 85 W**, read, a field this record did not have. Recorded as
  consumption, with the note saying so: what a panel draws is not what it
  emits, and this catalogue has been careful about that since the BON CHARGE
  reading.
- **Returns 60 days**, read from the headline, with the note recording that the
  detailed terms were not read. Conditions, restocking and who pays return
  shipping are unknown here.
- **Coverage "targeted"**, promoted from an editorial inference to a
  manufacturer statement, because the page describes it.
- **Wavelengths, LED count, kickstand, 2-year warranty**, confirmed on the
  page rather than relayed. The 50:50 ratio is in the note.

## The weight, two figures

The technical specifications say 7 lb and the specification table says 6 lb, on
the same page. Marked disputed: the value shown is 7 lb with the word beside
it, both figures are in the note, and the field is withheld from matching,
scoring and completeness. Same handling as the Ice Barrel 500's empty weight.

## The irradiance, two methods

The page gives more than 115 mW/cm2 at 6 in from a consumer-grade meter, and
more than 52 mW/cm2 at 6 in from what the maker describes as a laboratory
method. The page is explicit that the methods differ.

**No figure is recorded, and this is not a dispute.** A disputed value is one
quantity stated two ways. These are two measurements of the same panel by
different methods, both of which may be correct. This catalogue's
`irradiance_mw_cm2` holds one unqualified number and compares it against other
products' unqualified numbers. Putting either figure in it would assert a
comparability neither one has, and would put this panel's lab-method number
beside another product's consumer-method number as though they were the same
measurement.

So the field carries no value, `not_stated`, with both figures, both methods
and the 6 in distance in the note. The panel scores nothing on irradiance,
which is what it scored before this reading, when the field was simply absent.
The difference is that the absence is now documented.

**Nothing here read a report.** Neither figure comes with a document this
repository has seen, and the record does not say an independent test was read.
The maker describes a method; that is the maker describing a method.

**A page error, not a third figure.** A duplicated block on the mobile layout
labels the 52 as fluence, which is a different quantity in different units.
That is noted as an apparent page error and is not recorded as anything.

**What this suggests, and what was not built.** Four products now carry
irradiance figures whose methods and distances vary, and the field cannot say
so. A method dimension beside the number would fix it. That is architecture,
it is not this batch, and it is the kind of change that should follow a
decision rather than a reading.

## What was not recorded

**App control.** The page states outright: "There is no bluetooth or Wifi."
That is an explicit negative, not silence, and the record says so in those
terms. An earlier version of this file called it an absence of a claim, which
undersold what the page says. Corrected on 2026-09-10.

The field still carries no value, and the reason is narrower than the
correction. No Bluetooth and no WiFi is a statement about wireless
connectivity. `app_control` asks whether an app drives the panel, and a panel
could be driven over a cable, or ship with a companion app that does nothing to
the hardware. The page settles the wireless question and does not settle that
one. So the explicit negative is on record in its own words, the field stays
empty, and this panel answers neither an app-control filter nor a
no-app-control one.

**Pulsing.** Red, near-infrared and combined are mode selections, not pulsing.
Nothing was recorded for a field the page does not address.

**The timer.** The 1 to 20 minute range has no field in this category. It is in
the description rather than forced into one.

**Stock, images, health claims.** None verified.

## What it changed in the rankings

MitoMIN 2.0 goes from 10.7 to 17.9, entirely from the 60-day returns figure
this record did not have. It is seventh of eight in Red Light Therapy and holds
no badge, before or after. Nothing else in the category moved: it was already
eligible, so no normalization range changed.
