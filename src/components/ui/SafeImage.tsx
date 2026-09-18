"use client";

import { useState } from "react";
import { DemoArt } from "./DemoArt";

export function SafeImage({ src, alt, width, height, priority, seed }: { src: string; alt: string; width?: number; height?: number; priority: boolean; seed: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <DemoArt seed={seed} label="Partner image unavailable" variant="product" className="absolute inset-0 h-full w-full" />;
  // Feed URLs remain remote references; this preview does not download or republish partner media.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={width} height={height} loading={priority ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />;
}
