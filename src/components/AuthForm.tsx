"use client";

import {
  claimAnonymousAccount,
  ensureAuthenticatedUser,
  isAnonymousUser,
} from "@/lib/guest-auth";
import { resolveSignUpOutcome } from "@/lib/signup-outcome";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export function AuthForm() {
  const router = useRouter();
  const configured = hasSupabaseConfig();
  const [mode, setMode] = useState<"login" | "signup" | "claim">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guestReady, setGuestReady] = useState(false);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled) return;
        if (isAnonymousUser(data.user)) {
          setGuestReady(true);
          setMode("claim");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [configured]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!configured) {
      setError("Add your Supabase URL and anon key to .env.local first.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "claim") {
        await ensureAuthenticatedUser(supabase);
        await claimAnonymousAccount(supabase, { email, password });
        setMessage(
          "Check your email to confirm, then you can sign in with this address on any device.",
        );
      } else if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        const outcome = resolveSignUpOutcome(data, signUpError);
        if (outcome.kind === "error") {
          setError(outcome.message);
          return;
        }
        if (outcome.kind === "signed_in") {
          router.replace("/account");
          router.refresh();
          return;
        }
        // session null + unconfirmed user → only when confirm-email is on
        setMessage("Check your email to confirm the account, then sign in.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        router.replace("/account");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {!configured ? (
        <p className="rounded-lg border border-amber-900/70 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          Missing Supabase env vars. Copy <code>.env.example</code> to{" "}
          <code>.env.local</code> and add your project keys.
        </p>
      ) : null}
      {mode === "claim" ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-400">
          You&apos;re browsing as a guest. Add an email to keep your uploaded
          sessions across devices.
        </p>
      ) : null}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-400">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-400">Password</span>
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
        />
      </label>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-1 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:opacity-50"
      >
        {busy
          ? "Working…"
          : mode === "claim"
            ? "Keep my sessions"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
      </button>
      <button
        type="button"
        onClick={() => {
          if (mode === "claim") {
            setMode("login");
          } else if (mode === "login") {
            setMode(guestReady ? "claim" : "signup");
          } else {
            setMode("login");
          }
          setError(null);
          setMessage(null);
        }}
        className="text-sm text-zinc-400 hover:text-zinc-200"
      >
        {mode === "claim"
          ? "Already have an account? Sign in"
          : mode === "login"
            ? guestReady
              ? "Keep guest sessions with an email"
              : "Need an account? Sign up"
            : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
