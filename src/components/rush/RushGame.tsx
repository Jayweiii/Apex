"use client";

import { AppHeader } from "@/components/AppHeader";
import { loadLook, saveLook, type KartLook } from "@/lib/rush/garage";
import { levelById, RUSH_LEVELS } from "@/lib/rush/levels";
import type { RushMode } from "@/lib/rush/race";
import { Silkscreen } from "next/font/google";
import { createRushAudio, type RushAudio } from "@/lib/rush/audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { RushMenu } from "./RushMenu";
import { RushRace, type RushSettings } from "./RushRace";
import "./rush.css";

const pixel = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-rush", display: "swap" });

const PREFS_KEY = "apex.rush.prefs";
type Prefs = { levelId: string; mode: RushMode; autoGas: boolean; muted: boolean };

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
  } catch {
    return {};
  }
}

export function RushGame() {
  // Client-only (loaded with ssr: false), so saved choices can seed the state.
  const [prefs] = useState(loadPrefs);
  const [look, setLook] = useState<KartLook>(loadLook);
  const [levelId, setLevelId] = useState(prefs.levelId && levelById(prefs.levelId) ? prefs.levelId : RUSH_LEVELS[0]!.id);
  const [mode, setMode] = useState<RushMode>(prefs.mode === "tt" ? "tt" : "gp");
  const [settings, setSettings] = useState<RushSettings>(() => ({
    // A thumb can't hold a gas button and steer; a keyboard can.
    autoGas: typeof prefs.autoGas === "boolean" ? prefs.autoGas : window.matchMedia("(pointer: coarse)").matches,
    muted: prefs.muted === true,
  }));
  const [racing, setRacing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ levelId, mode, autoGas: settings.autoGas, muted: settings.muted }));
    } catch {
      // Preferences just don't persist.
    }
  }, [levelId, mode, settings]);

  // One audio engine, created inside the Start tap (a user gesture).
  const audio = useRef<RushAudio | null>(null);
  const [audioReady, setAudioReady] = useState<RushAudio | null>(null);
  useEffect(() => () => audio.current?.dispose(), []);
  const start = useCallback(() => {
    if (!audio.current) audio.current = createRushAudio();
    audio.current.unlock();
    setAudioReady(audio.current);
    setRacing(true);
  }, []);

  const changeLook = useCallback((next: KartLook) => {
    setLook(next);
    saveLook(next);
  }, []);

  const level = levelById(levelId) ?? RUSH_LEVELS[0]!;

  return (
    <div className={`${pixel.variable} flex min-h-full flex-1 flex-col bg-[#14151a]`}>
      {racing ? (
        <RushRace level={level} mode={mode} look={look} settings={settings} onSettings={setSettings} onExit={() => setRacing(false)} audio={audioReady} />
      ) : (
        <>
          <AppHeader />
          <main id="main-content" className="flex-1">
            <RushMenu look={look} onLook={changeLook} levelId={levelId} onLevel={setLevelId} mode={mode} onMode={setMode} onStart={start} />
          </main>
        </>
      )}
    </div>
  );
}
