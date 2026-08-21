export type TranscriptTurnInput = {
  id: string;
  turnId: string;
  sessionId: string;
  speaker: "salesperson" | "customer";
  text: string;
  source: string;
  state: "interim" | "final";
  occurredAt: string;
  confidence?: number;
};

export type SalesCoachContext = {
  sessionId: string;
  prospectPhoneNumber?: string;
  turns: TranscriptTurnInput[];
};

export type CoachingResult = {
  observation: string;
  recommendedNextQuestion: string;
  currentConversationStage: "discovery" | "qualification" | "objection_handling" | "viewing" | "offer" | "valuation" | "instruction" | "closing" | "follow_up";
  buyerSentiment: "cold" | "neutral" | "warm" | "concerned";
  nextBestMove: string;
  objectionDetected: string | null;
  urgency: "low" | "medium" | "high";
  evidenceTurnIds: string[];
};

export type CoachingResponse =
  | { status: "ready"; coaching: CoachingResult }
  | { status: "empty"; coaching: null }
  | { status: "unconfigured"; coaching: null; message: string }
  | { status: "unavailable"; coaching: null; message: string };

export interface SalesCoachProvider {
  readonly isConfigured: boolean;
  analyze(context: SalesCoachContext): Promise<CoachingResult>;
}

type ChatCompletionPayload = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

class OpenAiCompatibleSalesCoachProvider implements SalesCoachProvider {
  private readonly apiKey = process.env["LLM_API_KEY"]?.trim();
  private readonly apiBaseUrl = (
    process.env["LLM_API_BASE_URL"] ||
    "https://generativelanguage.googleapis.com/v1beta/openai"
  ).replace(/\/$/, "");
  private readonly model = process.env["LLM_MODEL"] || "gemini-3.5-flash-lite";

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  async analyze(context: SalesCoachContext): Promise<CoachingResult> {
    if (!this.apiKey) {
      throw new Error("LLM API key is not configured");
    }

    const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a concise real-time real-estate sales coach for buyer and vendor conversations. Return JSON only with observation, recommendedNextQuestion, currentConversationStage (discovery, qualification, objection_handling, viewing, offer, valuation, instruction, closing, or follow_up), buyerSentiment (cold, neutral, warm, or concerned), nextBestMove, objectionDetected (string or null), urgency (low, medium, or high), and evidenceTurnIds (array of transcript turn IDs). Ground every point in the supplied transcript. Use specific next moves: ask a budget/timeline/financing question, address a stated objection, propose a viewing, discuss valuation/marketing/fees, or confirm a follow-up. Never invent evidence or claim a buyer/vendor fact that is absent.",
          },
          {
            role: "user",
            content: JSON.stringify({
              sessionId: context.sessionId,
              turns: context.turns.map((turn) => ({
                turnId: turn.turnId,
                speaker: turn.speaker,
                text: turn.text,
                state: turn.state,
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM provider request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as ChatCompletionPayload;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM provider returned no coaching content");

    return normalizeCoachingResult(JSON.parse(content), context.turns);
  }
}

export function createSalesCoachProvider(): SalesCoachProvider {
  return new OpenAiCompatibleSalesCoachProvider();
}

export async function getCoaching(
  context: SalesCoachContext,
  provider: SalesCoachProvider = createSalesCoachProvider(),
): Promise<CoachingResponse> {
  const finalTurns = context.turns.filter(
    (turn) => turn.state === "final" && turn.text.trim(),
  );
  if (!finalTurns.length) return { status: "empty", coaching: null };
  if (!provider.isConfigured) {
    return {
      status: "unconfigured",
      coaching: null,
      message: "Sales Coach is unavailable until LLM_API_KEY is configured on the API server.",
    };
  }

  try {
    return { status: "ready", coaching: await provider.analyze({ ...context, turns: finalTurns }) };
  } catch {
    return {
      status: "unavailable",
      coaching: null,
      message: "Sales Coach is temporarily unavailable. Please try again shortly.",
    };
  }
}

function normalizeCoachingResult(
  value: unknown,
  turns: TranscriptTurnInput[],
): CoachingResult {
  if (!value || typeof value !== "object") throw new Error("Invalid coaching response");
  const result = value as Record<string, unknown>;
  const validTurnIds = new Set(turns.map((turn) => turn.turnId));
  const urgency = result["urgency"];
  const currentConversationStage = result["currentConversationStage"];
  const buyerSentiment = result["buyerSentiment"];

  return {
    observation: stringValue(result["observation"]),
    recommendedNextQuestion: stringValue(result["recommendedNextQuestion"]),
    objectionDetected:
      typeof result["objectionDetected"] === "string"
        ? result["objectionDetected"]
        : null,
    currentConversationStage:
      currentConversationStage === "discovery" || currentConversationStage === "qualification" || currentConversationStage === "objection_handling" || currentConversationStage === "viewing" || currentConversationStage === "offer" || currentConversationStage === "valuation" || currentConversationStage === "instruction" || currentConversationStage === "closing" || currentConversationStage === "follow_up"
        ? currentConversationStage
        : "discovery",
    buyerSentiment:
      buyerSentiment === "cold" || buyerSentiment === "neutral" || buyerSentiment === "warm" || buyerSentiment === "concerned"
        ? buyerSentiment
        : "neutral",
    nextBestMove: stringValue(result["nextBestMove"]),
    urgency:
      urgency === "low" || urgency === "medium" || urgency === "high"
        ? urgency
        : "low",
    evidenceTurnIds: Array.isArray(result["evidenceTurnIds"])
      ? result["evidenceTurnIds"].filter(
          (turnId): turnId is string =>
            typeof turnId === "string" && validTurnIds.has(turnId),
        )
      : [],
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "No coaching insight available yet.";
}
