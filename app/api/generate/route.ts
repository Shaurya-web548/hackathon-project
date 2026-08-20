import { NextResponse } from "next/server";
import { redTeamPrompt, validateGenerated } from "@/lib/generation";

/**
 * Dynamic Scenario Generation Engine — backend. Reads the target agent's
 * system prompt and tool manifest, has an LLM act as an AI Red Teamer, and
 * returns 5 scenarios in a strict JSON schema. The client treats ANY
 * failure as "use the bundled fallback" — never load-bearing for the demo.
 */
export async function POST(req: Request) {
  try {
    const { systemPrompt, tools } = (await req.json()) as {
      systemPrompt: string;
      tools: string;
    };
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
          contents: [{ parts: [{ text: redTeamPrompt(systemPrompt, tools) }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
        }),
        signal: ctrl.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) return NextResponse.json({ ok: false });

    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const scenarios = validateGenerated(JSON.parse(text));
    if (scenarios.length === 0) return NextResponse.json({ ok: false });
    return NextResponse.json({ ok: true, scenarios });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
