import { Router, type IRouter } from "express";
import twilio from "twilio";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type TwilioTokenConfig = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
};

let credentialValidation: Promise<void> | undefined;

function getTwilioTokenConfig(): TwilioTokenConfig | null {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  const apiKeySid = process.env["TWILIO_API_KEY_SID"]?.trim();
  const apiKeySecret = process.env["TWILIO_API_KEY_SECRET"]?.trim();
  const twimlAppSid = process.env["TWILIO_TWIML_APP_SID"]?.trim();

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    return null;
  }

  return { accountSid, apiKeySid, apiKeySecret, twimlAppSid };
}

export function isExpectedBrowserVoiceUrl(voiceUrl: string | null | undefined) {
  const publicBaseUrl = process.env["TWILIO_PUBLIC_BASE_URL"]?.trim().replace(/\/$/, "");
  return Boolean(publicBaseUrl && voiceUrl === `${publicBaseUrl}/api/voice`);
}

function validateApiKeyPair(config: TwilioTokenConfig): Promise<void> {
  if (!credentialValidation) {
    const client = twilio(config.apiKeySid, config.apiKeySecret, {
      accountSid: config.accountSid,
    });

    credentialValidation = Promise.all([
      client.api.v2010.accounts(config.accountSid).fetch(),
      client.applications(config.twimlAppSid).fetch(),
    ])
      .then(([, application]) => {
        if (application.voiceMethod?.toUpperCase() !== "POST") {
          throw new Error("The configured TwiML App Voice URL must use POST");
        }

        if (!isExpectedBrowserVoiceUrl(application.voiceUrl)) {
          throw new Error("The configured TwiML App Voice URL must be exactly TWILIO_PUBLIC_BASE_URL/api/voice");
        }
      })
      .catch((error: unknown) => {
        credentialValidation = undefined;
        throw error;
      });
  }

  return credentialValidation;
}

router.post("/token", async (_req, res) => {
  const config = getTwilioTokenConfig();

  if (!config) {
    res.status(500).json({ error: "Twilio token configuration is incomplete" });
    return;
  }

  try {
    // Twilio validates Voice SDK access tokens with this API Key SID/Secret
    // pair, not with the account Auth Token used by other REST API calls.
    await validateApiKeyPair(config);

    const accessToken = new twilio.jwt.AccessToken(
      config.accountSid,
      config.apiKeySid,
      config.apiKeySecret,
      { identity: "ai-sales-coach-browser" },
    );
    const voiceGrant = new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: config.twimlAppSid,
    });

    accessToken.addGrant(voiceGrant);
    res.json({ token: accessToken.toJwt() });
  } catch (error) {
    logger.error(
      { err: error },
      "Twilio API Key validation or access-token generation failed",
    );
    res.status(500).json({
      error:
        "Twilio API Key or Voice App configuration could not be validated",
    });
  }
});

export default router;
