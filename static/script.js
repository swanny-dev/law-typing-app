// ── State ─────────────────────────────────────────────────────

let rawPassage       = "";
let currentPassage   = "";
let currentTopic     = "";
let currentLength    = "long";
let currentCase      = "mixed";
let currentSubject   = "pub";
let currentStyle     = "passage";
let customText       = "";

let startTime        = null;
let started          = false;
let finished         = false;
let wpmInterval      = null;
let mistakeCount     = 0;
let prevTypedLen     = 0;
let sessionKeyErrors = {};
let targetWpm        = 0;

// ── DOM refs ───────────────────────────────────────────────────

const textDisplay  = document.getElementById("text-display");
const hiddenInput  = document.getElementById("hidden-input");
const topicLabel   = document.getElementById("topic-label");
const exerciseArea = document.getElementById("exercise-area");
const clickHint    = document.getElementById("click-hint");
const restartBtn   = document.getElementById("restart-btn");
const liveStats    = document.getElementById("live-stats");
const liveWpm      = document.getElementById("live-wpm");
const liveAccuracy = document.getElementById("live-accuracy");
const liveTimer    = document.getElementById("live-timer");

// ── Boot ───────────────────────────────────────────────────────

loadNewExercise();

(async () => {
  try {
    const { available } = await (await fetch("/api/docs-available")).json();
    if (available) document.getElementById("btn-docs").style.display = "";
  } catch {}
})();

// ── Toggle handlers ────────────────────────────────────────────

function setSubject(s) {
  currentSubject = s;
  setActive("btn-pub",    s === "pub");
  setActive("btn-crim",   s === "crim");
  setActive("btn-all",    s === "all");
  setActive("btn-cases",  s === "cases");
  setActive("btn-custom", s === "custom");
  setActive("btn-docs",   s === "docs");
  if (s === "custom") {
    showCustomModal();
  } else {
    loadNewExercise();
  }
}

function setStyle(s) {
  currentStyle = s;
  setActive("btn-passage", s === "passage");
  setActive("btn-essay",   s === "essay");
  loadNewExercise();
}

function setLength(l) {
  currentLength = l;
  setActive("btn-short", l === "short");
  setActive("btn-long",  l === "long");
  loadNewExercise();
}

function setCase(c) {
  currentCase = c;
  setActive("btn-lower", c === "lower");
  setActive("btn-mixed", c === "mixed");
  if (rawPassage) {
    currentPassage = applyCase(rawPassage);
    resetState();
    renderExercise();
    hiddenInput.focus();
  }
}

function setTargetWpm(t) {
  targetWpm = t;
  setActive("btn-tgt-off", t === 0);
  setActive("btn-tgt-40",  t === 40);
  setActive("btn-tgt-60",  t === 60);
  setActive("btn-tgt-80",  t === 80);
  exerciseArea.style.setProperty("--target-visible", t > 0 ? "block" : "none");
  if (t === 0) liveWpm.classList.remove("on-target");
}

function setActive(id, on) {
  document.getElementById(id).classList.toggle("active", on);
}

function applyCase(text) {
  return currentCase === "lower" ? text.toLowerCase() : text;
}

// ── Exercise loading ───────────────────────────────────────────

async function loadNewExercise() {
  showScreen("exercise-screen");
  resetState();

  topicLabel.textContent     = "";
  restartBtn.style.display   = "none";
  clickHint.style.display    = "block";
  liveStats.style.visibility = "hidden";

  if (currentSubject === "custom") {
    if (!customText) {
      textDisplay.innerHTML = "<span class='loading-text'>click Custom to add your text</span>";
      return;
    }
    rawPassage     = customText;
    currentPassage = applyCase(customText);
    currentTopic   = "custom text";
    renderExercise();
    return;
  }

  textDisplay.innerHTML = "<span class='loading-text'>generating...</span>";
  try {
    const url  = `/api/exercise?length=${currentLength}&subject=${currentSubject}&style=${currentStyle}`;
    const res  = await fetch(url);
    const data = await res.json();
    rawPassage     = data.text;
    currentPassage = applyCase(rawPassage);
    currentTopic   = data.topic;
    renderExercise();
  } catch {
    textDisplay.innerHTML = "<span style='color:#f43f5e'>failed to load — please refresh</span>";
  }
}

function renderExercise() {
  topicLabel.textContent = currentTopic;
  hiddenInput.value      = "";
  hiddenInput.setAttribute("maxlength", currentPassage.length);
  exerciseArea.style.setProperty("--progress", "0%");
  exerciseArea.style.setProperty("--target-pos", "0%");

  textDisplay.innerHTML = Array.from(currentPassage)
    .map((ch, i) => {
      const display = ch === " " ? "\u00b7" : ch;
      return `<span data-i="${i}" data-char="${encodeChar(ch)}">${display}</span>`;
    })
    .join("");

  getSpan(0).classList.add("cursor");
  restartBtn.style.display   = "inline-block";
  clickHint.style.display    = "block";
  liveStats.style.visibility = "hidden";
}

// ── Input ──────────────────────────────────────────────────────

hiddenInput.addEventListener("input", function () {
  if (finished) return;

  const typed = this.value;

  // track every wrong keystroke even if corrected; record which character was expected
  if (typed.length > prevTypedLen) {
    for (let k = prevTypedLen; k < typed.length; k++) {
      if (typed[k] !== currentPassage[k]) {
        mistakeCount++;
        const expectedKey = currentPassage[k] === " " ? "space" : currentPassage[k].toLowerCase();
        sessionKeyErrors[expectedKey] = (sessionKeyErrors[expectedKey] || 0) + 1;
      }
    }
  }
  prevTypedLen = typed.length;

  if (!started && typed.length > 0) {
    started    = true;
    startTime  = Date.now();
    liveStats.style.visibility = "visible";
    wpmInterval = setInterval(updateLiveStats, 200);
  }

  for (let i = 0; i < currentPassage.length; i++) {
    const span = getSpan(i);
    span.classList.remove("correct", "incorrect", "cursor");
    if (i < typed.length) {
      span.classList.add(typed[i] === currentPassage[i] ? "correct" : "incorrect");
    } else if (i === typed.length) {
      span.classList.add("cursor");
    }
  }

  exerciseArea.style.setProperty("--progress", (typed.length / currentPassage.length * 100) + "%");

  // move the target pace marker
  if (targetWpm > 0 && started) {
    const elapsed  = (Date.now() - startTime) / 1000 / 60; // minutes
    const paceChars = targetWpm * 5 * elapsed;
    const pct = Math.min(paceChars / currentPassage.length * 100, 100);
    exerciseArea.style.setProperty("--target-pos", pct + "%");
  }

  if (typed.length >= currentPassage.length) finish(typed);
});

function updateLiveStats() {
  if (!started || finished) return;
  const elapsed = (Date.now() - startTime) / 1000;
  const minutes = elapsed / 60;

  // Timer
  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60);
  liveTimer.innerHTML = mins > 0
    ? `${mins}:${String(secs).padStart(2, "0")}<span>min</span>`
    : `${secs}<span>s</span>`;

  // WPM — suppress for first 3 s; show gap to target or ✓ when hit
  if (minutes >= 0.05) {
    const wpm = Math.round((hiddenInput.value.length / 5) / minutes);
    if (targetWpm > 0) {
      const gap = targetWpm - wpm;
      if (gap <= 0) {
        liveWpm.innerHTML = `${wpm}<span>wpm ✓</span>`;
        liveWpm.classList.add("on-target");
      } else {
        liveWpm.innerHTML = `${wpm}<span>wpm</span><span class="wpm-gap">-${gap}</span>`;
        liveWpm.classList.remove("on-target");
      }
    } else {
      liveWpm.innerHTML = `${wpm}<span>wpm</span>`;
      liveWpm.classList.remove("on-target");
    }
  }

  // Accuracy
  const typed = hiddenInput.value;
  if (typed.length > 0) {
    const correct = Array.from(typed).filter((ch, i) => ch === currentPassage[i]).length;
    liveAccuracy.innerHTML = `${Math.round((correct / typed.length) * 100)}<span>acc</span>`;
  }
}

hiddenInput.addEventListener("paste", e => e.preventDefault());

hiddenInput.addEventListener("focus", () => {
  exerciseArea.classList.add("focused");
  clickHint.style.display = "none";
});

hiddenInput.addEventListener("blur", () => {
  exerciseArea.classList.remove("focused");
  if (!started) clickHint.style.display = "block";
});

function focusInput() { hiddenInput.focus(); }

// ── Finish ─────────────────────────────────────────────────────

async function finish(typed) {
  finished = true;
  clearInterval(wpmInterval);

  const elapsed  = (Date.now() - startTime) / 1000;
  const wpm      = Math.round((currentPassage.length / 5) / (elapsed / 60));
  const correct  = Array.from(typed).filter((ch, i) => ch === currentPassage[i]).length;
  const accuracy = Math.round((correct / currentPassage.length) * 100);

  let newBestWpm = false, newBestMistakes = false;
  try {
    const res = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wpm, accuracy,
        topic: currentTopic,
        mistakes: mistakeCount,
        key_errors: sessionKeyErrors,
        date: new Date().toLocaleString("en-NZ", {
          timeZone: "Pacific/Auckland",
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }),
      }),
    });
    const data  = await res.json();
    newBestWpm      = data.new_best_wpm;
    newBestMistakes = data.new_best_mistakes;
  } catch {}

  setTimeout(() => showResults(wpm, accuracy, elapsed, mistakeCount, newBestWpm, newBestMistakes), 400);
}

// ── Results ────────────────────────────────────────────────────

function showResults(wpm, accuracy, elapsed, mistakes, newBestWpm, newBestMistakes) {
  document.getElementById("res-wpm").textContent      = wpm;
  document.getElementById("res-accuracy").textContent = accuracy + "%";
  document.getElementById("res-time").textContent     = Math.round(elapsed) + "s";
  document.getElementById("res-mistakes").textContent = mistakes;
  document.getElementById("res-topic").textContent    = currentTopic;

  const badges = [];
  if (newBestWpm)      badges.push('<span class="best-badge">new WPM best</span>');
  if (newBestMistakes) badges.push('<span class="best-badge best-badge--mistakes">fewest mistakes</span>');
  document.getElementById("res-bests").innerHTML = badges.join("");

  showScreen("results-screen");

  // WPM bounce — animate the inner span so transform doesn't break gradient text
  const wpmEl = document.getElementById("res-wpm");
  wpmEl.classList.remove("wpm-dance");
  void wpmEl.offsetWidth;
  wpmEl.classList.add("wpm-dance");

  // fireworks
  launchFireworks();
}

// ── Progress ───────────────────────────────────────────────────

async function showProgress() {
  showScreen("progress-screen");
  const content = document.getElementById("progress-content");
  content.innerHTML = "<p class='no-results'>loading...</p>";

  try {
    const data = await (await fetch("/api/progress")).json();

    if (!data.length) {
      content.innerHTML = "<p class='no-results'>no sessions yet — finish an exercise to see your progress</p>";
      return;
    }

    content.innerHTML = `
      <table class="progress-table">
        <thead><tr><th>date</th><th>wpm</th><th>accuracy</th><th>mistakes</th><th>topic</th></tr></thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td>${r.date}</td>
              <td class="wpm-cell">${r.wpm}</td>
              <td class="acc-cell">${r.accuracy}%</td>
              <td class="mistakes-cell">${r.mistakes}</td>
              <td>${r.topic}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch {
    content.innerHTML = "<p class='no-results'>failed to load progress</p>";
  }
}

// ── Heatmap ────────────────────────────────────────────────────

const KB_ROWS = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l"],
  ["z","x","c","v","b","n","m",",","."],
  ["space"],
];

async function showHeatmap() {
  showScreen("heatmap-screen");
  const content = document.getElementById("heatmap-content");
  content.innerHTML = "<p class='no-results'>loading...</p>";

  try {
    const errors = await (await fetch("/api/heatmap")).json();
    renderHeatmap(errors, content);
  } catch {
    content.innerHTML = "<p class='no-results'>failed to load heatmap</p>";
  }
}

function renderHeatmap(errors, container) {
  const counts   = Object.values(errors);
  const maxCount = counts.length ? Math.max(...counts) : 0;
  const total    = counts.reduce((a, b) => a + b, 0);

  let html = `<p class="heatmap-total">${
    total
      ? `${total} total errors recorded across all sessions`
      : "no errors recorded yet — complete some exercises first"
  }</p><div class="kb-wrap">`;

  for (const row of KB_ROWS) {
    html += `<div class="kb-row">`;
    for (const key of row) {
      const count     = errors[key] || 0;
      const intensity = maxCount > 0 ? count / maxCount : 0;
      const alpha     = intensity > 0 ? (0.2 + intensity * 0.7).toFixed(2) : 0;
      const borderAlpha = intensity > 0 ? Math.min(alpha * 1.5, 0.8).toFixed(2) : 0;
      const style     = alpha > 0
        ? `background:rgba(244,63,94,${alpha});border-color:rgba(244,63,94,${borderAlpha})`
        : "";
      const badge     = count > 0 ? `<span class="kb-count">${count}</span>` : "";
      html += `<div class="kb-key${key === "space" ? " kb-space" : ""}" style="${style}">${key}${badge}</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

// ── Custom text modal ──────────────────────────────────────────

function showCustomModal() {
  document.getElementById("custom-textarea").value = customText;
  document.getElementById("custom-modal").style.display = "flex";
  document.getElementById("custom-textarea").focus();
}

function hideCustomModal() {
  document.getElementById("custom-modal").style.display = "none";
  // if user cancels before ever providing custom text, fall back to pub
  if (currentSubject === "custom" && !customText) {
    currentSubject = "pub";
    ["btn-pub","btn-crim","btn-all","btn-cases","btn-custom"]
      .forEach(id => setActive(id, id === "btn-pub"));
  }
}

function submitCustomText() {
  const text = document.getElementById("custom-textarea").value.trim();
  if (text.length < 10) return;
  customText     = text;
  rawPassage     = text;
  currentPassage = applyCase(text);
  currentTopic   = "custom text";
  document.getElementById("custom-modal").style.display = "none";
  resetState();
  renderExercise();
  hiddenInput.focus();
}

// ── Navigation ─────────────────────────────────────────────────

function showExercise() { showScreen("exercise-screen"); }

function restartExercise() {
  clearInterval(wpmInterval);
  showScreen("exercise-screen");
  resetState();
  hiddenInput.value = "";
  renderExercise();
  hiddenInput.focus();
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ── Helpers ────────────────────────────────────────────────────

function resetState() {
  clearInterval(wpmInterval);
  startTime        = null;
  started          = false;
  finished         = false;
  mistakeCount     = 0;
  prevTypedLen     = 0;
  sessionKeyErrors = {};
  liveWpm.classList.remove("on-target");
}

function getSpan(i) {
  return textDisplay.querySelector(`[data-i="${i}"]`);
}

function encodeChar(ch) {
  return { '"': "&quot;", "'": "&#39;", "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] ?? ch;
}

// ── Fireworks ──────────────────────────────────────────────────

const fwCanvas = document.getElementById("fireworks-canvas");
const fwCtx    = fwCanvas.getContext("2d");
let   fwParticles = [];
let   fwRaf       = null;

const FW_COLOURS = ["#818cf8","#c084fc","#f9a8d4","#facc15","#34d399","#f43f5e","#60a5fa"];

function launchFireworks() {
  fwCanvas.width  = window.innerWidth;
  fwCanvas.height = window.innerHeight;
  fwParticles = [];

  // 6 bursts scattered across the screen
  const bursts = [
    { x: 0.2, y: 0.25 }, { x: 0.5, y: 0.15 }, { x: 0.8, y: 0.25 },
    { x: 0.3, y: 0.55 }, { x: 0.7, y: 0.5  }, { x: 0.5, y: 0.65 },
  ];

  for (const b of bursts) {
    const cx    = b.x * fwCanvas.width;
    const cy    = b.y * fwCanvas.height;
    const color = FW_COLOURS[Math.floor(Math.random() * FW_COLOURS.length)];
    for (let i = 0; i < 60; i++) {
      const angle = (Math.PI * 2 / 60) * i;
      const speed = 2 + Math.random() * 5;
      fwParticles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        radius: 2 + Math.random() * 2,
        color,
        gravity: 0.08 + Math.random() * 0.04,
        decay: 0.013 + Math.random() * 0.007,
      });
    }
  }

  if (fwRaf) cancelAnimationFrame(fwRaf);
  animateFireworks();
}

function animateFireworks() {
  fwCtx.clearRect(0, 0, fwCanvas.width, fwCanvas.height);

  for (const p of fwParticles) {
    p.x     += p.vx;
    p.y     += p.vy;
    p.vy    += p.gravity;
    p.vx    *= 0.98;
    p.alpha -= p.decay;

    fwCtx.globalAlpha = Math.max(p.alpha, 0);
    fwCtx.beginPath();
    fwCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    fwCtx.fillStyle = p.color;
    fwCtx.fill();
  }

  fwParticles = fwParticles.filter(p => p.alpha > 0);

  if (fwParticles.length) {
    fwRaf = requestAnimationFrame(animateFireworks);
  } else {
    fwCtx.clearRect(0, 0, fwCanvas.width, fwCanvas.height);
  }
}
