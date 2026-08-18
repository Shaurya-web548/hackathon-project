"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_NAME, AGENT_TAGLINE, SYSTEM_PROMPT, TOOLS } from "@/data/demoAgent";
import { getScenarios } from "@/data/scenarios";
import { runScenario } from "@/lib/sandbox";
import { classify } from "@/lib/classify";
import { RunState, idleRun, runSuite } from "@/lib/runner";
import { AgentVersion, Scenario, VERSIONS } from "@/lib/types";
import ScenarioCard from "@/components/ScenarioCard";
import Scorecard from "@/components/Scorecard";
import TraceConsole from "@/components/TraceConsole";

export default function Home() {
  const [version, setVersion] = useState<AgentVersion>("v1.0");
  const [scenarios, setScenarios] = useState<Scenario[]>(() => getScenarios("v1.0"));
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [history, setHistory] = useState<Partial<Record<AgentVersion, number>>>({});
  /** user clicked a card — stop auto-following the newest run */
  const pinnedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const switchVersion = (v: AgentVersion) => {
    abortRef.current?.abort();
    setVersion(v);
    setScenarios(getScenarios(v));
    setRuns({});
    setSelectedId(null);
    setSuiteRunning(false);
    pinnedRef.current = false;
  };

  const startSuite = useCallback(() => {
    if (suiteRunning) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    pinnedRef.current = false;
    setRuns(Object.fromEntries(scenarios.map((s) => [s.id, idleRun()])));
    setSelectedId(null);
    setSuiteRunning(true);

    runSuite(
      scenarios,
      runScenario,
      {
        onStart: (s) => {
          setRuns((prev) => ({ ...prev, [s.id]: { ...idleRun(), status: "running" } }));
          if (!pinnedRef.current) setSelectedId(s.id);
        },
        onStep: (s, step) => {
          setRuns((prev) => ({
            ...prev,
            [s.id]: { ...prev[s.id], steps: [...prev[s.id].steps, step] },
          }));
        },
        onFinish: (s, steps) => {
          // the classifier — not the authored verdict — decides pass/fail
          const c = classify(s, steps);
          setRuns((prev) => ({
            ...prev,
            [s.id]: {
              status: c.mode ? "fail" : "pass",
              steps,
              done: true,
              failureMode: c.mode,
              evidence: c.mode ? c.evidence[c.mode] : undefined,
            },
          }));
        },
        onSuiteDone: () => setSuiteRunning(false),
      },
      ctrl.signal,
    );
  }, [scenarios, suiteRunning]);

  // abort any in-flight suite on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  // record the version's score once a full suite completes
  useEffect(() => {
    if (suiteRunning) return;
    const vals = Object.values(runs);
    if (vals.length === scenarios.length && vals.every((r) => r.done)) {
      const passes = vals.filter((r) => r.status === "pass").length;
      const score = Math.round((passes / vals.length) * 100);
      setHistory((prev) => (prev[version] === score ? prev : { ...prev, [version]: score }));
    }
  }, [suiteRunning, runs, scenarios.length, version]);

  const selected = scenarios.find((s) => s.id === selectedId) ?? null;
  const selectedRun = selectedId ? (runs[selectedId] ?? idleRun()) : null;
  const doneCount = Object.values(runs).filter((r) => r.done).length;

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
          <span className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-gn" />
            sandbox online
          </span>

          <div className="flex overflow-hidden rounded-full border border-edge-bright text-xs">
            {VERSIONS.map((v) => (
              <button
                key={v}
                onClick={() => switchVersion(v)}
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
            <div className="text-sm font-semibold text-cy">{AGENT_NAME}</div>
            <div className="mt-1 text-xs text-ink-dim">{AGENT_TAGLINE}</div>
          </div>

          <h3 className="mt-4 mb-2 text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
            System Prompt
          </h3>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-edge bg-bg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-dim">
            {SYSTEM_PROMPT}
          </div>

          <h3 className="mt-4 mb-2 text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
            Tools ({TOOLS.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {TOOLS.map((t) => (
              <span
                key={t.name}
                title={t.description}
                className={`rounded border px-2 py-1 font-mono text-[11px] ${
                  t.destructive
                    ? "border-am/40 bg-am/10 text-am"
                    : "border-edge-bright bg-panel2 text-ink"
                }`}
              >
                {t.destructive && "⚠ "}
                {t.name}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink-dim">⚠ = destructive tool</p>

          <h3 className="mt-4 mb-2 text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
            Suite · Agent {version}
          </h3>
          <div className="text-xs text-ink-dim">
            {scenarios.length} scenarios ·{" "}
            {scenarios.filter((s) => s.adversarial).length} adversarial
          </div>
        </aside>

        {/* CENTER — scenarios + trace console */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
                Test Scenarios
                {doneCount > 0 && (
                  <span className="ml-2 normal-case">
                    {doneCount}/{scenarios.length} complete
                  </span>
                )}
              </h2>
              <button
                onClick={startSuite}
                disabled={suiteRunning}
                className={`rounded border px-4 py-1.5 text-xs font-bold tracking-wide transition-colors ${
                  suiteRunning
                    ? "cursor-default border-am/40 bg-am/10 text-am"
                    : "border-cy/50 bg-cy/10 text-cy hover:bg-cy/20"
                }`}
              >
                {suiteRunning ? "RUNNING···" : "RUN SUITE ▶"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
              {scenarios.map((s) => (
                <ScenarioCard
                  key={s.id}
                  scenario={s}
                  status={(runs[s.id] ?? idleRun()).status}
                  selected={s.id === selectedId}
                  onClick={() => {
                    pinnedRef.current = true;
                    setSelectedId(s.id);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex h-[38%] shrink-0 flex-col border-t border-edge bg-panel p-4">
            <h2 className="mb-2 shrink-0 text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
              Trace Console
            </h2>
            <div className="min-h-0 flex-1">
              <TraceConsole scenario={selected} run={selectedRun} />
            </div>
          </div>
        </section>

        {/* RIGHT — Reliability Scorecard */}
        <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-edge bg-panel p-4">
          <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
            Reliability Scorecard
          </h2>
          <Scorecard
            scenarios={scenarios}
            runs={runs}
            version={version}
            history={history}
          />
        </aside>
      </main>
    </div>
  );
}
