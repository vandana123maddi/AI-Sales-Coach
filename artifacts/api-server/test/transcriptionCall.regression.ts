import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import twilio from "twilio";
import app from "../src/app";
import { isExpectedBrowserVoiceUrl } from "../src/routes/token";
import { mediaStreamUrl } from "../src/services/mediaStreams";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  phone: process.env.TWILIO_PHONE_NUMBER,
  publicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL,
};
const accountSid = "AC" + "1".repeat(32);
const authToken = "regression-auth-token";
const publicBaseUrl = "https://public.example.test";
const callSid = "CA" + "2".repeat(32);
process.env.TWILIO_ACCOUNT_SID = accountSid;
process.env.TWILIO_AUTH_TOKEN = authToken;
process.env.TWILIO_PHONE_NUMBER = "+14155550100";
process.env.TWILIO_PUBLIC_BASE_URL = publicBaseUrl;

let capturedCallsRequest: URL | undefined;
let capturedCallBody = "";
let localBaseUrl = "";
let voiceWebhookResponse: Response | undefined;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  capturedCallsRequest = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  capturedCallBody = String(init?.body || "");
  const voiceUrl = new URLSearchParams(capturedCallBody).get("Url");
  assert.equal(voiceUrl, `${publicBaseUrl}/api/voice`);
  const params = { CallSid: callSid };
  voiceWebhookResponse = await originalFetch(`${localBaseUrl}/api/voice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": twilio.getExpectedTwilioSignature(authToken, voiceUrl, params),
    },
    body: new URLSearchParams(params),
  });
  return new Response(JSON.stringify({ sid: callSid, status: "completed" }), { status: 201, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

try {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  localBaseUrl = `http://127.0.0.1:${address.port}`;
  const createResponse = await originalFetch(`${localBaseUrl}/api/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "+14155550101", mode: "transcription" }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal(capturedCallsRequest?.pathname, `/2010-04-01/Accounts/${accountSid}/Calls.json`);
  const payload = new URLSearchParams(capturedCallBody);
  const voiceUrl = payload.get("Url");
  assert.equal(voiceUrl, `${publicBaseUrl}/api/voice`);
  assert.doesNotMatch(voiceUrl || "", /voice_speech_recognition|voice_conference|\/api\/voice\/keypad|webhooks\.twilio\.com\/v1\/Voice\/Template/i);
  assert.equal(isExpectedBrowserVoiceUrl(voiceUrl), true);
  assert.equal(isExpectedBrowserVoiceUrl(`${publicBaseUrl}/api/voice/keypad`), false);
  assert.equal(isExpectedBrowserVoiceUrl("https://webhooks.twilio.com/v1/Voice/Template/voice_speech_recognition"), false);

  assert.ok(voiceWebhookResponse, "the Calls API mock must invoke the exact Voice URL before completing the call");
  const twiml = await voiceWebhookResponse.text();
  assert.equal(voiceWebhookResponse.status, 200);
  assert.match(twiml, /<Start><Stream[^>]*track="both_tracks"[^>]*url="wss:\/\/public\.example\.test\/media-stream"/);
  assert.match(twiml, /<Conference>/);
  assert.equal(mediaStreamUrl(), "wss://public.example.test/media-stream");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  console.log("PASS: transcription Calls API URL is the literal /api/voice endpoint and returns Media Stream TwiML");
} finally {
  globalThis.fetch = originalFetch;
  restoreEnvironment("TWILIO_ACCOUNT_SID", originalEnvironment.accountSid);
  restoreEnvironment("TWILIO_AUTH_TOKEN", originalEnvironment.authToken);
  restoreEnvironment("TWILIO_PHONE_NUMBER", originalEnvironment.phone);
  restoreEnvironment("TWILIO_PUBLIC_BASE_URL", originalEnvironment.publicBaseUrl);
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
