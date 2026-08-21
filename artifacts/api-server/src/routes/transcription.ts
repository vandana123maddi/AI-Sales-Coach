import { Router, type IRouter } from "express";
import {
  addRealTranscriptTurn,
  addTranscriptionSid,
  getRealCallSessionForCall,
  reportRealCallError,
  setRealCallState,
} from "../services/realCallSessions";
import { logger } from "../lib/logger";
import { hasValidTwilioSignature } from "../lib/twilioWebhook";

const router: IRouter = Router();

type TranscriptionPayload = Record<string, string | undefined>;

export function parseFinalTranscriptTurn(payload: TranscriptionPayload, sessionId: string) {
  if (payload["TranscriptionEvent"] !== "transcription-content" || payload["Final"] !== "true") return null;
  if (payload["Track"] !== "inbound_track" && payload["Track"] !== "outbound_track") return null;
  let data: { transcript?: unknown; confidence?: unknown };
  try {
    data = JSON.parse(payload["TranscriptionData"] || "{}");
  } catch {
    return null;
  }
  const text = typeof data.transcript === "string" ? data.transcript.trim() : "";
  if (!text) return null;
  const confidence = typeof data.confidence === "number" ? data.confidence : undefined;
  const sequenceId = payload["SequenceId"] || randomEventId();
  const transcriptionSid = payload["TranscriptionSid"] || "unknown";
  return {
    id: `${transcriptionSid}-${sequenceId}`,
    turnId: `${sessionId}-turn-${transcriptionSid}-${sequenceId}`,
    sessionId,
    speaker: payload["Track"] === "inbound_track" ? "customer" as const : "salesperson" as const,
    text,
    source: "speech-to-text" as const,
    state: "final" as const,
    occurredAt: payload["Timestamp"] || new Date().toISOString(),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function randomEventId() {
  return Math.random().toString(36).slice(2);
}

router.post("/transcription", (req, res) => {
  if (!hasValidTwilioSignature(req)) {
    logger.warn({ path: req.originalUrl }, "Rejected unsigned Twilio transcription callback");
    res.status(403).send("Forbidden");
    return;
  }

  const payload = req.body as TranscriptionPayload;
  const callSid = payload["CallSid"];
  if (!callSid) {
    res.status(400).send("CallSid is required");
    return;
  }
  const session = getRealCallSessionForCall(callSid);
  if (!session) {
    logger.warn({ callSid }, "Received transcription callback for unknown call");
    res.status(404).send("Unknown call session");
    return;
  }

  const event = payload["TranscriptionEvent"];
  if (event === "transcription-started") {
    addTranscriptionSid(session, payload["TranscriptionSid"] || "");
    setRealCallState(session, "transcript-active");
  } else if (event === "transcription-content") {
    const turn = parseFinalTranscriptTurn(payload, session.id);
    if (turn) addRealTranscriptTurn(session, turn);
  } else if (event === "transcription-error") {
    reportRealCallError(session, payload["TranscriptionError"] || "Twilio transcription failed");
  }

  // Twilio treats any 2xx response as a successfully delivered callback.
  res.sendStatus(204);
});

export default router;
