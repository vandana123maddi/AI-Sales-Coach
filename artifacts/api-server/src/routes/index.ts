import { Router, type IRouter } from "express";
import callRouter from "./call";
import callEventsRouter from "./callEvents";
import coachRouter from "./coach";
import healthRouter from "./health";
import keypadRouter from "./keypad";
import postCallSummaryRouter from "./postCallSummary";
import tokenRouter from "./token";
import transcriptionRouter from "./transcription";
import voiceRouter from "./voice";

const router: IRouter = Router();

router.use(healthRouter);
router.use(keypadRouter);
router.use(callRouter);
router.use(callEventsRouter);
router.use(coachRouter);
router.use(postCallSummaryRouter);
router.use(tokenRouter);
router.use(transcriptionRouter);
router.use(voiceRouter);

export default router;
