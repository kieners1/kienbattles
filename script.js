// Multiplayer coin flip using Firebase Realtime Database (free tier).
// Works on GitHub Pages because we use Firebase CDN module imports.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  onDisconnect,
  serverTimestamp,
  runTransaction,
  push,
  query,
  limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

/** 1) PASTE YOUR FIREBASE CONFIG HERE (from Firebase console) */
const firebaseConfig = {
  // apiKey: "...",
  // authDomain: "...",
  // databaseURL: "...",
  // projectId: "...",
  // storageBucket: "...",
  // messagingSenderId: "...",
  // appId: "..."
};
/** ---------------------------------------------- */

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// UI
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const roomLabel = document.getElementById("roomLabel");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const coinEl = document.getElementById("coin");
const historyEl = document.getElementById("history");

// Persistent client id (so refresh doesn’t create “new person”)
const CLIENT_ID_KEY = "coinflip_client_id";
const clientId = (() => {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
})();

let currentRoom = null;
let joined = false;

// Random 50/50 (good randomness)
function randSide() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 2) === 0 ? "Heads" : "Tails";
}

function animateFlip() {
  coinEl.classList.remove("flip");
  void coinEl.offsetWidth;
  coinEl.classList.add("flip");
}

// Clean room code
function normalizeRoom(s) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 32);
}

// --- Joining / Presence ---
async function joinRoom(room) {
  const roomId = normalizeRoom(room);
  if (!roomId) {
    alert("Please enter a room code (letters/numbers only).");
    return;
  }

  // Put room in the URL so you can share the link
  const url = new URL(window.location.href);
  url.hash = roomId;
  history.replaceState(null, "", url.toString());

  currentRoom = roomId;
  joined = true;
  joinBtn.disabled = true;
  roomInput.disabled = true;
  roomLabel.textContent = `Room: ${roomId}`;

  const roomBase = `rooms/${roomId}`;
  const meRef = ref(db, `${roomBase}/players/${clientId}`);
  const countRef = ref(db, `${roomBase}/playerCount`);

  // Mark me present
  await set(meRef, { joinedAt: serverTimestamp() });

  // Increment playerCount (atomic)
  await runTransaction(countRef, (n) => (typeof n === "number" ? n + 1 : 1));

  // On disconnect: remove me + decrement
  onDisconnect(meRef).remove();
  onDisconnect(countRef).set(null); // fallback (we also decrement below)

  // Better decrement on disconnect using a second transaction:
  // (This won't run if the tab crashes before setup, but usually works well.)
  onDisconnect(ref(db, `${roomBase}/disconnect/${clientId}`)).set({ at: serverTimestamp() });

  // Listen for disconnect markers and reconcile count (simple + reliable)
  // If you don’t want this extra logic, you can remove it — but it helps keep counts right.
  const disconnectRef = ref(db, `${roomBase}/disconnect`);
  onValue(disconnectRef, async (snap) => {
    const val = snap.val();
    if (!val) return;

    // If someone disconnected, rebuild playerCount from players list
    const playersSnap = await get(ref(db, `${roomBase}/players`));
    const players = playersSnap.val() || {};
    const realCount = Object.keys(players).length;
    await set(countRef, realCount);

    // Clear disconnect markers
    await set(disconnectRef, null);
  });

  // Keep playerCount accurate (when players list changes)
  onValue(ref(db, `${roomBase}/players`), async (snap) => {
    const players = snap.val() || {};
    const realCount = Object.keys(players).length;
    await set(countRef, realCount);
  });

  // Main listeners: count + flip result + history
  listenRoom(roomId);
}

function listenRoom(roomId) {
  const roomBase = `rooms/${roomId}`;
  const countRef = ref(db, `${roomBase}/playerCount`);
  const flipRef = ref(db, `${roomBase}/flip`);

  // Show count + trigger flip when exactly 2 players are present
  onValue(countRef, async (snap) => {
    const count = snap.val() || 0;

    if (count < 2) {
      statusEl.textContent = `Waiting for 2 players… (${count}/2)`;
      resultEl.textContent = "—";
      // Reset flip state so the next time 2 join, it flips again
      await set(flipRef, { status: "waiting", updatedAt: serverTimestamp() });
      return;
    }

    if (count === 2) {
      statusEl.textContent = "2 players connected! Flipping…";

      // Attempt to flip ONCE (transaction prevents double flip)
      const side = randSide();
      animateFlip();

      const tx = await runTransaction(flipRef, (cur) => {
        // If we already flipped and status is done, do nothing
        if (cur && cur.status === "done") return cur;

        // Otherwise set result
        return {
          status: "done",
          result: side,
          updatedAt: serverTimestamp()
        };
      });

      // If THIS client committed the flip, write history
      if (tx.committed) {
        await push(ref(db, `${roomBase}/history`), {
          result: tx.snapshot.val()?.result || side,
          at: serverTimestamp()
        });
      }
      return;
    }

    // More than 2 players (optional behavior)
    statusEl.textContent = `More than 2 players in room (${count}). This mode is “2 players only”.`;
  });

  // Everyone listens to flip result and shows the same output
  onValue(flipRef, (snap) => {
    const data = snap.val();
    if (!data) return;

    if (data.status === "done" && data.result) {
      resultEl.textContent = `Result: ${data.result}`;
      statusEl.textContent = "Flipped! (Shared result)";
    }
  });

  // History (last 10)
  const historyQ = query(ref(db, `${roomBase}/history`), limitToLast(10));
  onValue(historyQ, (snap) => {
    const items = [];
    snap.forEach((child) => items.push(child.val()));
    items.reverse();

    historyEl.innerHTML = "";
    for (const it of items) {
      const li = document.createElement("li");
      li.textContent = it?.result ? String(it.result) : "—";
      historyEl.appendChild(li);
    }
  });
}

// Join button
joinBtn.addEventListener("click", () => joinRoom(roomInput.value));

// Auto-join if URL has a room code in the hash
const initialRoom = normalizeRoom((window.location.hash || "").replace("#", ""));
if (initialRoom) {
  roomInput.value = initialRoom;
  joinRoom(initialRoom);
} else {
  statusEl.textContent = "Enter a room code to start.";
}

