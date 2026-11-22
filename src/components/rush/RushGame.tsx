"use client";

import { AppHeader } from "@/components/AppHeader";
import { loadLook, saveLook, type KartLook } from "@/lib/rush/garage";
import { levelById, RUSH_LEVELS } from "@/lib/rush/levels";
import { onlineAvailable, openLobby, type Lobby, type StartMessage } from "@/lib/rush/lobby";
import { cleanName, normalizeLobbyCode, pickHost, RemoteKart, type LobbyPlayer } from "@/lib/rush/net";
import { Silkscreen } from "next/font/google";
import { createRushAudio, type RushAudio } from "@/lib/rush/audio";
import { enableFastTap } from "@/lib/fast-tap";
import { useCallback, useEffect, useRef, useState } from "react";
import { RushLobby } from "./RushLobby";
import { RushMenu, type MenuMode } from "./RushMenu";
import { RushRace, type OnlineRace, type RushSettings } from "./RushRace";
import { requestTilt, TILT_BLOCKED, tiltAvailable } from "@/lib/rush/tilt";
import "./rush.css";

const pixel = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-rush", display: "swap" });

const PREFS_KEY = "apex.rush.prefs";
const NAME_KEY = "apex.rush.name";
type Prefs = { levelId: string; mode: MenuMode; autoGas: boolean; muted: boolean; tilt: boolean };

type StoredPrefs = Partial<Omit<Prefs, "autoGas">> & { autoGas?: boolean; autoGasCoarse?: boolean };

function isCoarse(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

function loadPrefs(): StoredPrefs {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const p = v as Record<string, unknown>;
    return {
      levelId: typeof p.levelId === "string" ? p.levelId : undefined,
      mode: p.mode === "tt" || p.mode === "gp" || p.mode === "online" ? p.mode : undefined,
      autoGas: typeof p.autoGas === "boolean" ? p.autoGas : undefined,
      // Which device class the saved autoGas choice was made on.
      autoGasCoarse: typeof p.autoGasCoarse === "boolean" ? p.autoGasCoarse : undefined,
      muted: typeof p.muted === "boolean" ? p.muted : undefined,
      tilt: typeof p.tilt === "boolean" ? p.tilt : undefined,
    };
  } catch {
    return {};
  }
}

function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return cleanName(saved, "Racer");
  } catch {
    // fall through to a made-up name
  }
  return `Racer ${Math.floor(10 + Math.random() * 90)}`;
}

/** ?lobby=CODE from an invite link. */
function inviteCode(): string {
  return normalizeLobbyCode(new URLSearchParams(window.location.search).get("lobby") ?? "") ?? "";
}

type Screen = "menu" | "race" | "lobby" | "online-race";
type LobbyView = { code: string; players: LobbyPlayer[]; hostId: string | null; myId: string };

export function RushGame() {
  // Client-only (loaded with ssr: false), so saved choices can seed the state.
  const [prefs] = useState(loadPrefs);
  const [look, setLook] = useState<KartLook>(loadLook);
  const [levelId, setLevelId] = useState(prefs.levelId && levelById(prefs.levelId) ? prefs.levelId : RUSH_LEVELS[0]!.id);
  const [invite] = useState(inviteCode);
  const [prefillCode, setPrefillCode] = useState(invite);
  const [mode, setMode] = useState<MenuMode>(invite ? "online" : prefs.mode ?? "gp");
  const [settings, setSettings] = useState<RushSettings>(() => ({
    // A thumb can't hold a gas button and steer; a keyboard can.
    // Reuse a saved choice unless it was made on a different device class (a desktop "off" must not
    // strand a phone at 0 km/h). Prefs saved before autoGasCoarse existed carry no class and are kept.
    autoGas:
      typeof prefs.autoGas === "boolean" && (prefs.autoGasCoarse === undefined || prefs.autoGasCoarse === isCoarse())
        ? prefs.autoGas
        : isCoarse(),
    muted: prefs.muted === true,
    // Tilt only means something on a phone or tablet with a motion sensor.
    tilt: prefs.tilt === true && tiltAvailable(),
  }));
  const [screen, setScreen] = useState<Screen>("menu");
  const [name, setName] = useState(loadName);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
          levelId,
          mode,
          autoGas: settings.autoGas,
          autoGasCoarse: isCoarse(),
          muted: settings.muted,
          tilt: settings.tilt,
        }),
      );
    } catch {
      // Preferences just don't persist.
    }
  }, [levelId, mode, settings]);

  // One audio engine, created inside the Start tap (a user gesture).
  const audio = useRef<RushAudio | null>(null);
  const [audioReady, setAudioReady] = useState<RushAudio | null>(null);
  useEffect(() => () => audio.current?.dispose(), []);
  // Tilt on iPhone needs motion access asked for inside a tap, on every page
  // load: the same taps that wake the sound ask for it (no prompt once allowed).
  const tiltWanted = useRef(settings.tilt);
  useEffect(() => {
    tiltWanted.current = settings.tilt;
  }, [settings.tilt]);
  const unlockAudio = useCallback(() => {
    if (tiltWanted.current) void requestTilt();
    if (!audio.current) audio.current = createRushAudio();
    audio.current.unlock();
    setAudioReady(audio.current);
  }, []);
  const [canTilt] = useState(tiltAvailable);
  const [tiltNote, setTiltNote] = useState("");
  const chooseTilt = useCallback((on: boolean) => {
    setTiltNote("");
    if (!on) {
      setSettings((s) => ({ ...s, tilt: false }));
      return;
    }
    void requestTilt().then((r) => {
      if (r === "granted") setSettings((s) => ({ ...s, tilt: true }));
      else setTiltNote(TILT_BLOCKED);
    });
  }, []);
  // The menu and garage are long on a phone. Start the race from the top of
  // the page: iOS can mis-route touches to a full-screen fixed layer while
  // the document underneath is scrolled. Put the menu back where it was after.
  const menuScroll = useRef(0);
  const start = useCallback(() => {
    unlockAudio();
    menuScroll.current = window.scrollY;
    window.scrollTo(0, 0);
    setScreen("race");
  }, [unlockAudio]);
  const exitRace = useCallback(() => {
    setScreen("menu");
    requestAnimationFrame(() => window.scrollTo(0, menuScroll.current));
  }, []);

  const changeLook = useCallback((next: KartLook) => {
    setLook(next);
    saveLook(next);
  }, []);

  // iOS can need two taps per button while the 3D view is busy: press on the first.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => (rootRef.current ? enableFastTap(rootRef.current) : undefined), []);

  // ── Online ──
  const lobbyRef = useRef<Lobby | null>(null);
  const [lobbyView, setLobbyView] = useState<LobbyView | null>(null);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState("");
  const [lobbyNote, setLobbyNote] = useState("");
  const [onlineRace, setOnlineRace] = useState<(OnlineRace & { levelId: string }) | null>(null);
  const presentRef = useRef(new Set<string>());
  const remotesRef = useRef(new Map<string, RemoteKart>());
  const screenRef = useRef<Screen>("menu");
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const changeName = useCallback((raw: string) => {
    setName(raw);
    const clean = cleanName(raw, "Racer");
    try {
      localStorage.setItem(NAME_KEY, clean);
    } catch {
      // not saved
    }
    lobbyRef.current?.update({ name: clean });
  }, []);

  const setInviteUrl = (code: string | null) => {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set("lobby", code);
    else url.searchParams.delete("lobby");
    window.history.replaceState(null, "", url.toString());
  };

  const enterRace = useCallback((msg: StartMessage) => {
    const lobby = lobbyRef.current;
    if (!lobby || !msg.grid.some((g) => g.id === lobby.myId)) {
      // Joined after the grid was set: wait for the next race.
      setLobbyNote("A RACE IS ON. YOU'LL BE IN THE NEXT ONE.");
      return;
    }
    const remotes = new Map<string, RemoteKart>();
    remotesRef.current = remotes;
    setOnlineRace({
      raceId: msg.raceId,
      levelId: msg.levelId,
      grid: msg.grid,
      myId: lobby.myId,
      remotes,
      present: () => presentRef.current,
      send: (snap) => lobbyRef.current?.sendState(snap),
      goAt: msg.goAt,
    });
    setLobbyNote("");
    lobby.update({ racing: true });
    window.scrollTo(0, 0);
    setScreen("online-race");
  }, []);

  const openOnline = useCallback(
    (how: { create: true } | { create: false; code: string }) => {
      lobbyRef.current?.leave();
      setOnlineError("");
      setOnlineBusy(true);
      unlockAudio();
      const me = { name: cleanName(name, "Racer"), look };
      const lobby = openLobby(how.create ? { create: true, me: { ...me, levelId } } : { create: false, code: how.code, me }, {
        onStatus: (status, message) => {
          if (lobbyRef.current !== lobby) return;
          if (status === "open") {
            setOnlineBusy(false);
            setInviteUrl(lobby.code);
            setScreen("lobby");
          } else if (status === "error") {
            setOnlineBusy(false);
            setOnlineError(message ?? "Could not join.");
            lobbyRef.current = null;
            setLobbyView(null);
            setInviteUrl(null);
            if (screenRef.current !== "menu") setScreen("menu");
          }
        },
        onPlayers: (players, hostId) => {
          if (lobbyRef.current !== lobby) return;
          presentRef.current = new Set(players.map((p) => p.id));
          setLobbyView({ code: lobby.code, players, hostId, myId: lobby.myId });
        },
        onStart: (msg) => {
          if (lobbyRef.current === lobby) enterRace(msg);
        },
        onState: (id, snap, at) => {
          let remote = remotesRef.current.get(id);
          if (!remote) {
            remote = new RemoteKart();
            remotesRef.current.set(id, remote);
          }
          remote.push(snap, at);
        },
      });
      lobbyRef.current = lobby;
    },
    [name, look, levelId, unlockAudio, enterRace],
  );

  const leaveLobby = useCallback(() => {
    lobbyRef.current?.leave();
    lobbyRef.current = null;
    setLobbyView(null);
    setOnlineRace(null);
    setLobbyNote("");
    setInviteUrl(null);
    // Start the Join field empty so Join can't rejoin the lobby just left.
    setPrefillCode("");
    setScreen("menu");
  }, []);
  useEffect(() => () => lobbyRef.current?.leave(), []);

  // An invite link joins straight away (the menu shows progress and errors).
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!invite || autoJoined.current || !onlineAvailable()) return;
    const id = requestAnimationFrame(() => {
      autoJoined.current = true;
      openOnline({ create: false, code: invite });
    });
    return () => cancelAnimationFrame(id);
  }, [invite, openOnline]);

  const hostStart = useCallback(() => {
    const lobby = lobbyRef.current;
    const host = lobbyView ? pickHost(lobbyView.players) : null;
    if (!lobby || !host) return;
    unlockAudio();
    const msg = lobby.start(host.levelId ?? levelId);
    // The host does not hear its own broadcast: start here too.
    if (msg) enterRace(msg);
  }, [lobbyView, levelId, unlockAudio, enterRace]);

  const backToLobby = useCallback(() => {
    lobbyRef.current?.update({ racing: false });
    setOnlineRace(null);
    setScreen(lobbyRef.current ? "lobby" : "menu");
  }, []);

  const level = levelById(levelId) ?? RUSH_LEVELS[0]!;
  const onlineLevel = onlineRace ? (levelById(onlineRace.levelId) ?? RUSH_LEVELS[0]!) : level;
  const isHost = lobbyView ? lobbyView.hostId === lobbyView.myId : false;

  return (
    <div ref={rootRef} className={`${pixel.variable} flex min-h-full flex-1 flex-col bg-[#14151a]`}>
      {screen === "race" ? (
        <RushRace level={level} mode={mode === "tt" ? "tt" : "gp"} look={look} settings={settings} onSettings={setSettings} onExit={exitRace} audio={audioReady} />
      ) : screen === "online-race" && onlineRace ? (
        <RushRace
          key={onlineRace.raceId}
          level={onlineLevel}
          mode="gp"
          look={onlineRace.grid.find((g) => g.id === onlineRace.myId)?.look ?? look}
          settings={settings}
          onSettings={setSettings}
          onExit={backToLobby}
          audio={audioReady}
          online={onlineRace}
        />
      ) : (
        <>
          <AppHeader />
          <main id="main-content" className="flex-1">
            {screen === "lobby" && lobbyView ? (
              <RushLobby
                code={lobbyView.code}
                players={lobbyView.players}
                hostId={lobbyView.hostId}
                myId={lobbyView.myId}
                name={name}
                onName={changeName}
                onTrack={(id) => {
                  setLevelId(id);
                  if (isHost) lobbyRef.current?.update({ levelId: id });
                }}
                onStart={hostStart}
                onLeave={leaveLobby}
                note={lobbyNote}
              />
            ) : (
              <RushMenu
                look={look}
                onLook={changeLook}
                levelId={levelId}
                onLevel={setLevelId}
                mode={mode}
                onMode={setMode}
                onStart={start}
                online={{
                  available: onlineAvailable(),
                  name,
                  onName: changeName,
                  onCreate: () => openOnline({ create: true }),
                  onJoin: (raw) => {
                    const code = normalizeLobbyCode(raw);
                    if (!code) {
                      setOnlineError("Codes are 4 letters or numbers, like K7QX.");
                      return;
                    }
                    openOnline({ create: false, code });
                  },
                  busy: onlineBusy,
                  error: onlineError,
                  initialCode: prefillCode,
                }}
                steering={canTilt ? { tilt: settings.tilt, onTilt: chooseTilt, note: tiltNote } : null}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}
