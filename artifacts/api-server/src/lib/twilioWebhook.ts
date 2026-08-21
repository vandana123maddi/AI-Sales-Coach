import type { Request } from "express";
import twilio from "twilio";

function publicRequestUrl(req: Request) {
  const baseUrl = process.env["TWILIO_PUBLIC_BASE_URL"]?.trim().replace(/\/$/, "");
  return baseUrl ? `${baseUrl}${req.originalUrl}` : null;
}

/** Validates form-encoded Twilio webhooks against the configured public URL. */
export function hasValidTwilioSignature(req: Request) {
  const authToken = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  const signature = req.header("X-Twilio-Signature");
  const url = publicRequestUrl(req);
  if (!authToken || !signature || !url) return false;
  return twilio.validateRequest(authToken, signature, url, req.body as Record<string, string>);
}
