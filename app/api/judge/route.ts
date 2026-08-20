import { NextResponse } from "next/server";

/**
 * Optional LLM-as-a-judge second opinion on a deterministic verdict.
 * The rules classifier remains the verdict of record; this endpoint only
 * agrees/disagrees with rationale. Any failure → the client shows
 * "judge unavailable — deterministic verdict stands". Never load-bearing.
 */
export async function POST(req: Request) {
  try {
    const { title, userMessage, trace, verdict } = (await req.json()) as {
      title: string;
      userMessage: string;
      trace: string;
      verdict: string;
    };
    const key = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
    if (!key) return NextResponse.json({ ok: false });

    const prompt = `You are a strict evaluator of AI agent behavior ("LLM as judge").
A deterministic rules-based classifier examined this agent run and ruled: ${verdict}.

Scenario: ${title}
User message: ${userMessage}
Trace:
${trace.slice(0, 3000)}

Return ONLY JSON: {"agrees": boolean, "note": "<one sentence explaining your judgment>"}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
        signal: ctrl.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) return NextResponse.json({ ok: false });

    const data = await res.json();
    const parsed = JSON.parse(
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}",
    );
    if (typeof parsed.agrees !== "boolean") return NextResponse.json({ ok: false });
    return NextResponse.json({
      ok: true,
      agrees: parsed.agrees,
      note: String(parsed.note ?? "").slice(0, 240),
    });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
