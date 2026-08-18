"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHanziModules } = require("./helpers/load-app");

const SEED = [
  { h: "我", p: "wǒ", d: "I; me", lvl: "HSK1" },
  { h: "你", p: "nǐ", d: "you", lvl: "HSK1" },
  { h: "还", p: "hái", d: "still; also", lvl: "HSK2" },
  { h: "还", p: "huán", d: "to return (something)", lvl: "HSK3" },
];

test("load() seeds a fresh deck from SEED_HANZI, one card per entry", () => {
  const { Store } = loadHanziModules({ seedHanzi: SEED });
  assert.equal(Store.all().length, SEED.length);
});

test("seed words sharing a hanzi but differing in pinyin both get their own card", () => {
  const { Store } = loadHanziModules({ seedHanzi: SEED });
  const hai = Store.all().filter((c) => c.hanzi === "还");
  assert.equal(hai.length, 2);
  assert.deepEqual(hai.map((c) => c.pinyin).sort(), ["hái", "huán"].sort());
});

test("corrupted localStorage JSON falls back to a fresh seed instead of throwing", () => {
  const { Store, rawStore } = loadHanziModules({ seedHanzi: SEED });
  Store.load();
  rawStore["hanzi-cards-v1"] = "{not valid json";
  Store._cards = null;

  assert.doesNotThrow(() => Store.load());
  assert.equal(Store.all().length, SEED.length);
});

test("a non-array value in localStorage is treated as corrupted, not trusted", () => {
  const { Store, rawStore } = loadHanziModules({ seedHanzi: SEED });
  rawStore["hanzi-cards-v1"] = JSON.stringify({ not: "an array" });
  Store._cards = null;

  assert.doesNotThrow(() => Store.load());
  assert.equal(Store.all().length, SEED.length);
});

test("importCards sanitizes invalid ease/interval/reps/lapses/dueDate instead of propagating NaN", () => {
  const { Store } = loadHanziModules({ seedHanzi: [] });
  Store.load();

  const { added } = Store.importCards([
    { hanzi: "猫", pinyin: "māo", definition: "cat", ease: "bad", interval: -5, reps: NaN, lapses: 2, dueDate: "not-a-date" },
  ]);

  assert.equal(added, 1);
  const card = Store.all().find((c) => c.hanzi === "猫");
  assert.equal(card.ease, 2.5); // fell back, "bad" isn't a number
  assert.equal(card.interval, 0); // fell back, -5 is below the min:0 bound
  assert.equal(card.reps, 0); // fell back, NaN isn't finite
  assert.equal(card.lapses, 2); // valid, kept as-is
  assert.ok(Number.isFinite(new Date(card.dueDate).getTime()), "dueDate should fall back to something valid");
});

test("importCards preserves valid numeric fields unchanged", () => {
  const { Store } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  const dueDate = new Date().toISOString();

  Store.importCards([{ hanzi: "狗", pinyin: "gǒu", definition: "dog", ease: 2.8, interval: 14, reps: 4, lapses: 1, dueDate }]);

  const card = Store.all().find((c) => c.hanzi === "狗");
  assert.equal(card.ease, 2.8);
  assert.equal(card.interval, 14);
  assert.equal(card.reps, 4);
  assert.equal(card.lapses, 1);
  assert.equal(card.dueDate, dueDate);
});

test("importCards with a matching id updates the existing card instead of duplicating it", () => {
  const { Store } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  const original = Store.add("鱼", "yú", "fish").card;

  const { added, updated } = Store.importCards([{ id: original.id, hanzi: "鱼", pinyin: "yú", definition: "fish (updated)" }]);

  assert.equal(added, 0);
  assert.equal(updated, 1);
  assert.equal(Store.all().length, 1);
  assert.equal(Store.all()[0].definition, "fish (updated)");
});

test("pre-existing reviewed cards are backfilled as not-new; unreviewed ones stay new", () => {
  const { Store, SRS, rawStore } = loadHanziModules({ seedHanzi: [] });
  rawStore["hanzi-cards-v1"] = JSON.stringify([
    { id: "old1", hanzi: "旧", pinyin: "jiù", definition: "old, reviewed before", level: "HSK1", ease: 2.5, interval: 10, reps: 3, lapses: 1, dueDate: new Date().toISOString() },
    { id: "old2", hanzi: "闻", pinyin: "wén", definition: "old, never reviewed", level: "HSK1", ease: 2.5, interval: 0, reps: 0, lapses: 0, dueDate: new Date().toISOString() },
  ]);

  Store.load();

  const reviewed = Store.all().find((c) => c.id === "old1");
  const unreviewed = Store.all().find((c) => c.id === "old2");
  assert.equal(SRS.isNew(reviewed), false);
  assert.equal(SRS.isNew(unreviewed), true);
});

test("add() rejects an exact hanzi+pinyin duplicate but allows a different reading of the same hanzi", () => {
  const { Store } = loadHanziModules({ seedHanzi: [] });
  Store.load();

  const first = Store.add("猫", "māo", "cat");
  const dup = Store.add("猫", "māo", "cat, again");
  const diffReading = Store.add("猫", "mao1", "different reading, should be allowed");

  assert.equal(first.duplicate, false);
  assert.equal(dup.duplicate, true);
  assert.equal(dup.card.id, first.card.id, "duplicate add should hand back the existing card");
  assert.equal(diffReading.duplicate, false);
  assert.equal(Store.all().length, 2);
});

test("save() failures are caught and broadcast instead of throwing out of a click handler", () => {
  const { Store, sandbox, dispatchedEvents } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  sandbox.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };

  const ok = Store.save();

  assert.equal(ok, false);
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, "hanzi-storage-error");
});

test("dueCards() only returns cards whose dueDate has passed", () => {
  const { Store } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  const soon = Store.add("早", "zǎo", "early").card;
  const later = Store.add("晚", "wǎn", "late").card;
  Store.update(later.id, { dueDate: new Date(Date.now() + 86400000 * 30).toISOString() });

  const due = Store.dueCards().map((c) => c.id);
  assert.ok(due.includes(soon.id));
  assert.ok(!due.includes(later.id));
});

test("categories() appends Untagged only when at least one card has no level", () => {
  const { Store } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  Store.add("甲", "jiǎ", "first", "HSK1");
  assert.ok(!Store.categories().includes("Untagged"));

  Store.add("乙", "yǐ", "second"); // no level
  assert.ok(Store.categories().includes("Untagged"));
});

test("grade() logs history and popHistory() undoes exactly the last entry", () => {
  const { Store } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  const card = Store.add("忘", "wàng", "to forget").card;

  Store.grade(card.id, "good");
  assert.equal(Store.history().length, 1);

  Store.popHistory();
  assert.equal(Store.history().length, 0);
});

test("save() rotates the previous valid state into a snapshot key before overwriting", () => {
  const { Store, rawStore } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  Store.add("一", "yī", "one");
  const afterFirstAdd = rawStore["hanzi-cards-v1"];

  Store.add("二", "èr", "two");

  assert.equal(rawStore["hanzi-cards-v1-snapshot"], afterFirstAdd, "snapshot should hold the state from before the latest write");
});

test("load() recovers from the snapshot when the primary card data is corrupted, and heals it", () => {
  const { Store, SRS, rawStore, dispatchedEvents } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  const card = Store.add("三", "sān", "three").card;
  const goodSnapshot = rawStore["hanzi-cards-v1"];
  Store.add("四", "sì", "four"); // this write's snapshot is `goodSnapshot`
  rawStore["hanzi-cards-v1"] = "{not valid json, simulating an interrupted write";
  Store._cards = null;

  const cards = Store.load();

  assert.equal(cards.length, 1, "should recover the one-card state, not the two-card or empty state");
  assert.equal(cards[0].hanzi, "三");
  assert.ok(safeParseArrayIsValid(rawStore["hanzi-cards-v1"]), "primary key should be healed back to valid JSON");
  assert.ok(
    dispatchedEvents.some((e) => e.type === "hanzi-storage-recovered" && e.detail.key === "hanzi-cards-v1"),
    "should broadcast a recovery event so the UI can tell the user"
  );

  function safeParseArrayIsValid(raw) {
    try {
      return Array.isArray(JSON.parse(raw));
    } catch {
      return false;
    }
  }
});

test("history survives the same corruption-recovery path as cards", () => {
  const { Store, rawStore } = loadHanziModules({ seedHanzi: [] });
  Store.load();
  const card = Store.add("五", "wǔ", "five").card;
  Store.grade(card.id, "good"); // this write's snapshot becomes the (empty) pre-history state
  Store.grade(card.id, "good"); // this write's snapshot becomes the 1-entry state

  rawStore["hanzi-history-v1"] = "not json at all";
  Store._history = null;

  const history = Store.loadHistory();
  assert.equal(history.length, 1, "should recover the one-entry history, not lose it entirely");
  assert.equal(history[0].grade, "good");
});
