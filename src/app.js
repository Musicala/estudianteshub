"use strict";

/* =============================================================================
  src/app.js — Estudiantes HUB · Musicala
  Rol: Orquestador principal
  - Auth con Google
  - Resuelve acceso desde users/{email}
  - Carga estudiante vinculado
  - Conecta vistas con datos de Bitácoras de Clase
  - Maneja rutas hash
  - Maneja selector de estudiante
============================================================================= */

import {
  initAuth,
  loginGoogle,
  logout,
  humanAuthError,
} from "./auth.js";

import * as api from "./data.js";

import { renderRoute } from "./views.js";

import { createMusiProfeChat } from "./musiprofe.js";

import {
  $,
  toast,
  banner,
  openModal,
  closeModal,
  wireModal,
  setActiveNav,
  renderLoading,
  escapeHtml,
} from "./ui.js";

import {
  dedupeStudents,
  getCanonicalStudentKey,
  normalizeEmail as normalizeStudentEmail,
} from "./normalizers.js";

/* =============================================================================
  Configuración local
============================================================================= */

const APP = Object.freeze({
  name: "Estudiantes HUB · Musicala",
  build: "2026.05.estudiantes-hub.v2-musiprofe-rutina",

  defaultRoute: "home",
  authWaitMs: 12000,

  routes: Object.freeze([
    "home",
    "route",
    "journal",
    "resources",
    "events",
    "profile",
    "musiprofe",
    "routine",
    "practice",
    "messages",
    "timeline",
    "report",
  ]),

  routeAliases: Object.freeze({
    inicio: "home",
    ruta: "route",
    bitacora: "journal",
    bitácora: "journal",
    recursos: "resources",
    eventos: "events",
    perfil: "profile",
    profe: "musiprofe",
    "musi-profe": "musiprofe",
    coach: "musiprofe",
    rutina: "routine",
    "mi-rutina": "routine",
    semana: "routine",
    diario: "practice",
    practica: "practice",
    mensajes: "messages",
    chat: "messages",
    "linea-del-tiempo": "timeline",
    historial: "timeline",
    reporte: "report",
    informe: "report",

    // Compatibilidad con versiones anteriores
    classes: "journal",
    library: "resources",
    calendar: "events",
    showcases: "events",
    info: "profile",
  }),

  storageKeys: Object.freeze({
    activeStudentId: "musicala.estudiantesHub.activeStudentId",
    lastRoute: "musicala.estudiantesHub.lastRoute",
  }),
});

/*
  Correos con acceso de administrador garantizado, aunque todavía no exista un
  documento en users/{email}. Debe coincidir con firestore.rules (isBootstrapAdmin)
  y con ACCESS_CONFIG.bootstrapAdminEmails en config.js.
*/
const BOOTSTRAP_ADMIN_EMAILS = new Set([
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com",
  "imusicala@gmail.com",
  "musicalaasesor@gmail.com",
]);

/*
  Este hub solo usa roles de admin y estudiante.
  Los docentes trabajan desde otro hub (mismo Firestore), así que aquí solo
  reconocemos roles administrativos para habilitar "Ver como estudiante".
*/
const INTERNAL_ROLES = new Set([
  "admin",
  "administrativo",
  "direccion",
  "dirección",
]);

function isBootstrapAdminEmail(email = "") {
  return BOOTSTRAP_ADMIN_EMAILS.has(normalizeEmail(email));
}

/*
  Admin "estricto": coincide con isAdmin() de firestore.rules (correo bootstrap o
  rol "admin" activo). Se usa para habilitar acciones que escriben en users/,
  que las reglas solo permiten a admins.
*/
function isAdminUser() {
  if (isBootstrapAdminEmail(state.user?.email)) return true;

  const role = safeText(
    state.accessProfile?.role || state.accessProfile?.rol || ""
  ).toLowerCase();

  return role === "admin" && state.accessProfile?.active !== false;
}

/* =============================================================================
  DOM
============================================================================= */

const els = {
  view: $("#view"),
  bannerArea: $("#bannerArea"),

  btnLogin: $("#btnLogin"),
  btnLogout: $("#btnLogout"),

  userBadge: $("#userBadge"),
  userAvatar: $("#userAvatar"),
  userInitials: $("#userInitials"),
  userName: $("#userName"),
  userEmail: $("#userEmail"),

  studentPickerBtn: $("#studentPickerBtn"),
  studentPickerLabel: $("#studentPickerLabel"),

  viewAsBtn: $("#viewAsBtn"),
  musiprofeFab: $("#musiprofeFab"),
};

/* =============================================================================
  Estado global
============================================================================= */

const state = {
  isBooted: false,
  isRendering: false,

  user: null,
  accessProfile: null,

  studentIds: [],
  studentId: null,
  student: null,

  // Modo "Ver como estudiante" para admins/docentes
  viewAsStudentId: null,
  allStudents: null,

  studentsById: new Map(),

  currentRoute: APP.defaultRoute,
  lastError: null,
};

/* =============================================================================
  Helpers generales
============================================================================= */

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeEmail(email) {
  return normalizeStudentEmail(email);
}

function getInitials(nameOrEmail = "") {
  const raw = safeText(nameOrEmail, "U");

  const cleaned = raw
    .replace(/@.*/, "")
    .replace(/[._-]+/g, " ")
    .trim();

  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (!parts.length) return "U";

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function getStudentName(student = null, fallback = "Estudiante") {
  return safeText(
    student?.displayName ||
      student?.nombre ||
      student?.name ||
      student?.fullName ||
      student?.studentName,
    fallback
  );
}

function getStudentMeta(student = null) {
  return [
    student?.instrument,
    student?.instrumento,
    student?.program,
    student?.programa,
    student?.level,
    student?.nivel,
    student?.modality,
    student?.modalidad,
  ]
    .filter(Boolean)
    .map((item) => safeText(item))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, 3)
    .join(" · ");
}

function getStudentStatusText(student = null) {
  return safeText(
    student?.estado ||
      student?.status ||
      student?.estadoActual ||
      student?.studentStatus
  );
}

/*
  Misma política que las reglas de Firestore / el sync:
  pueden entrar al HUB los "Activo*" y los "Inactivo en pausa (1-3 meses)".
  La pausa de 3-6 meses (o más larga) NO entra.
*/
function canStudentLogIn(student = null) {
  const s = getStudentStatusText(student)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return false;

  if (
    s === "activo" ||
    s.startsWith("activo no registro") ||
    s.startsWith("activo en pausa")
  ) {
    return true;
  }

  if (s.startsWith("inactivo en pausa")) {
    return /1\s*-\s*3/.test(s) || /1\s+a\s+3/.test(s);
  }

  return false;
}

function persistActiveStudentId(studentId) {
  try {
    if (!studentId) {
      localStorage.removeItem(APP.storageKeys.activeStudentId);
      return;
    }

    localStorage.setItem(APP.storageKeys.activeStudentId, studentId);
  } catch (error) {
    console.warn("[App] No se pudo guardar estudiante activo:", error);
  }
}

function readPersistedStudentId() {
  try {
    return localStorage.getItem(APP.storageKeys.activeStudentId);
  } catch {
    return null;
  }
}

function persistLastRoute(route) {
  try {
    localStorage.setItem(APP.storageKeys.lastRoute, route);
  } catch {
    // No hacemos drama. El navegador ya hace suficiente.
  }
}

function setBusy(isBusy) {
  if (!els.view) return;
  els.view.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function resetStudentState() {
  state.accessProfile = null;
  state.studentIds = [];
  state.studentId = null;
  state.student = null;
  state.viewAsStudentId = null;
  state.allStudents = null;
  state.studentsById.clear();
}

function isInternalUser() {
  const role = safeText(
    state.accessProfile?.role || state.accessProfile?.rol || ""
  ).toLowerCase();

  return (
    INTERNAL_ROLES.has(role) || isBootstrapAdminEmail(state.user?.email)
  );
}

/* =============================================================================
  Router
============================================================================= */

function cleanHashRoute(hashValue = location.hash) {
  const hash = safeText(hashValue);

  if (!hash || hash === "#") return APP.defaultRoute;

  const withoutHash = hash.replace(/^#\/?/, "");
  const routeOnly = withoutHash.split("?")[0].split("&")[0].trim();

  return routeOnly || APP.defaultRoute;
}

function normalizeRoute(route) {
  const rawRoute = safeText(route, APP.defaultRoute);
  const aliased = APP.routeAliases[rawRoute] || rawRoute;

  if (APP.routes.includes(aliased)) return aliased;

  return APP.defaultRoute;
}

function getRoute() {
  return normalizeRoute(cleanHashRoute());
}

function goTo(route, options = {}) {
  const normalized = normalizeRoute(route);
  const targetHash = `#/${normalized}`;

  if (location.hash !== targetHash) {
    location.hash = targetHash;
    return;
  }

  if (options.force) {
    navigate().catch((error) => {
      console.error("[Router] Error forzando navegación:", error);
    });
  }
}

function ensureValidHash() {
  const route = getRoute();
  const expected = `#/${route}`;

  if (!location.hash || normalizeRoute(cleanHashRoute()) !== cleanHashRoute()) {
    history.replaceState(null, "", expected);
  }

  return route;
}

/* =============================================================================
  UI de autenticación
============================================================================= */

function setAuthUI(user) {
  const logged = Boolean(user);

  if (els.btnLogin) els.btnLogin.hidden = logged;
  if (els.btnLogout) els.btnLogout.hidden = !logged;

  if (els.userBadge) {
    els.userBadge.hidden = !logged;
  }

  if (!logged) {
    if (els.userName) els.userName.textContent = "Usuario";
    if (els.userEmail) els.userEmail.textContent = "";
    if (els.userInitials) els.userInitials.textContent = "U";
    if (els.studentPickerBtn) els.studentPickerBtn.hidden = true;
    if (els.viewAsBtn) els.viewAsBtn.hidden = true;
    if (els.musiprofeFab) els.musiprofeFab.hidden = true;
    return;
  }

  const displayName = safeText(user.displayName, "Usuario");
  const email = safeText(user.email);

  if (els.userName) els.userName.textContent = displayName;
  if (els.userEmail) els.userEmail.textContent = email;
  if (els.userInitials) els.userInitials.textContent = getInitials(displayName || email);

  setStudentPickerVisibility();
  setViewAsButtonVisibility();
}

function setStudentPickerVisibility() {
  const canShow =
    Boolean(state.user) &&
    Array.isArray(state.studentIds) &&
    state.studentIds.length > 1;

  if (els.studentPickerBtn) {
    els.studentPickerBtn.hidden = !canShow;
  }
}

function setStudentLabel() {
  if (!els.studentPickerLabel) return;

  const label = state.student
    ? getStudentName(state.student)
    : state.studentId
      ? "Estudiante vinculado"
      : "Seleccionar";

  els.studentPickerLabel.textContent = label;
}

function clearGlobalMessages() {
  if (els.bannerArea) {
    els.bannerArea.innerHTML = "";
  }
}

/*
  Si un correo es admin de arranque pero todavía no tiene documento en
  users/{email}, igual le damos un perfil admin para que pueda entrar y usar
  "Ver como estudiante". Las reglas de Firestore mandan en la seguridad real.
*/
function synthesizeAdminProfile(user) {
  const email = normalizeEmail(user?.email);

  return {
    id: email,
    email,
    correo: email,
    role: "admin",
    rol: "admin",
    active: true,
    estado: "Activo",
    displayName: safeText(user?.displayName, "Equipo Musicala"),
    studentIds: [],
    bootstrapAdmin: true,
  };
}

/* =============================================================================
  Acceso y datos
============================================================================= */

function extractStudentIdsFromAccessProfile(profile) {
  if (!profile) return [];

  const rawIds = [
    ...(Array.isArray(profile.studentIds) ? profile.studentIds : []),
    ...(Array.isArray(profile.students) ? profile.students : []),
    ...(Array.isArray(profile.estudiantes) ? profile.estudiantes : []),
    profile.studentId,
    profile.studentKey,
    profile.estudianteId,
  ];

  return rawIds
    .map((id) => safeText(id))
    .filter(Boolean)
    .filter((id, index, arr) => arr.indexOf(id) === index);
}

function cacheStudent(student = null) {
  if (!student) return null;

  const aliases = [
    student.id,
    student.studentId,
    student.studentKey,
    student.estudianteId,
    getCanonicalStudentKey(student),
    ...(student.duplicateRecords || []).flatMap((record) => [
      record.id,
      record.studentId,
      record.studentKey,
      record.estudianteId,
      getCanonicalStudentKey(record),
    ]),
  ]
    .map((id) => safeText(id))
    .filter(Boolean)
    .filter((id, index, arr) => arr.indexOf(id) === index);

  const primaryId =
    safeText(student.id) ||
    safeText(student.studentId) ||
    safeText(student.studentKey) ||
    aliases[0];

  const allEmails = [
    ...(Array.isArray(student.allEmails) ? student.allEmails : []),
    ...(Array.isArray(student.linkedEmails) ? student.linkedEmails : []),
    student.email,
    student.correo,
    student.studentEmail,
    state.accessProfile?.email,
    state.accessProfile?.correo,
  ]
    .map((email) => normalizeEmail(email))
    .filter(Boolean)
    .filter((email, index, arr) => arr.indexOf(email) === index);

  const normalized = {
    id: primaryId,
    ...student,
    allEmails,
    linkedEmails: allEmails.filter((email) => email !== normalizeEmail(student.email)),
  };

  for (const alias of aliases) {
    state.studentsById.set(alias, normalized);
  }

  return normalized;
}

function consolidateStudentIdsFromCache(ids = []) {
  const originalIds = ids.map((id) => safeText(id)).filter(Boolean);
  const canonical = [];
  const seen = new Set();

  for (const id of originalIds) {
    const student = state.studentsById.get(id);
    const key = student ? getCanonicalStudentKey(student) || id : id;

    if (seen.has(key)) continue;
    seen.add(key);

    canonical.push(
      safeText(student?.id) ||
        safeText(student?.studentId) ||
        safeText(student?.studentKey) ||
        id
    );
  }

  if (globalThis?.MUSICALA_DEBUG_STUDENTS) {
    console.info("[Students] IDs consolidados", {
      originalCount: originalIds.length,
      uniqueCount: canonical.length,
      duplicateCount: originalIds.length - canonical.length,
      canonicalKeys: [...seen],
    });
  }

  return canonical;
}

async function resolveAccessProfile(user) {
  const email = normalizeEmail(user?.email);

  if (!email) {
    throw new Error("NO_EMAIL_IN_GOOGLE_ACCOUNT");
  }

  let profile = null;

  if (typeof api.getAccessProfileByEmail === "function") {
    profile = await api.getAccessProfileByEmail(email);
  } else if (typeof api.getUserByEmail === "function") {
    profile = await api.getUserByEmail(email);
  } else if (typeof api.getUserCtx === "function") {
    console.warn(
      "[App] data.js todavía usa getUserCtx(uid). Se recomienda migrar a users/{email}."
    );
    profile = await api.getUserCtx(email);
  } else {
    throw new Error("DATA_API_MISSING_getAccessProfileByEmail");
  }

  if (!profile && isBootstrapAdminEmail(email)) {
    return synthesizeAdminProfile(user);
  }

  return profile;
}

function validateAccessProfile(profile, user) {
  const email = normalizeEmail(user?.email);

  if (!profile) {
    return {
      ok: false,
      reason: "NO_PROFILE",
      message:
        "Tu correo todavía no tiene acceso al portal de estudiantes. Revisa que esté registrado en Musicala.",
    };
  }

  const active = profile.active !== false && profile.estado !== "inactivo";
  if (!active) {
    return {
      ok: false,
      reason: "INACTIVE_PROFILE",
      message:
        "Tu acceso está inactivo. Si crees que es un error, revisa con el equipo administrativo de Musicala.",
    };
  }

  const role = safeText(profile.role || profile.rol || profile.type || profile.tipo).toLowerCase();

  const allowedRoles = new Set([
    "student",
    "estudiante",
    "acudiente",
    "guardian",
    "parent",
    "admin",
    "administrativo",
    "direccion",
    "dirección",
    "teacher",
    "docente",
  ]);

  if (role && !allowedRoles.has(role)) {
    return {
      ok: false,
      reason: "INVALID_ROLE",
      message:
        "Tu usuario existe, pero no tiene un rol habilitado para ver Estudiantes HUB.",
    };
  }

  const profileEmail = normalizeEmail(profile.email || profile.correo || profile.id);

  if (profileEmail && email && profileEmail !== email) {
    console.warn("[App] Email de perfil distinto al email autenticado:", {
      profileEmail,
      authEmail: email,
    });
  }

  const studentIds = extractStudentIdsFromAccessProfile(profile);

  if (!studentIds.length && !["admin", "administrativo", "direccion", "dirección"].includes(role)) {
    return {
      ok: false,
      reason: "NO_STUDENTS",
      message:
        "Tu usuario no tiene estudiantes vinculados todavía. El portal cargó, pero no hay información para mostrar.",
    };
  }

  return {
    ok: true,
    reason: "OK",
    message: "",
  };
}

async function loadUserContext(user) {
  const profile = await resolveAccessProfile(user);
  const validation = validateAccessProfile(profile, user);

  state.accessProfile = profile || null;
  state.studentIds = extractStudentIdsFromAccessProfile(profile);

  if (!validation.ok) {
    state.studentId = null;
    state.student = null;
    state.studentsById.clear();

    setStudentPickerVisibility();
    setStudentLabel();

    return validation;
  }

  const persistedId = readPersistedStudentId();
  const preferredId =
    persistedId && state.studentIds.includes(persistedId)
      ? persistedId
      : state.studentIds[0] || null;

  if (preferredId) {
    await setActiveStudent(preferredId, { silent: true });
  }

  if (state.studentIds.length > 1) {
    await preloadStudentsIfNeeded();
  } else {
    state.studentIds = consolidateStudentIdsFromCache(state.studentIds);
  }

  setStudentPickerVisibility();
  setStudentLabel();

  return validation;
}

async function getStudentById(studentId) {
  if (!studentId) return null;

  if (state.studentsById.has(studentId)) {
    return state.studentsById.get(studentId);
  }

  let student = null;

  if (typeof api.getStudent === "function") {
    student = await api.getStudent(studentId);
  } else if (typeof api.getStudentById === "function") {
    student = await api.getStudentById(studentId);
  } else {
    throw new Error("DATA_API_MISSING_getStudent");
  }

  if (student) {
    return cacheStudent({
      id: student.id || studentId,
      ...student,
    });
  }

  return null;
}

async function preloadStudentsIfNeeded() {
  const ids = state.studentIds.filter(Boolean);
  const missing = ids.filter((id) => !state.studentsById.has(id));

  if (!missing.length) return;

  if (typeof api.getStudentsByIds === "function") {
    const students = dedupeStudents(await api.getStudentsByIds(missing), {
      debug: Boolean(globalThis?.MUSICALA_DEBUG_STUDENTS),
    });

    for (const student of students || []) {
      if (!student) continue;

      cacheStudent(student);
    }

    state.studentIds = consolidateStudentIdsFromCache(state.studentIds);

    return;
  }

  await Promise.allSettled(
    missing.map(async (id) => {
      const student = await getStudentById(id);
      if (student?.id) {
        cacheStudent(student);
      }
    })
  );

  state.studentIds = consolidateStudentIdsFromCache(state.studentIds);
}

async function setActiveStudent(studentId, options = {}) {
  const id = safeText(studentId);

  if (!id) {
    state.studentId = null;
    state.student = null;
    persistActiveStudentId(null);
    setStudentLabel();
    return null;
  }

  if (!state.studentIds.includes(id) && !isInternalUser()) {
    throw new Error("STUDENT_NOT_ALLOWED");
  }

  state.studentId = id;
  persistActiveStudentId(id);

  const student = await getStudentById(id);

  state.student = student || {
    id,
    displayName: "Estudiante vinculado",
  };

  setStudentLabel();

  if (!options.silent) {
    clearGlobalMessages();
  }

  return state.student;
}

/* =============================================================================
  Selector de estudiante
============================================================================= */

function renderStudentPickerHTML() {
  const ids = state.studentIds || [];

  if (!ids.length) {
    return `
      <div class="empty">
        <div class="empty__icon" aria-hidden="true">◎</div>
        <h3 class="empty__title">No hay estudiantes vinculados</h3>
        <p class="empty__text">
          Este usuario no tiene estudiantes asignados todavía.
        </p>
      </div>
    `;
  }

  const items = ids
    .map((id) => {
      const student = state.studentsById.get(id);
      const name = escapeHtml(getStudentName(student, `Estudiante ${id.slice(0, 6)}`));
      const meta = escapeHtml(getStudentMeta(student) || "Perfil de aprendizaje");
      const active = id === state.studentId;

      return `
        <button
          class="pick-item ${active ? "is-on" : ""}"
          type="button"
          data-student-id="${escapeHtml(id)}"
        >
          <div class="pick-item__title">${name}</div>
          <div class="pick-item__meta">${meta}</div>
        </button>
      `;
    })
    .join("");

  return `
    <div class="stack">
      <p class="note">
        Selecciona el estudiante que quieres consultar en el portal.
      </p>

      <div class="pick-list">
        ${items}
      </div>
    </div>
  `;
}

async function openStudentPicker() {
  try {
    await preloadStudentsIfNeeded();
  } catch (error) {
    console.warn("[App] No se pudieron precargar estudiantes:", error);
  }

  openModal({
    title: "Cambiar estudiante",
    subtitle: "Estudiantes HUB · Musicala",
    bodyHTML: renderStudentPickerHTML(),
    footHTML: `
      <button class="btn btn--ghost" type="button" data-close="true">
        Cerrar
      </button>
    `,
  });
}

async function handleStudentPickerClick(event) {
  const button = event.target?.closest?.("[data-student-id]");
  if (!button) return;

  const studentId = button.getAttribute("data-student-id");
  if (!studentId || studentId === state.studentId) {
    closeModal();
    return;
  }

  try {
    setBusy(true);
    await setActiveStudent(studentId);
    closeModal();
    await navigate({ keepModalClosed: true });
    toast("Estudiante cambiado correctamente.", "success");
  } catch (error) {
    console.error("[App] Error cambiando estudiante:", error);
    toast("No se pudo cambiar el estudiante.", "danger");
  } finally {
    setBusy(false);
  }
}

/* =============================================================================
  Modo "Ver como estudiante" (admins / docentes)
============================================================================= */

async function ensureAllStudents() {
  if (Array.isArray(state.allStudents)) return state.allStudents;

  if (typeof api.listAllStudents !== "function") {
    throw new Error("DATA_API_MISSING_listAllStudents");
  }

  // 1) Estudiantes con perfil propio en la colección `students`.
  const profiled = (await api.listAllStudents()) || [];

  const knownIds = new Set();
  for (const student of profiled) {
    cacheStudent(student);
    for (const alias of [student?.id, student?.studentId, student?.studentKey]) {
      const clean = safeText(alias);
      if (clean) knownIds.add(clean);
    }
  }

  // 2) Estudiantes que aparecen en bitácoras pero NO tienen perfil todavía.
  let orphans = [];
  if (typeof api.listStudentRefsFromBitacoras === "function") {
    try {
      const fromBitacoras = (await api.listStudentRefsFromBitacoras()) || [];
      orphans = fromBitacoras.filter((ref) => !knownIds.has(safeText(ref.id)));

      for (const orphan of orphans) {
        cacheStudent(orphan);
      }
    } catch (error) {
      console.warn("[App] No se pudieron leer estudiantes desde bitácoras:", error);
    }
  }

  const merged = [...profiled, ...orphans].sort((a, b) =>
    getStudentName(a, "").localeCompare(getStudentName(b, ""), "es")
  );

  state.allStudents = merged;
  return state.allStudents;
}

function renderViewAsListHTML(students = [], filter = "") {
  const term = safeText(filter).toLowerCase();

  const filtered = !term
    ? students
    : students.filter((student) => {
        const haystack = [
          getStudentName(student, ""),
          getStudentMeta(student),
          student?.email,
          student?.correo,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(term);
      });

  if (!filtered.length) {
    return `
      <div class="empty">
        <div class="empty__icon" aria-hidden="true">◎</div>
        <h3 class="empty__title">Sin coincidencias</h3>
        <p class="empty__text">No encontramos estudiantes con ese texto.</p>
      </div>
    `;
  }

  return filtered
    .map((student) => {
      const id =
        safeText(student?.id) ||
        safeText(student?.studentId) ||
        safeText(student?.studentKey);

      if (!id) return "";

      const name = escapeHtml(getStudentName(student, "Estudiante"));
      const isOrphan = Boolean(student?.fromBitacoras);
      const status = getStudentStatusText(student);
      const allowed = canStudentLogIn(student);

      let meta;
      let badge;

      if (isOrphan) {
        meta = "⚠ Tiene clases pero le falta crear su perfil";
        badge = `<span class="login-badge login-badge--warn">sin perfil</span>`;
      } else {
        const statusLabel = status ? `${status} · ` : "";
        meta = `${statusLabel}${getStudentMeta(student) || "Perfil de aprendizaje"}`;
        badge = allowed
          ? `<span class="login-badge login-badge--ok">✓ puede entrar</span>`
          : `<span class="login-badge login-badge--no">⛔ no entra</span>`;
      }

      return `
        <button class="pick-item" type="button" data-view-as-id="${escapeHtml(id)}">
          <div class="pick-item__row">
            <div class="pick-item__title">${name}</div>
            ${badge}
          </div>
          <div class="pick-item__meta">${escapeHtml(meta)}</div>
        </button>
      `;
    })
    .join("");
}

function renderViewAsSummary(students = []) {
  const profiled = students.filter((s) => !s?.fromBitacoras);
  const canEnter = profiled.filter((s) => canStudentLogIn(s)).length;
  const cannot = profiled.length - canEnter;
  const orphans = students.length - profiled.length;

  return `
    <p class="note">
      <strong>${canEnter}</strong> pueden entrar al HUB ·
      <strong>${cannot}</strong> no (por su estado)${
        orphans ? ` · <strong>${orphans}</strong> sin perfil` : ""
      }
    </p>
  `;
}

async function openViewAsPicker() {
  if (!isInternalUser()) {
    toast("Esta opción es solo para el equipo de Musicala.", "info");
    return;
  }

  openModal({
    title: "Ver como estudiante",
    subtitle: "Previsualiza el portal tal como lo verá cada estudiante.",
    bodyHTML: `
      <div class="stack">
        <input
          id="viewAsSearch"
          class="input"
          type="search"
          placeholder="Buscar por nombre, instrumento o correo…"
          autocomplete="off"
          aria-label="Buscar estudiante"
        />
        <div id="viewAsSummary"></div>
        <div id="viewAsList" class="pick-list">
          <p class="note">Cargando estudiantes…</p>
        </div>
      </div>
    `,
    footHTML: `
      <button class="btn btn--ghost" type="button" data-close="true">Cerrar</button>
    `,
  });

  const listEl = $("#viewAsList");
  const searchEl = $("#viewAsSearch");
  const summaryEl = $("#viewAsSummary");

  try {
    const students = await ensureAllStudents();

    if (summaryEl) {
      summaryEl.innerHTML = renderViewAsSummary(students);
    }

    if (listEl) {
      listEl.innerHTML = renderViewAsListHTML(students);
    }

    if (searchEl) {
      searchEl.addEventListener("input", () => {
        if (listEl) {
          listEl.innerHTML = renderViewAsListHTML(students, searchEl.value);
        }
      });
    }
  } catch (error) {
    console.error("[App] No se pudieron cargar los estudiantes:", error);

    const raw = String(error?.code || error?.message || error);
    const message =
      raw.includes("permission") || raw.includes("PERMISSION_DENIED")
        ? "No tienes permisos para listar estudiantes. Revisa que tu correo sea admin/docente en Firestore."
        : "No se pudo cargar la lista de estudiantes.";

    if (listEl) {
      listEl.innerHTML = `<p class="note">${escapeHtml(message)}</p>`;
    }
  }
}

async function enterStudentView(studentId) {
  const id = safeText(studentId);
  if (!id) return;

  if (!isInternalUser()) {
    toast("Esta opción es solo para el equipo de Musicala.", "info");
    return;
  }

  try {
    setBusy(true);

    if (!state.studentIds.includes(id)) {
      state.studentIds = [...state.studentIds, id];
    }

    state.viewAsStudentId = id;
    await setActiveStudent(id);

    closeModal();
    ensureViewAsBanner();
    await navigate({ keepModalClosed: true });

    toast(`Viendo como ${getStudentName(state.student, "estudiante")}.`, "success");
  } catch (error) {
    console.error("[App] Error entrando a vista de estudiante:", error);
    toast("No se pudo abrir la vista del estudiante.", "danger");
  } finally {
    setBusy(false);
  }
}

async function exitStudentView() {
  state.viewAsStudentId = null;
  state.studentId = null;
  state.student = null;

  persistActiveStudentId(null);
  clearGlobalMessages();
  setStudentLabel();

  await navigate();
}

function ensureViewAsBanner() {
  if (!els.bannerArea) return;

  if (!state.viewAsStudentId) {
    const existing = els.bannerArea.querySelector("[data-view-as-bar]");
    if (existing) {
      els.bannerArea.innerHTML = "";
    }
    return;
  }

  const name = escapeHtml(getStudentName(state.student, "estudiante"));

  els.bannerArea.innerHTML = `
    <div class="banner banner--info" data-view-as-bar role="status">
      <div class="banner__content">
        👁️ Estás viendo el portal como <strong>${name}</strong>
        <span class="muted">· modo previsualización del equipo Musicala</span>
      </div>
      <button class="btn btn--ghost btn--sm" type="button" data-action="exit-view-as">
        Salir de la vista
      </button>
    </div>
  `;
}

function setViewAsButtonVisibility() {
  if (!els.viewAsBtn) return;
  els.viewAsBtn.hidden = !(Boolean(state.user) && isInternalUser());
}

function setMusiprofeFabVisibility() {
  if (!els.musiprofeFab) return;

  const showPortal =
    Boolean(state.user) &&
    Boolean(state.studentId) &&
    Boolean(state.student);

  els.musiprofeFab.hidden = !showPortal;

  if (!showPortal) {
    musiProfeChat?.reset();
    closeMoreSheet();
  }
}

function openMoreSheet() {
  const sheet = $("#navMoreSheet");
  if (!sheet) return;
  sheet.hidden = false;
  sheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("more-sheet-open");
}

function closeMoreSheet() {
  const sheet = $("#navMoreSheet");
  if (!sheet) return;
  sheet.hidden = true;
  sheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("more-sheet-open");
}

function wireMoreSheet() {
  $("#navMoreBtn")?.addEventListener("click", openMoreSheet);

  $("#navMoreSheet")?.addEventListener("click", (event) => {
    if (event.target?.closest?.("[data-close-more]")) {
      closeMoreSheet();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMoreSheet();
  });
}

/* =============================================================================
  Dependencias para vistas
============================================================================= */

/* =============================================================================
  Gestión de correos del proceso (subcorreos / acudientes)
============================================================================= */

function getActiveStudentId() {
  return safeText(state.viewAsStudentId || state.studentId || state.student?.id || "");
}

async function handleAddStudentEmail() {
  if (!isAdminUser()) {
    toast("Solo un administrador de Musicala puede asignar correos.", "info");
    return;
  }

  const input = document.getElementById("newStudentEmailInput");
  const email = safeText(input?.value);
  const studentId = safeText(input?.dataset?.studentRef) || getActiveStudentId();

  if (!email) {
    toast("Escribe un correo para agregar.", "warning");
    return;
  }

  if (!studentId) {
    toast("No hay un estudiante seleccionado.", "warning");
    return;
  }

  try {
    await api.addStudentEmailAccess(studentId, email, {
      actorEmail: state.user?.email || "",
    });
    toast("Correo agregado al proceso.", "success");
    await navigate({ force: true });
  } catch (error) {
    console.error("[App] No se pudo agregar correo:", error);
    toast(`No se pudo agregar el correo. ${safeText(error?.message)}`, "danger");
  }
}

async function handleRemoveStudentEmail(email) {
  if (!isAdminUser()) {
    toast("Solo un administrador de Musicala puede gestionar correos.", "info");
    return;
  }

  const cleanEmail = safeText(email);
  const studentId = getActiveStudentId();

  if (!cleanEmail || !studentId) return;

  const confirmed = window.confirm(
    `¿Quitar el acceso de ${cleanEmail} a este estudiante?`
  );
  if (!confirmed) return;

  try {
    await api.removeStudentEmailAccess(cleanEmail, studentId);
    toast("Correo retirado del proceso.", "success");
    await navigate({ force: true });
  } catch (error) {
    console.error("[App] No se pudo quitar correo:", error);
    toast(`No se pudo quitar el correo. ${safeText(error?.message)}`, "danger");
  }
}

function getContext() {
  return {
    app: APP,

    user: state.user,
    accessProfile: state.accessProfile,

    // Alias para compatibilidad con views anteriores
    userCtx: state.accessProfile,

    studentIds: [...state.studentIds],
    studentId: state.studentId,
    student: state.student,

    studentsById: state.studentsById,
    currentRoute: state.currentRoute,

    isLoggedIn: Boolean(state.user),
    hasStudent: Boolean(state.studentId && state.student),
    isInternal: isInternalUser(),
    isAdmin: isAdminUser(),
    viewAsStudentId: state.viewAsStudentId,
    isViewingAsStudent: Boolean(state.viewAsStudentId),
    lastError: state.lastError,
  };
}

function getViewDeps() {
  return {
    ctx: getContext(),

    api,

    ui: {
      $,
      toast,
      banner,
      openModal,
      closeModal,
      escapeHtml,
      goTo,
    },

    actions: {
      goTo,
      reload: () => navigate({ force: true }),
      openStudentPicker,
      openViewAsPicker,
      enterStudentView,
      exitStudentView,
      setActiveStudent,
    },
  };
}

/* =============================================================================
  Render
============================================================================= */

function renderLoggedOut() {
  return `
    <article class="hero-card">
      <div class="hero-card__badge">
        <span aria-hidden="true">🎵</span>
        <span>Portal de estudiantes</span>
      </div>

      <h1 class="hero-card__title">
        Bienvenido a Estudiantes HUB
      </h1>

      <p class="hero-card__text">
        Consulta tu ruta de aprendizaje, bitácoras de clase, recursos recomendados
        y eventos de Musicala en un solo lugar.
      </p>

      <div class="hero-card__actions">
        <button class="btn btn--primary" type="button" data-action="login">
          <span aria-hidden="true">✦</span>
          <span>Entrar con Google</span>
        </button>
      </div>

      <p class="hero__note">
        Inicia sesión con el mismo correo de Google que registraste en Musicala. 😊
      </p>
    </article>
  `;
}

function renderAdminLanding() {
  const name = escapeHtml(safeText(state.user?.displayName, "equipo Musicala"));

  return `
    <section class="stack">
      <article class="hero-card">
        <div class="hero-card__badge">
          <span aria-hidden="true">🎛️</span>
          <span>Panel del equipo Musicala</span>
        </div>

        <h1 class="hero-card__title">
          Hola, ${name}
        </h1>

        <p class="hero-card__text">
          Tu cuenta tiene acceso de administrador/docente. Para revisar el portal,
          elige un estudiante y verás exactamente lo que él o ella verá.
        </p>

        <div class="hero-card__actions">
          <button class="btn btn--primary" type="button" data-action="view-as">
            <span aria-hidden="true">👁️</span>
            <span>Ver como estudiante</span>
          </button>
        </div>

        <p class="hero__note">
          La seguridad real la controlan las reglas de Firestore. Esta vista es solo
          para previsualizar la experiencia del estudiante.
        </p>
      </article>
    </section>
  `;
}

function renderNoAccess(message) {
  return `
    <section class="stack">
      <article class="hero-card">
        <div class="hero-card__badge">
          <span aria-hidden="true">🔐</span>
          <span>Acceso pendiente</span>
        </div>

        <h1 class="hero-card__title">
          No encontramos información vinculada
        </h1>

        <p class="hero-card__text">
          ${escapeHtml(message || "Tu usuario inició sesión, pero no tiene un estudiante vinculado todavía.")}
        </p>

        <div class="hero-card__actions">
          <button class="btn btn--ghost" type="button" data-action="logout">
            Cerrar sesión
          </button>
        </div>
      </article>
    </section>
  `;
}

function renderLoginButton() {
  return `
    <button class="btn btn--primary" type="button" data-action="login">
      <span aria-hidden="true">âœ¦</span>
      <span>Entrar con Google</span>
    </button>
  `;
}

function renderBootError(title, message, actionHTML = "") {
  return `
    <section class="stack">
      <article class="hero-card">
        <div class="hero-card__badge">
          <span aria-hidden="true">!</span>
          <span>Estado de carga</span>
        </div>

        <h1 class="hero-card__title">
          ${escapeHtml(title)}
        </h1>

        <p class="hero-card__text">
          ${escapeHtml(message)}
        </p>

        ${
          actionHTML
            ? `<div class="hero-card__actions">${actionHTML}</div>`
            : ""
        }
      </article>
    </section>
  `;
}

async function render(route) {
  if (!els.view) return;

  const normalizedRoute = normalizeRoute(route);

  state.currentRoute = normalizedRoute;
  state.isRendering = true;

  persistLastRoute(normalizedRoute);
  setActiveNav(normalizedRoute);
  setBusy(true);
  ensureViewAsBanner();
  setMusiprofeFabVisibility();

  try {
    if (!state.isBooted) {
      els.view.innerHTML = renderLoading(
        "Esperando autenticación",
        "Firebase está revisando si ya tienes una sesión activa."
      );
      return;
    }

    if (state.lastError?.code === "AUTH_TIMEOUT") {
      els.view.innerHTML = renderBootError(
        "No pudimos confirmar tu sesión",
        "Parece que la conexión está lenta. Revisa tu internet e intenta entrar de nuevo.",
        renderLoginButton()
      );
      return;
    }

    if (state.lastError?.code === "AUTH_ERROR") {
      els.view.innerHTML = renderBootError(
        "Tuvimos un problema al iniciar sesión",
        "Intenta entrar otra vez. Si sigue igual, revisa tu conexión a internet.",
        renderLoginButton()
      );
      return;
    }

    if (!state.user) {
      els.view.innerHTML = renderLoggedOut();
      return;
    }

    if (!state.studentId || !state.student) {
      if (isInternalUser()) {
        els.view.innerHTML = renderAdminLanding();
        return;
      }

      const message =
        state.lastError?.message ||
        "Tu acceso todavía no está activo. Si acabas de registrarte, dale unos minutos o escríbele a tu profe de Musicala. 🎵";

      els.view.innerHTML = renderNoAccess(message);
      return;
    }

    const output = await renderRoute(normalizedRoute, getViewDeps());

    let html = "";
    let afterRender = null;

    if (typeof output === "string") {
      html = output;
    } else if (output && typeof output === "object") {
      html = output.html || "";
      afterRender =
        typeof output.afterRender === "function" ? output.afterRender : null;
    }

    els.view.innerHTML = html || renderLoading("Sin contenido", "La vista no devolvió información.");

    if (afterRender) {
      await afterRender(getViewDeps());
    }
  } catch (error) {
    console.error("[App] Error renderizando vista:", error);

    state.lastError = error;

    els.view.innerHTML = `
      <section class="stack">
        <article class="card">
          <div class="card__head">
            <div>
              <h2 class="card__title">Esta sección no cargó bien</h2>
              <p class="card__subtitle">
                Puede ser un problema momentáneo de conexión. Intenta de nuevo en unos segundos.
              </p>
            </div>
          </div>

          <div class="card__footer">
            <button class="btn btn--primary" type="button" data-action="reload">
              Reintentar
            </button>
          </div>
        </article>
      </section>
    `;

    toast("No se pudo cargar la vista.", "danger");
  } finally {
    state.isRendering = false;
    setBusy(false);
  }
}

async function navigate(options = {}) {
  if (!options.keepModalClosed) {
    closeModal();
  }

  const route = ensureValidHash();
  await render(route);
}

/* =============================================================================
  Eventos globales
============================================================================= */

async function handleLoginClick() {
  try {
    await loginGoogle();
  } catch (error) {
    console.error("[Auth] Error iniciando sesión:", error);
    toast(humanAuthError(error), "danger");
  }
}

async function handleLogoutClick() {
  try {
    await logout();
    toast("Sesión cerrada.", "info");
  } catch (error) {
    console.error("[Auth] Error cerrando sesión:", error);
    toast("No se pudo cerrar sesión.", "danger");
  }
}

let musiProfeChat = null;

function bindCoreHandlers() {
  wireModal();

  musiProfeChat = createMusiProfeChat({ api, getContext });
  musiProfeChat.mount();

  els.musiprofeFab?.addEventListener("click", () => {
    musiProfeChat?.toggle();
  });

  wireMoreSheet();

  els.btnLogin?.addEventListener("click", handleLoginClick);
  els.btnLogout?.addEventListener("click", handleLogoutClick);

  els.studentPickerBtn?.addEventListener("click", () => {
    openStudentPicker().catch((error) => {
      console.error("[App] Error abriendo selector:", error);
      toast("No se pudo abrir el selector de estudiante.", "danger");
    });
  });

  els.viewAsBtn?.addEventListener("click", () => {
    openViewAsPicker().catch((error) => {
      console.error("[App] Error abriendo 'Ver como estudiante':", error);
      toast("No se pudo abrir la vista de estudiante.", "danger");
    });
  });

  window.addEventListener("hashchange", () => {
    navigate().catch((error) => {
      console.error("[Router] Error navegando:", error);
    });
  });

  document.addEventListener("click", async (event) => {
    const actionEl = event.target?.closest?.("[data-action]");
    const routeEl = event.target?.closest?.("[data-route-go]");
    const studentEl = event.target?.closest?.("[data-student-id]");
    const viewAsEl = event.target?.closest?.("[data-view-as-id]");

    if (viewAsEl) {
      const id = viewAsEl.getAttribute("data-view-as-id");
      if (id) await enterStudentView(id);
      return;
    }

    if (studentEl) {
      await handleStudentPickerClick(event);
      return;
    }

    if (routeEl) {
      const route = routeEl.getAttribute("data-route-go");
      if (route) goTo(route);
      return;
    }

    if (!actionEl) return;

    const action = actionEl.getAttribute("data-action");

    if (action === "login") {
      await handleLoginClick();
      return;
    }

    if (action === "logout") {
      await handleLogoutClick();
      return;
    }

    if (action === "reload") {
      await navigate({ force: true });
      return;
    }

    if (action === "open-musiprofe") {
      musiProfeChat?.open();
      return;
    }

    if (action === "student-picker") {
      await openStudentPicker();
      return;
    }

    if (action === "view-as") {
      await openViewAsPicker();
      return;
    }

    if (action === "exit-view-as") {
      await exitStudentView();
      return;
    }

    if (action === "add-student-email") {
      await handleAddStudentEmail();
      return;
    }

    if (action === "remove-student-email") {
      await handleRemoveStudentEmail(actionEl.getAttribute("data-email"));
      return;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });
}

/* =============================================================================
  Auth lifecycle
============================================================================= */

async function handleSignedOut() {
  state.user = null;
  state.lastError = null;

  resetStudentState();

  setAuthUI(null);
  setStudentLabel();
  clearGlobalMessages();

  state.isBooted = true;

  await navigate();
}

async function handleAuthError(error) {
  console.error("[Auth] Error observando estado de sesion:", error);

  state.user = null;
  resetStudentState();
  setAuthUI(null);
  setStudentLabel();
  clearGlobalMessages();

  state.lastError = {
    code: "AUTH_ERROR",
    message: humanAuthError(error),
    cause: error,
  };
  state.isBooted = true;

  banner(state.lastError.message, "danger");
  await navigate();
}

async function handleSignedIn(user) {
  state.user = user;
  state.lastError = null;

  setAuthUI(user);
  clearGlobalMessages();

  try {
    const validation = await loadUserContext(user);

    if (!validation.ok) {
      state.lastError = {
        code: validation.reason,
        message: validation.message,
      };

      banner(validation.message, validation.reason === "NO_STUDENTS" ? "warning" : "danger");
    }

    if (state.studentIds.length > 1) {
      preloadStudentsIfNeeded().catch((error) => {
        console.warn("[App] Precarga parcial de estudiantes falló:", error);
      });
    }

    state.isBooted = true;
    setAuthUI(user);
    setStudentLabel();

    await navigate();
  } catch (error) {
    console.error("[App] Error cargando contexto de usuario:", error);

    state.isBooted = true;

    const raw = String(error?.code || error?.message || error);

    let friendlyMessage;

    if (
      raw.includes("permission") ||
      raw.includes("PERMISSION_DENIED") ||
      raw.includes("Missing or insufficient permissions")
    ) {
      friendlyMessage =
        "Tu acceso todavía no está activo. Si acabas de registrarte, espera unos minutos; si continúa, escríbele a tu profe o al equipo de Musicala. 🎵";
    } else if (raw.includes("NO_EMAIL_IN_GOOGLE_ACCOUNT")) {
      friendlyMessage =
        "No pudimos leer el correo de tu cuenta de Google. Intenta iniciar sesión de nuevo, idealmente con tu correo de Musicala.";
    } else {
      friendlyMessage =
        "No pudimos cargar tu información. Revisa tu conexión a internet e intenta de nuevo.";
    }

    // Guardamos un mensaje amable para mostrar; el detalle técnico queda en consola.
    state.lastError = {
      code: error?.code || "LOAD_ERROR",
      message: friendlyMessage,
      technical: raw,
    };

    banner(friendlyMessage, "danger");

    await navigate();
  }
}

/* =============================================================================
  Diagnóstico (solo para el equipo Musicala, desde la consola del navegador)
============================================================================= */

function exposeDiagnostics() {
  /*
    Uso: en la consola del navegador, logueado como admin, escribe:
        await MUSICALA_DIAG.estudiantesSinPerfil()
    Devuelve y muestra en tabla los estudiantes que tienen clases en bitácoras
    pero todavía no tienen documento en la colección `students`.
  */
  window.MUSICALA_DIAG = {
    async estudiantesSinPerfil() {
      if (!isInternalUser()) {
        console.warn("[DIAG] Solo disponible para admins/equipo Musicala.");
        return [];
      }

      const profiled = (await api.listAllStudents()) || [];
      const knownIds = new Set();
      for (const s of profiled) {
        for (const alias of [s?.id, s?.studentId, s?.studentKey]) {
          const clean = safeText(alias);
          if (clean) knownIds.add(clean);
        }
      }

      const fromBitacoras =
        typeof api.listStudentRefsFromBitacoras === "function"
          ? (await api.listStudentRefsFromBitacoras()) || []
          : [];

      const sinPerfil = fromBitacoras.filter((r) => !knownIds.has(safeText(r.id)));

      console.info(
        `[DIAG] Con perfil: ${profiled.length} · En bitácoras: ${fromBitacoras.length} · SIN perfil: ${sinPerfil.length}`
      );
      console.table(
        sinPerfil.map((s) => ({
          id: s.id,
          nombre: s.displayName,
          clases: s.bitacoraCount,
        }))
      );

      return sinPerfil;
    },

    /*
      Uso: await MUSICALA_DIAG.revisarAcceso("correo@ejemplo.com")
      Revisa el documento users/{correo} y verifica si el vínculo con su(s)
      estudiante(s) está bien hecho. Ideal para casos como el de un acudiente.
      Para ver por qué a un estudiante no le aparece un recurso de la biblioteca:
      await MUSICALA_DIAG.revisarRecursos("correo@..." o "idEstudiante")
    */
    async revisarAcceso(email) {
      if (!isInternalUser()) {
        console.warn("[DIAG] Solo disponible para admins/equipo Musicala.");
        return null;
      }

      const correo = normalizeEmail(email);
      if (!correo) {
        console.warn("[DIAG] Pasa un correo: revisarAcceso('correo@...')");
        return null;
      }

      const profile = await api.getAccessProfileByEmail(correo);

      if (!profile) {
        console.warn(`[DIAG] No existe documento users/${correo}. Hay que crear su acceso.`);
        return { correo, existe: false };
      }

      const rolesPermitidos = [
        "student", "estudiante", "acudiente", "guardian", "parent",
        "admin", "administrativo", "direccion", "dirección",
      ];

      const role = safeText(profile.role || profile.rol).toLowerCase();
      const activo = profile.active !== false && profile.estado !== "inactivo";
      const ids = extractStudentIdsFromAccessProfile(profile);

      const vinculos = [];
      for (const id of ids) {
        const student = await api.getStudent(id).catch(() => null);
        vinculos.push({
          studentId: id,
          existeEnStudents: Boolean(student),
          nombre: student ? getStudentName(student) : "(no encontrado)",
        });
      }

      // CLAVE: las reglas de Firestore buscan el documento por ID = correo.
      // Si el doc existe con OTRO id (y solo coincide por el campo email),
      // las reglas no lo encuentran y rechazan al estudiante.
      const docId = safeText(profile.id);
      const docIdEsCorreo = normalizeEmail(docId) === correo;

      const reporte = {
        correo,
        existe: true,
        docId,
        docIdEsCorreo,
        role: role || "(vacío)",
        rolPermitido: rolesPermitidos.includes(role),
        activo,
        estudiantesVinculados: ids.length,
        vinculos,
      };

      console.info("[DIAG] Acceso de", correo);
      console.table(vinculos);
      console.info("[DIAG] docId:", docId, "· docId == correo:", docIdEsCorreo);
      console.info("[DIAG] role:", reporte.role, "· rol permitido:", reporte.rolPermitido, "· activo:", activo, "· #estudiantes:", ids.length);

      if (!docIdEsCorreo) {
        console.warn("[DIAG] ⛔ CAUSA PROBABLE: el ID del documento NO es el correo. Las reglas no lo encuentran. Hay que recrear el acceso con ID = correo (re-sincronizar suele arreglarlo).");
      }
      if (!ids.length) {
        console.warn("[DIAG] ⚠ No tiene ningún estudiante vinculado (studentId/studentIds vacío).");
      }
      if (role && !reporte.rolPermitido) {
        console.warn(`[DIAG] ⚠ El rol "${role}" no está habilitado. Usa: estudiante o acudiente.`);
      }
      if (!activo) {
        console.warn("[DIAG] ⚠ El acceso está inactivo (active:false o estado:inactivo).");
      }

      return reporte;
    },

    /*
      Diagnóstico de biblioteca: muestra qué recursos ve un estudiante y cuáles
      se le ocultan y por qué (publicado / filtro por instrumento).
      Uso: await MUSICALA_DIAG.revisarRecursos("correo@..." o studentId)
    */
    async revisarRecursos(identifier) {
      if (!isInternalUser()) {
        console.warn("[DIAG] Solo disponible para admins/equipo Musicala.");
        return null;
      }

      const raw = safeText(identifier);
      if (!raw) {
        console.warn('[DIAG] Pasa un correo o studentId: revisarRecursos("correo@..." o "idEstudiante")');
        return null;
      }

      let student = null;
      if (raw.includes("@")) {
        const profile = await api.getAccessProfileByEmail(normalizeEmail(raw));
        const ids = profile ? extractStudentIdsFromAccessProfile(profile) : [];
        if (!ids.length) {
          console.warn(`[DIAG] ${raw} no tiene estudiantes vinculados.`);
          return null;
        }
        student = await api.getStudent(ids[0]).catch(() => null);
      } else {
        student = await api.getStudent(raw).catch(() => null);
      }

      if (!student) {
        console.warn("[DIAG] No se encontró el estudiante.");
        return null;
      }

      return api.diagnoseResources({ student });
    },
  };
}

/* =============================================================================
  Service Worker helpers
============================================================================= */

function notifyServiceWorkerReady() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    console.info("[PWA] Nuevo Service Worker activo.");
  });
}

/* =============================================================================
  Boot
============================================================================= */

async function boot() {
  console.info(`🎼 ${APP.name} boot`, APP.build);

  if (!els.view) {
    throw new Error("No existe #view en index.html");
  }

  bindCoreHandlers();
  notifyServiceWorkerReady();
  exposeDiagnostics();

  state.isBooted = false;

  ensureValidHash();

  await render(getRoute());

  const authWaitTimer = window.setTimeout(() => {
    if (state.isBooted) return;

    console.error("[Auth] Timeout esperando respuesta de Firebase Auth.");

    state.lastError = {
      code: "AUTH_TIMEOUT",
      message:
        "La conexión está tardando más de lo normal. Revisa tu internet e intenta de nuevo.",
    };
    state.isBooted = true;
    setBusy(false);

    navigate().catch((error) => {
      console.error("[Router] Error mostrando timeout de auth:", error);
    });
  }, APP.authWaitMs);

  initAuth(async (user, authError = null) => {
    window.clearTimeout(authWaitTimer);

    if (authError) {
      await handleAuthError(authError);
      return;
    }

    if (!user) {
      await handleSignedOut();
      return;
    }

    await handleSignedIn(user);
  });
}

boot().catch((error) => {
  console.error("[App] Error fatal iniciando la app:", error);

  state.isBooted = true;
  state.lastError = error;

  setBusy(false);

  banner(
    "No pudimos abrir Estudiantes HUB. Intenta recargar la página.",
    "danger"
  );

  if (els.view) {
    els.view.innerHTML = `
      <article class="card">
        <h1 class="card__title">No pudimos abrir el portal</h1>
        <p class="card__subtitle">
          Intenta recargar la página. Si el problema sigue, escríbele al equipo de Musicala.
        </p>
        <div class="card__footer">
          <button class="btn btn--primary" type="button" onclick="location.reload()">
            Recargar
          </button>
        </div>
      </article>
    `;
  }
});
