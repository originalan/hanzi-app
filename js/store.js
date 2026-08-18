// Persistence layer backed by localStorage.

const STORAGE_KEY = "hanzi-cards-v1";
const HISTORY_KEY = "hanzi-history-v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Wraps localStorage.setItem so a full/disabled store (quota exceeded,
// private-browsing restrictions) can't throw out of a click handler and
// silently drop the write. Failures are broadcast so the UI can tell the
// user, instead of pretending the save succeeded.
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("hanzi-storage-error", { detail: { key, err } }));
    }
    return false;
  }
}

// Best-effort JSON.parse for data coming out of localStorage: returns
// fallback instead of throwing on corrupted/interrupted-write data.
function safeParseArray(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

// Keeps a numeric SRS field within sanity bounds; anything that isn't a
// finite number (or falls below min) falls back rather than propagating
// NaN into scheduling math.
function sanitizeNumber(value, fallback, { min } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (typeof min === "number" && value < min) return fallback;
  return value;
}

function sanitizeDueDate(value, fallback) {
  if (typeof value !== "string") return fallback;
  return Number.isFinite(new Date(value).getTime()) ? value : fallback;
}

// A sentinel meaning "introduced before we started tracking this" —
// used so backfilled/imported cards with real review history don't get
// mistaken for brand-new cards and count against the daily new-card cap.
const EPOCH = "1970-01-01T00:00:00.000Z";

// Derives introducedAt for an imported card: trust an explicit valid
// value, otherwise infer from whether it already has review history
// (reps/lapses > 0 implies it was introduced at some point in the past),
// otherwise treat it as genuinely new.
function sanitizeIntroducedAt(value, { reps, lapses }) {
  if (typeof value === "string" && Number.isFinite(new Date(value).getTime())) return value;
  return reps > 0 || lapses > 0 ? EPOCH : null;
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
    const parsed = safeParseArray(raw, null);
    if (parsed) {
      this._cards = parsed;
      this._mergeNewSeedWords();
    } else {
      this._cards = SEED_HANZI.map(seedToCard);
      this.save();
    }
    return this._cards;
  },

  // SEED_HANZI can grow (or get relabeled/enriched) between app versions.
  // Existing decks (already in localStorage) only get seeded once, so on
  // every load we (1) add any seed words not already present by
  // hanzi+pinyin, and (2) sync each existing card's seed-derived metadata (level,
  // example sentence, region, image) to whatever the seed currently says — e.g. a
  // card tagged the old "HSK2+" gets corrected to "HSK2", or a dish that
  // gets a region tag added later picks it up automatically. SRS state
  // (ease/interval/reps/lapses/dueDate) is never touched by this.
  _mergeNewSeedWords() {
    // Keyed by hanzi+pinyin (not hanzi alone) so two seed entries that
    // share a character but differ in reading — polyphonic words like
    // 还/长/行/重/差 — are treated as distinct cards instead of the second
    // one being silently dropped as "already present".
    const cardKey = (h, p) => `${h} ${p}`;
    const seedByKey = new Map(SEED_HANZI.map((s) => [cardKey(s.h, s.p), s]));
    const existingKeys = new Set(this._cards.map((c) => cardKey(c.hanzi, c.pinyin)));
    let changed = false;

    SEED_HANZI.forEach((seed) => {
      const key = cardKey(seed.h, seed.p);
      if (existingKeys.has(key)) return;
      this._cards.push(seedToCard(seed));
      existingKeys.add(key);
      changed = true;
    });

    this._cards.forEach((card) => {
      // Backfill for decks saved before introducedAt existed: a card
      // that already has reps/lapses was clearly reviewed before, so
      // mark it as introduced in the past rather than "new" — otherwise
      // it'd wrongly compete with actually-new cards for today's cap.
      if (card.introducedAt === undefined) {
        card.introducedAt = card.reps > 0 || card.lapses > 0 ? EPOCH : null;
        changed = true;
      }
      const seed = seedByKey.get(cardKey(card.hanzi, card.pinyin));
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
    return persist(STORAGE_KEY, this._cards);
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

  // Returns { card, duplicate }. If a card with the same hanzi+pinyin
  // already exists, no new card is created — the existing one is
  // returned with duplicate: true so the UI can tell the user instead
  // of silently creating a second copy of the same word.
  add(hanzi, pinyin, definition, level = "") {
    const existing = this.load().find((c) => c.hanzi === hanzi && c.pinyin === pinyin);
    if (existing) return { card: existing, duplicate: true };

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
    return { card, duplicate: false };
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
          ease: sanitizeNumber(e.ease, existing.ease, { min: 1.3 }),
          interval: sanitizeNumber(e.interval, existing.interval, { min: 0 }),
          reps: sanitizeNumber(e.reps, existing.reps, { min: 0 }),
          lapses: sanitizeNumber(e.lapses, existing.lapses, { min: 0 }),
          dueDate: sanitizeDueDate(e.dueDate, existing.dueDate),
          introducedAt: typeof e.introducedAt === "string" || e.introducedAt === null
            ? sanitizeIntroducedAt(e.introducedAt, existing)
            : existing.introducedAt,
        });
        updated++;
      } else {
        const reps = sanitizeNumber(e.reps, 0, { min: 0 });
        const lapses = sanitizeNumber(e.lapses, 0, { min: 0 });
        all.push({
          id: uid(),
          hanzi: e.hanzi,
          pinyin: e.pinyin,
          definition: e.definition,
          level: e.level || "",
          sentenceZh: e.sentenceZh || "",
          sentencePinyin: e.sentencePinyin || "",
          sentenceEn: e.sentenceEn || "",
          ease: sanitizeNumber(e.ease, 2.5, { min: 1.3 }),
          interval: sanitizeNumber(e.interval, 0, { min: 0 }),
          reps,
          lapses,
          dueDate: sanitizeDueDate(e.dueDate, new Date().toISOString()),
          introducedAt: sanitizeIntroducedAt(e.introducedAt, { reps, lapses }),
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
    this._history = safeParseArray(raw, []);
    return this._history;
  },

  saveHistory() {
    return persist(HISTORY_KEY, this._history);
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
