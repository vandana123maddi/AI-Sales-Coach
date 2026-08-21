import assert from "node:assert/strict";
import { DemoCoachSequence, type DemoCoachSnapshot } from "../../mockup-sandbox/src/components/mockups/ai-sales-coach-dial-pad/demoCoachSequence";

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const snapshots: DemoCoachSnapshot[] = [];
const stages = [deferred(), deferred(), deferred(), deferred()];
const started: number[] = [];
const sequence = new DemoCoachSequence({
  isCallActive: () => true,
  transitionDelayMs: 0,
  onUpdate: (snapshot) => snapshots.push(snapshot),
  runStage: async (index) => { started.push(index); await stages[index].promise; },
});
sequence.start();
assert.deepEqual(started, [0]);
stages[0].resolve(); await tick(); await tick();
assert.deepEqual(started, [0, 1], "interaction 2 starts only after interaction 1 resolves");
stages[1].resolve(); await tick(); await tick();
assert.deepEqual(started, [0, 1, 2]);
stages[2].resolve(); await tick(); await tick();
assert.deepEqual(started, [0, 1, 2, 3]);
stages[3].resolve(); await tick(); await tick();
assert.equal(snapshots.at(-1)?.status, "completed");
assert.equal(snapshots.at(-1)?.results.length, 4);

const afterFirst = deferred();
const afterFirstStarted: number[] = [];
const endAfterFirst = new DemoCoachSequence({
  isCallActive: () => true,
  transitionDelayMs: 25,
  onUpdate: () => undefined,
  runStage: async (index) => { afterFirstStarted.push(index); await afterFirst.promise; },
});
endAfterFirst.start();
afterFirst.resolve(); await tick();
endAfterFirst.cancel();
await new Promise((resolve) => setTimeout(resolve, 35));
assert.deepEqual(afterFirstStarted, [0], "ending after interaction 1 prevents interaction 2");

const cancelledStage = deferred();
const cancelledStarted: number[] = [];
let active = true;
const cancelled = new DemoCoachSequence({
  isCallActive: () => active,
  transitionDelayMs: 0,
  onUpdate: () => undefined,
  runStage: async (index) => { cancelledStarted.push(index); await cancelledStage.promise; },
});
cancelled.start();
assert.deepEqual(cancelledStarted, [0]);
active = false;
cancelled.cancel();
cancelledStage.resolve();
await tick(); await tick();
assert.deepEqual(cancelledStarted, [0], "hangup prevents the next interaction after delayed work resolves");

const secondStage = [deferred(), deferred()];
const secondStarted: number[] = [];
let secondActive = true;
const endDuringSecond = new DemoCoachSequence({
  isCallActive: () => secondActive,
  transitionDelayMs: 0,
  onUpdate: () => undefined,
  runStage: async (index) => { secondStarted.push(index); await secondStage[index].promise; },
});
endDuringSecond.start();
secondStage[0].resolve(); await tick(); await tick();
assert.deepEqual(secondStarted, [0, 1]);
secondActive = false;
endDuringSecond.cancel();
secondStage[1].resolve(); await tick(); await tick();
assert.deepEqual(secondStarted, [0, 1], "ending during interaction 2 prevents interaction 3 and delayed UI progression");

console.log("PASS: Demo Coach interactions are sequential and cancellation prevents delayed progression");
