"use client";

import { useState } from "react";
import { ImageFrame } from "@/components/ui/ImageFrame";
import type { ImageAsset } from "@/domain/product";
import { cn } from "@/lib/cn";

export function Gallery({ images, name }: { images: ImageAsset[]; name: string }) {
  const ordered = [...images.filter((i) => i.role === "primary"), ...images.filter((i) => i.role !== "primary" && i.role !== "logo")];
  const [idx, setIdx] = useState(0);
  const current = ordered[idx] ?? ordered[0];
  return (
    <div className="flex flex-col gap-3">
      <ImageFrame image={current} ratio="4/5" priority className="rounded-card shadow-card" />
      {ordered.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={`${name} images`}>
          {ordered.map((img, i) => (
            <button
              key={img.id}
              type="button"
              role="tab"
              aria-selected={i === idx}
              aria-label={img.alt}
              onClick={() => setIdx(i)}
              className={cn("tap w-20 shrink-0 overflow-hidden rounded-xl border-2", i === idx ? "border-fg" : "border-transparent")}
            >
              <ImageFrame image={img} ratio="1/1" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
