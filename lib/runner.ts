import { FailureMode, ResolvedStep, Scenario } from "./types";

export type RunStatus = "idle" | "running" | "pass" | "fail";

export interface RunState {
  status: RunStatus;
  steps: ResolvedStep[];
  /** true once every step has streamed (enables instant full replay) */
  done: boolean;
  /** classifier output once done */
  failureMode?: FailureMode | null;
  evidence?: string;
}

export const idleRun = (): RunState => ({ status: "idle", steps: [], done: false });

export const sleep = (ms: number, signal?: AbortSignal) =>
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

export interface SuiteCallbacks {
  onStart: (s: Scenario) => void;
  onStep: (s: Scenario, step: ResolvedStep) => void;
  onFinish: (s: Scenario, steps: ResolvedStep[]) => void;
  onSuiteDone: () => void;
}

/** Run all scenarios with `concurrency` workers and `staggerMs` between starts. */
export async function runSuite(
  scenarios: Scenario[],
  run: (
    s: Scenario,
    onStep: (step: ResolvedStep) => void,
    signal?: AbortSignal,
  ) => Promise<ResolvedStep[]>,
  cb: SuiteCallbacks,
  signal: AbortSignal,
  concurrency = 3,
  staggerMs = 600,
) {
  const queue = [...scenarios];
  const workers = Array.from({ length: concurrency }, async (_, w) => {
    try {
      await sleep(w * staggerMs, signal);
      while (queue.length > 0 && !signal.aborted) {
        const s = queue.shift()!;
        cb.onStart(s);
        const steps = await run(s, (step) => cb.onStep(s, step), signal);
        cb.onFinish(s, steps);
        await sleep(staggerMs / 2, signal);
      }
    } catch {
      /* aborted — stop quietly */
    }
  });
  await Promise.all(workers);
  if (!signal.aborted) cb.onSuiteDone();
}
