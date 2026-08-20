"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ToolDef } from "@/data/demoAgent";
import { Scenario } from "@/lib/types";

const STAGES = ["Analysing tools…", "Designing adversarial scenarios…"];

export default function AdversaryPanel({
  tools,
  attacks,
  state,
  discarded,
  target,
  onTargetChange,
  onGenerate,
}: {
  tools: ToolDef[];
  /** generated attack scenarios currently on the grid */
  attacks: Scenario[];
  state: "idle" | "loading" | "live" | "fallback";
  discarded: number;
  /** the problem / agent description to break */
  target: string;
  onTargetChange: (v: string) => void;
  onGenerate: () => void;
}) {
  const destructiveCount = tools.filter((t) => t.destructive).length;
  const [stageLabel, setStageLabel] = useState<string | null>(null);

  // staged labels so generation always feels deliberate
  useEffect(() => {
    if (state !== "loading") {
      setStageLabel(null);
      return;
    }
    setStageLabel(STAGES[0]);
    const t = setTimeout(() => setStageLabel(STAGES[1]), 700);
    return () => clearTimeout(t);
  }, [state]);

  // attack-surface geometry: tool chips in a row, attacks as a row below,
  // connector lines from each attack to the tools it targets
  const wrapRef = useRef<HTMLDivElement>(null);
  const toolRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const attackRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [lines, setLines] = useState<
    { x1: number; y1: number; x2: number; y2: number; key: string }[]
  >([]);

  useEffect(() => {
    const compute = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const wb = wrap.getBoundingClientRect();
      const next: typeof lines = [];
      for (const a of attacks) {
        const ae = attackRefs.current[a.id];
        if (!ae) continue;
        const ab = ae.getBoundingClientRect();
        for (const tool of a.targetTools ?? []) {
          const te = toolRefs.current[tool];
          if (!te) continue;
          const tb = te.getBoundingClientRect();
          next.push({
            key: `${a.id}-${tool}`,
            x1: ab.left + ab.width / 2 - wb.left,
            y1: ab.top - wb.top,
            x2: tb.left + tb.width / 2 - wb.left,
            y2: tb.bottom - wb.top,
          });
        }
      }
      setLines(next);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [attacks]);

  return (
    <div className="mb-3 rounded-md border border-edge bg-panel p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="eyebrow flex items-center gap-2">
            ✦ Automated Adversary
            {state === "live" && (
              <span className="h-1.5 w-1.5 rounded-full bg-cy" title="live (Gemini)" />
            )}
            {state === "fallback" && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-ink-dim"
                title="offline fallback"
              />
            )}
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-dim">
            reads the agent&apos;s tools and designs attacks aimed at them
          </p>
        </div>

        <div className="readout flex items-center gap-3 font-mono text-[11px]">
          <span className="text-ink">
            {tools.length}{" "}
            <span className="text-ink-dim">tools detected</span>
          </span>
          <span className="text-am">
            {destructiveCount}{" "}
            <span className="text-ink-dim">destructive</span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {discarded > 0 && (
            <span
              className="text-[10px] text-ink-dim"
              title="attacks that named a non-existent tool were dropped — the adversary is grounded in the real manifest"
            >
              {discarded} invalid attack{discarded === 1 ? "" : "s"} discarded
            </span>
          )}
          <button
            onClick={onGenerate}
            disabled={state === "loading"}
            className={`rounded px-4 py-1.5 text-[13px] font-medium transition-colors ${
              state === "loading"
                ? "shimmer cursor-default text-ink"
                : "bg-am/90 text-[#1a1206] hover:bg-am"
            }`}
          >
            {state === "loading" ? (stageLabel ?? STAGES[0]) : "Generate attacks"}
          </button>
        </div>
      </div>

      {/* the "break my problem" search bar */}
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (state !== "loading") onGenerate();
        }}
      >
        <div className="flex flex-1 items-center gap-2 rounded border border-edge bg-bg px-3 py-2 focus-within:border-am/50">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-dim" aria-hidden>
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <input
            value={target}
            onChange={(e) => onTargetChange(e.target.value)}
            placeholder="Describe your agent or paste the prompt you want broken — the adversary will attack it"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-dim/70 focus:outline-none"
          />
          {target && (
            <button
              type="button"
              onClick={() => onTargetChange("")}
              className="shrink-0 text-ink-dim hover:text-ink"
              aria-label="clear"
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={state === "loading"}
          className={`shrink-0 rounded px-4 py-2 text-[13px] font-medium transition-colors ${
            state === "loading"
              ? "shimmer cursor-default text-ink"
              : "bg-am/90 text-[#1a1206] hover:bg-am"
          }`}
        >
          {state === "loading" ? (stageLabel ?? STAGES[0]) : "Break it"}
        </button>
      </form>

      {/* attack-surface viz */}
      <div ref={wrapRef} className="relative mt-3 border-t border-edge pt-3">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {lines.map((l, i) => (
            <motion.line
              key={l.key}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="var(--warn)"
              strokeWidth={1}
              strokeOpacity={0.5}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.4, delay: i * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
            />
          ))}
        </svg>

        {/* attacks row (top) */}
        {attacks.length > 0 && (
          <div className="relative z-10 mb-3 flex flex-wrap gap-1.5">
            {attacks.map((a) => (
              <span
                key={a.id}
                ref={(el) => {
                  attackRefs.current[a.id] = el;
                }}
                title={a.rationale}
                className="rounded-full border border-am/40 bg-am/[0.08] px-2 py-0.5 text-[10px] text-am"
              >
                {a.title}
              </span>
            ))}
          </div>
        )}

        {/* tools row (bottom) */}
        <div className="relative z-10 flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <span
              key={t.name}
              ref={(el) => {
                toolRefs.current[t.name] = el;
              }}
              className={`rounded border px-2 py-1 font-mono text-[11px] ${
                t.destructive
                  ? "border-am/40 text-am"
                  : "border-edge bg-panel2 text-ink-dim"
              }`}
            >
              {t.name}
            </span>
          ))}
        </div>

        {attacks.length > 0 && (
          <p className="relative z-10 mt-2 text-[9px] text-ink-dim">
            each line runs from an attack to the tool it targets — the adversary
            is aiming at your destructive tools
          </p>
        )}
      </div>
    </div>
  );
}
