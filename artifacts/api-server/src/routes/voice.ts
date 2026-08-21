import { Router, type IRouter } from "express";
import twilio from "twilio";
import { hasValidTwilioSignature } from "../lib/twilioWebhook";
import { mediaStreamUrl } from "../services/mediaStreams";
import { associateCallSid, claimPendingPstnCallSession, getRealCallSession, getRealCallSessionForCall } from "../services/realCallSessions";

const router: IRouter = Router();

export function buildBrowserConferenceTwiml(conferenceName: string) {
  const response = new twilio.twiml.VoiceResponse();
  response.dial().conference({ endConferenceOnExit: true }, conferenceName);
  return response.toString();
}

export function buildPstnConferenceTwiml(conferenceName: string, streamUrl: string, sessionId: string) {
  const response = new twilio.twiml.VoiceResponse();
  const stream = response.start().stream({ name: "sales-coach-stt", track: "both_tracks", url: streamUrl });
  stream.parameter({ name: "sessionId", value: sessionId });
  response.dial().conference(conferenceName);
  return response.toString();
}

// Configure this endpoint as the TwiML App Voice URL. The SDK connection is
// directly placed in the conference; it never uses the trial-blocked Client noun.
router.post("/voice", (req, res) => {
  const browserSessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : "";
  const session = browserSessionId
    ? getRealCallSession(browserSessionId)
    : getRealCallSessionForCall(callSid) || claimPendingPstnCallSession(callSid);
  const isSignedTwilioRequest = hasValidTwilioSignature(req);
  if (!isSignedTwilioRequest) {
    res.status(403).type("text/xml").send("<Response><Reject/></Response>");
    return;
  }
  if (!session || session.mode !== "transcription" || session.state === "ended" || session.state === "failed") {
    res.status(404).type("text/xml").send("<Response><Reject/></Response>");
    return;
  }
  const publicBaseUrl = process.env["TWILIO_PUBLIC_BASE_URL"]?.trim().replace(/\/$/, "");
  if (!publicBaseUrl || !/^https:\/\//.test(publicBaseUrl)) {
    res.status(500).type("text/xml").send("<Response><Reject/></Response>");
    return;
  }
  if (browserSessionId) {
    // Twilio includes the Voice SDK call leg SID in its TwiML App request.
    associateCallSid(session, callSid);
    res.type("text/xml").send(buildBrowserConferenceTwiml(session.conferenceName));
    return;
  }

  // Associate the PSTN CallSid as soon as Twilio reaches the Voice webhook.
  // This handles the race where the webhook precedes the Calls API response.
  associateCallSid(session, callSid);
  const streamUrl = mediaStreamUrl(publicBaseUrl);
  if (!streamUrl) {
    res.status(500).type("text/xml").send("<Response><Reject/></Response>");
    return;
  }
  res.type("text/xml").send(buildPstnConferenceTwiml(session.conferenceName, streamUrl, session.id));
});

export default router;
