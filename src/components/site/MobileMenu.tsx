"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NAV, SITE_NAME } from "@/lib/site";

// Compact phone header: logo, Compare, menu button. The panel is portaled to
// document.body because the header's backdrop-blur creates a containing block
// that would otherwise trap a fixed overlay inside the 56px header strip.
export function MobileMenu({ current }: { current?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const panel = (
    <div id="mobile-nav" className="fixed inset-0 z-50 flex flex-col bg-surface">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-edge px-4">
        <span className="font-display text-xl">{SITE_NAME}</span>
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="tap inline-flex items-center justify-center rounded-pill border border-edge-strong bg-surface-raised"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-4 py-2">
        <ul className="flex flex-col">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={() => setOpen(false)}
                aria-current={current === n.href ? "page" : undefined}
                className={`flex min-h-14 items-center border-b border-edge font-display text-2xl ${current === n.href ? "text-accent-strong" : "text-fg"}`}
              >
                {n.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/disclosure" onClick={() => setOpen(false)} className="flex min-h-14 items-center text-sm font-semibold text-fg-soft">
              Affiliate disclosure
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="tap inline-flex items-center justify-center rounded-pill border border-edge-strong bg-surface-raised"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open ? createPortal(panel, document.body) : null}
    </>
  );
}
