// app.js (FULL, FIXED + DONE/SAVE MODAL)
//
// ✅ Done button opens Save modal
// ✅ Save will write the FINAL edited image to the location you type
//    - final = committed working image + committed params applied via /process
//    - then POST to /save { image, path }
//
// IMPORTANT: Your backend must implement:
//   POST http://127.0.0.1:8000/save
//   body: { image: "<dataURL>", path: "output/name.png" }
// and return { ok: true } (or any JSON; we just check res.ok)

let processTimer = null;
let controller = null; // AbortController for /process

let uiLocked = false;
let lockMessage = "";

let removeBgController = null;
let removeBgBusy = false;
let removeBgPreviewImage = null;

const undoStack = [];
const redoStack = [];

let paramsCommitted = null;
let paramsDraft = null;

let tabs = null;
let panels = null;

// Crop state
let cropState = {
  enabled: false,
  x: 0.15,
  y: 0.15,
  w: 0.7,
  h: 0.7,
  aspect: null,
  dragging: false,
  handle: null,
  start: null,
};

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function setLocked(on, msg = "") {
  uiLocked = on;
  lockMessage = msg || "";
}
function blockIfLocked() {
  if (!uiLocked) return false;
  alert(lockMessage || "Please wait until the current operation finishes.");
  return true;
}

/* ---------------------------
   Preset button helper (GLOBAL)
--------------------------- */
function setActivePresetBtn(presetName) {
  document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("is-active"));
  document.querySelector(`.preset-btn[data-preset="${presetName}"]`)?.classList.add("is-active");
}

/* ---------------------------
   Deep compare helper
--------------------------- */
function stableStringify(obj) {
  const keys = Object.keys(obj || {}).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}
function paramsEqual(a, b) {
  return stableStringify(a || {}) === stableStringify(b || {});
}

/* ---------------------------
   Undo/Redo
--------------------------- */
function snapshotState() {
  return {
    tab: sessionStorage.getItem("valo_active_tab") || "adjust",
    working: sessionStorage.getItem("valo_working_image"),
    paramsCommitted: JSON.parse(sessionStorage.getItem("valo_params_committed") || "{}"),
  };
}

function pushUndoSnapshot() {
  undoStack.push(snapshotState());
  redoStack.length = 0;
  updateUndoRedoUI();
}

function applySnapshot(snap) {
  sessionStorage.setItem("valo_working_image", snap.working);
  sessionStorage.setItem("valo_params_committed", JSON.stringify(snap.paramsCommitted));
  sessionStorage.setItem("valo_params_draft", JSON.stringify(snap.paramsCommitted));

  paramsCommitted = { ...snap.paramsCommitted };
  paramsDraft = { ...snap.paramsCommitted };

  syncControlsFromParams(paramsDraft);
  openTab(snap.tab, { silent: true });

  requestProcess();
  updateApplyButtonState();
  updateUndoRedoUI();
}

function updateUndoRedoUI() {
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

/* ---------------------------
   Apply button state
--------------------------- */
function updateApplyButtonState() {
  const applyBtn = document.getElementById("applyBtn");
  if (!applyBtn) return;

  const tab = sessionStorage.getItem("valo_active_tab") || "adjust";

  if (removeBgBusy) {
    applyBtn.disabled = true;
    return;
  }

  if (tab === "removebg") {
    applyBtn.disabled = !removeBgPreviewImage;
    return;
  }

  if (tab === "crop") {
    applyBtn.disabled = false;
    return;
  }

  applyBtn.disabled = paramsEqual(paramsDraft, paramsCommitted);
}

/* ---------------------------
   Debounced processing (/process) — preview only (uses DRAFT)
--------------------------- */
function requestProcess() {
  clearTimeout(processTimer);
  processTimer = setTimeout(processImageOnBackend, 150);
}

async function processImageOnBackend() {
  if (controller) controller.abort();
  controller = new AbortController();

  try {
    const imageWorking = sessionStorage.getItem("valo_working_image");
    const draft = JSON.parse(sessionStorage.getItem("valo_params_draft") || "{}");

    const res = await fetch("http://127.0.0.1:8000/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageWorking,
        params: {
          brightness: Number(draft.brightness || 0),
          sharpness: Number(draft.sharpness || 0),
          denoise: Number(draft.denoise || 0),
          red: Number(draft.red || 0),
          green: Number(draft.green || 0),
          blue: Number(draft.blue || 0),
          mono: Boolean(draft.mono),
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return;
    const data = await res.json();

    // don't override remove-bg preview while running
    if (removeBgBusy) return;

    const mainImage = document.getElementById("mainImage");
    if (mainImage) mainImage.src = data.image;
  } catch (err) {
    if (err?.name !== "AbortError") console.error(err);
  }
}

/* ---------------------------
   Remove Background (Start/Cancel + Apply via global ✓)
--------------------------- */
function setRemoveBgUI(state) {
  const status = document.getElementById("removeStatus");
  const startBtn = document.getElementById("removeStartBtn");
  const cancelBtn = document.getElementById("removeCancelBtn");

  if (status) {
    if (state === "ready") status.textContent = "Ready";
    if (state === "removing") status.textContent = "Removing...";
    if (state === "done") status.textContent = "Preview ready ✓ (press ✓ to apply)";
    if (state === "failed") status.textContent = "Failed";
    if (state === "cancelled") status.textContent = "Cancelled";
  }

  if (startBtn) startBtn.disabled = state === "removing";
  if (cancelBtn) cancelBtn.disabled = state !== "removing";

  updateApplyButtonState();
}

async function startRemoveBg() {
  if (removeBgBusy) return;
  if (blockIfLocked()) return;

  removeBgBusy = true;
  setLocked(true, "Remove Background is still processing. Please wait...");
  removeBgPreviewImage = null;
  setRemoveBgUI("removing");
  updateApplyButtonState();

  if (removeBgController) removeBgController.abort();
  removeBgController = new AbortController();

  try {
    const imageWorking = sessionStorage.getItem("valo_working_image");

    const res = await fetch("http://127.0.0.1:8000/remove-bg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageWorking, params: {} }),
      signal: removeBgController.signal,
    });

    if (!res.ok) throw new Error("Remove BG failed");
    const data = await res.json();

    removeBgPreviewImage = data.image;

    const mainImage = document.getElementById("mainImage");
    if (mainImage) mainImage.src = removeBgPreviewImage;

    setRemoveBgUI("done");
  } catch (err) {
    if (err?.name === "AbortError") setRemoveBgUI("cancelled");
    else {
      console.error(err);
      setRemoveBgUI("failed");
    }
  } finally {
    removeBgBusy = false;
    setLocked(false, "");
    updateApplyButtonState();
  }
}

function cancelRemoveBg() {
  if (!removeBgBusy) return;
  removeBgController?.abort();
}

/* ---------------------------
   Crop UI
--------------------------- */
function setCropUIVisible(show) {
  const overlay = document.getElementById("cropOverlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !show);
  overlay.setAttribute("aria-hidden", show ? "false" : "true");
  if (show) renderCrop();
}

function renderCrop() {
  const wrap = document.getElementById("imgWrap");
  const box = document.getElementById("cropBox");
  const overlay = document.getElementById("cropOverlay");
  if (!wrap || !box || !overlay) return;

  const W = wrap.clientWidth;
  const H = wrap.clientHeight;

  const x = cropState.x * W;
  const y = cropState.y * H;
  const w = cropState.w * W;
  const h = cropState.h * H;

  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;

  overlay.querySelector(".shade-top").style.cssText = `left:0;top:0;width:${W}px;height:${y}px;`;
  overlay.querySelector(".shade-left").style.cssText = `left:0;top:${y}px;width:${x}px;height:${h}px;`;
  overlay.querySelector(".shade-right").style.cssText = `left:${x + w}px;top:${y}px;width:${W - (x + w)}px;height:${h}px;`;
  overlay.querySelector(".shade-bottom").style.cssText = `left:0;top:${y + h}px;width:${W}px;height:${H - (y + h)}px;`;
}

function markCropCustomIfNeeded(isCustom) {
  const buttons = Array.from(document.querySelectorAll(".crop-btn:not(.preset-btn)"));
  const customBtn = buttons.find((b) => b.textContent.trim().toLowerCase() === "custom");
  if (!customBtn) return;

  if (isCustom) {
    buttons.forEach((b) => b.classList.remove("is-active"));
    customBtn.classList.add("is-active");
  }
}

function setCropFromCenterAspect(aspect) {
  const wrap = document.getElementById("imgWrap");
  if (!wrap) return;

  const W = wrap.clientWidth;
  const H = wrap.clientHeight;

  let w = 0.8, h = 0.8;

  if (aspect) {
    let pxW = 0.8 * W;
    let pxH = pxW / aspect;
    if (pxH > 0.8 * H) {
      pxH = 0.8 * H;
      pxW = pxH * aspect;
    }
    w = pxW / W;
    h = pxH / H;
  }

  cropState.aspect = aspect;
  cropState.w = w;
  cropState.h = h;
  cropState.x = (1 - w) / 2;
  cropState.y = (1 - h) / 2;

  renderCrop();
}

function initCropInteractions() {
  const wrap = document.getElementById("imgWrap");
  const box = document.getElementById("cropBox");
  if (!wrap || !box) return;

  function pointerPos(e) {
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, W: r.width, H: r.height };
  }

  function startDrag(e, handle = "move") {
    e.preventDefault();
    const p = pointerPos(e);

    cropState.dragging = true;
    cropState.handle = handle;
    cropState.start = {
      px: p.x, py: p.y, W: p.W, H: p.H,
      x: cropState.x, y: cropState.y, w: cropState.w, h: cropState.h,
    };

    markCropCustomIfNeeded(true);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag, { once: true });
  }

  function onMove(e) {
    if (!cropState.dragging) return;
    const p = pointerPos(e);

    const dx = (p.x - cropState.start.px) / cropState.start.W;
    const dy = (p.y - cropState.start.py) / cropState.start.H;

    let { x, y, w, h } = cropState.start;
    const aspect = cropState.aspect;
    const handle = cropState.handle;

    if (handle === "move") {
      x = clamp01(x + dx);
      y = clamp01(y + dy);
      x = Math.min(x, 1 - w);
      y = Math.min(y, 1 - h);
    } else {
      const minSize = 0.05;

      const left = x;
      const right = x + w;
      const top = y;
      const bottom = y + h;

      let nl = left, nr = right, nt = top, nb = bottom;

      if (handle.includes("w")) nl = left + dx;
      if (handle.includes("e")) nr = right + dx;
      if (handle.includes("n")) nt = top + dy;
      if (handle.includes("s")) nb = bottom + dy;

      nl = clamp01(nl); nt = clamp01(nt); nr = clamp01(nr); nb = clamp01(nb);

      if (nr - nl < minSize) {
        if (handle.includes("w")) nl = nr - minSize;
        else nr = nl + minSize;
      }
      if (nb - nt < minSize) {
        if (handle.includes("n")) nt = nb - minSize;
        else nb = nt + minSize;
      }

      if (aspect) {
        const newW = nr - nl;
        const newH = nb - nt;

        if (handle === "n" || handle === "s") {
          const targetW = newH * aspect;
          const cx = (nl + nr) / 2;
          nl = cx - targetW / 2;
          nr = cx + targetW / 2;
        } else {
          const targetH = newW / aspect;
          const cy = (nt + nb) / 2;
          nt = cy - targetH / 2;
          nb = cy + targetH / 2;
        }

        nl = clamp01(nl); nt = clamp01(nt); nr = clamp01(nr); nb = clamp01(nb);
        if (nr > 1) { const d = nr - 1; nr -= d; nl -= d; }
        if (nb > 1) { const d = nb - 1; nb -= d; nt -= d; }
        if (nl < 0) { const d = -nl; nl += d; nr += d; }
        if (nt < 0) { const d = -nt; nt += d; nb += d; }
      }

      x = nl; y = nt; w = nr - nl; h = nb - nt;
    }

    cropState.x = x;
    cropState.y = y;
    cropState.w = w;
    cropState.h = h;

    renderCrop();
  }

  function endDrag() {
    cropState.dragging = false;
    cropState.handle = null;
    cropState.start = null;
    window.removeEventListener("pointermove", onMove);
  }

  box.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("handle")) return;
    startDrag(e, "move");
  });

  box.querySelectorAll(".handle").forEach((h) => {
    h.addEventListener("pointerdown", (e) => {
      startDrag(e, e.currentTarget.dataset.handle);
    });
  });

  window.addEventListener("resize", renderCrop);
  document.getElementById("mainImage")?.addEventListener("load", renderCrop);
}

/* ---------------------------
   Commit Crop (called by global ✓ when tab=crop)
--------------------------- */
async function commitCrop() {
  if (blockIfLocked()) return;

  try {
    const imageWorking = sessionStorage.getItem("valo_working_image");

    const res = await fetch("http://127.0.0.1:8000/crop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageWorking,
        params: {
          crop: { enabled: true, x: cropState.x, y: cropState.y, w: cropState.w, h: cropState.h },
        },
      }),
    });

    if (!res.ok) throw new Error("Crop failed");
    const data = await res.json();

    pushUndoSnapshot();
    sessionStorage.setItem("valo_working_image", data.image);

    cropState.x = 0; cropState.y = 0; cropState.w = 1; cropState.h = 1; cropState.aspect = null;
    renderCrop();

    requestProcess();
  } catch (err) {
    console.error(err);
  }
}

/* ---------------------------
   Apply (global ✓)
--------------------------- */
function applyCurrentMode() {
  if (blockIfLocked()) return;

  const tab = sessionStorage.getItem("valo_active_tab") || "adjust";

  if (tab === "removebg") {
    if (!removeBgPreviewImage) return;

    pushUndoSnapshot();
    sessionStorage.setItem("valo_working_image", removeBgPreviewImage);

    removeBgPreviewImage = null;
    setRemoveBgUI("ready");

    requestProcess();
    updateApplyButtonState();
    return;
  }

  if (tab === "crop") {
    commitCrop();
    return;
  }

  if (paramsEqual(paramsDraft, paramsCommitted)) return;

  pushUndoSnapshot();

  paramsCommitted = { ...paramsDraft };
  sessionStorage.setItem("valo_params_committed", JSON.stringify(paramsCommitted));
  sessionStorage.setItem("valo_params_draft", JSON.stringify(paramsDraft));

  requestProcess();
  updateApplyButtonState();
}

/* ---------------------------
   Controls sync
--------------------------- */
function syncControlsFromParams(p) {
  const set = (rangeId, inputId, value) => {
    const r = document.getElementById(rangeId);
    const i = document.getElementById(inputId);
    if (r) r.value = String(value ?? 0);
    if (i) i.value = String(value ?? 0);
  };

  set("brightness", "brightnessInput", p.brightness);
  set("sharpness", "sharpnessInput", p.sharpness);
  set("denoise", "denoiseInput", p.denoise);

  set("red", "redInput", p.red);
  set("green", "greenInput", p.green);
  set("blue", "blueInput", p.blue);

  setActivePresetBtn(p.filterPreset || "none");
}

/* ---------------------------
   Tabs
--------------------------- */
function openTab(name, opts = {}) {
  const silent = !!opts.silent;

  if (!silent && uiLocked) {
    alert(lockMessage || "Please wait until the current operation finishes.");
    return;
  }

  tabs.forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });

  panels.forEach((p) => {
    const open = p.dataset.panel === name;
    p.classList.toggle("is-open", open);
  });

  sessionStorage.setItem("valo_active_tab", name);

  setCropUIVisible(name === "crop");

  if (name !== "removebg") {
    removeBgPreviewImage = null;
    setRemoveBgUI("ready");
  }

  updateApplyButtonState();
}

/* ---------------------------
   DONE / SAVE MODAL
--------------------------- */
  function openSaveModal() {
    const modal = document.getElementById("saveModal");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    const input = document.getElementById("fileLocation");
    if (input) {
      const v = (input.value || "").trim();
      // ✅ default path shown to user
      if (!v) input.value = "download/image_01.png";
      input.focus();
    }
  }


function closeSaveModal() {
  const modal = document.getElementById("saveModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function setSaveBusy(isBusy) {
  const saveBtn = document.getElementById("saveBtn");
  const closeBtn = document.getElementById("closeSaveBtn");
  const doneBtn = document.getElementById("doneBtn");
  const input = document.getElementById("fileLocation");

  if (saveBtn) saveBtn.disabled = isBusy;
  if (closeBtn) closeBtn.disabled = isBusy;
  if (doneBtn) doneBtn.disabled = isBusy;
  if (input) input.disabled = isBusy;
}

async function buildFinalImageDataURL() {
  // final = committed working + committed params
  const imageWorking = sessionStorage.getItem("valo_working_image");
  const committed = JSON.parse(sessionStorage.getItem("valo_params_committed") || "{}");

  const res = await fetch("http://127.0.0.1:8000/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: imageWorking,
      params: {
        brightness: Number(committed.brightness || 0),
        sharpness: Number(committed.sharpness || 0),
        denoise: Number(committed.denoise || 0),
        red: Number(committed.red || 0),
        green: Number(committed.green || 0),
        blue: Number(committed.blue || 0),
        mono: Boolean(committed.mono),
      },
    }),
  });

  if (!res.ok) throw new Error("Failed to build final image");
  const data = await res.json();
  return data.image; // dataURL
}

async function saveFinalImage(path) {
  const finalImage = await buildFinalImageDataURL();

  const res = await fetch("http://127.0.0.1:8000/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: finalImage,
      path,
    }),
  });

  if (!res.ok) throw new Error("Save failed");
  return true;
}

/* ---------------------------
   DOM Ready
--------------------------- */
window.addEventListener("DOMContentLoaded", () => {
  const mainImage = document.getElementById("mainImage");
  const selectedImageDataUrl = sessionStorage.getItem("valo_selected_image");

  if (!selectedImageDataUrl) {
    alert("No image selected. Redirecting to home page.");
    window.location.href = "home.html";
    return;
  }

  // base images
  if (!sessionStorage.getItem("valo_source_image")) {
    sessionStorage.setItem("valo_source_image", selectedImageDataUrl);
  }
  if (!sessionStorage.getItem("valo_working_image")) {
    sessionStorage.setItem("valo_working_image", selectedImageDataUrl);
  }
  if (mainImage) mainImage.src = sessionStorage.getItem("valo_working_image");

  // tabs
  tabs = document.querySelectorAll(".tab");
  panels = document.querySelectorAll(".tab-panel");
  tabs.forEach((tab) => tab.addEventListener("click", () => openTab(tab.dataset.tab)));

  // params
  const defaultParams = {
    brightness: 0,
    sharpness: 0,
    denoise: 0,
    red: 0,
    green: 0,
    blue: 0,
    mono: false,
    filterPreset: "none",
  };

  // committed
  try {
    const storedCommitted = JSON.parse(sessionStorage.getItem("valo_params_committed") || "null");
    paramsCommitted = storedCommitted && typeof storedCommitted === "object"
      ? { ...defaultParams, ...storedCommitted }
      : { ...defaultParams };
  } catch {
    paramsCommitted = { ...defaultParams };
  }
  sessionStorage.setItem("valo_params_committed", JSON.stringify(paramsCommitted));

  // draft
  try {
    const storedDraft = JSON.parse(sessionStorage.getItem("valo_params_draft") || "null");
    paramsDraft = storedDraft && typeof storedDraft === "object"
      ? { ...defaultParams, ...storedDraft }
      : { ...paramsCommitted };
  } catch {
    paramsDraft = { ...paramsCommitted };
  }
  sessionStorage.setItem("valo_params_draft", JSON.stringify(paramsDraft));

  // init UI
  syncControlsFromParams(paramsDraft);

  function setDraftParam(key, value) {
    paramsDraft[key] = value;
    sessionStorage.setItem("valo_params_draft", JSON.stringify(paramsDraft));
    updateApplyButtonState();
  }

  // sliders => draft + preview
  function bindRange(rangeId, inputId, key) {
    const range = document.getElementById(rangeId);
    const input = document.getElementById(inputId);
    if (!range || !input) return;

    const initial = Number(paramsDraft[key] ?? range.value ?? 0);
    range.value = String(initial);
    input.value = String(initial);

    range.addEventListener("input", () => {
      input.value = range.value;
      setDraftParam(key, Number(range.value));
      requestProcess();
    });

    input.addEventListener("input", () => {
      let v = Number(input.value);
      if (!Number.isFinite(v)) v = 0;
      v = clamp(v, Number(range.min), Number(range.max));
      range.value = String(v);
      input.value = String(v);
      setDraftParam(key, v);
      requestProcess();
    });
  }

  function bindReset(resetId, rangeId, inputId, key, defaultValue = 0) {
    const btn = document.getElementById(resetId);
    const range = document.getElementById(rangeId);
    const input = document.getElementById(inputId);
    if (!btn || !range) return;

    btn.addEventListener("click", () => {
      range.value = String(defaultValue);
      if (input) input.value = String(defaultValue);
      setDraftParam(key, defaultValue);
      requestProcess();
    });
  }

  // adjust
  bindRange("brightness", "brightnessInput", "brightness");
  bindRange("sharpness", "sharpnessInput", "sharpness");
  bindRange("denoise", "denoiseInput", "denoise");

  bindReset("brightnessReset", "brightness", "brightnessInput", "brightness", 0);
  bindReset("sharpnessReset", "sharpness", "sharpnessInput", "sharpness", 0);
  bindReset("denoiseReset", "denoise", "denoiseInput", "denoise", 0);

  // filter
  bindRange("red", "redInput", "red");
  bindRange("green", "greenInput", "green");
  bindRange("blue", "blueInput", "blue");

  bindReset("redReset", "red", "redInput", "red", 0);
  bindReset("greenReset", "green", "greenInput", "green", 0);
  bindReset("blueReset", "blue", "blueInput", "blue", 0);

  // presets => draft + preview
  const PRESET_BASE = { mono:false, brightness:0, sharpness:0, denoise:0, red:0, green:0, blue:0 };
  const FILTER_PRESETS = {
    "none": { mono: false },
    "mono": { mono: true },
    "dramatic-warm": { mono: false, red: 25, green: 5, blue: -15, sharpness: 20 },
    "noir": { mono: true, sharpness: 35, brightness: -5 },
    "dramatic-cool": { mono: false, red: -10, green: 5, blue: 25 },
  };

  function applyFilterPresetDraft(presetName) {
    const p = { ...PRESET_BASE, ...(FILTER_PRESETS[presetName] || FILTER_PRESETS["none"]) };

    paramsDraft.brightness = p.brightness ?? 0;
    paramsDraft.sharpness = p.sharpness ?? 0;
    paramsDraft.denoise = p.denoise ?? 0;
    paramsDraft.red = p.red ?? 0;
    paramsDraft.green = p.green ?? 0;
    paramsDraft.blue = p.blue ?? 0;
    paramsDraft.mono = !!p.mono;
    paramsDraft.filterPreset = presetName;

    sessionStorage.setItem("valo_params_draft", JSON.stringify(paramsDraft));
    syncControlsFromParams(paramsDraft);
    updateApplyButtonState();
    requestProcess();
  }

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyFilterPresetDraft(btn.dataset.preset));
  });

  // crop ratios
  const RATIO_MAP = {
    "Original": null,
    "Custom": null,
    "Square": 1,
    "9:16": 9 / 16,
    "4:5": 4 / 5,
    "5:7": 5 / 7,
    "3:4": 3 / 4,
    "3:5": 3 / 5,
    "2:3": 2 / 3,
  };

  document.querySelectorAll(".crop-btn:not(.preset-btn)").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".crop-btn:not(.preset-btn)").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");

      const label = btn.textContent.trim();

      if (label === "Original") {
        cropState.x = 0; cropState.y = 0; cropState.w = 1; cropState.h = 1; cropState.aspect = null;
        renderCrop();
        return;
      }
      if (label === "Custom") {
        cropState.aspect = null;
        renderCrop();
        return;
      }
      setCropFromCenterAspect(RATIO_MAP[label] ?? null);
    });
  });

  initCropInteractions();

  // removebg buttons
  setRemoveBgUI("ready");
  document.getElementById("removeStartBtn")?.addEventListener("click", startRemoveBg);
  document.getElementById("removeCancelBtn")?.addEventListener("click", cancelRemoveBg);

  // global apply ✓
  document.getElementById("applyBtn")?.addEventListener("click", applyCurrentMode);

  // undo/redo
  updateUndoRedoUI();
  document.getElementById("undoBtn")?.addEventListener("click", () => {
    if (blockIfLocked()) return;
    if (undoStack.length === 0) return;

    redoStack.push(snapshotState());
    const prev = undoStack.pop();
    applySnapshot(prev);
  });

  document.getElementById("redoBtn")?.addEventListener("click", () => {
    if (blockIfLocked()) return;
    if (redoStack.length === 0) return;

    undoStack.push(snapshotState());
    const next = redoStack.pop();
    applySnapshot(next);
  });

  // cancel (exit)
  document.getElementById("cancelBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("valo_selected_image");
    sessionStorage.removeItem("valo_source_image");
    sessionStorage.removeItem("valo_working_image");
    sessionStorage.removeItem("valo_params_committed");
    sessionStorage.removeItem("valo_params_draft");

    controller?.abort();
    removeBgController?.abort();

    window.location.href = "home.html";
  });

  // initial tab
  openTab("adjust");

  // initial preview if needed
  const needsProcess =
    Boolean(paramsDraft.mono) ||
    Number(paramsDraft.brightness) !== 0 ||
    Number(paramsDraft.sharpness) !== 0 ||
    Number(paramsDraft.denoise) !== 0 ||
    Number(paramsDraft.red) !== 0 ||
    Number(paramsDraft.green) !== 0 ||
    Number(paramsDraft.blue) !== 0;

  updateApplyButtonState();
  if (needsProcess) requestProcess();

  /* ---------------------------
     DONE button -> open modal
  --------------------------- */
  document.getElementById("doneBtn")?.addEventListener("click", () => {
    if (blockIfLocked()) return;

    // If user has uncommitted draft changes, warn (optional but helpful)
    if (!paramsEqual(paramsDraft, paramsCommitted)) {
      const ok = confirm("You have changes not applied (✓). Save will use only applied changes. Continue?");
      if (!ok) return;
    }
    if (removeBgPreviewImage) {
      const ok = confirm("You have a Remove Background preview not applied (✓). Save will ignore it. Continue?");
      if (!ok) return;
    }

    openSaveModal();
  });

  // modal close
  document.getElementById("closeSaveBtn")?.addEventListener("click", closeSaveModal);
  document.querySelector("#saveModal .modal__backdrop")?.addEventListener("click", closeSaveModal);

  // modal save
  document.getElementById("saveBtn")?.addEventListener("click", async () => {
    if (blockIfLocked()) return;

    const input = document.getElementById("fileLocation");
    let path = (input?.value || "").trim();

    // ✅ if user leaves empty, default to download/
    if (!path) path = "download/image_01.png";

    setSaveBusy(true);
    try {
      await saveFinalImage(path);
      closeSaveModal();
      alert(`Saved ✓\n${path}`);
    } catch (err) {
      console.error(err);
      alert("Save failed. Check backend /save endpoint and the path.");
    } finally {
      setSaveBusy(false);
    }
  });
});
