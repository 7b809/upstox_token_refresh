"use strict";

// ---------------------------------------------------------------- elements
const form       = document.getElementById("login-form");
const input      = document.getElementById("totp-input");
const btn        = document.getElementById("submit-btn");
const toasts     = document.getElementById("toasts");
const statusGrid = document.getElementById("status-grid");
const refreshBtn = document.getElementById("refresh-btn");
const pasteHint  = document.getElementById("paste-hint");

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
  const icons = { success: "✅", error: "❌", warning: "⚠️" };
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-icon">${icons[type] || "ℹ️"}</div>
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
  pasteHint.textContent = text;
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
    statusGrid.innerHTML = `<div class="status-empty">No token stored yet. Submit a TOTP to create one.</div>`;
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
    statusGrid.innerHTML = `<div class="status-empty">Failed to load status.</div>`;
  }
}

// ---------------------------------------------------------------- submit
async function submitTOTP(totp, origin = "manual") {
  if (submitting) return;
  submitting = true;

  btn.classList.add("loading");
  btn.disabled = true;
  input.disabled = true;

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
        const prefix = origin === "paste" ? "Auto-submitted: " : "";
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
    input.focus();
  }
}

// ---------------------------------------------------------------- input sanitise
input.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
});

// ---------------------------------------------------------------- paste auto-submit
input.addEventListener("paste", (event) => {
  // Read the clipboard text (works for both mouse paste & Ctrl/Cmd+V).
  const clipboard =
    (event.clipboardData || window.clipboardData).getData("text") || "";
  const digits = clipboard.replace(/\D/g, "");

  if (digits.length === 6) {
    // Prevent the default paste (which would insert the raw text including
    // any spaces/dashes) and put only the 6 digits into the field.
    event.preventDefault();
    input.value = digits;

    setPasteHint("Code detected — submitting automatically…", true);
    // Let the DOM settle (so the user sees the filled value) before firing.
    setTimeout(() => submitTOTP(digits, "paste"), 120);
  } else if (digits.length > 0 && digits.length < 6) {
    // Partial clipboard content: sanitise and let the user finish typing.
    event.preventDefault();
    input.value = digits.slice(0, 6);
  }
  // Any other case (empty clipboard, letters only, etc.) -> default behaviour.
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

// ---------------------------------------------------------------- bootstrap
loadStatus();
setInterval(loadStatus, 30_000);