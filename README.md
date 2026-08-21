# AI Sales Coach

## Overview

AI Sales Coach is a TypeScript prototype for guiding real-estate buyer and vendor conversations. A browser user can place a Twilio call, receive speaker-separated final transcript events from Twilio Media Streams and Deepgram, see grounded coaching, and generate a post-call summary. A Trial-safe keypad mode and Demo Coach remain available independently.

## Architecture

The React/Vite frontend subscribes to a per-call SSE endpoint. The Express API creates and tracks an in-memory real-call session, accepts a signed Twilio Media Stream WebSocket, sends its separate μ-law audio tracks to Deepgram, emits final transcript events, and calls a Gemini-compatible chat-completions endpoint for coaching and summaries. See [docs/system-design.md](docs/system-design.md).

## Features

- Browser dial pad and Twilio outbound phone calls
- Real-call lifecycle, CallSid/session mapping, and hang-up
- Final, speaker-separated Deepgram transcription from Twilio Media Streams (`customer` / `salesperson`)
- Real-time Sales Coach: conversation stage, sentiment, objection, and next-best move
- Post-call summary from final transcript turns
- Trial Phone Mode using signed DTMF `<Gather>` callbacks
- Sequential Demo Coach: transcript → coach → per-interaction summary, four times

## Tech stack

- Node.js, pnpm workspaces, TypeScript
- Express 5, Twilio Node SDK 6.1.0, Twilio Voice SDK
- React, Vite, Tailwind-based UI
- Gemini-compatible OpenAI chat-completions API
- Server-Sent Events

## Prerequisites

- Node.js 24+ and Corepack/pnpm
- A Twilio account and Voice-capable Twilio phone number
- A verified destination number for a Twilio Trial account
- A Gemini-compatible `LLM_API_KEY`
- A Deepgram `DEEPGRAM_API_KEY` for real transcription calls
- A public HTTPS URL such as ngrok for Twilio webhooks

## Environment variables

Copy `artifacts/api-server/.env.example` to `artifacts/api-server/.env` and supply only server-side secrets:

```dotenv
PORT=5000
LLM_API_KEY=
LLM_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=gemini-3.5-flash-lite
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
DEEPGRAM_API_KEY=
TWILIO_PUBLIC_BASE_URL=https://your-public-https-url
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_TWIML_APP_SID=
```

Never use `VITE_` prefixes for Twilio, Deepgram, or LLM secrets.

## Install and run

```sh
corepack pnpm install
corepack pnpm --filter @workspace/api-server dev
PORT=5173 BASE_PATH=/ corepack pnpm --filter @workspace/mockup-sandbox dev
```

The frontend uses `VITE_API_BASE_URL` when supplied, otherwise `/api`.

## Twilio setup

1. Expose the API with a public HTTPS endpoint and set `TWILIO_PUBLIC_BASE_URL`.
2. Create a TwiML App with Voice URL `https://your-url/api/voice`, method `POST`.
3. Configure the API Key SID/Secret and TwiML App SID for the browser conference participant.
4. On a Trial account, verify the destination number and use **Trial Phone Mode — Keypad** for deterministic phone testing.

The real transcription `Calls.json` request always uses the literal
`${TWILIO_PUBLIC_BASE_URL}/api/voice` URL. It never uses a Twilio hosted Voice
template, `voice_speech_recognition`, `voice_conference`, or the keypad route;
`/api/voice` immediately returns `<Start><Stream track="both_tracks" ...>`
with a `wss://…/media-stream` URL. The browser TwiML App is also validated to
use that exact endpoint.

## Demo mode

**Start Demo Call** continues to run the existing simulated transcript through the same Live Transcript, coach, and summary endpoints. It does not require Twilio or Deepgram credentials.

## Real call modes

- **Place real transcription call:** outbound customer call plus browser conference. The customer call leg starts a signed `<Start><Stream track="both_tracks">` at `wss://your-public-host/media-stream`; the API sends each mono μ-law track to a separate Deepgram `nova-3` connection. On this outbound-call leg, Twilio `inbound` is the customer and `outbound` is the browser salesperson.
- **Trial Phone Mode — Keypad:** outbound call with Twilio `<Gather>`; press 1 Product, 2 Pricing, 3 Objection, or 4 Next Step. It creates final `dtmf` transcript turns without conference transcription.

## Testing

```sh
corepack pnpm --filter @workspace/api-server typecheck
corepack pnpm --filter @workspace/api-server test:transcription-flow
corepack pnpm --filter @workspace/api-server test:media-stream
corepack pnpm --filter @workspace/mockup-sandbox typecheck
corepack pnpm --filter @workspace/api-server build
PORT=5173 BASE_PATH=/ NODE_ENV=production corepack pnpm --filter @workspace/mockup-sandbox build
git diff --check
```

## Known limitations

The Media Stream adapter is code-verified, but real phone, public-WebSocket, live Deepgram, live Gemini, and browser end-to-end validation require configured external credentials and are intentionally not claimed by local tests.
