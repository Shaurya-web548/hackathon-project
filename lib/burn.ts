import { ResolvedStep } from "./types";

/**
 * Simulated token accounting — deterministic, derived from the trace itself.
 * Shows the literal business cost of a failure (a retry loop burns visibly
 * more than a clean run).
 */
export function stepTokens(step: ResolvedStep): number {
  const base = Math.ceil((step.text?.length ?? 0) / 4);
  switch (step.type) {
    case "thought":
      return base + 40; // hidden reasoning overhead
    case "tool_call":
      return base + 25; // tool schema + serialized args
    case "tool_result":
      return base + 15;
    case "final":
      return base + 30;
  }
}

export const runTokens = (steps: ResolvedStep[]) =>
  steps.reduce((sum, s) => sum + stepTokens(s), 0);

/** simulated blended rate, ₹ per 1K tokens */
export const COST_PER_1K_INR = 0.9;

export const tokensToINR = (tokens: number) => (tokens / 1000) * COST_PER_1K_INR;

export const fmtINR = (v: number) =>
  `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
