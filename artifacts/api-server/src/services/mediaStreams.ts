import type { IncomingMessage } from "node:http";
import { DeepgramClient } from "@deepgram/sdk";
import { WebSocketServer, type WebSocket } from "ws";
import twilio from "twilio";
import {
  addRealTranscriptTurn,
  getRealCallSession,
  getRealCallSessionForCall,
  registerRealCallSessionCleanup,
  reportRealCallError,
  setRealCallState,
  type RealCallSession,
} from "./realCallSessions";
import { logger } from "../lib/logger";

type TwilioTrack = "inbound" | "outbound";
type DeepgramConnection = {
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "error" | "close", listener: (error?: unknown) => void): void;
  connect(): void;
  waitForOpen(): Promise<unknown>;
  sendMedia(audio: Buffer): void;
  sendCloseStream(message: { type: "CloseStream" }): void;
};

type TrackStream = {
  connection?: DeepgramConnection;
  opening?: Promise<void>;
  pendingAudio: Buffer[];
};

type StreamContext = {
  session: RealCallSession;
  streamSid: string;
  callSid: string;
  mediaFormat: { encoding: string; sampleRate: number; channels: number };
  tracks: Map<TwilioTrack, TrackStream>;
  closed: boolean;
};

const MAX_PENDING_AUDIO_FRAMES = 300;
const activeStreams = new Map<string, StreamContext>();

/**
 * In this outbound-call conference topology, the PSTN call leg is the customer:
 * Twilio's inbound track is audio it receives from that customer and outbound is
 * the conference/browser salesperson audio delivered back to the customer.
 */
export function speakerForTwilioTrack(track: TwilioTrack) {
  return track === "inbound" ? "customer" as const : "salesperson" as const;
}

export function mediaStreamUrl(publicBaseUrl = process.env["TWILIO_PUBLIC_BASE_URL"]?.trim()) {
  const baseUrl = publicBaseUrl?.replace(/\/$/, "");
  if (!baseUrl || !/^https:\/\//.test(baseUrl)) return null;
  return `${baseUrl.replace(/^https:/, "wss:")}/media-stream`;
}

export function attachMediaStreamServer(server: import("node:http").Server) {
  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    if (requestUrl.pathname !== "/media-stream") return;
    if (!hasValidMediaStreamSignature(request)) {
      logger.warn({ path: requestUrl.pathname }, "Rejected unsigned Twilio Media Stream handshake");
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (webSocket) => handleTwilioSocket(webSocket));
  registerRealCallSessionCleanup((session) => stopStreamsForSession(session.id));
  return webSocketServer;
}

function hasValidMediaStreamSignature(request: IncomingMessage) {
  const authToken = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  const signature = request.headers["x-twilio-signature"];
  const url = mediaStreamUrl();
  if (!authToken || typeof signature !== "string" || !url) return false;
  // Twilio documents that some Voice WSS handshakes sign a URL with a trailing slash.
  return twilio.validateRequest(authToken, signature, url, {}) ||
    twilio.validateRequest(authToken, signature, `${url}/`, {});
}

function handleTwilioSocket(webSocket: WebSocket) {
  let context: StreamContext | undefined;

  webSocket.on("message", (rawData, isBinary) => {
    if (isBinary) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(rawData.toString()) as Record<string, unknown>;
    } catch {
      logger.warn("Ignored invalid JSON from Twilio Media Stream");
      return;
    }
    const event = typeof message["event"] === "string" ? message["event"] : "";
    if (event === "connected") {
      logger.info("Twilio Media Stream connected");
    } else if (event === "start") {
      if (context) return;
      context = startStream(message);
    } else if (event === "media" && context) {
      forwardMedia(context, message);
    } else if (event === "stop" && context) {
      logger.info({ streamSid: context.streamSid, callSid: context.callSid }, "Twilio Media Stream stopped");
      closeStream(context);
    }
  });
  webSocket.on("error", (error) => logger.warn({ err: error }, "Twilio Media Stream socket error"));
  webSocket.on("close", () => {
    if (context) closeStream(context);
  });
}

function startStream(message: Record<string, unknown>) {
  const start = record(message["start"]);
  const streamSid = stringValue(start["streamSid"]);
  const callSid = stringValue(start["callSid"]);
  const customParameters = record(start["customParameters"]);
  const session = getRealCallSessionForCall(callSid);
  const requestedSessionId = stringValue(customParameters["sessionId"]);
  if (!streamSid || !callSid || !session || session.mode !== "transcription" || (requestedSessionId && requestedSessionId !== session.id)) {
    logger.warn({ streamSid, callSid, requestedSessionId }, "Rejected Media Stream for an unknown or mismatched call session");
    return undefined;
  }
  if (session.state === "ended" || session.state === "failed") return undefined;
  const suppliedFormat = record(start["mediaFormat"]);
  const mediaFormat = {
    encoding: stringValue(suppliedFormat["encoding"]),
    sampleRate: numberValue(suppliedFormat["sampleRate"]),
    channels: numberValue(suppliedFormat["channels"]),
  };
  if (mediaFormat.encoding !== "audio/x-mulaw" || mediaFormat.sampleRate !== 8000 || mediaFormat.channels !== 1) {
    reportRealCallError(session, "Twilio Media Stream supplied an unsupported audio format.");
    logger.warn({ streamSid, callSid, mediaFormat }, "Unsupported Twilio Media Stream format");
    return undefined;
  }
  const context: StreamContext = { session, streamSid, callSid, mediaFormat, tracks: new Map(), closed: false };
  activeStreams.set(streamSid, context);
  setRealCallState(session, "transcript-active");
  logger.info({ streamSid, callSid, tracks: start["tracks"], mediaFormat }, "Twilio Media Stream started");
  return context;
}

function forwardMedia(context: StreamContext, message: Record<string, unknown>) {
  if (context.closed || isTerminal(context.session)) return;
  const media = record(message["media"]);
  const track = stringValue(media["track"]);
  const payload = stringValue(media["payload"]);
  if ((track !== "inbound" && track !== "outbound") || !payload) return;
  let audio: Buffer;
  try {
    audio = Buffer.from(payload, "base64");
  } catch {
    return;
  }
  if (!audio.length) return;
  let trackStream = context.tracks.get(track);
  if (!trackStream) {
    trackStream = { pendingAudio: [] };
    context.tracks.set(track, trackStream);
    trackStream.opening = openDeepgramTrack(context, track, trackStream);
  }
  if (trackStream.connection) {
    sendAudio(trackStream.connection, audio, context, track);
  } else if (trackStream.pendingAudio.length < MAX_PENDING_AUDIO_FRAMES) {
    trackStream.pendingAudio.push(audio);
  }
}

async function openDeepgramTrack(context: StreamContext, track: TwilioTrack, trackStream: TrackStream) {
  const apiKey = process.env["DEEPGRAM_API_KEY"]?.trim();
  if (!apiKey || context.closed || isTerminal(context.session)) {
    if (!apiKey) reportRealCallError(context.session, "Deepgram transcription is not configured.");
    return;
  }
  try {
    const client = new DeepgramClient({ apiKey });
    const connection = await client.listen.v1.connect({
      model: "nova-3",
      encoding: "mulaw",
      sample_rate: 8000,
      channels: 1,
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "300",
    }) as DeepgramConnection;
    connection.on("message", (result) => handleDeepgramResult(context, track, result));
    connection.on("error", (error) => {
      if (!context.closed) logger.warn({ err: error, streamSid: context.streamSid, track }, "Deepgram stream error");
    });
    connection.on("close", () => logger.info({ streamSid: context.streamSid, track }, "Deepgram stream closed"));
    connection.connect();
    await connection.waitForOpen();
    if (context.closed || isTerminal(context.session)) {
      connection.sendCloseStream({ type: "CloseStream" });
      return;
    }
    trackStream.connection = connection;
    logger.info({ streamSid: context.streamSid, callSid: context.callSid, track }, "Deepgram stream connected");
    trackStream.pendingAudio.splice(0).forEach((audio) => sendAudio(connection, audio, context, track));
  } catch (error) {
    if (!context.closed) {
      logger.error({ err: error, streamSid: context.streamSid, track }, "Unable to connect Deepgram stream");
      reportRealCallError(context.session, "Unable to connect the live speech-to-text service.");
    }
  }
}

function sendAudio(connection: DeepgramConnection, audio: Buffer, context: StreamContext, track: TwilioTrack) {
  try {
    connection.sendMedia(audio);
  } catch (error) {
    logger.warn({ err: error, streamSid: context.streamSid, track }, "Unable to forward audio to Deepgram");
  }
}

function handleDeepgramResult(context: StreamContext, track: TwilioTrack, result: unknown) {
  if (context.closed || isTerminal(context.session)) return;
  const data = record(result);
  if (data["type"] !== "Results" || data["is_final"] !== true) return;
  const channel = record(data["channel"]);
  const alternatives = Array.isArray(channel["alternatives"]) ? channel["alternatives"] : [];
  const alternative = record(alternatives[0]);
  const text = stringValue(alternative["transcript"]).trim();
  if (!text) return;
  const start = numberValue(data["start"]);
  const duration = numberValue(data["duration"]);
  const id = `${context.streamSid}-${track}-${start}-${duration}`;
  addRealTranscriptTurn(context.session, {
    id,
    turnId: `${context.session.id}-turn-${id}`,
    sessionId: context.session.id,
    speaker: speakerForTwilioTrack(track),
    text,
    source: "speech-to-text",
    state: "final",
    occurredAt: new Date().toISOString(),
    ...(typeof alternative["confidence"] === "number" ? { confidence: alternative["confidence"] } : {}),
    callSid: context.callSid,
  });
}

function closeStream(context: StreamContext) {
  if (context.closed) return;
  context.closed = true;
  activeStreams.delete(context.streamSid);
  context.tracks.forEach((trackStream) => {
    trackStream.pendingAudio.length = 0;
    try { trackStream.connection?.sendCloseStream({ type: "CloseStream" }); } catch { /* connection was already closed */ }
  });
}

function stopStreamsForSession(sessionId: string) {
  [...activeStreams.values()]
    .filter((context) => context.session.id === sessionId)
    .forEach(closeStream);
}

function isTerminal(session: RealCallSession) {
  return session.state === "ended" || session.state === "failed";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
