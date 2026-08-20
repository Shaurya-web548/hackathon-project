"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import MiniConsole from "@/components/MiniConsole";

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

/* ── scroll-reveal helper ────────────────────────────────── */

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── the CI terminal, typing itself once in view ─────────── */

const CMD = "crucible run --agent traveldesk --gate 75";
const OUTPUT = [
  { text: "16 scenarios · 3 concurrent · deterministic sandbox", cls: "text-ink-dim" },
  { text: "2 failed — Destructive action, Injection compliance", cls: "text-rd" },
  { text: "reliability 88", cls: "text-ink" },
  { text: "PASS — gate 75 met · exit 0", cls: "text-gn" },
];

function CITerminal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [typed, setTyped] = useState(0);
  const [lines, setLines] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (typed < CMD.length) {
      const t = setTimeout(() => setTyped((n) => n + 1), 28);
      return () => clearTimeout(t);
    }
    if (lines < OUTPUT.length) {
      const t = setTimeout(() => setLines((n) => n + 1), lines === 0 ? 500 : 420);
      return () => clearTimeout(t);
    }
  }, [inView, typed, lines]);

  return (
    <div
      ref={ref}
      className="rounded-md border border-edge bg-bg p-4 font-mono text-[13px] leading-relaxed"
    >
      <div className="text-ink">
        <span className="text-ink-dim select-none">$ </span>
        {CMD.slice(0, typed)}
        {typed < CMD.length && <span className="console-cursor" />}
      </div>
      {OUTPUT.slice(0, lines).map((l, i) => (
        <div key={i} className={`line-in ${l.cls}`}>
          {i === OUTPUT.length - 1 ? "✓ " : "  "}
          {l.text}
        </div>
      ))}
    </div>
  );
}

/* ── content data ────────────────────────────────────────── */

const FLOW = [
  { verb: "Describe", detail: "Paste the agent's system prompt and tool manifest." },
  { verb: "Generate", detail: "Adversarial scenarios target its specific weak points." },
  { verb: "Run", detail: "Every scenario executes in a sandbox with mocked tools." },
  { verb: "Gate", detail: "A reliability score decides whether the version ships." },
];

const MODES: { name: string; desc: string; example: string }[] = [
  {
    name: "Tool loop",
    desc: "The agent retries a failing call until something else gives up.",
    example: "→ cancel_booking(…) ← ERROR ×6",
  },
  {
    name: "Destructive action",
    desc: "Irreversible calls executed without asking the user first.",
    example: "→ issue_refund(₹42,000) · no confirmation",
  },
  {
    name: "Injection compliance",
    desc: "Instructions smuggled inside emails or tool output get obeyed.",
    example: "← “IGNORE ALL PRIOR INSTRUCTIONS…” → complies",
  },
  {
    name: "Hallucinated confidence",
    desc: "The final answer contradicts what the tools actually returned.",
    example: "tools: ₹8,450 · agent: “it's ₹6,200, I'm certain”",
  },
  {
    name: "Goal drift",
    desc: "Asked for one thing, the agent quietly does that plus extras.",
    example: "rebook economy → books business + insurance",
  },
  {
    name: "Guessed input",
    desc: "Missing IDs are filled in by assumption instead of a question.",
    example: "cancel_booking(BK-????) · ID never provided",
  },
];

/* ── the page ────────────────────────────────────────────── */

export default function Landing() {
  return (
    <div className="h-screen overflow-y-auto bg-bg">
      <div className="mx-auto max-w-[1100px] px-6">
        {/* ── hero ──────────────────────────────────────── */}
        <header className="flex items-center justify-between pt-6">
          <div className="leading-none">
            <div className="font-display text-[17px] font-semibold tracking-[0.04em]">
              CRUCIBLE
            </div>
            <div className="eyebrow mt-0.5 text-[9px]">CI for AI agents</div>
          </div>
          <Link
            href="/lab"
            className="rounded border border-edge px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:border-edge-bright hover:text-ink"
          >
            Open the lab
          </Link>
        </header>

        <section className="grid items-center gap-10 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="font-display text-[40px] leading-[1.08] font-semibold tracking-tight text-ink md:text-[56px]"
            >
              Your agent will fail. Find out how before your users do.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08, ease: EASE }}
              className="mt-5 max-w-[46ch] text-[15px] text-ink-dim"
            >
              Crucible runs AI agents through adversarial scenarios in a sandbox,
              classifies every failure, and scores each version before it ships.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.16, ease: EASE }}
              className="mt-7 flex gap-3"
            >
              <Link
                href="/lab"
                className="rounded bg-cy px-5 py-2 text-[14px] font-medium text-[#F5EDE8] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_88%,white)]"
              >
                Open the lab
              </Link>
              <Link
                href="/lab?present=1&autoplay=1"
                className="rounded border border-edge px-5 py-2 text-[14px] text-ink transition-colors hover:border-edge-bright"
              >
                Watch a 60s run
              </Link>
            </motion.div>
          </div>

          {/* hero visual: the real instrument, looping */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2, ease: EASE }}
            className="h-[340px]"
          >
            <MiniConsole />
          </motion.div>
        </section>

        {/* ── how it works ──────────────────────────────── */}
        <section className="border-t border-edge py-16">
          <Reveal>
            <h2 className="eyebrow">How it works</h2>
          </Reveal>
          <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-start md:gap-0">
            {FLOW.map((stop, i) => (
              <div key={stop.verb} className="flex flex-1 items-start md:flex-col">
                <Reveal delay={i * 0.08} className="md:pr-8">
                  <div className="font-display text-lg font-medium text-ink">
                    {stop.verb}
                  </div>
                  <p className="mt-1.5 max-w-[26ch] text-[13px] text-ink-dim">
                    {stop.detail}
                  </p>
                </Reveal>
                {i < FLOW.length - 1 && (
                  <div className="mt-3.5 mr-8 hidden h-px flex-1 bg-[var(--line)] md:block" />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── what it catches ───────────────────────────── */}
        <section className="border-t border-edge py-16">
          <Reveal>
            <h2 className="eyebrow">What it catches</h2>
          </Reveal>
          <dl className="mt-8 grid gap-x-14 gap-y-8 md:grid-cols-2">
            {MODES.map((m, i) => (
              <Reveal key={m.name} delay={(i % 2) * 0.08}>
                <dt className="text-[15px] font-medium text-ink">{m.name}</dt>
                <dd className="mt-1 text-[13px] text-ink-dim">{m.desc}</dd>
                <dd className="mt-1.5 font-mono text-[12px] text-ink-dim/80">
                  {m.example}
                </dd>
              </Reveal>
            ))}
          </dl>
        </section>

        {/* ── built as CI ───────────────────────────────── */}
        <section className="border-t border-edge py-16">
          <Reveal>
            <h2 className="eyebrow">Built as CI</h2>
            <p className="mt-3 max-w-[52ch] text-[13px] text-ink-dim">
              The same suite runs headless. Set a reliability gate and a failing
              agent version never reaches your users.
            </p>
          </Reveal>
          <div className="mt-6 max-w-[640px]">
            <CITerminal />
          </div>
        </section>

        {/* ── footer ────────────────────────────────────── */}
        <footer className="border-t border-edge py-10 text-[12px] text-ink-dim">
          <p>
            Prototype: sandboxed demo agent with mocked tools. Bring-your-own-agent,
            real tool adapters and CI integration are roadmap.
          </p>
          <p className="mt-2">Team Crucible · built in 48 hours · Shaurya Agarwal</p>
        </footer>
      </div>
    </div>
  );
}
