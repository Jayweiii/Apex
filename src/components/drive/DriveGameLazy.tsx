"use client";

import { PageSkeleton } from "@/components/PageSkeleton";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/** Lazy-load the canvas game so the rest of the site stays light. */
export const DriveGameLazy = dynamic(
  () =>
    import("@/components/drive/DriveGame").then((mod) => ({
      default: mod.DriveGame,
    })),
  {
    ssr: false,
    loading: () => <PageSkeleton label="Loading Drive…" rows={3} />,
  },
) as ComponentType<{ trackId: string }>;
