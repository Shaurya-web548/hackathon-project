import { TOOL_MAP, ToolResult } from "@/data/demoAgent";
import { ResolvedStep, Scenario, TraceStep } from "./types";

/**
 * The Crucible sandbox is SCRIPTED and fully deterministic: each scenario
 * carries a pre-authored trace, and the sandbox streams those steps with
 * their authored latencies. No LLM is called. Tool results, however, are
 * produced by actually invoking the bundled mocked tool functions, so what
 * you see in the console comes from real code paths.
 */

function fmtResult(r: ToolResult): string {
  return r.ok ? JSON.stringify(r.data) : `ERROR ${r.error}`;
}

/**
 * Chaos engineering: with chaosRetries > 0, the first search_flights call in a
 * run deterministically hits injected 503s, and the agent retries that many
 * times before the real result arrives. Agents with a sane retry budget
 * (few retries) degrade gracefully; agents that hammer the tool (>3 retries)
 * get flagged as TOOL_LOOP by the classifier — from real trace structure.
 */
export function resolveTrace(scenario: Scenario, chaosRetries = 0): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  let lastCall: TraceStep | null = null;
  let chaosInjected = false;

  for (const step of scenario.trace) {
    if (step.type === "tool_call") {
      lastCall = step;
      const def = TOOL_MAP[step.tool ?? ""];
      out.push({
        ...step,
        text: step.text ?? `${step.tool}(${JSON.stringify(step.args ?? {})})`,
        destructive: def?.destructive ?? false,
      });
      continue;
    }

    if (step.type === "tool_result") {
      if (
        !chaosInjected &&
        chaosRetries > 0 &&
        lastCall?.tool === "search_flights"
      ) {
        chaosInjected = true;
        for (let i = 0; i < chaosRetries; i++) {
          out.push({
            type: "tool_result",
            tool: lastCall.tool,
            text: "ERROR 503 UPSTREAM_UNAVAILABLE: flight inventory service timed out (chaos injection)",
            error: true,
            latencyMs: 450,
          });
          out.push({
            type: "thought",
            text: `Transient 503 from search_flights — retrying (attempt ${i + 2}).`,
            latencyMs: 300,
          });
          out.push({
            ...lastCall,
            text: `${lastCall.tool}(${JSON.stringify(lastCall.args ?? {})})`,
            destructive: false,
            latencyMs: 300,
          } as ResolvedStep);
        }
      }
      const def = lastCall?.tool ? TOOL_MAP[lastCall.tool] : undefined;
      const result: ToolResult = def
        ? def.run(lastCall?.args ?? {})
        : { ok: false, error: "SANDBOX: tool_result with no preceding tool_call" };
      out.push({
        ...step,
        tool: lastCall?.tool,
        text: fmtResult(result),
        error: !result.ok,
      });
      continue;
    }

    out.push({ ...step, text: step.text ?? "" });
  }

  return out;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });

/**
 * Stream a scenario's resolved steps to `onStep` with authored latencies
 * (300–900ms), so a run looks live while being 100% reproducible.
 * Resolves with the full resolved trace; rejects only on abort.
 */
export async function runScenario(
  scenario: Scenario,
  onStep: (step: ResolvedStep, index: number) => void,
  signal?: AbortSignal,
  chaosRetries = 0,
): Promise<ResolvedStep[]> {
  const steps = resolveTrace(scenario, chaosRetries);
  for (let i = 0; i < steps.length; i++) {
    await sleep(steps[i].latencyMs, signal);
    onStep(steps[i], i);
  }
  return steps;
}
