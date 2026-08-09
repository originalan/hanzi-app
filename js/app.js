// App shell: view routing + rendering.

const appEl = document.getElementById("app");
const tabbarEl = document.getElementById("tabbar");

let state = {
  view: "home",
  session: null, // { queue: [card,...], index, revealed }
};

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
}

// ---------- Home ----------

function renderHome() {
  const all = Store.all();
  const due = Store.dueCards();

  appEl.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${due.length}</div><div class="label">Due now</div></div>
      <div class="stat-card"><div class="num">${all.length}</div><div class="label">Total cards</div></div>
    </div>
    <button class="big-btn" id="start-review" ${due.length === 0 ? "disabled" : ""}>
      ${due.length === 0 ? "Nothing due — nice work" : `Review ${due.length} card${due.length === 1 ? "" : "s"}`}
    </button>
    <button class="big-btn secondary" id="go-browse">Browse all cards</button>
    <button class="big-btn secondary" id="go-add">Add a character</button>
  `;

  document.getElementById("start-review").addEventListener("click", () => {
    if (due.length === 0) return;
    setView("review");
  });
  document.getElementById("go-browse").addEventListener("click", () => setView("browse"));
  document.getElementById("go-add").addEventListener("click", () => setView("add"));
}

// ---------- Review ----------

function renderReview() {
  if (!state.session) {
    const queue = shuffle(Store.dueCards());
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
        <div class="pinyin">${session.revealed ? escapeHtml(card.pinyin) : ""}</div>
        <div class="definition">${session.revealed ? escapeHtml(card.definition) : ""}</div>
        ${session.revealed ? "" : '<div class="hint">Tap to reveal</div>'}
      </div>
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
  }
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
  };
  const queueIdsBefore = session.queue.map((c) => c.id);

  const { requeue } = Store.grade(card.id, grade);
  session.queue.shift();
  if (requeue) session.queue.push(card);
  session.revealed = false;

  showUndoToast(`Graded ${card.hanzi} as ${GRADE_LABELS[grade]}`, () => {
    Store.update(card.id, prevState);
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

  appEl.innerHTML = `
    <h2>All cards</h2>
    <input class="search-input" id="search" placeholder="Search hanzi, pinyin, or definition..." />
    <div id="list"></div>
  `;

  const listEl = document.getElementById("list");
  const searchEl = document.getElementById("search");

  function renderList(filter) {
    const f = (filter || "").trim().toLowerCase();
    const filtered = f
      ? all.filter(
          (c) =>
            c.hanzi.includes(f) ||
            c.pinyin.toLowerCase().includes(f) ||
            c.definition.toLowerCase().includes(f)
        )
      : all;

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
            <div class="ci-hanzi">${escapeHtml(c.hanzi)}</div>
            <div class="ci-mid">
              <div class="ci-pinyin">${escapeHtml(c.pinyin)}</div>
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
}

// ---------- Add ----------

function renderAdd() {
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
    <button class="big-btn" id="save-card">Add card</button>
  `;

  document.getElementById("save-card").addEventListener("click", () => {
    const hanzi = document.getElementById("f-hanzi").value.trim();
    const pinyin = document.getElementById("f-pinyin").value.trim();
    const definition = document.getElementById("f-def").value.trim();

    if (!hanzi || !pinyin || !definition) {
      showToast("Fill in all three fields");
      return;
    }

    Store.add(hanzi, pinyin, definition);
    showToast(`Added ${hanzi}`);
    document.getElementById("f-hanzi").value = "";
    document.getElementById("f-pinyin").value = "";
    document.getElementById("f-def").value = "";
    document.getElementById("f-hanzi").focus();
  });
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

initTheme();
Store.load();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
