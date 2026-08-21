import type { SalesCoachContext, TranscriptTurnInput } from "./salesCoach";

export type PostCallSummary = {
  conversationSummary: string;
  customerPainPoints: string[];
  customerObjections: string[];
  customerNeeds: string[];
  keyCommitments: string[];
  recommendedNextStep: string;
  followUpMessage: string;
  overallSalesAssessment: string;
  evidenceTurnIds: string[];
};

export type PostCallSummaryResponse =
  | { status: "ready"; summary: PostCallSummary }
  | { status: "empty"; summary: null }
  | { status: "unconfigured" | "unavailable"; summary: null; message: string };

type ChatCompletionPayload = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

export async function getPostCallSummary(
  context: SalesCoachContext,
): Promise<PostCallSummaryResponse> {
  const finalTurns = context.turns.filter(
    (turn) => turn.state === "final" && turn.text.trim(),
  );
  if (!finalTurns.length) return { status: "empty", summary: null };

  const apiKey = process.env["LLM_API_KEY"]?.trim();
  if (!apiKey) {
    return {
      status: "unconfigured",
      summary: null,
      message: "Post-call summary is unavailable until LLM_API_KEY is configured on the API server.",
    };
  }

  const apiBaseUrl = (
    process.env["LLM_API_BASE_URL"] ||
    "https://generativelanguage.googleapis.com/v1beta/openai"
  ).replace(/\/$/, "");
  const model = process.env["LLM_MODEL"] || "gemini-3.5-flash-lite";

  try {
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You summarize real-estate buyer or vendor sales calls concisely. Return JSON only with conversationSummary, customerPainPoints, customerObjections, customerNeeds, keyCommitments, recommendedNextStep, followUpMessage, overallSalesAssessment, and evidenceTurnIds. All list values must be arrays of strings. Base every claim on the transcript. Clearly distinguish an expressed need, objection, commitment, and next step; if something was not discussed, use an empty list or say that it was not established. Do not invent evidence.",
          },
          {
            role: "user",
            content: JSON.stringify({
              sessionId: context.sessionId,
              turns: finalTurns.map((turn) => ({
                turnId: turn.turnId,
                speaker: turn.speaker,
                text: turn.text,
              })),
            }),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("Post-call summary provider request failed");

    const payload = (await response.json()) as ChatCompletionPayload;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Post-call summary provider returned no content");

    return { status: "ready", summary: normalizeSummary(JSON.parse(content), finalTurns) };
  } catch {
    return {
      status: "unavailable",
      summary: null,
      message: "Post-call summary is temporarily unavailable. Please try again shortly.",
    };
  }
}

function normalizeSummary(value: unknown, turns: TranscriptTurnInput[]): PostCallSummary {
  if (!value || typeof value !== "object") throw new Error("Invalid post-call summary response");
  const summary = value as Record<string, unknown>;
  const validTurnIds = new Set(turns.map((turn) => turn.turnId));

  return {
    conversationSummary: textValue(
      summary["conversationSummary"],
      "The transcript was too brief to establish a complete conversation summary.",
    ),
    customerPainPoints: stringList(summary["customerPainPoints"]),
    customerObjections: stringList(summary["customerObjections"]),
    customerNeeds: stringList(summary["customerNeeds"]),
    keyCommitments: stringList(summary["keyCommitments"]),
    recommendedNextStep: textValue(
      summary["recommendedNextStep"],
      "Review the transcript and confirm the appropriate next action.",
    ),
    followUpMessage: textValue(
      summary["followUpMessage"],
      "Thank you for your time today. I will follow up with the information we discussed.",
    ),
    overallSalesAssessment: textValue(
      summary["overallSalesAssessment"],
      "There is not enough transcript evidence for a full sales assessment.",
    ),
    evidenceTurnIds: Array.isArray(summary["evidenceTurnIds"])
      ? summary["evidenceTurnIds"].filter(
          (turnId): turnId is string =>
            typeof turnId === "string" && validTurnIds.has(turnId),
        )
      : [],
  };
}

function textValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && Boolean(entry.trim()),
      )
    : [];
}
