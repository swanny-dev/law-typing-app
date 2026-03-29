// ── State ─────────────────────────────────────────────────────

let rawPassage       = "";
let currentPassage   = "";
let currentTopic     = "";
let currentLength    = "short";
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
let blinkTimeout     = null;

// ── Caret ──────────────────────────────────────────────────────

const caret = document.createElement("div");
caret.id = "caret";

function moveCaret(index, instant = false) {
  const span = getSpan(index);
  if (!span) return;
  if (!textDisplay.contains(caret)) textDisplay.appendChild(caret);

  const spanRect      = span.getBoundingClientRect();
  const containerRect = textDisplay.getBoundingClientRect();
  const x = spanRect.left - containerRect.left;
  const y = spanRect.top  - containerRect.top;

  caret.style.height = spanRect.height + "px";

  if (instant) {
    caret.style.transition = "none";
    caret.style.transform  = `translate(${x}px, ${y}px)`;
    caret.offsetHeight; // force reflow
    caret.style.transition = "";
  } else {
    caret.style.transform = `translate(${x}px, ${y}px)`;
  }

  // pause blink while typing, resume after 500 ms idle
  caret.classList.add("typing");
  clearTimeout(blinkTimeout);
  blinkTimeout = setTimeout(() => caret.classList.remove("typing"), 500);
}

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
      const wbr     = ch === " " ? "<wbr>" : "";
      return `<span data-i="${i}" data-char="${encodeChar(ch)}">${display}</span>${wbr}`;
    })
    .join("");

  // place caret instantly at position 0 (no slide animation on fresh render)
  requestAnimationFrame(() => moveCaret(0, true));

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
    span.classList.remove("correct", "incorrect");
    if (i < typed.length) {
      span.classList.add(typed[i] === currentPassage[i] ? "correct" : "incorrect");
    }
  }

  if (typed.length < currentPassage.length) moveCaret(typed.length);

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
  if (caret.parentNode) caret.parentNode.removeChild(caret);

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

// ── Streak ─────────────────────────────────────────────────────

function calcStreak(sessions) {
  // Get unique session days as "YYYY-MM-DD" strings for reliable comparison
  const days = [...new Set(sessions.map(r => {
    // date format: "29 Mar 2026, 14:30" — parse to a normalized date string
    const parts = r.date.split(",")[0].trim().split(" ");
    const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const d = new Date(parts[2], months[parts[1]], parts[0]);
    return d.toDateString();
  }))].map(s => new Date(s)).sort((a, b) => b - a); // newest first

  if (!days.length) return 0;

  // Check if today or yesterday has a session (streak must be recent)
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const newest    = new Date(days[0]); newest.setHours(0,0,0,0);

  if (newest < yesterday) return 0; // streak broken

  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]); prev.setHours(0,0,0,0);
    const curr = new Date(days[i]);     curr.setHours(0,0,0,0);
    const diffDays = Math.round((prev - curr) / 86400000);
    if (diffDays === 1) streak++;
    else break;
  }
  return streak;
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

    content.innerHTML = "";

    // ── Streak ──
    const streak = calcStreak(data);
    if (streak > 0) {
      content.insertAdjacentHTML("beforeend", `
        <div class="streak-bar">
          <span class="streak-count">${streak}</span>
          <span class="streak-label">day streak</span>
        </div>`);
    }

    // ── WPM graph ──
    const canvas = document.createElement("canvas");
    canvas.className = "wpm-graph-canvas";
    content.appendChild(canvas);
    renderWpmGraph(canvas, data);

    // ── Session table ──
    content.insertAdjacentHTML("beforeend", `
      <table class="progress-table">
        <thead><tr><th>date</th><th>wpm</th><th>accuracy</th><th>mistakes</th><th>topic</th><th></th></tr></thead>
        <tbody>
          ${data.map(r => `
            <tr data-id="${r.id}">
              <td>${r.date}</td>
              <td class="wpm-cell"><span>${r.wpm}</span></td>
              <td class="acc-cell">${r.accuracy}%</td>
              <td class="mistakes-cell">${r.mistakes}</td>
              <td>${r.topic}</td>
              <td class="delete-cell"><button class="delete-row-btn" onclick="deleteSession(${r.id})">×</button></td>
            </tr>`).join("")}
        </tbody>
      </table>`);
  } catch {
    content.innerHTML = "<p class='no-results'>failed to load progress</p>";
  }
}

function renderWpmGraph(canvas, data) {
  const dayMap = new Map();
  for (let i = data.length - 1; i >= 0; i--) {
    const key = data[i].date.split(",")[0].trim();
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key).push(data[i].wpm);
  }

  const labels  = [...dayMap.keys()];
  const avgWpms = labels.map(d => {
    const vals = dayMap.get(d);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });
  const maxWpms = labels.map(d => Math.max(...dayMap.get(d)));
  const n       = labels.length;

  const W = canvas.parentElement.clientWidth || 780;
  const H = 220;
  canvas.width  = W;
  canvas.height = H;

  const pad   = { top: 28, right: 20, bottom: 44, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top  - pad.bottom;
  const ctx   = canvas.getContext("2d");

  const allVals = [...avgWpms, ...maxWpms];
  const yMin    = Math.max(0, Math.floor(Math.min(...allVals) / 10) * 10 - 10);
  const yMax    = Math.ceil(Math.max(...allVals) / 10) * 10 + 10;

  const toX = i => n < 2 ? pad.left + plotW / 2 : pad.left + (i / (n - 1)) * plotW;
  const toY = v => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Gridlines + Y labels
  ctx.font         = "11px 'JetBrains Mono', monospace";
  ctx.textAlign    = "right";
  ctx.textBaseline = "middle";
  for (let g = 0; g <= 4; g++) {
    const v = yMin + (yMax - yMin) * (g / 4);
    const y = toY(v);
    ctx.strokeStyle = "rgba(31,31,44,0.9)";
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#7070a0";
    ctx.fillText(Math.round(v), pad.left - 6, y);
  }

  // X-axis date labels
  const step = Math.max(1, Math.ceil((n * 50) / plotW));
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle    = "#7070a0";
  for (let i = 0; i < n; i += step) {
    const short = labels[i].split(" ").slice(0, 2).join(" ");
    ctx.fillText(short, toX(i), H - pad.bottom + 8);
  }

  // Filled area under avg line
  if (n >= 2) {
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(avgWpms[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(avgWpms[i]));
    ctx.lineTo(toX(n - 1), toY(yMin));
    ctx.lineTo(toX(0), toY(yMin));
    ctx.closePath();
    ctx.fillStyle = "rgba(129,140,248,0.08)";
    ctx.fill();
  }

  function drawLine(values, color) {
    if (n >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.lineJoin    = "round";
      ctx.lineCap     = "round";
      ctx.moveTo(toX(0), toY(values[0]));
      for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(values[i]));
      ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.arc(toX(i), toY(values[i]), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.beginPath(); ctx.arc(toX(i), toY(values[i]), 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "#e8e8ff"; ctx.fill();
    }
  }

  drawLine(avgWpms, "#818cf8");
  drawLine(maxWpms, "#c084fc");

  // Legend
  const items = [["#c084fc", "peak wpm"], ["#818cf8", "avg wpm"]];
  ctx.font         = "10px 'JetBrains Mono', monospace";
  ctx.textAlign    = "right";
  ctx.textBaseline = "middle";
  items.forEach(([col, label], j) => {
    const lx = W - pad.right - 4;
    const ly = pad.top + 6 + j * 16;
    ctx.fillStyle = col;
    ctx.fillRect(lx - ctx.measureText(label).width - 14, ly - 4, 8, 8);
    ctx.fillStyle = "#7070a0";
    ctx.fillText(label, lx, ly);
  });
}

async function deleteSession(id) {
  try {
    await fetch(`/api/progress/${id}`, { method: "DELETE" });
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) row.remove();
  } catch {}
}

// ── Improvement tips ───────────────────────────────────────────

const KEY_WORDS = {
  e: ["evidence","procedure","decree"],       r: ["requirements","procedural","ratio"],
  t: ["statute","tort","constitution"],        a: ["affidavit","plaintiff","mandamus"],
  i: ["injunction","jurisdiction","judicial"], o: ["obligation","prosecution","court"],
  n: ["consideration","defendant","injunction"],s: ["statute","submissions","standing"],
  c: ["constitution","contract","conviction"], l: ["legislation","legal","liability"],
  d: ["defendant","doctrine","disclosure"],    m: ["mandamus","mens rea","magistrate"],
  p: ["plaintiff","prosecution","procedure"],  u: ["unreasonableness","ultra vires","unlawful"],
  f: ["fairness","findings","fundamental"],    g: ["grounds","grievance","guilt"],
  h: ["habeas corpus","hearing","hierarchy"],  j: ["judgment","jurisdiction","justiciable"],
  k: ["knowledge","knowing","key"],            b: ["burden","breach","beyond reasonable doubt"],
  v: ["verdict","vires","voluntary"],          w: ["warrant","wrongful","witness"],
  x: ["express","exception","exclusion"],      y: ["yield","yet","yardstick"],
  z: ["zero","zone","zealous"],
  ",": ["statutory lists","clauses","enumerations"],
  ".": ["ratio decidendi","full stops","sentence endings"],
};

function generateImprovementTips(errors) {
  const entries = Object.entries(errors).sort((a, b) => b[1] - a[1]).filter(([, c]) => c > 0);
  if (!entries.length) return null;

  const topKeys = entries.slice(0, 5).map(([k]) => k);
  const top2    = topKeys.slice(0, 2);
  const vowels  = topKeys.filter(k => "aeiou".includes(k));
  const hasSpace = topKeys.includes("space");
  const punct   = topKeys.filter(k => [",", "."].includes(k));
  const tips    = [];

  // Tip 1: vowels
  if (vowels.length >= 1) {
    const vList = vowels.map(v => `'${v}'`).join(" and ");
    const words = vowels.flatMap(v => (KEY_WORDS[v] || []).slice(0, 2));
    tips.push(`It is submitted that the preponderance of your procedural errors arise on vowel keys — specifically ${vList}. These characters are foundational to legal terminology such as <strong>'${words[0]}'</strong> and <strong>'${words[1] || words[0]}'</strong>. Targeted remediation of vowel precision is hereby warranted.`);
  }

  // Tip 2: top 2 specific keys
  const nonVowelTop = top2.filter(k => !"aeiou".includes(k) && k !== "space" && k !== "," && k !== ".");
  const keyTipKeys  = nonVowelTop.length ? nonVowelTop : top2.filter(k => k !== "space");
  if (keyTipKeys.length >= 1) {
    const kList = keyTipKeys.slice(0, 2).map(k => `'${k}'`).join(" and ");
    const words = keyTipKeys.flatMap(k => (KEY_WORDS[k] || []).slice(0, 2)).slice(0, 2);
    const wordStr = words.length >= 2
      ? `<strong>'${words[0]}'</strong> and <strong>'${words[1]}'</strong>`
      : `<strong>'${words[0] || keyTipKeys[0]}'</strong>`;
    tips.push(`The record discloses that ${kList} constitute your most frequent sources of inaccuracy. Words of legal significance — including ${wordStr} — rely upon these keys. Counsel would be well-advised to drill these characters in isolation before proceeding to full-passage exercises.`);
  }

  // Tip 3: space
  if (hasSpace && tips.length < 3) {
    tips.push(`It is further noted that the spacebar appears among your error keys, suggesting premature or delayed word boundaries are contributing to your overall inaccuracy. Deliberate attention to inter-word spacing constitutes a sound remedial measure.`);
  }

  // Tip 4: punctuation
  if (punct.length >= 1 && tips.length < 3) {
    const pList = punct.map(p => `'${p}'`).join(" and ");
    tips.push(`The commission of errors on punctuation keys (${pList}) warrants particular attention; in formal legal drafting, errant punctuation may materially alter the construction of a clause or the ratio of an argument.`);
  }

  // Fallback
  if (tips.length < 2) {
    const t3 = topKeys.slice(0, 3).map(k => `'${k}'`).join(", ");
    tips.push(`On the balance of the evidence, a daily drilling regimen of five minutes on your top error characters — <strong>${t3}</strong> — is submitted as the most efficacious path toward achieving the precision befitting legal practice.`);
  }

  return tips.slice(0, 3);
}

function renderImprovementTips(errors, container) {
  const tips = generateImprovementTips(errors);
  if (!tips) return;
  const html = `
    <div class="improvements-wrap">
      <p class="improvements-heading">remediation counsel</p>
      ${tips.map(t => `
        <div class="tip-item">
          <span class="tip-marker">◆</span>
          <p class="tip-text">${t}</p>
        </div>`).join("")}
    </div>`;
  container.insertAdjacentHTML("beforeend", html);
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
  renderImprovementTips(errors, container);

  // ── Mistake Counsel ──
  const topKeys = Object.entries(errors)
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c > 0)
    .slice(0, 5)
    .map(([k]) => k);

  if (topKeys.length) {
    container.insertAdjacentHTML("beforeend", `
      <div class="counsel-wrap">
        <p class="improvements-heading">mistake counsel</p>
        <p class="counsel-desc">Generate a targeted exercise that drills the key pairs and characters you make the most errors on.</p>
        <div class="counsel-keys">
          ${topKeys.map(k => `<span class="counsel-key">${k}</span>`).join("")}
        </div>
        <button class="btn-action counsel-btn" onclick="loadCounselExercise(${JSON.stringify(topKeys)})">generate exercise</button>
        <div id="counsel-result"></div>
      </div>`);
  }
}

async function loadCounselExercise(keys) {
  const btn    = document.querySelector(".counsel-btn");
  const result = document.getElementById("counsel-result");
  btn.disabled    = true;
  btn.textContent = "generating...";
  result.innerHTML = "";

  try {
    const res  = await fetch(`/api/exercise/counsel?keys=${encodeURIComponent(keys.join(","))}`);
    const data = await res.json();

    result.innerHTML = `
      <div class="counsel-exercise">
        <p class="counsel-exercise-text">${data.text}</p>
        <button class="btn-ghost-sm" onclick="useCounselExercise(${JSON.stringify(data.text)})">type this exercise</button>
      </div>`;
  } catch {
    result.innerHTML = "<p class='counsel-error'>failed to generate — try again</p>";
  } finally {
    btn.disabled    = false;
    btn.textContent = "generate exercise";
  }
}

function useCounselExercise(text) {
  customText     = text;
  rawPassage     = text;
  currentPassage = applyCase(text);
  currentTopic   = "mistake counsel";
  currentSubject = "custom";
  ["btn-pub","btn-crim","btn-all","btn-cases","btn-custom","btn-docs"]
    .forEach(id => setActive(id, id === "btn-custom"));
  showScreen("exercise-screen");
  resetState();
  renderExercise();
  hiddenInput.focus();
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
