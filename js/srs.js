// Simplified SM-2 style spaced repetition scheduler.
// Grades: 'again' | 'hard' | 'good' | 'easy'

const SRS = {
  newCardState() {
    return {
      ease: 2.5,
      interval: 0, // days
      reps: 0,
      lapses: 0,
      dueDate: new Date().toISOString(),
    };
  },

  // Mutates card in place, returns true if the card should be requeued
  // within the current session (i.e. it was graded "again").
  grade(card, grade) {
    const now = new Date();

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

    card.interval = Math.max(1, card.interval);
    const due = new Date(now);
    due.setDate(due.getDate() + card.interval);
    card.dueDate = due.toISOString();
    return false;
  },

  isDue(card, at = new Date()) {
    return new Date(card.dueDate).getTime() <= at.getTime();
  },
};
