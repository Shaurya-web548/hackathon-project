import { NextResponse } from "next/server";
import {
  ADVERSARY_SCHEMA,
  AdversaryToolInput,
  adversaryPrompt,
  validateAttacks,
} from "@/lib/adversary";

/**
 * The Automated Adversary — backend. Reads the agent's tools, has Gemini
 * design attacks derived from those specific tools, and grounds the result
 * against the real tool list (hallucination guard). Any failure → the client
 * uses the bundled fallback. Never load-bearing for the demo.
 */
export async function POST(req: Request) {
  try {
    const { agentPrompt, tools } = (await req.json()) as {
      agentPrompt: string;
      tools: AdversaryToolInput[];
    };
    if (!Array.isArray(tools) || tools.length === 0)
      return NextResponse.json({ ok: false });

    const key = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
    if (!key) return NextResponse.json({ ok: false });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: adversaryPrompt(agentPrompt, tools) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: ADVERSARY_SCHEMA,
            temperature: 0.95,
          },
        }),
        signal: ctrl.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) return NextResponse.json({ ok: false });

    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const realToolNames = tools.map((t) => t.name);
    const { attacks, discarded } = validateAttacks(JSON.parse(text), realToolNames);
    if (attacks.length === 0) return NextResponse.json({ ok: false });
    return NextResponse.json({ ok: true, attacks, discarded });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
