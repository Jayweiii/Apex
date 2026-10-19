"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { PlayerSyncEvent } from "@/lib/playback-sync";
import type { VideoPlayerHandle } from "./useVideoSync";

/** MP4 player exposing the shared VideoPlayerHandle interface. */
export const Mp4Player = forwardRef<
  VideoPlayerHandle,
  {
    src: string;
    className?: string;
    onNativeTime?: (t: number) => void;
    onPlayerEvent?: (event: PlayerSyncEvent) => void;
  }
>(function Mp4Player({ src, className, onNativeTime, onPlayerEvent }, ref) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onEventRef = useRef(onPlayerEvent);
  onEventRef.current = onPlayerEvent;
  const lastTimeRef = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      getTime: () => videoRef.current?.currentTime ?? 0,
      seek: (seconds: number) => {
        const video = videoRef.current;
        if (!video) return;
        if (Math.abs(video.currentTime - seconds) > 0.05) {
          video.currentTime = seconds;
          lastTimeRef.current = seconds;
        }
      },
      isPaused: () => videoRef.current?.paused ?? true,
      play: () => {
        void videoRef.current?.play();
      },
      pause: () => videoRef.current?.pause(),
      getRate: () => videoRef.current?.playbackRate ?? 1,
      setRate: (rate: number) => {
        const video = videoRef.current;
        if (video) video.playbackRate = rate;
      },
    }),
    [],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const emit = (event: PlayerSyncEvent) => onEventRef.current?.(event);

    const onPlay = () => emit({ type: "play" });
    const onPause = () => emit({ type: "pause" });
    const onEnded = () => emit({ type: "ended" });
    const onSeeked = () => {
      const t = video.currentTime;
      lastTimeRef.current = t;
      emit({ type: "seek", time: t });
    };
    const onRate = () => emit({ type: "rate", rate: video.playbackRate });
    const onTime = () => {
      onNativeTime?.(video.currentTime);
      if (video.paused) return;
      lastTimeRef.current = video.currentTime;
      emit({ type: "time", time: video.currentTime });
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ratechange", onRate);
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ratechange", onRate);
      video.removeEventListener("timeupdate", onTime);
    };
  }, [onNativeTime, src]);

  return (
    <div className={className}>
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        className="aspect-video w-full rounded-xl bg-black"
      />
    </div>
  );
});
