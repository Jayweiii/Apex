"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { VideoPlayerHandle } from "./useVideoSync";

/** MP4 player exposing the shared VideoPlayerHandle interface. */
export const Mp4Player = forwardRef<
  VideoPlayerHandle,
  {
    src: string;
    className?: string;
    onNativeTime?: (t: number) => void;
  }
>(function Mp4Player({ src, className, onNativeTime }, ref) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      getTime: () => videoRef.current?.currentTime ?? 0,
      seek: (seconds: number) => {
        const video = videoRef.current;
        if (!video) return;
        if (Math.abs(video.currentTime - seconds) > 0.05) {
          video.currentTime = seconds;
        }
      },
      isPaused: () => videoRef.current?.paused ?? true,
      play: () => {
        void videoRef.current?.play();
      },
      pause: () => videoRef.current?.pause(),
    }),
    [],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onNativeTime) return;
    const onTime = () => onNativeTime(video.currentTime);
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [onNativeTime]);

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
