import {
  createTranscriptTurn,
  DEMO_CONVERSATION,
  type TranscriptTurn,
} from "./salesCoachSession";

/**
 * Transport-neutral transcript boundary. A future STT implementation can emit
 * interim and final turns through this same session without changing call UI.
 */
export interface TranscriptProviderSession {
  start(): void;
  stop(): void;
  subscribe(listener: (turn: TranscriptTurn) => void): () => void;
  dispose(): void;
}

export interface TranscriptProvider {
  createSession(options: { sessionId: string }): TranscriptProviderSession;
}

class DemoTranscriptSession implements TranscriptProviderSession {
  private readonly listeners = new Set<(turn: TranscriptTurn) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly sessionId: string) {}

  start() {
    this.stop();
    DEMO_CONVERSATION.forEach((scriptTurn, index) => {
      this.timers.push(
        setTimeout(() => {
          const turn = createTranscriptTurn(scriptTurn, this.sessionId, index);
          this.listeners.forEach((listener) => listener(turn));
        }, 500 + index * 2600),
      );
    });
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  subscribe(listener: (turn: TranscriptTurn) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.stop();
    this.listeners.clear();
  }
}

export const demoTranscriptProvider: TranscriptProvider = {
  createSession: ({ sessionId }) => new DemoTranscriptSession(sessionId),
};
