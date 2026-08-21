export type CallState = "Ready" | "Live" | "Ended";
export type TranscriptSpeaker = "salesperson" | "customer";
export type TranscriptSource = "demo" | "speech-to-text" | "dtmf";
export type TranscriptState = "interim" | "final";

export type TranscriptTurn = {
  /** Stable identifier used to update an interim STT result with its final form. */
  id: string;
  turnId: string;
  sessionId: string;
  speaker: TranscriptSpeaker;
  text: string;
  source: TranscriptSource;
  state: TranscriptState;
  occurredAt: string;
  /** Present when a transport can provide a recognition confidence score. */
  confidence?: number;
};

export type SalesCoachContext = {
  sessionId: string;
  prospectPhoneNumber?: string;
  turns: TranscriptTurn[];
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
  | { status: "unconfigured" | "unavailable"; coaching: null; message: string };

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
  | { status: "loading"; summary: null }
  | { status: "ready"; summary: PostCallSummary }
  | { status: "empty"; summary: null }
  | { status: "unconfigured" | "unavailable"; summary: null; message: string };

export type DemoScriptTurn = Pick<TranscriptTurn, "speaker" | "text">;

export const DEMO_CONVERSATION: readonly DemoScriptTurn[] = [
  {
    speaker: "salesperson",
    text: "Hi Maya, this is Jordan from Atlas. Did I catch you with two minutes?",
  },
  {
    speaker: "customer",
    text: "I have a minute. What is this about?",
  },
  {
    speaker: "salesperson",
    text: "I noticed your team is growing quickly. We help sales leaders reduce the time reps spend updating CRM records.",
  },
  {
    speaker: "customer",
    text: "That is definitely a pain point, but we already use a few sales tools.",
  },
  {
    speaker: "salesperson",
    text: "That makes sense. How are your reps capturing follow-ups after customer calls today?",
  },
  {
    speaker: "customer",
    text: "Mostly manually, so follow-ups are inconsistent when the team is busy.",
  },
  {
    speaker: "salesperson",
    text: "That is exactly where Atlas helps. Would a 20-minute workflow review next week be useful?",
  },
];

/** Four isolated simulated interactions sent through the same coach/summary APIs as real transcripts. */
export const DEMO_COACH_STAGES = [
  { title: "Product", turns: [
    { speaker: "salesperson", text: "We help sales teams turn customer calls into reliable follow-ups and coaching." },
    { speaker: "customer", text: "I am interested in a product demo because our reps lose track of follow-ups after calls." },
  ] },
  { title: "Pricing", turns: [
    { speaker: "salesperson", text: "Pricing is based on the number of salespeople and the workflows your team needs." },
    { speaker: "customer", text: "What would the pricing look like for a team of ten, and what is included?" },
  ] },
  { title: "Objection", turns: [
    { speaker: "salesperson", text: "The goal is to save rep time while making sure every customer gets a prompt follow-up." },
    { speaker: "customer", text: "The price is too high, and I am concerned that adoption will be difficult for the team." },
  ] },
  { title: "Next Step", turns: [
    { speaker: "salesperson", text: "If the workflow fits, we can tailor a short rollout plan for your team." },
    { speaker: "customer", text: "This sounds promising. Please schedule a product review next week with my sales manager." },
  ] },
] as const;

export function createTranscriptTurn(
  turn: DemoScriptTurn,
  sessionId: string,
  index: number,
): TranscriptTurn {
  const turnId = `${sessionId}-turn-${index + 1}`;

  return {
    ...turn,
    id: turnId,
    turnId,
    sessionId,
    source: "demo",
    state: "final",
    occurredAt: new Date().toISOString(),
    confidence: 1,
  };
}

export function createDemoCoachStageTurns(stageIndex: number, sessionId: string): TranscriptTurn[] {
  const stage = DEMO_COACH_STAGES[stageIndex];
  if (!stage) return [];
  const offset = DEMO_COACH_STAGES
    .slice(0, stageIndex)
    .reduce((count, priorStage) => count + priorStage.turns.length, 0);
  return stage.turns.map((turn, index) => createTranscriptTurn(turn, sessionId, offset + index));
}

// This is the stable hand-off shape for future STT ingestion and LLM coaching.
export function createSalesCoachContext(
  sessionId: string,
  turns: TranscriptTurn[],
  prospectPhoneNumber?: string,
): SalesCoachContext {
  return { sessionId, prospectPhoneNumber, turns };
}
