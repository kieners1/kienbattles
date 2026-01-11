alert("script.js loaded ✅");
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

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

/** ✅ REPLACE THESE WITH YOUR REAL VALUES */
const firebaseConfig = {
  apiKey: "AIzaSyDWwOeobP3UY3HVoYsdYwa5rg-rG6sVtqo",
  authDomain: "kienbattles.firebaseapp.com",
  databaseURL: "https://kienbattles-default-rtdb.firebaseio.com",
  projectId: "kienbattles",
  storageBucket: "kienbattles.firebasestorage.app",
  messagingSenderId: "538328450866",
  appId: "G-X8ML39K2HN"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

/* UI */
const totalFlipsEl = document.getElementById("totalFlips");
const meLabel = document.getElementById("meLabel");
const authBtn = document.getElementById("authBtn");
const createBtn = document.getElementById("createBtn");
const tabActive = document.getElementById("tabActive");
const tabHistory = document.getElementById("tabHistory");
const activeList = document.getElementById("activeList");
const historyList = document.getElementById("historyList");
const myBody = document.getElementById("myBody");
const authBack = document.getElementById("authModalBack");
const authCloseBtn = document.getElementById("authCloseBtn");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const signupBtn = document.getElementById("signupBtn");
const signinBtn = document.getElementById("signinBtn");
const authMsg = document.getElementById("authMsg");

const MY_FLIP_KEY = "coinflip_my_flip_id";
const LAST_CONFETTI_KEY = "coinflip_last_confetti_flip";
let myFlipId = (localStorage.getItem(MY_FLIP_KEY) || "").trim();
let lastConfettiFlip = (localStorage.getItem(LAST_CONFETTI_KEY) || "").trim();

function usernameToEmail(username) {
  const u = (username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/.test(u)) throw new Error("Username must be 3–16 chars: letters/numbers/_");
  return `${u}@kienbattles.local`;
}
function avatarUrlFromName(name) {
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name || "player")}`;
}
function initials(name) {
  const parts = (name || "??").trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || "?").join("");
}
function fmtStatus(state) {
  return state === 0 ? "Waiting" : state === 1 ? "Matched" : "Done";
}
function randSide() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 2) === 0 ? "Heads" : "Tails";
}
function setTab(which) {
  const active = which === "active";
  tabActive.classList.toggle("active", active);
  tabHistory.classList.toggle("active", !active);
  activeList.classList.toggle("hidden", !active);
  historyList.classList.toggle("hidden", active);
}
function openAuth() {
  authMsg.textContent = "";
  authPassword.value = "";
  authBack.classList.add("show");
  setTimeout(() => authUsername.focus(), 0);
}
function closeAuth() {
  authBack.classList.remove("show");
}
async function fireConfettiOnce(flipId) {
  if (!window.confetti) return;
  if (!flipId) return;
  if (lastConfettiFlip === flipId) return;
  window.confetti({ particleCount: 180, spread: 70, origin: { y: 0.7 } });
  lastConfettiFlip = flipId;
  localStorage.setItem(LAST_CONFETTI_KEY, flipId);
}

/* Auth actions (username + password) */
async function signupUsername(username, password) {
  const email = usernameToEmail(username);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: username });
  await set(ref(db, `users/${cred.user.uid}`), {
    name: username,
    avatar: avatarUrlFromName(username),
    updatedAt: Date.now()
  });
  return cred.user;
}
async function signinUsername(username, password) {
  const email = usernameToEmail(username);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const name = cred.user.displayName || username;
  await set(ref(db, `users/${cred.user.uid}`), {
    name,
    avatar: avatarUrlFromName(name),
    updatedAt: Date.now()
  });
  return cred.user;
}
async function logout() {
  await signOut(auth);
}

/* Total flips */
onValue(ref(db, "stats/totalFlips"), (snap) => {
  totalFlipsEl.textContent = String(snap.val() || 0);
});

/* Create coinflip */
async function createCoinflip(pick) {
  const u = auth.currentUser;
  if (!u) return openAuth();

  const flipRef = push(ref(db, "coinflips"));
  const flipId = flipRef.key;

  const creatorName = u.displayName || "player";
  await set(flipRef, {
    createdAt: serverTimestamp(),
    state: 0,
    finalized: null,

    creatorUid: u.uid,
    creatorName,
    creatorAvatar: avatarUrlFromName(creatorName),
    creatorPick: pick,

    joinerUid: null,
    joinerName: null,
    joinerAvatar: null,

    result: null,
    winnerUid: null,
    loserUid: null,
    flippedAt: null
  });

  myFlipId = flipId;
  localStorage.setItem(MY_FLIP_KEY, myFlipId);
}

/* Join + flip + finalize (only once) */
async function joinFlip(flipId) {
  const u = auth.currentUser;
  if (!u) return openAuth();

  const flipRef = ref(db, `coinflips/${flipId}`);
  const joinerName = u.displayName || "player";

  // claim join slot
  const joinTx = await runTransaction(flipRef, (cur) => {
    if (!cur) return cur;
    if (cur.state !== 0) return cur;
    if (cur.creatorUid === u.uid) return cur;
    if (cur.joinerUid) return cur;

    cur.joinerUid = u.uid;
    cur.joinerName = joinerName;
    cur.joinerAvatar = avatarUrlFromName(joinerName);
    cur.state = 1;
    return cur;
  });

  if (!joinTx.committed) return;

  myFlipId = flipId;
  localStorage.setItem(MY_FLIP_KEY, myFlipId);

  // set result once
  await runTransaction(ref(db, `coinflips/${flipId}/result`), (cur) => cur || randSide());

  // finalize once
  const finalizedTx = await runTransaction(ref(db, `coinflips/${flipId}/finalized`), (cur) => cur || true);

  if (finalizedTx.committed) {
    const snap = await get(flipRef);
    const f = snap.val();
    if (!f) return;

    const result = f.result;
    const creatorWon = (result === f.creatorPick);
    const winnerUid = creatorWon ? f.creatorUid : f.joinerUid;
    const loserUid = creatorWon ? f.joinerUid : f.creatorUid;

    await update(flipRef, {
      state: 2,
      winnerUid,
      loserUid,
      flippedAt: serverTimestamp()
    });

    await runTransaction(ref(db, "stats/totalFlips"), (n) => (typeof n === "number" ? n + 1 : 1));
    await push(ref(db, "history"), { flipId, createdAt: serverTimestamp(), result });
  }
}

/* Render */
function renderActive(items) {
  activeList.innerHTML = "";
  if (items.length === 0) {
    activeList.innerHTML = `<div class="muted">No active coinflips right now. Create one!</div>`;
    return;
  }

  const me = auth.currentUser?.uid || null;

  for (const f of items) {
    const canJoin = !!me && f.state === 0 && f.creatorUid !== me && !f.joinerUid;
    const isMine = !!me && (f.creatorUid === me || f.joinerUid === me);

    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="left">
        <div class="avatar">${initials(f.creatorName || "U")}</div>
        <div class="meta">
          <div class="metaTop">
            <div class="name">${f.creatorName || "Unknown"}</div>
            <div class="badge">${fmtStatus(f.state)}</div>
            ${isMine ? `<div class="badge">Mine</div>` : ``}
          </div>
          <div class="desc">
            ${f.joinerName ? `vs ${f.joinerName}` : `Pick: ${f.creatorPick} • Waiting for join…`}
          </div>
        </div>
      </div>
      <div class="right">
        <div class="pill">🪙 ${f.creatorPick || "Coinflip"}</div>
        ${
          me
            ? (canJoin
                ? `<button class="primary" data-join="${f.id}">Join</button>`
                : `<button class="ghost" disabled>${f.state === 0 ? "Waiting" : "In progress"}</button>`)
            : `<button class="primary" data-login="1">Sign in</button>`
        }
      </div>
    `;
    activeList.appendChild(el);
  }

  activeList.querySelectorAll("button[data-join]").forEach((btn) => {
    btn.addEventListener("click", () => joinFlip(btn.getAttribute("data-join")));
  });
  activeList.querySelectorAll("button[data-login]").forEach((btn) => {
    btn.addEventListener("click", openAuth);
  });
}

function renderHistory(items) {
  historyList.innerHTML = "";
  if (items.length === 0) {
    historyList.innerHTML = `<div class="muted">No completed flips yet.</div>`;
    return;
  }

  for (const f of items.slice(0, 80)) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="left">
        <div class="avatar">${initials(f.creatorName || "U")}</div>
        <div class="meta">
          <div class="metaTop">
            <div class="name">${f.creatorName || "Unknown"} vs ${f.joinerName || "Unknown"}</div>
            <div class="badge">Done</div>
          </div>
          <div class="desc">Result: <b>${f.result || "—"}</b></div>
        </div>
      </div>
      <div class="right">
        <div class="pill">✅ ${f.result || "—"}</div>
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

  const me = auth.currentUser?.uid || null;
  let line = f.state === 0 ? `Waiting… (You picked ${f.creatorPick})`
          : f.state === 1 ? `Matched… flipping…`
          : `Result: ${f.result || "—"}`;

  let outcome = "";
  if (f.state === 2 && me) {
    if (f.winnerUid === me) outcome = "VICTORY 🏆";
    else if (f.loserUid === me) outcome = "DEFEAT 💀";
  }

  myBody.innerHTML = `
    <div>
      <div><b>${f.creatorName || "Unknown"}</b>${f.joinerName ? ` vs <b>${f.joinerName}</b>` : ""}</div>
      <div class="muted">${line}</div>
      ${outcome ? `<div style="margin-top:6px; font-weight:900;">${outcome}</div>` : ``}
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

  if (f.state === 2 && me && f.winnerUid === me) fireConfettiOnce(f.id);
}

/* Listen to coinflips */
onValue(query(ref(db, "coinflips"), limitToLast(200)), (snap) => {
  const all = [];
  snap.forEach((c) => all.push({ id: c.key, ...c.val() }));
  all.reverse();

  const active = all.filter(f => f.state !== 2);
  const done = all.filter(f => f.state === 2);

  renderActive(active);
  renderHistory(done);
  renderMy(all.find(f => f.id === myFlipId) || null);
});

/* Events */
tabActive.addEventListener("click", () => setTab("active"));
tabHistory.addEventListener("click", () => setTab("history"));

authBtn.addEventListener("click", () => {
  if (auth.currentUser) logout();
  else openAuth();
});

createBtn.addEventListener("click", () => {
  if (!auth.currentUser) return openAuth();
  const pick = document.querySelector('input[name="pick"]:checked')?.value || "Heads";
  createCoinflip(pick);
});

authCloseBtn.addEventListener("click", closeAuth);
authBack.addEventListener("click", (e) => { if (e.target === authBack) closeAuth(); });

signupBtn.addEventListener("click", async () => {
  authMsg.textContent = "";
  try {
    const u = authUsername.value.trim();
    const p = authPassword.value;
    await signupUsername(u, p);
    closeAuth();
  } catch (err) {
    authMsg.textContent = err?.message || String(err);
  }
});

signinBtn.addEventListener("click", async () => {
  authMsg.textContent = "";
  try {
    const u = authUsername.value.trim();
    const p = authPassword.value;
    await signinUsername(u, p);
    closeAuth();
  } catch (err) {
    authMsg.textContent = err?.message || String(err);
  }
});

/* Auth state UI */
onAuthStateChanged(auth, (user) => {
  if (!user) {
    meLabel.textContent = "Not signed in";
    authBtn.textContent = "Sign in";
    return;
  }
  const name = user.displayName || "player";
  meLabel.textContent = `Signed in: ${name}`;
  authBtn.textContent = "Sign out";
});




