"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  useState,
} from "react";
import type { VideoPlayerHandle } from "./useVideoSync";

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: Record<string, unknown>,
      ) => YtPlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YtPlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getPlayerState: () => number;
  playVideo: () => void;
  pauseVideo: () => void;
};

let apiPromise: Promise<void> | null = null;

function loadYoutubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      resolve();
    };
    if (!document.querySelector("script[data-apex-yt]")) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.apexYt = "1";
      document.body.appendChild(script);
    }
  });
  return apiPromise;
}

export const YouTubePlayer = forwardRef<
  VideoPlayerHandle,
  {
    videoId: string;
    className?: string;
    startSeconds?: number;
  }
>(function YouTubePlayer({ videoId, className, startSeconds }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const [ready, setReady] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      getTime: () => playerRef.current?.getCurrentTime() ?? 0,
      seek: (seconds: number) => {
        playerRef.current?.seekTo(seconds, true);
      },
      isPaused: () => {
        const state = playerRef.current?.getPlayerState();
        // 1 = PLAYING
        return state !== 1;
      },
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
    }),
    [ready],
  );

  useEffect(() => {
    let cancelled = false;
    let player: YtPlayer | null = null;
    loadYoutubeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      player = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          start: startSeconds != null ? Math.floor(startSeconds) : undefined,
        },
        events: {
          onReady: () => {
            if (!cancelled) setReady(true);
          },
        },
      });
      playerRef.current = player;
    });
    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
      setReady(false);
    };
  }, [videoId, startSeconds]);

  return (
    <div className={className}>
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  );
});
