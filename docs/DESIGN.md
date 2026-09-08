# Design system

The current look ("warm tech" v0) is a working system, not the final brand. The final brand is expected to read more modern and product-intelligence driven. Everything visual is built to be swapped without touching product logic.

## Layers

1. Palette. Raw colors named by hue in `src/app/globals.css` under `:root` as `--palette-*`. Nothing outside that file references them, except `DemoArt` (placeholder art, replaced by real imagery).
2. Semantic tokens. `@theme inline` in the same file maps roles to palette values: `surface`, `surface-raised`, `surface-sunken`, `fg`, `fg-soft`, `fg-muted`, `fg-inverse`, `edge`, `edge-strong`, `accent`, `accent-strong`, `accent-soft`, `secondary`, `positive`, `warm`, `tertiary` (each with a `-soft`), `badge-overall`, `badge-value`, `badge-budget`, `badge-premium`, `badge-match`, `control`, `control-hover`, `control-fg`. Type: `--type-display`, `--type-body`. Shape: `--shape-card`, `--shape-control`. Depth: `--depth-card`, `--depth-float`.
3. Recipes. `buttonStyles(variant, size)` in `src/components/ui/Button.tsx` is the one button recipe, used by `Button` and by links styled as buttons. `Badge`, `Chip`, `VerificationTag`, `PriceDisplay`, `SpecRow`, `ImageFrame` are the other primitives.
4. Composites. Cards, rows, tables, page sections. They consume primitives and semantic utilities only.

## Rules

- Components use semantic utilities (`bg-surface-raised`, `text-fg-muted`, `border-edge`). Never `bg-paper`, never a hex. `src/__tests__/design-tokens.test.ts` enforces this.
- Headings use the `font-display` class. Body inherits `--font-sans`. Data uses `tabular`.
- Corners use `rounded-card` and `rounded-pill`. Shadows use `shadow-card` and `shadow-float`.
- Interactive controls carry `tap` (44px minimum). No hover-only affordances.

## How to reskin

1. Replace palette values under `:root`. Add or remove palette entries freely.
2. Point semantic tokens at the new palette. Keep the semantic names.
3. Change `--type-display` and `--type-body` (and the font loaders in `src/app/layout.tsx`). Set `--type-display-settings` to `normal` for fonts without variation axes.
4. Adjust `--shape-*` and `--depth-*`. Square corners and flat depth are two values away.
5. Run `npm test`. The token test catches any component that bypassed the layer.

Spacing scale and layout grid use Tailwind defaults. A denser or airier rhythm is a `--spacing` override in `@theme`, not a component edit.

## Known coupling to remove later

- `DemoArt` palettes are per category and hard-coded. They go away with real imagery.
- Section rhythm (`mt-20`, `gap-10`) is repeated in page files. If the new brand changes rhythm broadly, introduce `--spacing-section` tokens and replace those in one pass.
