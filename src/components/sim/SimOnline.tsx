"use client";

import { distinctSimPaints, LAP_CHOICES, MAX_DRIVERS, type SimPlayer, type SimStanding } from "@/lib/sim/online";
import { useState } from "react";

const lapLabel = (n: number) => `${n} lap${n === 1 ? "" : "s"}`;

export function formatRaceTime(ms: number): string {
  if (!(ms > 0)) return "–:––.–––";
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const k = total % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(k).padStart(3, "0")}`;
}

/** Solo menu: race friends online by creating a lobby or joining one with its code. */
export function SimOnlineMenu({
  available,
  name,
  onName,
  joinCode,
  onJoinCode,
  onCreate,
  onJoin,
  busy,
  error,
  disabled,
}: {
  available: boolean;
  name: string;
  onName: (name: string) => void;
  joinCode: string;
  onJoinCode: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  busy: boolean;
  error: string;
  disabled: boolean;
}) {
  if (!available) return <p className="mt-2 text-sm text-zinc-400">Online races aren&apos;t available on this copy of Apex.</p>;
  return (
    <div className="mt-2 grid gap-3" data-sim-online="1">
      <p className="text-sm text-zinc-300">Race up to {MAX_DRIVERS - 1} friends from a standing start. Create a lobby and share its code, or join with one.</p>
      <label className="grid gap-1">
        <span className="sim-label">Your name</span>
        <input
          className="sim-input"
          value={name}
          maxLength={14}
          autoComplete="nickname"
          data-sim-name="1"
          onChange={(e) => onName(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className="sim-btn" data-sim-create="1" disabled={busy || disabled} onClick={onCreate}>
          Create lobby
        </button>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onJoin();
          }}
        >
          <label className="grid gap-1">
            <span className="sim-label">Lobby code</span>
            <input
              className="sim-input sim-input--code w-28"
              value={joinCode}
              maxLength={6}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              data-sim-join-code="1"
              onChange={(e) => onJoinCode(e.target.value.toUpperCase())}
            />
          </label>
          <button type="submit" className="sim-btn" data-sim-join="1" disabled={busy || disabled}>
            Join
          </button>
        </form>
      </div>
      {busy ? (
        <p className="text-sm text-zinc-400" role="status">
          Connecting…
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-300" role="alert" data-sim-online-error="1">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The lobby: the code to share, who is here, the lap count, and Start for the host. */
export function SimLobbyPanel({
  code,
  players,
  hostId,
  myId,
  laps,
  onLaps,
  onStart,
  onLeave,
  note,
}: {
  code: string;
  players: SimPlayer[];
  hostId: string | null;
  myId: string;
  laps: number;
  onLaps: (laps: number) => void;
  onStart: () => void;
  onLeave: () => void;
  note: string;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = hostId === myId;
  const host = players.find((p) => p.id === hostId) ?? null;
  const shownLaps = isHost ? laps : (host?.laps ?? laps);
  const enough = players.length >= 2;

  const invite = () => {
    const url = `${window.location.origin}/sim?lobby=${code}`;
    const share = (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    if (share && window.matchMedia("(pointer: coarse)").matches) {
      void share.call(navigator, { title: "Apex Sim", text: `Race me in Apex Sim: code ${code}`, url }).catch(() => {});
      return;
    }
    void navigator.clipboard?.writeText(url).then(done, done);
  };

  return (
    <div className="mt-4" data-sim-lobby={code}>
      <p className="sim-label">Online lobby · code</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <p className="sim-code" data-sim-lobby-code="1" aria-label={`Lobby code ${code.split("").join(" ")}`}>
          {code}
        </p>
        <button type="button" className="sim-btn" data-sim-invite="1" onClick={invite}>
          {copied ? "Link copied" : "Invite"}
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-400">Friends open Apex Sim, then join with this code (or open your invite link).</p>
      {note ? (
        <p className="mt-2 text-sm text-amber-300" role="status">
          {note}
        </p>
      ) : null}

      <h2 className="sim-label mt-4">
        Drivers {players.length}/{MAX_DRIVERS}
      </h2>
      <ul className="mt-2 grid gap-2" data-sim-players={players.length}>
        {/* The paint each car will race in (repeats repainted, the same on every device). */}
        {distinctSimPaints(players).map((p) => (
          <li key={p.id} className="sim-toggle" data-sim-player={p.id === myId ? "me" : "other"} data-sim-paint={p.paint}>
            <span className="block h-5 w-5 flex-none border-2 border-zinc-300" style={{ background: p.paint }} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
            <span className="flex flex-none gap-2">
              {p.id === hostId ? <span className="sim-label !text-amber-300">Host</span> : null}
              {p.id === myId ? <span className="sim-label !text-sky-300">You</span> : null}
              {p.racing ? <span className="sim-label">Racing</span> : null}
            </span>
          </li>
        ))}
      </ul>

      <h2 className="sim-label mt-4" id="sim-laps-label">
        Race length
      </h2>
      {isHost ? (
        <div className="sim-seg mt-2" role="group" aria-labelledby="sim-laps-label">
          {LAP_CHOICES.map((n) => (
            <button key={n} type="button" aria-pressed={laps === n} data-sim-laps={n} onClick={() => onLaps(n)}>
              {lapLabel(n)}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm" data-sim-laps-shown="1">
          {lapLabel(shownLaps)} · the host picks
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {isHost ? (
          <button type="button" className="sim-btn sim-btn--go" data-sim-lobby-start="1" disabled={!enough} onClick={onStart}>
            {enough ? `Start race (${players.length})` : "Waiting for drivers…"}
          </button>
        ) : (
          <p className="sim-card px-3 py-3 text-sm" data-sim-lobby-wait="1">
            Waiting for {host ? host.name : "the host"} to start
          </p>
        )}
        <button type="button" className="sim-btn" data-sim-lobby-leave="1" onClick={onLeave}>
          Leave lobby
        </button>
      </div>
    </div>
  );
}

/** After your finish: the order, times and best laps, filling in as the others finish. */
export function SimResults({ standings, onBack }: { standings: SimStanding[]; onBack: () => void }) {
  const winner = standings.find((s) => s.finished);
  const waiting = standings.some((s) => !s.finished && !s.gone);
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex justify-center p-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]" data-sim-results="1">
      <div className="sim-panel w-full max-w-md p-4 text-zinc-100">
        <p className="sim-label">Results</p>
        <ol className="mt-2 grid gap-1 text-sm" data-sim-standings="1">
          {standings.map((s, i) => (
            <li key={s.id} className="grid grid-cols-[1.5rem_1rem_1fr_auto] items-center gap-2" data-you={s.you ? "1" : "0"}>
              <span className="sim-time">{i + 1}</span>
              <span className="block h-3.5 w-3.5 border border-zinc-300" style={{ background: s.paint }} aria-hidden />
              <span className={`truncate ${s.you ? "font-semibold text-amber-300" : ""}`}>{s.you ? `${s.name} (you)` : s.name}</span>
              <span className="sim-time text-right">
                {s.gone ? "Left" : !s.finished ? "Racing…" : s === winner ? formatRaceTime(s.finishMs) : `+${((s.finishMs - winner!.finishMs) / 1000).toFixed(3)} s`}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-zinc-400">
          Best laps:{" "}
          {standings
            .filter((s) => s.bestLapMs > 0)
            .map((s) => `${s.name} ${formatRaceTime(s.bestLapMs)}`)
            .join(" · ") || "none valid"}
        </p>
        {waiting ? <p className="mt-1 text-xs text-zinc-400">Waiting for the others to finish. Your car is cooling down on its own.</p> : null}
        <button type="button" className="sim-btn sim-btn--go mt-3 w-full" data-sim-lobby-back="1" onClick={onBack}>
          Back to lobby
        </button>
      </div>
    </div>
  );
}
