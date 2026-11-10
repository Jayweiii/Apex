"use client";

import { PageSkeleton } from "@/components/PageSkeleton";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/** Lazy-load the game (three.js and all) so the rest of the site stays light. */
export const RushGameLazy = dynamic(() => import("@/components/rush/RushGame").then((mod) => ({ default: mod.RushGame })), {
  ssr: false,
  loading: () => <PageSkeleton label="Loading Apex Rush…" rows={3} />,
}) as ComponentType;
