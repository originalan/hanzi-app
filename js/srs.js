// Simplified SM-2 style spaced repetition scheduler.
// Grades: 'again' | 'hard' | 'good' | 'easy'

const MAX_INTERVAL_DAYS = 1095; // ~3 years — sanity ceiling on compounding "easy" streaks
const LEECH_THRESHOLD = 8; // lapses at/above this mark a card as a "leech" worth rewriting

// Randomizes an interval by up to +/-5% so cards graded together on the
// same day don't all land on the exact same future due date forever.
// Intervals under a week (early learning-stage cards) are left exact,
// since a +/-1 day swing is proportionally huge for them and fuzzing
// would just make early scheduling feel arbitrary.
function fuzzInterval(interval) {
  if (interval < 7) return interval;
  const spread = Math.max(1, Math.round(interval * 0.05));
  const delta = Math.floor(Math.random() * (2 * spread + 1)) - spread;
  return Math.max(1, interval + delta);
}

const SRS = {
  newCardState() {
    return {
      ease: 2.5,
      interval: 0, // days
      reps: 0,
      lapses: 0,
      dueDate: new Date().toISOString(),
      introducedAt: null, // set on first grade(); null means "never reviewed"
    };
  },

  // A card that has never been graded once (as opposed to one that's been
  // reviewed before and is merely overdue again).
  isNew(card) {
    return !card.introducedAt;
  },

  isLeech(card) {
    return card.lapses >= LEECH_THRESHOLD;
  },

  // Mutates card in place, returns true if the card should be requeued
  // within the current session (i.e. it was graded "again").
  grade(card, grade) {
    const now = new Date();
    if (!card.introducedAt) card.introducedAt = now.toISOString();

    if (grade === "again") {
      card.reps = 0;
      card.lapses += 1;
      card.interval = 0;
      card.ease = Math.max(1.3, card.ease - 0.2);
      card.dueDate = now.toISOString();
      return true;
    }

    card.reps += 1;

    if (grade === "hard") {
      card.ease = Math.max(1.3, card.ease - 0.15);
      card.interval = card.interval > 0 ? Math.round(card.interval * 1.2) : 1;
    } else if (grade === "good") {
      if (card.interval <= 0) {
        card.interval = card.reps === 1 ? 1 : 3;
      } else {
        card.interval = Math.round(card.interval * card.ease);
      }
    } else if (grade === "easy") {
      card.ease += 0.15;
      card.interval = card.interval > 0 ? Math.round(card.interval * card.ease * 1.3) : 4;
    }

    card.interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, card.interval));
    card.interval = fuzzInterval(card.interval);
    const due = new Date(now);
    due.setDate(due.getDate() + card.interval);
    card.dueDate = due.toISOString();
    return false;
  },

  isDue(card, at = new Date()) {
    return new Date(card.dueDate).getTime() <= at.getTime();
  },
};
