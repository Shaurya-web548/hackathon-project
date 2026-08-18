"use client";

import { motion } from "framer-motion";
import { RunStatus } from "@/lib/runner";
import { FailureMode, MODE_LABEL, Scenario } from "@/lib/types";

export default function ScenarioCard({
  scenario,
  status,
  failureMode,
  selected,
  index,
  onClick,
}: {
  scenario: Scenario;
  status: RunStatus;
  failureMode?: FailureMode | null;
  selected: boolean;
  /** grid position, drives the entrance cascade */
  index: number;
  onClick: () => void;
}) {
  const frame =
    status === "running"
      ? "running-pulse border-cy/60"
      : status === "pass"
        ? "border-[color-mix(in_srgb,var(--pass)_40%,transparent)]"
        : status === "fail"
          ? "fail-shake border-[color-mix(in_srgb,var(--fail)_55%,transparent)]"
          : "border-edge hover:border-edge-bright";

  const statusLabel =
    status === "idle"
      ? "Queued"
      : status === "running"
        ? "Running"
        : status === "pass"
          ? "Pass"
          : failureMode
            ? `Fail — ${MODE_LABEL[failureMode]}`
            : "Fail";

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className={`relative rounded-md border bg-panel2 p-3 text-left transition-colors duration-220 ${frame} ${
        selected ? "ring-1 ring-cy/50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] leading-snug font-medium">{scenario.title}</span>

        {status === "pass" ? (
          <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0">
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="var(--pass)"
              strokeWidth="3"
              strokeLinecap="round"
              className="check-draw"
            />
          </svg>
        ) : status === "fail" ? (
          <span className="dot-ripple mt-1 h-2 w-2 shrink-0 rounded-full bg-rd" />
        ) : status === "running" ? (
          <span className="dots mt-0.5 shrink-0 font-mono text-[11px] text-cy">
            <span>·</span>
            <span>·</span>
            <span>·</span>
          </span>
        ) : (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-ink-dim/40" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-edge px-1.5 py-0.5 text-[9px] font-medium tracking-[0.08em] text-ink-dim uppercase">
          {scenario.category}
        </span>
        {scenario.adversarial && (
          <span className="rounded-full border border-rd/50 bg-rd/10 px-1.5 py-0.5 text-[9px] font-medium tracking-[0.08em] text-rd uppercase">
            Adversarial
          </span>
        )}
        {scenario.generated && (
          <span
            title={scenario.rationale}
            className="shimmer flex items-center gap-1 rounded-full border border-cy/40 px-1.5 py-0.5 text-[9px] font-medium tracking-[0.08em] text-cy uppercase"
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                scenario.source === "live" ? "bg-cy" : "bg-ink-dim"
              }`}
            />
            AI-generated
          </span>
        )}
      </div>

      <div
        className={`mt-1.5 text-[11px] ${
          status === "fail"
            ? "text-rd"
            : status === "pass"
              ? "text-gn"
              : status === "running"
                ? "text-cy"
                : "text-ink-dim"
        }`}
      >
        {statusLabel}
      </div>
    </motion.button>
  );
}
