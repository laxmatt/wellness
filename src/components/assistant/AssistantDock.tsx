"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AssistantPanel } from "./AssistantPanel";
import { useAssistant } from "./AssistantProvider";

// When the panel is open on a wide screen the page gets a right gutter exactly
// the panel's width, so nothing is ever hidden behind it. On phones the panel
// is a sheet over the lower part of the screen and the page reserves matching
// space beneath, so the last row stays reachable.
export function AssistantDock({ children }: { children: ReactNode }) {
  const a = useAssistant();
  const open = a?.open ?? false;
  return (
    <>
      <div className={cn("transition-[padding] duration-200", open && "pb-[74dvh] lg:pb-0 lg:pr-[23rem]")}>{children}</div>
      <AssistantPanel />
    </>
  );
}
