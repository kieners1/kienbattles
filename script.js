import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  push,
  runTransaction,
  serverTimestamp,
  query,
  limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

/** ✅ PUT YOUR REAL FIREBASE CONFIG HERE */
const firebaseConfig = {
  apiKey: "AIzaSyDWwOeobP3UY3HVoYsdYwa5rg-rG6sVtqo",
  authDomain: "kienbattles.firebaseapp.com",
  databaseURL: "https://kienbattles-default-rtdb.firebaseio.com",
  projectId: "kienbattles",
  storageBucket: "kienbattles.firebasestorage.app",
  messagingSenderId: "538328450866",
  appId: "1:538328450866:web:8b0696a9bdad493b34792b"
};
/** ------------------------------------- */

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// UI (IDs MUST exist in index.html)
const totalFlipsEl = document.getElementById("totalFlips");
const meLabel = document.getElementById("meLabel");
const setNameBtn = document.getElementById("setNameBtn");
const createBtn = document.getElementById("createBtn");
const tabActive = document.getElementById("tabActive");
const tabHistory = document.getElementById("tabHistory");
const activeList = document.getElementById("activeList");
const historyList = document.getElementById("historyList");
const myBody = document.getElementById("myBody");

// If any is null, stop early with a clear error
const required = { totalFlipsEl, meLabel, setNameBtn, createBtn, tabActive, tabHistory, activeList, historyList, myBody };
for (const [k, v] of Object.entries(required)) {
  if (!v) throw new Error(`Missing element in index.html: ${k}`);
}

// Persistent client id + name
const CLIENT_ID_KEY = "coinflip_client_id";
const NAME_KEY = "coinflip_display_name";
const MY_FLIP_KEY = "coinflip_my_flip_id";

const clientId = (() => {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
})();

let displayName = (localStorage.getItem(NAME_KEY) || "").trim();
let myFlipId = (localStorage.getItem(MY_FLIP_KEY) || "").trim();

// Helpers
function initials(name) {
  const parts = (name || "??").trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || "?").join("");
}
function randSide() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 2) === 0 ? "Heads" : "Tails";
}
function fmtStatus(state) {
  return state === 0 ? "Waiting" : state === 1 ? "Matched" : "Done";
}

function setTab(which) {
  const active = which === "active";
  tabActive.classList.toggle("active", active);
  tabHistory.classList.toggle("active", !active);
  activeList.classList.toggle("hidden", !active);
  historyList.classList.toggle("hidden", active);
}
tabActive.addEventListener("click", () => setTab("active"));
tabHistory.addEventListener("click", () => setTab("history"));

function ensureName() {
  if (displayName) return true;
  const n = prompt("Pick a display name:");
  if (!n) return false;
  displayName = n.trim().slice(0, 24);
  localStorage.setItem(NAME_KEY, displayName);
  renderMe();
  return true;
}
function renderMe() {
  meLabel.textContent = displayName ? `Playing as: ${displayName}` : "Not signed in";
}
renderMe();

// Set name button
setNameBtn.addEventListener("click", () => {
  const n = prompt("New display name:", displayName || "");
  if (!n) return;
  displayName = n.trim().slice(0, 24);
  localStorage.setItem(NAME_KEY, displayName);
  renderMe();
});

// Total flips
onValue(ref(db, "stats/totalFlips"), (snap) => {
  totalFlipsEl.textContent = String(snap.val() || 0);
});

// Create coinflip
createBtn.addEventListener("click", async () => {
  if (!ensureName()) return;

  const flipRef = push(ref(db, "coinflips"));
  const flipId = flipRef.key;

  const flip = {
    createdAt: serverTimestamp(),
    state: 0, // 0 waiting, 1 matched, 2 done
    creator: { id: clientId, name: displayName },
    joiner: null,
    result: null,
    flippedAt: null
  };

  await set(flipRef, flip);

  myFlipId = flipId;
  localStorage.setItem(MY_FLIP_KEY, myFlipId);
});

// Join coinflip
async function joinFlip(flipId) {
  if (!ensureName()) return;

  const flipRef = ref(db, `coinflips/${flipId}`);

  // Atomically claim joiner if empty and still waiting
  const tx = await runTransaction(flipRef, (cur) => {
    if (!cur) return cur;
    if (cur.state !== 0) return cur;               // not waiting
    if (cur.creator?.id === clientId) return cur;  // can't join own
    if (cur.joiner) return cur;                    // already joined

    cur.joiner = { id: clientId, name: displayName };
    cur.state = 1;
    return cur;
  });

  if (!tx.committed) return;

  myFlipId = flipId;
  localStorage.setItem(MY_FLIP_KEY, myFlipId);

  // Flip once (transaction on result)
  const resTx = await runTransaction(ref(db, `coinflips/${flipId}/result`), (cur) => {
    if (cur) return cur;
    return randSide();
  });

  if (resTx.committed) {
    await update(ref(db, `coinflips/${flipId}`), {
      state: 2,
      flippedAt: serverTimestamp()
    });

    // Increment total flips
    await runTransaction(ref(db, "stats/totalFlips"), (n) => (typeof n === "number" ? n + 1 : 1));

    // Add to history
    await push(ref(db, "history"), {
      flipId,
      createdAt: serverTimestamp(),
      result: resTx.snapshot.val()
    });
  }
}

// Render lists
onValue(query(ref(db, "coinflips"), limitToLast(120)), (snap) => {
  const all = [];
  snap.forEach((c) => all.push({ id: c.key, ...c.val() }));
  all.reverse();

  const active = all.filter(f => f.state !== 2);
  const done = all.filter(f => f.state === 2);

  renderActive(active);
  renderHistory(done);
  renderMy(all.find(f => f.id === myFlipId) || null);
});

function renderActive(items) {
  activeList.innerHTML = "";
  if (items.length === 0) {
    activeList.innerHTML = `<div class="muted">No active coinflips right now. Create one!</div>`;
    return;
  }

  for (const f of items) {
    const creatorName = f.creator?.name || "Unknown";
    const joinerName = f.joiner?.name || null;
    const canJoin = f.state === 0 && f.creator?.id !== clientId && !f.joiner;
    const isMine = f.creator?.id === clientId || f.joiner?.id === clientId;

    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="left">
        <div class="avatar">${initials(creatorName)}</div>
        <div class="meta">
          <div class="metaTop">
            <div class="name">${creatorName}</div>
            <div class="badge">${fmtStatus(f.state)}</div>
            ${isMine ? `<div class="badge">Mine</div>` : ``}
          </div>
          <div class="desc">${joinerName ? `vs ${joinerName}` : `Waiting for someone to join…`}</div>
        </div>
      </div>
      <div class="right">
        <div class="pill">🪙 Coinflip</div>
        ${
          canJoin
            ? `<button class="primary" data-join="${f.id}">Join</button>`
            : `<button class="ghost" disabled>${f.state === 0 ? "Waiting" : "In progress"}</button>`
        }
      </div>
    `;
    activeList.appendChild(el);
  }

  activeList.querySelectorAll("button[data-join]").forEach((btn) => {
    btn.addEventListener("click", () => joinFlip(btn.getAttribute("data-join")));
  });
}

function renderHistory(items) {
  historyList.innerHTML = "";
  if (items.length === 0) {
    historyList.innerHTML = `<div class="muted">No completed flips yet.</div>`;
    return;
  }

  for (const f of items.slice(0, 80)) {
    const creatorName = f.creator?.name || "Unknown";
    const joinerName = f.joiner?.name || "Unknown";
    const result = f.result || "—";

    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="left">
        <div class="avatar">${initials(creatorName)}</div>
        <div class="meta">
          <div class="metaTop">
            <div class="name">${creatorName} vs ${joinerName}</div>
            <div class="badge">Done</div>
          </div>
          <div class="desc">Result: <b>${result}</b></div>
        </div>
      </div>
      <div class="right">
        <div class="pill">✅ ${result}</div>
        <button class="ghost" disabled>Completed</button>
      </div>
    `;
    historyList.appendChild(el);
  }
}

function renderMy(f) {
  if (!f) {
    myBody.innerHTML = `<div class="muted">Create or join a coinflip to see it here.</div>`;
    return;
  }

  const creator = f.creator?.name || "Unknown";
  const joiner = f.joiner?.name || "";
  const youAreCreator = f.creator?.id === clientId;
  const youAreJoiner = f.joiner?.id === clientId;

  let line = "";
  if (f.state === 0) line = "Waiting for someone to join your coinflip…";
  if (f.state === 1) line = "Someone joined! Flipping…";
  if (f.state === 2) line = `Result: ${f.result || "—"}`;

  myBody.innerHTML = `
    <div>
      <div><b>${creator}</b>${joiner ? ` vs <b>${joiner}</b>` : ""}</div>
      <div class="muted">${line}</div>
      <div class="muted">${youAreCreator ? "You created this." : youAreJoiner ? "You joined this." : ""}</div>
    </div>
    <div class="right">
      <div class="pill">${fmtStatus(f.state)}</div>
      <button class="ghost" id="clearMineBtn">Clear</button>
    </div>
  `;

  document.getElementById("clearMineBtn").addEventListener("click", () => {
    myFlipId = "";
    localStorage.removeItem(MY_FLIP_KEY);
    myBody.innerHTML = `<div class="muted">Create or join a coinflip to see it here.</div>`;
  });
}

