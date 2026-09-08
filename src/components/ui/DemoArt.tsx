// Procedural placeholder art. Deterministic from a seed so a product keeps the
// same image across renders. Palette leans on the seed's category or brand.
// "product" draws a soft object study; "scene" draws a warm editorial room.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let t = seed || 1;
  return () => {
    t ^= t << 13;
    t ^= t >>> 17;
    t ^= t << 5;
    return ((t >>> 0) % 10000) / 10000;
  };
}

const palettes: Record<string, [string, string, string]> = {
  "red-light": ["#f3d9cc", "#c2542b", "#5a2415"],
  "cold-plunge": ["#d3e3e2", "#2f5d62", "#16303a"],
  "wellness-drinks": ["#f3e4c4", "#d3a04a", "#6b4a16"],
  default: ["#ebe2d2", "#8a8178", "#1f1a16"],
};

export function paletteFor(seed: string): [string, string, string] {
  const key = Object.keys(palettes).find((k) => seed.startsWith(k) || seed.includes(k));
  if (key) return palettes[key];
  const byBrand: Record<string, string> = {
    joovv: "red-light", mito: "red-light", platinumled: "red-light", hooga: "red-light", "bon-charge": "red-light", infraredi: "red-light",
    plunge: "cold-plunge", "ice-barrel": "cold-plunge", "cold-pod": "cold-plunge", edge: "cold-plunge", renu: "cold-plunge",
    lmnt: "wellness-drinks", "liquid-iv": "wellness-drinks", ag1: "wellness-drinks", olipop: "wellness-drinks", celsius: "wellness-drinks", cure: "wellness-drinks",
  };
  const b = Object.keys(byBrand).find((k) => seed.includes(k));
  return palettes[b ? byBrand[b] : "default"];
}

export function DemoArt({
  seed,
  className,
  label = "Demo image",
  variant = "product",
  showLabel = true,
}: {
  seed: string;
  className?: string;
  label?: string;
  variant?: "product" | "scene";
  showLabel?: boolean;
}) {
  const [light, mid, dark] = paletteFor(seed);
  const r = rng(hash(seed));
  const id = `g${hash(seed).toString(16)}`;

  if (variant === "scene") {
    const sunX = 25 + r() * 50;
    const sunY = 22 + r() * 20;
    const horizon = 58 + r() * 10;
    return (
      <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" className={className} role="img" aria-label={label}>
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbf6ec" />
            <stop offset="100%" stopColor={light} />
          </linearGradient>
          <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={mid} stopOpacity="0.55" />
            <stop offset="100%" stopColor={dark} stopOpacity="0.85" />
          </linearGradient>
          <radialGradient id={`${id}-sun`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={mid} stopOpacity="0.85" />
            <stop offset="100%" stopColor={mid} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="160" height="100" fill={`url(#${id}-sky)`} />
        <circle cx={sunX} cy={sunY} r="34" fill={`url(#${id}-sun)`} />
        <rect x="0" y={horizon} width="160" height={100 - horizon} fill={`url(#${id}-floor)`} />
        <rect x="0" y={horizon - 0.4} width="160" height="0.8" fill={dark} opacity="0.25" />
        <rect x={sunX - 22} y={horizon - 30} width="44" height="30" rx="2" fill={dark} opacity="0.35" />
        <rect x={sunX - 19} y={horizon - 27} width="38" height="24" rx="1.5" fill={mid} opacity="0.55" />
        <rect x={sunX + 30} y={horizon - 18} width="18" height="18" rx="1" fill={dark} opacity="0.22" />
        {showLabel ? (
          <text x="80" y="96" textAnchor="middle" fontSize="3.4" fontFamily="ui-sans-serif, system-ui" fontWeight="700" fill="#fbf6ec" opacity="0.7" letterSpacing="0.4">
            DEMO IMAGE
          </text>
        ) : null}
      </svg>
    );
  }

  const cx = 30 + r() * 40;
  const cy = 30 + r() * 40;
  const rad = 22 + r() * 18;
  const tilt = -20 + r() * 40;
  const bars = 3 + Math.floor(r() * 3);

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={className} role="img" aria-label={label}>
      <defs>
        <radialGradient id={`${id}-glow`} cx={`${cx}%`} cy={`${cy}%`} r="70%">
          <stop offset="0%" stopColor={mid} stopOpacity="0.9" />
          <stop offset="60%" stopColor={light} stopOpacity="0.6" />
          <stop offset="100%" stopColor={light} stopOpacity="1" />
        </radialGradient>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={dark} />
          <stop offset="100%" stopColor={mid} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={light} />
      <rect width="100" height="100" fill={`url(#${id}-glow)`} />
      <g transform={`rotate(${tilt} 50 55)`}>
        <rect x={50 - rad * 0.55} y={55 - rad} width={rad * 1.1} height={rad * 2} rx={rad * 0.12} fill={`url(#${id}-body)`} />
        {Array.from({ length: bars }).map((_, i) => (
          <rect key={i} x={50 - rad * 0.4} y={55 - rad * 0.8 + (i * rad * 1.6) / bars} width={rad * 0.8} height={rad * 0.08} rx={rad * 0.04} fill={light} opacity="0.55" />
        ))}
      </g>
      <rect x="0" y="82" width="100" height="18" fill={dark} opacity="0.08" />
      {showLabel ? (
        <text x="50" y="95" textAnchor="middle" fontSize="4.2" fontFamily="ui-sans-serif, system-ui" fontWeight="700" fill={dark} opacity="0.55" letterSpacing="0.4">
          DEMO IMAGE
        </text>
      ) : null}
    </svg>
  );
}
