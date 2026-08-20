import { Router, type IRouter } from "express";
import twilio from "twilio";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/token", (_req, res) => {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const apiKeySid = process.env["TWILIO_API_KEY_SID"];
  const apiKeySecret = process.env["TWILIO_API_KEY_SECRET"];
  const twimlAppSid = process.env["TWILIO_TWIML_APP_SID"];

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    res.status(500).json({ error: "Twilio token configuration is incomplete" });
    return;
  }

  try {
    const accessToken = new twilio.jwt.AccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      { identity: "ai-sales-coach-browser" },
    );
    const voiceGrant = new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
    });

    accessToken.addGrant(voiceGrant);
    res.json({ token: accessToken.toJwt() });
  } catch (error) {
    logger.error({ err: error }, "Failed to generate Twilio access token");
    res.status(500).json({ error: "Unable to generate Twilio access token" });
  }
});

export default router;