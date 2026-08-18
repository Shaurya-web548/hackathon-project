"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AGENT_NAME, AGENT_TAGLINE, SYSTEM_PROMPT, TOOLS } from "@/data/demoAgent";
import { FALLBACK_GENERATED } from "@/data/fallbackGenerated";
import { getScenarios, toRunnable } from "@/data/scenarios";
import { runScenario } from "@/lib/sandbox";
import { classify } from "@/lib/classify";
import { RunState, idleRun, runSuite } from "@/lib/runner";
import { AgentVersion, Scenario, VERSIONS } from "@/lib/types";
import ScenarioCard from "@/components/ScenarioCard";
import Scorecard from "@/components/Scorecard";
import TraceConsole from "@/components/TraceConsole";

/** deterministic chaos retry appetite per version — >3 trips the TOOL_LOOP rule */
const CHAOS_RETRIES: Record<AgentVersion, number> = { "v1.0": 4, "v1.1": 2, "v1.2": 1 };

const STRESS_LABELS = ["Normal User", "Mixed Suite", "Hostile Hacker"];

export default function Home() {
  const [version, setVersion] = useState<AgentVersion>("v1.0");
  const [baseScenarios, setBaseScenarios] = useState<Scenario[]>(() => getScenarios("v1.0"));
  const [extra, setExtra] = useState<Scenario[]>([]);
  /** 0 = Normal User · 1 = Mixed (default) · 2 = Hostile Hacker */
  const [stress, setStress] = useState(1);
  const scenarios = useMemo(() => {
    if (stress === 0) return baseScenarios.filter((s) => !s.adversarial);
    if (stress === 1) return baseScenarios;
    return [...baseScenarios, ...extra];
  }, [baseScenarios, extra, stress]);
  // editable agent-under-test (generation reads these; sandbox runs bundled traces)
  const [agentPrompt, setAgentPrompt] = useState(SYSTEM_PROMPT);
  const [agentTools, setAgentTools] = useState(() =>
    TOOLS.map((t) => `${t.name}${t.destructive ? " (destructive)" : ""} — ${t.description}`).join("\n"),
  );
  const [genState, setGenState] = useState<"idle" | "loading" | "live" | "fallback">("idle");
  const [chaos, setChaos] = useState(false);
  /** was the last suite run under chaos? (chaos runs don't record history) */
  const chaosRunRef = useRef(false);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [history, setHistory] = useState<Partial<Record<AgentVersion, number>>>({});
  const [lastRecorded, setLastRecorded] = useState<AgentVersion | null>(null);
  const [present, setPresent] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [toolFlash, setToolFlash] = useState<{ tool: string; ts: number } | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** run ids where a confirmation step has already streamed */
  const confirmedRuns = useRef<Set<string>>(new Set());

  const fireBanner = (text: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner({ id: Date.now(), text });
    bannerTimer.current = setTimeout(() => setBanner(null), 3000);
  };
  /** user clicked a card — stop auto-following the newest run */
  const pinnedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const switchVersion = (v: AgentVersion) => {
    abortRef.current?.abort();
    setVersion(v);
    setBaseScenarios(getScenarios(v));
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
    confirmedRuns.current = new Set();
    setRuns(Object.fromEntries(scenarios.map((s) => [s.id, idleRun()])));
    setSelectedId(null);
    setSuiteRunning(true);
    setScanKey((k) => k + 1); // fire the scanline sweep

    chaosRunRef.current = chaos;
    runSuite(
      scenarios,
      (s, onStep, signal) =>
        runScenario(s, onStep, signal, chaos ? CHAOS_RETRIES[version] : 0),
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
          if (step.flags?.confirmation) confirmedRuns.current.add(s.id);
          if (step.type === "tool_call" && step.tool) {
            setToolFlash({ tool: step.tool, ts: Date.now() });
            if (step.destructive && !confirmedRuns.current.has(s.id)) {
              const a = step.args ?? {};
              const detail =
                a.amount !== undefined
                  ? `₹${Number(a.amount).toLocaleString("en-IN")}`
                  : String(a.bookingId ?? "");
              fireBanner(`⚠ Unconfirmed destructive action: ${step.tool}(${detail})`);
            }
          }
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
  }, [scenarios, suiteRunning, chaos, version]);

  // abort any in-flight suite on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async () => {
    if (genState === "loading" || suiteRunning) return;
    setGenState("loading");
    let gens = null;
    let source: "live" | "fallback" = "fallback";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemPrompt: agentPrompt, tools: agentTools }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const data = await res.json();
      if (data.ok && Array.isArray(data.scenarios) && data.scenarios.length > 0) {
        gens = data.scenarios;
        source = "live";
      }
    } catch {
      /* silent — fallback below */
    }
    if (!gens) gens = FALLBACK_GENERATED;
    setExtra(gens.map((g: (typeof FALLBACK_GENERATED)[number], i: number) => toRunnable(g, i, source)));
    setGenState(source);
  };

  // record the version's score once a full suite completes
  useEffect(() => {
    if (suiteRunning) return;
    const vals = Object.values(runs);
    if (vals.length === scenarios.length && vals.every((r) => r.done)) {
      if (chaosRunRef.current) return; // chaos runs don't pollute the regression chart
      const passes = vals.filter((r) => r.status === "pass").length;
      const score = Math.round((passes / vals.length) * 100);
      setHistory((prev) => (prev[version] === score ? prev : { ...prev, [version]: score }));
      setLastRecorded(version);
    }
  }, [suiteRunning, runs, scenarios.length, version]);

  // keyboard: R runs the suite, P toggles present mode
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "r" || e.key === "R") startSuite();
      if (e.key === "p" || e.key === "P") setPresent((p) => !p);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [startSuite]);

  const selected = scenarios.find((s) => s.id === selectedId) ?? null;
  const selectedRun = selectedId ? (runs[selectedId] ?? idleRun()) : null;
  const doneCount = Object.values(runs).filter((r) => r.done).length;

  return (
    <div className="flex h-screen flex-col">
      <div className="ambient-grid" aria-hidden />

      {/* destructive-action banner */}
      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner.id}
            initial={{ y: -48, x: "-50%", opacity: 0 }}
            animate={{ y: 12, x: "-50%", opacity: 1 }}
            exit={{ y: -48, x: "-50%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="fixed top-0 left-1/2 z-50 rounded-lg border border-am/60 bg-[#2a2008] px-4 py-2 font-mono text-xs font-semibold text-am shadow-[0_0_24px_rgba(251,191,36,0.25)]"
          >
            {banner.text}
          </motion.div>
        )}
      </AnimatePresence>
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

          <button
            onClick={() => setPresent((p) => !p)}
            title="Toggle present mode (P) — hides the agent panel, enlarges the console"
            className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
              present
                ? "border-cy/50 bg-cy/15 font-semibold text-cy"
                : "border-edge-bright text-ink-dim hover:text-ink"
            }`}
          >
            ▣ Present
          </button>

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
        {/* LEFT — Agent Under Test (hidden in present mode) */}
        <aside
          className={`w-[300px] shrink-0 overflow-y-auto border-r border-edge bg-panel p-4 ${
            present ? "hidden" : ""
          }`}
        >
          <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
            Agent Under Test
          </h2>
          <div className="glow-cyan rounded-lg border border-edge-bright bg-panel2 p-3">
            <div className="text-sm font-semibold text-cy">{AGENT_NAME}</div>
            <div className="mt-1 text-xs text-ink-dim">{AGENT_TAGLINE}</div>
          </div>

          <h3 className="mt-4 mb-2 text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
            System Prompt <span className="normal-case">(editable)</span>
          </h3>
          <textarea
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            spellCheck={false}
            className="h-48 w-full resize-y rounded-lg border border-edge bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink-dim outline-none focus:border-cy/40"
          />

          <h3 className="mt-4 mb-2 text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
            Tools ({TOOLS.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {TOOLS.map((t) => {
              const flashing = toolFlash?.tool === t.name;
              return (
                <span
                  // remount on each flash so the animation replays
                  key={t.name + (flashing ? `-${toolFlash.ts}` : "")}
                  title={t.description}
                  className={`rounded border px-2 py-1 font-mono text-[11px] ${
                    flashing ? "chip-flash" : ""
                  } ${
                    t.destructive
                      ? "border-am/40 bg-am/10 text-am"
                      : "border-edge-bright bg-panel2 text-ink"
                  }`}
                >
                  {t.destructive && "⚠ "}
                  {t.name}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-ink-dim">⚠ = destructive tool</p>

          <h3 className="mt-4 mb-2 text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
            Tool Manifest <span className="normal-case">(editable — read by generation)</span>
          </h3>
          <textarea
            value={agentTools}
            onChange={(e) => setAgentTools(e.target.value)}
            spellCheck={false}
            className="h-28 w-full resize-y rounded-lg border border-edge bg-bg p-3 font-mono text-[10px] leading-relaxed text-ink-dim outline-none focus:border-cy/40"
          />

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
              <div className="flex items-center gap-3">
                {/* stress slider */}
                <label className="flex items-center gap-2 text-[10px] text-ink-dim">
                  <span className="tracking-wider uppercase">Stress</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={1}
                    value={stress}
                    onChange={(e) => {
                      const lvl = Number(e.target.value);
                      setStress(lvl);
                      if (lvl === 2 && extra.length === 0) {
                        setExtra(FALLBACK_GENERATED.map((g, i) => toRunnable(g, i, "fallback")));
                        setGenState("fallback");
                      }
                    }}
                    className="w-24 accent-[var(--red)]"
                  />
                  <span
                    className={`w-[86px] font-semibold whitespace-nowrap ${
                      stress === 2 ? "text-rd" : stress === 0 ? "text-gn" : "text-am"
                    }`}
                  >
                    {STRESS_LABELS[stress]}
                  </span>
                </label>

                {/* chaos toggle */}
                <button
                  onClick={() => !suiteRunning && setChaos((c) => !c)}
                  title="Chaos engineering: deterministically inject 503s + latency into mocked tools mid-run"
                  className={`rounded border px-3 py-1.5 text-xs font-bold tracking-wide transition-colors ${
                    chaos
                      ? "border-am/60 bg-am/15 text-am shadow-[0_0_12px_rgba(251,191,36,0.25)]"
                      : "border-edge-bright text-ink-dim hover:border-am/50 hover:text-am"
                  }`}
                >
                  ☢ CHAOS {chaos ? "ON" : "OFF"}
                </button>

                <button
                  onClick={generate}
                  disabled={genState === "loading" || suiteRunning}
                  title="Generate 4 new adversarial scenarios from the agent panel (falls back to bundled ones offline)"
                  className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-bold tracking-wide transition-colors ${
                    genState === "loading"
                      ? "shimmer cursor-default border-cy/40 text-cy"
                      : "border-edge-bright text-ink-dim hover:border-cy/50 hover:text-cy"
                  }`}
                >
                  {genState !== "idle" && genState !== "loading" && (
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        genState === "live" ? "bg-cy" : "bg-ink-dim"
                      }`}
                    />
                  )}
                  {genState === "loading" ? "GENERATING ✦" : "GENERATE SCENARIOS ✦"}
                </button>
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
            </div>

            <div className="relative grid grid-cols-2 gap-2.5 xl:grid-cols-3">
              {scanKey > 0 && <div key={scanKey} className="scanline" />}
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

          <div
            className={`flex shrink-0 flex-col border-t border-edge bg-panel p-4 ${
              present ? "h-[52%]" : "h-[38%]"
            }`}
          >
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
            lastRecorded={lastRecorded}
          />
        </aside>
      </main>
    </div>
  );
}
