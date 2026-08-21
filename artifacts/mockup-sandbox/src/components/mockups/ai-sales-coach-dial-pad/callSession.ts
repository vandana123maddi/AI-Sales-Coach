import {
  type CallState,
  DEMO_CONVERSATION,
  type TranscriptTurn,
} from "./salesCoachSession";
import {
  demoTranscriptProvider,
  type TranscriptProvider,
  type TranscriptProviderSession,
} from "./transcriptProvider";

export type CallTransportKind = "demo";

export type CallSessionEvent =
  | { type: "state"; state: CallState }
  | { type: "transcript"; turn: TranscriptTurn }
  | { type: "error"; message: string };

export type CallSessionListener = (event: CallSessionEvent) => void;

export type CreateCallSessionOptions = {
  prospectPhoneNumber?: string;
};

export interface CallSession {
  readonly id: string;
  readonly transport: CallTransportKind;
  start(): Promise<void>;
  end(): void;
  subscribe(listener: CallSessionListener): () => void;
  dispose(): void;
}

export interface CallTransport {
  readonly kind: CallTransportKind;
  readonly isAvailable: boolean;
  createSession(options: CreateCallSessionOptions): CallSession;
}

class DemoCallSession implements CallSession {
  readonly id = createSessionId("demo");
  readonly transport = "demo" as const;
  private readonly listeners = new Set<CallSessionListener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private state: CallState = "Ready";
  private readonly transcriptSession: TranscriptProviderSession;

  constructor(transcriptProvider: TranscriptProvider = demoTranscriptProvider) {
    this.transcriptSession = transcriptProvider.createSession({ sessionId: this.id });
    this.transcriptSession.subscribe((turn) => {
      if (this.state === "Live") {
        this.emit({ type: "transcript", turn });
      }
    });
  }

  async start() {
    if (this.state === "Live") {
      return;
    }

    this.clearTimers();
    this.state = "Live";
    this.emit({ type: "state", state: this.state });

    this.transcriptSession.start();

    this.timers.push(
      setTimeout(() => this.end(), 900 + DEMO_CONVERSATION.length * 2600),
    );
  }

  end() {
    if (this.state !== "Live") {
      return;
    }

    this.clearTimers();
    this.transcriptSession.stop();
    this.state = "Ended";
    this.emit({ type: "state", state: this.state });
  }

  subscribe(listener: CallSessionListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.clearTimers();
    this.transcriptSession.dispose();
    this.listeners.clear();
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private emit(event: CallSessionEvent) {
    this.listeners.forEach((listener) => listener(event));
  }
}

export const demoCallTransport: CallTransport = {
  kind: "demo",
  isAvailable: true,
  createSession: () => new DemoCallSession(),
};

export function createDefaultCallSession(options: CreateCallSessionOptions) {
  return demoCallTransport.createSession(options);
}

function createSessionId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${randomId}`;
}
