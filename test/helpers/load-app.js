// Loads srs.js and store.js as plain browser globals into a fresh vm
// context per call, mocking just enough of the browser (localStorage,
// window.dispatchEvent, CustomEvent) for the persistence layer to run
// under Node. The app files stay untouched — no module.exports, no
// bundler — matching the project's zero-build-step design.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const SRS_SRC = fs.readFileSync(path.join(ROOT, "js/srs.js"), "utf8");
const STORE_SRC = fs.readFileSync(path.join(ROOT, "js/store.js"), "utf8");

function loadHanziModules({ seedHanzi = [] } = {}) {
  const rawStore = {};
  const dispatchedEvents = [];

  const sandbox = {
    console,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(rawStore, k) ? rawStore[k] : null),
      setItem: (k, v) => {
        rawStore[k] = v;
      },
      removeItem: (k) => {
        delete rawStore[k];
      },
    },
    window: {
      dispatchEvent: (evt) => dispatchedEvents.push(evt),
      addEventListener: () => {},
    },
    CustomEvent: function CustomEvent(type, opts) {
      this.type = type;
      this.detail = opts && opts.detail;
    },
    SEED_HANZI: seedHanzi,
  };

  vm.createContext(sandbox);
  // Appending explicit assignments is necessary because top-level
  // const/function declarations in a vm-run script do NOT become
  // properties of the context object (same rule as classic <script>
  // globals) -- this makes SRS/Store reachable from the returned object.
  vm.runInContext(`${SRS_SRC}\n${STORE_SRC}\nthis.SRS = SRS;\nthis.Store = Store;\n`, sandbox);

  return {
    SRS: sandbox.SRS,
    Store: sandbox.Store,
    sandbox,
    rawStore,
    dispatchedEvents,
  };
}

module.exports = { loadHanziModules };
