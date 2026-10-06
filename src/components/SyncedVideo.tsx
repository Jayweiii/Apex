"use client";

import { useEffect, useRef } from "react";

export function SyncedVideo({
  src,
  progress,
  durationHint,
  onProgress,
}: {
  src: string;
  /** 0–1 through the lap */
  progress: number | null;
  durationHint?: number;
  onProgress?: (progress: number | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrubbing = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || progress == null || scrubbing.current) return;
    const duration = video.duration || durationHint || 0;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const target = progress * duration;
    if (Math.abs(video.currentTime - target) > 0.12) {
      video.currentTime = target;
    }
  }, [progress, durationHint]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Onboard video
        </p>
        <p className="text-xs text-zinc-500">Synced to scrubber</p>
      </div>
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        className="aspect-video w-full bg-black"
        onSeeking={() => {
          scrubbing.current = true;
        }}
        onSeeked={(event) => {
          const video = event.currentTarget;
          const duration = video.duration || durationHint || 0;
          if (duration > 0) onProgress?.(video.currentTime / duration);
          scrubbing.current = false;
        }}
        onTimeUpdate={(event) => {
          if (scrubbing.current) return;
          const video = event.currentTarget;
          if (video.paused) return;
          const duration = video.duration || durationHint || 0;
          if (duration > 0) onProgress?.(video.currentTime / duration);
        }}
      />
    </div>
  );
}
