"use client";

import { PageSkeleton } from "@/components/PageSkeleton";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/** Lazy-load the game so the rest of the site stays light. */
export const KartGameLazy = dynamic(
  () => import("@/components/kart/KartGame").then((mod) => ({ default: mod.KartGame })),
  { ssr: false, loading: () => <PageSkeleton label="Loading Apex Kart…" rows={3} /> },
) as ComponentType;
