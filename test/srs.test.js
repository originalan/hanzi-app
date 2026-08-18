"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHanziModules } = require("./helpers/load-app");

test("newCardState() starts un-introduced and immediately due", () => {
  const { SRS } = loadHanziModules();
  const card = SRS.newCardState();
  assert.equal(card.ease, 2.5);
  assert.equal(card.interval, 0);
  assert.equal(card.reps, 0);
  assert.equal(card.lapses, 0);
  assert.equal(card.introducedAt, null);
  assert.equal(SRS.isNew(card), true);
  assert.equal(SRS.isDue(card), true);
});

test("grading 'again' resets reps/interval, bumps lapses, and requeues", () => {
  const { SRS } = loadHanziModules();
  const card = SRS.newCardState();
  card.reps = 3;
  card.interval = 10;

  const requeue = SRS.grade(card, "again");

  assert.equal(requeue, true);
  assert.equal(card.reps, 0);
  assert.equal(card.interval, 0);
  assert.equal(card.lapses, 1);
  assert.equal(SRS.isDue(card), true);
});

test("ease has a floor of 1.3 even after many lapses", () => {
  const { SRS } = loadHanziModules();
  const card = SRS.newCardState();
  for (let i = 0; i < 20; i++) SRS.grade(card, "again");
  assert.ok(card.ease >= 1.3, `ease dropped below floor: ${card.ease}`);
});

test("first-ever 'good' grade schedules a 1-day interval", () => {
  const { SRS } = loadHanziModules();
  const card = SRS.newCardState();
  const requeue = SRS.grade(card, "good");
  assert.equal(requeue, false);
  assert.equal(card.reps, 1);
  assert.equal(card.interval, 1);
});

test("second consecutive 'good' grade jumps to a 3-day interval", () => {
  const { SRS } = loadHanziModules();
  const card = SRS.newCardState();
  SRS.grade(card, "good");
  SRS.grade(card, "good");
  assert.equal(card.reps, 2);
  assert.equal(card.interval, 3);
});

test("'hard' grows the interval slowly and lowers ease", () => {
  const { SRS } = loadHanziModules();
  // interval stays under the 7-day fuzz threshold so the result is exact
  const card = { ease: 2.5, interval: 5, reps: 3, lapses: 0, dueDate: new Date().toISOString(), introducedAt: new Date().toISOString() };
  SRS.grade(card, "hard");
  assert.equal(card.interval, 6); // round(5 * 1.2)
  assert.equal(card.ease, 2.35);
});

test("'easy' grows ease and jumps the interval further than 'good'", () => {
  const { SRS } = loadHanziModules();
  const goodCard = { ease: 2.5, interval: 10, reps: 3, lapses: 0, dueDate: new Date().toISOString(), introducedAt: new Date().toISOString() };
  const easyCard = { ...goodCard };
  SRS.grade(goodCard, "good");
  SRS.grade(easyCard, "easy");
  assert.ok(easyCard.interval > goodCard.interval);
  assert.ok(easyCard.ease > goodCard.ease);
});

test("introducedAt is set once on first grade and never changes after", () => {
  const { SRS } = loadHanziModules();
  const card = SRS.newCardState();
  assert.equal(SRS.isNew(card), true);

  SRS.grade(card, "good");
  const firstIntroducedAt = card.introducedAt;
  assert.equal(SRS.isNew(card), false);
  assert.ok(firstIntroducedAt);

  SRS.grade(card, "again");
  assert.equal(card.introducedAt, firstIntroducedAt);
});

test("interval is fuzzed by roughly +/-5% once it's long enough to matter", () => {
  const { SRS } = loadHanziModules();
  const card = { ease: 2.5, interval: 200, reps: 5, lapses: 0, dueDate: new Date().toISOString(), introducedAt: new Date().toISOString() };
  SRS.grade(card, "good"); // unfuzzed would be round(200 * 2.5) = 500
  assert.ok(card.interval >= 475 && card.interval <= 525, `expected ~500 +/-5%, got ${card.interval}`);
});

test("short intervals are left unfuzzed so learning steps stay exact", () => {
  const { SRS } = loadHanziModules();
  const card = SRS.newCardState();
  SRS.grade(card, "good");
  assert.equal(card.interval, 1); // would fail intermittently if 1-day intervals were fuzzed
});

test("interval never exceeds the multi-year cap even after repeated 'easy' streaks", () => {
  const { SRS } = loadHanziModules();
  const card = { ease: 2.5, interval: 900, reps: 20, lapses: 0, dueDate: new Date().toISOString(), introducedAt: new Date().toISOString() };
  for (let i = 0; i < 10; i++) SRS.grade(card, "easy");
  assert.ok(card.interval <= 1095, `interval escaped the cap: ${card.interval}`);
});

test("isLeech flags a card only once lapses reach the threshold", () => {
  const { SRS } = loadHanziModules();
  const card = SRS.newCardState();
  for (let i = 0; i < 7; i++) SRS.grade(card, "again");
  assert.equal(SRS.isLeech(card), false);
  SRS.grade(card, "again");
  assert.equal(SRS.isLeech(card), true);
});

test("isDue compares against the supplied reference time", () => {
  const { SRS } = loadHanziModules();
  const past = { dueDate: new Date(Date.now() - 1000).toISOString() };
  const future = { dueDate: new Date(Date.now() + 100000).toISOString() };
  assert.equal(SRS.isDue(past), true);
  assert.equal(SRS.isDue(future), false);
});
