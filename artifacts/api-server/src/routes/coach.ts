import { Router, type IRouter } from "express";
import { getCoaching, type SalesCoachContext, type TranscriptTurnInput } from "../services/salesCoach";

const router: IRouter = Router();

router.post("/coach", async (req, res) => {
  const context = parseContext(req.body);
  if (!context) {
    res.status(400).json({ error: "A valid sessionId and transcript turns are required" });
    return;
  }

  res.json(await getCoaching(context));
});

function parseContext(body: unknown): SalesCoachContext | null {
  if (!body || typeof body !== "object") return null;
  const input = body as { sessionId?: unknown; prospectPhoneNumber?: unknown; turns?: unknown };
  if (typeof input.sessionId !== "string" || !Array.isArray(input.turns)) return null;

  const turns = input.turns
    .slice(-100)
    .map(parseTurn)
    .filter((turn): turn is TranscriptTurnInput => turn !== null);
  if (turns.length !== input.turns.length) return null;

  return {
    sessionId: input.sessionId,
    prospectPhoneNumber:
      typeof input.prospectPhoneNumber === "string" ? input.prospectPhoneNumber : undefined,
    turns,
  };
}

function parseTurn(value: unknown): TranscriptTurnInput | null {
  if (!value || typeof value !== "object") return null;
  const turn = value as Partial<TranscriptTurnInput>;
  if (
    typeof turn.id !== "string" ||
    typeof turn.turnId !== "string" ||
    typeof turn.sessionId !== "string" ||
    (turn.speaker !== "salesperson" && turn.speaker !== "customer") ||
    typeof turn.text !== "string" ||
    typeof turn.source !== "string" ||
    (turn.state !== "interim" && turn.state !== "final") ||
    typeof turn.occurredAt !== "string"
  ) {
    return null;
  }

  return {
    ...turn,
    confidence: typeof turn.confidence === "number" ? turn.confidence : undefined,
  } as TranscriptTurnInput;
}

export default router;
