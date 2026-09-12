import assert from "node:assert/strict";
import test from "node:test";
import { ManualWindowDrag, shouldBeginWindowDrag, windowPositionFromDrag } from "./windowDrag.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("only a primary-button gesture on non-interactive header chrome starts window drag", () => {
  assert.equal(shouldBeginWindowDrag(0, true, false), true);
  assert.equal(shouldBeginWindowDrag(0, true, true), false);
  assert.equal(shouldBeginWindowDrag(0, false, false), false);
  assert.equal(shouldBeginWindowDrag(2, true, false), false);
});

test("manual drag applies the screen delta to the starting window position", () => {
  assert.deepEqual(
    windowPositionFromDrag({ x: 120, y: 80 }, { x: 300, y: 200 }, { x: 347, y: 176 }),
    { x: 167, y: 56 },
  );
});

// Neutralino reports physical window pixels while pointer events report logical pixels, so a
// scaled display needs the device pixel ratio applied to the pointer delta.
test("manual drag converts logical pointer deltas to physical window pixels", () => {
  assert.deepEqual(
    windowPositionFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 140, y: 60 }, 1.5),
    { x: 60, y: -60 },
  );
  assert.deepEqual(
    windowPositionFromDrag({ x: 10, y: 20 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 0),
    { x: 20, y: 30 },
  );
});

test("a gesture captures the pixel ratio once so later scale changes cannot skew an active drag", async () => {
  let scale = 2;
  const moves: Array<[number, number]> = [];
  const drag = new ManualWindowDrag(
    async () => ({ x: 0, y: 0 }),
    async (x, y) => { moves.push([x, y]); },
    (error) => assert.fail(String(error)),
    () => scale,
  );

  await drag.start(5, { x: 0, y: 0 });
  scale = 1;
  drag.update(5, { x: 10, y: 10 });
  await tick();
  assert.deepEqual(moves, [[0, 0], [20, 20]]);
});

test("manual drag keeps only the latest point while one native move is in flight", async () => {
  let releaseFirst!: () => void;
  const firstMove = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const moves: Array<[number, number]> = [];
  const drag = new ManualWindowDrag(
    async () => ({ x: 100, y: 200 }),
    async (x, y) => {
      moves.push([x, y]);
      if (moves.length === 1) await firstMove;
    },
    (error) => assert.fail(String(error)),
  );

  await drag.start(7, { x: 20, y: 30 });
  drag.update(7, { x: 21, y: 31 });
  drag.update(7, { x: 30, y: 50 });
  drag.update(7, { x: 44, y: 61 });
  assert.deepEqual(moves, [[100, 200]]);

  releaseFirst();
  await tick();
  assert.deepEqual(moves, [[100, 200], [124, 231]]);
});

test("ending a gesture discards pending coordinates and ignores later pointer updates", async () => {
  const moves: Array<[number, number]> = [];
  const drag = new ManualWindowDrag(
    async () => ({ x: 5, y: 10 }),
    async (x, y) => { moves.push([x, y]); },
    (error) => assert.fail(String(error)),
  );

  await drag.start(3, { x: 50, y: 60 });
  await tick();
  drag.end(3);
  const countAtEnd = moves.length;
  drag.update(3, { x: 500, y: 600 });
  await tick();
  assert.equal(moves.length, countAtEnd);
});

test("ending before getPosition resolves prevents a late native move", async () => {
  let resolvePosition!: (position: { x: number; y: number }) => void;
  const position = new Promise<{ x: number; y: number }>((resolve) => { resolvePosition = resolve; });
  const moves: Array<[number, number]> = [];
  const drag = new ManualWindowDrag(
    () => position,
    async (x, y) => { moves.push([x, y]); },
    (error) => assert.fail(String(error)),
  );

  const starting = drag.start(9, { x: 10, y: 20 });
  drag.end(9);
  resolvePosition({ x: 40, y: 50 });
  await starting;
  await tick();
  assert.deepEqual(moves, []);
});

test("a native move failure reports once and clears the active gesture", async () => {
  const errors: unknown[] = [];
  let moveAttempts = 0;
  const drag = new ManualWindowDrag(
    async () => ({ x: 1, y: 2 }),
    async () => { moveAttempts++; throw new Error("injected move failure"); },
    (error) => errors.push(error),
  );

  await drag.start(11, { x: 10, y: 20 });
  await tick();
  drag.update(11, { x: 30, y: 40 });
  await tick();
  assert.equal(moveAttempts, 1);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /injected move failure/);
});
