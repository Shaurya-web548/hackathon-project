"use client";

import { motion } from "framer-motion";
import { RunStatus } from "@/lib/runner";
import { Category, Scenario } from "@/lib/types";

const CATEGORY_STYLES: Record<Category, string> = {
  "Happy Path": "border-gn/40 text-gn",
  Robustness: "border-cy/40 text-cy",
  Safety: "border-am/40 text-am",
  Security: "border-rd/40 text-rd",
  Accuracy: "border-edge-bright text-ink-dim",
};

const DOT: Record<RunStatus, string> = {
  idle: "bg-ink-dim/40",
  running: "bg-am pulse-dot",
  pass: "bg-gn",
  fail: "bg-rd",
};

export default function ScenarioCard({
  scenario,
  status,
  selected,
  onClick,
}: {
  scenario: Scenario;
  status: RunStatus;
  selected: boolean;
  onClick: () => void;
}) {
  const frame =
    status === "running"
      ? "border-am/60 pulse-amber"
      : status === "pass"
        ? "border-gn/50 bg-gn/[0.07]"
        : status === "fail"
          ? "border-rd/50 bg-rd/[0.07] fail-ripple"
          : "border-edge hover:border-edge-bright";

  return (
    <motion.button
      layout
      onClick={onClick}
      animate={status === "fail" ? { x: [0, -5, 5, -4, 4, -2, 0] } : { x: 0 }}
      transition={{ duration: 0.3 }}
      className={`relative rounded-lg border bg-panel2 p-3 text-left transition-colors ${frame} ${
        selected ? "ring-1 ring-cy/60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs leading-snug font-semibold">{scenario.title}</span>
        {status === "pass" ? (
          <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0">
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="var(--green)"
              strokeWidth="3"
              strokeLinecap="round"
              className="check-draw"
            />
          </svg>
        ) : status === "fail" ? (
          <span className="mt-0.5 text-[11px] leading-none font-bold text-rd">✕</span>
        ) : (
          <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${CATEGORY_STYLES[scenario.category]}`}
        >
          {scenario.category}
        </span>
        {scenario.adversarial && (
          <span className="rounded border border-rd/50 bg-rd/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-rd uppercase">
            Adversarial
          </span>
        )}
        {status === "running" && (
          <span className="dots ml-auto font-mono text-[10px] text-am">
            <span>·</span>
            <span>·</span>
            <span>·</span>
          </span>
        )}
      </div>
    </motion.button>
  );
}
