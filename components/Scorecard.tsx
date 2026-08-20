"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { versionProfiles } from "@/lib/analysis";
import { fmtINR, runTokens, tokensToINR } from "@/lib/burn";
import { PATCHES } from "@/data/patches";
import { RunState } from "@/lib/runner";
import {
  AgentVersion,
  MODE_LABEL,
  Scenario,
  SEVERITY_ORDER,
  VERSIONS,
} from "@/lib/types";

/** Count up to `target` over ~500ms, guaranteed to end exactly on target.
 *  SSR-safe (renders the final value on the server) and interruptible. */
function useSpringNumber(target: number) {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / 500);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      setVal(v);
      fromRef.current = v;
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    // safety net: rAF is paused in backgrounded tabs, so guarantee the final
    // value lands even if no frames fire (setTimeout still runs when hidden)
    const settle = setTimeout(() => {
      setVal(target);
      fromRef.current = target;
    }, 650);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [target]);
  return val;
}

const scoreColor = (n: number) =>
  n < 40 ? "var(--fail)" : n < 75 ? "var(--warn)" : "var(--pass)";

/** one row of the mode × version matrix */
function FragmentRow({
  label,
  counts,
  max,
  activeIdx,
}: {
  label: string;
  counts: number[];
  max: number;
  activeIdx: number;
}) {
  return (
    <>
      <span className="truncate pr-2 text-ink-dim">{label}</span>
      {counts.map((n, i) => (
        <span
          key={i}
          title={`${label}: ${n} failure${n === 1 ? "" : "s"}`}
          className={`readout mx-auto grid h-5 w-7 place-items-center rounded-[2px] font-mono text-[10px] ${
            i === activeIdx ? "ring-1 ring-edge-bright" : ""
          }`}
          style={{
            background:
              n > 0
                ? `color-mix(in srgb, var(--fail) ${25 + Math.round((55 * n) / max)}%, transparent)`
                : "var(--bg-0)",
            color: n > 0 ? "var(--text-1)" : "var(--text-2)",
          }}
        >
          {n > 0 ? n : "·"}
        </span>
      ))}
    </>
  );
}

export default function Scorecard({
  scenarios,
  runs,
  version,
  history,
  lastRecorded,
  trajectory = [],
  onSelect,
}: {
  scenarios: Scenario[];
  runs: Record<string, RunState>;
  version: AgentVersion;
  history: Partial<Record<AgentVersion, number>>;
  /** version whose score most recently landed — its chart point pops */
  lastRecorded: AgentVersion | null;
  /** cumulative pass-rate (0–100) after each finished run, in finish order */
  trajectory?: number[];
  /** clicking a suite-map cell selects that scenario in the console */
  onSelect?: (id: string) => void;
}) {
  const finished = scenarios.filter((s) => runs[s.id]?.done);
  const passes = finished.filter((s) => runs[s.id].status === "pass");
  const fails = finished.filter((s) => runs[s.id].status === "fail");
  const shownPass = useSpringNumber(passes.length);
  const shownFail = useSpringNumber(fails.length);
  const advTotal = scenarios.filter((s) => s.adversarial).length;
  const advPassed = passes.filter((s) => s.adversarial).length;

  const score = Math.round((passes.length / scenarios.length) * 100);
  const shown = useSpringNumber(score);
  const color = scoreColor(shown);

  // taxonomy breakdown
  const byMode = SEVERITY_ORDER.map((mode) => ({
    mode,
    scenarios: fails.filter((s) => runs[s.id].failureMode === mode),
  }));
  const maxCount = Math.max(1, ...byMode.map((b) => b.scenarios.length));

  // worst offender = highest-severity mode with at least one failure
  const worst = byMode.find((b) => b.scenarios.length > 0);
  const [showPatch, setShowPatch] = useState(false);
  const [copied, setCopied] = useState(false);
  const [judge, setJudge] = useState<
    "idle" | "loading" | "unavailable" | { agrees: boolean; note: string }
  >("idle");

  const secondOpinion = async () => {
    if (!worst || judge === "loading") return;
    setJudge("loading");
    const s = worst.scenarios[0];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: s.title,
          userMessage: s.userMessage,
          trace: runs[s.id].steps.map((st) => `[${st.type}] ${st.text}`).join("\n"),
          verdict: `fail — ${worst.mode}`,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const data = await res.json();
      if (data.ok) {
        setJudge({ agrees: data.agrees, note: data.note });
        return;
      }
    } catch {
      /* fall through */
    }
    setJudge("unavailable");
  };

  // simulated burn accounting
  const tokensOf = (list: Scenario[]) =>
    list.reduce((sum, s) => sum + runTokens(runs[s.id]?.steps ?? []), 0);
  const totalTokens = tokensOf(finished);
  const wastedTokens = tokensOf(fails);
  const worstBurn = [...finished].sort(
    (a, b) => runTokens(runs[b.id].steps) - runTokens(runs[a.id].steps),
  )[0];

  // regression chart
  const chartData = VERSIONS.map((v) => ({
    version: v,
    score: history[v] ?? null,
  }));
  const vIdx = VERSIONS.indexOf(version);
  const prev = vIdx > 0 ? history[VERSIONS[vIdx - 1]] : undefined;
  const curr = history[version];
  const delta = curr !== undefined && prev !== undefined ? curr - prev : null;

  // ring geometry
  const R = 52;
  const C = 2 * Math.PI * R;

  // cross-version profiles (classifier-derived, deterministic)
  const profiles = versionProfiles();
  const curProfile = profiles[vIdx];
  const prevProfile = vIdx > 0 ? profiles[vIdx - 1] : null;
  const CAT_SHORT: [string, string][] = [
    ["Happy Path", "Happy"],
    ["Robustness", "Robust"],
    ["Safety", "Safety"],
    ["Security", "Security"],
    ["Accuracy", "Accuracy"],
  ];
  const radarData = CAT_SHORT.map(([cat, label]) => {
    const c = curProfile.byCategory[cat as keyof typeof curProfile.byCategory];
    const p = prevProfile?.byCategory[cat as keyof typeof curProfile.byCategory];
    return {
      cat: label,
      cur: c ? Math.round((100 * c.pass) / c.total) : 0,
      prev: p ? Math.round((100 * p.pass) / p.total) : null,
    };
  });
  const maxModeCount = Math.max(1, ...profiles.flatMap((p) => Object.values(p.byMode)));

  // run timeline
  const timed = scenarios
    .filter((s) => runs[s.id]?.startedAt)
    .sort((a, b) => (runs[a.id].startedAt ?? 0) - (runs[b.id].startedAt ?? 0));
  const t0 = Math.min(...timed.map((s) => runs[s.id].startedAt ?? Infinity));
  const tEnd = Math.max(t0 + 1, ...timed.map((s) => runs[s.id].finishedAt ?? 0));
  const span = tEnd - t0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── score gauge ─────────────────────────────────── */}
      <div className="flex flex-col items-center rounded-md border border-edge bg-panel2 p-4">
        {finished.length === 0 && (
          <p className="mb-2 text-center text-xs text-ink-dim">
            No results yet. Run the suite to score this agent version.
          </p>
        )}
        <div
          key={finished.length === scenarios.length ? "settled" : "live"}
          className={`relative h-[128px] w-[128px] ${
            finished.length === scenarios.length && finished.length > 0 ? "gauge-settle" : ""
          }`}
        >
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <circle cx="64" cy="64" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
            <circle
              cx="64"
              cy="64"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - shown / 100)}
              style={{ transition: "stroke 400ms, stroke-dashoffset 900ms var(--ease-enter)" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div
                className="font-display readout text-4xl font-semibold"
                style={{ color }}
              >
                {shown}
              </div>
              <div className="eyebrow text-[9px]">reliability</div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid w-full grid-cols-3 gap-2 text-center">
          <div className="rounded border border-gn/30 bg-gn/[0.06] py-1.5">
            <div className="text-sm font-bold text-gn tabular-nums">{shownPass}</div>
            <div className="text-[9px] tracking-wider text-ink-dim uppercase">pass</div>
          </div>
          <div className="rounded border border-rd/30 bg-rd/[0.06] py-1.5">
            <div className="text-sm font-bold text-rd tabular-nums">{shownFail}</div>
            <div className="text-[9px] tracking-wider text-ink-dim uppercase">fail</div>
          </div>
          <div className="rounded border border-edge-bright py-1.5">
            <div className="text-sm font-bold tabular-nums">
              {advPassed}/{advTotal}
            </div>
            <div className="text-[9px] tracking-wider text-ink-dim uppercase">
              adversarial
            </div>
          </div>
        </div>

        {/* score trajectory while the suite runs */}
        {trajectory.length > 1 && (
          <div className="mt-3 w-full">
            <div className="mb-1 flex justify-between text-[9px] text-ink-dim">
              <span>pass rate as results landed</span>
              <span className="readout">{trajectory[trajectory.length - 1]}%</span>
            </div>
            <svg viewBox="0 0 100 22" preserveAspectRatio="none" className="h-6 w-full">
              <line x1="0" y1="21" x2="100" y2="21" stroke="var(--line)" strokeWidth="0.5" />
              <polyline
                points={trajectory
                  .map((p, i) => `${(i / Math.max(trajectory.length - 1, 1)) * 100},${21 - (p / 100) * 19}`)
                  .join(" ")}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        )}
        <p className="mt-2 text-[10px] text-ink-dim">
          Score = scenarios passed ÷ total, judged by the trace classifier — not by
          hand-labeled results.
        </p>
      </div>

      {/* ── suite map: one cell per scenario, rows per category ── */}
      <div className="rounded-md border border-edge bg-panel2 p-4">
        <h3 className="eyebrow mb-3 text-[10px]">Suite map</h3>
        <div className="flex gap-[3px]">
          {scenarios.map((s) => {
            const st = runs[s.id]?.status ?? "idle";
            return (
              <button
                key={s.id}
                onClick={() => onSelect?.(s.id)}
                title={`${s.title} — ${st}${runs[s.id]?.done ? " · click to replay" : ""}`}
                className={`h-5 flex-1 rounded-[2px] border transition-all duration-220 hover:scale-y-125 ${
                  st === "pass"
                    ? "cell-land border-transparent bg-ink/60"
                    : st === "fail"
                      ? "cell-land border-transparent bg-rd"
                      : st === "running"
                        ? "running-pulse border-cy/60 bg-cy/15"
                        : "border-edge bg-transparent"
                }`}
              />
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[9px] text-ink-dim">
          <span>1</span>
          <span>one cell per scenario · ivory pass · burgundy fail · click to replay</span>
          <span className="readout">{scenarios.length}</span>
        </div>

        <div className="mt-3 flex flex-col gap-1.5 border-t border-edge pt-3">
          {[...new Set(scenarios.map((s) => s.category))].map((cat) => {
            const inCat = scenarios.filter((s) => s.category === cat);
            const catDone = inCat.filter((s) => runs[s.id]?.done);
            const catPass = catDone.filter((s) => runs[s.id].status === "pass");
            return (
              <div key={cat} className="flex items-center gap-2">
                <span className="w-[86px] shrink-0 text-[10px] text-ink-dim">{cat}</span>
                <div className="flex flex-1 gap-[2px]">
                  {inCat.map((s) => {
                    const st = runs[s.id]?.status ?? "idle";
                    return (
                      <div
                        key={s.id}
                        title={s.title}
                        className={`h-1.5 flex-1 rounded-[1px] ${
                          st === "pass"
                            ? "bg-ink/60"
                            : st === "fail"
                              ? "bg-rd"
                              : "bg-bg"
                        }`}
                      />
                    );
                  })}
                </div>
                <span className="readout w-8 shrink-0 text-right font-mono text-[10px] text-ink-dim">
                  {catDone.length > 0 ? `${catPass.length}/${inCat.length}` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── category profile radar ──────────────────────── */}
      <div className="rounded-md border border-edge bg-panel2 p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="eyebrow text-[10px]">Category profile</h3>
          <span className="text-[9px] text-ink-dim">
            {version}
            {prevProfile ? ` vs ${prevProfile.version}` : ""} · pass rate
          </span>
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid stroke="var(--line)" />
              <PolarAngleAxis
                dataKey="cat"
                tick={{ fill: "var(--text-2)", fontSize: 10 }}
              />
              {prevProfile && (
                <Radar
                  dataKey="prev"
                  stroke="var(--line-2)"
                  strokeDasharray="4 3"
                  fill="none"
                  isAnimationActive={false}
                />
              )}
              <Radar
                dataKey="cur"
                stroke="var(--accent)"
                strokeWidth={1.5}
                fill="var(--accent)"
                fillOpacity={0.14}
                animationDuration={700}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-center text-[9px] text-ink-dim">
          solid = {version} · dashed = {prevProfile ? prevProfile.version : "—"} ·
          full pentagon = every category clean
        </p>
      </div>

      {/* ── taxonomy breakdown ──────────────────────────── */}
      <div className="rounded-md border border-edge bg-panel2 p-4">
        <h3 className="eyebrow mb-3 text-[10px]">Failure taxonomy</h3>
        <div className="flex flex-col gap-2">
          {byMode.map(({ mode, scenarios: list }, i) => (
            <div
              key={mode}
              title={list.length ? list.map((s) => s.title).join(" · ") : "no failures"}
            >
              <div className="mb-0.5 flex justify-between text-[10px]">
                <span className={list.length ? "text-ink" : "text-ink-dim/60"}>
                  {MODE_LABEL[mode]}
                </span>
                <span className="text-ink-dim tabular-nums">{list.length}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-bg">
                <motion.div
                  className="h-full rounded bg-rd"
                  initial={{ width: 0 }}
                  animate={{ width: `${(list.length / maxCount) * 100}%` }}
                  transition={{ type: "spring", stiffness: 60, damping: 16, delay: i * 0.06 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── failure modes across versions ───────────────── */}
      <div className="rounded-md border border-edge bg-panel2 p-4">
        <h3 className="eyebrow mb-2 text-[10px]">What each release fixed</h3>
        <div className="grid grid-cols-[1fr_repeat(3,34px)] items-center gap-y-1 text-[10px]">
          <span />
          {profiles.map((p) => (
            <span
              key={p.version}
              className={`readout text-center font-mono ${
                p.version === version ? "font-medium text-cy" : "text-ink-dim"
              }`}
            >
              {p.version}
            </span>
          ))}
          {SEVERITY_ORDER.map((mode) => (
            <FragmentRow
              key={mode}
              label={MODE_LABEL[mode]}
              counts={profiles.map((p) => p.byMode[mode])}
              max={maxModeCount}
              activeIdx={vIdx}
            />
          ))}
        </div>
        <p className="mt-2 text-[9px] text-ink-dim">
          failures per mode, classified from each version&apos;s traces — an empty
          column is a clean release
        </p>
      </div>

      {/* ── worst offender ──────────────────────────────── */}
      {worst && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-rd/40 bg-rd/[0.07] p-4"
        >
          <h3 className="mb-1 text-[10px] font-medium tracking-[0.08em] text-rd uppercase">
            Worst offender
          </h3>
          <div className="text-sm font-semibold">{worst.scenarios[0].title}</div>
          <div className="mt-0.5 font-mono text-[11px] text-rd">
            {worst.mode}
          </div>
          {runs[worst.scenarios[0].id]?.evidence && (
            <div className="mt-1.5 text-[11px] leading-snug text-ink-dim">
              {runs[worst.scenarios[0].id].evidence}
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setShowPatch((p) => !p)}
              className="rounded border border-cy/40 bg-cy/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-cy uppercase hover:bg-cy/20"
            >
              {showPatch ? "Hide patch" : "Suggest patch ✦"}
            </button>
            <button
              onClick={secondOpinion}
              disabled={judge === "loading"}
              title="Ask an LLM judge to review the deterministic verdict (optional; rules remain the verdict of record)"
              className={`rounded border px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase ${
                judge === "loading"
                  ? "shimmer cursor-default border-cy/30 text-cy"
                  : "border-edge-bright text-ink-dim hover:text-ink"
              }`}
            >
              {judge === "loading" ? "Judging…" : "Second opinion ✦"}
            </button>
          </div>

          {judge === "unavailable" && (
            <p className="mt-1.5 text-[10px] text-ink-dim">
              LLM judge unavailable — the deterministic verdict stands.
            </p>
          )}
          {typeof judge === "object" && (
            <p className="mt-1.5 text-[10px] leading-snug text-ink-dim">
              <span className={judge.agrees ? "text-ink" : "text-am"}>
                LLM judge {judge.agrees ? "concurs" : "dissents"}
              </span>
              {judge.note && <> — {judge.note}</>}
            </p>
          )}

          {showPatch && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-2 overflow-hidden"
            >
              <div className="mb-1 text-[10px] text-ink-dim">
                {PATCHES[worst.mode].summary}
              </div>
              <div className="rounded border border-edge bg-bg p-2 font-mono text-[10px] leading-relaxed">
                {PATCHES[worst.mode].diff.map((l, i) => (
                  <div
                    key={i}
                    className={l.op === "+" ? "text-gn" : "text-rd line-through opacity-70"}
                  >
                    {l.op} {l.text}
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(
                      PATCHES[worst.mode].diff
                        .filter((l) => l.op === "+")
                        .map((l) => l.text)
                        .join("\n"),
                    )
                    .catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="mt-1.5 rounded border border-edge-bright px-2 py-0.5 text-[10px] text-ink-dim hover:text-ink"
              >
                {copied ? "✓ copied" : "copy additions"}
              </button>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* ── burn tracker ────────────────────────────────── */}
      <div className="rounded-md border border-edge bg-panel2 p-4">
        <h3 className="mb-2 text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
          Resource Burn <span className="normal-case">(simulated)</span>
        </h3>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded border border-edge-bright py-1.5">
            <div className="text-sm font-bold tabular-nums">
              {totalTokens.toLocaleString("en-IN")}
            </div>
            <div className="text-[9px] tracking-wider text-ink-dim uppercase">
              tokens spent
            </div>
          </div>
          <div className="rounded border border-rd/30 bg-rd/[0.06] py-1.5">
            <div className="text-sm font-bold text-rd tabular-nums">
              {fmtINR(tokensToINR(wastedTokens))}
            </div>
            <div className="text-[9px] tracking-wider text-ink-dim uppercase">
              burned on failures
            </div>
          </div>
        </div>
        {finished.length > 0 && (
          <div className="mt-3 flex flex-col gap-1 border-t border-edge pt-2.5">
            {[...finished]
              .sort((a, b) => runTokens(runs[b.id].steps) - runTokens(runs[a.id].steps))
              .slice(0, 6)
              .map((s) => {
                const tk = runTokens(runs[s.id].steps);
                const max = runTokens(runs[worstBurn.id].steps) || 1;
                const failed = runs[s.id].status === "fail";
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelect?.(s.id)}
                    title={`${s.title} — ${tk.toLocaleString("en-IN")} tokens (${fmtINR(tokensToINR(tk))}) · click to replay`}
                    className="group flex items-center gap-2 text-left"
                  >
                    <span className="w-[108px] shrink-0 truncate text-[10px] text-ink-dim group-hover:text-ink">
                      {s.title}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-[1px] bg-bg">
                      <motion.span
                        className={`block h-full ${failed ? "bg-rd" : "bg-ink/40"}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${(tk / max) * 100}%` }}
                        transition={{ type: "spring", stiffness: 60, damping: 18 }}
                      />
                    </span>
                    <span className="readout w-12 shrink-0 text-right font-mono text-[10px] text-ink-dim">
                      {tk.toLocaleString("en-IN")}
                    </span>
                  </button>
                );
              })}
            <p className="mt-1 text-[9px] text-ink-dim">
              tokens per run, costliest first — failures burn the budget
            </p>
          </div>
        )}
      </div>

      {/* ── run timeline: 3 workers racing through the suite ── */}
      {timed.length > 1 && (
        <div className="rounded-md border border-edge bg-panel2 p-4">
          <div className="flex items-baseline justify-between">
            <h3 className="eyebrow text-[10px]">Run timeline</h3>
            <span className="readout text-[9px] text-ink-dim">
              {((tEnd - t0) / 1000).toFixed(1)}s wall clock · 3 concurrent
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-[3px]">
            {timed.map((s) => {
              const r = runs[s.id];
              const start = ((r.startedAt! - t0) / span) * 100;
              const end = r.finishedAt ? ((r.finishedAt - t0) / span) * 100 : 100;
              const dur = r.finishedAt
                ? `${((r.finishedAt - r.startedAt!) / 1000).toFixed(1)}s`
                : "running";
              return (
                <button
                  key={s.id}
                  onClick={() => onSelect?.(s.id)}
                  title={`${s.title} — ${dur} · click to replay`}
                  className="group relative h-[7px] w-full rounded-[1px] bg-bg"
                >
                  <span
                    className={`absolute top-0 bottom-0 rounded-[1px] transition-all duration-220 group-hover:opacity-100 ${
                      r.status === "fail"
                        ? "bg-rd opacity-90"
                        : r.status === "pass"
                          ? "bg-ink/45 opacity-90"
                          : "running-pulse border border-cy/60 bg-cy/15"
                    }`}
                    style={{ left: `${start}%`, width: `${Math.max(end - start, 1.5)}%` }}
                  />
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[9px] text-ink-dim">
            each bar is one scenario, placed in real time — overlaps show the
            sandbox running three at once
          </p>
        </div>
      )}

      {/* ── regression chart ────────────────────────────── */}
      <div className="rounded-md border border-edge bg-panel2 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
            Score by Version
          </h3>
          {delta !== null && (
            <motion.span
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              className={`readout rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                delta >= 0
                  ? "border-gn/40 bg-gn/10 text-gn"
                  : "border-rd/40 bg-rd/10 text-rd"
              }`}
            >
              {delta >= 0 ? "+" : ""}
              {delta} vs {VERSIONS[vIdx - 1]}
            </motion.span>
          )}
        </div>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -26 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="version"
                stroke="var(--text-dim)"
                fontSize={10}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                stroke="var(--text-dim)"
                fontSize={10}
                tickLine={false}
              />
              <Tooltip
                cursor={{ stroke: "var(--line-2)", strokeWidth: 1 }}
                contentStyle={{
                  background: "var(--bg-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: "var(--font-jetbrains), monospace",
                  color: "var(--text-1)",
                }}
                labelStyle={{ color: "var(--text-2)" }}
                formatter={(v) => [String(v ?? ""), "reliability"]}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="var(--cyan)"
                strokeWidth={2}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  if (payload.score === null || cx == null) return <g key={payload.version} />;
                  const isNew = payload.version === lastRecorded;
                  return (
                    <g key={payload.version}>
                      <circle cx={cx} cy={cy} r={4} fill="var(--cyan)" />
                      {isNew && (
                        <circle
                          key={`pop-${payload.score}`}
                          className="point-pop"
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill="none"
                          stroke="var(--cyan)"
                          strokeWidth={1.5}
                        />
                      )}
                    </g>
                  );
                }}
                isAnimationActive
                animationDuration={900}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {Object.keys(history).length === 0 && (
          <div className="mt-1 text-center text-[10px] text-ink-dim">
            run the suite to record a score for {version}
          </div>
        )}
      </div>
    </div>
  );
}
