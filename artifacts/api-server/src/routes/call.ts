import { Router, type IRouter } from "express";
import twilio from "twilio";
import { logger } from "../lib/logger";
import { associateCallSid, createRealCallSession, getRealCallSessionForCall, hasPendingPstnCallSession, reportRealCallError, setRealCallState, type RealCallMode, type RealCallSession } from "../services/realCallSessions";

const router: IRouter = Router();
const E164_PHONE_NUMBER = /^\+[1-9]\d{1,14}$/;
const CALL_SID = /^CA[a-f0-9]{32}$/i;
const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);
const CALL_MODES: readonly RealCallMode[] = ["transcription", "keypad"];
type CallMode = RealCallMode;

type TwilioErrorPayload = { code?: number; message?: string; more_info?: string; sid?: string; status?: string };
type TwilioConfig = { accountSid: string; authToken: string; from: string; publicBaseUrl: string };
class TwilioCallError extends Error { constructor(message: string, readonly statusCode: number, readonly code?: number, readonly moreInfo?: string) { super(message); } }

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  const authToken = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  const from = process.env["TWILIO_PHONE_NUMBER"]?.trim();
  const publicBaseUrl = process.env["TWILIO_PUBLIC_BASE_URL"]?.trim().replace(/\/$/, "");
  if (!accountSid || !authToken || !from || !publicBaseUrl || !/^https:\/\//.test(publicBaseUrl)) return null;
  return { accountSid, authToken, from, publicBaseUrl };
}

function getErrorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

async function createTwilioCall(config: TwilioConfig, to: string, mode: CallMode, session: RealCallSession) {
  // This is intentionally the literal Voice endpoint. Do not add a hosted
  // Twilio template, keypad endpoint, query string, or later TwiML update:
  // Twilio must receive the Media Stream TwiML on its first request.
  const voiceUrl = mode === "keypad"
    ? `${config.publicBaseUrl}/api/voice/keypad`
    : `${config.publicBaseUrl}/api/voice`;
  const body = new URLSearchParams({ To: to, From: config.from, Url: voiceUrl }).toString();
  const authorization = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`, { method: "POST", headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
  const payload = await response.json() as TwilioErrorPayload;
  if (!response.ok || !payload.sid) throw new TwilioCallError(payload.message || "Twilio could not start the call", response.status, payload.code, payload.more_info);
  return { sid: payload.sid, status: payload.status };
}

async function activateWhenConnected(config: TwilioConfig, session: RealCallSession) {
  const client = twilio(config.accountSid, config.authToken);
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const call = await client.calls(session.callSid).fetch();
    if (call.status === "in-progress") {
      setRealCallState(session, "connected");
      void monitorCallEnd(client, session);
      return;
    }
    if (TERMINAL_STATUSES.has(call.status)) { setRealCallState(session, "ended"); return; }
    setRealCallState(session, "ringing");
  }
  reportRealCallError(session, "The call did not become active before transcription setup timed out.");
  setRealCallState(session, "failed");
}

async function monitorKeypadCall(client: ReturnType<typeof twilio>, session: RealCallSession) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const call = await client.calls(session.callSid).fetch();
    if (call.status === "in-progress") setRealCallState(session, "connected");
    if (TERMINAL_STATUSES.has(call.status)) { setRealCallState(session, "ended"); return; }
    if (call.status !== "in-progress") setRealCallState(session, "ringing");
  }
}

async function monitorCallEnd(client: ReturnType<typeof twilio>, session: RealCallSession) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const call = await client.calls(session.callSid).fetch();
    if (TERMINAL_STATUSES.has(call.status)) { setRealCallState(session, "ended"); return; }
  }
}

router.post("/call", async (req, res) => {
  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const mode = typeof req.body?.mode === "string" ? req.body.mode : "transcription";
  if (!E164_PHONE_NUMBER.test(to)) { res.status(400).json({ error: "to must be a valid E.164 phone number" }); return; }
  if (!CALL_MODES.includes(mode as CallMode)) { res.status(400).json({ error: "mode must be transcription or keypad" }); return; }
  const config = getTwilioConfig();
  if (!config) { res.status(500).json({ error: "Twilio calling or public callback URL is not configured" }); return; }
  if (!E164_PHONE_NUMBER.test(config.from)) { res.status(500).json({ error: "Twilio caller ID is invalid" }); return; }
  if (mode === "transcription" && hasPendingPstnCallSession()) {
    res.status(409).json({ error: "A transcription call is already being created; wait for it to connect before placing another." });
    return;
  }
  // Twilio can invoke the Voice URL before its REST API response has returned.
  // Create the session first and carry this stable ID in the direct Voice URL.
  const session = createRealCallSession("", mode as CallMode);
  try {
    const call = await createTwilioCall(config, to, mode as CallMode, session);
    associateCallSid(session, call.sid);
    if (call.status && TERMINAL_STATUSES.has(call.status)) {
      setRealCallState(session, "ended");
    } else if (mode === "keypad") {
      void monitorKeypadCall(twilio(config.accountSid, config.authToken), session).catch((error: unknown) => {
        logger.error({ err: error, callSid: session.callSid }, "Failed to monitor keypad call");
        reportRealCallError(session, "Unable to monitor the keypad call.");
        setRealCallState(session, "failed");
      });
    } else {
      void activateWhenConnected(config, session).catch((error: unknown) => {
        logger.error({ err: error, callSid: session.callSid }, "Failed to activate real-call transcription");
        reportRealCallError(session, "Unable to activate conference transcription.");
        setRealCallState(session, "failed");
      });
    }
    res.status(201).json({ callSid: call.sid, status: call.status, sessionId: session.id, kind: session.kind, conferenceName: session.conferenceName, mode: session.mode });
  } catch (error) {
    setRealCallState(session, "failed");
    const details = error instanceof TwilioCallError ? { statusCode: error.statusCode, twilioCode: error.code, moreInfo: error.moreInfo } : undefined;
    logger.error({ err: error, twilio: details }, "Failed to start outbound Twilio call");
    res.status(502).json({ error: getErrorMessage(error, "Twilio could not start the call"), ...(error instanceof TwilioCallError && error.code ? { twilioCode: error.code, moreInfo: error.moreInfo } : {}) });
  }
});

router.post("/call/:callSid/hangup", async (req, res) => {
  const callSid = req.params["callSid"];
  if (!CALL_SID.test(callSid)) { res.status(400).json({ error: "Invalid Twilio call SID" }); return; }
  const config = getTwilioConfig();
  if (!config) { res.status(500).json({ error: "Twilio calling is not configured" }); return; }
  try {
    const call = await twilio(config.accountSid, config.authToken).calls(callSid).update({ status: "completed" });
    const session = getRealCallSessionForCall(callSid);
    if (session) setRealCallState(session, "ended");
    res.json({ callSid: call.sid, status: call.status });
  } catch (error) {
    logger.error({ err: error }, "Failed to end outbound Twilio call");
    res.status(502).json({ error: getErrorMessage(error, "Twilio could not end the call") });
  }
});

export default router;
