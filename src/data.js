"use strict";

/* =============================================================================
  src/data.js — Estudiantes HUB · Musicala
  Capa de datos Firestore + Storage

  Responsabilidades:
  - Leer perfil de acceso desde users/{email}
  - Leer estudiantes desde students/{studentId}
  - Leer bitácoras desde colección global bitacoras
  - Leer rutas desde student_routes
  - Leer recursos y eventos globales
  - Mantener aliases compatibles con versiones anteriores

  Este archivo NO renderiza UI.
  Este archivo NO crea usuarios automáticamente.
============================================================================= */

import {
  doc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  serverTimestamp,
  documentId,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref as storageRef,
  getDownloadURL,
  uploadBytes,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import { db, storage, libraryDb } from "./firebase.js";

import {
  COLLECTIONS,
  LIBRARY_COLLECTIONS,
  DOCS,
  LIMITS,
  SORTING,
  STORAGE_CONFIG,
} from "./config.js";

import {
  dedupeStudents as dedupeStudentRecords,
  getCanonicalStudentKey,
  normalizeStudent as normalizeStudentRecord,
} from "./normalizers.js";

/* =============================================================================
  Constantes internas
============================================================================= */

const MAX_IN = LIMITS?.firestoreInQueryLimit || 10;
const DEFAULT_MAX = 50;

const EMPTY_BUNDLE = Object.freeze({
  student: null,
  route: null,
  routes: [],
  bitacoras: [],
  resources: [],
  events: [],
  catalogs: null,
});

/* =============================================================================
  Helpers base
============================================================================= */

function assertNonEmptyString(value, name) {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} es requerido y debe ser un string no vacío.`);
  }
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(array = []) {
  return [...new Set(array.filter(Boolean))];
}

function normalizeEmail(email = "") {
  return safeText(email).replace(/\s+/g, "").toLowerCase();
}

function getStudentIdentity(student = null) {
  if (!student) return "";

  return (
    safeText(student.studentKey) ||
    safeText(student.id) ||
    safeText(student.studentId) ||
    safeText(student.documento)
  );
}

function getStudentFallbackId(student = null) {
  if (!student) return "";

  return (
    safeText(student.id) ||
    safeText(student.studentId) ||
    safeText(student.documento)
  );
}

function clampLimit(value, fallback = DEFAULT_MAX, max = 200) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(number), max);
}

function chunk(array = [], size = MAX_IN) {
  const items = safeArray(array);
  const out = [];

  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }

  return out;
}

function toDateMaybe(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    // Fecha sin hora (YYYY-MM-DD): parsear como fecha LOCAL para no perder un día.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnly) {
      const localDate = new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );
      return Number.isNaN(localDate.getTime()) ? null : localDate;
    }

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (
    typeof value === "object" &&
    typeof value.seconds === "number" &&
    typeof value.nanoseconds === "number"
  ) {
    const date = new Date(value.seconds * 1000 + Math.round(value.nanoseconds / 1e6));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function dateTimeValue(value) {
  const date = toDateMaybe(value);
  return date ? date.getTime() : 0;
}

function getBestDateValue(item = {}, fields = []) {
  for (const field of fields) {
    const value = item?.[field] || item?.[`_${field}`];
    const time = dateTimeValue(value);

    if (time) return time;
  }

  return 0;
}

function sortByDate(items = [], fields = [], direction = "desc") {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...safeArray(items)].sort((a, b) => {
    const av = getBestDateValue(a, fields);
    const bv = getBestDateValue(b, fields);

    if (av === bv) {
      return safeText(a.title || a.name || a.id).localeCompare(
        safeText(b.title || b.name || b.id),
        "es"
      );
    }

    return (av - bv) * multiplier;
  });
}

function sortByText(items = [], field = "title", direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1;

  return [...safeArray(items)].sort((a, b) => {
    const av = safeText(a?.[field]);
    const bv = safeText(b?.[field]);

    return av.localeCompare(bv, "es") * multiplier;
  });
}

function normalizeDocBase(id, data = {}) {
  const object = {
    id,
    ...data,
  };

  const dateFields = [
    "date",
    "fecha",
    "fechaClase",
    "dateStart",
    "dateEnd",
    "startDate",
    "endDate",
    "createdAt",
    "updatedAt",
    "addedAt",
    "publishedAt",
  ];

  for (const field of dateFields) {
    if (field in object) {
      object[`_${field}`] = toDateMaybe(object[field]);
    }
  }

  return object;
}

function snapToObject(snap) {
  if (!snap?.exists?.()) return null;
  return normalizeDocBase(snap.id, snap.data() || {});
}

function docsToObjects(snapshot) {
  return snapshot.docs.map((item) => normalizeDocBase(item.id, item.data() || {}));
}

function withContextError(error, context) {
  const code = String(error?.code || "");
  const message = error?.message ? String(error.message) : String(error);
  const wrapped = new Error(`[data] ${context}: ${message}`);

  if (code) wrapped.code = code;
  wrapped.cause = error;

  return wrapped;
}

async function getDocsSafe(primaryQuery, fallbackQuery = null, context = "query") {
  try {
    return await getDocs(primaryQuery);
  } catch (error) {
    if (!fallbackQuery) {
      throw error;
    }

    console.warn(`[data] Query principal falló en ${context}. Usando fallback.`, error);
    return getDocs(fallbackQuery);
  }
}

function removeUndefinedFields(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}

export function nowServer() {
  return serverTimestamp();
}

/* =============================================================================
  Normalizadores de entidades
============================================================================= */

export function normalizeAccessProfile(raw = null) {
  if (!raw) return null;

  const email = normalizeEmail(raw.email || raw.correo || raw.id);
  const role = safeText(raw.role || raw.rol || raw.type || raw.tipo || "student")
    .toLowerCase();

  const studentIds = unique([
    ...safeArray(raw.studentIds),
    ...safeArray(raw.students),
    raw.studentId,
    raw.studentKey,
  ].map((id) => safeText(id)));

  return {
    ...raw,
    id: raw.id || email,
    email,
    role,
    active: raw.active !== false && raw.estado !== "inactivo",
    studentIds,
    studentId: studentIds[0] || null,
    displayName: raw.displayName || raw.nombre || raw.name || raw.fullName || "",
  };
}

export function normalizeStudent(raw = null) {
  return normalizeStudentRecord(raw);
}

export function dedupeStudents(records = [], options = {}) {
  return dedupeStudentRecords(records, options);
}

export function normalizeBitacora(raw = null) {
  if (!raw) return null;

  const fechaClase =
    raw.fechaClase ||
    raw.date ||
    raw.fecha ||
    raw.createdAt ||
    raw.updatedAt ||
    null;

  const title =
    raw.title ||
    raw.titulo ||
    raw.topic ||
    raw.tema ||
    "Bitácora de clase";

  const content =
    raw.content ||
    raw.contenido ||
    raw.description ||
    raw.descripcion ||
    raw.notes ||
    raw.observaciones ||
    "";

  const studentIds = unique([
    ...safeArray(raw.studentIds),
    ...safeArray(raw.students),
    raw.studentId,
  ].map((id) => safeText(id)));

  const studentRefs = safeArray(raw.studentRefs).map((item) => ({
    id: item?.id || item?.studentId || "",
    name: item?.name || item?.displayName || item?.nombre || "",
  }));

  const author =
    typeof raw.author === "object"
      ? raw.author
      : {
          name: raw.authorName || raw.docente || raw.teacher || raw.author || "",
          email: raw.authorEmail || "",
        };

  return {
    ...raw,
    id: raw.id,

    title,
    titulo: raw.titulo || title,

    content,
    contenido: raw.contenido || content,

    fechaClase,
    date: raw.date || fechaClase,

    process: raw.process || raw.proceso || raw.program || "",
    proceso: raw.proceso || raw.process || raw.program || "",

    tags: safeArray(raw.tags || raw.etiquetas),
    attachments: safeArray(raw.attachments || raw.adjuntos || raw.files),

    studentIds,
    studentRefs,
    author,

    _fechaClase: toDateMaybe(fechaClase),
    _date: toDateMaybe(fechaClase),
    _createdAt: toDateMaybe(raw.createdAt),
    _updatedAt: toDateMaybe(raw.updatedAt),
  };
}

export function normalizeStudentRoute(raw = null) {
  if (!raw) return null;

  const goals = safeArray(raw.goals || raw.objetivos || raw.objectives);
  const milestones = safeArray(raw.milestones || raw.hitos || raw.steps);
  const progressRaw =
    raw.progress ??
    raw.progreso ??
    raw.progressPercent ??
    raw.porcentaje ??
    0;

  const progressNumber = Number(progressRaw);
  const progress = Number.isFinite(progressNumber)
    ? Math.max(0, Math.min(100, progressNumber))
    : 0;

  return {
    ...raw,
    id: raw.id,
    studentId: raw.studentId || raw.student || "",
    processKey: raw.processKey || raw.process?.processKey || raw.proceso || "general",

    title:
      raw.title ||
      raw.titulo ||
      raw.name ||
      raw.nombre ||
      "Ruta de aprendizaje",

    description:
      raw.description ||
      raw.descripcion ||
      raw.summary ||
      raw.resumen ||
      "",

    goals,
    objetivos: raw.objetivos || goals,

    milestones,
    hitos: raw.hitos || milestones,

    progress,
    progreso: raw.progreso ?? progress,

    status: raw.status || raw.estado || "",
    estado: raw.estado || raw.status || "",

    _createdAt: toDateMaybe(raw.createdAt),
    _updatedAt: toDateMaybe(raw.updatedAt),
  };
}

export function normalizeResource(raw = null) {
  if (!raw) return null;

  /*
    Soporta tanto el esquema antiguo (resources del proyecto principal)
    como el de la biblioteca (recursos en biblioteca-guitarra-fa182):
    titulo, descripcion, area, tema, tipo, estado, etiquetas, enlaces[{url, titulo, tipo}].
  */

  const links = safeArray(raw.enlaces || raw.links)
    .map((link) => ({
      url: safeText(link?.url || link?.href),
      title: safeText(link?.titulo || link?.title),
      type: safeText(link?.tipo || link?.type),
      thumbnail: safeText(link?.thumbnail),
    }))
    .filter((link) => link.url);

  const mainUrl = raw.url || raw.link || raw.href || links[0]?.url || "";

  return {
    ...raw,
    id: raw.id,

    title: raw.title || raw.titulo || raw.name || raw.nombre || "Recurso",
    titulo: raw.titulo || raw.title || raw.name || raw.nombre || "Recurso",

    description:
      raw.description ||
      raw.descripcion ||
      raw.summary ||
      raw.resumen ||
      "",

    type: raw.type || raw.tipo || "link",
    tipo: raw.tipo || raw.type || "link",

    tema: safeText(raw.tema),
    tags: safeArray(raw.etiquetas || raw.tags).map((tag) => safeText(tag)).filter(Boolean),

    url: mainUrl,
    links,
    visibility: raw.visibility || raw.visibilidad || "students",

    area: raw.area || raw.instrument || raw.instrumento || "",
    instrument: raw.instrument || raw.instrumento || raw.area || "",

    active:
      raw.active !== false &&
      raw.estado !== "inactivo" &&
      raw.estado !== "borrador" &&
      raw.estado !== "archivado",

    _createdAt: toDateMaybe(raw.createdAt || raw.creadoEn),
    _updatedAt: toDateMaybe(raw.updatedAt || raw.actualizadoEn),
    _publishedAt: toDateMaybe(raw.publishedAt),
  };
}

export function normalizeEvent(raw = null) {
  if (!raw) return null;

  const dateStart =
    raw.dateStart ||
    raw.startDate ||
    raw.fechaInicio ||
    raw.date ||
    raw.fecha ||
    raw.createdAt ||
    null;

  const dateEnd =
    raw.dateEnd ||
    raw.endDate ||
    raw.fechaFin ||
    null;

  return {
    ...raw,
    id: raw.id,

    title: raw.title || raw.titulo || raw.name || raw.nombre || "Evento",
    titulo: raw.titulo || raw.title || raw.name || raw.nombre || "Evento",

    description:
      raw.description ||
      raw.descripcion ||
      raw.summary ||
      raw.resumen ||
      "",

    type: raw.type || raw.tipo || "event",
    tipo: raw.tipo || raw.type || "event",

    dateStart,
    dateEnd,

    location: raw.location || raw.lugar || raw.sede || "",
    lugar: raw.lugar || raw.location || raw.sede || "",

    visibility: raw.visibility || raw.visibilidad || "students",
    active: raw.active !== false && raw.estado !== "inactivo",

    _dateStart: toDateMaybe(dateStart),
    _dateEnd: toDateMaybe(dateEnd),
    _createdAt: toDateMaybe(raw.createdAt),
    _updatedAt: toDateMaybe(raw.updatedAt),
  };
}

/* =============================================================================
  USERS / ACCESS PROFILE
============================================================================= */

export async function getAccessProfileByEmail(email) {
  try {
    const normalizedEmail = normalizeEmail(email);
    assertNonEmptyString(normalizedEmail, "email");

    /*
      El doc canónico es users/{correo en minúsculas, sin espacios}: el sync
      de Bitácoras lo mantiene con role, active y studentIds ya fusionados.
      Si existe, es autoritativo. El resto de búsquedas queda solo como
      respaldo transitorio mientras se termina la limpieza de docs legados.
    */
    const directSnap = await getDoc(doc(db, COLLECTIONS.users, normalizedEmail));
    if (directSnap.exists()) {
      return normalizeAccessProfile({
        id: directSnap.id,
        ...directSnap.data(),
        email: normalizedEmail,
      });
    }

    const candidates = [];
    const seenIds = new Set();

    const addCandidate = (id, data) => {
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);
      candidates.push({ id, ...data });
    };

    // Por si el doc fue creado con el correo sin normalizar (mayúsculas, etc.)
    const rawEmail = safeText(email);
    if (rawEmail && rawEmail !== normalizedEmail) {
      const rawSnap = await getDoc(doc(db, COLLECTIONS.users, rawEmail));
      if (rawSnap.exists()) addCandidate(rawSnap.id, rawSnap.data());
    }

    /*
      Consultas por campo email/correo. Si las reglas desplegadas todavía no
      las permiten, no rompemos el login: seguimos con lo que tengamos.
    */
    const usersRef = collection(db, COLLECTIONS.users);

    for (const field of ["email", "correo"]) {
      try {
        const snap = await getDocs(
          query(usersRef, where(field, "==", normalizedEmail), limit(25))
        );
        snap.docs.forEach((found) => addCandidate(found.id, found.data()));
      } catch (queryError) {
        const code = String(queryError?.code || queryError?.message || "");
        if (!code.includes("permission")) throw queryError;
        console.warn(
          `[data] Consulta de respaldo en users (${field}) bloqueada por reglas.`,
          queryError
        );
      }
    }

    if (!candidates.length) return null;

    const isActiveProfile = (p) =>
      p.active !== false && p.estado !== "inactivo";

    const hasLinkedStudents = (p) =>
      (Array.isArray(p.studentIds) && p.studentIds.length > 0) ||
      (Array.isArray(p.students) && p.students.length > 0) ||
      Boolean(safeText(p.studentId)) ||
      Boolean(safeText(p.studentKey)) ||
      Boolean(safeText(p.estudianteId));

    // Preferimos documentos activos; entre ellos, los que tengan estudiantes.
    const activeOnes = candidates.filter(isActiveProfile);
    const pool = activeOnes.length ? activeOnes : candidates;
    const base = pool.find(hasLinkedStudents) || pool[0];

    // Fusionamos los estudiantes de TODOS los docs activos del mismo correo
    // (un acudiente puede tener un doc por cada hijo).
    const mergedStudentIds = unique(
      pool
        .flatMap((p) => [
          ...safeArray(p.studentIds),
          ...safeArray(p.students),
          p.studentId,
          p.studentKey,
          p.estudianteId,
        ])
        .map((id) => safeText(id))
        .filter(Boolean)
    );

    return normalizeAccessProfile({
      ...base,
      email: normalizedEmail,
      studentIds: mergedStudentIds,
    });
  } catch (error) {
    throw withContextError(error, "getAccessProfileByEmail");
  }
}

/*
  Compatibilidad:
  Antes Estudiantes HUB usaba getUserCtx(uid).
  Ahora debería usarse getAccessProfileByEmail(email).
*/
export async function getUserCtx(identifier) {
  try {
    const value = safeText(identifier);
    assertNonEmptyString(value, "identifier");

    if (value.includes("@")) {
      return getAccessProfileByEmail(value);
    }

    const ref = doc(db, COLLECTIONS.users, value);
    const snap = await getDoc(ref);

    return snap.exists()
      ? normalizeAccessProfile({
          id: snap.id,
          ...snap.data(),
        })
      : null;
  } catch (error) {
    throw withContextError(error, "getUserCtx");
  }
}

export async function getUserByEmail(email) {
  return getAccessProfileByEmail(email);
}

/*
  Importante:
  Esta función NO crea usuarios automáticamente.
  Se conserva como alias seguro por compatibilidad con código viejo.
*/
export async function ensureUserDoc(user) {
  try {
    const email = normalizeEmail(user?.email);

    if (!email) {
      throw new Error("ensureUserDoc requiere user.email.");
    }

    return getAccessProfileByEmail(email);
  } catch (error) {
    throw withContextError(error, "ensureUserDoc");
  }
}

export async function updateUserCtx(emailOrId, patch = {}) {
  try {
    // Solo se escribe el doc canónico users/{correo}; IDs no-correo crearían
    // de nuevo los documentos duplicados que ya se migraron.
    const id = normalizeEmail(emailOrId);
    assertNonEmptyString(id, "emailOrId");
    if (!id.includes("@")) {
      throw new Error("updateUserCtx requiere un correo como identificador.");
    }

    const ref = doc(db, COLLECTIONS.users, id);
    const cleanPatch = removeUndefinedFields({
      ...patch,
      updatedAt: serverTimestamp(),
    });

    await updateDoc(ref, cleanPatch);
    return true;
  } catch (error) {
    throw withContextError(error, "updateUserCtx");
  }
}

/* =============================================================================
  STUDENTS
============================================================================= */

export async function getStudent(studentId) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const ref = doc(db, COLLECTIONS.students, id);
    const snap = await getDoc(ref);

    return snap.exists()
      ? normalizeStudent({
          id: snap.id,
          ...snap.data(),
        })
      : null;
  } catch (error) {
    throw withContextError(error, "getStudent");
  }
}

export async function getStudentById(studentId) {
  return getStudent(studentId);
}

export async function getStudentsByIds(studentIds = []) {
  try {
    const ids = unique(safeArray(studentIds).map((id) => safeText(id)));

    if (!ids.length) return [];

    const out = [];
    const parts = chunk(ids, MAX_IN);
    const studentsRef = collection(db, COLLECTIONS.students);

    for (const part of parts) {
      const q = query(studentsRef, where(documentId(), "in", part));
      const snap = await getDocs(q);

      out.push(
        ...docsToObjects(snap).map((item) => normalizeStudent(item))
      );
    }

    const deduped = dedupeStudents(out, {
      debug: Boolean(globalThis?.MUSICALA_DEBUG_STUDENTS),
    });
    const map = new Map();

    for (const student of deduped) {
      const aliases = unique([
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
      ].map((value) => safeText(value)));

      for (const alias of aliases) {
        map.set(alias, student);
      }
    }

    return unique(ids.map((id) => map.get(id)).filter(Boolean));
  } catch (error) {
    throw withContextError(error, "getStudentsByIds");
  }
}

/*
  Lista TODOS los estudiantes.
  Pensado para admins/docentes que necesitan elegir a quién ver (modo "Ver como
  estudiante"). Las reglas de Firestore solo permiten esta lectura a admin/teacher.
  Para estudiantes normales esto fallará por permisos, y está bien que así sea.
*/
export async function listAllStudents(max = 0) {
  try {
    const studentsRef = collection(db, COLLECTIONS.students);

    // max = 0 (por defecto) → trae TODA la colección. La base tiene >1100
    // estudiantes, así que un tope bajo dejaría a muchos por fuera.
    const cap = Number(max) > 0 ? clampLimit(max, 1000, 10000) : 0;
    const q = cap > 0 ? query(studentsRef, limit(cap)) : query(studentsRef);
    const snap = await getDocs(q);

    const deduped = dedupeStudents(
      docsToObjects(snap).map((item) => normalizeStudent(item)),
      { debug: Boolean(globalThis?.MUSICALA_DEBUG_STUDENTS) }
    );

    return deduped.sort((a, b) => {
      const nameA = safeText(a?.displayName || a?.nombre || a?.name).toLowerCase();
      const nameB = safeText(b?.displayName || b?.nombre || b?.name).toLowerCase();
      return nameA.localeCompare(nameB, "es");
    });
  } catch (error) {
    throw withContextError(error, "listAllStudents");
  }
}

/*
  Extrae los estudiantes REFERENCIADOS en bitácoras (por studentIds / studentRefs).
  Sirve para encontrar estudiantes que tienen clases registradas pero a los que
  todavía les falta su documento en la colección `students`. Solo admin/teacher
  pueden leer toda la colección de bitácoras.
*/
export async function listStudentRefsFromBitacoras(max = 2000) {
  try {
    const cap = clampLimit(max, 2000, 6000);
    const ref = collection(db, COLLECTIONS.bitacoras);
    const snap = await getDocs(query(ref, limit(cap)));

    const byId = new Map();

    for (const docItem of snap.docs) {
      const data = docItem.data() || {};

      const ids = unique([
        ...safeArray(data.studentIds),
        ...safeArray(data.students),
        data.studentId,
      ].map((id) => safeText(id)));

      const refs = safeArray(data.studentRefs);

      // Nombres explícitos cuando existen
      for (const r of refs) {
        const id = safeText(r?.id || r?.studentId);
        const name = safeText(r?.name || r?.displayName || r?.nombre);
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, { id, displayName: name, count: 0 });
        const entry = byId.get(id);
        if (!entry.displayName && name) entry.displayName = name;
        entry.count += 1;
      }

      for (const id of ids) {
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, { id, displayName: "", count: 0 });
        byId.get(id).count += 1;
      }
    }

    return [...byId.values()].map((entry) => ({
      id: entry.id,
      studentId: entry.id,
      displayName: entry.displayName || "Estudiante",
      bitacoraCount: entry.count,
      fromBitacoras: true,
    }));
  } catch (error) {
    throw withContextError(error, "listStudentRefsFromBitacoras");
  }
}

/* =============================================================================
  APP CONFIG / CATALOGS
============================================================================= */

export async function getCatalogs() {
  try {
    const ref = doc(db, COLLECTIONS.appConfig, DOCS.catalogs);
    const snap = await getDoc(ref);

    return snap.exists()
      ? normalizeDocBase(snap.id, snap.data())
      : null;
  } catch (error) {
    throw withContextError(error, "getCatalogs");
  }
}

export async function getPortalSettings() {
  try {
    const ref = doc(db, COLLECTIONS.appConfig, DOCS.portalSettings);
    const snap = await getDoc(ref);

    return snap.exists()
      ? normalizeDocBase(snap.id, snap.data())
      : null;
  } catch (error) {
    throw withContextError(error, "getPortalSettings");
  }
}

/* =============================================================================
  BITÁCORAS
============================================================================= */

export async function listBitacorasByStudent(studentId, options = {}) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const bitacorasRef = collection(db, COLLECTIONS.bitacoras);

    /*
      Evitamos orderBy aquí para reducir fricción con índices compuestos.
      Se ordena en cliente por fechaClase / createdAt.
    */
    const q = query(
      bitacorasRef,
      where("studentIds", "array-contains", id)
    );

    const snap = await getDocs(q);

    const items = docsToObjects(snap)
      .map((item) => normalizeBitacora(item))
      .filter(Boolean);

    const sorted = sortByDate(
      items,
      [
        SORTING?.bitacoras?.primaryField || "fechaClase",
        SORTING?.bitacoras?.fallbackField || "createdAt",
        "updatedAt",
      ],
      SORTING?.bitacoras?.direction || "desc"
    );

    const max = clampLimit(
      options.max || options.limit,
      LIMITS?.maxBitacorasQuery || 80,
      200
    );

    return sorted.slice(0, max);
  } catch (error) {
    throw withContextError(error, "listBitacorasByStudent");
  }
}

export async function listJournal(studentId, max = DEFAULT_MAX) {
  return listBitacorasByStudent(studentId, { max });
}

export async function getBitacora(bitacoraId) {
  try {
    const id = safeText(bitacoraId);
    assertNonEmptyString(id, "bitacoraId");

    const ref = doc(db, COLLECTIONS.bitacoras, id);
    const snap = await getDoc(ref);

    return snap.exists()
      ? normalizeBitacora({
          id: snap.id,
          ...snap.data(),
        })
      : null;
  } catch (error) {
    throw withContextError(error, "getBitacora");
  }
}

/*
  Compatibilidad con versión vieja.
  Antes pedía students/{studentId}/journal/{entryId}.
  Ahora la bitácora vive en bitacoras/{entryId}.
*/
export async function getJournalEntry(_studentId, entryId) {
  return getBitacora(entryId);
}

export async function getRecentBitacoras(studentId, max = LIMITS?.maxRecentBitacorasHome || 3) {
  const items = await listBitacorasByStudent(studentId, {
    max: Math.max(max, 12),
  });

  return items.slice(0, max);
}

/* =============================================================================
  STUDENT ROUTES
============================================================================= */

function buildRouteDocIds(studentId, processKey = "") {
  const id = safeText(studentId);
  const process = safeText(processKey || "general");

  return unique([
    `${id}__${process}`,
    id,
  ]);
}

export async function getStudentRoute(studentId, processKey = "general") {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const possibleDocIds = buildRouteDocIds(id, processKey);

    for (const docId of possibleDocIds) {
      const ref = doc(db, COLLECTIONS.studentRoutes, docId);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        return normalizeStudentRoute({
          id: snap.id,
          ...snap.data(),
        });
      }
    }

    /*
      Fallback por campos.
      Puede depender de reglas/índices, pero ayuda si los IDs históricos
      no siguieron studentId__processKey.
    */
    const routesRef = collection(db, COLLECTIONS.studentRoutes);

    const q = query(
      routesRef,
      where("studentId", "==", id),
      limit(10)
    );

    const snap = await getDocs(q);

    if (snap.empty) return null;

    const routes = docsToObjects(snap)
      .map((item) => normalizeStudentRoute(item))
      .filter(Boolean);

    const process = safeText(processKey).toLowerCase();

    const exact =
      routes.find((route) => safeText(route.processKey).toLowerCase() === process) ||
      routes.find((route) => safeText(route.processKey).toLowerCase() === "general") ||
      routes[0];

    return exact || null;
  } catch (error) {
    throw withContextError(error, "getStudentRoute");
  }
}

export async function getStudentRoutes(studentId, options = {}) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const max = clampLimit(options.max, 20, 60);
    const routesRef = collection(db, COLLECTIONS.studentRoutes);

    const primary = query(
      routesRef,
      where("studentId", "==", id),
      limit(max)
    );

    const snap = await getDocs(primary);

    let routes = docsToObjects(snap)
      .map((item) => normalizeStudentRoute(item))
      .filter(Boolean);

    if (!routes.length) {
      const direct = await getStudentRoute(id, options.processKey || "general");
      routes = direct ? [direct] : [];
    }

    return sortByDate(routes, ["updatedAt", "createdAt"], "desc");
  } catch (error) {
    throw withContextError(error, "getStudentRoutes");
  }
}

export async function getBestStudentRoute(studentId, options = {}) {
  const routes = await getStudentRoutes(studentId, options);

  if (options.processKey) {
    const process = safeText(options.processKey).toLowerCase();
    const exact = routes.find(
      (route) => safeText(route.processKey).toLowerCase() === process
    );

    if (exact) return exact;
  }

  return routes[0] || null;
}

/* =============================================================================
  RESOURCES
============================================================================= */

function normalizeAreaText(value) {
  return safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function getStudentAreas(student) {
  if (!student) return [];

  return unique(
    [
      student.area,
      student.instrument,
      student.instrumento,
      student.program,
      student.programa,
      student.process,
      student.proceso,
    ]
      .map((item) => normalizeAreaText(item))
      .filter(Boolean)
  );
}

function resourceMatchesStudent(resource, student) {
  const resourceArea = normalizeAreaText(
    resource.area ||
    resource.instrument ||
    resource.instrumento ||
    resource.program ||
    resource.programa
  );

  /* Recursos sin área son material general visible para todos. */
  if (!resourceArea) return true;

  const studentAreas = getStudentAreas(student);

  if (!studentAreas.length) return true;

  /*
    Coincidencia flexible: "guitarra" empata con "Guitarra Acústica",
    "violín" con "violin", etc.
  */
  return studentAreas.some(
    (value) =>
      value === resourceArea ||
      value.includes(resourceArea) ||
      resourceArea.includes(value)
  );
}

export async function listResources(options = {}) {
  try {
    const {
      max = LIMITS?.maxResourcesPage || DEFAULT_MAX,
      student = null,
      studentId = null,
      activeOnly = true,
    } = options;

    const finalMax = clampLimit(max, DEFAULT_MAX, 120);

    /*
      Los recursos viven en el proyecto biblioteca-guitarra-fa182,
      colección "recursos". Solo se muestran los publicados, filtrados
      por el área a la que está inscrito el estudiante.
    */
    const resourcesRef = collection(libraryDb, LIBRARY_COLLECTIONS.resources);

    const clauses = [];

    if (activeOnly) {
      clauses.push(where("estado", "==", "publicado"));
    }

    /*
      Se leen todos los publicados (la biblioteca tiene ~200 recursos) y el
      filtro por área se hace en cliente, porque las áreas del estudiante
      pueden venir con mayúsculas o sin tildes.
    */
    const fetchCap = 1000;

    const primary = query(
      resourcesRef,
      ...clauses,
      limit(fetchCap)
    );

    const fallback = query(
      resourcesRef,
      limit(fetchCap)
    );

    const snap = await getDocsSafe(primary, fallback, "listResources");

    let resources = docsToObjects(snap)
      .map((item) => normalizeResource(item))
      .filter(Boolean)
      .filter((item) => !activeOnly || item.active !== false);

    let studentData = student;

    if (!studentData && studentId) {
      studentData = await getStudent(studentId);
    }

    resources = resources.filter((resource) => resourceMatchesStudent(resource, studentData));

    resources = sortByText(resources, "title", "asc");

    return resources.slice(0, finalMax);
  } catch (error) {
    throw withContextError(error, "listResources");
  }
}

export async function getResource(resourceId) {
  try {
    const id = safeText(resourceId);
    assertNonEmptyString(id, "resourceId");

    const ref = doc(libraryDb, LIBRARY_COLLECTIONS.resources, id);
    const snap = await getDoc(ref);

    return snap.exists()
      ? normalizeResource({
          id: snap.id,
          ...snap.data(),
        })
      : null;
  } catch (error) {
    throw withContextError(error, "getResource");
  }
}

export async function getHomeResources(student, max = LIMITS?.maxResourcesHome || 4) {
  const items = await listResources({
    student,
    max: Math.max(max, 12),
  });

  return items.slice(0, max);
}

/* =============================================================================
  EVENTS
============================================================================= */

function eventIsUpcoming(event, from = new Date()) {
  const start = toDateMaybe(event.dateStart || event.fecha || event.date || event.createdAt);

  if (!start) return true;

  const fromDate = from instanceof Date && !Number.isNaN(from.getTime())
    ? from
    : new Date();

  const startOfDay = new Date(fromDate);
  startOfDay.setHours(0, 0, 0, 0);

  return start.getTime() >= startOfDay.getTime();
}

export async function listEvents(options = {}) {
  try {
    const {
      max = LIMITS?.maxEventsPage || 60,
      from = new Date(),
      visibility = "students",
      activeOnly = true,
      upcomingOnly = true,
    } = options;

    const finalMax = clampLimit(max, DEFAULT_MAX, 120);
    const eventsRef = collection(db, COLLECTIONS.events);

    const clauses = [];

    if (visibility) {
      clauses.push(where("visibility", "in", unique([visibility, "public"])));
    }

    if (activeOnly) {
      clauses.push(where("active", "==", true));
    }

    const primary = query(
      eventsRef,
      ...clauses,
      limit(finalMax)
    );

    const fallback = query(
      eventsRef,
      limit(finalMax)
    );

    const snap = await getDocsSafe(primary, fallback, "listEvents");

    let events = docsToObjects(snap)
      .map((item) => normalizeEvent(item))
      .filter(Boolean)
      .filter((item) => !activeOnly || item.active !== false);

    if (upcomingOnly) {
      events = events.filter((event) => eventIsUpcoming(event, from));
    }

    events = sortByDate(
      events,
      [
        SORTING?.events?.primaryField || "dateStart",
        SORTING?.events?.fallbackField || "createdAt",
      ],
      SORTING?.events?.direction || "asc"
    );

    return events.slice(0, finalMax);
  } catch (error) {
    throw withContextError(error, "listEvents");
  }
}

export async function getEvent(eventId) {
  try {
    const id = safeText(eventId);
    assertNonEmptyString(id, "eventId");

    const ref = doc(db, COLLECTIONS.events, id);
    const snap = await getDoc(ref);

    return snap.exists()
      ? normalizeEvent({
          id: snap.id,
          ...snap.data(),
        })
      : null;
  } catch (error) {
    throw withContextError(error, "getEvent");
  }
}

export async function getHomeEvents(max = LIMITS?.maxEventsHome || 4) {
  const items = await listEvents({
    max: Math.max(max, 12),
  });

  return items.slice(0, max);
}

/* =============================================================================
  CLASSES / SHOWCASES / LIBRARY - compatibilidad vieja
============================================================================= */

/*
  En la arquitectura nueva, el seguimiento real está en bitacoras.
  Estas funciones quedan como wrappers para no romper views antiguas.
*/

export async function getClassesSummary(studentId, max = 200) {
  try {
    const bitacoras = await listBitacorasByStudent(studentId, {
      max: Math.min(max, LIMITS?.maxBitacorasQuery || 80),
    });

    const last = bitacoras[0] || null;
    const lastDate = last?._fechaClase || last?._createdAt || null;

    return {
      counts: {
        total: bitacoras.length,
        taken: bitacoras.length,
        scheduled: 0,
        canceled: 0,
      },
      lastDate,
      items: bitacoras,
    };
  } catch (error) {
    throw withContextError(error, "getClassesSummary");
  }
}

export async function listShowcases(_studentId, max = DEFAULT_MAX) {
  try {
    const events = await listEvents({
      max,
      upcomingOnly: false,
    });

    return events.filter((event) => {
      const type = safeText(event.type || event.tipo).toLowerCase();
      return ["showcase", "muestra", "concert", "concierto", "event"].includes(type);
    });
  } catch (error) {
    throw withContextError(error, "listShowcases");
  }
}

export async function listLibraryPins(studentId, max = DEFAULT_MAX) {
  try {
    const student = studentId ? await getStudent(studentId) : null;

    return listResources({
      student,
      max,
    });
  } catch (error) {
    throw withContextError(error, "listLibraryPins");
  }
}

/*
  Función genérica vieja.
  Se mantiene para compatibilidad, pero la app nueva debería preferir
  listBitacorasByStudent, listResources, listEvents, etc.
*/
export async function listStudentSubcollection(studentId, subcollectionName, options = {}) {
  try {
    const sub = safeText(subcollectionName);
    const max = clampLimit(options.max, DEFAULT_MAX, 100);

    if (sub === "journal") {
      return {
        items: await listJournal(studentId, max),
        cursor: null,
      };
    }

    if (sub === "classes") {
      const summary = await getClassesSummary(studentId, max);
      return {
        items: summary.items,
        cursor: null,
      };
    }

    if (sub === "showcases") {
      return {
        items: await listShowcases(studentId, max),
        cursor: null,
      };
    }

    if (sub === "libraryPins") {
      return {
        items: await listLibraryPins(studentId, max),
        cursor: null,
      };
    }

    /*
      Fallback real a subcolección antigua si todavía existe.
    */
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");
    assertNonEmptyString(sub, "subcollectionName");

    const {
      orderField = "date",
      orderDir = "desc",
      cursor = null,
      filters = [],
    } = options;

    const colRef = collection(db, COLLECTIONS.students, id, sub);
    const clauses = [];

    for (const filter of safeArray(filters)) {
      if (!filter?.field || !filter?.op) continue;
      clauses.push(where(filter.field, filter.op, filter.value));
    }

    const qParts = [
      ...clauses,
      orderBy(orderField, orderDir),
      limit(max),
    ];

    const q = cursor
      ? query(colRef, ...qParts, startAfter(cursor))
      : query(colRef, ...qParts);

    const snap = await getDocs(q);

    return {
      items: docsToObjects(snap),
      cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    };
  } catch (error) {
    throw withContextError(error, "listStudentSubcollection");
  }
}

/* =============================================================================
  BUNDLES PARA VISTAS
============================================================================= */

export async function getStudentPortalHome(studentId, options = {}) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const providedStudent = options?.student && typeof options.student === "object"
      ? normalizeStudent(options.student)
      : null;
    const student = providedStudent || await getStudent(id);

    if (!student) {
      return {
        ...EMPTY_BUNDLE,
        student: null,
      };
    }

    const queryStudentId = getStudentIdentity(student) || id;
    const fallbackStudentId = getStudentFallbackId(student);

    const [
      route,
      routes,
      bitacoras,
      resources,
      events,
    ] = await Promise.all([
      getBestStudentRoute(queryStudentId).catch(() => null),
      getStudentRoutes(queryStudentId).catch(() => []),
      getRecentBitacoras(queryStudentId).then((items) => {
        if (items.length || !fallbackStudentId || fallbackStudentId === queryStudentId) {
          return items;
        }

        return getRecentBitacoras(fallbackStudentId);
      }).catch(() => []),
      getHomeResources(student).catch(() => []),
      getHomeEvents().catch(() => []),
    ]);

    return {
      student,
      route,
      routes,
      bitacoras,
      resources,
      events,
      catalogs: null,
    };
  } catch (error) {
    throw withContextError(error, "getStudentPortalHome");
  }
}

export async function getFullStudentPortalBundle(studentId) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const student = await getStudent(id);

    if (!student) {
      return {
        ...EMPTY_BUNDLE,
        student: null,
      };
    }

    const [
      route,
      routes,
      bitacoras,
      resources,
      events,
      catalogs,
    ] = await Promise.all([
      getBestStudentRoute(id).catch(() => null),
      getStudentRoutes(id).catch(() => []),
      listBitacorasByStudent(id, {
        max: LIMITS?.maxBitacorasPage || 30,
      }).catch(() => []),
      listResources({ student }).catch(() => []),
      listEvents().catch(() => []),
      getCatalogs().catch(() => null),
    ]);

    return {
      student,
      route,
      routes,
      bitacoras,
      resources,
      events,
      catalogs,
    };
  } catch (error) {
    throw withContextError(error, "getFullStudentPortalBundle");
  }
}

/* =============================================================================
  STORAGE HELPERS
  Nota: Estudiantes HUB por ahora es lectura.
  Estos helpers quedan listos para evidencia futura.
============================================================================= */

function validateFile(file) {
  if (typeof File !== "undefined" && !(file instanceof File)) {
    throw new Error("file debe ser un File.");
  }

  if (!file) {
    throw new Error("file es requerido.");
  }

  const allowedTypes = STORAGE_CONFIG?.allowedTypes || [];
  const maxSizeBytes = STORAGE_CONFIG?.maxSizeBytes || 15 * 1024 * 1024;

  if (allowedTypes.length && !allowedTypes.includes(file.type)) {
    throw new Error(`Tipo de archivo no permitido: ${file.type || "desconocido"}`);
  }

  if (file.size > maxSizeBytes) {
    throw new Error(
      `El archivo supera el tamaño máximo permitido de ${STORAGE_CONFIG.maxSizeMb || 15} MB.`
    );
  }

  return true;
}

export async function uploadFile(path, file, metadata = {}) {
  try {
    const cleanPath = safeText(path);
    assertNonEmptyString(cleanPath, "path");

    validateFile(file);

    const ref = storageRef(storage, cleanPath);

    await uploadBytes(ref, file, {
      contentType: file.type || metadata.contentType,
      customMetadata: metadata.customMetadata || {},
    });

    const url = await getDownloadURL(ref);

    return {
      path: cleanPath,
      url,
      name: file.name || "",
      type: file.type || "",
      size: file.size || 0,
    };
  } catch (error) {
    throw withContextError(error, "uploadFile");
  }
}

export async function getFileUrl(path) {
  try {
    const cleanPath = safeText(path);
    assertNonEmptyString(cleanPath, "path");

    const ref = storageRef(storage, cleanPath);
    return getDownloadURL(ref);
  } catch (error) {
    throw withContextError(error, "getFileUrl");
  }
}

export async function deleteFile(path) {
  try {
    const cleanPath = safeText(path);
    assertNonEmptyString(cleanPath, "path");

    const ref = storageRef(storage, cleanPath);
    await deleteObject(ref);

    return true;
  } catch (error) {
    throw withContextError(error, "deleteFile");
  }
}

/* =============================================================================
  FUTUROS WRITES CONTROLADOS
  Se dejan disponibles, pero la app de estudiantes no debería abusar de esto.
============================================================================= */

export async function createPracticeLog(studentId, payload = {}) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const logId = `${id}_${Date.now()}`;
    const ref = doc(db, COLLECTIONS.practiceLogs, logId);

    const cleanPayload = removeUndefinedFields({
      id: logId,
      studentId: id,
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(ref, cleanPayload, { merge: true });

    return normalizeDocBase(logId, cleanPayload);
  } catch (error) {
    throw withContextError(error, "createPracticeLog");
  }
}

export async function updatePracticeLog(logId, patch = {}) {
  try {
    const id = safeText(logId);
    assertNonEmptyString(id, "logId");

    const ref = doc(db, COLLECTIONS.practiceLogs, id);

    await updateDoc(ref, removeUndefinedFields({
      ...patch,
      updatedAt: serverTimestamp(),
    }));

    return true;
  } catch (error) {
    throw withContextError(error, "updatePracticeLog");
  }
}

export async function listPracticeLogs(studentId, options = {}) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const max = clampLimit(options.max, 90, 200);
    const logsRef = collection(db, COLLECTIONS.practiceLogs);

    /*
      Nota: para orderBy + where compuesto se necesita índice en Firebase Console.
      Si falla, se hace fallback sin ordenar y se ordena en cliente.
    */
    const primary = query(
      logsRef,
      where("studentId", "==", id),
      limit(max)
    );

    const snap = await getDocs(primary);

    const items = docsToObjects(snap).filter(Boolean);

    return sortByDate(items, ["date", "fecha", "createdAt"], "desc").slice(0, max);
  } catch (error) {
    throw withContextError(error, "listPracticeLogs");
  }
}

export async function deletePracticeLog(logId) {
  try {
    const id = safeText(logId);
    assertNonEmptyString(id, "logId");

    await deleteDoc(doc(db, COLLECTIONS.practiceLogs, id));

    return true;
  } catch (error) {
    throw withContextError(error, "deletePracticeLog");
  }
}

/* =============================================================================
  MENSAJES ESTUDIANTE ↔ DOCENTE
============================================================================= */

function normalizeMessage(raw = null) {
  if (!raw) return null;

  return {
    id:          raw.id,
    studentId:   safeText(raw.studentId),
    text:        safeText(raw.text || raw.mensaje || raw.content || ""),
    senderRole:  safeText(raw.senderRole || raw.rol || "student"),
    senderName:  safeText(raw.senderName || raw.nombre || ""),
    read:        Boolean(raw.read),
    createdAt:   raw.createdAt || null,
    _createdAt:  toDateMaybe(raw.createdAt),
  };
}

export async function listMessages(studentId, max = 60) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const messagesRef = collection(db, COLLECTIONS.studentMessages, id, "messages");

    const q = query(messagesRef, orderBy("createdAt", "asc"), limit(clampLimit(max, 60, 200)));
    const snap = await getDocs(q);

    return docsToObjects(snap)
      .map((item) => normalizeMessage(item))
      .filter(Boolean);
  } catch (error) {
    throw withContextError(error, "listMessages");
  }
}

export async function sendStudentMessage(studentId, payload = {}) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const text = safeText(payload.text || payload.mensaje || "");
    if (!text) throw new Error("El mensaje no puede estar vacío.");

    const messagesRef = collection(db, COLLECTIONS.studentMessages, id, "messages");

    const msgData = removeUndefinedFields({
      studentId: id,
      text,
      senderRole:  safeText(payload.senderRole || "student"),
      senderName:  safeText(payload.senderName || ""),
      read:        false,
      createdAt:   serverTimestamp(),
    });

    const docRef = await addDoc(messagesRef, msgData);

    return normalizeMessage({ id: docRef.id, ...msgData });
  } catch (error) {
    throw withContextError(error, "sendStudentMessage");
  }
}

export function subscribeMessages(studentId, callback) {
  const id = safeText(studentId);
  if (!id || typeof callback !== "function") return () => {};

  try {
    const messagesRef = collection(db, COLLECTIONS.studentMessages, id, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"), limit(100));

    return onSnapshot(
      q,
      (snap) => {
        const messages = snap.docs
          .map((d) => normalizeMessage(normalizeDocBase(d.id, d.data())))
          .filter(Boolean);
        callback(null, messages);
      },
      (error) => {
        callback(error, []);
      }
    );
  } catch (error) {
    callback(error, []);
    return () => {};
  }
}

/* =============================================================================
  Debug / diagnóstico
============================================================================= */

export async function pingFirestore() {
  try {
    const ref = doc(db, COLLECTIONS.appConfig, DOCS.portalSettings);
    await getDoc(ref);

    return {
      ok: true,
      project: "bitacoras-de-clase",
      collections: COLLECTIONS,
    };
  } catch (error) {
    return {
      ok: false,
      error,
      message: error?.message || String(error),
      code: error?.code || "",
    };
  }
}

export const dataDebug = Object.freeze({
  normalizeAccessProfile,
  normalizeStudent,
  dedupeStudents,
  normalizeBitacora,
  normalizeStudentRoute,
  normalizeResource,
  normalizeEvent,
  toDateMaybe,
  sortByDate,
});
