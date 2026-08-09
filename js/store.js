// Persistence layer backed by localStorage.

const STORAGE_KEY = "hanzi-cards-v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const Store = {
  _cards: null,

  load() {
    if (this._cards) return this._cards;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      this._cards = JSON.parse(raw);
    } else {
      this._cards = SEED_HANZI.map(([hanzi, pinyin, definition]) => ({
        id: uid(),
        hanzi,
        pinyin,
        definition,
        ...SRS.newCardState(),
      }));
      this.save();
    }
    return this._cards;
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

  add(hanzi, pinyin, definition) {
    const card = {
      id: uid(),
      hanzi,
      pinyin,
      definition,
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
    return { card, requeue };
  },
};
