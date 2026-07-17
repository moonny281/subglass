"use strict";

/* Placeholder for frontend logic */
const state = {
  authenticated: false,
  sessionExpiresAt: 0,
  profileId: localStorage.getItem("subglass_profile_id") || "",
  profile: null,
  pool: [],
};

function toast(msg, isError) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = isError ? "rgba(239,68,68,.6)" : "rgba(255,255,255,.15)";
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3200);
}

async function checkSession() {
  try {
    const result = await fetch("/api/session", { credentials: "same-origin" }).then((r) => r.json());
    state.authenticated = !!result.authenticated;
  } catch {
    state.authenticated = false;
  }
}

(async function init() {
  await checkSession();
})();
