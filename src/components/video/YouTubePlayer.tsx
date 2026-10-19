"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  useState,
} from "react";
import type { PlayerSyncEvent } from "@/lib/playback-sync";
import type { VideoPlayerHandle } from "./useVideoSync";

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: Record<string, unknown>,
      ) => YtPlayer;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
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
  getPlaybackRate?: () => number;
  setPlaybackRate?: (rate: number) => void;
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
    /** Native YouTube control events (play/pause/seek/rate/time). */
    onPlayerEvent?: (event: PlayerSyncEvent) => void;
  }
>(function YouTubePlayer(
  { videoId, className, startSeconds, onPlayerEvent },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const onEventRef = useRef(onPlayerEvent);
  onEventRef.current = onPlayerEvent;
  const lastTimeRef = useRef(0);
  const [ready, setReady] = useState(false);

  // Empty deps — handle identity must stay stable. Methods read playerRef.
  useImperativeHandle(
    ref,
    () => ({
      getTime: () => {
        const p = playerRef.current;
        return typeof p?.getCurrentTime === "function" ? p.getCurrentTime() : 0;
      },
      seek: (seconds: number) => {
        const p = playerRef.current;
        if (typeof p?.seekTo === "function") {
          p.seekTo(seconds, true);
          lastTimeRef.current = seconds;
        }
      },
      isPaused: () => {
        const p = playerRef.current;
        if (typeof p?.getPlayerState !== "function" || !window.YT?.PlayerState) {
          return true;
        }
        return p.getPlayerState() !== window.YT.PlayerState.PLAYING;
      },
      play: () => {
        const p = playerRef.current;
        if (typeof p?.playVideo === "function") p.playVideo();
      },
      pause: () => {
        const p = playerRef.current;
        if (typeof p?.pauseVideo === "function") p.pauseVideo();
      },
      getRate: () => {
        const p = playerRef.current;
        return typeof p?.getPlaybackRate === "function" ? p.getPlaybackRate() : 1;
      },
      setRate: (rate: number) => {
        const p = playerRef.current;
        if (typeof p?.setPlaybackRate === "function") p.setPlaybackRate(rate);
      },
    }),
    [],
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
          fs: 1,
          autoplay: 0,
          start: startSeconds != null ? Math.floor(startSeconds) : undefined,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            playerRef.current = player;
            setReady(true);
          },
          onStateChange: (event: { data: number }) => {
            if (cancelled || !window.YT?.PlayerState) return;
            const state = event.data;
            const time =
              typeof player?.getCurrentTime === "function"
                ? player.getCurrentTime()
                : lastTimeRef.current;
            if (state === window.YT.PlayerState.PLAYING) {
              // Large jump while transitioning often means a user seek.
              if (Math.abs(time - lastTimeRef.current) > 0.45) {
                onEventRef.current?.({ type: "seek", time });
              }
              lastTimeRef.current = time;
              onEventRef.current?.({ type: "play" });
              return;
            }
            if (state === window.YT.PlayerState.PAUSED) {
              if (Math.abs(time - lastTimeRef.current) > 0.45) {
                onEventRef.current?.({ type: "seek", time });
              }
              lastTimeRef.current = time;
              onEventRef.current?.({ type: "pause" });
              return;
            }
            if (state === window.YT.PlayerState.ENDED) {
              lastTimeRef.current = time;
              onEventRef.current?.({ type: "ended" });
            }
          },
          onPlaybackRateChange: (event: { data: number }) => {
            if (cancelled) return;
            onEventRef.current?.({ type: "rate", rate: event.data });
          },
        },
      });
    });
    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
      setReady(false);
    };
  }, [videoId, startSeconds]);

  // Poll while playing so scrubbing the YT timeline (without state flicker)
  // still drives the track cursor.
  useEffect(() => {
    if (!ready || !onPlayerEvent) return;
    let raf = 0;
    let lastEmit = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const p = playerRef.current;
      if (!p || typeof p.getPlayerState !== "function") return;
      const playing =
        window.YT?.PlayerState != null &&
        p.getPlayerState() === window.YT.PlayerState.PLAYING;
      const time =
        typeof p.getCurrentTime === "function" ? p.getCurrentTime() : 0;
      if (playing) {
        if (now - lastEmit >= 200) {
          lastEmit = now;
          lastTimeRef.current = time;
          onEventRef.current?.({ type: "time", time });
        }
      } else if (Math.abs(time - lastTimeRef.current) > 0.35) {
        lastTimeRef.current = time;
        onEventRef.current?.({ type: "seek", time });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, onPlayerEvent]);

  return (
    <div className={className}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <div ref={hostRef} className="h-full w-full" />
        <button
          type="button"
          onClick={() => {
            const root = hostRef.current?.parentElement;
            if (!root) return;
            if (document.fullscreenElement === root) {
              void document.exitFullscreen();
            } else {
              void root.requestFullscreen?.();
            }
          }}
          className="absolute bottom-2 right-2 z-10 rounded-md bg-black/70 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-200 hover:bg-black/90"
        >
          Fullscreen
        </button>
      </div>
    </div>
  );
});
