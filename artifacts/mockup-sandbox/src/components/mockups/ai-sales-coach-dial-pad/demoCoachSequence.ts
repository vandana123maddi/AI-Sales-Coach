import { DEMO_COACH_STAGES } from "./salesCoachSession";

export type DemoCoachStatus = "idle" | "running" | "completed" | "cancelled";
export type DemoCoachPhase = "transcript" | "coaching" | "summary" | null;

export type DemoCoachStageResult = {
  stage: number;
  simulatedInput: string;
  title: string;
  summary: string;
};

export type DemoCoachSnapshot = {
  status: DemoCoachStatus;
  currentStage: number | null;
  phase: DemoCoachPhase;
  results: DemoCoachStageResult[];
};

type DemoCoachSequenceOptions = {
  isCallActive: () => boolean;
  runStage: (stageIndex: number, signal: AbortSignal) => Promise<void>;
  onUpdate: (snapshot: DemoCoachSnapshot) => void;
  transitionDelayMs?: number;
};

/**
 * A cancellable controller for the parallel real-call demo. A generation token
 * and abort signal protect every async boundary from advancing after call end.
 */
export class DemoCoachSequence {
  private status: DemoCoachStatus = "idle";
  private currentStage: number | null = null;
  private phase: DemoCoachPhase = null;
  private results: DemoCoachStageResult[] = [];
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly options: DemoCoachSequenceOptions) {}

  start() {
    this.cancelPendingWork();
    this.generation += 1;
    this.status = "running";
    this.currentStage = null;
    this.results = [];
    this.emit();
    this.startStage(0, this.generation);
  }

  cancel() {
    if (this.status !== "running") return;
    this.cancelPendingWork();
    this.generation += 1;
    this.status = "cancelled";
    this.emit();
  }

  setPhase(phase: Exclude<DemoCoachPhase, null>) {
    if (this.status !== "running" || !this.currentStage) return;
    this.phase = phase;
    this.emit();
  }

  dispose() {
    this.cancelPendingWork();
    this.generation += 1;
  }

  private startStage(stageIndex: number, generation: number) {
    if (!this.canContinue(generation)) return;
    if (stageIndex >= DEMO_COACH_STAGES.length) {
      this.status = "completed";
      this.currentStage = null;
      this.emit();
      return;
    }
    this.currentStage = stageIndex + 1;
    this.phase = "transcript";
    this.emit();
    const controller = new AbortController();
    this.controller = controller;
    void this.options.runStage(stageIndex, controller.signal)
      .then(() => {
        if (!this.canContinue(generation) || controller.signal.aborted) return;
        const stage = DEMO_COACH_STAGES[stageIndex];
        this.results = [...this.results, {
          stage: stageIndex + 1,
          simulatedInput: String(stageIndex + 1),
          title: stage.title,
          summary: "Live transcript, Sales Coach, and post-interaction summary completed.",
        }];
        this.phase = null;
        this.emit();
        this.timer = setTimeout(
          () => this.startStage(stageIndex + 1, generation),
          this.options.transitionDelayMs ?? 350,
        );
      })
      .catch((error: unknown) => {
        if (!this.canContinue(generation) || controller.signal.aborted) return;
        this.phase = null;
        this.status = "cancelled";
        this.emit();
      });
  }

  private canContinue(generation: number) {
    return this.status === "running" && this.generation === generation && this.options.isCallActive();
  }

  private cancelPendingWork() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  private emit() {
    this.options.onUpdate({ status: this.status, currentStage: this.currentStage, phase: this.phase, results: this.results });
  }
}
