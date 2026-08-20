import { Router, type IRouter } from "express";
import twilio from "twilio";

const router: IRouter = Router();
const E164_PHONE_NUMBER = /^\+[1-9]\d{1,14}$/;

router.post("/voice", (req, res) => {
  const to = typeof req.body?.To === "string" ? req.body.To.trim() : "";

  if (!to) {
    res.status(400).json({ error: "To phone number is required" });
    return;
  }

  if (!E164_PHONE_NUMBER.test(to)) {
    res.status(400).json({
      error: "To must be a valid E.164 phone number",
    });
    return;
  }

  const callerId = process.env["TWILIO_PHONE_NUMBER"];

  if (!callerId) {
    res.status(500).json({ error: "Twilio caller ID is not configured" });
    return;
  }

  if (!E164_PHONE_NUMBER.test(callerId)) {
    res.status(500).json({ error: "Twilio caller ID is invalid" });
    return;
  }

  try {
    const voiceResponse = new twilio.twiml.VoiceResponse();
    const dial = voiceResponse.dial({ callerId });
    dial.number(to);

    res.type("text/xml").send(voiceResponse.toString());
  } catch {
    res.status(500).json({ error: "Unable to generate voice instructions" });
  }
});

export default router;