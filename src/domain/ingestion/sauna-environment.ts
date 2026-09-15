export type SaunaEnvironmentFact = { key: "max_temperature_f" | "enclosure_protection"; value: number | string; matched: string };

/** Conservative, label/claim-anchored readings from seller or maker prose. */
export function extractSaunaEnvironment(text: string): SaunaEnvironmentFact[] {
  const temperatures: Array<{ value: number; matched: string }> = [];
  const patterns = [
    /(?:maximum(?: operating)? temperature|max(?:imum)? temp(?:erature)?)\s*:?\s*(\d{2,3})\s*°?\s*F/gi,
    /(?:sauna can heat|heats?|heat)\b[^.!]{0,35}?(?:up )?to\s+(?:a\s+\w+\s+)?(\d{2,3})\s*°?\s*F/gi,
    /temperature range\s*:?\s*\d{2,3}\s*°?\s*F?\s*(?:-|–|to)\s*(\d{2,3})\s*°?\s*F/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const value = Number(match[1]);
      if (value >= 90 && value <= 250) temperatures.push({ value, matched: match[0] });
    }
  }

  const insulation = /(fully insulated|multi-layer[^.!]{0,30}insulation|insulated (?:tempered )?glass|double-paneled walls?|thermal insulation|superior thermal resistance)/i.exec(text);
  const weather = /(weather[- ](?:ready|resistant|proofed|tight)|all-weather(?: protective)?|outdoor weather protection|withstand any weather|built[^.!]{0,45}(?:rain, sun, and snow|year-round outdoor use))/i.exec(text);
  const out: SaunaEnvironmentFact[] = [];
  if (temperatures.length) {
    const highest = temperatures.reduce((best, item) => item.value > best.value ? item : best);
    out.push({ key: "max_temperature_f", value: highest.value, matched: highest.matched });
  }
  if (insulation || weather) {
    out.push({
      key: "enclosure_protection",
      value: insulation && weather ? "insulated_weather_ready" : insulation ? "insulated" : "weather_ready",
      matched: [insulation?.[0], weather?.[0]].filter(Boolean).join("; "),
    });
  }
  return out;
}
