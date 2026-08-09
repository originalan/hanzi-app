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
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function render() {
  updateActiveTab();
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
      <div class="card" id="flip-card">
        <div class="hanzi">${escapeHtml(card.hanzi)}</div>
        <div class="pinyin">${session.revealed ? escapeHtml(card.pinyin) : ""}</div>
        <div class="definition">${session.revealed ? escapeHtml(card.definition) : ""}</div>
        ${session.revealed ? "" : '<div class="hint">Tap to reveal</div>'}
      </div>
      ${session.revealed ? gradeRowHtml() : ""}
    </div>
  `;

  if (!session.revealed) {
    document.getElementById("flip-card").addEventListener("click", () => {
      session.revealed = true;
      render();
    });
  } else {
    appEl.querySelectorAll(".grade-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const { requeue } = Store.grade(card.id, btn.dataset.grade);
        session.queue.shift();
        if (requeue) session.queue.push(card);
        session.revealed = false;
        render();
      });
    });
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

Store.load();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
