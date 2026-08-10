// Persistence layer backed by localStorage.

const STORAGE_KEY = "hanzi-cards-v1";
const HISTORY_KEY = "hanzi-history-v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function seedToCard(seed) {
  return {
    id: uid(),
    hanzi: seed.h,
    pinyin: seed.p,
    definition: seed.d,
    level: seed.lvl || "",
    sentenceZh: seed.sZh || "",
    sentencePinyin: seed.sPy || "",
    sentenceEn: seed.sEn || "",
    region: seed.region || "",
    img: seed.img || "",
    ...SRS.newCardState(),
  };
}

const Store = {
  _cards: null,
  _history: null,

  load() {
    if (this._cards) return this._cards;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      this._cards = JSON.parse(raw);
      this._mergeNewSeedWords();
    } else {
      this._cards = SEED_HANZI.map(seedToCard);
      this.save();
    }
    return this._cards;
  },

  // SEED_HANZI can grow (or get relabeled/enriched) between app versions.
  // Existing decks (already in localStorage) only get seeded once, so on
  // every load we (1) add any seed words not already present by hanzi
  // text, and (2) sync each existing card's seed-derived metadata (level,
  // example sentence, region, image) to whatever the seed currently says — e.g. a
  // card tagged the old "HSK2+" gets corrected to "HSK2", or a dish that
  // gets a region tag added later picks it up automatically. SRS state
  // (ease/interval/reps/lapses/dueDate) is never touched by this.
  _mergeNewSeedWords() {
    const seedByHanzi = new Map(SEED_HANZI.map((s) => [s.h, s]));
    const existingHanzi = new Set(this._cards.map((c) => c.hanzi));
    let changed = false;

    SEED_HANZI.forEach((seed) => {
      if (existingHanzi.has(seed.h)) return;
      this._cards.push(seedToCard(seed));
      existingHanzi.add(seed.h);
      changed = true;
    });

    this._cards.forEach((card) => {
      const seed = seedByHanzi.get(card.hanzi);
      if (!seed) return;
      if (seed.lvl && card.level !== seed.lvl) {
        card.level = seed.lvl;
        changed = true;
      }
      if ((seed.sZh || "") !== (card.sentenceZh || "")) {
        card.sentenceZh = seed.sZh || "";
        card.sentencePinyin = seed.sPy || "";
        card.sentenceEn = seed.sEn || "";
        changed = true;
      }
      if ((seed.region || "") !== (card.region || "")) {
        card.region = seed.region || "";
        changed = true;
      }
      if ((seed.img || "") !== (card.img || "")) {
        card.img = seed.img || "";
        changed = true;
      }
    });

    if (changed) this.save();
  },

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._cards));
  },

  all() {
    return this.load();
  },

  dueCards(at = new Date()) {
    return this.load().filter((c) => SRS.isDue(c, at));
  },

  levels() {
    const set = new Set(this.load().map((c) => c.level).filter(Boolean));
    return [...set].sort();
  },

  // Like levels(), but appends "Untagged" if any card has no level set —
  // used by the review category filter so every card is reachable.
  categories() {
    const levels = this.levels();
    const hasUntagged = this.load().some((c) => !c.level);
    return hasUntagged ? [...levels, "Untagged"] : levels;
  },

  add(hanzi, pinyin, definition, level = "") {
    const card = {
      id: uid(),
      hanzi,
      pinyin,
      definition,
      level,
      ...SRS.newCardState(),
    };
    this.load().push(card);
    this.save();
    return card;
  },

  update(id, fields) {
    const card = this.load().find((c) => c.id === id);
    if (!card) return null;
    Object.assign(card, fields);
    this.save();
    return card;
  },

  remove(id) {
    this._cards = this.load().filter((c) => c.id !== id);
    this.save();
  },

  grade(id, grade) {
    const card = this.load().find((c) => c.id === id);
    if (!card) return null;
    const requeue = SRS.grade(card, grade);
    this.save();
    this.logHistory(grade);
    return { card, requeue };
  },

  // Bulk import. Entries carrying a matching `id` (e.g. from a JSON backup)
  // update the existing card in place; everything else is added as a new
  // card with fresh SRS state.
  importCards(entries) {
    const all = this.load();
    let added = 0;
    let updated = 0;

    entries.forEach((e) => {
      if (!e || !e.hanzi || !e.pinyin || !e.definition) return;
      const existing = e.id ? all.find((c) => c.id === e.id) : null;
      if (existing) {
        Object.assign(existing, {
          hanzi: e.hanzi,
          pinyin: e.pinyin,
          definition: e.definition,
          level: e.level || existing.level || "",
          sentenceZh: e.sentenceZh || existing.sentenceZh || "",
          sentencePinyin: e.sentencePinyin || existing.sentencePinyin || "",
          sentenceEn: e.sentenceEn || existing.sentenceEn || "",
          ease: e.ease ?? existing.ease,
          interval: e.interval ?? existing.interval,
          reps: e.reps ?? existing.reps,
          lapses: e.lapses ?? existing.lapses,
          dueDate: e.dueDate || existing.dueDate,
        });
        updated++;
      } else {
        all.push({
          id: uid(),
          hanzi: e.hanzi,
          pinyin: e.pinyin,
          definition: e.definition,
          level: e.level || "",
          sentenceZh: e.sentenceZh || "",
          sentencePinyin: e.sentencePinyin || "",
          sentenceEn: e.sentenceEn || "",
          ease: e.ease ?? 2.5,
          interval: e.interval ?? 0,
          reps: e.reps ?? 0,
          lapses: e.lapses ?? 0,
          dueDate: e.dueDate || new Date().toISOString(),
        });
        added++;
      }
    });

    this.save();
    return { added, updated };
  },

  // ---- Review history (for stats) ----

  loadHistory() {
    if (this._history) return this._history;
    const raw = localStorage.getItem(HISTORY_KEY);
    this._history = raw ? JSON.parse(raw) : [];
    return this._history;
  },

  saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(this._history));
  },

  history() {
    return this.loadHistory();
  },

  logHistory(grade) {
    const now = new Date();
    this.loadHistory().push({ date: now.toISOString().slice(0, 10), grade });
    this.saveHistory();
  },

  // Undoes the most recent logHistory() call. Safe to call only right
  // after a grade() whose toast-undo is still active.
  popHistory() {
    this.loadHistory().pop();
    this.saveHistory();
  },
};
