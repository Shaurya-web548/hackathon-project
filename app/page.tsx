"use client";

import { useState } from "react";

const VERSIONS = ["v1.0", "v1.1", "v1.2"] as const;
export type AgentVersion = (typeof VERSIONS)[number];

export default function Home() {
  const [version, setVersion] = useState<AgentVersion>("v1.0");

  return (
    <div className="flex h-screen flex-col">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-4 border-b border-edge bg-panel px-5 py-3">
        <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">
          🔥 Crucible{" "}
          <span className="font-normal text-ink-dim">— CI for AI Agents</span>
        </h1>

        {/* honesty chip — always visible */}
        <span className="hidden rounded-full border border-edge-bright bg-panel2 px-3 py-1 text-[11px] text-ink-dim md:inline-block">
          Sandbox with mocked tools · Demo agent bundled · Bring your own agent
          (roadmap)
        </span>

        <div className="ml-auto flex items-center gap-3">
          {/* sandbox status */}
          <span className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-gn" />
            sandbox online
          </span>

          {/* version selector */}
          <div className="flex overflow-hidden rounded-full border border-edge-bright text-xs">
            {VERSIONS.map((v) => (
              <button
                key={v}
                onClick={() => setVersion(v)}
                className={`px-3 py-1 transition-colors ${
                  version === v
                    ? "bg-cy/15 font-semibold text-cy"
                    : "text-ink-dim hover:text-ink"
                }`}
              >
                Agent {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Body: three columns ────────────────────────────── */}
      <main className="flex min-h-0 flex-1">
        {/* LEFT — Agent Under Test */}
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-edge bg-panel p-4">
          <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
            Agent Under Test
          </h2>
          <div className="glow-cyan rounded-lg border border-edge-bright bg-panel2 p-3">
            <div className="text-sm font-semibold text-cy">TravelDesk Agent</div>
            <div className="mt-1 text-xs text-ink-dim">
              Corporate travel booking &amp; refunds
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-dim">
            System prompt and tool manifest load in Stage&nbsp;2.
          </p>
        </aside>

        {/* CENTER — scenarios + trace console */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
                Test Scenarios
              </h2>
              <button className="cursor-not-allowed rounded border border-edge-bright bg-panel2 px-4 py-1.5 text-xs font-semibold text-ink-dim">
                RUN SUITE ▶
              </button>
            </div>
            <div className="grid place-items-center rounded-lg border border-dashed border-edge py-16 text-xs text-ink-dim">
              Scenario grid — Stage 3
            </div>
          </div>

          <div className="h-[38%] shrink-0 border-t border-edge bg-panel p-4">
            <h2 className="mb-2 text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
              Trace Console
            </h2>
            <div className="h-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-edge bg-bg p-3 font-mono text-xs text-ink-dim">
              <span className="text-cy">crucible</span>@sandbox:~$ awaiting run…
            </div>
          </div>
        </section>

        {/* RIGHT — Reliability Scorecard */}
        <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-edge bg-panel p-4">
          <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
            Reliability Scorecard
          </h2>
          <div className="grid place-items-center rounded-lg border border-dashed border-edge py-24 text-xs text-ink-dim">
            Scorecard — Stage 4
          </div>
        </aside>
      </main>
    </div>
  );
}
