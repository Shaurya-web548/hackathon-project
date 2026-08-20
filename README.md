# 🔥 Crucible — CI for AI Agents

Mission-control dashboard that runs an AI agent against adversarial test scenarios in a
deterministic sandbox with mocked tools, classifies every failure into a taxonomy, and
renders a Reliability Scorecard with version-over-version regression tracking.

> Sandbox with mocked tools · Demo agent bundled · Bring your own agent (roadmap)

**Live demo:** https://shaurya-web548.github.io/hackathon-project/ · lab at
[/lab](https://shaurya-web548.github.io/hackathon-project/lab) ·
projector autoplay via `?present=1&autoplay=1`.

Visual identity: burgundy & black instrument panel — two chromatic colours
(burgundy = active/failure, reserved gold = tripwire); a pass stays neutral
ivory, so colour on screen always means something demands attention.

## Run

```bash
npm install
npm run dev   # http://localhost:3000
```

The entire core demo is **offline** — zero network calls. The only optional network
feature is GENERATE SCENARIOS ✦ (Gemini); without a key or connectivity it silently
reveals bundled fallback scenarios (grey dot = fallback, burgundy = live). To enable live
generation, copy `.env.local.example` to `.env.local` and set `GEMINI_API_KEY`.

## Extra weapons

- **☢ CHAOS toggle** — deterministically injects 503s + latency into the mocked
  flight-search tool mid-run. v1.0 hammers retries and collapses into TOOL_LOOP
  failures (11 → 14 fails); v1.2 retries once and degrades gracefully. Chaos runs
  don't pollute the regression chart.
- **Stress slider** — Normal User (happy paths only) → Mixed Suite (default 17)
  → Hostile Hacker (adds the AI-generated adversarial pack). The 35/65/88 story
  assumes Mixed.
- **Resource Burn** — simulated token + ₹ accounting per run and per suite; the
  retry loop is visibly the worst burner. Per-run cost shows in the console.
- **Suggest patch ✦** — the Worst Offender card produces a system-prompt diff
  fixing that failure mode, with one-click copy. Pre-authored per mode, offline.

## Demo script (~90s)

1. Select **Agent v1.0** → press **R** (or RUN SUITE ▶). Cascade runs, destructive
   banners fire, score lands at **35** with 11 classified failures.
2. Click a red card (e.g. *Angry Manager Pressure*) — instant deterministic replay.
3. Switch to **v1.2** → run again → score **88**, regression chart draws the climb,
   delta chip shows the improvement.
4. **P** toggles present mode (hides the agent panel, enlarges the console).

## How it works

- `data/demoAgent.ts` — bundled TravelDesk agent: system prompt + 5 pure mocked tools
  (destructive ones flagged).
- `lib/sandbox.ts` — scripted sandbox; streams pre-authored traces with realistic
  latencies; tool results come from actually invoking the mocks. No LLM.
- `data/scenarios.ts` — 17 scenarios × 3 agent versions (v1.0 fails 11, v1.1 fails 6,
  v1.2 fails 2).
- `lib/classify.ts` — rules-based failure classifier over trace structure: TOOL_LOOP,
  DESTRUCTIVE_ACTION, HALLUCINATED_CONFIDENCE, GOAL_DRIFT, INJECTION_COMPLIANCE,
  GUESSED_INPUT. It — not an authored label — decides pass/fail at runtime.

## Architecture map

- **Dynamic scenario generation** — `app/api/generate/route.ts`: meta-prompt over
  the agent's system prompt + tool manifest; strict JSON validation; bundled
  fallback so it is never load-bearing.
- **Sandboxed execution harness** — `lib/sandbox.ts` (mock tool router; results
  come from invoking real mock implementations) + `lib/runner.ts` (async worker
  queue, 3 concurrent, abortable).
- **Trace collector & replay** — every thought / tool call / result / latency is
  a step in an ordered execution trace; the waveform strip scrubs it
  step-by-step and any finished run replays deterministically.
- **Hybrid failure classifier** — `lib/classify.ts`: deterministic rules are the
  verdict of record (loop, destructive, injection, hallucination, drift, guessed
  input), verified against all 51 authored variants; `app/api/judge/route.ts`
  adds an optional LLM-as-a-judge second opinion that can concur or dissent but
  never overrides the rules.
- **Destructive-action guardrail tester** — destructive tools require prior
  confirmation; `purge_all_traveler_data` is a honeypot planted in the manifest
  that no legitimate task needs — calling it is an automatic failure.
- **Scorecard dashboard** — `components/`: gauge, suite map, category radar,
  taxonomy, mode×version matrix, run timeline, burn tracking, regression chart.
