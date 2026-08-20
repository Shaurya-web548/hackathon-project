"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AGENT_NAME, AGENT_TAGLINE, SYSTEM_PROMPT, TOOLS } from "@/data/demoAgent";
import { FALLBACK_GENERATED } from "@/data/fallbackGenerated";
import { FALLBACK_ADVERSARY } from "@/data/fallbackAdversary";
import { getScenarios, toRunnable, attackToScenario } from "@/data/scenarios";
import { runScenario } from "@/lib/sandbox";
import { classify } from "@/lib/classify";
import { RunState, idleRun, runSuite } from "@/lib/runner";
import { AgentVersion, Scenario, VERSIONS } from "@/lib/types";
import AdversaryPanel from "@/components/AdversaryPanel";
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
  // the Automated Adversary's generated attack scenarios
  const [attacks, setAttacks] = useState<Scenario[]>([]);
  /** 0 = Normal User · 1 = Mixed (default) · 2 = Hostile Hacker */
  const [stress, setStress] = useState(1);
  /** "generated" shows only the dynamically generated suite */
  const [view, setView] = useState<"all" | "generated">("all");
  const scenarios = useMemo(() => {
    const pool =
      stress === 0
        ? [...baseScenarios.filter((s) => !s.adversarial), ...attacks]
        : [...baseScenarios, ...extra, ...attacks];
    return view === "generated"
      ? pool.filter((s) => s.generated || s.attack)
      : pool;
  }, [baseScenarios, extra, attacks, stress, view]);
  // editable agent-under-test (generation reads these; sandbox runs bundled traces)
  const [agentPrompt, setAgentPrompt] = useState(SYSTEM_PROMPT);
  const [agentTools, setAgentTools] = useState(() =>
    TOOLS.map((t) => `${t.name}${t.destructive ? " (destructive)" : ""} — ${t.description}`).join("\n"),
  );
  const [genState, setGenState] = useState<"idle" | "loading" | "live" | "fallback">("idle");
  // the Automated Adversary
  const [advState, setAdvState] = useState<"idle" | "loading" | "live" | "fallback">("idle");
  const [advDiscarded, setAdvDiscarded] = useState(0);
  /** the problem / agent the user wants the adversary to break */
  const [attackTarget, setAttackTarget] = useState("");
  const [pulseRun, setPulseRun] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [chaos, setChaos] = useState(false);
  /** was the last suite run under chaos? (chaos runs don't record history) */
  const chaosRunRef = useRef(false);
  /** cumulative pass-rate after each finished run, in finish order */
  const [trajectory, setTrajectory] = useState<number[]>([]);
  const trajRef = useRef({ done: 0, passed: 0 });
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
    trajRef.current = { done: 0, passed: 0 };
    setTrajectory([]);

    chaosRunRef.current = chaos;
    runSuite(
      scenarios,
      (s, onStep, signal) =>
        runScenario(s, onStep, signal, chaos ? CHAOS_RETRIES[version] : 0),
      {
        onStart: (s) => {
          setRuns((prev) => ({
            ...prev,
            [s.id]: { ...idleRun(), status: "running", startedAt: Date.now() },
          }));
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
              fireBanner(`Unconfirmed destructive action · ${step.tool}(${detail})`);
            }
          }
        },
        onFinish: (s, steps) => {
          // the classifier — not the authored verdict — decides pass/fail
          const c = classify(s, steps);
          trajRef.current.done += 1;
          if (c.mode === null) trajRef.current.passed += 1;
          setTrajectory((prev) => [
            ...prev,
            Math.round((100 * trajRef.current.passed) / trajRef.current.done),
          ]);
          setRuns((prev) => ({
            ...prev,
            [s.id]: {
              status: c.mode ? "fail" : "pass",
              steps,
              done: true,
              failureMode: c.mode,
              evidence: c.mode ? c.evidence[c.mode] : undefined,
              startedAt: prev[s.id]?.startedAt,
              finishedAt: Date.now(),
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

  // ?present=1 and ?autoplay=1 (the landing page's "Watch a 60s run")
  const autoplayed = useRef(false);
  const startSuiteRef = useRef(startSuite);
  startSuiteRef.current = startSuite;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("present") === "1") setPresent(true);
    if (params.get("autoplay") === "1" && !autoplayed.current) {
      autoplayed.current = true;
      const t = setTimeout(() => startSuiteRef.current(), 900);
      return () => clearTimeout(t);
    }
  }, []);

  const generate = async () => {
    if (genState === "loading" || suiteRunning) return;
    setGenState("loading");
    let gens = null;
    let source: "live" | "fallback" = "fallback";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemPrompt: agentPrompt,
          tools: agentTools,
          count: 10,
          // the stress slider drives generation aggression too
          aggression: stress === 0 ? "normal" : stress === 1 ? "mixed" : "hostile",
        }),
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
  const generatedVisible = scenarios.filter((s) => s.generated && !s.attack);

  /** The Automated Adversary: tool-aware attack generation. */
  const generateAttacks = async () => {
    if (advState === "loading") return;
    setAdvState("loading");
    setAdvDiscarded(0);
    // staged feel: never resolve faster than ~1.4s even on a fast/cached call
    const minDelay = new Promise((r) => setTimeout(r, 1400));
    let result: { attacks: unknown[]; discarded: number; source: "live" | "fallback" } = {
      attacks: FALLBACK_ADVERSARY,
      discarded: 0,
      source: "fallback",
    };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch("/api/adversary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // the user's typed problem takes priority over the bundled prompt
          agentPrompt: attackTarget.trim() || agentPrompt,
          tools: TOOLS.map((tl) => ({
            name: tl.name,
            description: tl.description,
            destructive: tl.destructive,
          })),
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const data = await res.json();
      if (data.ok && Array.isArray(data.attacks) && data.attacks.length > 0) {
        result = { attacks: data.attacks, discarded: data.discarded ?? 0, source: "live" };
      }
    } catch {
      /* silent — fallback */
    }
    await minDelay;
    setAttacks(
      result.attacks.map((a, i) =>
        attackToScenario(a as Parameters<typeof attackToScenario>[0], i, result.source),
      ),
    );
    setAdvDiscarded(result.discarded);
    setAdvState(result.source);
    setView("all");
    setPulseRun(true);
    setTimeout(() => setPulseRun(false), 2400);
    // auto-scroll the grid to the new attacks
    setTimeout(() => {
      gridRef.current?.scrollTo({ top: gridRef.current.scrollHeight, behavior: "smooth" });
    }, 200);
  };
  const attackList = scenarios.filter((s) => s.attack);

  // record the version's score once a full suite completes
  useEffect(() => {
    if (suiteRunning) return;
    const vals = Object.values(runs);
    if (vals.length === scenarios.length && vals.every((r) => r.done)) {
      if (chaosRunRef.current) return; // chaos runs don't pollute the regression chart
      // only a full bundled-suite run records a comparable score
      if (vals.length !== getScenarios(version).length) return;
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

  const anyDone = Object.values(runs).some((r) => r.done);

  return (
    <div className={`flex h-screen flex-col ${present ? "present-zoom" : ""}`}>
      {/* ── Header ─────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.22 }}
        className="flex h-14 shrink-0 items-center gap-5 border-b border-edge bg-panel px-4"
      >
        <Link href="/" className="leading-none" title="Back to the front page">
          <div className="font-display text-[17px] font-semibold tracking-[0.04em]">
            CRUCIBLE
          </div>
          <div className="eyebrow mt-0.5 text-[9px]">CI for AI agents</div>
        </Link>

        {/* version selector — segmented control */}
        <div
          role="tablist"
          aria-label="Agent version"
          className="flex rounded border border-edge bg-bg p-0.5 text-xs"
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const i = VERSIONS.indexOf(version);
            const next =
              e.key === "ArrowRight"
                ? Math.min(i + 1, VERSIONS.length - 1)
                : Math.max(i - 1, 0);
            switchVersion(VERSIONS[next]);
            (
              e.currentTarget.querySelectorAll("button")[next] as HTMLButtonElement
            )?.focus();
          }}
        >
          {VERSIONS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={version === v}
              tabIndex={version === v ? 0 : -1}
              onClick={() => switchVersion(v)}
              className="relative px-3 py-1 text-ink-dim transition-colors aria-selected:text-ink"
            >
              {version === v && (
                <motion.span
                  layoutId="seg-indicator"
                  transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                  className="absolute inset-0 rounded-[3px] bg-panel2 ring-1 ring-edge-bright"
                />
              )}
              <span className="readout relative">{v}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* honesty chip — always visible, truncates before it hides */}
          <span className="max-w-[38vw] truncate rounded-full border border-edge px-3 py-1 text-[11px] text-ink-dim">
            Sandbox · mocked tools · demo agent bundled
          </span>

          <span
            className="flex items-center gap-1.5 text-[11px] text-ink-dim"
            title="Deterministic sandbox — no network"
          >
            <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-gn" />
            sandbox
          </span>

          <button
            onClick={() => setPresent((p) => !p)}
            title="Present mode (P) — hides the agent panel, enlarges the console"
            className={`rounded border px-2.5 py-1 text-[11px] transition-colors ${
              present
                ? "border-cy/50 bg-cy/10 text-cy"
                : "border-edge text-ink-dim hover:border-edge-bright hover:text-ink"
            }`}
          >
            Present
          </button>

          <motion.button
            onClick={startSuite}
            disabled={suiteRunning}
            whileTap={{ scale: 0.98 }}
            animate={pulseRun ? { scale: [1, 1.06, 1] } : { scale: 1 }}
            transition={pulseRun ? { duration: 0.6, repeat: 3 } : { duration: 0.15 }}
            className={`rounded px-4 py-1.5 text-[13px] font-medium transition-colors ${
              suiteRunning
                ? "cursor-default bg-panel2 text-ink-dim"
                : "bg-cy text-[#F5EDE8] hover:bg-[color-mix(in_srgb,var(--accent)_88%,white)]"
            }`}
          >
            {suiteRunning
              ? `Running ${scenarios.length} scenarios…`
              : anyDone
                ? "Run again"
                : "Run suite"}
          </motion.button>
        </div>
      </motion.header>

      {/* ── Body: three columns ≥1024 · right stacks ≤1024 · single column ≤768 ── */}
      <main
        className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden ${
          present
            ? "lg:grid-cols-[minmax(0,1fr)_360px]"
            : "lg:grid-cols-[300px_minmax(0,1fr)_360px]"
        }`}
      >
        {/* LEFT — Agent under test (hidden in present mode) */}
        <motion.aside
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08, duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className={`border-b border-edge bg-panel p-4 md:border-r md:border-b-0 lg:min-h-0 lg:overflow-y-auto ${
            present ? "hidden" : ""
          }`}
        >
          <h2 className="eyebrow mb-3">Agent under test</h2>
          <div className="rounded-md border border-edge bg-panel2 p-3">
            <div className="text-sm font-medium text-ink">{AGENT_NAME}</div>
            <div className="mt-0.5 text-xs text-ink-dim">{AGENT_TAGLINE}</div>
          </div>

          <h3 className="eyebrow mt-4 mb-2 text-[10px]">
            System prompt <span className="normal-case">(editable)</span>
          </h3>
          <textarea
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            spellCheck={false}
            className="h-48 w-full resize-y rounded-md border border-edge bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink-dim outline-none focus:border-cy/40"
          />

          <h3 className="eyebrow mt-4 mb-2 text-[10px]">Tools ({TOOLS.length})</h3>
          <div className="flex flex-wrap gap-1.5">
            {TOOLS.map((t) => {
              const flashing = toolFlash?.tool === t.name;
              return (
                <span
                  // remount on each flash so the animation replays
                  key={t.name + (flashing ? `-${toolFlash.ts}` : "")}
                  title={
                    t.honeypot
                      ? `${t.description} — honeypot: no legitimate task calls this`
                      : t.destructive
                        ? `${t.description} — destructive`
                        : t.description
                  }
                  className={`flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] ${
                    flashing ? "chip-flash" : ""
                  } ${t.honeypot ? "border-dashed" : ""} ${
                    t.destructive
                      ? "border-am/40 text-am"
                      : "border-edge bg-panel2 text-ink"
                  }`}
                >
                  {t.destructive && (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 shrink-0" aria-label="destructive">
                      <rect x="2.5" y="5" width="7" height="5.5" rx="1" fill="none" stroke="currentColor" />
                      <path d="M4 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" />
                    </svg>
                  )}
                  {t.name}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-ink-dim">
            lock = destructive · dashed = honeypot trap
          </p>

          <h3 className="eyebrow mt-4 mb-2 text-[10px]">
            Tool manifest <span className="normal-case">(read by generation)</span>
          </h3>
          <textarea
            value={agentTools}
            onChange={(e) => setAgentTools(e.target.value)}
            spellCheck={false}
            className="h-28 w-full resize-y rounded-md border border-edge bg-bg p-3 font-mono text-[10px] leading-relaxed text-ink-dim outline-none focus:border-cy/40"
          />

          <h3 className="eyebrow mt-4 mb-2 text-[10px]">Suite · {version}</h3>
          <div className="readout text-xs text-ink-dim">
            {scenarios.length} scenarios ·{" "}
            {scenarios.filter((s) => s.adversarial).length} adversarial
          </div>
        </motion.aside>

        {/* CENTER — scenarios + trace console */}
        <section className="relative flex min-h-0 min-w-0 flex-col">
          {/* tripwire banner — drops from the top of this column */}
          <AnimatePresence>
            {banner && (
              <motion.div
                key={banner.id}
                initial={{ y: -40, x: "-50%", opacity: 0 }}
                animate={{ y: 8, x: "-50%", opacity: 1 }}
                exit={{ y: -40, x: "-50%", opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute top-0 left-1/2 z-40 rounded-md border border-am/50 bg-panel2 px-4 py-2 font-mono text-xs text-am"
              >
                {banner.text}
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            {!present && (
              <AdversaryPanel
                tools={TOOLS}
                attacks={attackList}
                state={advState}
                discarded={advDiscarded}
                target={attackTarget}
                onTargetChange={setAttackTarget}
                onGenerate={generateAttacks}
              />
            )}
            <div className="mb-3 flex items-center justify-between">
              <h2 className="eyebrow flex items-center gap-2">
                Test scenarios
                {doneCount > 0 && (
                  <span className="readout normal-case">
                    {doneCount}/{scenarios.length} complete
                  </span>
                )}
                {(extra.length > 0 || attacks.length > 0) && (
                  <span className="flex overflow-hidden rounded-full border border-edge normal-case">
                    {(["all", "generated"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className={`px-2 py-0.5 text-[10px] transition-colors ${
                          view === v ? "bg-panel2 text-ink" : "text-ink-dim hover:text-ink"
                        }`}
                      >
                        {v === "all" ? "All" : "Generated only"}
                      </button>
                    ))}
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
                  title="Chaos: deterministically inject 503s + latency into mocked tools mid-run"
                  className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                    chaos
                      ? "border-am/50 bg-am/10 text-am"
                      : "border-edge text-ink-dim hover:border-edge-bright hover:text-ink"
                  }`}
                >
                  Chaos {chaos ? "on" : "off"}
                </button>

                <button
                  onClick={generate}
                  disabled={genState === "loading" || suiteRunning}
                  title="Generate 4 new adversarial scenarios from the agent panel (bundled fallback offline)"
                  className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-colors ${
                    genState === "loading"
                      ? "shimmer cursor-default border-cy/40 text-cy"
                      : "border-edge text-ink-dim hover:border-edge-bright hover:text-ink"
                  }`}
                >
                  {genState !== "idle" && genState !== "loading" && (
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        genState === "live" ? "bg-cy" : "bg-ink-dim"
                      }`}
                    />
                  )}
                  {genState === "loading" ? "Generating…" : "Generate scenarios"}
                </button>
              </div>
            </div>

            <div className="relative grid grid-cols-2 gap-2 xl:grid-cols-3">
              {scanKey > 0 && <div key={scanKey} className="scanline" />}
              {scenarios.map((s, i) => (
                <ScenarioCard
                  key={s.id}
                  scenario={s}
                  status={(runs[s.id] ?? idleRun()).status}
                  failureMode={runs[s.id]?.failureMode}
                  selected={s.id === selectedId}
                  index={i}
                  onClick={() => {
                    pinnedRef.current = true;
                    setSelectedId(s.id);
                  }}
                />
              ))}
            </div>

            {/* generated suite detail — the engine's raw output, as a table */}
            {generatedVisible.length > 0 && (
              <div className="mt-4 overflow-x-auto rounded-md border border-edge">
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-edge text-[9px] tracking-[0.08em] text-ink-dim uppercase">
                      <th className="px-2.5 py-1.5 font-medium">Test type</th>
                      <th className="px-2.5 py-1.5 font-medium">User input</th>
                      <th className="px-2.5 py-1.5 font-medium">Expected safe behavior</th>
                      <th className="px-2.5 py-1.5 font-medium">Forbidden tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generatedVisible.map((s) => (
                      <tr key={s.id} className="border-b border-edge last:border-b-0 align-top">
                        <td className="px-2.5 py-1.5 whitespace-nowrap text-ink">{s.title}</td>
                        <td className="px-2.5 py-1.5 text-ink-dim">“{s.userMessage}”</td>
                        <td className="px-2.5 py-1.5 text-ink-dim">{s.expectedBehavior}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[10px] text-rd">
                          {s.forbiddenTools?.length ? s.forbiddenTools.join(", ") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            className={`flex h-[340px] shrink-0 flex-col border-t border-edge bg-panel p-4 ${
              present ? "lg:h-[60%]" : "lg:h-[40%]"
            }`}
          >
            <h2 className="eyebrow mb-2 shrink-0">Trace console</h2>
            <div className="min-h-0 flex-1">
              <TraceConsole scenario={selected} run={selectedRun} />
            </div>
          </motion.div>
        </section>

        {/* RIGHT — Reliability scorecard */}
        <motion.aside
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.16, duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className="border-t border-edge bg-panel p-4 md:col-span-2 lg:col-span-1 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l"
        >
          <h2 className="eyebrow mb-3">Reliability scorecard</h2>
          <Scorecard
            scenarios={scenarios}
            runs={runs}
            version={version}
            history={history}
            lastRecorded={lastRecorded}
            trajectory={trajectory}
            onSelect={(id) => {
              pinnedRef.current = true;
              setSelectedId(id);
            }}
          />
        </motion.aside>
      </main>
    </div>
  );
}
