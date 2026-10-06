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
  demo: "Synthetic demo",
  upload: "Your upload",
};

export const DATA_KIND_HINT: Record<DataKind, string> = {
  public: "Real telemetry redistributed under a clear open license",
  demo: "Generated or shifted demo laps for UI exploration",
  upload: "Saved in this browser from a file you imported",
};

export const DEMO_ATTRIBUTION: DatasetAttribution = {
  source: "Apex synthetic sample-telemetry.csv",
  author: "Apex",
  url: "/sample-telemetry.csv",
  license: "Generated for this app",
  notes:
    "Not recorded on track. GPS is a synthetic Laguna Seca–style loop (and may be shifted onto other circuits for demos).",
};
