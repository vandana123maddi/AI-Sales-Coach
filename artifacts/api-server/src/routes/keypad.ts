import { Router, type IRouter, type Request, type Response } from "express";
import twilio from "twilio";
import { logger } from "../lib/logger";
import { hasValidTwilioSignature } from "../lib/twilioWebhook";
import {
  addKeypadTurn,
  getRealCallSessionForCall,
  isKeypadInput,
  KEYPAD_CHOICES,
  setRealCallState,
} from "../services/realCallSessions";

const router: IRouter = Router();
const MENU_PROMPT = "Welcome to the AI Sales Coach trial phone mode. Press 1 for product or demo interest, 2 for pricing, 3 for a problem or objection, or 4 for next steps and follow-up.";
const INVALID_PROMPT = "Please press 1, 2, 3, or 4.";

function publicBaseUrl() {
  return process.env["TWILIO_PUBLIC_BASE_URL"]?.trim().replace(/\/$/, "") || null;
}

export function buildKeypadMenuTwiml(baseUrl: string, prompt = MENU_PROMPT) {
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["dtmf"],
    numDigits: 1,
    timeout: 5,
    action: `${baseUrl}/api/voice/keypad/input`,
    method: "POST",
  });
  gather.say(prompt);
  response.say(INVALID_PROMPT);
  response.redirect({ method: "POST" }, `${baseUrl}/api/voice/keypad`);
  return response.toString();
}

function buildKeypadResponseTwiml(baseUrl: string, message: string) {
  const response = new twilio.twiml.VoiceResponse();
  response.say(message);
  response.redirect({ method: "POST" }, `${baseUrl}/api/voice/keypad`);
  return response.toString();
}

function rejectUnsigned(req: Request, res: Response) {
  if (hasValidTwilioSignature(req)) return false;
  logger.warn({ path: req.originalUrl }, "Rejected unsigned Twilio keypad callback");
  res.status(403).send("Forbidden");
  return true;
}

router.post("/voice/keypad", (req, res) => {
  if (rejectUnsigned(req, res)) return;
  const baseUrl = publicBaseUrl();
  const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : "";
  const session = getRealCallSessionForCall(callSid);
  if (!baseUrl || !session || session.mode !== "keypad") {
    logger.warn({ callSid }, "Received keypad menu request for unknown call session");
    res.type("text/xml").send("<Response><Say>We could not start this call session. Please try again.</Say></Response>");
    return;
  }
  setRealCallState(session, "connected");
  res.type("text/xml").send(buildKeypadMenuTwiml(baseUrl));
});

router.post("/voice/keypad/input", (req, res) => {
  if (rejectUnsigned(req, res)) return;
  const baseUrl = publicBaseUrl();
  const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : "";
  const digits = typeof req.body?.Digits === "string" ? req.body.Digits : "";
  const session = getRealCallSessionForCall(callSid);
  if (!baseUrl || !session || session.mode !== "keypad") {
    logger.warn({ callSid }, "Received keypad input for unknown call session");
    res.type("text/xml").send("<Response><Say>We could not continue this call session. Please try again.</Say></Response>");
    return;
  }
  if (!isKeypadInput(digits)) {
    res.type("text/xml").send(buildKeypadResponseTwiml(baseUrl, INVALID_PROMPT));
    return;
  }
  addKeypadTurn(session, callSid, digits);
  res.type("text/xml").send(buildKeypadResponseTwiml(baseUrl, KEYPAD_CHOICES[digits].response));
});

export default router;
