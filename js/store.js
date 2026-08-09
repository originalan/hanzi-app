// Persistence layer backed by localStorage.

const STORAGE_KEY = "hanzi-cards-v1";
const HISTORY_KEY = "hanzi-history-v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
      this._cards = SEED_HANZI.map(([hanzi, pinyin, definition, level]) => ({
        id: uid(),
        hanzi,
        pinyin,
        definition,
        level: level || "",
        ...SRS.newCardState(),
      }));
      this.save();
    }
    return this._cards;
  },

  // SEED_HANZI can grow between app versions. Existing decks (already in
  // localStorage) only get seeded once, so on every load we add any seed
  // words not already present by hanzi text — existing cards' SRS state
  // is left untouched.
  _mergeNewSeedWords() {
    const existing = new Set(this._cards.map((c) => c.hanzi));
    let added = false;
    SEED_HANZI.forEach(([hanzi, pinyin, definition, level]) => {
      if (existing.has(hanzi)) return;
      this._cards.push({
        id: uid(),
        hanzi,
        pinyin,
        definition,
        level: level || "",
        ...SRS.newCardState(),
      });
      existing.add(hanzi);
      added = true;
    });
    if (added) this.save();
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
