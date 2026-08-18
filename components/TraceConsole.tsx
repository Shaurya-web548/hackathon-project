"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtINR, runTokens, tokensToINR } from "@/lib/burn";
import { RunState } from "@/lib/runner";
import { ResolvedStep, Scenario } from "@/lib/types";

/* ── helpers ─────────────────────────────────────────────── */

/** indexes of destructive tool_calls with no prior confirmation — tripwires */
function tripwireIndexes(steps: ResolvedStep[]): Set<number> {
  const out = new Set<number>();
  let confirmed = false;
  steps.forEach((s, i) => {
    if (s.flags?.confirmation) confirmed = true;
    if (s.type === "tool_call" && s.destructive && !confirmed) out.add(i);
  });
  return out;
}

const GUTTER: Record<ResolvedStep["type"], string> = {
  thought: "var(--line-2)",
  tool_call: "var(--accent)",
  tool_result: "var(--pass)",
  final: "var(--text-1)",
};

/* ── waveform header strip (doubles as scrub bar) ────────── */

function Waveform({
  steps,
  total,
  tripwires,
  scrub,
  onScrub,
}: {
  steps: ResolvedStep[];
  total: number;
  tripwires: Set<number>;
  scrub: number | null;
  onScrub: (i: number) => void;
}) {
  const W = 100; // viewBox units; SVG stretches
  const H = 24;
  const n = Math.max(total, 1);
  const dx = W / n;
  const pts = steps.map((s, i) => {
    const x = dx * (i + 0.5);
    const y = s.type === "tool_call" ? 5 : s.type === "tool_result" ? (s.error ? 8 : 15) : 18;
    return { x, y, i, s };
  });
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="h-6 shrink-0 border-b border-edge bg-panel px-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full cursor-crosshair"
        onClick={(e) => {
          if (steps.length === 0) return;
          const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          const idx = Math.min(steps.length - 1, Math.max(0, Math.floor(frac * n)));
          onScrub(idx);
        }}
      >
        {pts.length > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="0.6"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {pts.map((p) =>
          tripwires.has(p.i) ? (
            <circle key={p.i} cx={p.x} cy={p.y} r="1.6" fill="var(--warn)" />
          ) : p.s.type === "tool_call" ? (
            <circle key={p.i} cx={p.x} cy={p.y} r="0.9" fill="var(--accent)" />
          ) : null,
        )}
        {scrub !== null && pts[scrub] && (
          <line
            x1={pts[scrub].x}
            y1="0"
            x2={pts[scrub].x}
            y2={H}
            stroke="var(--text-2)"
            strokeWidth="0.4"
          />
        )}
      </svg>
    </div>
  );
}

/* ── one console line ────────────────────────────────────── */

function StepLine({
  step,
  index,
  tripwire,
  animate,
  current,
}: {
  step: ResolvedStep;
  index: number;
  tripwire: boolean;
  animate: boolean;
  current: boolean;
}) {
  const body =
    step.type === "thought" ? (
      <span className="text-ink-dim italic">{step.text}</span>
    ) : step.type === "tool_call" ? (
      <span className="text-cy">
        <span className="select-none">→ </span>
        <span className="font-medium">{step.tool}</span>
        <span className="opacity-75">({JSON.stringify(step.args ?? {})})</span>
      </span>
    ) : step.type === "tool_result" ? (
      <span className={step.error ? "text-rd" : "text-gn"}>
        <span className="select-none">← </span>
        {step.text}
      </span>
    ) : (
      <span className="font-medium text-ink">{step.text}</span>
    );

  return (
    <div
      className={`flex gap-0 ${animate ? "line-in" : ""} ${
        tripwire ? "tripwire-line" : ""
      }`}
    >
      {/* line number + type tick gutter */}
      <span className="w-8 shrink-0 pr-2 text-right text-ink-dim/60 select-none">
        {index + 1}
      </span>
      <span
        className="mt-[5px] mr-2 h-2.5 w-[3px] shrink-0 rounded-none"
        style={{ background: GUTTER[step.type] }}
      />
      <div className="min-w-0 flex-1 pr-2 break-words">
        {body}
        {tripwire && (
          <span className="float-right ml-2 text-[10px] font-medium tracking-wider text-am select-none">
            TRIPWIRE
          </span>
        )}
        {current && <span className="console-cursor ml-1" />}
      </div>
    </div>
  );
}

/* ── the console ─────────────────────────────────────────── */

export default function TraceConsole({
  scenario,
  run,
}: {
  scenario: Scenario | null;
  run: RunState | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [flash, setFlash] = useState(0);
  const runSteps = run?.steps;
  const steps = useMemo(() => runSteps ?? [], [runSteps]);
  const running = run?.status === "running";

  const tripwires = useMemo(() => tripwireIndexes(steps), [steps]);

  // reset scrub when switching scenario or starting a new run
  useEffect(() => setScrub(null), [scenario?.id, running]);

  // flash the console border once when a tripwire line lands
  const tripCount = tripwires.size;
  const prevTrips = useRef(0);
  useEffect(() => {
    if (running && tripCount > prevTrips.current) setFlash((f) => f + 1);
    prevTrips.current = tripCount;
  }, [tripCount, running]);

  const visible = scrub !== null ? steps.slice(0, scrub + 1) : steps;

  // auto-scroll while streaming
  useEffect(() => {
    const el = boxRef.current;
    if (el && scrub === null) el.scrollTop = el.scrollHeight;
  }, [steps.length, scenario?.id, scrub]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-edge bg-bg">
      <Waveform
        steps={steps}
        total={Math.max(steps.length, scenario?.trace.length ?? 8)}
        tripwires={tripwires}
        scrub={scrub}
        onScrub={(i) => setScrub(i)}
      />

      <div
        key={flash}
        ref={boxRef}
        className={`min-h-0 flex-1 overflow-y-auto py-2 font-mono text-[13px] leading-relaxed ${
          flash > 0 ? "tripwire-flash" : ""
        }`}
      >
        {!scenario ? (
          <div className="px-3 text-ink-dim">
            Select a scenario to replay its trace, or run the suite.
          </div>
        ) : (
          <>
            <div className="flex gap-0 text-ink-dim">
              <span className="w-8 shrink-0 pr-2 text-right select-none">·</span>
              <span className="mt-[5px] mr-2 h-2.5 w-[3px] shrink-0 bg-transparent" />
              <div className="min-w-0 flex-1 pr-2">
                run <span className="text-ink">{scenario.id}</span>
                {running && <span className="text-cy"> · live</span>}
                {run?.done && <span> · replay</span>}
                {scrub !== null && (
                  <button
                    onClick={() => setScrub(null)}
                    className="ml-2 text-cy hover:underline"
                  >
                    step {scrub + 1}/{steps.length} — resume
                  </button>
                )}
              </div>
            </div>
            <div className="mb-1 flex gap-0 text-ink-dim">
              <span className="w-8 shrink-0 pr-2 text-right select-none">·</span>
              <span className="mt-[5px] mr-2 h-2.5 w-[3px] shrink-0 bg-transparent" />
              <div className="min-w-0 flex-1 pr-2">user: “{scenario.userMessage}”</div>
            </div>

            {visible.map((step, i) => (
              <StepLine
                key={`${scenario.id}-${i}`}
                step={step}
                index={i}
                tripwire={tripwires.has(i)}
                animate={running && i === steps.length - 1}
                current={running && i === visible.length - 1}
              />
            ))}

            {run?.status === "idle" && (
              <div className="px-10 text-ink-dim">Queued — not run yet.</div>
            )}
            {run?.done && scrub === null && (
              <div className="mt-2 flex gap-0 border-t border-edge pt-1 text-[11px] text-ink-dim">
                <span className="w-8 shrink-0" />
                <div className="readout">
                  run cost {runTokens(steps).toLocaleString("en-IN")} tokens ≈{" "}
                  {fmtINR(tokensToINR(runTokens(steps)))} · simulated
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
