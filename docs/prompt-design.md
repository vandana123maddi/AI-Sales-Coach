# Prompt design

## System prompt used by the application

`salesCoach.ts` sends a Gemini-compatible chat-completions request with a system instruction that defines a concise real-estate coach and requires JSON fields: `observation`, `recommendedNextQuestion`, `currentConversationStage`, `buyerSentiment`, `nextBestMove`, `objectionDetected`, `urgency`, and transcript `evidenceTurnIds`.

It explicitly restricts stages to discovery, qualification, objection handling, viewing, offer, valuation, instruction, closing, and follow-up. It requires a concrete action such as asking about budget/timeline/financing, addressing an expressed concern, proposing a viewing, discussing valuation/marketing/fees, or confirming follow-up.

## Why the structure matters

- **Domain knowledge:** buyer qualification and vendor valuation/instruction choices make the advice operational rather than generic.
- **Rolling transcript:** final turns, speaker, and stable turn IDs are passed for every request; IDs bind recommendations to evidence.
- **Stage and sentiment:** bounded enums make UI rendering and downstream analytics predictable.
- **Specificity:** the instruction rejects invented facts and generic advice, and asks for one grounded next move.
- **Incomplete transcript:** only final non-empty turns are analyzed. Empty input returns an `empty` result; API/timeout failures return an unavailable result rather than fabricated coaching.
- **Objections and buyer/vendor ambiguity:** the model must classify from language actually present and may leave `objectionDetected` null.
- **Summary:** the separate summary prompt requires the same evidence discipline and differentiates needs, objections, commitments, and next step.

## Context payload

The user message carries `sessionId` and up to 100 turns with `turnId`, speaker, text, and state. Keypad and demo turns retain their source in storage/UI; the LLM receives their clean transcript text and never receives secrets.
