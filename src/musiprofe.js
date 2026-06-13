"use strict";

/* =============================================================================
  src/musiprofe.js — Estudiantes HUB · Musicala

  Chat flotante de MusiProfe (asistente de práctica).

  - Panel tipo widget de ayuda que se abre desde el FAB.
  - El estudiante escribe libremente; se interpreta por palabras clave y se
    responde con asesoría real basada en sus datos (ruta, tarea, instrumento),
    reutilizando el motor generateProfeAnswer() de views.js.
  - 100% en el cliente: sin API keys ni costos.
============================================================================= */

import { generateProfeAnswer } from "./views.js";

/* Intenciones reconocidas → id de respuesta del motor existente. */
const INTENTS = [
  {
    id: "focus",
    keywords: ["enfoc", "esta semana", "prioridad", "por donde", "por dónde", "empez", "empiez", "que hago", "qué hago", "foco", "objetivo"],
  },
  {
    id: "homework",
    keywords: ["tarea", "deber", "pendiente", "dejó el profe", "dejo el profe", "practico la tarea", "como hago la tarea"],
  },
  {
    id: "level_up",
    keywords: ["subir de nivel", "nivel", "mejorar", "avanz", "progres", "rapido", "rápido", "rendir", "ser mejor"],
  },
  {
    id: "technique",
    keywords: ["tecnica", "técnica", "ejercicio", "calentamiento", "dedos", "postura", "manos", "digitacion", "digitación"],
  },
  {
    id: "performance",
    keywords: ["muestra", "presentaci", "concierto", "escenario", "recital", "nervios", "ansiedad", "tocar en publico", "público"],
  },
  {
    id: "motivation",
    keywords: ["motivaci", "desanim", "aburr", "ganas", "frustrad", "dejar", "cansad", "no quiero", "pereza", "animo", "ánimo"],
  },
];

const SUGGESTIONS = [
  { id: "focus", label: "¿En qué me enfoco esta semana?" },
  { id: "homework", label: "¿Cómo practico la tarea?" },
  { id: "level_up", label: "¿Cómo subo de nivel?" },
  { id: "technique", label: "¿Qué técnica trabajo hoy?" },
  { id: "performance", label: "¿Cómo me preparo para una muestra?" },
  { id: "motivation", label: "Estoy desmotivado/a" },
];

const GREETINGS = ["hola", "buenas", "hey", "que tal", "qué tal", "buenos dias", "buenas tardes", "buenas noches", "holi"];

function normalize(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function detectIntent(text = "") {
  const n = normalize(text);
  if (!n) return null;

  if (GREETINGS.some((g) => n === normalize(g) || n.startsWith(normalize(g)))) {
    return "greeting";
  }

  let best = null;
  let bestScore = 0;

  for (const intent of INTENTS) {
    let score = 0;
    for (const kw of intent.keywords) {
      if (n.includes(normalize(kw))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = intent.id;
    }
  }

  return best; // puede ser null → fallback
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createMusiProfeChat({ api, getContext } = {}) {
  let panel, body, form, input, suggestionsEl, closeBtn;
  let mounted = false;
  let open = false;
  let bundle = null;
  let bundleLoadedFor = null;
  let greeted = false;

  function ready() {
    panel = document.getElementById("musiprofeChat");
    body = document.getElementById("musiprofeChatBody");
    form = document.getElementById("musiprofeChatForm");
    input = document.getElementById("musiprofeChatInput");
    suggestionsEl = document.getElementById("musiprofeChatSuggestions");
    closeBtn = document.getElementById("musiprofeChatClose");
    return Boolean(panel && body && form && input);
  }

  function studentName() {
    const ctx = getContext?.() || {};
    const s = ctx.student || {};
    const full = s.nombreCompleto || s.nombre || s.name || s.displayName || "";
    return String(full).trim().split(/\s+/)[0] || "músico";
  }

  function scrollToEnd() {
    if (body) body.scrollTop = body.scrollHeight;
  }

  function addMessage(role, html) {
    if (!body) return;
    const wrap = document.createElement("div");
    wrap.className = `profe-msg profe-msg--${role}`;
    if (role === "bot") {
      wrap.innerHTML = `
        <img class="profe-msg__avatar" src="./assets/musiprofe.png" alt="" aria-hidden="true" />
        <div class="profe-msg__bubble">${html}</div>
      `;
    } else {
      wrap.innerHTML = `<div class="profe-msg__bubble">${html}</div>`;
    }
    body.appendChild(wrap);
    scrollToEnd();
  }

  function addTyping() {
    if (!body) return null;
    const wrap = document.createElement("div");
    wrap.className = "profe-msg profe-msg--bot";
    wrap.innerHTML = `
      <img class="profe-msg__avatar" src="./assets/musiprofe.png" alt="" aria-hidden="true" />
      <div class="profe-msg__bubble profe-msg__bubble--typing">
        <span></span><span></span><span></span>
      </div>
    `;
    body.appendChild(wrap);
    scrollToEnd();
    return wrap;
  }

  async function ensureBundle() {
    const ctx = getContext?.() || {};
    const studentId = ctx.studentId;
    if (!studentId) return null;
    if (bundle && bundleLoadedFor === studentId) return bundle;

    if (typeof api?.getStudentPortalHome === "function") {
      bundle = await api
        .getStudentPortalHome(studentId, { student: ctx.student })
        .catch(() => null);
    }
    bundleLoadedFor = studentId;
    return bundle;
  }

  function answerFor(intentId, ctx, data) {
    if (intentId === "greeting") {
      return `<p>¡Hola, ${escapeHtml(studentName())}! 👋 Soy MusiProfe. Cuéntame qué necesitas: en qué enfocarte esta semana, cómo practicar la tarea, técnica, prepararte para una muestra o recuperar la motivación.</p>`;
    }
    if (intentId && intentId !== "fallback") {
      return generateProfeAnswer(intentId, ctx, data || {});
    }
    // Fallback: no se entendió la intención.
    return `
      <p>Buena pregunta. Todavía no soy una IA abierta, pero sí puedo darte asesoría concreta basada en tu proceso real en Musicala.</p>
      <p>Prueba con algo como: <em>"¿en qué me enfoco esta semana?"</em>, <em>"¿cómo practico la tarea?"</em> o <em>"estoy desmotivado"</em>. También puedes tocar una de las sugerencias de abajo.</p>
    `;
  }

  async function handleUserText(text) {
    const clean = String(text || "").trim();
    if (!clean) return;

    addMessage("user", escapeHtml(clean));

    const typing = addTyping();
    const ctx = getContext?.() || {};
    const data = await ensureBundle();
    const intent = detectIntent(clean) || "fallback";
    const html = answerFor(intent, ctx, data);

    // Pequeña pausa para que se sienta natural.
    setTimeout(() => {
      typing?.remove();
      addMessage("bot", html);
    }, 380);
  }

  function renderSuggestions() {
    if (!suggestionsEl) return;
    suggestionsEl.innerHTML = SUGGESTIONS.map(
      (s) => `<button type="button" class="profe-chip" data-suggestion="${escapeHtml(s.label)}">${escapeHtml(s.label)}</button>`
    ).join("");
  }

  function greetOnce() {
    if (greeted) return;
    greeted = true;
    addMessage(
      "bot",
      `<p>¡Hola, ${escapeHtml(studentName())}! 👋 Soy <strong>MusiProfe</strong>, tu asistente de práctica. Escríbeme tu duda o elige una sugerencia.</p>`
    );
  }

  function setOpen(next) {
    if (!ready()) return;
    open = next;
    panel.hidden = !open;
    panel.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("profe-chat-open", open);
    if (open) {
      greetOnce();
      setTimeout(() => input?.focus(), 60);
      scrollToEnd();
    }
  }

  function toggle() {
    setOpen(!open);
  }

  function close() {
    setOpen(false);
  }

  function wire() {
    if (!ready() || mounted) return;
    mounted = true;

    renderSuggestions();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value;
      input.value = "";
      handleUserText(value);
    });

    closeBtn?.addEventListener("click", close);

    suggestionsEl?.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("[data-suggestion]");
      if (!btn) return;
      handleUserText(btn.getAttribute("data-suggestion"));
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && open) close();
    });
  }

  return {
    mount() {
      wire();
    },
    open: () => setOpen(true),
    close,
    toggle,
    reset() {
      // Al cerrar sesión / cambiar de estudiante.
      bundle = null;
      bundleLoadedFor = null;
      greeted = false;
      if (body) body.innerHTML = "";
      close();
    },
  };
}

export default { createMusiProfeChat };
