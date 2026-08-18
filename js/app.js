// App shell: view routing + rendering.

const appEl = document.getElementById("app");
const tabbarEl = document.getElementById("tabbar");

let state = {
  view: "home",
  session: null, // { queue: [card,...], index, revealed }
  browseFilter: "all",
  reviewLevels: null, // null = all categories; else a Set of selected categories
  reviewOrder: "shuffle", // "shuffle" | "category"
  dailyNewLimit: 20, // cap on never-graded cards introduced per day
};

// ---------- Tone-colored pinyin ----------

const TONE_MARKS = {
  ā: 1, á: 2, ǎ: 3, à: 4,
  ē: 1, é: 2, ě: 3, è: 4,
  ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4,
  ū: 1, ú: 2, ǔ: 3, ù: 4,
  ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
  ń: 2, ň: 3, ǹ: 4,
};

function syllableTone(syllable) {
  for (const ch of syllable) {
    const tone = TONE_MARKS[ch.toLowerCase()];
    if (tone) return tone;
  }
  return 5; // neutral tone
}

// Renders space-separated pinyin ("nǐ hǎo") as HTML with each syllable
// colored by its tone (1-4, or 5 for neutral). Safe against arbitrary
// input text since each syllable is escaped individually. Tokens that are
// pure punctuation (quote marks, ellipses — sentence pinyin sometimes
// tokenizes these on their own) are left uncolored rather than tinted as
// a fake "neutral tone", since they aren't a syllable at all.
function tonedPinyinHtml(pinyinStr) {
  if (!pinyinStr) return "";
  return pinyinStr
    .split(/(\s+)/)
    .map((chunk) => {
      if (/^\s+$/.test(chunk) || chunk === "") return chunk;
      if (!/[a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹ]/.test(chunk)) return escapeHtml(chunk);
      return `<span class="tone-${syllableTone(chunk)}">${escapeHtml(chunk)}</span>`;
    })
    .join("");
}

// ---------- Audio pronunciation ----------

function speakerIconSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
}

// Chromium returns [] from getVoices() until the async "voiceschanged"
// event fires, which can lose the very first speak() of a session if we
// query it cold. Cache the list once it's populated and reuse it.
let cachedVoices = [];
if ("speechSynthesis" in window) {
  const refreshVoices = () => {
    cachedVoices = window.speechSynthesis.getVoices();
  };
  refreshVoices();
  window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
}

function speak(text) {
  if (!text || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "zh-CN";
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
  const zhVoice = voices.find((v) => v.lang === "zh-CN") || voices.find((v) => v.lang && v.lang.startsWith("zh"));
  if (zhVoice) utter.voice = zhVoice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// ---------- Region map ----------
// Highlights a province on a blank map of China for cuisine cards tagged
// with a region of origin. Map source: "China blank province map.svg" by
// Newfraferz87 (Wikimedia Commons, public domain), with per-province path
// IDs like "pSC" already built in for exactly this kind of highlighting.

const REGION_NAMES = {
  BJ: "Beijing", SC: "Sichuan", GD: "Guangdong", SH: "Shanghai", HN: "Hunan",
  XJ: "Xinjiang", GS: "Gansu", TW: "Taiwan", YN: "Yunnan", SN: "Shaanxi",
  HB: "Hubei", GX: "Guangxi", HA: "Henan", FJ: "Fujian", ZJ: "Zhejiang", CQ: "Chongqing",
};

let chinaMapSvgText = "";

function loadChinaMap() {
  fetch("icons/china-map.svg")
    .then((r) => r.text())
    .then((text) => {
      chinaMapSvgText = text;
      render(); // pick up the map on whatever's currently on screen, if relevant
    })
    .catch(() => {});
}

function regionMapHtml(regionCode) {
  if (!regionCode || !chinaMapSvgText) return "";
  const idAttr = `id="p${regionCode}"`;
  if (!chinaMapSvgText.includes(idAttr)) return "";
  const highlighted = chinaMapSvgText.replace(
    idAttr,
    `${idAttr} style="fill:var(--accent);stroke:var(--accent-2);stroke-width:1.2"`
  );
  const name = REGION_NAMES[regionCode] || regionCode;
  return `
    <div class="region-map">
      <div class="region-map-svg">${highlighted}</div>
      <div class="region-map-label">${escapeHtml(name)}</div>
    </div>
  `;
}

function setView(view) {
  state.view = view;
  state.session = null;
  render();
}

tabbarEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  setView(btn.dataset.view);
});

function updateActiveTab() {
  [...tabbarEl.querySelectorAll(".tab")].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.view);
  });
}

function showToast(msg) {
  const el = document.createElement("div");
  el.className = "toast auto-fade";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

let activeUndoToast = null;

function showUndoToast(label, onUndo) {
  if (activeUndoToast) {
    clearTimeout(activeUndoToast.timer);
    activeUndoToast.el.remove();
    activeUndoToast = null;
  }

  const el = document.createElement("div");
  el.className = "toast toast-undo";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `<span></span><button class="undo-btn">Undo</button>`;
  el.querySelector("span").textContent = label;
  document.body.appendChild(el);

  const timer = setTimeout(() => {
    el.remove();
    activeUndoToast = null;
  }, 4000);

  el.querySelector(".undo-btn").addEventListener("click", () => {
    clearTimeout(timer);
    el.remove();
    activeUndoToast = null;
    onUndo();
  });

  activeUndoToast = { el, timer };
}

// ---------- Theme ----------

const THEME_KEY = "hanzi-theme";

const THEME_ICONS = {
  dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
  light:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
};

function currentTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit) return explicit;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyThemeIcon() {
  const icon = document.getElementById("theme-icon");
  if (!icon) return;
  icon.innerHTML = THEME_ICONS[currentTheme()];
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  applyThemeIcon();
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  applyThemeIcon();
}

document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

// ---------- Badge ----------

function updateBadge() {
  if (!("setAppBadge" in navigator)) return;
  const due = Store.dueCards().length;
  if (due > 0) {
    navigator.setAppBadge(due).catch(() => {});
  } else {
    navigator.clearAppBadge().catch(() => {});
  }
}

function render() {
  updateActiveTab();
  updateBadge();
  if (state.view === "home") return renderHome();
  if (state.view === "review") return renderReview();
  if (state.view === "browse") return renderBrowse();
  if (state.view === "add") return renderAdd();
  if (state.view === "stats") return renderStats();
}

// ---------- Review preferences (category filter + ordering) ----------

const REVIEW_PREFS_KEY = "hanzi-review-prefs-v1";

function cardCategory(card) {
  return card.level || "Untagged";
}

function loadReviewPrefs() {
  try {
    const raw = localStorage.getItem(REVIEW_PREFS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.reviewLevels = Array.isArray(parsed.levels) ? new Set(parsed.levels) : null;
    state.reviewOrder = parsed.order === "category" ? "category" : "shuffle";
    if (typeof parsed.dailyNewLimit === "number" && Number.isFinite(parsed.dailyNewLimit) && parsed.dailyNewLimit >= 0) {
      state.dailyNewLimit = parsed.dailyNewLimit;
    }
  } catch (e) {
    // ignore malformed prefs, keep defaults
  }
}

function saveReviewPrefs() {
  localStorage.setItem(
    REVIEW_PREFS_KEY,
    JSON.stringify({
      levels: state.reviewLevels ? [...state.reviewLevels] : null,
      order: state.reviewOrder,
      dailyNewLimit: state.dailyNewLimit,
    })
  );
}

function setDailyNewLimit(limit) {
  state.dailyNewLimit = limit;
  saveReviewPrefs();
  render();
}

function toggleReviewLevel(level) {
  if (level === "ALL") {
    state.reviewLevels = null;
  } else if (state.reviewLevels === null) {
    state.reviewLevels = new Set([level]);
  } else {
    const next = new Set(state.reviewLevels);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    state.reviewLevels = next.size === 0 ? null : next;
  }
  saveReviewPrefs();
  render();
}

function setReviewOrder(order) {
  state.reviewOrder = order;
  saveReviewPrefs();
  render();
}

function filteredDueCards() {
  const due = Store.dueCards();
  if (!state.reviewLevels) return due;
  return due.filter((c) => state.reviewLevels.has(cardCategory(c)));
}

function newCardsIntroducedToday() {
  const todayKey = new Date().toISOString().slice(0, 10);
  return Store.all().filter((c) => c.introducedAt && c.introducedAt.slice(0, 10) === todayKey).length;
}

// Splits the current due set into cards that have been reviewed before
// (always shown in full — the scheduler already decided they're due)
// and cards that have never been graded, capping the latter at
// dailyNewLimit minus whatever's already been introduced today. Without
// this, a fresh deck (or a big import) would dump its entire backlog of
// unseen cards into one overwhelming session on day one.
function sessionCards() {
  const due = filteredDueCards();
  const reviewCards = due.filter((c) => !SRS.isNew(c));
  const newCards = due.filter((c) => SRS.isNew(c));
  const remainingNewSlots = Math.max(0, state.dailyNewLimit - newCardsIntroducedToday());
  const cappedNew = newCards.slice(0, remainingNewSlots);
  return { reviewCards, newCards: cappedNew, newAvailable: newCards.length, newIncluded: cappedNew.length };
}

function buildReviewQueue() {
  const { reviewCards, newCards } = sessionCards();
  const combined = [...reviewCards, ...newCards];
  if (state.reviewOrder !== "category") return shuffle(combined);

  const groups = {};
  combined.forEach((c) => {
    const cat = cardCategory(c);
    (groups[cat] = groups[cat] || []).push(c);
  });
  const orderedCats = Store.categories().filter((cat) => groups[cat]);
  return orderedCats.flatMap((cat) => shuffle(groups[cat]));
}

// ---------- Home ----------

function renderHome() {
  const all = Store.all();
  const due = Store.dueCards();
  const categories = Store.categories();
  const { reviewCards, newCards, newAvailable, newIncluded } = sessionCards();
  const sessionSize = reviewCards.length + newCards.length;
  const cappedNewCount = newAvailable - newIncluded;

  const chips = ["ALL", ...categories]
    .map((cat) => {
      const label = cat === "ALL" ? "All" : cat;
      const active = cat === "ALL" ? state.reviewLevels === null : !!state.reviewLevels && state.reviewLevels.has(cat);
      const count = cat === "ALL" ? due.length : due.filter((c) => cardCategory(c) === cat).length;
      return `<button class="chip${active ? " active" : ""}" data-cat="${escapeHtml(cat)}">${escapeHtml(label)} (${count})</button>`;
    })
    .join("");

  appEl.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${due.length}</div><div class="label">Due now</div></div>
      <div class="stat-card"><div class="num">${all.length}</div><div class="label">Total cards</div></div>
    </div>

    <h2>Study focus</h2>
    <div class="chip-row">${chips}</div>
    <div class="order-toggle">
      <button class="seg${state.reviewOrder === "shuffle" ? " active" : ""}" data-order="shuffle">Shuffled</button>
      <button class="seg${state.reviewOrder === "category" ? " active" : ""}" data-order="category">By category</button>
    </div>

    <div class="new-limit-row">
      <label for="new-limit">New cards per day</label>
      <select id="new-limit">
        ${[10, 20, 30, 50, 9999]
          .map(
            (n) =>
              `<option value="${n}"${state.dailyNewLimit === n ? " selected" : ""}>${n === 9999 ? "No limit" : n}</option>`
          )
          .join("")}
      </select>
    </div>

    <button class="big-btn" id="start-review" ${sessionSize === 0 ? "disabled" : ""}>
      ${sessionSize === 0 ? "Nothing due in this selection" : `Review ${sessionSize} card${sessionSize === 1 ? "" : "s"}`}
    </button>
    ${cappedNewCount > 0 ? `<div class="new-limit-note">${cappedNewCount} more new card${cappedNewCount === 1 ? "" : "s"} waiting — raise today's limit above to see them sooner.</div>` : ""}
    <button class="big-btn secondary" id="go-browse">Browse all cards</button>
    <button class="big-btn secondary" id="go-add">Add a character</button>
  `;

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => toggleReviewLevel(chip.dataset.cat));
  });
  document.querySelectorAll(".order-toggle .seg").forEach((btn) => {
    btn.addEventListener("click", () => setReviewOrder(btn.dataset.order));
  });
  document.getElementById("new-limit").addEventListener("change", (e) => {
    setDailyNewLimit(Number(e.target.value));
  });

  document.getElementById("start-review").addEventListener("click", () => {
    if (sessionSize === 0) return;
    setView("review");
  });
  document.getElementById("go-browse").addEventListener("click", () => setView("browse"));
  document.getElementById("go-add").addEventListener("click", () => setView("add"));
}

// ---------- Review ----------

function renderReview() {
  if (!state.session) {
    const queue = buildReviewQueue();
    if (queue.length === 0) {
      appEl.innerHTML = `<div class="empty-state">No cards due for review.<br/>Come back later, or add more characters.</div>`;
      return;
    }
    state.session = { queue, total: queue.length, revealed: false };
  }

  const session = state.session;

  if (session.queue.length === 0) {
    appEl.innerHTML = `<div class="empty-state">Session complete.<br/>Nice work! 🎉</div>`;
    return;
  }

  const card = session.queue[0];
  const remaining = session.queue.length;

  appEl.innerHTML = `
    <div class="review-wrap">
      <div class="progress">${remaining} card${remaining === 1 ? "" : "s"} remaining</div>
      ${session.revealed ? '<div class="swipe-legend"><span>&larr; Again</span><span>Easy &uarr;</span><span>Hard &darr;</span><span>Good &rarr;</span></div>' : ""}
      <div class="card${session.revealed ? " revealed" : ""}" id="flip-card">
        <div class="hanzi">${escapeHtml(card.hanzi)}</div>
        <div class="pinyin">${session.revealed ? tonedPinyinHtml(card.pinyin) : ""}</div>
        <div class="definition">${session.revealed ? escapeHtml(card.definition) : ""}</div>
        ${session.revealed ? "" : '<div class="hint">Tap to reveal</div>'}
      </div>
      ${session.revealed ? `<button class="speak-btn" id="speak-word">${speakerIconSvg()}Listen</button>` : ""}
      ${session.revealed ? dishImageHtml(card) : ""}
      ${session.revealed ? regionMapHtml(card.region) : ""}
      ${session.revealed ? sentenceBlockHtml(card) : ""}
      ${session.revealed ? gradeRowHtml() : ""}
    </div>
  `;

  const cardEl = document.getElementById("flip-card");

  if (!session.revealed) {
    cardEl.addEventListener("click", () => {
      session.revealed = true;
      render();
    });
  } else {
    appEl.querySelectorAll(".grade-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyGrade(card, session, btn.dataset.grade));
    });
    attachSwipe(cardEl, card, session);

    document.getElementById("speak-word").addEventListener("click", () => speak(card.hanzi));
    const speakSentenceBtn = document.getElementById("speak-sentence");
    if (speakSentenceBtn) {
      speakSentenceBtn.addEventListener("click", () => speak(card.sentenceZh));
    }
  }
}

function dishImageHtml(card) {
  if (!card.img) return "";
  return `
    <div class="dish-image">
      <img src="icons/dishes/${escapeHtml(card.img)}.jpg" alt="${escapeHtml(card.hanzi)}" loading="lazy" />
      <div class="dish-image-credit">Photo: Wikimedia Commons</div>
    </div>
  `;
}

function sentenceBlockHtml(card) {
  if (!card.sentenceZh) return "";
  return `
    <div class="sentence-block">
      <div class="sentence-zh">
        <span>${escapeHtml(card.sentenceZh)}</span>
        <button class="speak-btn small" id="speak-sentence">${speakerIconSvg()}</button>
      </div>
      <div class="sentence-pinyin">${tonedPinyinHtml(card.sentencePinyin)}</div>
      <div class="sentence-en">${escapeHtml(card.sentenceEn)}</div>
    </div>
  `;
}

function gradeRowHtml() {
  return `
    <div class="grade-row">
      <button class="grade-btn again" data-grade="again">Again<small>&lt;1d</small></button>
      <button class="grade-btn hard" data-grade="hard">Hard<small>~1d</small></button>
      <button class="grade-btn good" data-grade="good">Good<small>days</small></button>
      <button class="grade-btn easy" data-grade="easy">Easy<small>longer</small></button>
    </div>
  `;
}

const GRADE_LABELS = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

function applyGrade(card, session, grade) {
  const prevState = {
    ease: card.ease,
    interval: card.interval,
    reps: card.reps,
    lapses: card.lapses,
    dueDate: card.dueDate,
    introducedAt: card.introducedAt,
  };
  const queueIdsBefore = session.queue.map((c) => c.id);

  const { requeue } = Store.grade(card.id, grade);
  session.queue.shift();
  if (requeue) session.queue.push(card);
  session.revealed = false;

  showUndoToast(`Graded ${card.hanzi} as ${GRADE_LABELS[grade]}`, () => {
    Store.update(card.id, prevState);
    Store.popHistory();
    if (state.session) {
      const all = Store.all();
      state.session.queue = queueIdsBefore.map((id) => all.find((c) => c.id === id)).filter(Boolean);
      state.session.revealed = true;
      render();
    }
  });

  render();
}

// Direction -> grade for swipe gestures: left=again, right=good, up=easy, down=hard.
function swipeGrade(dx, dy, threshold) {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (Math.max(adx, ady) < threshold) return null;
  if (adx > ady) return dx > 0 ? "good" : "again";
  return dy > 0 ? "hard" : "easy";
}

function attachSwipe(cardEl, card, session) {
  const ACTIVATE_THRESHOLD = 28;
  const RELEASE_THRESHOLD = 90;
  const FLY_DISTANCE = 500;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let dragging = false;

  function onPointerDown(e) {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    cardEl.style.transition = "none";
    cardEl.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    cardEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const grade = swipeGrade(dx, dy, ACTIVATE_THRESHOLD);
    cardEl.style.borderColor = grade ? `var(--${grade})` : "transparent";
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    cardEl.style.transition = "transform 0.2s ease, border-color 0.2s ease";

    const grade = swipeGrade(dx, dy, RELEASE_THRESHOLD);
    if (grade) {
      const flyX = grade === "again" ? -FLY_DISTANCE : grade === "good" ? FLY_DISTANCE : dx;
      const flyY = grade === "easy" ? -FLY_DISTANCE : grade === "hard" ? FLY_DISTANCE : dy;
      cardEl.style.transform = `translate(${flyX}px, ${flyY}px) rotate(${flyX / 18}deg)`;
      cardEl.style.opacity = "0";
      setTimeout(() => applyGrade(card, session, grade), 160);
    } else {
      cardEl.style.transform = "";
      cardEl.style.borderColor = "transparent";
    }
    dx = 0;
    dy = 0;
  }

  cardEl.addEventListener("pointerdown", onPointerDown);
  cardEl.addEventListener("pointermove", onPointerMove);
  cardEl.addEventListener("pointerup", onPointerUp);
  cardEl.addEventListener("pointercancel", onPointerUp);
}

// ---------- Browse ----------

function renderBrowse() {
  const all = [...Store.all()].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const levels = Store.levels();

  const leechCount = all.filter((c) => SRS.isLeech(c)).length;

  const chips = ["all", ...(leechCount > 0 ? ["leeches"] : []), ...levels]
    .map((lvl) => {
      const label = lvl === "all" ? "All" : lvl === "leeches" ? `Leeches (${leechCount})` : lvl;
      const active = state.browseFilter === lvl ? " active" : "";
      return `<button class="chip${active}" data-level="${escapeHtml(lvl)}">${escapeHtml(label)}</button>`;
    })
    .join("");

  appEl.innerHTML = `
    <h2>All cards</h2>
    <input class="search-input" id="search" placeholder="Search hanzi, pinyin, or definition..." />
    <div class="chip-row">${chips}</div>
    <div id="list"></div>
    <div class="data-actions">
      <button class="big-btn secondary small" id="export-json">Back up progress (JSON)</button>
      <button class="big-btn secondary small" id="export-csv">Export CSV</button>
      <button class="big-btn secondary small" id="import-btn">Import JSON or CSV</button>
      <input type="file" id="import-file" accept=".json,.csv,text/csv,application/json" style="display:none" />
    </div>
  `;

  const listEl = document.getElementById("list");
  const searchEl = document.getElementById("search");

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.browseFilter = chip.dataset.level;
      render();
    });
  });

  function renderList(filter) {
    const f = (filter || "").trim().toLowerCase();
    let filtered =
      state.browseFilter === "all"
        ? all
        : state.browseFilter === "leeches"
        ? all.filter((c) => SRS.isLeech(c))
        : all.filter((c) => c.level === state.browseFilter);
    if (f) {
      filtered = filtered.filter(
        (c) =>
          c.hanzi.includes(f) ||
          c.pinyin.toLowerCase().includes(f) ||
          c.definition.toLowerCase().includes(f)
      );
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No matches.</div>`;
      return;
    }

    const now = new Date();
    listEl.innerHTML = filtered
      .map((c) => {
        const due = new Date(c.dueDate);
        const dueNow = due.getTime() <= now.getTime();
        const dueLabel = dueNow ? "due now" : `due ${due.toLocaleDateString()}`;
        return `
          <div class="card-list-item" data-id="${c.id}">
            <div class="ci-hanzi">${escapeHtml(c.hanzi)}${SRS.isLeech(c) ? '<span class="leech-badge" title="Keeps coming back as \'Again\' — consider rewriting or splitting this card">🔥</span>' : ""}</div>
            <div class="ci-mid">
              <div class="ci-pinyin">${tonedPinyinHtml(c.pinyin)}</div>
              <div class="ci-def">${escapeHtml(c.definition)}</div>
            </div>
            <div class="ci-due ${dueNow ? "due-now" : ""}">${dueLabel}</div>
            <button class="icon-btn" data-del="${c.id}" title="Delete">✕</button>
          </div>
        `;
      })
      .join("");

    listEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Delete this card?")) {
          Store.remove(btn.dataset.del);
          setView("browse");
        }
      });
    });
  }

  searchEl.addEventListener("input", () => renderList(searchEl.value));
  renderList("");

  document.getElementById("export-json").addEventListener("click", exportJson);
  document.getElementById("export-csv").addEventListener("click", exportCsv);
  const fileInput = document.getElementById("import-file");
  document.getElementById("import-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) handleImportFile(file);
    fileInput.value = "";
  });
}

// ---------- Import / Export ----------

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Backup reminder ----------
// This app is localStorage-only: no cloud sync, no server. A cleared
// browser profile or an iOS storage eviction silently wipes months of
// review progress with no way back except a JSON export the user made
// themselves. Track the last export so Stats can nudge before that
// happens rather than only after.

const LAST_EXPORT_KEY = "hanzi-last-export-v1";
const BACKUP_REMINDER_DAYS = 14;

function recordExport() {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
  } catch (e) {
    // best-effort only; exportJson() already succeeded regardless
  }
}

function daysSinceLastExport() {
  const raw = localStorage.getItem(LAST_EXPORT_KEY);
  if (!raw) return Infinity;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 86400000 : Infinity;
}

// On platforms with the Web Share API (notably iOS Safari), this opens
// the native Share Sheet so the backup can go straight to iCloud Drive,
// AirDrop, another app, etc. in one tap — no account, no typing, and no
// relying on how the browser happens to handle a raw blob download.
// Falls back to a plain file download wherever Share isn't available.
async function exportJson() {
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `hanzi-backup-${stamp}.json`;
  const json = JSON.stringify(Store.all(), null, 2);

  if (navigator.share && navigator.canShare) {
    try {
      const file = new File([json], filename, { type: "application/json" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Hanzi SRS backup" });
        recordExport();
        showToast("Backup shared");
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return; // user cancelled the share sheet
      // any other failure: fall through to a plain download
    }
  }

  downloadBlob(json, "application/json", filename);
  recordExport();
  showToast("Exported JSON backup");
}

function csvEscape(field) {
  const s = String(field ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const rows = [["hanzi", "pinyin", "definition", "level"]];
  Store.all().forEach((c) => rows.push([c.hanzi, c.pinyin, c.definition, c.level || ""]));
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(csv, "text/csv", `hanzi-cards-${stamp}.csv`);
  showToast("Exported CSV");
}

// Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes,
// and commas/newlines inside quotes. Good enough for spreadsheet exports.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let entries;
      if (file.name.toLowerCase().endsWith(".json") || file.type === "application/json") {
        const parsed = JSON.parse(reader.result);
        entries = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        const rows = parseCsv(reader.result);
        let dataRows = rows;
        if (rows.length && /hanzi/i.test(rows[0][0] || "")) dataRows = rows.slice(1);
        entries = dataRows.map(([hanzi, pinyin, definition, level]) => ({
          hanzi: (hanzi || "").trim(),
          pinyin: (pinyin || "").trim(),
          definition: (definition || "").trim(),
          level: (level || "").trim(),
        }));
      }
      const { added, updated } = Store.importCards(entries);
      showToast(`Imported: ${added} added, ${updated} updated`);
      render();
    } catch (err) {
      showToast("Import failed: invalid file");
    }
  };
  reader.readAsText(file);
}

// ---------- Add ----------

function renderAdd() {
  const levels = Store.levels();

  appEl.innerHTML = `
    <h2>Add a character</h2>
    <div class="form-row">
      <label for="f-hanzi">Hanzi</label>
      <input class="text-input" id="f-hanzi" placeholder="e.g. 猫" />
    </div>
    <div class="form-row">
      <label for="f-pinyin">Pinyin</label>
      <input class="text-input" id="f-pinyin" placeholder="e.g. māo" />
    </div>
    <div class="form-row">
      <label for="f-def">Definition</label>
      <input class="text-input" id="f-def" placeholder="e.g. cat" />
    </div>
    <div class="form-row">
      <label for="f-level">Level / tag (optional)</label>
      <input class="text-input" id="f-level" list="level-options" placeholder="e.g. HSK4" />
      <datalist id="level-options">
        ${levels.map((l) => `<option value="${escapeHtml(l)}"></option>`).join("")}
      </datalist>
    </div>
    <button class="big-btn" id="save-card">Add card</button>
  `;

  document.getElementById("save-card").addEventListener("click", () => {
    const hanzi = document.getElementById("f-hanzi").value.trim();
    const pinyin = document.getElementById("f-pinyin").value.trim();
    const definition = document.getElementById("f-def").value.trim();
    const level = document.getElementById("f-level").value.trim();

    if (!hanzi || !pinyin || !definition) {
      showToast("Fill in all three fields");
      return;
    }

    const { duplicate } = Store.add(hanzi, pinyin, definition, level);
    showToast(duplicate ? `${hanzi} (${pinyin}) is already in your deck` : `Added ${hanzi}`);
    if (duplicate) return;
    document.getElementById("f-hanzi").value = "";
    document.getElementById("f-pinyin").value = "";
    document.getElementById("f-def").value = "";
    document.getElementById("f-hanzi").focus();
  });
}

// ---------- Stats ----------

function reviewCountsByDate() {
  const counts = {};
  Store.history().forEach((h) => {
    counts[h.date] = (counts[h.date] || 0) + 1;
  });
  return counts;
}

function currentStreak() {
  const counts = reviewCountsByDate();
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!counts[cursor.toISOString().slice(0, 10)]) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (counts[cursor.toISOString().slice(0, 10)]) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function computeAccuracy() {
  const history = Store.history();
  if (history.length === 0) return null;
  const retained = history.filter((h) => h.grade !== "again").length;
  return Math.round((retained / history.length) * 100);
}

function buildHeatmapCells(weeks) {
  const counts = reviewCountsByDate();
  const totalDays = weeks * 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (totalDays - 1));

  const cells = [];
  const padStart = start.getDay();
  for (let i = 0; i < padStart; i++) cells.push(null);
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, count: counts[key] || 0 });
  }
  return cells;
}

function heatmapTier(count) {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}

function renderStats() {
  const history = Store.history();
  const streak = currentStreak();
  const accuracy = computeAccuracy();
  const cells = buildHeatmapCells(12);
  const daysSinceBackup = daysSinceLastExport();
  const showBackupReminder = history.length > 0 && daysSinceBackup > BACKUP_REMINDER_DAYS;

  const heatmapHtml = cells
    .map((c) =>
      c === null
        ? `<div class="hm-cell hm-empty"></div>`
        : `<div class="hm-cell hm-tier-${heatmapTier(c.count)}" title="${c.date}: ${c.count} review${c.count === 1 ? "" : "s"}"></div>`
    )
    .join("");

  appEl.innerHTML = `
    <h2>Stats</h2>
    ${
      showBackupReminder
        ? `<div class="backup-reminder">
            <div>${Number.isFinite(daysSinceBackup) ? `You haven't backed up in ${Math.floor(daysSinceBackup)} days.` : "You've never exported a backup."} This app only stores data on this device — export a JSON backup to avoid losing your progress.</div>
            <button class="big-btn small" id="backup-now">Back up now</button>
          </div>`
        : ""
    }
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${streak}</div><div class="label">Day streak</div></div>
      <div class="stat-card"><div class="num">${accuracy === null ? "—" : accuracy + "%"}</div><div class="label">Retention</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${history.length}</div><div class="label">Total reviews</div></div>
      <div class="stat-card"><div class="num">${Store.all().length}</div><div class="label">Cards in deck</div></div>
    </div>
    <h2>Last 12 weeks</h2>
    <div class="heatmap">${heatmapHtml}</div>
    <div class="heatmap-legend">
      <span>Less</span>
      <div class="hm-cell hm-tier-0"></div>
      <div class="hm-cell hm-tier-1"></div>
      <div class="hm-cell hm-tier-2"></div>
      <div class="hm-cell hm-tier-3"></div>
      <span>More</span>
    </div>
    ${history.length === 0 ? '<div class="empty-state">Review some cards to start building stats.</div>' : ""}
  `;

  if (showBackupReminder) {
    document.getElementById("backup-now").addEventListener("click", () => {
      exportJson();
      render();
    });
  }
}

// ---------- Utils ----------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Boot ----------

window.addEventListener("hanzi-storage-error", () => {
  showToast("Couldn't save — storage is full or unavailable");
});

window.addEventListener("hanzi-storage-recovered", () => {
  showToast("Recovered your data from an automatic backup copy");
});

// Supports manifest.json home-screen shortcuts (e.g. "?view=review") that
// should land directly on a tab instead of always opening on Home.
function applyStartView() {
  const requested = new URLSearchParams(window.location.search).get("view");
  const validViews = ["home", "review", "browse", "add", "stats"];
  if (requested && validViews.includes(requested)) {
    state.view = requested;
    history.replaceState(null, "", window.location.pathname);
  }
}

initTheme();
loadReviewPrefs();
Store.load();
applyStartView();
render();
loadChinaMap();

// Best-effort, silent request that the browser not evict this site's
// storage under space pressure. No prompt, no user action, can't fail
// loudly — just improves the odds on browsers that support it.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
