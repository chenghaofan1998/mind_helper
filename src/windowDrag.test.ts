import assert from "node:assert/strict";
import test from "node:test";
import { ManualWindowDrag, shouldBeginWindowDrag, windowPositionFromDrag } from "./windowDrag.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Collects the tick callbacks a running gesture registered so a test can drive them by hand. */
function tickerHarness() {
  const callbacks: Array<() => void> = [];
  let stops = 0;
  const ticker = (onTick: () => void) => {
    callbacks.push(onTick);
    return () => { stops++; callbacks.splice(callbacks.indexOf(onTick), 1); };
  };
  return {
    ticker,
    get stops() { return stops; },
    get active() { return callbacks.length; },
    async pump() { for (const callback of [...callbacks]) callback(); await tick(); },
  };
}

test("only a primary-button gesture on non-interactive header chrome starts window drag", () => {
  assert.equal(shouldBeginWindowDrag(0, true, false), true);
  assert.equal(shouldBeginWindowDrag(0, true, true), false);
  assert.equal(shouldBeginWindowDrag(0, false, false), false);
  assert.equal(shouldBeginWindowDrag(2, true, false), false);
});

test("the window follows the cursor using the same native coordinate space", () => {
  assert.deepEqual(
    windowPositionFromDrag({ x: 120, y: 80 }, { x: 300, y: 200 }, { x: 347, y: 176 }),
    { x: 167, y: 56 },
  );
});

test("a gesture follows the native cursor without any pointer or DPI input", async () => {
  const harness = tickerHarness();
  const moves: Array<[number, number]> = [];
  let mouse = { x: 500, y: 400 };
  const drag = new ManualWindowDrag(
    async () => ({ x: 100, y: 200 }),
    async () => mouse,
    async (x, y) => { moves.push([x, y]); },
    (error) => assert.fail(String(error)),
    harness.ticker,
  );

  await drag.start();
  assert.equal(drag.dragging, true);
  assert.equal(harness.active, 1);
  await harness.pump();
  assert.deepEqual(moves, [[100, 200]]);

  mouse = { x: 520, y: 370 };
  await harness.pump();
  assert.deepEqual(moves, [[100, 200], [120, 170]]);

  drag.end();
  assert.equal(drag.dragging, false);
  assert.equal(harness.stops, 1);
  mouse = { x: 900, y: 900 };
  await harness.pump();
  assert.equal(moves.length, 2);
});

test("a second start during an active gesture is ignored", async () => {
  const harness = tickerHarness();
  let windowReads = 0;
  const drag = new ManualWindowDrag(
    async () => { windowReads++; return { x: 10, y: 10 }; },
    async () => ({ x: 10, y: 10 }),
    async () => { /* moved */ },
    (error) => assert.fail(String(error)),
    harness.ticker,
  );

  await drag.start();
  await drag.start();
  assert.equal(windowReads, 1);
  assert.equal(harness.active, 1);
  drag.end();
});

test("ending before the native positions resolve prevents a late move", async () => {
  const harness = tickerHarness();
  let resolveWindow!: (position: { x: number; y: number }) => void;
  const windowPosition = new Promise<{ x: number; y: number }>((resolve) => { resolveWindow = resolve; });
  const moves: Array<[number, number]> = [];
  const drag = new ManualWindowDrag(
    () => windowPosition,
    async () => ({ x: 0, y: 0 }),
    async (x, y) => { moves.push([x, y]); },
    (error) => assert.fail(String(error)),
    harness.ticker,
  );

  const starting = drag.start();
  drag.end();
  resolveWindow({ x: 40, y: 50 });
  await starting;
  await harness.pump();
  assert.deepEqual(moves, []);
  assert.equal(harness.active, 0);
});

test("a failed cursor read during a drag reports once and ends the gesture", async () => {
  const harness = tickerHarness();
  const errors: unknown[] = [];
  let reads = 0;
  const drag = new ManualWindowDrag(
    async () => ({ x: 1, y: 2 }),
    async () => {
      reads++;
      if (reads > 1) throw new Error("injected cursor failure");
      return { x: 5, y: 5 };
    },
    async () => { assert.fail("a failed cursor read must not move the window"); },
    (error) => errors.push(error),
    harness.ticker,
  );

  await drag.start();
  assert.equal(drag.dragging, true);
  await harness.pump();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /injected cursor failure/);
  assert.equal(drag.dragging, false);
  assert.equal(harness.stops, 1);
});

test("a failed start position read reports and never starts the drag ticker", async () => {
  const harness = tickerHarness();
  const errors: unknown[] = [];
  const drag = new ManualWindowDrag(
    async () => { throw new Error("injected position failure"); },
    async () => ({ x: 5, y: 5 }),
    async () => { assert.fail("a failed start read must not move the window"); },
    (error) => errors.push(error),
    harness.ticker,
  );

  await drag.start();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /injected position failure/);
  assert.equal(drag.dragging, false);
  assert.equal(harness.active, 0);
  assert.equal(harness.stops, 0);
});

test("a failed native move reports once instead of silently freezing the window", async () => {
  const harness = tickerHarness();
  const errors: unknown[] = [];
  const drag = new ManualWindowDrag(
    async () => ({ x: 0, y: 0 }),
    async () => ({ x: 5, y: 5 }),
    async () => { throw new Error("injected move failure"); },
    (error) => errors.push(error),
    harness.ticker,
  );

  await drag.start();
  await harness.pump();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /injected move failure/);
  assert.equal(drag.dragging, false);
});

test("a stationary cursor does not repeat native moves while the ticker keeps running", async () => {
  const harness = tickerHarness();
  let moveCalls = 0;
  const drag = new ManualWindowDrag(
    async () => ({ x: 10, y: 20 }),
    async () => ({ x: 55, y: 66 }),
    async () => { moveCalls++; },
    (error) => assert.fail(String(error)),
    harness.ticker,
  );

  await drag.start();
  for (let attempt = 0; attempt < 4; attempt++) await harness.pump();
  assert.equal(moveCalls, 1);
  drag.end();
});

test("a fast cursor cannot queue native moves faster than they complete", async () => {
  const harness = tickerHarness();
  let releaseMove!: () => void;
  const gate = new Promise<void>((resolve) => { releaseMove = resolve; });
  let moveCalls = 0;
  const drag = new ManualWindowDrag(
    async () => ({ x: 0, y: 0 }),
    async () => ({ x: 25, y: 25 }),
    async () => { moveCalls++; await gate; },
    (error) => assert.fail(String(error)),
    harness.ticker,
  );

  await drag.start();
  for (let attempt = 0; attempt < 5; attempt++) await harness.pump();
  assert.equal(moveCalls, 1);
  releaseMove();
  await tick();
  drag.end();
});
