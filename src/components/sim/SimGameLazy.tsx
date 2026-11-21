"use client";

import { PageSkeleton } from "@/components/PageSkeleton";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/** Lazy-load the sim (three.js and all) so the rest of the site stays light. */
export const SimGameLazy = dynamic(() => import("@/components/sim/SimGame").then((mod) => ({ default: mod.SimGame })), {
  ssr: false,
  loading: () => <PageSkeleton label="Loading Apex Sim…" rows={3} />,
}) as ComponentType;
