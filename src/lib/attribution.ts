export type DataKind = "public" | "demo" | "upload";

export type DatasetAttribution = {
  source: string;
  author?: string;
  url: string;
  license?: string;
  licenseUrl?: string;
  notes?: string;
};

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  public: "Public data",
  demo: "Demo",
  upload: "Your upload",
};

export const DATA_KIND_HINT: Record<DataKind, string> = {
  public: "Real telemetry redistributed under a clear open license",
  demo: "Legacy demo label (not seeded at init)",
  upload: "Saved in this browser from a file you imported",
};
