"use client";

import { useState } from "react";
import { outboundLinkProps, relationshipNote } from "@/domain/outbound";
import type { AffiliateStatus, ImageAsset } from "@/domain/product";
import styles from "./SaunaShowcase.module.css";

type Item = { productId: string; retailer: string; image: ImageAsset; name: string; brand: string; url: string; affiliateStatus: AffiliateStatus };

export function SaunaShowcase({ items }: { items: Item[] }) {
  const [paused, setPaused] = useState(false);
  return (
    <section aria-label="Saunas from multiple brands" className={styles.showcase}>
      <div className={styles.viewport}>
        <div className={styles.track} data-paused={paused}>
          {[0, 1].map((copy) => (
            <div className={styles.group} key={copy} aria-hidden={copy === 1 ? true : undefined}>
              {items.map(({ productId, retailer, image, name, brand, url, affiliateStatus }) => (
                <a className={styles.card} key={image.id} href={url} {...outboundLinkProps(affiliateStatus, { productId, productName: name, retailer })} tabIndex={copy === 1 ? -1 : undefined} aria-label={`${name} — visit retailer (opens in a new tab)`}>
                  {/* Catalog images retain their existing remote source URLs. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.src} alt={copy === 0 ? image.alt || name : ""} width={image.width ?? 600} height={image.height ?? 600} decoding="async" />
                  <div className={styles.details}><strong>{brand}</strong><span>{name}</span><small>Check price at {retailer} ↗</small></div>
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className={styles.disclosure}>{relationshipNote(items.map((item) => item.affiliateStatus))}</p>
      <div className={styles.caption}>
        <span>Explore your options</span>
        <button type="button" className={`tap ${styles.control}`} onClick={() => setPaused(!paused)} aria-pressed={paused} aria-label="Pause automatic image scrolling">
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
    </section>
  );
}
