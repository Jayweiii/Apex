"use client";

import { PageSkeleton } from "@/components/PageSkeleton";
import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type SessionUploadProps = ComponentProps<
  typeof import("@/components/SessionUpload").SessionUpload
>;

/** Code-split GoPro/GPMF + papaparse parsers off pages that only link to upload. */
export const SessionUploadLazy = dynamic(
  () =>
    import("@/components/SessionUpload").then((mod) => ({
      default: mod.SessionUpload,
    })),
  {
    ssr: false,
    loading: () => <PageSkeleton label="Loading upload…" rows={4} />,
  },
) as ComponentType<SessionUploadProps>;
