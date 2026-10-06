import {
  DATA_KIND_HINT,
  DATA_KIND_LABEL,
  type DataKind,
  type DatasetAttribution,
} from "@/lib/attribution";

const KIND_STYLE: Record<DataKind, string> = {
  public: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  demo: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  upload: "border-sky-500/40 bg-sky-500/10 text-sky-300",
};

export function DataKindBadge({ kind }: { kind: DataKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] ${KIND_STYLE[kind]}`}
      title={DATA_KIND_HINT[kind]}
    >
      {DATA_KIND_LABEL[kind]}
    </span>
  );
}

export function AttributionCard({
  kind,
  attribution,
  compact = false,
}: {
  kind: DataKind;
  attribution?: DatasetAttribution | null;
  compact?: boolean;
}) {
  if (kind === "upload") {
    return (
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-400">
        <div className="flex flex-wrap items-center gap-2">
          <DataKindBadge kind="upload" />
          <span>Saved in this browser from a file you imported.</span>
        </div>
      </div>
    );
  }

  if (!attribution) return <DataKindBadge kind={kind} />;

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <DataKindBadge kind={kind} />
        {!compact ? (
          <span className="text-xs text-zinc-500">{DATA_KIND_HINT[kind]}</span>
        ) : null}
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            Source
          </dt>
          <dd className="mt-0.5 text-zinc-200">
            <a
              href={attribution.url}
              target="_blank"
              rel="noreferrer"
              className="text-orange-300 underline-offset-2 hover:underline"
            >
              {attribution.source}
            </a>
          </dd>
        </div>
        {attribution.author ? (
          <div>
            <dt className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              Author
            </dt>
            <dd className="mt-0.5 text-zinc-200">{attribution.author}</dd>
          </div>
        ) : null}
        {attribution.license ? (
          <div>
            <dt className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              License
            </dt>
            <dd className="mt-0.5 text-zinc-200">
              {attribution.licenseUrl ? (
                <a
                  href={attribution.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-orange-300 underline-offset-2 hover:underline"
                >
                  {attribution.license}
                </a>
              ) : (
                attribution.license
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      {attribution.notes && !compact ? (
        <p className="mt-3 text-xs leading-relaxed text-zinc-500">
          {attribution.notes}
        </p>
      ) : null}
    </div>
  );
}

export function AttributionInline({
  kind,
  attribution,
}: {
  kind: DataKind;
  attribution?: DatasetAttribution | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs text-zinc-500">
      <DataKindBadge kind={kind} />
      {attribution ? (
        <a
          href={attribution.url}
          target="_blank"
          rel="noreferrer"
          className="text-zinc-400 underline-offset-2 hover:text-orange-300 hover:underline"
        >
          {attribution.source}
          {attribution.license ? ` · ${attribution.license}` : ""}
        </a>
      ) : null}
    </span>
  );
}
