"use strict";

/* =============================================================================
  src/ui.js — Estudiantes HUB · Musicala

  Helpers visuales y utilidades de interfaz.

  Este archivo:
  - NO consulta Firestore.
  - NO maneja Auth.
  - NO decide permisos.
  - SÍ ayuda a renderizar HTML seguro, modales, banners, toasts y estados.

  Compatible con:
  - index.html nuevo
  - styles.css nuevo
  - app.js nuevo
============================================================================= */

/* =============================================================================
  Selectores
============================================================================= */

export const $ = (selector, root = document) => root?.querySelector?.(selector) || null;

export const $$ = (selector, root = document) =>
  Array.from(root?.querySelectorAll?.(selector) || []);

/* =============================================================================
  Helpers base
============================================================================= */

export function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };

    return map[char] || char;
  });
}

export function escapeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

export function stripHtml(value = "") {
  return safeText(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateText(value = "", maxLength = 180, suffix = "…") {
  const text = stripHtml(value);

  if (text.length <= maxLength) return text;

  return `${text.slice(0, Math.max(0, maxLength - suffix.length)).trim()}${suffix}`;
}

export function joinClean(values = [], separator = " · ") {
  return safeArray(values)
    .map((item) => safeText(item))
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index)
    .join(separator);
}

export function clamp(value, min = 0, max = 100) {
  const number = Number(value);

  if (!Number.isFinite(number)) return min;

  return Math.max(min, Math.min(max, number));
}

/* =============================================================================
  DOM helpers
============================================================================= */

export function setText(selectorOrElement, value = "") {
  const element =
    typeof selectorOrElement === "string"
      ? $(selectorOrElement)
      : selectorOrElement;

  if (!element) return;

  element.textContent = safeText(value);
}

export function setHTML(selectorOrElement, html = "") {
  const element =
    typeof selectorOrElement === "string"
      ? $(selectorOrElement)
      : selectorOrElement;

  if (!element) return;

  element.innerHTML = html;
}

export function show(selectorOrElement) {
  const element =
    typeof selectorOrElement === "string"
      ? $(selectorOrElement)
      : selectorOrElement;

  if (!element) return;

  element.hidden = false;
}

export function hide(selectorOrElement) {
  const element =
    typeof selectorOrElement === "string"
      ? $(selectorOrElement)
      : selectorOrElement;

  if (!element) return;

  element.hidden = true;
}

export function toggleHidden(selectorOrElement, shouldHide) {
  const element =
    typeof selectorOrElement === "string"
      ? $(selectorOrElement)
      : selectorOrElement;

  if (!element) return;

  element.hidden = Boolean(shouldHide);
}

export function setBusy(selectorOrElement, isBusy = true) {
  const element =
    typeof selectorOrElement === "string"
      ? $(selectorOrElement)
      : selectorOrElement;

  if (!element) return;

  element.setAttribute("aria-busy", isBusy ? "true" : "false");
}

/* =============================================================================
  Fechas
============================================================================= */

export function toDateMaybe(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (
    typeof value === "object" &&
    typeof value.seconds === "number" &&
    typeof value.nanoseconds === "number"
  ) {
    const date = new Date(value.seconds * 1000 + Math.round(value.nanoseconds / 1e6));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function formatDate(value, locale = "es-CO", options = {}) {
  const date = toDateMaybe(value);

  if (!date) return options.fallback || "Sin fecha";

  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...options,
    }).format(date);
  } catch {
    return options.fallback || "Sin fecha";
  }
}

export function formatDateTime(value, locale = "es-CO", options = {}) {
  const date = toDateMaybe(value);

  if (!date) return options.fallback || "Sin fecha";

  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...options,
    }).format(date);
  } catch {
    return options.fallback || "Sin fecha";
  }
}

export function formatShortDate(value) {
  return formatDate(value, "es-CO", {
    day: "2-digit",
    month: "short",
  });
}

export function formatRelativeDate(value) {
  const date = toDateMaybe(value);
  if (!date) return "Sin fecha";

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const startTarget = new Date(date);
  startTarget.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (startTarget.getTime() - startToday.getTime()) / 86_400_000
  );

  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Mañana";
  if (diffDays === -1) return "Ayer";

  if (diffDays > 1 && diffDays <= 7) {
    return `En ${diffDays} días`;
  }

  if (diffDays < -1 && diffDays >= -7) {
    return `Hace ${Math.abs(diffDays)} días`;
  }

  return formatDate(date);
}

/* =============================================================================
  Toast
============================================================================= */

const TOAST = {
  counter: 0,
  maxVisible: 4,
};

export function toast(message, type = "info", duration = 2800, root = $("#toastRoot")) {
  if (!root) return null;

  const cleanType = safeText(type, "info");
  const cleanMessage = safeText(message, "Mensaje");

  TOAST.counter += 1;

  const element = document.createElement("div");
  element.className = `toast toast--${cleanType}`;
  element.setAttribute("role", cleanType === "danger" ? "alert" : "status");
  element.setAttribute("aria-live", cleanType === "danger" ? "assertive" : "polite");
  element.dataset.toastId = String(TOAST.counter);

  element.innerHTML = `
    <div class="toast__msg">${escapeHtml(cleanMessage)}</div>
  `;

  root.appendChild(element);

  const existingToasts = $$(".toast", root);
  if (existingToasts.length > TOAST.maxVisible) {
    existingToasts
      .slice(0, existingToasts.length - TOAST.maxVisible)
      .forEach((toastElement) => removeToast(toastElement, 0));
  }

  requestAnimationFrame(() => {
    element.classList.add("is-on");
  });

  const timer = window.setTimeout(() => {
    removeToast(element);
  }, duration);

  element.addEventListener("click", () => {
    window.clearTimeout(timer);
    removeToast(element);
  });

  return element;
}

export function removeToast(element, delay = 180) {
  if (!element) return;

  element.classList.remove("is-on");

  window.setTimeout(() => {
    element.remove();
  }, delay);
}

export function clearToasts(root = $("#toastRoot")) {
  if (!root) return;

  $$(".toast", root).forEach((element) => element.remove());
}

/* =============================================================================
  Banner
============================================================================= */

export function banner(message = "", type = "info", root = $("#bannerArea"), options = {}) {
  if (!root) return;

  const {
    allowHTML = false,
    title = "",
    dismissible = false,
  } = options || {};

  const cleanMessage = safeText(message);

  if (!cleanMessage) {
    root.innerHTML = "";
    return;
  }

  const cleanType = safeText(type, "info");

  const titleHTML = title
    ? `<strong>${escapeHtml(title)}</strong> `
    : "";

  const messageHTML = allowHTML
    ? cleanMessage
    : escapeHtml(cleanMessage);

  const closeHTML = dismissible
    ? `
      <button
        class="icon-btn"
        type="button"
        aria-label="Cerrar aviso"
        data-banner-close="true"
      >
        ×
      </button>
    `
    : "";

  root.innerHTML = `
    <div class="banner banner--${escapeAttr(cleanType)}">
      <div class="banner__content">
        ${titleHTML}${messageHTML}
      </div>
      ${closeHTML}
    </div>
  `;

  if (dismissible) {
    root
      .querySelector("[data-banner-close='true']")
      ?.addEventListener("click", () => {
        root.innerHTML = "";
      });
  }
}

export function clearBanner(root = $("#bannerArea")) {
  if (!root) return;
  root.innerHTML = "";
}

/* =============================================================================
  Modal
============================================================================= */

const MODAL = {
  wired: false,
  lastFocus: null,
};

function getFocusableElements(root) {
  if (!root) return [];

  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  return Array.from(root.querySelectorAll(selector)).filter((element) => {
    const style = window.getComputedStyle(element);
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      !element.hasAttribute("disabled") &&
      element.offsetParent !== null
    );
  });
}

function trapModalFocus(event) {
  const root = $("#modalRoot");
  if (!root || root.hidden || event.key !== "Tab") return;

  const dialog = root.querySelector(".modal");
  const focusable = getFocusableElements(dialog);

  if (!focusable.length) {
    event.preventDefault();
    dialog?.focus?.();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function openModal(options = {}) {
  const root = $("#modalRoot");
  if (!root) return;

  const {
    title = "Detalle",
    subtitle = "",
    bodyHTML = "",
    footHTML = "",
    focusSelector = "",
    size = "",
  } = options;

  const titleEl = $("#modalTitle", root);
  const subtitleEl = $("#modalSubtitle", root);
  const bodyEl = $("#modalBody", root);
  const footEl = $("#modalFoot", root);
  const dialogEl = $(".modal", root);

  MODAL.lastFocus = document.activeElement;

  if (titleEl) titleEl.textContent = safeText(title, "Detalle");
  if (subtitleEl) subtitleEl.textContent = safeText(subtitle);
  if (bodyEl) bodyEl.innerHTML = bodyHTML;
  if (footEl) footEl.innerHTML = footHTML;

  if (dialogEl) {
    dialogEl.classList.toggle("modal--wide", size === "wide");
    dialogEl.classList.toggle("modal--sm", size === "small");
  }

  root.hidden = false;
  document.body.classList.add("modal-open");

  requestAnimationFrame(() => {
    const target =
      focusSelector && root.querySelector(focusSelector)
        ? root.querySelector(focusSelector)
        : getFocusableElements(dialogEl)[0] || dialogEl;

    target?.focus?.();
  });
}

export function closeModal() {
  const root = $("#modalRoot");
  if (!root || root.hidden) return;

  const bodyEl = $("#modalBody", root);
  const footEl = $("#modalFoot", root);
  const dialogEl = $(".modal", root);

  root.hidden = true;
  document.body.classList.remove("modal-open");

  if (bodyEl) bodyEl.innerHTML = "";
  if (footEl) footEl.innerHTML = "";

  if (dialogEl) {
    dialogEl.classList.remove("modal--wide", "modal--sm");
  }

  try {
    if (
      MODAL.lastFocus &&
      typeof MODAL.lastFocus.focus === "function" &&
      document.contains(MODAL.lastFocus)
    ) {
      MODAL.lastFocus.focus();
    }
  } catch {
    // El foco sobrevivirá. O no. Así es la vida.
  } finally {
    MODAL.lastFocus = null;
  }
}

export function wireModal() {
  if (MODAL.wired) return;

  MODAL.wired = true;

  const root = $("#modalRoot");

  if (root) {
    root.addEventListener("click", (event) => {
      const target = event.target;

      if (target?.dataset?.close === "true") {
        closeModal();
      }
    });
  }

  window.addEventListener("keydown", (event) => {
    const rootEl = $("#modalRoot");

    if (!rootEl || rootEl.hidden) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }

    trapModalFocus(event);
  });
}

/* =============================================================================
  Navegación inferior
============================================================================= */

export function setActiveNav(route = "") {
  const cleanRoute = safeText(route, "home");

  $$(".bottom-nav__item").forEach((item) => {
    const itemRoute = safeText(item.dataset.route);
    const isActive = itemRoute === cleanRoute;

    item.classList.toggle("is-active", isActive);

    if (isActive) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

/* =============================================================================
  Render helpers generales
============================================================================= */

export function renderLoading(
  title = "Cargando Estudiantes HUB…",
  text = "Estamos preparando tu portal."
) {
  return `
    <article class="hero-card hero-card--loading" role="status" aria-label="Cargando contenido">
      <div class="hero-card__badge">
        <span aria-hidden="true">🎵</span>
        <span>Preparando tu espacio</span>
      </div>

      <h1 class="hero-card__title">${escapeHtml(title)}</h1>
      <p class="hero-card__text">${escapeHtml(text)}</p>

      <div class="loading-stack" aria-hidden="true">
        <div class="skeleton skeleton--title"></div>
        <div class="skeleton skeleton--line"></div>
        <div class="skeleton skeleton--line skeleton--short"></div>
      </div>
    </article>
  `;
}

export function mountLoading(
  target = $("#view"),
  title = "Cargando Estudiantes HUB…",
  text = "Estamos preparando tu portal."
) {
  if (!target) return;
  target.innerHTML = renderLoading(title, text);
}

export function viewHeader(title, subtitle = "", options = {}) {
  const {
    eyebrow = "",
    actionsHTML = "",
  } = options;

  return `
    <header class="viewhead">
      <div class="viewhead__copy">
        ${
          eyebrow
            ? `<div class="viewhead__eyebrow">${escapeHtml(eyebrow)}</div>`
            : ""
        }

        <h1 class="viewhead__title">${escapeHtml(title)}</h1>

        ${
          subtitle
            ? `<p class="viewhead__sub">${escapeHtml(subtitle)}</p>`
            : ""
        }
      </div>

      ${
        actionsHTML
          ? `<div class="viewhead__actions">${actionsHTML}</div>`
          : ""
      }
    </header>
  `;
}

export function sectionHeader(title, subtitle = "", options = {}) {
  const { actionsHTML = "" } = options;

  return `
    <div class="card__head">
      <div>
        <h2 class="card__title">${escapeHtml(title)}</h2>
        ${
          subtitle
            ? `<p class="card__subtitle">${escapeHtml(subtitle)}</p>`
            : ""
        }
      </div>

      ${actionsHTML || ""}
    </div>
  `;
}

export function card({ title = "", subtitle = "", bodyHTML = "", footerHTML = "", className = "" } = {}) {
  return `
    <article class="card ${escapeAttr(className)}">
      ${
        title || subtitle
          ? sectionHeader(title, subtitle)
          : ""
      }

      <div class="card__body">
        ${bodyHTML}
      </div>

      ${
        footerHTML
          ? `<footer class="card__footer">${footerHTML}</footer>`
          : ""
      }
    </article>
  `;
}

export function hero({
  badge = "Portal de estudiantes",
  icon = "🎵",
  title = "Estudiantes HUB",
  text = "",
  actionsHTML = "",
  note = "",
  className = "",
} = {}) {
  return `
    <article class="hero-card ${escapeAttr(className)}">
      <div class="hero-card__badge">
        <span aria-hidden="true">${escapeHtml(icon)}</span>
        <span>${escapeHtml(badge)}</span>
      </div>

      <h1 class="hero-card__title">${escapeHtml(title)}</h1>

      ${
        text
          ? `<p class="hero-card__text">${escapeHtml(text)}</p>`
          : ""
      }

      ${
        actionsHTML
          ? `<div class="hero-card__actions">${actionsHTML}</div>`
          : ""
      }

      ${
        note
          ? `<p class="hero__note">${escapeHtml(note)}</p>`
          : ""
      }
    </article>
  `;
}

export function emptyState(title, text = "", options = {}) {
  const {
    icon = "◎",
    ctaHTML = "",
    cta = null,
    className = "",
  } = options;

  const finalCtaHTML =
    ctaHTML ||
    (
      cta?.label
        ? `
          <div class="hero-card__actions">
            <button
              class="btn btn--primary"
              type="button"
              ${cta.id ? `id="${escapeAttr(cta.id)}"` : ""}
              ${cta.action ? `data-action="${escapeAttr(cta.action)}"` : ""}
              ${cta.route ? `data-route-go="${escapeAttr(cta.route)}"` : ""}
            >
              ${escapeHtml(cta.label)}
            </button>
          </div>
        `
        : ""
    );

  return `
    <article class="empty ${escapeAttr(className)}">
      <div class="empty__icon" aria-hidden="true">${escapeHtml(icon)}</div>
      <h2 class="empty__title">${escapeHtml(title)}</h2>
      ${
        text
          ? `<p class="empty__text">${escapeHtml(text)}</p>`
          : ""
      }
      ${finalCtaHTML}
    </article>
  `;
}

/* =============================================================================
  Botones, chips y etiquetas
============================================================================= */

export function button(label, options = {}) {
  const {
    type = "button",
    variant = "primary",
    size = "",
    id = "",
    action = "",
    route = "",
    href = "",
    target = "",
    disabled = false,
    icon = "",
    className = "",
  } = options;

  const classes = [
    "btn",
    `btn--${variant}`,
    size ? `btn--${size}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = `
    ${icon ? `<span aria-hidden="true">${escapeHtml(icon)}</span>` : ""}
    <span>${escapeHtml(label)}</span>
  `;

  if (href) {
    return `
      <a
        class="${escapeAttr(classes)}"
        href="${escapeAttr(href)}"
        ${target ? `target="${escapeAttr(target)}"` : ""}
        ${target === "_blank" ? `rel="noopener noreferrer"` : ""}
      >
        ${content}
      </a>
    `;
  }

  return `
    <button
      class="${escapeAttr(classes)}"
      type="${escapeAttr(type)}"
      ${id ? `id="${escapeAttr(id)}"` : ""}
      ${action ? `data-action="${escapeAttr(action)}"` : ""}
      ${route ? `data-route-go="${escapeAttr(route)}"` : ""}
      ${disabled ? "disabled" : ""}
    >
      ${content}
    </button>
  `;
}

export function chip(text, tone = "ghost", options = {}) {
  const { icon = "", title = "" } = options;

  return `
    <span
      class="chip chip--${escapeAttr(tone)}"
      ${title ? `title="${escapeAttr(title)}"` : ""}
    >
      ${icon ? `<span aria-hidden="true">${escapeHtml(icon)}</span>` : ""}
      <span>${escapeHtml(text)}</span>
    </span>
  `;
}

export function pill(text, tone = "ghost", options = {}) {
  return chip(text, tone, options);
}

export function tags(items = [], tone = "ghost") {
  const list = safeArray(items)
    .map((item) => safeText(item))
    .filter(Boolean);

  if (!list.length) return "";

  return `
    <div class="chips">
      ${list.map((item) => chip(item, tone)).join("")}
    </div>
  `;
}

/* =============================================================================
  Tiles / tarjetas de navegación
============================================================================= */

export function tile(href, title, description = "", icon = "▦", options = {}) {
  const {
    route = "",
    external = false,
    className = "",
  } = options;

  const attrs = external
    ? `href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"`
    : `href="${escapeAttr(href)}"`;

  const dataRoute = route ? `data-route-go="${escapeAttr(route)}"` : "";

  return `
    <a class="tile ${escapeAttr(className)}" ${attrs} ${dataRoute}>
      <div class="tile__ico" aria-hidden="true">${escapeHtml(icon)}</div>

      <div class="tile__meta">
        <div class="tile__title">${escapeHtml(title)}</div>
        ${
          description
            ? `<div class="tile__desc">${escapeHtml(description)}</div>`
            : ""
        }
      </div>

      <div class="tile__chev" aria-hidden="true">›</div>
    </a>
  `;
}

export function routeTile(route, title, description = "", icon = "▦") {
  return tile(`#/` + route, title, description, icon, { route });
}

/* =============================================================================
  Listas / filas
============================================================================= */

export function itemRow(options = {}) {
  const {
    title = "—",
    meta = "",
    side = "",
    icon = "",
    actionHTML = "",
    href = "",
    route = "",
    data = {},
    className = "",
    external = false,
  } = options;

  const dataAttrs = Object.entries(data || {})
    .map(([key, value]) => `data-${escapeAttr(key)}="${escapeAttr(value)}"`)
    .join(" ");

  const inner = `
    ${
      icon
        ? `<div class="item__icon" aria-hidden="true">${escapeHtml(icon)}</div>`
        : ""
    }

    <div class="item__main">
      <div class="item__title">${escapeHtml(title || "—")}</div>
      ${
        meta
          ? `<div class="item__meta">${escapeHtml(meta)}</div>`
          : ""
      }
    </div>

    ${
      side
        ? `<div class="item__side">${escapeHtml(side)}</div>`
        : ""
    }

    ${actionHTML || ""}
  `;

  const classes = [
    "item",
    href || route || Object.keys(data || {}).length ? "item--link" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (href) {
    return `
      <a
        class="${escapeAttr(classes)}"
        href="${escapeAttr(href)}"
        ${external ? `target="_blank" rel="noopener noreferrer"` : ""}
        ${dataAttrs}
      >
        ${inner}
      </a>
    `;
  }

  if (route) {
    return `
      <button
        class="${escapeAttr(classes)}"
        type="button"
        data-route-go="${escapeAttr(route)}"
        ${dataAttrs}
      >
        ${inner}
      </button>
    `;
  }

  return `
    <div class="${escapeAttr(classes)}" ${dataAttrs}>
      ${inner}
    </div>
  `;
}

export function list(itemsHTML = "", className = "") {
  return `
    <div class="list ${escapeAttr(className)}">
      ${itemsHTML}
    </div>
  `;
}

/* =============================================================================
  Key-value / perfil
============================================================================= */

export function kvRow(label, value = "—", options = {}) {
  const {
    allowHTML = false,
    className = "",
  } = options;

  const cleanValue = value === null || value === undefined || safeText(value) === ""
    ? "—"
    : value;

  return `
    <div class="kv__row ${escapeAttr(className)}">
      <div class="kv__k">${escapeHtml(label)}</div>
      <div class="kv__v">
        ${allowHTML ? cleanValue : escapeHtml(cleanValue)}
      </div>
    </div>
  `;
}

export function kvList(rows = []) {
  const html = safeArray(rows)
    .filter((row) => row && row.length >= 2)
    .map(([label, value]) => kvRow(label, value))
    .join("");

  return `<div class="kv">${html}</div>`;
}

export function profileCard(student = {}) {
  const name = safeText(
    student.displayName ||
      student.nombre ||
      student.name ||
      "Estudiante"
  );

  const subtitle = joinClean([
    student.instrument || student.instrumento,
    student.program || student.programa,
    student.level || student.nivel,
  ]);

  const initials = getInitials(name);

  return `
    <article class="card profile-card">
      <div class="profile-card__avatar" aria-hidden="true">
        ${escapeHtml(initials)}
      </div>

      <div>
        <h2 class="profile-card__name">${escapeHtml(name)}</h2>
        ${
          subtitle
            ? `<p class="profile-card__meta">${escapeHtml(subtitle)}</p>`
            : `<p class="profile-card__meta">Perfil de estudiante Musicala</p>`
        }
      </div>
    </article>
  `;
}

export function getInitials(value = "", fallback = "M") {
  const text = safeText(value, fallback)
    .replace(/@.*/, "")
    .replace(/[._-]+/g, " ")
    .trim();

  const parts = text.split(/\s+/).filter(Boolean);

  if (!parts.length) return fallback.slice(0, 2).toUpperCase();

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

/* =============================================================================
  Progreso / ruta
============================================================================= */

export function progressBar(value = 0, options = {}) {
  const {
    label = "",
    showValue = true,
  } = options;

  const percent = clamp(value, 0, 100);

  return `
    <div class="progressline">
      ${
        label || showValue
          ? `
            <div class="progressline__top">
              <div class="progressline__label">${escapeHtml(label || "Progreso")}</div>
              ${
                showValue
                  ? `<div class="progressline__value">${percent}%</div>`
                  : ""
              }
            </div>
          `
          : ""
      }

      <div class="progressbar" aria-label="${escapeAttr(label || "Progreso")}" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
        <div class="progressbar__fill" style="--value:${percent}%"></div>
      </div>
    </div>
  `;
}

export function routeProgressCircle(value = 0) {
  const percent = clamp(value, 0, 100);

  return `
    <div
      class="route-progress"
      style="--progress:${percent}%"
      role="img"
      aria-label="Progreso de la ruta: ${percent}%"
    >
      ${percent}%
    </div>
  `;
}

export function timelineItem(options = {}) {
  const {
    title = "Paso",
    meta = "",
    status = "",
    className = "",
  } = options;

  const statusClass = (() => {
    const clean = safeText(status).toLowerCase();

    if (["done", "completed", "completado", "finalizado"].includes(clean)) {
      return "is-done";
    }

    if (["next", "siguiente", "actual", "active"].includes(clean)) {
      return "is-next";
    }

    return "";
  })();

  return `
    <div class="timeline__item ${statusClass} ${escapeAttr(className)}">
      <div class="timeline__title">${escapeHtml(title)}</div>
      ${
        meta
          ? `<div class="timeline__meta">${escapeHtml(meta)}</div>`
          : ""
      }
    </div>
  `;
}

/* =============================================================================
  Bitácoras
============================================================================= */

export function journalCard(bitacora = {}, options = {}) {
  const {
    actionHTML = "",
    previewLength = 260,
  } = options;

  const title = safeText(bitacora.title || bitacora.titulo, "Bitácora de clase");
  const content = safeText(bitacora.content || bitacora.contenido || bitacora.observaciones);
  const date = bitacora.fechaClase || bitacora.date || bitacora.createdAt;
  const author = bitacora.author?.name || bitacora.docente || bitacora.teacher || "";
  const process = bitacora.process || bitacora.proceso || "";

  const meta = joinClean([
    author ? `Docente: ${author}` : "",
    process,
  ]);

  return `
    <article class="journal-card">
      <div class="journal-card__top">
        <div>
          <div class="journal-card__date">${escapeHtml(formatDate(date))}</div>
          <h3 class="journal-card__title">${escapeHtml(title)}</h3>
          ${
            meta
              ? `<p class="journal-card__meta">${escapeHtml(meta)}</p>`
              : ""
          }
        </div>

        ${actionHTML || ""}
      </div>

      ${
        content
          ? `<p class="journal-card__content">${escapeHtml(truncateText(content, previewLength))}</p>`
          : ""
      }

      ${
        bitacora.tags?.length
          ? `<footer class="journal-card__footer">${tags(bitacora.tags, "soft")}</footer>`
          : ""
      }
    </article>
  `;
}

/* =============================================================================
  Recursos / eventos
============================================================================= */

export function resourceCard(resource = {}) {
  const title = safeText(resource.title || resource.titulo || resource.name, "Recurso");
  const text = safeText(resource.description || resource.descripcion || resource.summary);
  const icon = safeText(resource.icon || resource.emoji || getResourceIcon(resource.type || resource.tipo));
  const url = safeText(resource.url || resource.link || resource.href);

  return `
    <article class="resource-card">
      <div class="resource-card__icon" aria-hidden="true">${escapeHtml(icon)}</div>

      <div>
        <h3 class="resource-card__title">${escapeHtml(title)}</h3>
        ${
          text
            ? `<p class="resource-card__text">${escapeHtml(truncateText(text, 150))}</p>`
            : ""
        }
      </div>

      ${
        url
          ? `
            <footer class="resource-card__footer">
              ${button("Abrir recurso", {
                href: url,
                target: "_blank",
                variant: "ghost",
                size: "sm",
                icon: "↗",
              })}
            </footer>
          `
          : ""
      }
    </article>
  `;
}

export function eventCard(event = {}) {
  const title = safeText(event.title || event.titulo || event.name, "Evento");
  const text = safeText(event.description || event.descripcion || event.summary);
  const icon = safeText(event.icon || event.emoji || getEventIcon(event.type || event.tipo));
  const date = event.dateStart || event.fecha || event.date || event.createdAt;
  const place = safeText(event.location || event.lugar || event.sede);

  return `
    <article class="event-card">
      <div class="event-card__icon" aria-hidden="true">${escapeHtml(icon)}</div>

      <div>
        <h3 class="event-card__title">${escapeHtml(title)}</h3>

        <p class="event-card__text">
          ${escapeHtml(joinClean([
            formatDate(date),
            place,
          ]))}
        </p>

        ${
          text
            ? `<p class="event-card__text">${escapeHtml(truncateText(text, 150))}</p>`
            : ""
        }
      </div>
    </article>
  `;
}

export function getResourceIcon(type = "") {
  const cleanType = safeText(type).toLowerCase();

  const icons = {
    link: "↗",
    video: "▶",
    audio: "♪",
    pdf: "PDF",
    image: "▧",
    file: "▦",
    exercise: "✎",
    playlist: "♫",
  };

  return icons[cleanType] || "▦";
}

export function getEventIcon(type = "") {
  const cleanType = safeText(type).toLowerCase();

  const icons = {
    showcase: "★",
    muestra: "★",
    class: "♪",
    clase: "♪",
    workshop: "✎",
    taller: "✎",
    reminder: "!",
    recordatorio: "!",
    concert: "♫",
    concierto: "♫",
    meeting: "◎",
    reunion: "◎",
    reunión: "◎",
    event: "◷",
  };

  return icons[cleanType] || "◷";
}

/* =============================================================================
  Grids
============================================================================= */

export function grid(itemsHTML = "", options = {}) {
  const {
    columns = "",
    className = "",
  } = options;

  const columnClass = columns ? `grid--${columns}` : "";

  return `
    <div class="grid ${columnClass} ${escapeAttr(className)}">
      ${itemsHTML}
    </div>
  `;
}

export function stack(itemsHTML = "", options = {}) {
  const {
    size = "",
    className = "",
  } = options;

  const sizeClass = size ? `stack--${size}` : "";

  return `
    <div class="stack ${sizeClass} ${escapeAttr(className)}">
      ${itemsHTML}
    </div>
  `;
}

/* =============================================================================
  Modal content helpers
============================================================================= */

export function readBlock(html = "") {
  return `<div class="read">${html}</div>`;
}

export function modalActions(actionsHTML = "") {
  return `<div class="cluster">${actionsHTML}</div>`;
}

/* =============================================================================
  Estado global de vista
============================================================================= */

export function renderErrorState(title = "Algo falló", message = "No se pudo cargar la información.") {
  return `
    <section class="stack">
      ${emptyState(title, message, {
        icon: "!",
        cta: {
          label: "Reintentar",
          action: "reload",
        },
      })}
    </section>
  `;
}

export function renderPermissionState(message = "No tienes permisos para ver esta información.") {
  return `
    <section class="stack">
      ${emptyState("Acceso restringido", message, {
        icon: "🔐",
      })}
    </section>
  `;
}

/* =============================================================================
  Export agrupado opcional
============================================================================= */

export const ui = Object.freeze({
  $,
  $$,

  safeText,
  safeArray,
  escapeHtml,
  escapeAttr,
  stripHtml,
  truncateText,
  joinClean,
  clamp,

  setText,
  setHTML,
  show,
  hide,
  toggleHidden,
  setBusy,

  toDateMaybe,
  formatDate,
  formatDateTime,
  formatShortDate,
  formatRelativeDate,

  toast,
  removeToast,
  clearToasts,
  banner,
  clearBanner,

  openModal,
  closeModal,
  wireModal,

  setActiveNav,

  renderLoading,
  mountLoading,
  viewHeader,
  sectionHeader,
  card,
  hero,
  emptyState,

  button,
  chip,
  pill,
  tags,

  tile,
  routeTile,
  itemRow,
  list,

  kvRow,
  kvList,
  profileCard,
  getInitials,

  progressBar,
  routeProgressCircle,
  timelineItem,

  journalCard,
  resourceCard,
  eventCard,

  getResourceIcon,
  getEventIcon,

  grid,
  stack,

  readBlock,
  modalActions,

  renderErrorState,
  renderPermissionState,
});

export default ui;