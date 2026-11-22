"use client";

import { sanitizeLook } from "@/lib/rush/garage";
import { levelById, RUSH_LEVELS } from "@/lib/rush/levels";
import { MAX_PLAYERS, type LobbyPlayer } from "@/lib/rush/net";
import { useState } from "react";

/** The lobby: the code to share, who is here, the track, and Start for the host. */
export function RushLobby({
  code,
  players,
  hostId,
  myId,
  name,
  onName,
  onTrack,
  onStart,
  onLeave,
  note,
}: {
  code: string;
  players: LobbyPlayer[];
  hostId: string | null;
  myId: string;
  name: string;
  onName: (name: string) => void;
  onTrack: (levelId: string) => void;
  onStart: () => void;
  onLeave: () => void;
  /** A line under the code (race in progress, connection trouble). */
  note?: string;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = hostId === myId;
  const host = players.find((p) => p.id === hostId) ?? null;
  const level = levelById(host?.levelId ?? "") ?? RUSH_LEVELS[0]!;
  const enough = players.length >= 2;

  const invite = () => {
    const url = `${window.location.origin}/rush?lobby=${code}`;
    const share = (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    if (share && window.matchMedia("(pointer: coarse)").matches) {
      void share.call(navigator, { title: "Apex Rush", text: `Race me in Apex Rush: code ${code}`, url }).catch(() => {});
      return;
    }
    void navigator.clipboard?.writeText(url).then(done, done);
  };

  return (
    <div className="rush mx-auto w-full max-w-3xl px-4 pb-10 pt-6 text-[#f8f9fa]" data-rush-lobby={code}>
      <p className="text-xs text-[#adb5bd]">ONLINE LOBBY · CODE</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="rush-code" data-rush-lobby-code="1" aria-label={`Lobby code ${code.split("").join(" ")}`}>
          {code}
        </p>
        <button type="button" className="rush-btn rush-btn--ghost" data-rush-invite="1" onClick={invite}>
          {copied ? "Link copied" : "Invite"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[#adb5bd]">FRIENDS OPEN APEX RUSH, PICK ONLINE AND ENTER THIS CODE</p>
      {note ? (
        <p className="mt-3 text-xs text-[#ffd60a]" role="status">
          {note}
        </p>
      ) : null}

      <section className="mt-5" aria-labelledby="rush-racers">
        <h2 id="rush-racers" className="text-xs text-[#adb5bd]">
          RACERS {players.length}/{MAX_PLAYERS}
        </h2>
        <ul className="mt-2 space-y-2" data-rush-players={players.length}>
          {players.map((p) => {
            const look = sanitizeLook(p.look);
            return (
              <li key={p.id} className="rush-card" data-rush-player={p.id === myId ? "me" : "other"}>
                <span className="flex items-center gap-3">
                  <span className="block h-6 w-6 shrink-0 border-2 border-[#14151a]" style={{ background: look.paint }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{p.name.toUpperCase()}</span>
                  <span className="flex shrink-0 gap-2 text-[10px]">
                    {p.id === hostId ? <span className="text-[#ffd60a]">HOST</span> : null}
                    {p.id === myId ? <span className="text-[#4cc9f0]">YOU</span> : null}
                    {p.racing ? <span className="text-[#adb5bd]">RACING</span> : null}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <label className="mt-3 block text-[11px] text-[#adb5bd]" htmlFor="rush-name">
          YOUR NAME
        </label>
        <input
          id="rush-name"
          className="rush-input mt-1"
          value={name}
          maxLength={14}
          autoComplete="nickname"
          data-rush-name="1"
          onChange={(e) => onName(e.target.value)}
        />
      </section>

      <section className="mt-5" aria-labelledby="rush-lobby-track">
        <h2 id="rush-lobby-track" className="text-xs text-[#adb5bd]">
          TRACK
        </h2>
        {isHost ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Track">
            {RUSH_LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={l.id === level.id}
                data-rush-lobby-track={l.id}
                className="rush-card text-sm font-bold"
                onClick={() => onTrack(l.id)}
              >
                {l.data.name.toUpperCase()}
                <span className="block text-[11px] font-normal text-[#adb5bd]">{l.tagline}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rush-card mt-2 text-sm font-bold" data-rush-lobby-track-name="1">
            {level.data.name.toUpperCase()}
            <span className="block text-[11px] font-normal text-[#adb5bd]">THE HOST PICKS THE TRACK</span>
          </p>
        )}
      </section>

      <div className="mt-6 flex flex-col gap-3">
        {isHost ? (
          <button type="button" className="rush-btn rush-btn--go w-full text-lg" data-rush-lobby-start="1" disabled={!enough} onClick={onStart}>
            {enough ? `Start race (${players.length})` : "Waiting for racers…"}
          </button>
        ) : (
          <p className="rush-panel p-3 text-center text-sm" data-rush-lobby-wait="1">
            WAITING FOR {host ? host.name.toUpperCase() : "THE HOST"} TO START
          </p>
        )}
        <button type="button" className="rush-btn rush-btn--ghost w-full" data-rush-lobby-leave="1" onClick={onLeave}>
          Leave lobby
        </button>
      </div>
    </div>
  );
}
