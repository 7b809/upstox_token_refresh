"use strict";

// ---------------------------------------------------------------- elements
const form       = document.getElementById("login-form");
const input      = document.getElementById("totp-input");
const btn        = document.getElementById("submit-btn");
const pasteBtn   = document.getElementById("paste-btn");
const toasts     = document.getElementById("toasts");
const statusGrid = document.getElementById("status-grid");
const refreshBtn = document.getElementById("refresh-btn");
const pasteHint  = document.getElementById("paste-hint");
const installBtn = document.getElementById("install-btn");

// ---------------------------------------------------------------- state
let submitting = false; // guards against double submits (paste + manual)

// ---------------------------------------------------------------- helpers
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function showToast(type, message, duration = 4500) {
  // Bootstrap Icons classes (no emoji, no images)
  const icons = {
    success: "bi-check-circle-fill",
    error:   "bi-x-circle-fill",
    warning: "bi-exclamation-triangle-fill",
  };
  const iconClass = icons[type] || "bi-info-circle-fill";

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-icon"><i class="bi ${iconClass}" aria-hidden="true"></i></div>
    <div class="toast-message">${escapeHtml(message)}</div>
    <button class="toast-close" aria-label="Close">×</button>
  `;
  el.querySelector(".toast-close").addEventListener("click", () => el.remove());
  toasts.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function setPasteHint(text, active = false) {
  if (!pasteHint) return;
  pasteHint.innerHTML =
    `<i class="bi bi-clipboard-check" aria-hidden="true"></i> ${escapeHtml(text)}`;
  pasteHint.classList.toggle("active", active);
}

// ---------------------------------------------------------------- status
function renderStatus(payload) {
  if (!payload.ok) {
    statusGrid.innerHTML = `<div class="status-empty">${escapeHtml(
      payload.message || "Unable to load status."
    )}</div>`;
    return;
  }
  if (!payload.data) {
    statusGrid.innerHTML = `<div class="status-empty">
      <i class="bi bi-inbox" aria-hidden="true"></i>
      No token stored yet. Submit a TOTP to create one.
    </div>`;
    return;
  }

  const d = payload.data;
  const isMasked = (v) => v === "********";
  const rows = [
    ["Status",              d.last_validation_status      ?? "—"],
    ["Status text",         d.last_validation_status_text ?? "—"],
    ["Last validated at",   d.last_validated_at           ?? "—"],
    ["Created at",          d.created_at                  ?? "—"],
    ["Updated at",          d.updated_at                  ?? "—"],
    ["Source",              d.source                      ?? "—"],
    ["User ID",             d.last_profile_user_id        ?? "—"],
    ["User name",           d.last_profile_user_name      ?? "—"],
    ["Broker",              d.last_profile_broker         ?? "—"],
    ["Access token",        d.access_token                ?? "—"],
    ["Validation error",    d.last_validation_error       ?? "—"],
  ];

  statusGrid.innerHTML = rows
    .map(([k, v]) => {
      const value = v === null || v === undefined ? "—" : String(v);
      const cls = isMasked(value) ? "masked" : "";
      return `
        <div class="status-row">
          <dt>${escapeHtml(k)}</dt>
          <dd class="${cls}">${escapeHtml(value)}</dd>
        </div>
      `;
    })
    .join("");
}

async function loadStatus() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    const data = await res.json();
    renderStatus(data);
  } catch (err) {
    console.error(err);
    statusGrid.innerHTML = `<div class="status-empty">
      <i class="bi bi-wifi-off" aria-hidden="true"></i>
      Failed to load status.
    </div>`;
  }
}

// ---------------------------------------------------------------- submit
async function submitTOTP(totp, origin = "manual") {
  if (submitting) return;
  submitting = true;

  btn.classList.add("loading");
  btn.disabled = true;
  input.disabled = true;
  if (pasteBtn) { pasteBtn.classList.add("loading"); pasteBtn.disabled = true; }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totp }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      if (data.warning) {
        showToast("warning", data.warning);
      } else {
        const prefix =
          origin === "paste-clipboard" ? "Pasted & submitted: " :
          origin === "paste"           ? "Auto-submitted: " :
                                         "";
        showToast(
          "success",
          prefix + (data.message || "Access token saved successfully.")
        );
      }
      input.value = "";
      setPasteHint("Tip: paste a 6-digit code and it will auto-submit.");
      await loadStatus();
    } else {
      showToast("error", data.message || `Request failed (HTTP ${res.status}).`);
    }
  } catch (err) {
    console.error(err);
    showToast("error", "Network error. Please check the server and try again.");
  } finally {
    submitting = false;
    btn.classList.remove("loading");
    btn.disabled = false;
    input.disabled = false;
    if (pasteBtn) { pasteBtn.classList.remove("loading"); pasteBtn.disabled = false; }
    input.focus();
  }
}

// ---------------------------------------------------------------- paste button
// Reads clipboard → validates 6 digits → fills input → auto-submits.
async function pasteFromClipboard() {
  if (submitting) return;

  // 1. Feature-detect the modern Clipboard API
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    showToast("error",
      "Clipboard reading is not supported in this browser. Paste manually with Ctrl+V.");
    input.focus();
    return;
  }

  let raw = "";
  try {
    raw = await navigator.clipboard.readText();
  } catch (err) {
    // Most common: user denied the clipboard permission, or the page isn't
    // focused (Chrome requires a user gesture + focus for clipboard.read).
    console.error(err);
    showToast("error",
      "Could not read the clipboard. Please allow clipboard access or paste with Ctrl+V.");
    input.focus();
    return;
  }

  // 2. Sanitise: keep only digits, cap at 6
  const digits = (raw || "").replace(/\D/g, "");

  // 3. Validate length & content
  if (digits.length === 0) {
    showToast("warning", "Clipboard is empty or contains no digits.");
    input.focus();
    return;
  }
  if (digits.length > 6) {
    showToast("warning",
      `Clipboard contains ${digits.length} digits — expected exactly 6.`);
    input.focus();
    return;
  }
  if (digits.length < 6) {
    // Pre-fill what we got so the user can complete it manually
    input.value = digits.slice(0, 6);
    setPasteHint(`Only ${digits.length} digit(s) found — need 6.`, true);
    showToast("warning",
      `Clipboard had only ${digits.length} digit(s). Please enter the remaining.`);
    input.focus();
    return;
  }

  // 4. Perfect: 6 digits, all numeric → fill + submit
  input.value = digits;
  setPasteHint("Code pasted — submitting automatically…", true);
  await submitTOTP(digits, "paste-clipboard");
}

if (pasteBtn) {
  pasteBtn.addEventListener("click", pasteFromClipboard);
}

// ---------------------------------------------------------------- input sanitise
input.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
});

// ---------------------------------------------------------------- paste auto-submit
// (Ctrl+V / right-click paste inside the input — unchanged behaviour)
input.addEventListener("paste", (event) => {
  const clipboard =
    (event.clipboardData || window.clipboardData).getData("text") || "";
  const digits = clipboard.replace(/\D/g, "");

  if (digits.length === 6) {
    event.preventDefault();
    input.value = digits;
    setPasteHint("Code detected — submitting automatically…", true);
    setTimeout(() => submitTOTP(digits, "paste"), 120);
  } else if (digits.length > 0 && digits.length < 6) {
    event.preventDefault();
    input.value = digits.slice(0, 6);
  }
});

// ---------------------------------------------------------------- manual submit
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const totp = input.value.trim();

  if (!/^\d{6}$/.test(totp)) {
    showToast("error", "Please enter a valid 6-digit TOTP code.");
    input.focus();
    return;
  }
  submitTOTP(totp, "manual");
});

refreshBtn.addEventListener("click", loadStatus);

// ---------------------------------------------------------------- PWA install
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  if (installBtn) installBtn.style.display = "inline-flex";
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = "none";
    if (outcome === "accepted") {
      showToast("success", "App installed. Launch it from your home screen or app list.");
    } else {
      showToast("warning", "Install cancelled.");
    }
  });
}

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  if (installBtn) installBtn.style.display = "none";
  showToast("success", "Upstox TOTP Dashboard installed.");
});

// ---------------------------------------------------------------- bootstrap
loadStatus();
setInterval(loadStatus, 30_000);