# AI Sales Coach

## 1. Project title

AI Sales Coach

## 2. What the AI Sales Coach does

This repository contains a TypeScript prototype for guiding live real-estate sales conversations. The application can:

- start an outbound Twilio call from a browser dial pad,
- join a conference call for a real phone conversation,
- listen to Twilio Media Streams over a public HTTPS/WSS endpoint,
- send separate audio streams to Deepgram for realtime speech-to-text,
- display a live transcript with customer/salesperson separation,
- call a live LLM for coach guidance in the moment,
- generate a post-call summary from the final transcript.

It also includes a demo mode that simulates the same transcript and coaching flow without requiring live external providers.

## 3. Assignment objective

This project is a prototype built for the Quantum Gandiva AI Sales Coach assignment. The objective is to evaluate a sales coach that helps an agent during real-estate conversations by identifying conversation stage, objections, urgency, sentiment, and the best next action grounded in the actual transcript.

## 4. Architecture overview

The repository contains a React/Vite frontend and a Node.js/Express API server in the artifacts workspace. The current live call flow is:

- browser dial pad sends a request to the API,
- the API creates a Twilio outbound call,
- Twilio reaches the real phone,
- Twilio Voice creates a Media Stream for the call,
- the API validates the Twilio WebSocket and forwards audio to Deepgram,
- the API stores transcript turns and emits them over SSE,
- the frontend renders the live transcript,
- the Sales Coach LLM analyzes final transcript turns and returns coaching,
- a post-call summary is generated from the transcript.

The prototype intentionally keeps session state in memory on the API server and uses a single-process architecture.

## 5. End-to-end call flow

Browser Dial Pad
→ backend API endpoint
→ Twilio outbound call
→ real phone
→ Twilio Media Stream
→ WebSocket
→ Deepgram real-time STT
→ speaker-separated transcript
→ Live Transcript UI
→ Sales Coach LLM
→ next-best move
→ post-call summary

This is the actual implemented flow in the repository. The live path is driven by Twilio Media Streams and Deepgram, while the demo path uses an in-browser script and the same API coaching endpoints.

## 6. Features

- browser dial pad
- outbound calling
- call status tracking
- realtime transcription
- speaker separation
- live transcript UI
- Sales Coach
- current conversation stage
- sentiment and temperature signals
- next-best move
- post-call summary
- demo coach

### Current implemented capabilities

- The browser dial pad can start either a transcription or keypad trial mode call.
- The API can place Twilio outbound calls and hang them up.
- The real transcript path uses a Twilio Media Stream WebSocket and Deepgram to produce final turns with speaker labels.
- The Sales Coach uses final transcript turns to return a current stage, sentiment, urgency, objection, and next best move.
- Post-call summary uses the final transcript to produce a structured summary.
- Demo Coach runs a four-stage simulated conversation through the same transcript and coaching endpoints.

## 7. Technology choices

| Technology | Purpose | Why chosen |
| --- | --- | --- |
| React + Vite | Frontend UI and dial pad | Fast browser app for demo and live-call interaction |
| Node.js + Express | API server and routes | Handles Twilio callbacks, transcript events, coach calls, and summary generation |
| TypeScript | Application implementation | Strong typing across API and frontend code |
| Twilio | Outbound calling and Voice webhooks | Required for real phone calls and Media Streams |
| Twilio Media Streams | Real-time audio ingestion from live calls | Provides the required WebSocket audio stream for transcription |
| WebSocket | Twilio Media Stream connection | Required by the live streaming pipeline |
| Deepgram | Real-time speech-to-text | Used for final transcript generation from Twilio audio |
| OpenAI-compatible LLM endpoint | Sales Coach and summary analysis | The API sends prompt payloads to the configured chat-completions endpoint |
| SSE | Live transcript delivery to the frontend | Used for session transcript and state events |
| pnpm workspaces | Monorepo package management | Organizes the API server, mockup sandbox, and shared libs |

## 8. Environment variables

The source of truth for the server-side environment is the template in the API package. Use the variable names below. Do not expose actual secrets in documentation or source control.

- PORT
- LLM_API_KEY
- LLM_API_BASE_URL
- LLM_MODEL
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER
- DEEPGRAM_API_KEY
- TWILIO_PUBLIC_BASE_URL
- TWILIO_API_KEY_SID
- TWILIO_API_KEY_SECRET
- TWILIO_TWIML_APP_SID

For the repo, the local template is at [artifacts/api-server/.env.example](artifacts/api-server/.env.example). The .gitignore explicitly ignores .env files and keeps the template checked in.

## 9. Installation

### Prerequisites

- Node.js
- pnpm
- Twilio account and a Voice-capable Twilio phone number
- public HTTPS endpoint for Twilio callbacks and Media Streams
- Deepgram API key for live transcription
- LLM API key for the Sales Coach and summary generation

### Exact commands

From the repository root:

1. Install dependencies
   pnpm install

2. Run the API server
   pnpm --dir artifacts/api-server run dev

3. Run the frontend
   pnpm --dir artifacts/mockup-sandbox run dev

4. If needed, build the workspace
   pnpm run build

5. If needed, typecheck the workspace
   pnpm run typecheck

## 10. Local development

To run the prototype locally:

1. Copy the environment template to a local .env file in the API package.
2. Fill in the required variable names for the environment you are using.
3. Start the Express API server from the API package.
4. Start the Vite frontend from the mockup sandbox package.
5. Open the frontend and start either the demo flow or a live call.

The frontend reads the API base URL from the Vite environment if set; otherwise it uses /api.

## 11. Public HTTPS requirement

Twilio Media Streams require a publicly reachable HTTPS/WSS endpoint for real calls. The implementation validates the callback URL and expects a publicly reachable base URL to be configured as TWILIO_PUBLIC_BASE_URL. This is required because Twilio reaches the API over the internet and the Media Stream WebSocket must be reachable without private-network restrictions.

If the endpoint is not public, Twilio cannot reach the API and the live transcription pipeline cannot be established.

## 12. Testing

The repository contains the following test commands:

- pnpm --dir artifacts/api-server run typecheck
- pnpm --dir artifacts/api-server run test:transcription-flow
- pnpm --dir artifacts/api-server run test:media-stream
- pnpm --dir artifacts/api-server run test:demo-sequence
- pnpm --dir artifacts/mockup-sandbox run typecheck
- pnpm run typecheck
- pnpm run build
- git diff --check

The test suite is intentionally limited: some live-call tests require Twilio and public callback configuration, and the real call validation is not claimed as fully verified in this environment.

## 13. Production/build commands

Actual project commands available in the repo:

- root typecheck: pnpm run typecheck
- root build: pnpm run build
- API package build: pnpm --dir artifacts/api-server run build
- API package start: pnpm --dir artifacts/api-server run start
- API package typecheck: pnpm --dir artifacts/api-server run typecheck
- frontend build: pnpm --dir artifacts/mockup-sandbox run build
- frontend typecheck: pnpm --dir artifacts/mockup-sandbox run typecheck

## 14. Troubleshooting

### Twilio Trial restrictions

Twilio trial accounts often restrict call destinations and require a verified destination number. The implementation includes real-call flow logic and a keypad mode for deterministic testing, but live calls still depend on account restrictions and number verification.

### Verified destination number requirement

A Twilio Trial account usually requires the destination number to be verified before the app can call it. Without this, calls fail or are rejected.

### Public HTTPS/WSS requirement

If TWILIO_PUBLIC_BASE_URL is missing or not publicly reachable, the API rejects Twilio callbacks and cannot start a live Media Stream pipeline.

### Missing environment variables

The app fails gracefully when the API server is missing required variables. For example, live call creation fails if Twilio is not configured, and Sales Coach or summary generation fails if LLM configuration is absent.

### Deepgram connection failures

If the Deepgram API key is not configured or the Deepgram stream cannot connect, the live transcription pipeline is unavailable. The app reports a session error when this occurs.

### Twilio webhook failures

The Voice routes validate the Twilio signature. If it is invalid, the request is rejected. The app also validates the TwiML App Voice URL to ensure it matches the configured public base URL.

### WebSocket failures

A Media Stream socket may fail or disconnect during a live session. The session logic attempts to close streams and update session state, but real websocket reliability still depends on public connectivity and provider health.

### Call termination cleanup

When the call ends, the session is marked ended and cleanup listeners close the associated stream state. This prevents stale transcript or callback processing from continuing after the end of the call.

## 15. Known limitations

This project is a prototype and has important limitations that should be documented honestly.

- Twilio Trial restrictions can block or limit real outbound calling.
- Real STT depends on free-tier or configured provider limits and provider availability.
- LLM guidance depends on configured credentials and provider availability.
- Browser and Twilio Voice SDK behaviour can vary depending on browser permissions and network setup.
- The current architecture is deliberately a one-call-at-a-time prototype in the API session layer.
- The system is not designed for production scaling across many concurrent calls.
- There is no durable persistence layer for a production-grade call record system.
- The app keeps session state in memory and is not intended to be horizontally scaled without additional work.

## 16. Security

- secrets belong in a local .env file and must not be committed to source control,
- .env files are ignored by git, while .env.example remains as the tracked placeholder,
- Twilio webhook signature validation is required before accepting callbacks,
- API key handling must remain server-side,
- sensitive provider credentials should be kept out of logs and UI code,
- only public-facing endpoints should be configured for Twilio callbacks.

## 17. Assignment mapping

Quantum Gandiva AI Deliverables

- Deliverable 1 — Live demonstration
- Deliverable 2 — Source code
- Deliverable 3 — README
- Deliverable 4 — Domain research + prompt design
- Deliverable 5 — System design

This repository includes:

- the live implementation and code for the demo and real call flow,
- the README for submission,
- the domain research and prompt design document at [docs/domain-research-and-prompt-design.md](docs/domain-research-and-prompt-design.md),
- the system design document at [docs/system-design.md](docs/system-design.md).

The code, docs, and prototype are all in this repository as the submission package.
