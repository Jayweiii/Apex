"use client";

import { PageSkeleton } from "@/components/PageSkeleton";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/** three.js stays off the rest of the site until this route opens. */
export const Kart2GameLazy = dynamic(
  () => import("@/components/kart2/Kart2Game").then((mod) => ({ default: mod.Kart2Game })),
  { ssr: false, loading: () => <PageSkeleton label="Loading Apex Kart…" rows={3} /> },
) as ComponentType;
