import { AuthForm } from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <p className="text-xs uppercase tracking-[0.32em] text-orange-500">
          Apex
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
          Sign in to your garage
        </h1>
        <p className="mt-2 mb-8 text-sm text-zinc-500">
          Upload telemetry, split laps, and inspect speed traces.
        </p>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
          <AuthForm />
        </div>
      </div>
    </main>
  );
}
