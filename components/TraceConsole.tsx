"use client";

import { useEffect, useRef, useState } from "react";
import { RunState } from "@/lib/runner";
import { ResolvedStep, Scenario } from "@/lib/types";

/** Reveals text character-by-character once, then stays static. */
function Typewriter({ text, enabled }: { text: string; enabled: boolean }) {
  const [n, setN] = useState(enabled ? 0 : text.length);
  useEffect(() => {
    if (!enabled) return;
    let i = 0;
    const step = Math.max(2, Math.ceil(text.length / 24)); // ~350ms total
    const id = setInterval(() => {
      i = Math.min(text.length, i + step);
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, 15);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{text.slice(0, n)}</>;
}

function StepLine({ step, animate }: { step: ResolvedStep; animate: boolean }) {
  if (step.type === "thought") {
    return (
      <div className="text-ink-dim italic">
        <span className="mr-2 select-none">·</span>
        <Typewriter text={step.text} enabled={animate} />
      </div>
    );
  }

  if (step.type === "tool_call") {
    const args = JSON.stringify(step.args ?? {});
    return (
      <div
        className={
          step.destructive ? "destructive-glow rounded bg-am/10 px-1 text-cy" : "text-cy"
        }
      >
        {step.destructive && (
          <span className="mr-1 font-bold text-am" title="destructive tool">
            ⚠
          </span>
        )}
        <span className="mr-2 select-none">→</span>
        <span className="font-semibold">{step.tool}</span>
        <span className="text-cy/70">
          (<Typewriter text={args} enabled={animate} />)
        </span>
      </div>
    );
  }

  if (step.type === "tool_result") {
    return (
      <div className={step.error ? "text-rd" : "text-gn"}>
        <span className="mr-2 select-none">←</span>
        <Typewriter text={step.text} enabled={animate} />
      </div>
    );
  }

  return (
    <div className="font-bold text-ink">
      <span className="mr-2 select-none text-ink-dim">■</span>
      <Typewriter text={step.text} enabled={animate} />
    </div>
  );
}

export default function TraceConsole({
  scenario,
  run,
}: {
  scenario: Scenario | null;
  run: RunState | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const steps = run?.steps ?? [];

  // auto-scroll as steps stream in
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps.length, scenario?.id]);

  return (
    <div
      ref={boxRef}
      className="h-full overflow-y-auto rounded-lg border border-edge bg-bg p-3 font-mono text-xs leading-relaxed"
    >
      {!scenario ? (
        <div className="text-ink-dim">
          <span className="text-cy">crucible</span>@sandbox:~$ awaiting run — press RUN
          SUITE ▶ or click a scenario
        </div>
      ) : (
        <>
          <div className="mb-1 text-ink-dim">
            <span className="text-cy">crucible</span>@sandbox:~${" "}
            <span className="text-ink">run {scenario.id}</span>
            {run?.status === "running" && <span className="text-am"> · live</span>}
            {run?.done && <span> · replay</span>}
          </div>
          <div className="mb-2 border-l-2 border-edge-bright pl-2 text-ink-dim">
            user: “{scenario.userMessage}”
          </div>

          {steps.map((step, i) => (
            <StepLine
              key={`${scenario.id}-${i}`}
              step={step}
              // typewriter only while streaming live; replays render instantly
              animate={run?.status === "running" && i === steps.length - 1}
            />
          ))}

          {run?.status === "running" && (
            <div className="mt-1 text-am">
              <span className="pulse-dot inline-block">▋</span>
            </div>
          )}
          {run?.status === "idle" && (
            <div className="text-ink-dim">— not run yet —</div>
          )}
        </>
      )}
    </div>
  );
}
