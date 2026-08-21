import { Delete, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Device, type Call } from "@twilio/voice-sdk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CallState,
  createDemoCoachStageTurns,
  createSalesCoachContext,
  type CoachingResponse,
  type PostCallSummaryResponse,
  type TranscriptTurn,
} from "./salesCoachSession";
import {
  DemoCoachSequence,
  type DemoCoachSnapshot,
} from "./demoCoachSequence";

type DialPadKeyProps = {
  value: string;
  label?: string;
  onClick: (value: string) => void;
};

type RealCall = {
  callSid: string;
  status: string | null;
  sessionId: string;
  kind: "real";
  mode: "transcription" | "keypad";
};

function DialPadKey({ value, label, onClick }: DialPadKeyProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-16 flex-col gap-0 rounded-2xl border-pink-100 bg-white text-2xl font-semibold shadow-sm hover:bg-pink-50"
      onClick={() => onClick(value)}
      aria-label={`Add ${value}`}
    >
      <span>{value}</span>
      {label ? (
        <span className="text-[0.6rem] font-medium tracking-[0.2em] text-muted-foreground">
          {label}
        </span>
      ) : null}
    </Button>
  );
}

export function AISalesCoachDialPad() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [status, setStatus] = useState<CallState>("Ready");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [realCall, setRealCall] = useState<RealCall | null>(null);
  const [isStartingRealCall, setIsStartingRealCall] = useState(false);
  const [coaching, setCoaching] = useState<CoachingResponse>({
    status: "empty",
    coaching: null,
  });
  const [postCallSummary, setPostCallSummary] = useState<PostCallSummaryResponse>({
    status: "empty",
    summary: null,
  });
  const [demoCoach, setDemoCoach] = useState<DemoCoachSnapshot>({
    status: "idle",
    currentStage: null,
    phase: null,
    results: [],
  });
  const realDeviceRef = useRef<Device | null>(null);
  const realConnectionRef = useRef<Call | null>(null);
  const realEventsRef = useRef<EventSource | null>(null);
  const demoCoachRef = useRef<DemoCoachSequence | null>(null);
  const activeRealSessionRef = useRef<string | null>(null);
  const demoPipelineSessionRef = useRef<string | null>(null);
  const hasLiveCall = status === "Live";

  useEffect(
    () => () => {
      realEventsRef.current?.close();
      realConnectionRef.current?.disconnect();
      realDeviceRef.current?.destroy();
      demoCoachRef.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    if (demoPipelineSessionRef.current === sessionId) return;
    if (!sessionId || !transcript.length) {
      setCoaching({ status: "empty", coaching: null });
      return;
    }

    const controller = new AbortController();
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
    const context = createSalesCoachContext(sessionId, transcript, phoneNumber);

    async function requestCoaching() {
      try {
        const response = await fetch(`${apiBaseUrl}/coach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(context),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load coaching");
        setCoaching((await response.json()) as CoachingResponse);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCoaching({
          status: "unavailable",
          coaching: null,
          message: "Sales Coach is temporarily unavailable. Please try again shortly.",
        });
      }
    }

    void requestCoaching();
    return () => controller.abort();
  }, [phoneNumber, sessionId, transcript]);

  useEffect(() => {
    // Demo Coach already creates one summary per interaction. Do not append a
    // separate whole-call summary after it completes or is cancelled.
    if (demoPipelineSessionRef.current === sessionId || status !== "Ended" || !sessionId || !transcript.length) {
      return;
    }

    const controller = new AbortController();
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
    const context = createSalesCoachContext(sessionId, transcript, phoneNumber);

    async function requestSummary() {
      setPostCallSummary({ status: "loading", summary: null });
      try {
        const response = await fetch(`${apiBaseUrl}/post-call-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(context),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load post-call summary");
        setPostCallSummary((await response.json()) as PostCallSummaryResponse);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPostCallSummary({
          status: "unavailable",
          summary: null,
          message: "Post-call summary is temporarily unavailable. Please try again shortly.",
        });
      }
    }

    void requestSummary();
    return () => controller.abort();
  }, [phoneNumber, sessionId, status, transcript]);

  function appendTranscriptTurn(turn: TranscriptTurn) {
    setTranscript((current) => {
      const existingIndex = current.findIndex((entry) => entry.id === turn.id);
      if (existingIndex === -1) return [...current, turn];
      const next = [...current];
      next[existingIndex] = turn;
      return next;
    });
  }

  function startDemoCall() {
    if (hasLiveCall) return;
    const demoSessionId = `demo-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    setTranscript([]);
    setCoaching({ status: "empty", coaching: null });
    setPostCallSummary({ status: "empty", summary: null });
    setDemoCoach({ status: "idle", currentStage: null, phase: null, results: [] });
    setSessionId(demoSessionId);
    setStatus("Live");
    setErrorMessage(null);
    startDemoCoach(demoSessionId);
  }

  async function startRealCall(mode: RealCall["mode"]) {
    if (hasLiveCall || isStartingRealCall) return;
    if (!/^\+[1-9]\d{1,14}$/.test(phoneNumber)) {
      setErrorMessage("Enter a valid E.164 number, such as +14155550123.");
      return;
    }

    setIsStartingRealCall(true);
    setErrorMessage(null);
    setRealCall(null);
    try {
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
      const response = await fetch(`${apiBaseUrl}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phoneNumber, mode }),
      });
      const payload = (await response.json()) as { callSid?: string; status?: string; sessionId?: string; kind?: RealCall["kind"]; mode?: RealCall["mode"]; error?: string; twilioCode?: number };
      if (!response.ok || !payload.callSid || !payload.sessionId || payload.kind !== "real") {
        const suffix = payload.twilioCode ? ` (Twilio error ${payload.twilioCode})` : "";
        throw new Error(`${payload.error || "Twilio could not start the call"}${suffix}`);
      }
      setTranscript([]);
      setCoaching({ status: "empty", coaching: null });
      setPostCallSummary({ status: "empty", summary: null });
      setSessionId(payload.sessionId);
      setStatus("Live");
      const call = { callSid: payload.callSid, status: payload.status ?? null, sessionId: payload.sessionId, kind: payload.kind, mode: payload.mode ?? mode };
      setRealCall(call);
      subscribeToRealCall(call);
      if (mode === "transcription") await joinBrowserConference(call.sessionId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Twilio could not start the call");
    } finally {
      setIsStartingRealCall(false);
    }
  }

  async function endRealCall() {
    if (!realCall) return;
    try {
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
      const response = await fetch(`${apiBaseUrl}/call/${realCall.callSid}/hangup`, {
        method: "POST",
      });
      const payload = (await response.json()) as { status?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Twilio could not end the call");
      setRealCall((current) => current ? { ...current, status: payload.status ?? "completed" } : null);
      setStatus("Ended");
      realConnectionRef.current?.disconnect();
      realDeviceRef.current?.destroy();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Twilio could not end the call");
    }
  }

  function subscribeToRealCall(call: RealCall) {
    realEventsRef.current?.close();
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
    const events = new EventSource(`${apiBaseUrl}/call-sessions/${encodeURIComponent(call.sessionId)}/events`);
    realEventsRef.current = events;
    events.addEventListener("state", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { state: string };
      setRealCall((current) => current ? { ...current, status: payload.state } : current);
      if (payload.state === "ended" || payload.state === "failed") { setStatus("Ended"); events.close(); }
    });
    events.addEventListener("transcript", (event) => appendTranscriptTurn((JSON.parse((event as MessageEvent<string>).data) as { turn: TranscriptTurn }).turn));
    events.addEventListener("error", (event) => {
      const data = (event as MessageEvent<string>).data;
      if (!data) return;
      try { setErrorMessage((JSON.parse(data) as { message: string }).message); } catch { /* EventSource reconnect event. */ }
    });
  }

  async function joinBrowserConference(sessionId: string) {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
    try {
      const response = await fetch(`${apiBaseUrl}/token`, { method: "POST" });
      const payload = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error || "Browser calling is not configured");
      realDeviceRef.current?.destroy();
      const device = new Device(payload.token);
      realDeviceRef.current = device;
      device.on("error", (error) => setErrorMessage(`Browser call error: ${error.message}`));
      realConnectionRef.current = await device.connect({ params: { sessionId } });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to join the sales conference");
    }
  }

  function startDemoCoach(realSessionId: string) {
    demoCoachRef.current?.dispose();
    activeRealSessionRef.current = realSessionId;
    demoPipelineSessionRef.current = realSessionId;
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
    let sequence: DemoCoachSequence;
    sequence = new DemoCoachSequence({
      isCallActive: () => activeRealSessionRef.current === realSessionId,
      onUpdate: (snapshot) => {
        setDemoCoach(snapshot);
        if (snapshot.status === "completed") {
          activeRealSessionRef.current = null;
          setStatus("Ended");
        }
      },
      runStage: async (stageIndex, signal) => {
        const turns = createDemoCoachStageTurns(stageIndex, realSessionId);
        turns.forEach(appendTranscriptTurn);
        await waitForUiStage(signal);
        sequence.setPhase("coaching");
        const coachResponse = await fetch(`${apiBaseUrl}/coach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createSalesCoachContext(realSessionId, turns, phoneNumber)),
          signal,
        });
        if (!coachResponse.ok || signal.aborted) throw new Error("Demo Coach analysis is unavailable for this stage.");
        const result = (await coachResponse.json()) as CoachingResponse;
        if (signal.aborted) return;
        setCoaching(result);
        await waitForUiStage(signal);
        if (signal.aborted) return;
        sequence.setPhase("summary");
        setPostCallSummary({ status: "loading", summary: null });
        const summaryResponse = await fetch(`${apiBaseUrl}/post-call-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createSalesCoachContext(realSessionId, turns, phoneNumber)),
          signal,
        });
        if (!summaryResponse.ok || signal.aborted) throw new Error("Post-interaction summary is unavailable for this stage.");
        const summary = (await summaryResponse.json()) as PostCallSummaryResponse;
        if (signal.aborted) return;
        setPostCallSummary(summary);
        await waitForUiStage(signal);
      },
    });
    demoCoachRef.current = sequence;
    sequence.start();
  }

  function stopDemoCoach() {
    activeRealSessionRef.current = null;
    // Keep the session marker until Clear/new session so the regular
    // post-call effect cannot publish a late whole-call summary after hangup.
    demoCoachRef.current?.cancel();
  }

  function endCall() {
    if (status !== "Live") return;
    stopDemoCoach();
    setStatus("Ended");
  }

  function appendDigit(value: string) {
    setPhoneNumber((current) => `${current}${value}`);
  }

  function handleInputChange(value: string) {
    const normalized = value.replace(/[^\d+]/g, "");
    setPhoneNumber(
      normalized.startsWith("+")
        ? `+${normalized.slice(1).replace(/\+/g, "")}`
        : normalized.replace(/\+/g, ""),
    );
  }

  function clearSession() {
    setPhoneNumber("");
    setTranscript([]);
    setCoaching({ status: "empty", coaching: null });
    setPostCallSummary({ status: "empty", summary: null });
    setRealCall(null);
    realEventsRef.current?.close();
    realConnectionRef.current?.disconnect();
    realDeviceRef.current?.destroy();
    stopDemoCoach();
    setSessionId(null);
    setErrorMessage(null);
    setStatus("Ready");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff7fa] p-6">
      <section className="w-full max-w-sm rounded-3xl border border-pink-100 bg-card p-6 text-card-foreground shadow-xl shadow-pink-950/5">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              AI Sales Coach
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Dial a prospect
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-pink-100 bg-pink-50 px-3 py-1.5 text-xs font-medium">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "Live" ? "bg-pink-500" : "bg-pink-300"
              }`}
              aria-hidden="true"
            />
            <span>{status}</span>
          </div>
        </div>

        <label
          htmlFor="sales-coach-phone-number"
          className="mb-2 block text-sm font-medium text-muted-foreground"
        >
          Prospect number
        </label>
        <Input
          id="sales-coach-phone-number"
          type="tel"
          inputMode="tel"
          value={phoneNumber}
          onChange={(event) => handleInputChange(event.target.value)}
          placeholder="+1 555 123 4567"
          className="h-14 rounded-2xl bg-background px-4 text-center text-xl tracking-wide"
          aria-describedby="dial-pad-status"
        />
        <p id="dial-pad-status" className="mt-2 text-center text-xs text-muted-foreground">
          {errorMessage || "Demo Call is simulated and needs no Twilio credentials."}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <DialPadKey value="1" onClick={appendDigit} />
          <DialPadKey value="2" label="ABC" onClick={appendDigit} />
          <DialPadKey value="3" label="DEF" onClick={appendDigit} />
          <DialPadKey value="4" label="GHI" onClick={appendDigit} />
          <DialPadKey value="5" label="JKL" onClick={appendDigit} />
          <DialPadKey value="6" label="MNO" onClick={appendDigit} />
          <DialPadKey value="7" label="PQRS" onClick={appendDigit} />
          <DialPadKey value="8" label="TUV" onClick={appendDigit} />
          <DialPadKey value="9" label="WXYZ" onClick={appendDigit} />
          <DialPadKey value="+" onClick={appendDigit} />
          <DialPadKey value="0" onClick={appendDigit} />
          <Button
            type="button"
            variant="outline"
            className="h-16 rounded-2xl border-pink-100 bg-white text-pink-600 shadow-sm hover:bg-pink-50"
            onClick={() => setPhoneNumber((current) => current.slice(0, -1))}
            aria-label="Backspace"
          >
            <Delete className="size-5" />
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            className="h-11 rounded-xl border border-pink-100 bg-pink-50 text-pink-700 hover:bg-pink-100"
            onClick={clearSession}
          >
            <RotateCcw className="size-4" />
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl border-pink-200 text-pink-700 hover:bg-pink-50"
            disabled={!hasLiveCall && !realCall}
            onClick={() => {
              if (realCall) void endRealCall();
              else if (hasLiveCall) endCall();
            }}
            aria-label="Hang Up"
          >
            <PhoneOff className="size-4" />
            Hang Up
          </Button>
        </div>

        <Button
          type="button"
          className="mt-3 h-12 w-full rounded-xl bg-pink-600 text-white hover:bg-pink-700"
          disabled={hasLiveCall}
          onClick={startDemoCall}
          aria-label="Start Demo Coach"
        >
          <Phone className="size-4" />
          Start Demo Coach
        </Button>

        <Button
          type="button"
          variant="outline"
          className="mt-3 h-11 w-full rounded-xl border-pink-200 text-pink-700 hover:bg-pink-50"
          disabled={hasLiveCall || isStartingRealCall}
          onClick={() => void startRealCall("transcription")}
        >
          <Phone className="size-4" />
          {isStartingRealCall ? "Starting real call…" : "Place real transcription call"}
        </Button>

        <Button
          type="button"
          variant="outline"
          className="mt-3 h-11 w-full rounded-xl border-pink-200 text-pink-700 hover:bg-pink-50"
          disabled={hasLiveCall || isStartingRealCall}
          onClick={() => void startRealCall("keypad")}
        >
          <Phone className="size-4" />
          Trial Phone Mode — Keypad
        </Button>
        <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">
          Trial Phone Mode: press 1 Product, 2 Pricing, 3 Objection, or 4 Next Step on the called phone.
        </p>

        {realCall ? (
          <p className="mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
            {realCall.mode === "keypad" ? "Trial Keypad" : transcriptionProgress(realCall.status)} · {realCall.callSid}
          </p>
        ) : null}

        <section className="mt-6 rounded-2xl border border-pink-100 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Live transcript</h2>
            <span className="text-xs text-muted-foreground">
              {transcript.length} turns
            </span>
          </div>
          <div
            className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1"
            aria-live="polite"
          >
            {transcript.length ? (
              transcript.map((turn) => (
                <article key={turn.id} className="rounded-xl bg-pink-50/60 px-3 py-2 text-sm">
                  <p className="flex items-center justify-between gap-3 font-medium capitalize text-pink-700">
                    <span>{turn.speaker === "salesperson" ? "Agent" : turn.source === "dtmf" ? "Customer — Keypad" : "Customer"}</span>
                    <span className="text-[0.65rem] font-medium uppercase tracking-wide text-pink-400">
                      {turn.state}
                    </span>
                  </p>
                  <p className="mt-0.5 leading-6">{turn.text}</p>
                </article>
              ))
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                {realCall
                  ? realCall.mode === "keypad"
                    ? "Waiting for keypad selections from the active trial call…"
                    : transcriptionWaitingMessage(realCall.status)
                  : "Start a demo call to stream a realistic sales conversation here."}
              </p>
            )}
          </div>
          {sessionId ? (
            <p className="mt-3 truncate text-[0.65rem] text-muted-foreground">
              Session {sessionId} · transcript retained for coaching
            </p>
          ) : null}
        </section>

        <section className="mt-4 rounded-2xl border border-pink-100 bg-white p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Sales Coach</h2>
            {coaching.status === "ready" ? (
              <span className="rounded-full bg-pink-50 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-pink-600">
                {coaching.coaching.currentConversationStage.replace(/_/g, " ")} · {coaching.coaching.buyerSentiment}
              </span>
            ) : null}
          </div>
          {coaching.status === "ready" ? (
            <div className="mt-3 space-y-3 text-sm">
              <p className="leading-6">{coaching.coaching.observation}</p>
              <div className="rounded-xl bg-pink-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-pink-600">
                  Ask next
                </p>
                <p className="mt-1 leading-6">{coaching.coaching.recommendedNextQuestion}</p>
              </div>
              <div className="rounded-xl bg-pink-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-pink-600">
                  Next best move
                </p>
                <p className="mt-1 leading-6">{coaching.coaching.nextBestMove}</p>
              </div>
              {coaching.coaching.objectionDetected ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Objection: {coaching.coaching.objectionDetected}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {coaching.status === "empty"
                ? "Coaching will appear as transcript turns arrive."
                : coaching.message}
            </p>
          )}
        </section>

        {demoCoach.status !== "idle" ? (
          <section className="mt-4 rounded-2xl border border-pink-100 bg-white p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Demo Coach</h2>
              <span className="text-xs font-medium text-pink-600">
                {demoCoach.status === "completed"
                  ? "Complete"
                  : demoCoach.status === "cancelled"
                    ? "Cancelled"
                    : demoCoach.currentStage
                      ? `Stage ${demoCoach.currentStage} of 4`
                      : "Starting"}
              </span>
            </div>
            {demoCoach.results.map((result) => (
              <article key={result.stage} className="mt-3 rounded-xl bg-pink-50 px-3 py-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-pink-600">
                  Input {result.simulatedInput} · Interaction {result.stage} of 4 · {result.title} · Completed
                </p>
                <p className="mt-1 leading-6">{result.summary}</p>
              </article>
            ))}
            {demoCoach.status === "running" && demoCoach.currentStage ? (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Simulated input {demoCoach.currentStage} · Interaction {demoCoach.currentStage} of 4 is running…
              </p>
            ) : null}
            {demoCoach.status === "cancelled" ? (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Call ended — Demo Coach stopped.
              </p>
            ) : null}
            {demoCoach.status === "completed" ? (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                All four Demo Coach stages are complete.
              </p>
            ) : null}
          </section>
        ) : null}

        {status === "Ended" || demoCoach.results.length || demoCoach.phase === "summary" ? (
          <section className="mt-4 rounded-2xl border border-pink-100 bg-white p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">
                {demoCoach.status !== "idle" ? "Post-interaction summary" : "Post-call summary"}
              </h2>
            </div>
            {postCallSummary.status === "ready" ? (
              <div className="mt-3 space-y-3 text-sm">
                <SummaryText title="Conversation summary" text={postCallSummary.summary.conversationSummary} />
                <SummaryList title="Customer pain points" items={postCallSummary.summary.customerPainPoints} />
                <SummaryList title="Customer objections" items={postCallSummary.summary.customerObjections} />
                <SummaryList title="Customer needs" items={postCallSummary.summary.customerNeeds} />
                <SummaryList title="Key commitments" items={postCallSummary.summary.keyCommitments} />
                <SummaryText title="Recommended next step" text={postCallSummary.summary.recommendedNextStep} highlighted />
                <SummaryText title="Follow-up message" text={postCallSummary.summary.followUpMessage} highlighted />
                <SummaryText title="Overall sales assessment" text={postCallSummary.summary.overallSalesAssessment} />
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {postCallSummary.status === "loading"
                  ? "Preparing your post-call summary from the final transcript…"
                  : postCallSummary.status === "empty"
                  ? "A summary will be prepared when this call has transcript turns."
                  : postCallSummary.message}
              </p>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}

function SummaryText({
  title,
  text,
  highlighted = false,
}: {
  title: string;
  text: string;
  highlighted?: boolean;
}) {
  return (
    <div className={highlighted ? "rounded-xl bg-pink-50 px-3 py-2" : undefined}>
      <p className="text-xs font-semibold uppercase tracking-wide text-pink-600">{title}</p>
      <p className="mt-1 leading-6">{text}</p>
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-pink-600">{title}</p>
      {items.length ? (
        <ul className="mt-1 list-disc space-y-1 pl-4 leading-6">
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 leading-6 text-muted-foreground">Not established in this call.</p>
      )}
    </div>
  );
}

/** Waits for React to commit a demo stage while remaining cancellable on hangup. */
function waitForUiStage(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Demo Coach was cancelled", "AbortError"));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    const abort = () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame);
      if (timer !== undefined) clearTimeout(timer);
      reject(new DOMException("Demo Coach was cancelled", "AbortError"));
    };
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    if (globalThis.requestAnimationFrame) frame = globalThis.requestAnimationFrame(done);
    else timer = setTimeout(done, 0);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function transcriptionProgress(status: string | null) {
  if (status === "connected") return "Connected";
  if (status === "transcript-active") return "Listening…";
  if (status === "failed") return "Transcription setup failed";
  if (status === "ended") return "Call ended";
  return "Connecting…";
}

function transcriptionWaitingMessage(status: string | null) {
  if (status === "connected") return "Connected — starting the Twilio Media Stream…";
  if (status === "transcript-active") return "Listening for final transcription utterances…";
  if (status === "failed") return "Transcription setup failed. See the error above for the failing stage.";
  return "Connecting to Twilio and waiting for the Media Stream…";
}
