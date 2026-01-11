const flipBtn = document.getElementById("flipBtn");
const resetBtn = document.getElementById("resetBtn");
const coin = document.getElementById("coin");
const result = document.getElementById("result");
const headsEl = document.getElementById("heads");
const tailsEl = document.getElementById("tails");

let heads = 0;
let tails = 0;

function randFlip() {
  // cryptographically-strong randomness when available
  if (window.crypto?.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return (a[0] % 2) === 0 ? "Heads" : "Tails";
  }
  return Math.random() < 0.5 ? "Heads" : "Tails";
}

flipBtn.addEventListener("click", () => {
  flipBtn.disabled = true;

  coin.classList.remove("flip");
  // restart animation
  void coin.offsetWidth;
  coin.classList.add("flip");

  const side = randFlip();

  setTimeout(() => {
    if (side === "Heads") heads++;
    else tails++;

    headsEl.textContent = String(heads);
    tailsEl.textContent = String(tails);
    result.textContent = `Result: ${side}!`;

    flipBtn.disabled = false;
  }, 700);
});

resetBtn.addEventListener("click", () => {
  heads = 0; tails = 0;
  headsEl.textContent = "0";
  tailsEl.textContent = "0";
  result.textContent = "Press flip to start.";
});


