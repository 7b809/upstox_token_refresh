"use strict";

// =====================================================================
// Upstox TOTP Dashboard — front-end controller
// Version: 3 (paste button hardened)
// =====================================================================

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

// ---------------------------------------------------------------- sanity log
// If you see this line in DevTools console, app.js loaded correctly.
console.log("[app.js] loaded. Elements found:",
  { form: !!form, input: !!input, btn: !!btn, pasteBtn: !!pasteBtn });

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

// ---------------------------------------------------------------- clipboard
// Read text from the clipboard, preferring the modern async Clipboard API.
// Returns { ok: true, text } or { ok: false, reason }.
async function readClipboardText() {
  // 1) Modern async Clipboard API (Chrome / Edge / Safari 13.1+ / FF 125+)
  if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
    try {
      // Optional permission pre-check (not all browsers support this name)
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const status = await navigator.permissions.query({
            name: "clipboard-read",
          });
          console.log("[paste] clipboard-read permission:", status.state);
        } catch (_) {
          // Firefox / Safari throw on 'clipboard-read' — ignore.
        }
      }

      const text = await navigator.clipboard.readText();
      console.log("[paste] readText() returned:", JSON.stringify(text));
      return { ok: true, text: text || "" };
    } catch (err) {
      console.warn("[paste] readText() failed:", err && err.name, err && err.message);
      return {
        ok: false,
        reason:
          err && err.name === "NotAllowedError"
            ? "Clipboard permission was denied. Allow it in the address-bar prompt, or paste with Ctrl+V."
            : "Could not read the clipboard. Paste manually with Ctrl+V.",
      };
    }
  }

  // 2) No async API available (http://, old browser, iframe sandbox)
  return {
    ok: false,
    reason:
      "This browser/context does not expose the Clipboard API. Paste manually with Ctrl+V (or long-press → Paste).",
  };
}

// ---------------------------------------------------------------- paste button
async function pasteFromClipboard() {
  console.log("[paste] button clicked. submitting =", submitting);
  if (submitting) return;

  // Show a loading state so the user sees *something* happen immediately.
  if (pasteBtn) {
    pasteBtn.classList.add("loading");
    pasteBtn.disabled = true;
  }

  try {
    const result = await readClipboardText();

    if (!result.ok) {
      showToast("error", result.reason);
      setPasteHint("Clipboard unavailable — paste with Ctrl+V.", true);
      input.focus();
      return;
    }

    const raw    = result.text;
    const digits = (raw || "").replace(/\D/g, "");
    console.log("[paste] digits after sanitise:", JSON.stringify(digits));

    // 3) Validate
    if (digits.length === 0) {
      showToast("warning", "Clipboard is empty or contains no digits.");
      setPasteHint("Clipboard had no digits.", true);
      input.focus();
      return;
    }
    if (digits.length > 6) {
      showToast(
        "warning",
        `Clipboard contains ${digits.length} digits — expected exactly 6.`
      );
      setPasteHint("Clipboard has too many digits.", true);
      input.focus();
      return;
    }
    if (digits.length < 6) {
      input.value = digits.slice(0, 6);
      setPasteHint(`Only ${digits.length} digit(s) found — need 6.`, true);
      showToast(
        "warning",
        `Clipboard had only ${digits.length} digit(s). Please enter the rest.`
      );
      input.focus();
      return;
    }

    // 4) Perfect: exactly 6 digits
    input.value = digits;
    setPasteHint("Code pasted — submitting automatically…", true);
    console.log("[paste] submitting TOTP:", digits);
    await submitTOTP(digits, "paste-clipboard");
  } catch (err) {
    console.error("[paste] unexpected error:", err);
    showToast("error", "Unexpected error reading the clipboard.");
  } finally {
    if (pasteBtn) {
      pasteBtn.classList.remove("loading");
      pasteBtn.disabled = false;
    }
  }
}

if (pasteBtn) {
  pasteBtn.addEventListener("click", pasteFromClipboard);
} else {
  console.warn("[app.js] #paste-btn not found in DOM — paste button will not work.");
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