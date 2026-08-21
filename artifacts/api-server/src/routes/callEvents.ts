import { Router, type IRouter, type Response } from "express";
import { getRealCallSession, subscribeToRealCall, type RealCallEvent } from "../services/realCallSessions";

const router: IRouter = Router();

function sendEvent(res: Response, event: RealCallEvent) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

router.get("/call-sessions/:sessionId/events", (req, res) => {
  const session = getRealCallSession(req.params["sessionId"]);
  if (!session) { res.status(404).json({ error: "Unknown real-call session" }); return; }
  res.status(200).set({ "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream" });
  res.flushHeaders();
  sendEvent(res, { type: "state", state: session.state });
  session.turns.forEach((turn) => sendEvent(res, { type: "transcript", turn }));
  const unsubscribe = subscribeToRealCall(session, (event) => sendEvent(res, event));
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});

export default router;
