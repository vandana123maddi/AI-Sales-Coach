import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import twilio from "twilio";
import { WebSocket } from "ws";
import app from "../src/app";
import { buildPstnConferenceTwiml } from "../src/routes/voice";
import { attachMediaStreamServer, mediaStreamUrl } from "../src/services/mediaStreams";
import { createRealCallSession, getRealCallSessionForCall } from "../src/services/realCallSessions";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const authToken = process.env.TWILIO_AUTH_TOKEN;
const signedUrl = mediaStreamUrl();
assert.ok(authToken && signedUrl, "TWILIO_AUTH_TOKEN and TWILIO_PUBLIC_BASE_URL are required for this local signed-websocket test");

// Deliberately avoid an external Deepgram request: this validates the Twilio
// transport boundary, including base64 decoding and orderly stop handling.
process.env.DEEPGRAM_API_KEY = "";

const server = createServer(app);
attachMediaStreamServer(server);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");

const session = createRealCallSession("CA" + "1".repeat(32));
const streamTwiml = buildPstnConferenceTwiml(session.conferenceName, signedUrl, session.id);
assert.match(streamTwiml, /<Start><Stream[^>]*track="both_tracks"/);
assert.match(streamTwiml, /<Parameter name="sessionId"/);
assert.match(streamTwiml, /<Conference>/);
const voiceUrl = signedUrl.replace(/^wss:/, "https:").replace(/\/media-stream$/, "/api/voice");
const browserCallSid = "CA" + "3".repeat(32);
const pstnParams = { CallSid: session.callSid };
const pstnResponse = await fetch(`http://127.0.0.1:${address.port}/api/voice`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Twilio-Signature": twilio.getExpectedTwilioSignature(authToken, voiceUrl, pstnParams),
  },
  body: new URLSearchParams(pstnParams),
});
const pstnTwiml = await pstnResponse.text();
assert.equal(pstnResponse.status, 200);
assert.match(pstnResponse.headers.get("content-type") || "", /^text\/xml/);
assert.match(pstnTwiml, /<Start><Stream[^>]*track="both_tracks"/);
assert.match(pstnTwiml, /<Conference>/);

const browserParams = { sessionId: session.id, CallSid: browserCallSid };
const browserResponse = await fetch(`http://127.0.0.1:${address.port}/api/voice`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Twilio-Signature": twilio.getExpectedTwilioSignature(authToken, voiceUrl, browserParams),
  },
  body: new URLSearchParams(browserParams),
});
const browserTwiml = await browserResponse.text();
assert.equal(browserResponse.status, 200);
assert.match(browserTwiml, /<Conference[^>]*endConferenceOnExit="true"/);
assert.equal(getRealCallSessionForCall(browserCallSid), session);

const signature = twilio.getExpectedTwilioSignature(authToken, signedUrl, {});
const socket = new WebSocket(`ws://127.0.0.1:${address.port}/media-stream`, {
  headers: { "X-Twilio-Signature": signature },
});

await once(socket, "open");
socket.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
socket.send(JSON.stringify({
  event: "start",
  start: {
    streamSid: "MZ" + "2".repeat(32),
    callSid: session.callSid,
    tracks: ["inbound", "outbound"],
    customParameters: { sessionId: session.id },
    mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
  },
}));
socket.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from([0xff, 0x7f]).toString("base64") } }));
socket.send(JSON.stringify({ event: "stop", stop: { streamSid: "MZ" + "2".repeat(32) } }));

await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(session.state, "transcript-active");
socket.close();
await once(socket, "close");
await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

console.log("PASS: signed mock voice webhook and Twilio Media Stream start/media/stop flow");
