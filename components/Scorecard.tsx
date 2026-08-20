"use client";

import { useEffect, useState } from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
} from "framer-motion";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
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

function useSpringNumber(target: number) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 18 });
  const [val, setVal] = useState(0);
  useEffect(() => {
    mv.set(target);
  }, [target, mv]);
  useMotionValueEvent(spring, "change", (v) => setVal(Math.round(v)));
  return val;
}

const scoreColor = (n: number) =>
  n < 40 ? "var(--fail)" : n < 75 ? "var(--warn)" : "var(--pass)";

export default function Scorecard({
  scenarios,
  runs,
  version,
  history,
  lastRecorded,
}: {
  scenarios: Scenario[];
  runs: Record<string, RunState>;
  version: AgentVersion;
  history: Partial<Record<AgentVersion, number>>;
  /** version whose score most recently landed — its chart point pops */
  lastRecorded: AgentVersion | null;
}) {
  const finished = scenarios.filter((s) => runs[s.id]?.done);
  const passes = finished.filter((s) => runs[s.id].status === "pass");
  const fails = finished.filter((s) => runs[s.id].status === "fail");
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
            <div className="text-sm font-bold text-gn tabular-nums">{passes.length}</div>
            <div className="text-[9px] tracking-wider text-ink-dim uppercase">pass</div>
          </div>
          <div className="rounded border border-rd/30 bg-rd/[0.06] py-1.5">
            <div className="text-sm font-bold text-rd tabular-nums">{fails.length}</div>
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
      </div>

      {/* ── suite map: one cell per scenario, rows per category ── */}
      <div className="rounded-md border border-edge bg-panel2 p-4">
        <h3 className="eyebrow mb-3 text-[10px]">Suite map</h3>
        <div className="flex gap-[3px]">
          {scenarios.map((s) => {
            const st = runs[s.id]?.status ?? "idle";
            return (
              <div
                key={s.id}
                title={`${s.title} — ${st}`}
                className={`h-5 flex-1 rounded-[2px] border transition-colors duration-220 ${
                  st === "pass"
                    ? "border-transparent bg-ink/60"
                    : st === "fail"
                      ? "border-transparent bg-rd"
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
          <span>one cell per scenario · ivory pass · burgundy fail</span>
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

          <button
            onClick={() => setShowPatch((p) => !p)}
            className="mt-2 rounded border border-cy/40 bg-cy/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-cy uppercase hover:bg-cy/20"
          >
            {showPatch ? "Hide patch" : "Suggest patch ✦"}
          </button>

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
        {worstBurn && (
          <div className="mt-2 text-[10px] text-ink-dim">
            worst burner:{" "}
            <span className="text-ink">{worstBurn.title}</span> —{" "}
            {runTokens(runs[worstBurn.id].steps).toLocaleString("en-IN")} tokens (
            {fmtINR(tokensToINR(runTokens(runs[worstBurn.id].steps)))})
          </div>
        )}
      </div>

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
