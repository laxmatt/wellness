# Where the 12 prototype values actually surface

Traced 2026-09-10 against the current records and a served production build.
**No defect found, so nothing was changed.**

## The 12

| Product | Keys | Category |
| --- | --- | --- |
| Edge Tub Elite | sanitation_system, sanitation_methods, placement, plumbing | Cold plunge |
| Infraredi Flex Max | coverage, footprint | Red light |
| PlatinumLED BIOMAX 900 | wavelengths_nm | Red light |
| Ice Barrel 400 | placement | Cold plunge |
| The Cold Pod | placement | Cold plunge |
| AG1 | dietary | Drinks |
| CELSIUS | sweeteners | Drinks |
| LMNT | sweeteners | Drinks |

## Every surface, traced

| Surface | What happens | Shopper impact |
| --- | --- | --- |
| `ProductView.attributes` | All 12 withheld | None can be matched or scored on |
| Filter chips | No chip matches any product on a prototype value, checked across all three categories | A filter never returns a product on invented evidence |
| Facet pages | Cold plunge `indoor` returns Renu and Plunge only, excluding all three products whose `placement` is prototype | Same |
| Scores | `coverage` (Infraredi) and `sanitation_system` (Edge) are scored criteria; both appear in `demoCriteria` and contribute zero | A prototype value cannot raise a score |
| Product card | Value shown with a "Demo data" tag beside it. Verified in served HTML: Infraredi's card reads "Coverage / Full body / Demo data" | Visible and labelled |
| PDP spec row | Same tag, same component | Visible and labelled |
| Compare table | Value shown with `verification: demo`, and `best: false` on every one | Never wins a row |
| Insight lines | None fires on a prototype value. Edge shows no filtration line despite a prototype `sanitation_system: true` | No "why" or "tradeoff" rests on one |
| Structured data | Product JSON-LD carries name, brand, description, url and offers only. No attribute reaches it | Nothing invented is published to a search engine |
| Assistant grounding | Reads `ProductView.attributes`, so all 12 are absent | The model is never told a prototype value |

## Prototype is not the same as relayed

A distinction the site already draws and this audit keeps:

- **Prototype (`demo`)**: a value this project made up to fill a shape. Withheld
  from every decision, shown with a tag. 12 values, 8 products.
- **Manufacturer-reported and relayed (`secondhand`)**: a real claim somebody
  made, recorded from a search summary rather than a page anybody opened. It
  **does** match, score and rank, and it is labelled as maker-reported rather
  than verified.

The second group is much larger and is the real evidence question. It is a
sourcing gap, not a display defect, and it is tracked per product in
`docs/PARTNER-SHOWCASE-CHECKLIST.md`.

## Conclusion

No display path presents a prototype value as a trusted fact. Two of the 12 sit
on scored criteria and both score zero. Two are visible on product cards,
labelled. Nothing is hidden that a reader would want, and nothing is asserted
that the record cannot support.

No policy choice is required, and none was made.
