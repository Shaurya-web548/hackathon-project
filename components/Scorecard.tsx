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
import { RunState } from "@/lib/runner";
import {
  AgentVersion,
  FailureMode,
  Scenario,
  SEVERITY_ORDER,
  VERSIONS,
} from "@/lib/types";

function useSpringNumber(target: number) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 70, damping: 18 });
  const [val, setVal] = useState(0);
  useEffect(() => {
    mv.set(target);
  }, [target, mv]);
  useMotionValueEvent(spring, "change", (v) => setVal(Math.round(v)));
  return val;
}

const scoreColor = (n: number) =>
  n < 40 ? "var(--red)" : n < 75 ? "var(--amber)" : "var(--green)";

const MODE_LABEL: Record<FailureMode, string> = {
  DESTRUCTIVE_ACTION: "Destructive action",
  INJECTION_COMPLIANCE: "Injection compliance",
  HALLUCINATED_CONFIDENCE: "Hallucinated confidence",
  GOAL_DRIFT: "Goal drift",
  TOOL_LOOP: "Tool loop",
  GUESSED_INPUT: "Guessed input",
};

export default function Scorecard({
  scenarios,
  runs,
  version,
  history,
}: {
  scenarios: Scenario[];
  runs: Record<string, RunState>;
  version: AgentVersion;
  history: Partial<Record<AgentVersion, number>>;
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
      <div className="flex flex-col items-center rounded-lg border border-edge bg-panel2 p-4">
        <div className="relative h-[128px] w-[128px]">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <circle cx="64" cy="64" r={R} fill="none" stroke="var(--border)" strokeWidth="8" />
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
              style={{ transition: "stroke 0.4s" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="text-3xl font-bold tabular-nums" style={{ color }}>
                {shown}
              </div>
              <div className="text-[9px] tracking-widest text-ink-dim uppercase">
                reliability
              </div>
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

      {/* ── taxonomy breakdown ──────────────────────────── */}
      <div className="rounded-lg border border-edge bg-panel2 p-4">
        <h3 className="mb-3 text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
          Failure Taxonomy
        </h3>
        <div className="flex flex-col gap-2">
          {byMode.map(({ mode, scenarios: list }) => (
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
                  transition={{ type: "spring", stiffness: 60, damping: 16 }}
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
          className="rounded-lg border border-rd/40 bg-rd/[0.07] p-4"
        >
          <h3 className="mb-1 text-[10px] font-semibold tracking-widest text-rd uppercase">
            ☠ Worst Offender
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
        </motion.div>
      )}

      {/* ── regression chart ────────────────────────────── */}
      <div className="rounded-lg border border-edge bg-panel2 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[10px] font-semibold tracking-widest text-ink-dim uppercase">
            Score by Version
          </h3>
          {delta !== null && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                delta >= 0
                  ? "border-gn/40 bg-gn/10 text-gn"
                  : "border-rd/40 bg-rd/10 text-rd"
              }`}
            >
              {delta >= 0 ? "▲ +" : "▼ "}
              {delta} vs {VERSIONS[vIdx - 1]}
            </span>
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
                dot={{ r: 4, fill: "var(--cyan)", strokeWidth: 0 }}
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
