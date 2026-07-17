"use strict";

/* =============================================================================
  src/views.js — Estudiantes HUB · Musicala

  Render de pantallas del portal estudiantil.

  Este archivo:
  - NO maneja Auth.
  - NO decide permisos principales.
  - NO consulta Firebase directamente.
  - SÍ pide datos a data.js mediante deps.api.
  - SÍ renderiza vistas y modales.

  Rutas oficiales:
  - home
  - route
  - journal
  - resources
  - events
  - profile
============================================================================= */

import {
  viewHeader,
  emptyState,
  hero,
  card,
  button,
  chip,
  tags,
  kvList,
  profileCard,
  progressBar,
  routeProgressCircle,
  timelineItem,
  journalCard,
  resourceCard,
  eventCard,
  itemRow,
  grid,
  stack,
  readBlock,
  renderErrorState,
  renderPermissionState,
  formatDate,
  formatDateTime,
  formatRelativeDate,
  openModal,
  escapeHtml,
  escapeAttr,
  safeText as uiSafeText,
  truncateText,
  joinClean,
} from "./ui.js";

import {
  normalizePortalBundle,
  normalizeBitacoras,
  normalizeResources,
  normalizeEvents,
  normalizeStudentRoute,
  normalizeStudentRoutes,
  buildDefaultStudentRoute,
  getStudentIdentity,
  getStudentFallbackId,
  getStudentDisplayName,
  getStudentSubtitle,
  getStudentProfileRows,
  safeArray,
  toDateMaybe,
} from "./normalizers.js";

/* =============================================================================
  Estado de módulo — suscripción activa (onSnapshot)
============================================================================= */

/** Unsubscribe function de la última suscripción onSnapshot. */
let _activeUnsubscribe = null;

function cleanupSubscription() {
  if (typeof _activeUnsubscribe === "function") {
    try { _activeUnsubscribe(); } catch { /* noop */ }
    _activeUnsubscribe = null;
  }
}

/* =============================================================================
  Helpers internos
============================================================================= */

function getCtx(deps = {}) {
  return deps.ctx || {};
}

function getApi(deps = {}) {
  return deps.api || {};
}

function getActions(deps = {}) {
  return deps.actions || {};
}

function getStudent(ctx = {}) {
  return ctx.student || null;
}

function getStudentId(ctx = {}) {
  return uiSafeText(getStudentIdentity(ctx.student) || ctx.studentId || ctx.student?.id || "");
}

function getStudentFallbackQueryId(ctx = {}) {
  return uiSafeText(getStudentFallbackId(ctx.student));
}

function studentName(ctx = {}) {
  return getStudentDisplayName(getStudent(ctx), "Estudiante");
}

function studentSubtitle(ctx = {}) {
  return getStudentSubtitle(getStudent(ctx)) || "Perfil de aprendizaje Musicala";
}

function hasStudentContext(ctx = {}) {
  return Boolean(ctx.user && ctx.studentId && ctx.student);
}

function viewRoot() {
  return document.getElementById("view");
}

function asArray(value) {
  return safeArray(value);
}

function htmlText(value = "", fallback = "—") {
  return escapeHtml(uiSafeText(value, fallback));
}

/*
  Devuelve una etiqueta legible para humanos.

  Si el valor parece un identificador técnico / slug interno
  (p. ej. "proc_andres_camilo_gutierrez_rincon_musica_percusion_618",
  "fallback_musica_percusion", IDs con guiones bajos, etc.) NO lo mostramos
  crudo: se reemplaza por el texto de respaldo. Este portal nunca debe
  exponer claves técnicas al estudiante.
*/
function isTechnicalKey(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;

  // Objetos serializados por accidente: jamás se muestran al estudiante.
  if (text.includes("[object")) return true;

  // Prefijos internos conocidos.
  if (/^(proc|process|proceso|fallback|fb|ruta|route|doc|id)[_-]/i.test(text)) {
    return true;
  }

  // Slug "máquina": sin espacios, todo minúsculas/números unido por _ o -.
  // Ej: "musica_percusion_618", "andres-camilo-618".
  if (/\s/.test(text)) return false; // tiene espacios → es texto humano
  if (/[_-]/.test(text) && /^[a-z0-9_-]+$/i.test(text)) {
    return true;
  }

  return false;
}

function humanLabel(value = "", fallback = "") {
  const text = uiSafeText(value, "");
  if (!text || isTechnicalKey(text)) {
    return uiSafeText(fallback, "");
  }
  return text;
}

function paragraphize(text = "", fallback = "Sin información registrada.") {
  const clean = uiSafeText(text, fallback);

  return clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function getAuthorName(bitacora = {}) {
  return uiSafeText(
    bitacora.author?.name ||
      bitacora.authorName ||
      bitacora.docente ||
      bitacora.teacher ||
      bitacora.teacherName ||
      "",
    ""
  );
}

function getBitacoraContent(bitacora = {}) {
  return uiSafeText(
    bitacora.content ||
      bitacora.contenido ||
      bitacora.observaciones ||
      bitacora.notes ||
      bitacora.summary ||
      bitacora.resumen ||
      "",
    ""
  );
}

function getBitacoraTitle(bitacora = {}) {
  return uiSafeText(
    bitacora.title ||
      bitacora.titulo ||
      bitacora.topic ||
      bitacora.tema ||
      "Bitácora de clase",
    "Bitácora de clase"
  );
}

function getProcessLabel(item = {}) {
  // El proceso puede venir como texto o como objeto según la fuente del dato.
  const asLabel = (value) => {
    if (!value) return "";
    if (typeof value === "object") {
      return (
        value.processLabel ||
        value.label ||
        value.name ||
        value.nombre ||
        value.programa ||
        value.program ||
        value.area ||
        value.instrumento ||
        value.instrument ||
        ""
      );
    }
    return value;
  };

  return humanLabel(
    asLabel(item.process) ||
      asLabel(item.processLabel) ||
      asLabel(item.proceso) ||
      asLabel(item.program) ||
      "",
    ""
  );
}

function getEventDateLabel(event = {}) {
  const start = event.dateStart || event.fecha || event.date || event.createdAt;
  const end = event.dateEnd || event.fechaFin || "";

  const startText = formatDateTime(start);
  const endText = end ? formatDateTime(end) : "";

  if (!start || startText === "Sin fecha") return "Sin fecha";

  return endText && endText !== "Sin fecha"
    ? `${startText} – ${endText}`
    : startText;
}

function getResourceUrl(resource = {}) {
  return uiSafeText(resource.url || resource.link || resource.href || resource.downloadURL || "");
}

function getResourceLabel(resource = {}) {
  return joinClean([
    resource.type || resource.tipo,
    resource.instrument || resource.instrumento || resource.area,
    resource.level || resource.nivel,
  ]);
}

function getResourceArea(resource = {}) {
  return humanLabel(
    resource.area ||
      resource.instrument ||
      resource.instrumento ||
      resource.program ||
      resource.programa,
    "General"
  ) || "General";
}

function getResourceCategory(resource = {}) {
  const tag = safeArray(resource.tags || resource.etiquetas)
    .map((item) => humanLabel(item, ""))
    .find(Boolean);

  return humanLabel(
    resource.category ||
      resource.categoria ||
      resource.folder ||
      resource.carpeta ||
      resource.tema ||
      tag ||
      resource.type ||
      resource.tipo,
    "Material de apoyo"
  ) || "Material de apoyo";
}

function groupBy(items = [], getKey = () => "") {
  const grouped = new Map();

  for (const item of items) {
    const key = uiSafeText(getKey(item), "General");
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }

  return [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
}

function renderResourceOverview(areaGroups = []) {
  return `
    <div class="resource-overview" aria-label="Resumen de recursos por área">
      ${areaGroups.map(([area, list]) => `
        <a class="resource-overview__item" href="#resources-area-${escapeAttr(slugify(area))}">
          <span class="resource-overview__count">${escapeHtml(String(list.length))}</span>
          <span class="resource-overview__label">${escapeHtml(area)}</span>
        </a>
      `).join("")}
    </div>
  `;
}

function renderResourceCategory(title = "", resources = []) {
  return `
    <section class="resource-category">
      <header class="resource-category__head">
        <h3 class="resource-category__title">${escapeHtml(title)}</h3>
        <span class="resource-category__count">${escapeHtml(String(resources.length))}</span>
      </header>

      ${grid(resources.map((resource) => resourceCard(resource)).join(""), {
        className: "resource-grid",
      })}
    </section>
  `;
}

function renderResourceAreaSection(area = "", resources = [], index = 0) {
  const categoryGroups = groupBy(resources, getResourceCategory);
  const defaultOpen = index === 0 ? " open" : "";

  return `
    <details
      class="resource-area"
      id="resources-area-${escapeAttr(slugify(area))}"
      ${defaultOpen}
    >
      <summary class="resource-area__summary">
        <span>
          <span class="resource-area__eyebrow">Área</span>
          <strong>${escapeHtml(area)}</strong>
        </span>
        <span class="resource-area__meta">
          ${escapeHtml(String(resources.length))}
          ${resources.length === 1 ? "recurso" : "recursos"}
        </span>
      </summary>

      <div class="resource-area__body">
        ${categoryGroups.map(([category, list]) =>
          renderResourceCategory(category, list)
        ).join("")}
      </div>
    </details>
  `;
}

function renderResourceTopicSection(topic = "", resources = [], index = 0) {
  const defaultOpen = index === 0 ? " open" : "";

  return `
    <details
      class="resource-area"
      id="resources-topic-${escapeAttr(slugify(topic))}"
      ${defaultOpen}
    >
      <summary class="resource-area__summary">
        <span>
          <span class="resource-area__eyebrow">Categoría</span>
          <strong>${escapeHtml(topic)}</strong>
        </span>
        <span class="resource-area__meta">
          ${escapeHtml(String(resources.length))}
          ${resources.length === 1 ? "recurso" : "recursos"}
        </span>
      </summary>

      <div class="resource-area__body">
        ${grid(resources.map((resource) => resourceCard(resource)).join(""), {
          className: "resource-grid",
        })}
      </div>
    </details>
  `;
}

function slugify(value = "") {
  return uiSafeText(value, "general")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "general";
}

function routeProgress(route = null) {
  const value = Number(route?.progress ?? route?.progreso ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function isDoneStatus(status = "") {
  const value = uiSafeText(status).toLowerCase();

  return [
    "done",
    "completed",
    "complete",
    "completado",
    "finalizado",
    "logrado",
    "aprobado",
  ].includes(value);
}

function isNextStatus(status = "") {
  const value = uiSafeText(status).toLowerCase();

  return [
    "next",
    "actual",
    "active",
    "activo",
    "siguiente",
    "en proceso",
    "en-proceso",
    "proceso",
  ].includes(value);
}

function getGoalTitle(goal = {}, index = 0) {
  if (typeof goal === "string") return goal;

  return uiSafeText(
    goal.title ||
      goal.titulo ||
      goal.name ||
      goal.nombre ||
      `Objetivo ${index + 1}`,
    `Objetivo ${index + 1}`
  );
}

function getGoalDescription(goal = {}) {
  if (typeof goal === "string") return "";

  return uiSafeText(
    goal.description ||
      goal.descripcion ||
      goal.text ||
      goal.detalle ||
      goal.meta ||
      "",
    ""
  );
}

function getGoalStatus(goal = {}) {
  if (typeof goal === "string") return "";

  return uiSafeText(goal.status || goal.estado || goal.state || "");
}

function renderMiniStat(label, value, tone = "soft") {
  return `
    <div class="card card--flat">
      <div class="card__subtitle">${escapeHtml(label)}</div>
      <div class="card__title">${escapeHtml(String(value))}</div>
      <div class="chips">${chip(label, tone)}</div>
    </div>
  `;
}

/* =============================================================================
  Guardas de vista
============================================================================= */

function renderLoggedOut() {
  return {
    html: `
      <section class="stack">
        ${hero({
          badge: "Portal de estudiantes",
          icon: "🎵",
          title: "Bienvenido a Estudiantes HUB",
          text:
            "Consulta tu ruta de aprendizaje, bitácoras de clase, recursos recomendados y eventos de Musicala en un solo lugar.",
          actionsHTML: button("Entrar con Google", {
            variant: "primary",
            action: "login",
            icon: "✦",
          }),
          note:
            "Usa el correo que tengas registrado en Musicala. El correo correcto, esa leyenda urbana.",
        })}
      </section>
    `,
  };
}

function renderNoStudent(ctx = {}) {
  const message =
    ctx.lastError?.message ||
    "Tu cuenta no tiene un estudiante vinculado todavía.";

  return {
    html: `
      <section class="stack">
        ${emptyState("Sin estudiante asignado", message, {
          icon: "🔐",
          cta: {
            label: "Cerrar sesión",
            action: "logout",
          },
        })}
      </section>
    `,
  };
}

function guardContext(deps = {}) {
  const ctx = getCtx(deps);

  if (!ctx.user) {
    return renderLoggedOut();
  }

  if (!ctx.studentId || !ctx.student) {
    return renderNoStudent(ctx);
  }

  return null;
}

/* =============================================================================
  Home
============================================================================= */

async function renderHome(deps) {
  const ctx = getCtx(deps);
  const api = getApi(deps);
  const studentId = getStudentId(ctx);

  let bundle = null;

  if (typeof api.getStudentPortalHome === "function") {
    bundle = await api.getStudentPortalHome(studentId, {
      student: ctx.student,
    }).catch(() => null);
  }

  const normalized = normalizePortalBundle({
    student: ctx.student,
    ...(bundle || {}),
  });

  const student = normalized.student || ctx.student;
  const route = normalized.route || buildDefaultStudentRoute(student);
  const bitacoras = normalized.bitacoras || [];
  const resources = normalized.resources || [];
  const events = normalized.events || [];

  const lastBitacora = bitacoras[0] || null;
  const nextEvent = events[0] || null;

  // Ruta de aprendizaje real (route_templates + student_route_progress).
  let learning = null;
  if (typeof api.getStudentLearningRoute === "function") {
    learning = await api.getStudentLearningRoute(student).catch(() => null);
  }
  const hasLearning = Boolean(learning && learning.totalGoals > 0);

  const progress = hasLearning ? learning.progress : routeProgress(route);

  const heroHTML = hero({
    badge: "Tu espacio de aprendizaje",
    icon: "🎶",
    title: `Hola, ${getStudentDisplayName(student)}`,
    text:
      "Aquí puedes ver tu ruta, revisar lo trabajado en clase y encontrar recursos para practicar sin perderte en mil links, esa forma moderna de sufrir.",
    actionsHTML: `
      ${button("Ver mi ruta", {
        variant: "primary",
        route: "route",
        icon: "◇",
      })}
      ${button("Ver bitácoras", {
        variant: "ghost",
        route: "journal",
        icon: "✎",
      })}
    `,
  });

  const routeCardHeading = hasLearning
    ? (humanLabel(learning.processLabel, "") || humanLabel(learning.routeName, "Ruta de aprendizaje"))
    : (route ? (route.title || route.titulo || "Ruta de aprendizaje") : "");

  const routeCard = card({
    title: "Ruta de aprendizaje",
    subtitle: hasLearning
      ? (learning.stage
          ? `${learning.stage} · ${learning.completedGoals}/${learning.totalGoals} objetivos logrados`
          : "Tu proceso actual en Musicala.")
      : route
        ? route.description || route.descripcion || "Tu proceso actual en Musicala."
        : "Todavía no hay una ruta configurada.",
    bodyHTML: hasLearning
      ? `
        <div class="route-summary">
          <div>
            <h3 class="route-summary__title">${htmlText(routeCardHeading)}</h3>
            <div class="chips">
              ${chip(`${learning.completedGoals}/${learning.totalGoals} objetivos`, "soft")}
              ${chip(`${learning.progress}% de avance`, "purple")}
            </div>
          </div>
          ${routeProgressCircle(progress)}
        </div>
      `
      : route
      ? `
        <div class="route-summary">
          <div>
            <h3 class="route-summary__title">${htmlText(routeCardHeading)}</h3>
            <p class="route-summary__text">
              ${htmlText(humanLabel(route.processLabel || route.process?.processLabel || route.process?.label, "") || humanLabel(route.processKey || route.proceso || route.process, "Proceso general"))}
            </p>
          </div>
          ${routeProgressCircle(progress)}
        </div>
      `
      : emptyState("Ruta pendiente", "Cuando el equipo configure tu ruta, aparecerá aquí.", {
          icon: "◇",
        }),
    footerHTML: button("Abrir ruta", {
      variant: "ghost",
      route: "route",
      icon: "→",
    }),
  });

  const lastBitacoraCard = card({
    title: "Última bitácora",
    subtitle: "Lo más reciente registrado por tu docente.",
    bodyHTML: lastBitacora
      ? `
        ${journalCard(lastBitacora, {
          previewLength: 180,
          actionHTML: button("Ver", {
            variant: "ghost",
            size: "sm",
            action: "open-home-bitacora",
          }),
        })}
      `
      : emptyState(
          "Aún no hay bitácoras",
          "Cuando tus docentes registren seguimientos, aparecerán aquí.",
          { icon: "✎" }
        ),
    footerHTML: button("Ver todas", {
      variant: "ghost",
      route: "journal",
      icon: "→",
    }),
  });

  const resourcesHTML = resources.length
    ? grid(resources.slice(0, 2).map((item) => resourceCard(item)).join(""))
    : emptyState("Sin recursos todavía", "Cuando haya materiales recomendados, estarán aquí.", {
        icon: "▦",
      });

  const resourcesCard = card({
    title: "Recursos recomendados",
    subtitle: "Para practicar sin abrir 48 pestañas y fingir que eso cuenta como estudiar.",
    bodyHTML: resourcesHTML,
    footerHTML: button("Ver recursos", {
      variant: "ghost",
      route: "resources",
      icon: "→",
    }),
  });

  const eventsCard = card({
    title: "Próximo evento",
    subtitle: "Actividades o muestras importantes.",
    bodyHTML: nextEvent
      ? eventCard(nextEvent)
      : emptyState("Sin eventos próximos", "Por ahora no hay eventos publicados.", {
          icon: "◷",
        }),
    footerHTML: button("Ver eventos", {
      variant: "ghost",
      route: "events",
      icon: "→",
    }),
  });

  const worksCard = card({
    title: "Obras del proceso",
    subtitle: "Las obras que quieres trabajar, estás trabajando o ya lograste.",
    bodyHTML: `<p class="note">Incluye también tus sugerencias para que tu docente las revise.</p>`,
    footerHTML: button("Ver mis obras", { variant: "ghost", route: "works", icon: "♪" }),
  });

  const stats = grid(
    `
      ${renderMiniStat("Bitácoras", bitacoras.length, "soft")}
      ${renderMiniStat("Recursos", resources.length, "purple")}
      ${renderMiniStat("Eventos", events.length, "pink")}
    `,
    { columns: "3" }
  );

  // Badges
  const badgeData = {
    bitacoras:        bitacoras.length,
    hasRoute:         Boolean(route && (route.title || route.titulo)),
    completedGoals:   asArray(route?.goals || route?.objetivos || []).filter((g) => isDoneStatus(getGoalStatus(g))).length,
    progress,
    practiceSessions: 0,
    streak:           0,
    totalPracticeMins: 0,
    messages:         0,
  };
  const badges = computeBadges(badgeData);
  const badgesCard = renderBadgesCard(badges);

  // Acudiente/guardian simplified view
  const role = uiSafeText(ctx.accessProfile?.role || ctx.userCtx?.role || "").toLowerCase();
  const isGuardian = ["acudiente", "guardian", "parent", "padre", "madre", "apoderado"].includes(role);

  if (isGuardian) {
    const sname = getStudentDisplayName(student);
    return {
      html: `
        ${viewHeader(`Seguimiento de ${sname}`, "Panel de acudiente", { eyebrow: "Musicala · Acudientes" })}
        ${stack(`
          <div class="acudiente-hero">
            <div class="acudiente-hero__eyebrow">Seguimiento</div>
            <h2 class="acudiente-hero__title">${htmlText(sname)}</h2>
            <p class="acudiente-hero__subtitle">${htmlText(studentSubtitle({ student }))}</p>
          </div>

          <div class="grid">
            ${card({
              title: "Avance general",
              bodyHTML: `
                ${progressBar(progress, { label: `${progress}% completado` })}
                <div class="chips" style="margin-top:8px;">
                  ${chip(`${bitacoras.length} clases registradas`, "soft")}
                  ${chip(`${events.length} evento${events.length !== 1 ? "s" : ""}`, "pink")}
                </div>
              `,
              footerHTML: button("Ver ruta completa", { variant: "ghost", route: "route", icon: "→" }),
            })}

            ${lastBitacora ? card({
              title: "Última clase",
              bodyHTML: journalCard(lastBitacora, { previewLength: 160 }),
              footerHTML: button("Ver bitácoras", { variant: "ghost", route: "journal", icon: "→" }),
            }) : ""}
          </div>

          ${badgesCard}
        `)}
      `,
    };
  }

  const html = `
    ${viewHeader("Inicio", studentSubtitle({ student }), {
      eyebrow: "Estudiantes HUB",
    })}

    ${stack(`
      ${heroHTML}
      ${stats}
      ${musiProfeCtaCard()}
      ${badgesCard}
      <div class="split">
        <div class="stack">
      ${routeCard}
      ${worksCard}
          ${lastBitacoraCard}
        </div>

        <div class="stack">
          ${resourcesCard}
          ${eventsCard}
        </div>
      </div>
    `)}
  `;

  return {
    html,
    afterRender: () => {
      const buttonEl = viewRoot()?.querySelector("[data-action='open-home-bitacora']");

      if (!buttonEl || !lastBitacora) return;

      buttonEl.addEventListener("click", () => {
        openBitacoraModal(lastBitacora);
      });
    },
  };
}

/* =============================================================================
  Profile
============================================================================= */
async function renderProfile(deps) {
  const ctx = getCtx(deps);
  const student = getStudent(ctx);
  const canManageAccess = Boolean(ctx.isAdmin && ctx.studentId);

  const rows = getStudentProfileRows(student);

  const accessRows = [
    ["Correo de acceso", ctx.user?.email || ""],
    ["Rol", ctx.accessProfile?.role || ctx.userCtx?.role || ""],
    ["Estado de acceso", ctx.accessProfile?.active === false ? "Inactivo" : "Activo"],
  ].filter(([, value]) => uiSafeText(value));

  const html = `
    ${viewHeader("Mi perfil", studentSubtitle(ctx), {
      eyebrow: "Información del estudiante",
    })}

    ${stack(`
      ${profileCard(student)}

      <div class="grid">
        ${card({
          title: "Datos del estudiante",
          subtitle: "Información general registrada en Musicala.",
          bodyHTML: kvList(rows),
        })}

        ${card({
          title: "Acceso al portal",
          subtitle: "Datos de la cuenta con la que entraste.",
          bodyHTML: kvList(accessRows),
        })}
      </div>

      ${card({
        title: "Acciones",
        subtitle: "Reportes y resúmenes de tu proceso.",
        bodyHTML: `
          <div class="cluster">
            ${button("Informe mensual", { variant: "ghost", route: "report", icon: "▦" })}
            ${button("Línea del tiempo", { variant: "ghost", route: "timeline", icon: "◷" })}
          </div>
        `,
      })}

      ${canManageAccess ? card({
        title: "Correos con acceso",
        subtitle: "Vincula un correo de acudiente, familiar o prueba a este proceso.",
        bodyHTML: `
          <p class="note">Cada correo entra con Google y solo podrá ver el proceso de ${escapeHtml(getStudentDisplayName(student) || "este estudiante")}.</p>
          <div class="cluster">
            <button class="btn btn--primary" type="button" data-action="manage-portal-access">
              <span aria-hidden="true">+</span><span>Vincular correo</span>
            </button>
          </div>
        `,
      }) : ""}

      ${card({
        title: "Nota",
        subtitle: "Si algún dato no coincide, se ajusta desde el sistema interno de Musicala.",
        bodyHTML: `
          <p class="note">
            Este portal solo muestra información. Los cambios de datos, rutas y bitácoras
            los realiza el equipo autorizado desde Bitácoras de Clase.
          </p>
        `,
      })}
    `)}
  `;

  return {
    html,
    afterRender: () => {
      const manageButton = viewRoot()?.querySelector("[data-action='manage-portal-access']");
      if (manageButton) manageButton.addEventListener("click", () => openPortalAccessManager(deps));
    },
  };
}

async function openPortalAccessManager(deps) {
  const ctx = getCtx(deps);
  const api = getApi(deps);
  const studentId = getStudentId(ctx);
  if (!ctx.isAdmin || !studentId) return;

  let accesses = [];
  try {
    accesses = await api.listManagedPortalAccesses(studentId);
  } catch (error) {
    console.error("[profile] No se pudieron cargar accesos vinculados", error);
  }

  const rows = accesses.length
    ? `<div class="stack">${accesses.map((item) => `
        <div class="item-row">
          <div class="item-row__main"><strong>${escapeHtml(item.email)}</strong><span>${item.portalAccessManaged === true ? "Acceso de acudiente" : "Vinculado previamente"}</span></div>
          <button class="btn btn--ghost btn--sm" type="button" data-revoke-portal-access="${escapeAttr(item.email)}">Quitar de este estudiante</button>
        </div>`).join("")}</div>`
    : `<p class="note">Aún no hay correos adicionales vinculados desde este portal.</p>`;

  openModal({
    title: "Vincular correo",
    subtitle: "El correo podrá entrar con Google y ver solo este proceso.",
    bodyHTML: `
      <form id="portalAccessForm" class="stack">
        <label class="field"><span>Correo de Google</span><input class="input" name="email" type="email" autocomplete="email" required placeholder="familia@correo.com" /></label>
        <button class="btn btn--primary" type="submit">Vincular acceso</button>
      </form>
      <div class="stack" style="margin-top:1rem"><strong>Correos vinculados</strong>${rows}</div>`,
    focusSelector: "input[name='email']",
  });

  const modalRoot = document.querySelector("#modalRoot");
  const form = modalRoot?.querySelector("#portalAccessForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.elements.email;
    const email = String(input?.value || "").trim().toLowerCase();
    if (!email) return;
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const result = await api.linkPortalAccess({ email, studentId, linkedBy: ctx.user?.email || "" });
      deps.ui.toast(
        result?.status === "already-linked"
          ? "Ese correo ya estaba vinculado a este proceso."
          : result?.status === "student-added"
            ? "Correo vinculado a este estudiante. Conservará sus demás accesos."
          : "Correo vinculado. Ya puede entrar con Google.",
        "success"
      );
      openPortalAccessManager(deps);
    } catch (error) {
      console.error("[profile] No se pudo vincular correo", error);
      deps.ui.toast(
        error?.code === "EMAIL_LINKED_TO_ANOTHER_STUDENT"
          ? "Ese correo ya está vinculado a otro estudiante. Para proteger su acceso no lo cambiamos."
          : "No se pudo vincular el correo. Revisa que sea válido y vuelve a intentarlo.",
        "danger"
      );
      submit.disabled = false;
    }
  });

  modalRoot?.querySelectorAll("[data-revoke-portal-access]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", async () => {
      const email = buttonEl.getAttribute("data-revoke-portal-access") || "";
      if (!email || !window.confirm(`¿Quitar a ${email} solo de este estudiante? Si tiene otros hijos vinculados, conservará esos accesos.`)) return;
      buttonEl.disabled = true;
      try {
        await api.revokeManagedPortalAccess(email, studentId);
        deps.ui.toast("Acceso quitado de este estudiante.", "success");
        openPortalAccessManager(deps);
      } catch (error) {
        console.error("[profile] No se pudo quitar correo", error);
        deps.ui.toast("No se pudo quitar ese acceso.", "danger");
        buttonEl.disabled = false;
      }
    });
  });
}

/* =============================================================================
  Route
============================================================================= */

async function renderRouteView(deps) {
  const ctx = getCtx(deps);
  const api = getApi(deps);
  const studentId = getStudentId(ctx);

  let routes = [];

  if (typeof api.getStudentRoutes === "function") {
    routes = await api.getStudentRoutes(studentId).catch(() => []);
  } else if (typeof api.getStudentRoute === "function") {
    const route = await api.getStudentRoute(studentId).catch(() => null);
    routes = route ? [route] : [];
  }

  routes = normalizeStudentRoutes(routes);

  // Ruta de aprendizaje real (route_templates + student_route_progress),
  // tal como la define el equipo en "Bitácoras de Clase".
  let learning = null;
  if (typeof api.getStudentLearningRoute === "function") {
    learning = await api.getStudentLearningRoute(getStudent(ctx)).catch(() => null);
  }

  if (learning && learning.totalGoals > 0) {
    return renderLearningRoute(ctx, learning, studentId);
  }

  let mainRoute = routes[0] || null;

  if (!mainRoute) {
    mainRoute = buildDefaultStudentRoute(getStudent(ctx));
  }

  if (!mainRoute) {
    return `
      ${viewHeader("Mi ruta", studentSubtitle(ctx), {
        eyebrow: "Ruta de aprendizaje",
      })}

      ${emptyState(
        "Ruta pendiente",
        "Todavía no hay una ruta de aprendizaje configurada para este estudiante.",
        { icon: "◇" }
      )}
    `;
  }

  const progress = routeProgress(mainRoute);
  const goals = asArray(mainRoute.goals || mainRoute.objetivos);
  const milestones = asArray(mainRoute.milestones || mainRoute.hitos);

  const doneGoals = goals.filter((goal) => isDoneStatus(getGoalStatus(goal))).length;

  const summary = card({
    title: mainRoute.title || mainRoute.titulo || "Ruta de aprendizaje",
    subtitle:
      mainRoute.description ||
      mainRoute.descripcion ||
      "Objetivos, avances y próximos pasos del proceso.",
    bodyHTML: `
      <div class="route-summary">
        <div>
          <h3 class="route-summary__title">
            ${htmlText(humanLabel(mainRoute.processLabel || mainRoute.process?.processLabel || mainRoute.process?.label, "") || humanLabel(mainRoute.processKey || mainRoute.proceso || mainRoute.process, "Proceso general"))}
          </h3>

          <p class="route-summary__text">
            ${htmlText(mainRoute.description || mainRoute.descripcion || "Aquí se resume tu camino de aprendizaje en Musicala.")}
          </p>

          <div class="chips">
            ${chip(`${doneGoals}/${goals.length || 0} objetivos`, "soft")}
            ${chip(`${progress}% de avance`, "purple")}
          </div>
        </div>

        ${routeProgressCircle(progress)}
      </div>
    `,
  });

  const goalsHTML = goals.length
    ? goals.map((goal, index) => {
        const status    = getGoalStatus(goal);
        const tone      = isDoneStatus(status) ? "success" : isNextStatus(status) ? "pink" : "ghost";
        const goalTitle = getGoalTitle(goal, index);
        const evalVal   = loadAutoEval(studentId, goalTitle);

        return `
          ${itemRow({
            title:      goalTitle,
            meta:       getGoalDescription(goal) || "Objetivo de aprendizaje",
            side:       status ? status : "",
            icon:       isDoneStatus(status) ? "✓" : "○",
            className:  isNextStatus(status) ? "item--next" : "",
            actionHTML: chip(status || "En proceso", tone),
          })}
          <div class="autoeval" style="padding:4px 12px 12px 44px;">
            <span class="autoeval__label">Mi autoevaluación:</span>
            ${renderStarRating(studentId, goalTitle, evalVal)}
          </div>
        `;
      }).join("")
    : emptyState("Sin objetivos registrados", "Aún no hay objetivos específicos en esta ruta.", {
        icon: "○",
      });

  const milestonesHTML = milestones.length
    ? milestones.map((milestone, index) => {
        const title = typeof milestone === "string"
          ? milestone
          : milestone.title || milestone.titulo || milestone.name || `Paso ${index + 1}`;

        const meta = typeof milestone === "string"
          ? ""
          : milestone.description ||
            milestone.descripcion ||
            milestone.date ||
            milestone.fecha ||
            "";

        const status = typeof milestone === "string"
          ? ""
          : milestone.status || milestone.estado || "";

        return timelineItem({
          title,
          meta,
          status,
        });
      }).join("")
    : `<p class="note">Aún no hay pasos o hitos registrados.</p>`;

  const allRoutesHTML = routes.length > 1
    ? card({
        title: "Otras rutas vinculadas",
        subtitle: "Procesos adicionales del estudiante.",
        bodyHTML: `
          <div class="list">
            ${routes.slice(1).map((route) => itemRow({
              title: route.title || route.titulo || "Ruta de aprendizaje",
              meta: route.description || route.descripcion || humanLabel(route.processKey || route.proceso, "Proceso"),
              side: `${routeProgress(route)}%`,
              icon: "◇",
            })).join("")}
          </div>
        `,
      })
    : "";

  const routeHtml = `
    ${viewHeader("Mi ruta", studentSubtitle(ctx), {
      eyebrow: "Ruta de aprendizaje",
    })}

    ${stack(`
      ${summary}

      ${progressBar(progress, {
        label: "Avance general",
      })}

      <div class="grid">
        ${card({
          title: "Objetivos",
          subtitle: "Lo que estás trabajando actualmente.",
          bodyHTML: `<div class="list">${goalsHTML}</div>`,
          footerHTML: goals.length ? `<p class="note" style="font-size:0.75rem;">★ Autoevalúa tu dominio de cada objetivo con las estrellas.</p>` : "",
        })}

        ${card({
          title: "Pasos del proceso",
          subtitle: "Hitos o momentos importantes de la ruta.",
          bodyHTML: `<div class="timeline">${milestonesHTML}</div>`,
        })}
      </div>

      ${allRoutesHTML}

      ${card({
        title: "Línea del tiempo",
        subtitle: "Tu historial completo de clases, objetivos y eventos.",
        footerHTML: button("Ver mi proceso", { variant: "ghost", route: "timeline", icon: "→" }),
      })}
    `)}
  `;

  return {
    html: routeHtml,
    afterRender: () => wireAutoEval(viewRoot(), studentId),
  };
}

/* =============================================================================
  Learning route (route_templates + student_route_progress)
  Render rico: objetivos agrupados por bloque y por experiencia, con avance real.
============================================================================= */

const LEARNING_BLOCK_ICONS = {
  corporal: "◳",
  tecnico: "◆",
  teorico: "◈",
  obras: "♪",
  repertorio: "♫",
  general: "○",
};

function learningGoalRow(goal, studentId) {
  const icon = goal.done ? "✓" : goal.active ? "◉" : "○";
  const tone = goal.done ? "success" : goal.active ? "pink" : "ghost";
  const evalVal = loadAutoEval(studentId, goal.title);

  return `
    ${itemRow({
      title:      goal.title,
      meta:       goal.description || `Experiencia ${goal.experience}`,
      icon,
      className:  goal.active ? "item--next" : "",
      actionHTML: chip(goal.status || "Pendiente", tone),
    })}
    <div class="autoeval" style="padding:4px 12px 12px 44px;">
      <span class="autoeval__label">Mi autoevaluación:</span>
      ${renderStarRating(studentId, goal.title, evalVal)}
    </div>
  `;
}

function renderLearningRoute(ctx, learning, studentId) {
  const heading = humanLabel(learning.processLabel, "") || humanLabel(learning.routeName, "Ruta de aprendizaje");

  const summary = card({
    title: heading,
    subtitle: learning.stage
      ? `${learning.stage} · ${learning.completedGoals}/${learning.totalGoals} objetivos logrados`
      : "Objetivos, avances y próximos pasos del proceso.",
    bodyHTML: `
      <div class="route-summary">
        <div>
          <h3 class="route-summary__title">${htmlText(learning.routeName || "Ruta de aprendizaje")}</h3>
          <p class="route-summary__text">
            ${htmlText(learning.description || "Este es tu camino de aprendizaje en Musicala, paso a paso.")}
          </p>
          <div class="chips">
            ${chip(`${learning.completedGoals}/${learning.totalGoals} objetivos`, "soft")}
            ${chip(`${learning.progress}% de avance`, "purple")}
            ${learning.stage ? chip(learning.stage, "pink") : ""}
          </div>
        </div>
        ${routeProgressCircle(learning.progress)}
      </div>
    `,
  });

  // Bloques por componente (Corporal / Técnico / Teórico / Obras …).
  const blocksHTML = learning.blocks.length
    ? `<div class="grid">${learning.blocks.map((block) => card({
        title: `${LEARNING_BLOCK_ICONS[block.component] || "○"} ${block.label}`,
        subtitle: `${block.done}/${block.total} objetivos`,
        bodyHTML: `<div class="list">${block.goals.map((goal) => learningGoalRow(goal, studentId)).join("")}</div>`,
      })).join("")}</div>`
    : emptyState("Sin objetivos registrados", "Aún no hay objetivos específicos en esta ruta.", { icon: "○" });

  // Resumen por experiencia.
  const experiencesHTML = learning.experiences.length
    ? card({
        title: "Tus experiencias",
        subtitle: "Cómo avanza tu ruta por etapas.",
        bodyHTML: `<div class="list">${learning.experiences.map((exp) => itemRow({
          title: exp.label,
          meta: exp.description || "Etapa de tu proceso de aprendizaje.",
          side: `${exp.done}/${exp.total}`,
          icon: exp.done >= exp.total && exp.total > 0 ? "✓" : "◷",
        })).join("")}</div>`,
      })
    : "";

  const html = `
    ${viewHeader("Mi ruta", studentSubtitle(ctx), {
      eyebrow: "Ruta de aprendizaje",
    })}

    ${stack(`
      ${summary}

      ${progressBar(learning.progress, { label: "Avance general" })}

      ${blocksHTML}

      ${experiencesHTML}

      ${card({
        title: "Línea del tiempo",
        subtitle: "Tu historial completo de clases, objetivos y eventos.",
        footerHTML: button("Ver mi proceso", { variant: "ghost", route: "timeline", icon: "→" }),
      })}
    `)}
  `;

  return {
    html,
    afterRender: () => wireAutoEval(viewRoot(), studentId),
  };
}

/* =============================================================================
  Journal
============================================================================= */

/*
  El contenido de una bitácora llega como un único texto con marcadores en
  MAYÚSCULAS ("COMPONENTE CORPORAL:", "COMPONENTE TECNICO:", "CANCIONES/OBRAS:"…).
  Aquí lo partimos en secciones para mostrarlo organizado y completo.
*/
const BITACORA_SECTION_META = {
  corporal:        { label: "Corporal",          icon: "◳", tone: "blue" },
  tecnico:         { label: "Técnico",           icon: "◆", tone: "purple" },
  teorico:         { label: "Teórico",           icon: "◈", tone: "purple" },
  obras:           { label: "Canciones / Obras", icon: "♪", tone: "pink" },
  repertorio:      { label: "Repertorio",        icon: "♫", tone: "pink" },
  tarea:           { label: "Tarea para casa",   icon: "✎", tone: "soft" },
  observaciones:   { label: "Observaciones",     icon: "◎", tone: "soft" },
  recomendaciones: { label: "Recomendaciones",   icon: "★", tone: "soft" },
};

function bitacoraSectionKey(label = "") {
  const n = uiSafeText(label, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  if (n.includes("corporal")) return "corporal";
  if (n.includes("tecnic")) return "tecnico";
  if (n.includes("teoric")) return "teorico";
  if (n.includes("cancion") || n.includes("obra")) return "obras";
  if (n.includes("repertorio")) return "repertorio";
  if (n.includes("tarea")) return "tarea";
  if (n.includes("observ")) return "observaciones";
  if (n.includes("recomend")) return "recomendaciones";
  if (n.includes("docente")) return "docente";
  return "";
}

function titleCaseLabel(label = "") {
  return uiSafeText(label, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseBitacoraSections(content = "") {
  const text = uiSafeText(content, "").trim();
  if (!text) return { intro: "", sections: [] };

  const labelRe = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ]+(?:[ /][A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ]+)*)\s*:/g;
  const marks = [];
  let match;
  while ((match = labelRe.exec(text)) !== null) {
    marks.push({ label: match[1], start: match.index, vStart: match.index + match[0].length });
  }

  if (!marks.length) return { intro: text, sections: [] };

  const intro = text.slice(0, marks[0].start).trim();
  const sections = marks.map((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].start : text.length;
    return { rawLabel: mark.label, value: text.slice(mark.vStart, end).trim() };
  });

  return { intro, sections };
}

function normalizeSearchText(value = "") {
  return uiSafeText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getBitacoraSectionLabels(content = "") {
  return parseBitacoraSections(content)
    .sections
    .map((section) => {
      const key = bitacoraSectionKey(section.rawLabel);
      const meta = BITACORA_SECTION_META[key];
      return meta?.label || titleCaseLabel(section.rawLabel);
    })
    .filter(Boolean);
}

function getBitacoraMonthKey(value) {
  const date = toDateMaybe(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getBitacoraSearchText(item = {}) {
  const date = item.fechaClase || item.date || item.createdAt;
  const content = getBitacoraContent(item);
  const labels = getBitacoraSectionLabels(content);

  return normalizeSearchText(joinClean([
    getBitacoraTitle(item),
    getAuthorName(item),
    getProcessLabel(item),
    formatDate(date),
    getBitacoraMonthKey(date),
    labels.join(" "),
    content,
    asArray(item.tags).join(" "),
  ], " "));
}

function bitacoraSectionValueHTML(value = "") {
  const text = uiSafeText(value, "");
  if (!text) return `<span class="bitacora-section__empty">Sin registro</span>`;

  // Solo convertimos a lista cuando de verdad parece una enumeración corta
  // (3+ ítems breves, p. ej. acordes u obras). Así no partimos frases normales
  // que llevan comas en viñetas sueltas.
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const asList = parts.length >= 3 && parts.every((part) => part.length <= 40);

  if (asList) {
    return `<ul class="bitacora-section__list">${parts
      .map((part) => `<li>${escapeHtml(part)}</li>`)
      .join("")}</ul>`;
  }

  return `<p class="bitacora-section__text">${escapeHtml(text)}</p>`;
}

function renderBitacoraSections(content = "") {
  const { intro, sections } = parseBitacoraSections(content);

  // El docente ya se muestra en la cabecera de la tarjeta.
  const visible = sections.filter((section) => bitacoraSectionKey(section.rawLabel) !== "docente");

  if (!visible.length) {
    const text = intro || uiSafeText(content, "");
    return text
      ? `<p class="journal-card__content">${escapeHtml(text)}</p>`
      : `<p class="journal-card__content">Sin contenido registrado.</p>`;
  }

  const introHTML = intro ? `<p class="journal-card__content">${escapeHtml(intro)}</p>` : "";

  const itemsHTML = visible
    .map((section) => {
      const key = bitacoraSectionKey(section.rawLabel);
      const meta = BITACORA_SECTION_META[key] || {
        label: titleCaseLabel(section.rawLabel),
        icon: "•",
        tone: "soft",
      };

      return `
        <div class="bitacora-section bitacora-section--${meta.tone}">
          <div class="bitacora-section__head">
            <span class="bitacora-section__icon">${meta.icon}</span>
            <span class="bitacora-section__label">${escapeHtml(meta.label)}</span>
          </div>
          <div class="bitacora-section__body">${bitacoraSectionValueHTML(section.value)}</div>
        </div>
      `;
    })
    .join("");

  return `${introHTML}<div class="bitacora-sections">${itemsHTML}</div>`;
}

async function renderJournal(deps) {
  const ctx = getCtx(deps);
  const api = getApi(deps);
  const studentId = getStudentId(ctx);
  const student = getStudent(ctx);

  let rows = [];
  let journalError = null;

  const logJournalError = (error) => {
    journalError = error;
    console.warn("[views] No se pudieron cargar las bitácoras:", error);
    return [];
  };

  if (typeof api.listBitacorasByStudent === "function") {
    rows = await api.listBitacorasByStudent(studentId, {
      max: 80,
      student,
    }).catch(logJournalError);

    const fallbackId = getStudentFallbackQueryId(ctx);
    if (!rows.length && fallbackId && fallbackId !== studentId) {
      rows = await api.listBitacorasByStudent(fallbackId, {
        max: 80,
        student,
      }).catch(logJournalError);
    }
  } else if (typeof api.listJournal === "function") {
    rows = await api.listJournal(studentId, 80).catch(logJournalError);
  }

  const bitacoras = normalizeBitacoras(rows);

  if (!bitacoras.length) {
    const emptyMessage = journalError
      ? "No pudimos consultar tus bitácoras por un problema de permisos. Informa al equipo Musicala para revisar tu acceso."
      : "Cuando tus docentes registren lo trabajado en clase, aparecerá aquí.";
    return `
      ${viewHeader("Bitácora", studentSubtitle(ctx), {
        eyebrow: "Seguimiento de clases",
      })}

      ${emptyState(
        "Aún no hay bitácoras",
        emptyMessage,
        { icon: "✎" }
      )}
    `;
  }

  const latest = bitacoras[0];
  const byProcess = new Map();

  for (const item of bitacoras) {
    const process = getProcessLabel(item) || "General";

    byProcess.set(process, (byProcess.get(process) || 0) + 1);
  }

  const summary = grid(
    `
      ${renderMiniStat("Total", bitacoras.length, "soft")}
      ${renderMiniStat("Procesos", byProcess.size, "purple")}
      ${renderMiniStat("Última", formatRelativeDate(latest.fechaClase || latest.createdAt), "pink")}
    `,
    { columns: "3" }
  );

  const categoryOptions = Array.from(new Set(
    bitacoras.flatMap((item) => getBitacoraSectionLabels(getBitacoraContent(item)))
  )).sort((a, b) => a.localeCompare(b, "es"));

  const monthOptions = Array.from(new Map(
    bitacoras
      .map((item) => item.fechaClase || item.date || item.createdAt)
      .map((date) => [getBitacoraMonthKey(date), formatDate(date, "es-CO", { month: "long", year: "numeric" })])
      .filter(([key]) => Boolean(key))
  ).entries());

  const filtersHTML = `
    <div class="journal-search" role="search" aria-label="Buscar en bitácoras">
      <label class="journal-search__field" for="journalSearchInput">
        <span class="journal-search__icon" aria-hidden="true">⌕</span>
        <input
          id="journalSearchInput"
          class="journal-search__input"
          type="search"
          placeholder="Buscar por actividad, obra, docente, fecha o palabra clave"
          autocomplete="off"
          data-journal-search
        />
      </label>

      <label class="journal-search__select-wrap" for="journalCategoryFilter">
        <span class="sr-only">Categoría</span>
        <select id="journalCategoryFilter" class="journal-search__select" data-journal-category>
          <option value="">Todas las categorías</option>
          ${categoryOptions.map((label) => `<option value="${escapeAttr(normalizeSearchText(label))}">${escapeHtml(label)}</option>`).join("")}
        </select>
      </label>

      <label class="journal-search__select-wrap" for="journalMonthFilter">
        <span class="sr-only">Mes</span>
        <select id="journalMonthFilter" class="journal-search__select" data-journal-month>
          <option value="">Todas las fechas</option>
          ${monthOptions.map(([key, label]) => `<option value="${escapeAttr(key)}">${escapeHtml(label)}</option>`).join("")}
        </select>
      </label>
    </div>

    <div class="journal-search__status" data-journal-status>
      Mostrando ${escapeHtml(String(bitacoras.length))} bitácoras.
    </div>
  `;

  const listHTML = bitacoras.map((item) => {
    const id = uiSafeText(item.id);
    const date = item.fechaClase || item.date || item.createdAt;
    const author = getAuthorName(item);
    const process = getProcessLabel(item);
    const content = getBitacoraContent(item);
    const searchText = getBitacoraSearchText(item);
    const sectionFilters = getBitacoraSectionLabels(content).map(normalizeSearchText).join(" ");
    const monthKey = getBitacoraMonthKey(date);

    return `
      <article
        class="journal-card"
        data-journal-entry
        data-journal-search-text="${escapeAttr(searchText)}"
        data-journal-categories="${escapeAttr(sectionFilters)}"
        data-journal-month="${escapeAttr(monthKey)}"
      >
        <div class="journal-card__top">
          <div>
            <div class="journal-card__date">${escapeHtml(formatDate(date))}</div>
            <h3 class="journal-card__title">${htmlText(getBitacoraTitle(item))}</h3>

            <p class="journal-card__meta">
              ${htmlText(joinClean([
                author ? `Docente: ${author}` : "",
                process,
              ]) || "Registro de clase")}
            </p>
          </div>

          ${button("Ver", {
            variant: "ghost",
            size: "sm",
            action: "open-bitacora",
            className: "js-open-bitacora",
          }).replace("data-action=\"open-bitacora\"", `data-action="open-bitacora" data-bitacora-id="${escapeAttr(id)}"`)}
        </div>

        ${renderBitacoraSections(content)}

        ${
          item.tags?.length
            ? `<footer class="journal-card__footer">${tags(item.tags, "soft")}</footer>`
            : ""
        }
      </article>
    `;
  }).join("");

  return {
    html: `
      ${viewHeader("Bitácora", studentSubtitle(ctx), {
        eyebrow: "Seguimiento de clases",
      })}

      ${stack(`
        ${summary}

        ${card({
          title: "Entradas de clase",
          subtitle: "Histórico de registros pedagógicos del estudiante.",
          bodyHTML: `
            ${filtersHTML}
            <div class="stack" data-journal-list>${listHTML}</div>
            <div class="empty journal-search__empty" data-journal-empty hidden>
              <div class="empty__icon" aria-hidden="true">⌕</div>
              <h3 class="empty__title">Sin coincidencias</h3>
              <p class="empty__text">Prueba con otra palabra, categoría o fecha.</p>
            </div>
          `,
        })}
      `)}
    `,

    afterRender: () => {
      wireBitacoraModals(bitacoras);
      wireJournalSearch();
    },
  };
}

function wireJournalSearch() {
  const root = viewRoot();
  if (!root) return;

  const input = root.querySelector("[data-journal-search]");
  const category = root.querySelector("[data-journal-category]");
  const month = root.querySelector("[data-journal-month]");
  const entries = Array.from(root.querySelectorAll("[data-journal-entry]"));
  const status = root.querySelector("[data-journal-status]");
  const empty = root.querySelector("[data-journal-empty]");

  if (!entries.length || (!input && !category && !month)) return;

  const applyFilters = () => {
    const query = normalizeSearchText(input?.value || "");
    const categoryValue = category?.value || "";
    const monthValue = month?.value || "";
    let visible = 0;

    entries.forEach((entry) => {
      const text = entry.getAttribute("data-journal-search-text") || "";
      const categories = entry.getAttribute("data-journal-categories") || "";
      const entryMonth = entry.getAttribute("data-journal-month") || "";
      const matchesQuery = !query || text.includes(query);
      const matchesCategory = !categoryValue || categories.includes(categoryValue);
      const matchesMonth = !monthValue || entryMonth === monthValue;
      const shouldShow = matchesQuery && matchesCategory && matchesMonth;

      entry.hidden = !shouldShow;
      if (shouldShow) visible += 1;
    });

    if (status) {
      status.textContent = visible === entries.length
        ? `Mostrando ${entries.length} bitácoras.`
        : `${visible} de ${entries.length} bitácoras encontradas.`;
    }

    if (empty) empty.hidden = visible !== 0;
  };

  input?.addEventListener("input", applyFilters);
  category?.addEventListener("change", applyFilters);
  month?.addEventListener("change", applyFilters);
  applyFilters();
}

function wireBitacoraModals(bitacoras = []) {
  const root = viewRoot();
  if (!root) return;

  root.querySelectorAll("[data-bitacora-id]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      const id = buttonEl.getAttribute("data-bitacora-id");
      const item = bitacoras.find((entry) => entry.id === id);

      if (!item) return;

      openBitacoraModal(item);
    });
  });
}

function openBitacoraModal(item = {}) {
  const title = getBitacoraTitle(item);
  const date = item.fechaClase || item.date || item.createdAt;
  const content = getBitacoraContent(item);
  const author = getAuthorName(item);
  const process = getProcessLabel(item);
  const homework =
    item.homework ||
    item.tarea ||
    item.recommendations ||
    item.recomendaciones ||
    "";
  const observations =
    item.observations ||
    item.observaciones ||
    item.notes ||
    "";
  const attachments = asArray(item.attachments || item.adjuntos);

  const attachmentsHTML = attachments.length
    ? `
      <h3>Adjuntos</h3>
      <div class="list">
        ${attachments.map((file) => {
          const name = uiSafeText(file.name || file.filename || file.url || "Archivo");
          const url = uiSafeText(file.url || file.downloadURL || file.href || "");

          return itemRow({
            title: name,
            meta: file.type || file.mimeType || "Archivo",
            href: url || "",
            external: true,
            side: url ? "Abrir ›" : "",
            icon: "▦",
          });
        }).join("")}
      </div>
    `
    : "";

  openModal({
    title,
    subtitle: joinClean([
      formatDate(date),
      author ? `Docente: ${author}` : "",
      process,
    ]),
    bodyHTML: readBlock(`
      <h3>Registro de clase</h3>
      ${renderBitacoraSections(content)}

      ${
        homework
          ? `
            <h3>Tarea o recomendaciones</h3>
            ${paragraphize(homework)}
          `
          : ""
      }

      ${
        observations
          ? `
            <h3>Observaciones</h3>
            ${paragraphize(observations)}
          `
          : ""
      }

      ${attachmentsHTML}
    `),
    footHTML: button("Listo", {
      variant: "primary",
      action: "",
      className: "",
    }).replace("<button", "<button data-close=\"true\""),
  });
}

/* =============================================================================
  Resources
============================================================================= */
async function renderResources(deps) {
  const ctx = getCtx(deps);
  const api = getApi(deps);
  const student = getStudent(ctx);

  let items = [];

  if (typeof api.listResources === "function") {
    items = await api.listResources({
      student,
      studentId: getStudentId(ctx),
      max: 1500,
    }).catch(() => []);
  } else if (typeof api.listLibraryPins === "function") {
    items = await api.listLibraryPins(getStudentId(ctx), 1500).catch(() => []);
  }

  const resources = normalizeResources(items);

  if (!resources.length) {
    return `
      ${viewHeader("Recursos", studentSubtitle(ctx), {
        eyebrow: "Material de apoyo",
      })}

      ${emptyState(
        "Aún no hay recursos",
        "Cuando Musicala publique materiales de estudio para tu proceso, aparecerán aquí.",
        { icon: "▦" }
      )}
    `;
  }

  // Cada vez que entras a Recursos empiezas en la raíz (vista de artes).
  RES_NAV.arte = null;
  RES_NAV.area = null;
  RES_NAV.tema = null;
  RES_NAV.search = "";
  RES_NAV.tipo = "";
  RES_NAV.shown = 60;

  const tipos = [...new Set(
    resources.map((r) => uiSafeText(r.tipo || r.type)).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));

  const html = `
    ${viewHeader("Recursos", studentSubtitle(ctx), {
      eyebrow: "Material de apoyo",
    })}

    <div class="biblio">
      <div class="biblioToolbar">
        <input
          type="search"
          id="biblioSearch"
          class="biblioSearchInput"
          placeholder="Buscar en toda la biblioteca…"
          autocomplete="off"
          aria-label="Buscar recursos"
        />
        <select id="biblioTipo" class="biblioSelect" aria-label="Filtrar por tipo">
          <option value="">Tipo: todos</option>
          ${tipos.map((t) => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>
      <nav class="biblioCrumbs" id="biblioCrumbs" aria-label="Ruta de carpetas"></nav>
      <p class="biblioMeta" id="biblioMeta"></p>
      <div class="biblioGrid" id="biblioGrid"></div>
      <div class="biblioMore" id="biblioMoreWrap" hidden>
        <button class="btn btn--ghost btn--sm" id="biblioMoreBtn" type="button">Mostrar más</button>
      </div>
    </div>
  `;

  return {
    html,
    afterRender: () => wireBiblioteca(resources),
  };
}

/* =============================================================================
  Biblioteca de recursos — navegación tipo carpetas (arte → área → tema → recursos)
  Inspirada en el sistema visual del HUB de Docentes.
============================================================================= */

const RES_NAV = { arte: null, area: null, tema: null, search: "", tipo: "", shown: 60 };

function bibNorm(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Arte macro (Música / Danzas / Artes plásticas / Teatro) a partir del área.
function bibMacroArea(areaRaw) {
  const a = bibNorm(areaRaw);
  if (!a) return "General";
  if (/(sala de profesores|vacacional)/.test(a)) return "General";
  if (/(ballet|danza|baile)/.test(a)) return "Danzas";
  if (/(dibujo|pintura|escultura|plastic|manualidad|ceramica)/.test(a)) return "Artes plásticas";
  if (/(teatro|actuacion|impro|dramat)/.test(a)) return "Teatro";
  return "Música";
}

// Tono estable por carpeta para reconocerlas de un vistazo.
function bibHue(name) {
  const s = bibNorm(name || "general");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function bibEmoji(area) {
  const a = bibNorm(area);
  if (a.includes("guitarra") || a.includes("bajo")) return "🎸";
  if (a.includes("piano") || a.includes("teclado")) return "🎹";
  if (a.includes("bateria") || a.includes("percusion")) return "🥁";
  if (a.includes("violin") || a.includes("cello") || a.includes("cuerda")) return "🎻";
  if (a.includes("canto") || a.includes("voz") || a.includes("coro")) return "🎤";
  if (a.includes("danza") || a.includes("ballet") || a.includes("baile")) return "💃";
  if (a.includes("teatro")) return "🎭";
  if (a.includes("plastica") || a.includes("dibujo") || a.includes("pintura") || a.includes("arte")) return "🎨";
  if (a.includes("musica")) return "🎵";
  return "📁";
}

function bibLinkKind(url = "", titulo = "") {
  const u = bibNorm(url);
  const t = bibNorm(titulo);
  if (u.includes(".pdf") || t.includes("pdf")) return { icon: "📄", kind: "PDF" };
  if (u.includes("youtube.") || u.includes("youtu.be") || u.includes("vimeo.")) return { icon: "▶️", kind: "Video" };
  if (/\.(mp3|wav|m4a|ogg)\b/.test(u)) return { icon: "🎧", kind: "Audio" };
  if (/\.(png|jpe?g|gif|webp)\b/.test(u)) return { icon: "🖼️", kind: "Imagen" };
  if (u.includes("classroom.google")) return { icon: "🎓", kind: "Classroom" };
  if (u.includes("docs.google") || /\.(docx?|odt)\b/.test(u)) return { icon: "📝", kind: "Documento" };
  if (u.includes("drive.google")) return { icon: "📁", kind: "Archivo" };
  return { icon: "🌐", kind: "Enlace" };
}

function bibResourceLinks(resource = {}) {
  const raw = Array.isArray(resource.links) && resource.links.length
    ? resource.links
    : Array.isArray(resource.enlaces)
      ? resource.enlaces
      : [];

  const list = raw
    .map((l) => ({
      url: uiSafeText(l?.url || l?.href),
      title: uiSafeText(l?.title || l?.titulo),
    }))
    .filter((l) => /^https?:\/\//i.test(l.url));

  // Si no hay enlaces detallados, usamos el enlace principal del recurso.
  if (!list.length) {
    const main = getResourceUrl(resource);
    if (/^https?:\/\//i.test(main)) {
      list.push({ url: main, title: resource.title || resource.titulo || "Abrir recurso" });
    }
  }

  return list;
}

function renderBiblioCard(resource = {}) {
  const area = uiSafeText(resource.area || resource.instrument || resource.instrumento) || "general";
  const tema = uiSafeText(resource.tema);
  const tipo = uiSafeText(resource.tipo || resource.type);
  const desc = uiSafeText(resource.description || resource.descripcion);
  const tags = safeArray(resource.tags || resource.etiquetas).map((t) => uiSafeText(t)).filter(Boolean);
  const hue = bibHue(area);

  const linksHTML = bibResourceLinks(resource)
    .map((l, i) => {
      const label = l.title || `Recurso ${i + 1}`;
      const { icon, kind } = bibLinkKind(l.url, label);
      return `
        <a class="biblioLinkBtn" href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(label)}">
          <span class="biblioLinkIcon" aria-hidden="true">${icon}</span>
          <span class="biblioLinkInfo">
            <span class="biblioLinkKind">${escapeHtml(kind)}</span>
            <span class="biblioLinkName">${escapeHtml(label)}</span>
          </span>
          <span class="biblioLinkOpen">Abrir ↗</span>
        </a>
      `;
    })
    .join("");

  return `
    <article class="biblioCard" style="--areaHue:${hue}">
      <div class="biblioCardTop">
        <span class="biblioArea">${bibEmoji(area)} ${escapeHtml(area)}</span>
        ${tipo ? `<span class="biblioTipo">${escapeHtml(tipo)}</span>` : ""}
      </div>
      <h3 class="biblioTitle">${escapeHtml(uiSafeText(resource.title || resource.titulo) || "Sin título")}</h3>
      ${tema ? `<p class="biblioTema">📂 ${escapeHtml(tema)}</p>` : ""}
      ${desc ? `<p class="biblioDesc">${escapeHtml(desc.slice(0, 220))}</p>` : ""}
      ${tags.length ? `<div class="biblioTags">${tags.slice(0, 6).map((t) => `<span>${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      ${linksHTML ? `<div class="biblioLinks">${linksHTML}</div>` : ""}
    </article>
  `;
}

function wireBiblioteca(resources) {
  const root = viewRoot();
  if (!root) return;

  const grid = root.querySelector("#biblioGrid");
  const crumbs = root.querySelector("#biblioCrumbs");
  const meta = root.querySelector("#biblioMeta");
  const moreWrap = root.querySelector("#biblioMoreWrap");
  const searchInput = root.querySelector("#biblioSearch");
  const tipoSelect = root.querySelector("#biblioTipo");
  if (!grid) return;

  // Agrupación arte → área → tema → recursos.
  const byArte = new Map();
  for (const r of resources) {
    const arte = bibMacroArea(r.area || r.instrument || r.instrumento);
    const area = uiSafeText(r.area || r.instrument || r.instrumento) || "General";
    const tema = uiSafeText(r.tema) || "Sin tema";
    if (!byArte.has(arte)) byArte.set(arte, new Map());
    const byArea = byArte.get(arte);
    if (!byArea.has(area)) byArea.set(area, new Map());
    const temas = byArea.get(area);
    if (!temas.has(tema)) temas.set(tema, []);
    temas.get(tema).push(r);
  }

  const arteNames = [...byArte.keys()].sort((a, b) => {
    if (a === "General") return 1;
    if (b === "General") return -1;
    return a.localeCompare(b, "es");
  });

  const arteCount = (arte) =>
    [...byArte.get(arte).values()].reduce(
      (acc, temas) => acc + [...temas.values()].reduce((s, arr) => s + arr.length, 0),
      0
    );

  const folderCard = ({ emoji, name, count, sub, nav }) => `
    <button class="biblioFolder" type="button" data-nav="${escapeAttr(nav)}" style="--folderHue:${bibHue(name)}">
      <span class="biblioFolderIcon" aria-hidden="true">${emoji}</span>
      <span class="biblioFolderName">${escapeHtml(name)}</span>
      <span class="biblioFolderMeta">${sub ? `${escapeHtml(sub)} · ` : ""}${count} recurso(s)</span>
    </button>
  `;

  // Si una carpeta guardada ya no existe, vuelve al nivel válido.
  if (RES_NAV.arte && !byArte.has(RES_NAV.arte)) { RES_NAV.arte = null; RES_NAV.area = null; RES_NAV.tema = null; }
  if (RES_NAV.area && !byArte.get(RES_NAV.arte)?.has(RES_NAV.area)) { RES_NAV.area = null; RES_NAV.tema = null; }
  if (RES_NAV.tema && !byArte.get(RES_NAV.arte)?.get(RES_NAV.area)?.has(RES_NAV.tema)) { RES_NAV.tema = null; }

  const paintCrumbs = () => {
    if (!crumbs) return;
    const searching = !!bibNorm(RES_NAV.search);
    const parts = [`<button class="biblioCrumb" type="button" data-crumb="root">📚 Inicio</button>`];
    if (RES_NAV.arte) {
      parts.push(`<span class="biblioCrumbSep">›</span>`);
      parts.push((RES_NAV.area || RES_NAV.tema)
        ? `<button class="biblioCrumb" type="button" data-crumb="arte">${bibEmoji(RES_NAV.arte)} ${escapeHtml(RES_NAV.arte)}</button>`
        : `<span class="biblioCrumbHere">${bibEmoji(RES_NAV.arte)} ${escapeHtml(RES_NAV.arte)}</span>`);
    }
    if (RES_NAV.area) {
      parts.push(`<span class="biblioCrumbSep">›</span>`);
      parts.push(RES_NAV.tema
        ? `<button class="biblioCrumb" type="button" data-crumb="area">${bibEmoji(RES_NAV.area)} ${escapeHtml(RES_NAV.area)}</button>`
        : `<span class="biblioCrumbHere">${bibEmoji(RES_NAV.area)} ${escapeHtml(RES_NAV.area)}</span>`);
    }
    if (RES_NAV.tema) {
      parts.push(`<span class="biblioCrumbSep">›</span><span class="biblioCrumbHere">📂 ${escapeHtml(RES_NAV.tema)}</span>`);
    }
    if (searching) {
      parts.push(`<span class="biblioCrumbSep">›</span><span class="biblioCrumbHere">🔎 Resultados</span>`);
    }
    crumbs.innerHTML = parts.join("");
    crumbs.querySelectorAll("[data-crumb]").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.crumb === "root") {
          RES_NAV.arte = null; RES_NAV.area = null; RES_NAV.tema = null; RES_NAV.search = "";
          if (searchInput) searchInput.value = "";
        } else if (b.dataset.crumb === "arte") {
          RES_NAV.area = null; RES_NAV.tema = null;
        } else {
          RES_NAV.tema = null;
        }
        RES_NAV.shown = 60;
        paint();
      });
    });
  };

  const paintRecursos = (lista) => {
    const filtered = RES_NAV.tipo
      ? lista.filter((r) => uiSafeText(r.tipo || r.type) === RES_NAV.tipo)
      : lista;
    if (!filtered.length) {
      grid.classList.remove("biblioGridFolders");
      grid.innerHTML = `<div class="biblioEmpty"><h2>Sin resultados</h2><p>Prueba con otra búsqueda o quita los filtros.</p></div>`;
      if (moreWrap) moreWrap.hidden = true;
      return 0;
    }
    grid.classList.remove("biblioGridFolders");
    grid.innerHTML = filtered.slice(0, RES_NAV.shown).map(renderBiblioCard).join("");
    if (moreWrap) moreWrap.hidden = filtered.length <= RES_NAV.shown;
    return filtered.length;
  };

  const paint = () => {
    paintCrumbs();

    const scopeLabel = RES_NAV.tema || RES_NAV.area || RES_NAV.arte;
    if (searchInput) {
      searchInput.placeholder = scopeLabel ? `Buscar en ${scopeLabel}…` : "Buscar en toda la biblioteca…";
    }

    const term = bibNorm(RES_NAV.search);
    if (term) {
      let source = resources;
      if (RES_NAV.arte) source = source.filter((r) => bibMacroArea(r.area || r.instrument || r.instrumento) === RES_NAV.arte);
      if (RES_NAV.area) source = source.filter((r) => (uiSafeText(r.area || r.instrument || r.instrumento) || "General") === RES_NAV.area);
      if (RES_NAV.tema) source = source.filter((r) => (uiSafeText(r.tema) || "Sin tema") === RES_NAV.tema);

      const matches = source.filter((r) => {
        const hay = bibNorm([
          r.title, r.titulo, r.tema, r.area, r.tipo, r.type, r.description, r.descripcion,
          ...safeArray(r.tags || r.etiquetas),
        ].filter(Boolean).join(" "));
        return hay.includes(term);
      });
      const n = paintRecursos(matches);
      if (meta) meta.textContent = `${n} resultado(s)${scopeLabel ? ` en ${scopeLabel}` : ""}`;
      return;
    }

    if (!RES_NAV.arte) {
      grid.classList.add("biblioGridFolders");
      grid.innerHTML = arteNames.map((arte) => {
        const byArea = byArte.get(arte);
        return folderCard({ emoji: bibEmoji(arte), name: arte, count: arteCount(arte), sub: `${byArea.size} área(s)`, nav: `arte:${arte}` });
      }).join("");
      if (moreWrap) moreWrap.hidden = true;
      if (meta) meta.textContent = `${arteNames.length} arte(s) · ${resources.length} recurso(s)`;
    } else if (!RES_NAV.area) {
      const byArea = byArte.get(RES_NAV.arte);
      const areaNames = [...byArea.keys()].sort((a, b) => a.localeCompare(b, "es"));
      grid.classList.add("biblioGridFolders");
      grid.innerHTML = areaNames.map((a) => {
        const temas = byArea.get(a);
        const total = [...temas.values()].reduce((acc, arr) => acc + arr.length, 0);
        return folderCard({ emoji: bibEmoji(a), name: a, count: total, sub: `${temas.size} tema(s)`, nav: `area:${a}` });
      }).join("");
      if (moreWrap) moreWrap.hidden = true;
      if (meta) meta.textContent = `${areaNames.length} área(s)`;
    } else if (!RES_NAV.tema) {
      const temas = byArte.get(RES_NAV.arte).get(RES_NAV.area);
      const temaNames = [...temas.keys()].sort((a, b) => a.localeCompare(b, "es"));
      grid.classList.add("biblioGridFolders");
      grid.innerHTML = temaNames.map((t) =>
        folderCard({ emoji: "📂", name: t, count: temas.get(t).length, sub: "", nav: `tema:${t}` })
      ).join("");
      if (moreWrap) moreWrap.hidden = true;
      if (meta) meta.textContent = `${temaNames.length} tema(s)`;
    } else {
      const lista = byArte.get(RES_NAV.arte).get(RES_NAV.area).get(RES_NAV.tema) || [];
      const n = paintRecursos(lista);
      if (meta) meta.textContent = `${n} recurso(s)`;
    }

    grid.querySelectorAll("[data-nav]").forEach((b) => {
      b.addEventListener("click", () => {
        const [kind, ...rest] = b.dataset.nav.split(":");
        const value = rest.join(":");
        if (kind === "arte") RES_NAV.arte = value;
        else if (kind === "area") RES_NAV.area = value;
        else RES_NAV.tema = value;
        RES_NAV.shown = 60;
        paint();
      });
    });
  };

  searchInput?.addEventListener("input", (e) => {
    RES_NAV.search = e.target.value;
    RES_NAV.shown = 60;
    paint();
  });
  tipoSelect?.addEventListener("change", (e) => {
    RES_NAV.tipo = e.target.value;
    RES_NAV.shown = 60;
    paint();
  });
  moreWrap?.querySelector("#biblioMoreBtn")?.addEventListener("click", () => {
    RES_NAV.shown += 60;
    paint();
  });

  paint();
}

/* =============================================================================
  Events
============================================================================= */

async function renderEvents(deps) {
  const ctx = getCtx(deps);
  const api = getApi(deps);

  let rows = [];

  if (typeof api.listEvents === "function") {
    rows = await api.listEvents({
      max: 80,
    }).catch(() => []);
  }

  const events = normalizeEvents(rows);

  if (!events.length) {
    return `
      ${viewHeader("Eventos", studentSubtitle(ctx), {
        eyebrow: "Calendario Musicala",
      })}

      ${emptyState(
        "Aún no hay eventos",
        "Cuando Musicala registre eventos, muestras o actividades importantes, aparecerán aquí.",
        { icon: "◷" }
      )}
    `;
  }

  const cardsHTML = events.slice(0, 6).map((event) => eventCard(event)).join("");

  const listHTML = events.map((event) => {
    const id = uiSafeText(event.id);
    const when = getEventDateLabel(event);
    const place = event.location || event.lugar || "";

    return `
      <div class="item item--link" data-event-id="${escapeAttr(id)}">
        <div class="item__icon" aria-hidden="true">${htmlText(event.icon || "◷")}</div>

        <div class="item__main">
          <div class="item__title">${htmlText(event.title || event.titulo || "Evento")}</div>
          <div class="item__meta">${htmlText(joinClean([when, place]))}</div>
        </div>

        <div class="item__side">Ver ›</div>
      </div>
    `;
  }).join("");

  return {
    html: `
      ${viewHeader("Eventos", studentSubtitle(ctx), {
        eyebrow: "Calendario Musicala",
      })}

      ${stack(`
        ${grid(cardsHTML)}

        ${card({
          title: "Agenda",
          subtitle: "Eventos, muestras y actividades publicadas.",
          bodyHTML: `<div class="list">${listHTML}</div>`,
        })}
      `)}
    `,

    afterRender: () => {
      wireEventModals(events);
    },
  };
}

function wireEventModals(events = []) {
  const root = viewRoot();
  if (!root) return;

  root.querySelectorAll("[data-event-id]").forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.getAttribute("data-event-id");
      const event = events.find((entry) => entry.id === id);

      if (!event) return;

      openEventModal(event);
    });
  });
}

function openEventModal(event = {}) {
  const title = event.title || event.titulo || "Evento";
  const when = getEventDateLabel(event);
  const place = event.location || event.lugar || "";
  const description =
    event.description ||
    event.descripcion ||
    event.summary ||
    event.resumen ||
    "";
  const link = event.link || event.url || event.href || "";

  const linkHTML = link
    ? `
      <p>
        <a class="link" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">
          Abrir enlace del evento
        </a>
      </p>
    `
    : "";

  openModal({
    title,
    subtitle: joinClean([when, place]),
    bodyHTML: readBlock(`
      ${paragraphize(description, "Sin descripción registrada.")}

      ${
        place
          ? `<p><strong>Lugar:</strong> ${escapeHtml(place)}</p>`
          : ""
      }

      ${linkHTML}
    `),
    footHTML: button("Listo", {
      variant: "primary",
    }).replace("<button", "<button data-close=\"true\""),
  });
}

/* =============================================================================
  MusiProfe
============================================================================= */

/*
  Base de consejos por instrumento.
  Se selecciona uno diferente cada día basándose en el día del año.
*/
const PROFE_TIPS = {
  guitarra: [
    { topic: "Metrónomo progresivo", text: "Practica escalas a 60 BPM, subiendo 5 BPM cada vez que puedas tocarlas limpias 3 veces seguidas. La velocidad es consecuencia de la precisión, no al revés." },
    { topic: "Postura de la muñeca", text: "Revisa que tu muñeca izquierda esté recta y los dedos arqueados antes de cada sesión. Un minuto de postura correcta vale más que diez minutos de mala técnica." },
    { topic: "División por secciones", text: "Divide cada pieza en bloques de 4 compases y domínalos uno por uno antes de unirlos. Tu memoria muscular aprende fragmentos, no canciones completas." },
    { topic: "Ley del compás difícil", text: "Identifica el compás más difícil de tu pieza y empieza la práctica por ahí. Después de dominarlo, el resto fluye." },
    { topic: "Grabarte", text: "Grábate con el teléfono una vez por semana. Lo que escuchas grabado y lo que percibes mientras tocas son dos experiencias completamente distintas." },
  ],
  piano: [
    { topic: "Manos por separado", text: "Trabaja cada mano por separado el 70% del tiempo. Solo únalas cuando cada mano ya pueda tocar sola de forma fluida y precisa." },
    { topic: "Pedal al final", text: "El pedal se añade en la última etapa del aprendizaje. Practicar con pedal desde el principio oculta errores en lugar de corregirlos." },
    { topic: "Digitación fija", text: "Decide tu digitación una vez y no la cambies. Neurológicamente, variar la digitación en cada repetición duplica el tiempo de aprendizaje." },
    { topic: "Tempo lento primero", text: "Si a velocidad lenta algo suena mal, a velocidad real sonará peor. La limpieza lenta es la única garantía de limpieza rápida." },
    { topic: "Escuchar antes de tocar", text: "Escucha la pieza completa en una grabación antes de practicarla. Tu cerebro aprende más de esa escucha activa de lo que imaginas." },
  ],
  violin: [
    { topic: "El arco es el sonido", text: "El sonido del violín vive en el arco, no en los dedos. Dedica el 60% de tu práctica solo al movimiento del arco, mano derecha libre." },
    { topic: "Grabarte para afinar", text: "Grábate practicando. Tu oído en tiempo real es menos confiable de lo que crees al evaluar la afinación propia." },
    { topic: "Sin tensión en el cuello", text: "El mentón sostiene el violín, el hombro no aprieta. La tensión en el cuello acumulada durante meses termina en lesión." },
    { topic: "Cuerdas al aire primero", text: "Practica los pasajes difíciles pizzicato o solo con el arco en cuerdas al aire para separar los problemas técnicos." },
  ],
  flauta: [
    { topic: "Apoyo de aire", text: "El aire es tu instrumento, la flauta solo lo amplifica. Practica largas notas tenidas enfocándote únicamente en mantener el flujo de aire estable." },
    { topic: "Velocidad del aire", text: "Para las notas agudas necesitas más velocidad de aire, no más presión. Imagina que soplas sobre una vela sin apagarla." },
    { topic: "Sin tensión en los hombros", text: "Los hombros relajados y caídos mejoran inmediatamente la calidad del sonido. Revísalos cada 5 minutos durante la práctica." },
  ],
  canto: [
    { topic: "Calentar la voz", text: "Nunca empieces a cantar repertorio sin al menos 10 minutos de calentamiento vocal. La voz fría forzada es la causa número uno de lesiones." },
    { topic: "Hidratación", text: "Bebe agua constantemente durante el día, no solo antes de cantar. Las cuerdas vocales se hidratan desde adentro, no desde la garganta." },
    { topic: "Respiración diafragmática", text: "El apoyo del canto viene del diafragma, no del pecho. Practica respirar expandiendo el abdomen sin subir los hombros." },
    { topic: "Grábate siempre", text: "Tu percepción de tu propia voz desde adentro es radicalmente diferente a cómo suena hacia afuera. Grábate en cada sesión." },
  ],
  default: [
    { topic: "Práctica deliberada", text: "20 minutos de práctica enfocada valen más que 2 horas de repetición automática. Define qué parte específica vas a mejorar antes de sentarte." },
    { topic: "Metrónomo siempre", text: "Si algo no sale limpio a alta velocidad, baja el metrónomo al 60% de la velocidad objetivo. Más lento de lo que crees necesitar." },
    { topic: "Grabarte funciona", text: "Grábate con el teléfono una vez por semana. Lo que escuchas grabado y lo que escuchas tocando son dos experiencias completamente distintas." },
    { topic: "Descansar es practicar", text: "El aprendizaje ocurre mientras descansas, no mientras practicas. Tres sesiones de 20 min con descansos son más efectivas que una hora continua." },
    { topic: "El compás difícil primero", text: "Identifica el compás más difícil de cada pieza y empieza ahí, no por el principio. El cerebro aprende mejor lo que practica primero en la sesión." },
    { topic: "Sin piloto automático", text: "Repetir sin corregir refuerza los errores. Cada vez que algo salga mal, para, identifica dónde falló y repite solo esa parte lentamente." },
  ],
};

function getProfeTipOfDay(instrument = "") {
  const key = uiSafeText(instrument).toLowerCase();
  const bank = PROFE_TIPS[key] || PROFE_TIPS.default;
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
  );
  return bank[dayOfYear % bank.length];
}

export function generateProfeAnswer(questionId, ctx = {}, bundle = {}) {
  const student = getStudent(ctx);
  const instrument = uiSafeText(student?.instrument || student?.instrumento || "tu instrumento");
  const level     = uiSafeText(student?.level || student?.nivel || "tu nivel");
  const name      = getStudentDisplayName(student, "músico");

  const goals = safeArray(
    bundle?.route?.goals || bundle?.route?.objetivos || []
  );
  const activeGoals = goals.filter(
    (g) => !isDoneStatus(getGoalStatus(g)) || isNextStatus(getGoalStatus(g))
  );
  const nextGoal = activeGoals.find((g) => isNextStatus(getGoalStatus(g))) || activeGoals[0] || null;
  const nextGoalTitle = nextGoal ? getGoalTitle(nextGoal) : null;

  const lastBitacora = (bundle?.bitacoras || [])[0] || null;
  const lastHomework = uiSafeText(
    lastBitacora?.homework ||
    lastBitacora?.tarea ||
    lastBitacora?.recommendations ||
    lastBitacora?.recomendaciones || ""
  );

  const progress = routeProgress(bundle?.route || null);

  switch (questionId) {
    case "focus":
      return [
        nextGoalTitle
          ? `Esta semana tu prioridad clara es <strong>${escapeHtml(nextGoalTitle)}</strong>.`
          : `Repasa tus objetivos de la sección "Mi Ruta" para tener claro el foco de esta semana.`,
        lastHomework
          ? `Además, tu docente dejó pendiente: <em>"${escapeHtml(truncateText(lastHomework, 180))}"</em>. Eso va primero en cada sesión.`
          : "",
        `Para <strong>${escapeHtml(instrument)}</strong> en nivel ${escapeHtml(level)}, la clave es practicar en bloques cortos de 20-25 minutos con un objetivo claro por bloque, en lugar de sentarte sin dirección.`,
        `Termina cada sesión tocando algo que ya sabes bien. Salir de la práctica con sensación de éxito mantiene la motivación alta.`,
      ].filter(Boolean).map((p) => `<p>${p}</p>`).join("");

    case "homework":
      return lastHomework
        ? [
            `Tu docente registró lo siguiente como tarea o recomendación: <strong><em>"${escapeHtml(truncateText(lastHomework, 220))}"</em></strong>`,
            `Para practicarlo bien en <strong>${escapeHtml(instrument)}</strong>: primero léelo o tócalo lentamente sin presión. Identifica cuál es la parte más difícil. Aisla esa parte y repítela 5 veces limpia antes de volver al conjunto.`,
            `Si hay algo que no entiendes de la tarea, anótalo para preguntarle a tu docente al inicio de la siguiente clase. Llegar con preguntas concretas hace que la clase valga el doble.`,
          ].map((p) => `<p>${p}</p>`).join("")
        : `<p>No hay tarea registrada en tu última bitácora todavía. Cuando tu docente guarde la próxima, aparecerá aquí.</p><p>Mientras tanto, revisa tus objetivos en <strong>Mi Ruta</strong> y practica lo que esté marcado como <em>activo</em> o <em>siguiente</em>.</p>`;

    case "level_up":
      return [
        `Para subir de nivel en <strong>${escapeHtml(instrument)}</strong> (nivel ${escapeHtml(level)}) hay tres palancas principales que funcionan para todos los instrumentos:`,
        `<strong>1. Consistencia sobre intensidad:</strong> Practicar 4 días a la semana 30 minutos es más efectivo que 3 horas el sábado. Tu cerebro consolida el aprendizaje mientras duermes, no mientras tocas.`,
        `<strong>2. Práctica enfocada en errores:</strong> Cuando algo falle, no lo "pasas por alto" para seguir. Paras, identificas exactamente dónde se rompe, y repites solo esa parte 5-8 veces lentamente hasta que el músculo lo aprenda.`,
        `<strong>3. Escucharte desde afuera:</strong> Grábate una vez por semana y escucha críticamente. Tu percepción interna de cómo tocas es muy diferente a cómo suenas realmente. Los músicos que se graban avanzan notoriamente más rápido.`,
        progress > 0 ? `Ya llevas un ${progress}% de avance en tu ruta. Mantén ese ritmo.` : "",
      ].filter(Boolean).map((p) => `<p>${p}</p>`).join("");

    case "technique":
      const tip = getProfeTipOfDay(instrument);
      return [
        `<strong>Técnica del día · ${escapeHtml(tip.topic)}</strong>`,
        escapeHtml(tip.text),
        `Dedica al menos los primeros 10 minutos de tu sesión de hoy a trabajar específicamente este punto antes de pasar a repertorio.`,
      ].map((p) => `<p>${p}</p>`).join("");

    case "performance":
      return [
        `Prepararse para una muestra tiene su propia lógica, distinta a la práctica normal:`,
        `<strong>2 semanas antes:</strong> El repertorio debe estar "listo" técnicamente. A partir de aquí no aprendes nada nuevo, solo pulir y estabilizar.`,
        `<strong>1 semana antes:</strong> Toca la pieza completa de corrido todos los días, como si ya fuera la muestra. Si algo falla, no pares. Los errores en escena se manejan continuando, no deteniéndose.`,
        `<strong>2-3 días antes:</strong> Practica menos tiempo pero más concentrado. Fatiga y ansiedad por exceso de práctica arruinan más presentaciones que falta de preparación.`,
        `<strong>El día antes:</strong> Una pasada tranquila. Sin presión. Recuerda que el objetivo de la muestra no es ser perfecto sino compartir tu proceso.`,
        `La memoria muscular ya está ahí. Tu única tarea es no bloquearte.`,
      ].map((p) => `<p>${p}</p>`).join("");

    case "motivation":
      return [
        progress > 0
          ? `Llevas un <strong>${progress}% de avance</strong> en tu ruta de aprendizaje. Eso no es poco — es evidencia de trabajo real acumulado.`
          : `Cada clase, cada sesión de práctica se está acumulando aunque no lo notes todavía.`,
        `La desmotivación en música generalmente viene de compararse con otros o de no ver resultados inmediatos. Ninguna de las dos cosas es útil como medida.`,
        `Lo que sí funciona: <strong>medir progreso vs. tu yo de hace 3 meses</strong>, no vs. otro estudiante. Toca algo que hace 3 meses te costaba trabajo. Eso es tu progreso real.`,
        `También ayuda tener un "por qué" claro. ¿Por qué aprendes ${escapeHtml(instrument)}? Cuando la práctica se siente difícil, esa respuesta es lo que te mantiene en el camino.`,
        `Y si un día simplemente no tienes energía: toca 5 minutos algo que te guste, sin presión. Eso cuenta. Mantener el hábito en los días difíciles es más valioso que practicar perfecto los días buenos.`,
      ].map((p) => `<p>${p}</p>`).join("");

    default:
      return `<p>Selecciona una de las preguntas para recibir una respuesta personalizada.</p>`;
  }
}

async function renderMusiProfe(deps) {
  const ctx    = getCtx(deps);
  const api    = getApi(deps);
  const student  = getStudent(ctx);
  const studentId = getStudentId(ctx);
  const instrument = uiSafeText(student?.instrument || student?.instrumento || "");
  const level      = uiSafeText(student?.level || student?.nivel || "");

  let bundle = null;
  if (typeof api.getStudentPortalHome === "function") {
    bundle = await api.getStudentPortalHome(studentId, { student }).catch(() => null);
  }

  const goals = safeArray(bundle?.route?.goals || bundle?.route?.objetivos || []);
  const activeGoals = goals.filter((g) => !isDoneStatus(getGoalStatus(g)));
  const tip = getProfeTipOfDay(instrument);
  const lastBitacora = (bundle?.bitacoras || [])[0] || null;
  const lastHomework = uiSafeText(
    lastBitacora?.homework ||
    lastBitacora?.tarea ||
    lastBitacora?.recommendations ||
    lastBitacora?.recomendaciones || ""
  );

  const goalsPreviewHTML = activeGoals.length
    ? activeGoals.slice(0, 4).map((g) => {
        const status = getGoalStatus(g);
        const tone   = isNextStatus(status) ? "pink" : "soft";
        return `
          <div class="item">
            <div class="item__icon" aria-hidden="true">${isDoneStatus(status) ? "✓" : "○"}</div>
            <div class="item__main">
              <div class="item__title">${htmlText(getGoalTitle(g))}</div>
              ${getGoalDescription(g) ? `<div class="item__meta">${htmlText(truncateText(getGoalDescription(g), 90))}</div>` : ""}
            </div>
            ${status ? `<div class="item__side">${chip(status || "En proceso", tone)}</div>` : ""}
          </div>
        `;
      }).join("")
    : `<p class="note">Aún no hay objetivos activos registrados. Revisa tu ruta de aprendizaje.</p>`;

  const html = `
    ${viewHeader("MusiProfe", studentSubtitle(ctx), {
      eyebrow: "Tu asistente de práctica",
    })}

    ${stack(`
      <div class="profe-hero">
        <div class="profe-badge">
          <img class="profe-badge__avatar" src="./assets/musiprofe.png" alt="" aria-hidden="true" />
          <span>MusiProfe · Musicala</span>
        </div>

        <h2 class="hero-card__title">
          Hola, ${htmlText(getStudentDisplayName(student, "músico"))} 👋
        </h2>

        <p class="hero-card__text">
          Soy tu asistente de práctica.
          ${instrument ? `Para <strong>${escapeHtml(instrument)}</strong>` : "Para tu instrumento"}
          ${level ? ` · nivel <strong>${escapeHtml(level)}</strong>` : ""}
          tengo consejos, guías de práctica y respuestas basadas en tu proceso real en Musicala.
        </p>
      </div>

      <div class="grid">
        ${card({
          title: "Consejo del día",
          subtitle: `Técnica · ${escapeHtml(instrument || "instrumento")}`,
          bodyHTML: `
            <div class="profe-tip">
              <div class="profe-tip__label">Hoy trabaja esto</div>
              <div class="profe-tip__topic">${htmlText(tip.topic)}</div>
              <p class="profe-tip__text">${htmlText(tip.text)}</p>
            </div>
          `,
        })}

        ${card({
          title: "Tarea reciente",
          subtitle: "Lo que tu docente dejó pendiente.",
          bodyHTML: lastHomework
            ? `<div class="read"><p>${htmlText(truncateText(lastHomework, 240))}</p></div>`
            : `<p class="note">Aún no hay tarea registrada en tu última bitácora.</p>`,
        })}
      </div>

      ${card({
        title: "Tus objetivos activos",
        subtitle: `${activeGoals.length} objetivo${activeGoals.length !== 1 ? "s" : ""} en proceso.`,
        bodyHTML: `<div class="list">${goalsPreviewHTML}</div>`,
        footerHTML: button("Ver ruta completa", {
          variant: "ghost",
          route: "route",
          icon: "→",
        }),
      })}

      ${musiProfeCtaCard()}
    `)}
  `;

  return html;
}

/*
  Tarjeta simple que invita a escribirle al chat flotante de MusiProfe.
  Se usa tanto en Inicio como en la página de MusiProfe; el botón abre el
  widget flotante (manejado en app.js vía data-action="open-musiprofe").
*/
function musiProfeCtaCard() {
  return card({
    title: "Pregúntale a MusiProfe",
    subtitle: "Tu asistente de práctica, siempre a un mensaje.",
    bodyHTML: `
      <div class="profe-cta">
        <img class="profe-cta__avatar" src="./assets/musiprofe.png" alt="" aria-hidden="true" />
        <div class="profe-cta__text">
          <strong>¿Tienes una duda con algo?</strong>
          <span>Escríbele a MusiProfe y te ayudo con tu práctica, tu ruta o tu tarea — cuando quieras.</span>
        </div>
      </div>
    `,
    footerHTML: button("Escríbele a MusiProfe", {
      variant: "primary",
      action: "open-musiprofe",
      icon: "✦",
    }),
  });
}

/* =============================================================================
  Rutina Semanal
============================================================================= */

const DAYS_CONFIG = [
  { key: "lun", label: "Lunes",     abbr: "Lun" },
  { key: "mar", label: "Martes",    abbr: "Mar" },
  { key: "mie", label: "Miércoles", abbr: "Mié" },
  { key: "jue", label: "Jueves",    abbr: "Jue" },
  { key: "vie", label: "Viernes",   abbr: "Vie" },
  { key: "sab", label: "Sábado",    abbr: "Sáb" },
  { key: "dom", label: "Domingo",   abbr: "Dom" },
];

function getRoutineStorageKey(studentId = "") {
  return `musicala.rutina.${uiSafeText(studentId, "default")}`;
}

function loadRoutineSettings(studentId = "") {
  try {
    const raw = localStorage.getItem(getRoutineStorageKey(studentId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveRoutineSettings(studentId = "", settings = {}) {
  try {
    localStorage.setItem(getRoutineStorageKey(studentId), JSON.stringify(settings));
  } catch {
    // localStorage no disponible
  }
}

function buildWeeklyRoutine(goals = [], settings = {}) {
  const { hoursPerWeek = 5, selectedDays = [0, 2, 4] } = settings;
  const totalMinutes = Math.round(hoursPerWeek * 60);
  const activeDays   = selectedDays.length || 1;
  const minPerDay    = Math.round(totalMinutes / activeDays);

  // Priorizar objetivos activos/siguientes, luego el resto
  const pendingGoals = goals.filter((g) => !isDoneStatus(getGoalStatus(g)));
  const workGoals    = pendingGoals.length > 0 ? pendingGoals : goals;

  // Cuántos objetivos por día (máximo 3 para no saturar)
  const goalsPerDay = workGoals.length === 0 ? 0 : Math.min(3, Math.ceil(workGoals.length / activeDays));

  return DAYS_CONFIG.map((dayConf, dayIndex) => {
    const isActive = selectedDays.includes(dayIndex);

    if (!isActive) {
      return { ...dayConf, dayIndex, isActive: false, totalMinutes: 0, tasks: [] };
    }

    // Offset rotativo para que cada día active tenga objetivos distintos
    const activePosition = selectedDays.indexOf(dayIndex);
    const offset = (activePosition * goalsPerDay) % (workGoals.length || 1);

    const dayGoals = [];
    for (let j = 0; j < goalsPerDay; j++) {
      const g = workGoals[(offset + j) % workGoals.length];
      if (g) dayGoals.push(g);
    }

    const minPerGoal = dayGoals.length > 0 ? Math.round(minPerDay / dayGoals.length) : 0;

    return {
      ...dayConf,
      dayIndex,
      isActive: true,
      totalMinutes: minPerDay,
      tasks: dayGoals.map((g) => ({
        title:   getGoalTitle(g),
        minutes: minPerGoal,
        status:  getGoalStatus(g),
      })),
    };
  });
}

function formatMinutes(mins = 0) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function renderWeekGrid(weekDays = []) {
  const cols = weekDays.map((day) => {
    if (!day.isActive) {
      return `
        <div class="routine-day is-rest" aria-label="${escapeAttr(day.label)} — descanso">
          <div class="routine-day__head">
            <span class="routine-day__name">${escapeHtml(day.abbr)}</span>
            <span class="routine-day__time">Descanso</span>
          </div>
          <span class="routine-rest-label" aria-hidden="true">—</span>
        </div>
      `;
    }

    const tasksHTML = day.tasks.length
      ? day.tasks.map((t) => `
          <div class="routine-task">
            <div class="routine-task__title">${htmlText(t.title)}</div>
            <div class="routine-task__mins">${escapeHtml(formatMinutes(t.minutes))}</div>
          </div>
        `).join("")
      : `<p class="note" style="font-size:0.7rem;">Configura objetivos en tu ruta.</p>`;

    return `
      <div class="routine-day is-active" aria-label="${escapeAttr(day.label)} — ${escapeAttr(formatMinutes(day.totalMinutes))}">
        <div class="routine-day__head">
          <span class="routine-day__name">${escapeHtml(day.abbr)}</span>
          <span class="routine-day__time">${escapeHtml(formatMinutes(day.totalMinutes))}</span>
        </div>
        <div class="routine-day__tasks">${tasksHTML}</div>
      </div>
    `;
  }).join("");

  return `<div class="routine-week">${cols}</div>`;
}

async function renderRoutine(deps) {
  const ctx       = getCtx(deps);
  const api       = getApi(deps);
  const studentId = getStudentId(ctx);
  const student   = getStudent(ctx);

  // Cargar objetivos desde Firebase
  let goals = [];
  try {
    if (typeof api.getBestStudentRoute === "function") {
      const route = await api.getBestStudentRoute(studentId);
      goals = safeArray(route?.goals || route?.objetivos || []);
    } else if (typeof api.getStudentRoutes === "function") {
      const routes = await api.getStudentRoutes(studentId);
      const first = safeArray(routes)[0];
      goals = safeArray(first?.goals || first?.objetivos || []);
    }
  } catch {
    goals = [];
  }

  const savedSettings  = loadRoutineSettings(studentId);
  const hasRoutine     = Boolean(savedSettings);
  const defaultSettings = {
    hoursPerWeek: 5,
    selectedDays: [0, 2, 4], // Lun, Mié, Vie
  };
  const currentSettings = savedSettings || defaultSettings;
  const weekDays = buildWeeklyRoutine(goals, currentSettings);

  const activeDayCount  = currentSettings.selectedDays.length;
  const totalMinutes    = Math.round(currentSettings.hoursPerWeek * 60);
  const minPerDay       = activeDayCount > 0 ? Math.round(totalMinutes / activeDayCount) : 0;

  const daysPickerHTML = DAYS_CONFIG.map((d, i) => {
    const isOn = currentSettings.selectedDays.includes(i);
    return `
      <button
        class="day-toggle ${isOn ? "is-on" : ""}"
        type="button"
        data-day-index="${i}"
        aria-pressed="${isOn ? "true" : "false"}"
        aria-label="${escapeAttr(d.label)}"
      >
        <span class="day-toggle__abbr">${escapeHtml(d.abbr)}</span>
      </button>
    `;
  }).join("");

  const fillPct = Math.round(((currentSettings.hoursPerWeek - 1) / 19) * 100);

  const html = `
    ${viewHeader("Mi rutina", studentSubtitle(ctx), {
      eyebrow: "Práctica semanal",
    })}

    ${stack(`
      ${card({
        title: "Configura tu rutina",
        subtitle: "Dinos cuánto tiempo tienes disponible y en qué días quieres estudiar.",
        bodyHTML: `
          <div class="routine-setup" id="routineSetup">

            <div class="routine-setup__row">
              <label class="routine-label" for="hoursSlider">
                Horas de práctica por semana
              </label>
              <div class="routine-slider-wrap">
                <input
                  id="hoursSlider"
                  class="routine-slider"
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value="${currentSettings.hoursPerWeek}"
                  style="--fill: ${fillPct}%"
                  aria-label="Horas de práctica por semana"
                />
                <span class="routine-slider-val" id="hoursVal">
                  ${currentSettings.hoursPerWeek}h / sem
                </span>
              </div>
            </div>

            <div class="routine-setup__row">
              <span class="routine-label">Días de práctica</span>
              <div class="days-picker" id="daysPicker" role="group" aria-label="Selecciona los días de práctica">
                ${daysPickerHTML}
              </div>
            </div>

            <div class="cluster">
              <button class="btn btn--primary" type="button" id="btnGenerateRoutine">
                <span aria-hidden="true">⊞</span>
                <span>${hasRoutine ? "Actualizar rutina" : "Generar rutina"}</span>
              </button>
              ${hasRoutine ? `
                <button class="btn btn--ghost" type="button" id="btnClearRoutine">
                  <span>Borrar rutina</span>
                </button>
              ` : ""}
            </div>
          </div>
        `,
      })}

      ${hasRoutine ? `
        ${card({
          title: "Tu semana de estudio",
          subtitle: `${activeDayCount} día${activeDayCount !== 1 ? "s" : ""} activo${activeDayCount !== 1 ? "s" : ""} · ${formatMinutes(minPerDay)} por día · ${formatMinutes(totalMinutes)} en total`,
          bodyHTML: renderWeekGrid(weekDays),
        })}

        ${card({
          title: "Resumen",
          subtitle: "Distribución de tus objetivos en la semana.",
          bodyHTML: `
            <div class="grid grid--3">
              ${renderMiniStat("Días activos", activeDayCount, "soft")}
              ${renderMiniStat("Min. por día", minPerDay, "purple")}
              ${renderMiniStat("Total semanal", formatMinutes(totalMinutes), "pink")}
            </div>
          `,
        })}
      ` : `
        ${emptyState(
          "Aún no tienes una rutina",
          "Configura tus horas y días arriba y presiona «Generar rutina» para ver tu plan semanal.",
          { icon: "⊞" }
        )}
      `}

      ${goals.length === 0 ? `
        ${card({
          title: "Sin objetivos configurados",
          subtitle: "La rutina se distribuye según tus objetivos de aprendizaje.",
          bodyHTML: `
            <p class="note">
              Aún no tienes objetivos registrados en tu ruta. Cuando tu docente los configure,
              la rutina los incluirá automáticamente con tiempos asignados por componente.
            </p>
          `,
          footerHTML: button("Ver mi ruta", {
            variant: "ghost",
            route: "route",
            icon: "→",
          }),
        })}
      ` : ""}
    `)}
  `;

  return {
    html,

    afterRender: () => {
      // --- Slider de horas ---
      const slider   = document.getElementById("hoursSlider");
      const hoursVal = document.getElementById("hoursVal");

      function updateSlider() {
        if (!slider || !hoursVal) return;
        const val = parseFloat(slider.value);
        const pct = Math.round(((val - 1) / 19) * 100);
        slider.style.setProperty("--fill", `${pct}%`);
        hoursVal.textContent = `${val}h / sem`;
      }

      slider?.addEventListener("input", updateSlider);

      // --- Selector de días ---
      const daysPicker  = document.getElementById("daysPicker");
      const selectedSet = new Set(currentSettings.selectedDays);

      daysPicker?.querySelectorAll(".day-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.getAttribute("data-day-index"), 10);
          if (selectedSet.has(idx)) {
            if (selectedSet.size <= 1) return; // mínimo 1 día
            selectedSet.delete(idx);
            btn.classList.remove("is-on");
            btn.setAttribute("aria-pressed", "false");
          } else {
            selectedSet.add(idx);
            btn.classList.add("is-on");
            btn.setAttribute("aria-pressed", "true");
          }
        });
      });

      // --- Generar rutina ---
      document.getElementById("btnGenerateRoutine")?.addEventListener("click", () => {
        const newSettings = {
          hoursPerWeek: parseFloat(slider?.value ?? currentSettings.hoursPerWeek),
          selectedDays:  [...selectedSet].sort((a, b) => a - b),
        };
        saveRoutineSettings(studentId, newSettings);
        // Re-render la vista
        deps.actions?.reload?.();
      });

      // --- Borrar rutina ---
      document.getElementById("btnClearRoutine")?.addEventListener("click", () => {
        try {
          localStorage.removeItem(getRoutineStorageKey(studentId));
        } catch { /* noop */ }
        deps.actions?.reload?.();
      });
    },
  };
}

/* =============================================================================
  Badges / Logros
============================================================================= */

const BADGE_DEFS = [
  { id: "first_class",    icon: "🎵", label: "Primera clase",      desc: "Registraste tu primera bitácora.",             check: (d) => d.bitacoras >= 1 },
  { id: "ten_classes",    icon: "🎶", label: "10 clases",           desc: "Llevas 10 clases registradas.",                check: (d) => d.bitacoras >= 10 },
  { id: "route_started",  icon: "◇",  label: "Ruta iniciada",       desc: "Tienes una ruta de aprendizaje activa.",       check: (d) => d.hasRoute },
  { id: "first_goal",     icon: "✓",  label: "Primer objetivo",      desc: "Completaste tu primer objetivo.",             check: (d) => d.completedGoals >= 1 },
  { id: "half_route",     icon: "⬛",  label: "Mitad del camino",     desc: "Más del 50% de avance en tu ruta.",           check: (d) => d.progress >= 50 },
  { id: "route_done",     icon: "🏆",  label: "Ruta completada",      desc: "Completaste una ruta de aprendizaje.",        check: (d) => d.progress >= 100 },
  { id: "first_practice", icon: "⊙",  label: "Diario iniciado",      desc: "Registraste tu primera sesión de práctica.", check: (d) => d.practiceSessions >= 1 },
  { id: "week_streak",    icon: "🔥", label: "Racha de 7 días",      desc: "Practicaste 7 días seguidos.",                check: (d) => d.streak >= 7 },
  { id: "hundred_mins",   icon: "⏱",  label: "100 minutos",          desc: "Acumulaste 100 min de práctica propia.",      check: (d) => d.totalPracticeMins >= 100 },
  { id: "first_message",  icon: "✉",  label: "Primer mensaje",       desc: "Enviaste tu primer mensaje al docente.",      check: (d) => d.messages >= 1 },
];

function computeBadges(data = {}) {
  return BADGE_DEFS.map((def) => ({
    ...def,
    unlocked: Boolean(def.check(data)),
  }));
}

function renderBadgesCard(badges = []) {
  const unlocked = badges.filter((b) => b.unlocked).length;

  return card({
    title: `Logros (${unlocked}/${badges.length})`,
    subtitle: "Reconocimientos por tus avances en Musicala.",
    bodyHTML: `
      <div class="badges-grid">
        ${badges.map((b) => `
          <div class="badge-card ${b.unlocked ? "is-unlocked" : "is-locked"}" title="${escapeAttr(b.desc)}">
            <div class="badge-card__icon" aria-hidden="true">${escapeHtml(b.icon)}</div>
            <div class="badge-card__label">${htmlText(b.label)}</div>
            ${!b.unlocked ? `<div class="badge-card__lock" aria-hidden="true">🔒</div>` : ""}
          </div>
        `).join("")}
      </div>
    `,
  });
}

/* =============================================================================
  Autoevaluación
============================================================================= */

function getAutoEvalKey(studentId, goalTitle) {
  const hash = uiSafeText(goalTitle)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40);
  return `musicala.autoeval.${uiSafeText(studentId)}.${hash}`;
}

function loadAutoEval(studentId, goalTitle) {
  try {
    const v = parseInt(localStorage.getItem(getAutoEvalKey(studentId, goalTitle)), 10);
    return Number.isFinite(v) && v >= 1 && v <= 5 ? v : 0;
  } catch { return 0; }
}

function saveAutoEval(studentId, goalTitle, stars) {
  try {
    localStorage.setItem(getAutoEvalKey(studentId, goalTitle), String(stars));
  } catch { /* noop */ }
}

const STAR_LABELS = ["", "Iniciando", "En progreso", "Bien", "Muy bien", "Dominado"];

function renderStarRating(studentId, goalTitle, currentVal = 0) {
  const safeKey = escapeAttr(`${studentId}::${goalTitle}`);
  return `
    <div class="star-rating" data-autoeval-key="${safeKey}">
      ${[1, 2, 3, 4, 5].map((n) => `
        <button
          class="star-btn ${n <= currentVal ? "is-active" : ""}"
          type="button"
          data-star="${n}"
          data-autoeval="${safeKey}"
          aria-label="${n} de 5 estrellas"
          aria-pressed="${n <= currentVal}"
        >★</button>
      `).join("")}
      <span class="star-rating__label" id="ae-label-${safeKey}">
        ${escapeHtml(currentVal > 0 ? STAR_LABELS[currentVal] : "Sin evaluar")}
      </span>
    </div>
  `;
}

function wireAutoEval(rootEl, studentId) {
  if (!rootEl) return;
  rootEl.querySelectorAll(".star-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-autoeval");
      const stars = parseInt(btn.getAttribute("data-star"), 10);
      const allBtns = rootEl.querySelectorAll(`.star-btn[data-autoeval="${CSS.escape(key)}"]`);

      allBtns.forEach((b) => {
        const n = parseInt(b.getAttribute("data-star"), 10);
        b.classList.toggle("is-active", n <= stars);
        b.setAttribute("aria-pressed", n <= stars ? "true" : "false");
      });

      const [sid, ...titleParts] = key.split("::");
      const goalTitle = titleParts.join("::");
      saveAutoEval(sid, goalTitle, stars);

      const labelEl = rootEl.querySelector(`#ae-label-${CSS.escape(key)}`);
      if (labelEl) labelEl.textContent = STAR_LABELS[stars] || "Sin evaluar";
    });
  });
}

/* =============================================================================
  Diario de práctica
============================================================================= */

function computePracticeStreak(logs = []) {
  if (!logs.length) return 0;

  const unique = [...new Set(
    logs
      .map((l) => { const d = l.date || l.createdAt; return d ? new Date(d).toDateString() : null; })
      .filter(Boolean)
  )].map((s) => { const d = new Date(s); d.setHours(0,0,0,0); return d; })
    .sort((a, b) => b - a);

  if (!unique.length) return 0;

  let streak = 0;
  let check = new Date(); check.setHours(0,0,0,0);

  for (const d of unique) {
    const diff = Math.round((check - d) / 86400000);
    if (diff === 0 || diff === 1) { streak++; check = d; }
    else break;
  }
  return streak;
}

function renderPracticeChart(logs = []) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push({ date: d, mins: 0, label: ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][d.getDay()] });
  }

  for (const log of logs) {
    const raw = log.date || log.createdAt;
    if (!raw) continue;
    const logDate = new Date(raw); logDate.setHours(0, 0, 0, 0);
    const slot = days.find((slot) => slot.date.getTime() === logDate.getTime());
    if (slot) slot.mins += Number(log.minutes) || 0;
  }

  const max = Math.max(...days.map((d) => d.mins), 1);

  return `
    <div class="practice-chart" aria-label="Práctica últimos 7 días">
      ${days.map((d) => {
        const pct = Math.round((d.mins / max) * 100);
        return `
          <div class="practice-bar-wrap">
            <div class="practice-bar" style="--h: ${pct}%" title="${escapeAttr(d.label + ": " + formatMinutes(d.mins))}">
              ${d.mins > 0 ? `<span class="practice-bar__label">${escapeHtml(formatMinutes(d.mins))}</span>` : ""}
            </div>
            <span class="practice-bar__day">${escapeHtml(d.label)}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function wirePracticeView(deps, logs = []) {
  const api = getApi(deps);
  const ctx = getCtx(deps);
  const studentId = getStudentId(ctx);

  // Slider
  const slider = document.getElementById("practiceMinutes");
  const minsLabel = document.getElementById("practiceMinsLabel");
  slider?.addEventListener("input", () => {
    const v = parseInt(slider.value, 10);
    if (minsLabel) minsLabel.textContent = `${v} min`;
    const pct = Math.round(((v - 5) / 115) * 100);
    slider.style.setProperty("--fill", `${pct}%`);
  });

  // Mood picker
  let selectedMood = "😐";
  const moodPicker = document.getElementById("moodPicker");
  moodPicker?.querySelectorAll(".mood-btn").forEach((btn) => {
    if (btn.classList.contains("is-selected")) selectedMood = btn.getAttribute("data-mood") || "😐";
    btn.addEventListener("click", () => {
      moodPicker.querySelectorAll(".mood-btn").forEach((b) => {
        b.classList.remove("is-selected");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("is-selected");
      btn.setAttribute("aria-pressed", "true");
      selectedMood = btn.getAttribute("data-mood") || "😐";
    });
  });

  // Save form
  document.getElementById("practiceForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btnSavePractice");
    if (btn) btn.disabled = true;

    const date   = document.getElementById("practiceDate")?.value || new Date().toISOString().slice(0, 10);
    const minutes = parseInt(slider?.value || "30", 10);
    const note   = (document.getElementById("practiceNote")?.value || "").slice(0, 400);

    try {
      if (typeof api.createPracticeLog === "function") {
        await api.createPracticeLog(studentId, { date, minutes, mood: selectedMood, note });
      }
      deps.actions?.reload?.();
    } catch (err) {
      console.error("[practice] Error guardando:", err);
      if (btn) btn.disabled = false;
    }
  });

  // Delete
  document.querySelectorAll("[data-delete-log]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const logId = btn.getAttribute("data-delete-log");
      if (!logId) return;
      try {
        if (typeof api.deletePracticeLog === "function") await api.deletePracticeLog(logId);
        deps.actions?.reload?.();
      } catch { /* noop */ }
    });
  });
}

async function renderPractice(deps) {
  const ctx       = getCtx(deps);
  const api       = getApi(deps);
  const studentId = getStudentId(ctx);

  let logs = [];
  if (typeof api.listPracticeLogs === "function") {
    logs = await api.listPracticeLogs(studentId, { max: 60 }).catch(() => []);
  }

  const totalSessions    = logs.length;
  const totalMinutes     = logs.reduce((s, l) => s + (Number(l.minutes) || 0), 0);
  const streak           = computePracticeStreak(logs);
  const today            = new Date().toISOString().slice(0, 10);
  const todayFill        = 21; // 30min → (30-5)/115*100

  const historyHTML = totalSessions
    ? logs.slice(0, 30).map((log) => {
        const id    = escapeAttr(log.id || "");
        const mood  = escapeHtml(uiSafeText(log.mood || "") || "🎵");
        const note  = uiSafeText(log.note || log.notes || "");
        const mins  = Number(log.minutes) || 0;
        const date  = formatDate(log.date || log.createdAt);
        return `
          <div class="practice-log-item">
            <div class="practice-log-item__left">
              <span class="practice-log-item__mood" aria-hidden="true">${mood}</span>
              <div>
                <div class="practice-log-item__date">${escapeHtml(date)}</div>
                ${note ? `<div class="practice-log-item__note">${htmlText(truncateText(note, 120))}</div>` : ""}
              </div>
            </div>
            <div class="practice-log-item__right">
              <span class="practice-log-item__mins">${escapeHtml(formatMinutes(mins))}</span>
              ${id ? `<button class="icon-btn" type="button" data-delete-log="${id}" aria-label="Eliminar registro">×</button>` : ""}
            </div>
          </div>
        `;
      }).join("")
    : emptyState("Sin registros todavía", "Registra tu primera sesión de práctica arriba.", { icon: "⊙" });

  const html = `
    ${viewHeader("Diario de práctica", studentSubtitle(ctx), { eyebrow: "Tu práctica diaria" })}

    ${stack(`
      <div class="grid grid--3">
        ${renderMiniStat("Sesiones", totalSessions, "soft")}
        ${renderMiniStat("Total", formatMinutes(totalMinutes), "purple")}
        ${renderMiniStat("Racha", streak > 0 ? `${streak} día${streak !== 1 ? "s" : ""}` : "0 días", "pink")}
      </div>

      ${card({
        title: "Registrar práctica",
        subtitle: "¿Cuánto practicaste hoy?",
        bodyHTML: `
          <form class="practice-form" id="practiceForm" novalidate>
            <div class="practice-form__row">
              <label class="practice-form__label" for="practiceDate">Fecha</label>
              <input id="practiceDate" class="practice-form__input" type="date"
                value="${today}" max="${today}" />
            </div>

            <div class="practice-form__row">
              <label class="practice-form__label" for="practiceMinutes">
                Tiempo practicado: <span id="practiceMinsLabel">30 min</span>
              </label>
              <input id="practiceMinutes" class="routine-slider" type="range"
                min="5" max="120" step="5" value="30"
                style="--fill: ${todayFill}%" aria-label="Minutos de práctica" />
            </div>

            <div class="practice-form__row">
              <label class="practice-form__label">¿Cómo estuvo la sesión?</label>
              <div class="mood-picker" id="moodPicker" role="group" aria-label="Estado de ánimo">
                ${["😴","😕","😐","🙂","🔥"].map((emoji, i) => `
                  <button class="mood-btn ${i === 2 ? "is-selected" : ""}" type="button"
                    data-mood="${emoji}"
                    aria-label="${["Muy difícil","Difícil","Normal","Bien","Excelente"][i]}"
                    aria-pressed="${i === 2 ? "true" : "false"}">${emoji}</button>
                `).join("")}
              </div>
            </div>

            <div class="practice-form__row">
              <label class="practice-form__label" for="practiceNote">Nota (opcional)</label>
              <textarea id="practiceNote" class="chat-input" rows="2" maxlength="400"
                placeholder="¿Qué trabajaste? ¿Qué te costó más?"></textarea>
            </div>

            <button class="btn btn--primary" type="submit" id="btnSavePractice">
              <span aria-hidden="true">⊙</span>
              <span>Guardar sesión</span>
            </button>
          </form>
        `,
      })}

      ${card({
        title: "Últimos 7 días",
        subtitle: "Minutos de práctica por día.",
        bodyHTML: renderPracticeChart(logs),
      })}

      ${card({
        title: "Historial",
        subtitle: `${totalSessions} sesión${totalSessions !== 1 ? "es" : ""} registradas.`,
        bodyHTML: `<div class="practice-history">${historyHTML}</div>`,
      })}
    `)}
  `;

  return { html, afterRender: () => wirePracticeView(deps, logs) };
}

/* =============================================================================
  Mensajes
============================================================================= */

function renderChatThread(messages = [], currentUserId = "") {
  if (!messages.length) return "";
  return messages.map((msg) => {
    // Mensajes propios del estudiante: senderRole === "student"
    const role  = uiSafeText(msg.senderRole || msg.role || "");
    const isOwn = role === "student";
    const text  = uiSafeText(msg.text || msg.content || msg.message || "");
    const author = uiSafeText(msg.senderName || msg.authorName || (isOwn ? "Tú" : "Docente"));
    const date  = formatDateTime(msg.createdAt || msg.timestamp);
    return `
      <div class="chat-msg ${isOwn ? "chat-msg--own" : "chat-msg--other"}">
        ${!isOwn ? `<div class="chat-msg__author">${htmlText(author)}</div>` : ""}
        <div class="chat-msg__bubble">${htmlText(text)}</div>
        <div class="chat-msg__time">${escapeHtml(date)}</div>
      </div>
    `;
  }).join("");
}

function wireMessagesView(deps, studentId, currentUserId, conversation, teachers) {
  const api       = getApi(deps);
  const ctx       = getCtx(deps);
  const threadEl  = document.getElementById("chatThread");
  const inputEl   = document.getElementById("chatInput");
  const sendBtn   = document.getElementById("chatSend");
  const teacherSelect = document.getElementById("chatTeacher");

  const EMPTY_MSG = `<p class="note" style="text-align:center;padding:24px 0;"><strong>Elige a tu docente y empieza a comunicarte.</strong><br>Este espacio está listo para tus preguntas académicas sobre clases, ejercicios y tareas.</p>`;

  // Real-time subscription
  if (typeof api.subscribeMessages === "function") {
    _activeUnsubscribe = api.subscribeMessages(studentId, (error, msgs) => {
      if (!threadEl) return;
      if (error) { console.warn("[messages] subscribeMessages error:", error); return; }
      const html = renderChatThread(msgs || [], currentUserId);
      threadEl.innerHTML = html || EMPTY_MSG;
      threadEl.scrollTop = threadEl.scrollHeight;
      api.markTeacherMessagesRead?.(studentId).catch(() => {});
    });
  }

  if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;

  async function sendMessage() {
    const text = inputEl?.value?.trim();
    if (!text) return;
    if (sendBtn) sendBtn.disabled = true;
    try {
      const selectedEmail = teacherSelect?.value || conversation?.teacherEmail || "";
      const selected = teachers.find((item) => item.email === selectedEmail);
      if (!selectedEmail) throw new Error("Elige primero el docente que recibirá el mensaje.");
      if (selectedEmail !== conversation?.teacherEmail) {
        conversation = await api.assignMessageTeacher(studentId, selected, ctx.student || {});
      }
      if (typeof api.sendStudentMessage === "function") {
        await api.sendStudentMessage(studentId, {
          text: text.slice(0, 800),
          senderRole: "student",
          senderName: uiSafeText(ctx.user?.displayName || ctx.user?.email || "Estudiante"),
          senderEmail: uiSafeText(ctx.user?.email || ""),
          teacherEmail: selectedEmail,
        });
      }
      if (inputEl) inputEl.value = "";
    } catch (err) {
      console.error("[messages] Error enviando:", err);
      window.alert(err?.message || "No se pudo enviar el mensaje.");
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  sendBtn?.addEventListener("click", sendMessage);
  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}

async function renderMessages(deps) {
  const ctx       = getCtx(deps);
  const api       = getApi(deps);
  const studentId = getStudentId(ctx);
  const userId    = uiSafeText(ctx.user?.uid || ctx.user?.email || "");

  let messages = [];
  const [conversation, teachers] = await Promise.all([
    api.getMessageConversation?.(studentId).catch(() => null),
    api.listMessageTeachers?.().catch(() => []),
  ]);
  if (typeof api.listMessages === "function") {
    messages = await api.listMessages(studentId, 60).catch(() => []);
  }

  const threadHTML = renderChatThread(messages, userId);

  const html = `
    ${viewHeader("Mensajes", studentSubtitle(ctx), { eyebrow: "Con tu docente" })}

    ${stack(`
      ${card({
        title: conversation?.studentUnread ? "Chat con tu docente · Mensaje nuevo" : "Chat con tu docente",
        subtitle: "Mensajes y comunicados de tu proceso.",
        bodyHTML: `
          <label class="field" style="display:block;margin-bottom:14px">
            <span style="display:block;font-weight:700;margin-bottom:6px">Docente destinatario</span>
            <select class="chat-input" id="chatTeacher" aria-label="Docente destinatario">
              <option value="">Elige un docente…</option>
              ${teachers.map((teacher) => `<option value="${escapeHtml(teacher.email)}" ${conversation?.teacherEmail === teacher.email ? "selected" : ""}>${escapeHtml(teacher.name)}</option>`).join("")}
            </select>
            <small class="note">Solo este docente, tú y los administradores podrán ver la conversación.</small>
          </label>
          <div class="chat-thread" id="chatThread" aria-live="polite" aria-label="Hilo de mensajes">
            ${threadHTML || `<p class="note" style="text-align:center;padding:24px 0;"><strong>Elige a tu docente y empieza a comunicarte.</strong><br>Este espacio está listo para tus preguntas académicas sobre clases, ejercicios y tareas.</p>`}
          </div>
          <div class="chat-composer" id="chatComposer">
            <textarea
              class="chat-input" id="chatInput" rows="2" maxlength="800"
              placeholder="Escribe un mensaje a tu docente…"
              aria-label="Escribe un mensaje"
            ></textarea>
            <button class="chat-send" type="button" id="chatSend" aria-label="Enviar mensaje">
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        `,
      })}

      ${card({
        title: "Uso de este canal",
        bodyHTML: `<p class="note">Este canal es exclusivamente para preguntas académicas sobre tus clases, ejercicios, tareas y proceso de aprendizaje. Por favor, mantén siempre una comunicación respetuosa. Los temas de pagos, programación de clases, cambios de horario y demás solicitudes administrativas deben tratarse por el canal habitual de WhatsApp con nuestro equipo administrativo.</p>`,
      })}
    `)}
  `;

  return { html, afterRender: () => wireMessagesView(deps, studentId, userId, conversation, teachers) };
}

/* =============================================================================
  Línea del tiempo del proceso
============================================================================= */

async function renderTimeline(deps) {
  const ctx       = getCtx(deps);
  const api       = getApi(deps);
  const studentId = getStudentId(ctx);

  let bitacoras = [], allRoutes = [], events = [];

  await Promise.allSettled([
    (async () => {
      if (typeof api.listBitacorasByStudent === "function") {
        bitacoras = await api.listBitacorasByStudent(studentId, {
          max: 60,
          student: getStudent(ctx),
        }).catch(() => []);
      }
    })(),
    (async () => {
      if (typeof api.getStudentRoutes === "function") {
        allRoutes = await api.getStudentRoutes(studentId).catch(() => []);
      } else if (typeof api.getStudentRoute === "function") {
        const r = await api.getStudentRoute(studentId).catch(() => null);
        allRoutes = r ? [r] : [];
      }
    })(),
    (async () => {
      if (typeof api.listEvents === "function") {
        events = await api.listEvents({ max: 40 }).catch(() => []);
      }
    })(),
  ]);

  const entries = [];

  for (const b of bitacoras) {
    entries.push({
      type:   "bitacora",
      date:   b.fechaClase || b.date || b.createdAt,
      title:  getBitacoraTitle(b),
      meta:   getAuthorName(b) ? `Docente: ${getAuthorName(b)}` : getProcessLabel(b),
      detail: truncateText(getBitacoraContent(b), 200),
      icon:   "✎",
      tone:   "soft",
    });
  }

  for (const route of safeArray(allRoutes)) {
    for (const goal of safeArray(route.goals || route.objetivos || [])) {
      const completedAt = goal.completedAt || goal.doneAt || goal.fechaCompletado;
      if (isDoneStatus(getGoalStatus(goal)) && completedAt) {
        entries.push({
          type:  "goal",
          date:  completedAt,
          title: `Objetivo completado: ${getGoalTitle(goal)}`,
          meta:  uiSafeText(route.title || route.titulo || "Ruta de aprendizaje"),
          icon:  "✓",
          tone:  "success",
        });
      }
    }
  }

  for (const event of events) {
    entries.push({
      type:  "event",
      date:  event.dateStart || event.fecha || event.date,
      title: uiSafeText(event.title || event.titulo || "Evento"),
      meta:  uiSafeText(event.location || event.lugar || ""),
      icon:  "◷",
      tone:  "pink",
    });
  }

  entries.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  if (!entries.length) {
    return `
      ${viewHeader("Mi proceso", studentSubtitle(ctx), { eyebrow: "Línea del tiempo" })}
      ${emptyState("Sin historial todavía", "Cuando registres clases, completes objetivos o haya eventos, aparecerán aquí.", { icon: "◷" })}
    `;
  }

  // Agrupar por mes
  const grouped = new Map();
  for (const entry of entries) {
    const d = entry.date ? new Date(entry.date) : null;
    const key   = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "sin-fecha";
    const label = d ? d.toLocaleDateString("es-CO", { month: "long", year: "numeric" }) : "Sin fecha";
    if (!grouped.has(key)) grouped.set(key, { label, entries: [] });
    grouped.get(key).entries.push(entry);
  }

  const timelineHTML = [...grouped.values()].map((group) => `
    <div class="tl-month">
      <h3 class="tl-month__label">${escapeHtml(group.label)}</h3>
      <div class="process-timeline">
        ${group.entries.map((e) => `
          <div class="tl-item tl-item--${escapeAttr(e.tone || "soft")}">
            <div class="tl-item__dot" aria-hidden="true">${escapeHtml(e.icon)}</div>
            <div class="tl-item__body">
              <div class="tl-item__title">${htmlText(e.title)}</div>
              ${e.meta   ? `<div class="tl-item__meta">${htmlText(e.meta)}</div>`     : ""}
              ${e.detail ? `<p class="tl-item__detail">${htmlText(e.detail)}</p>`     : ""}
              ${e.date   ? `<div class="tl-item__date">${escapeHtml(formatDate(e.date))}</div>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  return `
    ${viewHeader("Mi proceso", studentSubtitle(ctx), { eyebrow: "Línea del tiempo" })}

    ${stack(`
      <div class="grid grid--3">
        ${renderMiniStat("Clases", bitacoras.length, "soft")}
        ${renderMiniStat("Eventos", events.length, "pink")}
        ${renderMiniStat("Entradas", entries.length, "purple")}
      </div>

      ${card({
        title: "Historial cronológico",
        subtitle: "Clases, objetivos completados y eventos, agrupados por mes.",
        bodyHTML: `<div class="stack">${timelineHTML}</div>`,
      })}
    `)}
  `;
}

/* =============================================================================
  Informe mensual
============================================================================= */

function wireReportView(deps, student, studentId) {
  const api = getApi(deps);

  document.getElementById("btnGenerateReport")?.addEventListener("click", async () => {
    const btn    = document.getElementById("btnGenerateReport");
    const output = document.getElementById("reportOutput");
    if (!output) return;
    if (btn) btn.disabled = true;

    const month = parseInt(document.getElementById("reportMonth")?.value ?? new Date().getMonth(), 10);
    const year  = parseInt(document.getElementById("reportYear")?.value  ?? new Date().getFullYear(), 10);

    output.innerHTML = `<div class="card card--flat"><p class="note">Generando informe…</p></div>`;

    try {
      let bitacoras = [], route = null, practiceLogs = [];

      await Promise.allSettled([
        (async () => {
          if (typeof api.listBitacorasByStudent === "function") {
            const all = await api.listBitacorasByStudent(studentId, { max: 200 }).catch(() => []);
            bitacoras = all.filter((b) => {
              const d = b.fechaClase || b.date || b.createdAt;
              if (!d) return false;
              const bd = new Date(d);
              return bd.getFullYear() === year && bd.getMonth() === month;
            });
          }
        })(),
        (async () => {
          if (typeof api.getStudentRoutes === "function") {
            const routes = await api.getStudentRoutes(studentId).catch(() => []);
            route = safeArray(routes)[0] || null;
          }
        })(),
        (async () => {
          if (typeof api.listPracticeLogs === "function") {
            const all = await api.listPracticeLogs(studentId, { max: 200 }).catch(() => []);
            practiceLogs = all.filter((l) => {
              const d = l.date || l.createdAt;
              if (!d) return false;
              const ld = new Date(d);
              return ld.getFullYear() === year && ld.getMonth() === month;
            });
          }
        })(),
      ]);

      const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
      const periodLabel      = `${MONTHS[month]} ${year}`;
      const goals            = safeArray(route?.goals || route?.objetivos || []);
      const doneGoals        = goals.filter((g) => isDoneStatus(getGoalStatus(g)));
      const totalPracticeMins = practiceLogs.reduce((s, l) => s + (Number(l.minutes) || 0), 0);
      const progress         = routeProgress(route);

      output.innerHTML = `
        <div class="report-page" id="reportPage">
          <div class="report-header">
            <div>
              <div class="report-header__eyebrow">Informe de avance · Musicala</div>
              <h2 class="report-header__title">${htmlText(getStudentDisplayName(student))}</h2>
              <div class="report-header__period">${escapeHtml(periodLabel)}</div>
            </div>
            <div class="report-header__logo" aria-hidden="true">♪</div>
          </div>

          <div class="report-section">
            <h3>Resumen del período</h3>
            <div class="grid grid--3">
              ${renderMiniStat("Clases registradas", bitacoras.length, "soft")}
              ${renderMiniStat("Objetivos completados", `${doneGoals.length}/${goals.length}`, "purple")}
              ${renderMiniStat("Práctica propia", formatMinutes(totalPracticeMins), "pink")}
            </div>
          </div>

          ${route ? `
            <div class="report-section">
              <h3>Avance en la ruta</h3>
              ${progressBar(progress, { label: "Progreso general" })}
              ${goals.length ? `
                <div class="list" style="margin-top:12px;">
                  ${goals.slice(0, 8).map((g) => {
                    const status = getGoalStatus(g);
                    return itemRow({
                      title:  getGoalTitle(g),
                      meta:   getGoalDescription(g) || "Objetivo",
                      icon:   isDoneStatus(status) ? "✓" : "○",
                      side:   status || "En proceso",
                    });
                  }).join("")}
                </div>
              ` : ""}
            </div>
          ` : ""}

          ${bitacoras.length ? `
            <div class="report-section">
              <h3>Clases del período (${bitacoras.length})</h3>
              ${bitacoras.slice(0, 8).map((b) => `
                <div style="margin-bottom:12px;padding:12px;background:var(--surface-raised);border-radius:8px;">
                  <strong>${escapeHtml(formatDate(b.fechaClase || b.date || b.createdAt))}</strong>
                  — ${htmlText(getBitacoraTitle(b))}
                  ${getBitacoraContent(b) ? `<p style="margin:4px 0 0;font-size:0.8rem;color:var(--text-secondary);">${htmlText(truncateText(getBitacoraContent(b), 200))}</p>` : ""}
                </div>
              `).join("")}
            </div>
          ` : ""}

          <div class="report-section" style="text-align:center;color:var(--text-secondary);font-size:0.75rem;margin-top:24px;">
            Generado por Estudiantes HUB · Musicala · ${new Date().toLocaleDateString("es-CO")}
          </div>
        </div>

        <div class="cluster" style="margin-top:16px;">
          <button class="btn btn--primary" type="button" id="btnPrintReport">
            <span aria-hidden="true">▦</span>
            <span>Imprimir / Guardar PDF</span>
          </button>
        </div>
      `;

      document.getElementById("btnPrintReport")?.addEventListener("click", () => window.print());

    } catch (err) {
      console.error("[report] Error:", err);
      output.innerHTML = `<div class="card card--flat"><p class="note">No se pudo generar el informe. Intenta de nuevo.</p></div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function renderReport(deps) {
  const ctx       = getCtx(deps);
  const api       = getApi(deps);
  const studentId = getStudentId(ctx);
  const student   = getStudent(ctx);

  const now  = new Date();
  const cm   = now.getMonth();
  const cy   = now.getFullYear();

  const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const monthOpts = MONTHS.map((m, i) => `<option value="${i}" ${i === cm ? "selected" : ""}>${m}</option>`).join("");
  const yearOpts  = [cy, cy - 1, cy - 2].map((y) => `<option value="${y}" ${y === cy ? "selected" : ""}>${y}</option>`).join("");

  const html = `
    ${viewHeader("Informe mensual", studentSubtitle(ctx), { eyebrow: "Reportes de avance" })}

    ${stack(`
      ${card({
        title: "Generar informe",
        subtitle: "Selecciona el período y genera tu reporte de avance.",
        bodyHTML: `
          <div class="routine-setup">
            <div class="routine-setup__row">
              <label class="routine-label" for="reportMonth">Mes</label>
              <select id="reportMonth" class="practice-form__input">${monthOpts}</select>
            </div>
            <div class="routine-setup__row">
              <label class="routine-label" for="reportYear">Año</label>
              <select id="reportYear" class="practice-form__input">${yearOpts}</select>
            </div>
            <div class="cluster">
              <button class="btn btn--primary" type="button" id="btnGenerateReport">
                <span aria-hidden="true">▦</span>
                <span>Generar informe</span>
              </button>
            </div>
          </div>
        `,
      })}

      <div id="reportOutput"></div>
    `)}
  `;

  return { html, afterRender: () => wireReportView(deps, student, studentId) };
}

function normalizedWorks(student = {}) {
  const raw = student.repertorioProceso || student.repertoireProgress || student.repertorioEscogido || student.repertoire || [];
  return (Array.isArray(raw) ? raw : [raw]).map((item) => ({
    nombre: uiSafeText(typeof item === "object" ? item.nombre || item.name || item.title : item),
    estado: uiSafeText(item?.estado || item?.status || "proceso").toLowerCase(),
  })).filter((item) => item.nombre);
}

async function renderWorks(deps) {
  const ctx = getCtx(deps);
  const api = getApi(deps);
  const student = getStudent(ctx);
  const studentId = getStudentId(ctx);
  const works = normalizedWorks(student);
  const suggestions = await api.listStudentWorkSuggestions?.(studentId).catch(() => []) || [];
  const columns = [
    ["quiere", "Quiero trabajar"], ["proceso", "Estoy trabajando"], ["lograda", "Lograda"],
  ];
  const columnHtml = columns.map(([key, label]) => {
    const items = works.filter((item) => item.estado === key);
    return `<section class="card card--flat"><h3>${label} <span class="chip chip--soft">${items.length}</span></h3>${items.length ? `<div class="list">${items.map((item) => itemRow({ title: item.nombre, icon: "♪" })).join("")}</div>` : `<p class="note">Aún no hay obras en esta etapa.</p>`}</section>`;
  }).join("");
  const html = `${viewHeader("Obras del proceso", studentSubtitle(ctx), { eyebrow: "Mi proceso" })}${stack(`
    <p class="note">Aquí ves las obras acordadas con tu docente. Puedes sugerir una nueva para que la revise antes de incorporarla al proceso.</p>
    <div class="grid">${columnHtml}</div>
    ${card({ title: "Sugeridas por mí", subtitle: "Tus propuestas pendientes de revisión.", bodyHTML: suggestions.length ? `<div class="list">${suggestions.map((item) => itemRow({ title: uiSafeText(item.nombre), meta: item.estado === "pendiente" ? "Pendiente de revisión" : uiSafeText(item.estado), icon: "✦" })).join("")}</div>` : `<p class="note">Todavía no has sugerido una obra.</p>`, footerHTML: `<div class="stack" style="gap:8px"><input id="workSuggestionName" class="field__input" maxlength="300" placeholder="Nombre de la obra"/><textarea id="workSuggestionNotes" class="field__input" rows="2" maxlength="1000" placeholder="Cuéntale brevemente por qué te interesa (opcional)"></textarea><button type="button" id="workSuggestionSave" class="btn btn--primary">Sugerir obra</button></div>` })}
  `)}`;
  return { html, afterRender: () => document.getElementById("workSuggestionSave")?.addEventListener("click", async () => {
    const button = document.getElementById("workSuggestionSave");
    try { button.disabled = true; await api.createStudentWorkSuggestion(studentId, student, { nombre: document.getElementById("workSuggestionName")?.value, notas: document.getElementById("workSuggestionNotes")?.value }); window.location.hash = "#/works"; }
    catch (error) { window.alert(error?.message || "No se pudo enviar la sugerencia."); }
    finally { button.disabled = false; }
  }) };
}

/* =============================================================================
  Public API
============================================================================= */

export async function renderRoute(route, deps = {}) {
  // Limpiar suscripción activa de la ruta anterior (ej: onSnapshot de mensajes)
  cleanupSubscription();

  const guarded = guardContext(deps);
  if (guarded) return guarded;

  try {
    switch (route) {
      case "home":
        return renderHome(deps);

      case "route":
        return renderRouteView(deps);

      case "works":
        return renderWorks(deps);

      case "journal":
        return renderJournal(deps);

      case "resources":
        return renderResources(deps);

      case "events":
        return renderEvents(deps);

      case "profile":
        return renderProfile(deps);

      case "musiprofe":
        return renderMusiProfe(deps);

      case "routine":
        return renderRoutine(deps);

      case "practice":
        return renderPractice(deps);

      case "messages":
        return renderMessages(deps);

      case "timeline":
        return renderTimeline(deps);

      case "report":
        return renderReport(deps);

      /*
        Compatibilidad con rutas viejas.
      */
      case "classes":
        return renderJournal(deps);

      case "library":
        return renderResources(deps);

      case "calendar":
      case "showcases":
        return renderEvents(deps);

      default:
        return renderHome(deps);
    }
  } catch (error) {
    console.error("[views] Error renderizando ruta:", route, error);

    return renderErrorState(
      "No se pudo cargar esta sección",
      error?.message || "Ocurrió un error inesperado."
    );
  }
}

export default {
  renderRoute,
};
