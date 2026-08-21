import { randomUUID } from "node:crypto";

export type RealCallState = "dialing" | "ringing" | "connected" | "transcript-active" | "ended" | "failed";
export type RealCallMode = "transcription" | "keypad";
export type RealTranscriptTurn = {
  id: string;
  turnId: string;
  sessionId: string;
  speaker: "salesperson" | "customer";
  text: string;
  source: "speech-to-text" | "dtmf";
  state: "final";
  occurredAt: string;
  confidence?: number;
  input?: KeypadInput;
  intent?: KeypadIntent;
  callSid?: string;
};

export const KEYPAD_CHOICES = {
  "1": {
    intent: "product_interest",
    label: "Product / Demo Interest",
    text: "Customer selected Product / Demo Interest.",
    response: "Sure. Let me explain how our solution works and how it can help your business.",
  },
  "2": {
    intent: "pricing",
    label: "Pricing / Cost",
    text: "Customer selected Pricing / Cost.",
    response: "Absolutely. Let me walk you through the pricing and available options.",
  },
  "3": {
    intent: "objection",
    label: "Problem / Objection",
    text: "Customer selected Problem / Objection.",
    response: "I understand your concern. Let me address that and explain how our solution can help.",
  },
  "4": {
    intent: "next_step",
    label: "Next Step / Follow-up",
    text: "Customer selected Next Step / Follow-up.",
    response: "Great. Let's discuss the next steps and arrange a follow-up.",
  },
} as const;

export type KeypadInput = keyof typeof KEYPAD_CHOICES;
export type KeypadIntent = (typeof KEYPAD_CHOICES)[KeypadInput]["intent"];

export function isKeypadInput(input: string): input is KeypadInput {
  return input in KEYPAD_CHOICES;
}

export type RealCallSession = {
  id: string;
  kind: "real";
  mode: RealCallMode;
  callSid: string;
  conferenceName: string;
  state: RealCallState;
  turns: RealTranscriptTurn[];
  transcriptionSids: Set<string>;
  seenEventKeys: Set<string>;
  listeners: Set<(event: RealCallEvent) => void>;
};

export type RealCallEvent =
  | { type: "state"; state: RealCallState }
  | { type: "transcript"; turn: RealTranscriptTurn }
  | { type: "error"; message: string };

const sessionsById = new Map<string, RealCallSession>();
const sessionsByCallSid = new Map<string, RealCallSession>();
const cleanupListeners = new Set<(session: RealCallSession) => void>();

export function createRealCallSession(callSid = "", mode: RealCallMode = "transcription"): RealCallSession {
  const id = `real-${randomUUID()}`;
  const session: RealCallSession = {
    id,
    kind: "real",
    mode,
    callSid,
    // Trial accounts scope conference names themselves. This prefix is still
    // useful for observability and prevents collisions after an account upgrade.
    conferenceName: `sales-coach-${id}`,
    state: "dialing",
    turns: [],
    transcriptionSids: new Set(),
    seenEventKeys: new Set(),
    listeners: new Set(),
  };
  sessionsById.set(id, session);
  if (callSid) sessionsByCallSid.set(callSid, session);
  return session;
}

export function getRealCallSession(sessionId: string) {
  return sessionsById.get(sessionId);
}

export function getRealCallSessionForCall(callSid: string) {
  return sessionsByCallSid.get(callSid);
}

/**
 * The Calls API must use the literal /api/voice URL, so its first webhook
 * identifies the call only by CallSid. Transcription calls are deliberately
 * serialized while a call is being created; that makes this race-safe without
 * smuggling a session token into the Voice URL.
 */
export function claimPendingPstnCallSession(callSid: string) {
  const existing = getRealCallSessionForCall(callSid);
  if (existing) return existing;
  const pending = [...sessionsById.values()].filter((session) => !session.callSid && session.mode === "transcription" && session.state === "dialing");
  if (pending.length !== 1) return undefined;
  associateCallSid(pending[0], callSid);
  return pending[0];
}

export function hasPendingPstnCallSession() {
  return [...sessionsById.values()].some((session) => !session.callSid && session.mode === "transcription" && session.state === "dialing");
}

/** Associates the Voice SDK call leg with its already-created application session. */
export function associateCallSid(session: RealCallSession, callSid: string) {
  if (!callSid) return;
  // The first association is the PSTN leg created by the Calls API. Browser
  // Voice SDK legs are additional aliases and must not replace it.
  if (!session.callSid) session.callSid = callSid;
  sessionsByCallSid.set(callSid, session);
}

export function setRealCallState(session: RealCallSession, state: RealCallState) {
  if (session.state === state) return;
  session.state = state;
  emit(session, { type: "state", state });
  if (state === "ended" || state === "failed") {
    cleanupListeners.forEach((listener) => listener(session));
  }
}

/** Registers transport cleanup without adding another call-session store. */
export function registerRealCallSessionCleanup(listener: (session: RealCallSession) => void) {
  cleanupListeners.add(listener);
  return () => cleanupListeners.delete(listener);
}

export function addTranscriptionSid(session: RealCallSession, transcriptionSid: string) {
  if (transcriptionSid) session.transcriptionSids.add(transcriptionSid);
}

export function addRealTranscriptTurn(session: RealCallSession, turn: RealTranscriptTurn) {
  if (session.seenEventKeys.has(turn.id)) return false;
  session.seenEventKeys.add(turn.id);
  session.turns.push(turn);
  emit(session, { type: "transcript", turn });
  return true;
}

/** Adds a final, structured customer selection to the same SSE/coach stream as transcripts. */
export function addKeypadTurn(session: RealCallSession, callSid: string, input: KeypadInput) {
  const choice = KEYPAD_CHOICES[input];
  const occurredAt = new Date().toISOString();
  const id = `${callSid}-dtmf-${input}-${randomUUID()}`;
  const turn: RealTranscriptTurn = {
    id,
    turnId: `${session.id}-turn-${id}`,
    sessionId: session.id,
    speaker: "customer",
    input,
    intent: choice.intent,
    text: choice.text,
    source: "dtmf",
    state: "final",
    occurredAt,
    callSid,
  };
  addRealTranscriptTurn(session, turn);
  return turn;
}

export function reportRealCallError(session: RealCallSession, message: string) {
  emit(session, { type: "error", message });
}

export function subscribeToRealCall(session: RealCallSession, listener: (event: RealCallEvent) => void) {
  session.listeners.add(listener);
  return () => session.listeners.delete(listener);
}

function emit(session: RealCallSession, event: RealCallEvent) {
  session.listeners.forEach((listener) => listener(event));
}
