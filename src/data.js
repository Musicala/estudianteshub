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
  - Resolver identidad exclusivamente desde users/{emailNormalizado}

  Este archivo NO renderiza UI.
  Este archivo NO crea ni repara identidades.
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
  arrayUnion,
  arrayRemove,
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

import { db, storage, libraryDb, teachersHubDb } from "./firebase.js";

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
  resolveStudentProcess,
  normalizeStudentProcesses,
} from "./normalizers.js";
import { resolveLogicalStudentRecords } from "./student-resolver.js";

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
    safeText(student.canonicalStudentId) ||
    safeText(student.studentKey) ||
    safeText(student.id) ||
    safeText(student.studentId) ||
    safeText(student.documento)
  );
}

function getStudentFallbackId(student = null) {
  if (!student) return "";

  return (
    safeText(student.academicRecordId) ||
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

function isPermissionError(error) {
  const text = String(error?.code || error?.message || error || "").toLowerCase();
  return text.includes("permission-denied") ||
    text.includes("missing or insufficient permissions") ||
    text.includes("permission");
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
  const role = safeText(raw.role || raw.rol || raw.type || raw.tipo || "")
    .toLowerCase();
  const canonicalStudentId = safeText(raw.studentId);

  const studentIds = unique([
    ...safeArray(raw.studentIds),
    canonicalStudentId,
  ].map((id) => safeText(id)));

  return {
    ...raw,
    id: raw.id || email,
    email,
    role,
    active: raw.active !== false && raw.estado !== "inactivo",
    studentIds,
    studentId: canonicalStudentId || studentIds[0] || null,
    displayName: raw.displayName || raw.nombre || raw.name || raw.fullName || "",
  };
}

export function normalizeStudent(raw = null) {
  return normalizeStudentRecord(raw);
}

export function dedupeStudents(records = [], options = {}) {
  return dedupeStudentRecords(records, options);
}

/*
  Busca la fecha de la bitácora aunque el editor la haya guardado con otro
  nombre de campo. Primero prueba los nombres conocidos; si no, recorre
  cualquier campo cuyo nombre sugiera fecha y que sí sea una fecha válida.
*/
function resolveBitacoraDate(raw = {}) {
  const known = [
    raw.fechaClase,
    raw.fechaDeClase,
    raw.fecha_clase,
    raw.classDate,
    raw.date,
    raw.fecha,
    raw.dia,
    raw.timestamp,
    raw.createdAt,
    raw.fechaCreacion,
    raw.updatedAt,
    // Bitácoras importadas guardan la fecha de importación en metadata.
    raw.metadata?.importedAt,
    raw.importedAt,
  ];

  for (const value of known) {
    if (value && toDateMaybe(value)) return value;
  }

  // Último recurso: cualquier campo que "huela" a fecha y sea parseable.
  for (const [key, value] of Object.entries(raw)) {
    if (!value) continue;
    if (!/fecha|date|dia|timestamp/i.test(key)) continue;
    if (toDateMaybe(value)) return value;
  }

  return null;
}

/*
  El proceso puede llegar como texto o como objeto (según el editor que creó
  la bitácora). La UI solo necesita una etiqueta legible; nunca debe terminar
  pintando "[object Object]".
*/
function resolveBitacoraProcessLabel(raw = {}) {
  const candidates = [raw.process, raw.proceso, raw.program, raw.programa];

  for (const value of candidates) {
    if (!value) continue;

    if (typeof value === "string") {
      const text = safeText(value);
      if (text) return text;
      continue;
    }

    if (typeof value === "object") {
      const label = safeText(
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
      if (label) return label;
    }
  }

  return "";
}

export function normalizeBitacora(raw = null) {
  if (!raw) return null;

  const fechaClase = resolveBitacoraDate(raw);

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

    process: resolveBitacoraProcessLabel(raw),
    proceso: resolveBitacoraProcessLabel(raw),
    processLabel: resolveBitacoraProcessLabel(raw) || safeText(raw.processLabel),

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
      El único origen de acceso es users/{correoNormalizado}. No se buscan
      documentos alternativos por campos ni por IDs heredados: si este documento
      aún no existe, el frontend muestra el estado correspondiente y no escribe.
    */
    const directSnap = await getDoc(doc(db, COLLECTIONS.users, normalizedEmail));
    if (!directSnap.exists()) return null;

    return normalizeAccessProfile({
      ...directSnap.data(),
      id: directSnap.id,
      email: normalizedEmail,
    });
  } catch (error) {
    throw withContextError(error, "getAccessProfileByEmail");
  }
}

export async function getUserByEmail(email) {
  return getAccessProfileByEmail(email);
}

// Accesos adicionales administrados por un admin desde el perfil del estudiante.
export async function listManagedPortalAccesses(studentId) {
  const id = safeText(studentId);
  assertNonEmptyString(id, "studentId");
  try {
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.users),
      where("studentIds", "array-contains", id)
    ));
    return snap.docs
      .map((item) => normalizeAccessProfile({ ...item.data(), id: item.id, email: item.id }))
      // Incluye los accesos administrados por esta versión y los que el HUB
      // anterior ya había reparado/vinculado. Así no parecen "vacíos" ni
      // se intenta crear de nuevo un correo que ya tiene acceso.
      .filter((profile) =>
        profile.portalAccessManaged === true || profile.linkedFromHub === true
      )
      .sort((a, b) => a.email.localeCompare(b.email, "es"));
  } catch (error) {
    throw withContextError(error, "listManagedPortalAccesses");
  }
}

export async function linkPortalAccess({ email, studentId, linkedBy = "" } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const id = safeText(studentId);
  const actor = normalizeEmail(linkedBy);
  assertNonEmptyString(normalizedEmail, "email");
  assertNonEmptyString(id, "studentId");
  assertNonEmptyString(actor, "linkedBy");
  try {
    const existing = await getAccessProfileByEmail(normalizedEmail);
    if (existing) {
      const linkedIds = unique([
        ...safeArray(existing.studentIds),
        existing.studentId,
        ...safeArray(existing.students),
      ].map((value) => safeText(value)));

      if (linkedIds.includes(id)) {
        return { email: normalizedEmail, status: "already-linked" };
      }

      await updateDoc(doc(db, COLLECTIONS.users, normalizedEmail), {
        studentIds: arrayUnion(id),
        updatedAt: serverTimestamp(),
      });
      return { email: normalizedEmail, status: "student-added" };
    }

    await setDoc(doc(db, COLLECTIONS.users, normalizedEmail), {
      email: normalizedEmail,
      role: "acudiente",
      active: true,
      studentId: id,
      studentIds: [id],
      portalAccessManaged: true,
      linkedBy: actor,
      linkedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { email: normalizedEmail, status: "linked" };
  } catch (error) {
    throw withContextError(error, "linkPortalAccess");
  }
}

export async function revokeManagedPortalAccess(email, studentId) {
  const normalizedEmail = normalizeEmail(email);
  const id = safeText(studentId);
  assertNonEmptyString(normalizedEmail, "email");
  assertNonEmptyString(id, "studentId");
  try {
    const existing = await getAccessProfileByEmail(normalizedEmail);
    if (!existing) return false;

    const remaining = unique([
      ...safeArray(existing.studentIds),
      existing.studentId,
      ...safeArray(existing.students),
    ].map((value) => safeText(value))).filter((linkedId) => linkedId !== id);

    const profileRef = doc(db, COLLECTIONS.users, normalizedEmail);
    if (!remaining.length && existing.portalAccessManaged === true) {
      await deleteDoc(profileRef);
    } else {
      await updateDoc(profileRef, {
        studentIds: arrayRemove(id),
        updatedAt: serverTimestamp(),
      });
    }
    return true;
  } catch (error) {
    throw withContextError(error, "revokeManagedPortalAccess");
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

// Sugerencias separadas de las obras oficiales: un estudiante nunca reescribe
// la lista pedagógica completa mientras el docente la está actualizando.
export async function listStudentWorkSuggestions(studentId, max = 40) {
  const id = safeText(studentId);
  if (!id) return [];
  const snap = await getDocs(query(
    collection(db, "student_work_suggestions"),
    where("studentId", "==", id),
    limit(Math.min(Math.max(Number(max) || 40, 1), 100))
  ));
  return docsToObjects(snap);
}

export async function createStudentWorkSuggestion(studentId, student, payload = {}) {
  const id = safeText(studentId);
  const nombre = safeText(payload.nombre || payload.title).slice(0, 300);
  if (!id || !nombre) throw new Error("Escribe el nombre de la obra que quieres sugerir.");
  const ref = await addDoc(collection(db, "student_work_suggestions"), {
    studentId: id,
    studentName: safeText(student?.nombre || student?.name || "Estudiante").slice(0, 160),
    nombre,
    notas: safeText(payload.notas || payload.notes).slice(0, 1000),
    estado: "pendiente",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, studentId: id, nombre, estado: "pendiente" };
}

export async function getStudentsByIds(studentIds = []) {
  try {
    const ids = unique(safeArray(studentIds).map((id) => safeText(id)));

    if (!ids.length) return [];

    const out = [];
    const parts = chunk(ids, MAX_IN);
    const studentsRef = collection(db, COLLECTIONS.students);

    try {
      for (const part of parts) {
        const q = query(studentsRef, where(documentId(), "in", part));
        const snap = await getDocs(q);

        out.push(
          ...docsToObjects(snap).map((item) => normalizeStudent(item))
        );
      }
    } catch (error) {
      if (!isPermissionError(error)) throw error;

      console.warn(
        "[data] getStudentsByIds agrupado bloqueado por reglas. Usando lecturas individuales.",
        error
      );

      const settled = await Promise.allSettled(
        ids.map(async (id) => {
          const snap = await getDoc(doc(db, COLLECTIONS.students, id));
          return snap.exists()
            ? normalizeStudent({
                id: snap.id,
                ...snap.data(),
              })
            : null;
        })
      );

      out.push(
        ...settled
          .filter((item) => item.status === "fulfilled" && item.value)
          .map((item) => item.value)
      );
    }

    const deduped = resolveLogicalStudentRecords(out);
    const map = new Map();

    for (const student of deduped) {
      const aliases = unique([
        student.id,
        student.studentId,
        student.studentKey,
        student.estudianteId,
        getCanonicalStudentKey(student),
        ...(student.linkedStudentIds || []),
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

    const deduped = resolveLogicalStudentRecords(
      docsToObjects(snap).map((item) => normalizeStudent(item))
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
  ALIAS DE ESTUDIANTE PARA CONSULTAS

  El editor de Bitácoras pudo etiquetar bitácoras/rutas con una llave distinta
  a la que tiene el HUB (a veces el id del doc, a veces el documento, a veces un
  studentKey). Para que "a unos sí, a otros no" deje de pasar, las consultas se
  hacen contra TODAS las llaves conocidas del estudiante, no solo una.
============================================================================= */

function buildStudentAliasIds(student = null, baseId = "") {
  return unique(
    [
      baseId,
      getStudentIdentity(student),
      student?.id,
      student?.studentId,
      student?.studentKey,
      student?.estudianteId,
      student?.documento,
      ...safeArray(student?.linkedStudentIds),
      ...safeArray(student?.duplicateRecords).flatMap((record) => [
        record?.id,
        record?.studentId,
        record?.studentKey,
        record?.estudianteId,
        record?.documento,
      ]),
    ].map((value) => safeText(value))
  );
}

/*
  Devuelve la lista de ids con la que vale la pena consultar. Si quien llama ya
  trae el objeto estudiante (caso de los bundles), no hacemos lecturas extra.
*/
async function resolveStudentAliasIds(idOrIds, options = {}) {
  const baseId = safeText(idOrIds);

  let student =
    options.student && typeof options.student === "object" ? options.student : null;

  if (!student && baseId) {
    student = await getStudent(baseId).catch(() => null);
  }

  const aliases = unique([
    ...safeArray(options.aliasIds).map((value) => safeText(value)),
    ...buildStudentAliasIds(student, baseId),
  ]);

  return aliases.length ? aliases : [baseId].filter(Boolean);
}

/* =============================================================================
  BITÁCORAS
============================================================================= */

export async function listBitacorasByStudent(studentId, options = {}) {
  try {
    const id = safeText(studentId);
    assertNonEmptyString(id, "studentId");

    const bitacorasRef = collection(db, COLLECTIONS.bitacoras);

    const aliasIds = await resolveStudentAliasIds(id, options);

    /*
      Evitamos orderBy aquí para reducir fricción con índices compuestos.
      Se ordena en cliente por fechaClase / createdAt.

      Consultamos por TODAS las llaves del estudiante con array-contains-any
      (máx. 10 por consulta), y unimos resultados sin duplicar.

      OJO con cuentas de estudiante/acudiente: las reglas de Firestore no
      filtran documentos, validan la consulta completa. Si UNO solo de los
      alias no está vinculado en users/{email}, el array-contains-any entero
      se rechaza con permission-denied. Por eso, cuando la consulta agrupada
      falla por permisos, degradamos a consultas individuales por alias: las
      llaves que sí están en el perfil pasan y las demás se ignoran.
    */
    const byDocId = new Map();

    const collectDocs = (snap) => {
      for (const docItem of snap.docs) {
        byDocId.set(docItem.id, normalizeDocBase(docItem.id, docItem.data() || {}));
      }
    };

    const isPermissionDenied = (error) =>
      String(error?.code || "").includes("permission-denied");

    let deniedGrouped = false;

    for (const part of chunk(aliasIds, MAX_IN)) {
      if (!part.length) continue;
      try {
        const snap = await getDocs(
          query(bitacorasRef, where("studentIds", "array-contains-any", part))
        );
        collectDocs(snap);
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
        deniedGrouped = true;
      }
    }

    if (deniedGrouped) {
      console.warn(
        "[data] listBitacorasByStudent: consulta agrupada denegada por reglas; reintentando alias por alias."
      );

      for (const aliasId of aliasIds) {
        try {
          const snap = await getDocs(
            query(bitacorasRef, where("studentIds", "array-contains", aliasId))
          );
          collectDocs(snap);
        } catch (error) {
          if (!isPermissionDenied(error)) throw error;
          // Alias no vinculado al perfil: se ignora sin romper el resultado.
        }
      }
    }

    // Algunas sesiones autorizadas pueden recibir cero resultados en la
    // consulta agrupada aunque una llave individual sí coincida. Verificamos
    // alias por alias antes de concluir que el estudiante no tiene bitácoras.
    if (!byDocId.size && !deniedGrouped) {
      for (const aliasId of aliasIds) {
        try {
          const snap = await getDocs(
            query(bitacorasRef, where("studentIds", "array-contains", aliasId))
          );
          collectDocs(snap);
        } catch (error) {
          if (!isPermissionDenied(error)) throw error;
        }
      }
    }

    /*
      Bitácoras antiguas pueden tener solo studentId (texto) y no la lista
      studentIds. Si aún no hay resultados, probamos igualdad por alias.
    */
    for (const aliasId of aliasIds) {
      try {
        const snap = await getDocs(
          query(bitacorasRef, where("studentId", "==", aliasId))
        );
        collectDocs(snap);
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
      }
    }

    const items = [...byDocId.values()]
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

export async function getRecentBitacoras(studentId, max = LIMITS?.maxRecentBitacorasHome || 3, options = {}) {
  const items = await listBitacorasByStudent(studentId, {
    max: Math.max(max, 12),
    ...options,
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

    const aliasIds = await resolveStudentAliasIds(id, options);

    // Buscamos por todas las llaves del estudiante (in, máx. 10 por consulta).
    const byDocId = new Map();

    for (const part of chunk(aliasIds, MAX_IN)) {
      if (!part.length) continue;
      const q = query(routesRef, where("studentId", "in", part), limit(max));
      const snap = await getDocs(q);
      for (const docItem of snap.docs) {
        byDocId.set(docItem.id, normalizeDocBase(docItem.id, docItem.data() || {}));
      }
    }

    let routes = [...byDocId.values()]
      .map((item) => normalizeStudentRoute(item))
      .filter(Boolean);

    if (!routes.length) {
      // Respaldo por id de documento (studentId__processKey) con cada alias.
      for (const aliasId of aliasIds) {
        const direct = await getStudentRoute(aliasId, options.processKey || "general");
        if (direct) {
          routes = [direct];
          break;
        }
      }
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
  LEARNING ROUTE — route_templates + student_route_progress
  Fuente: editor de "Bitácoras de Clase".
  - route_templates/{artKey}                : estructura compartida por área/instrumento.
  - student_route_progress/{studentId}__{artKey} : avance individual del estudiante.
  El HUB solo lee (no escribe) estas colecciones.
============================================================================= */

const ROUTE_COMPONENT_ORDER = ["corporal", "tecnico", "teorico", "obras", "repertorio"];

const ROUTE_COMPONENT_LABELS = Object.freeze({
  corporal: "Corporal",
  tecnico: "Técnico",
  teorico: "Teórico",
  obras: "Obras",
  repertorio: "Repertorio",
  general: "General",
});

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return "";
}

function toComponentId(value = "") {
  const normalized = safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  if (normalized.includes("corporal")) return "corporal";
  if (normalized.includes("tecnico")) return "tecnico";
  if (normalized.includes("teorico")) return "teorico";
  if (normalized.includes("obra")) return "obras";
  if (normalized.includes("repertorio")) return "repertorio";
  return normalized || "general";
}

/*
  Deriva el artKey (id de plantilla) a partir del área/instrumento del estudiante.
  Réplica exacta de normalizeArtKey() del editor de Bitácoras, para que el HUB
  apunte al mismo documento de route_templates.
*/
export function resolveRouteArtKey(student = null) {
  const activeProcess =
    resolveStudentProcess(student) ||
    normalizeStudentProcesses(student)[0] ||
    null;

  const rawValue = firstNonEmpty(
    activeProcess?.detalle,
    activeProcess?.label,
    activeProcess?.programa,
    activeProcess?.instrumento,
    activeProcess?.arte,
    student?.area,
    student?.instrumento,
    student?.programa
  );

  const normalized = safeText(rawValue)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) return "general";
  if (normalized.includes("bateria") || normalized.includes("percusion")) return "bateria";
  if (normalized.includes("guitarra")) return "guitarra";
  if (normalized.includes("cello") || normalized.includes("violoncello")) return "cello";
  if (normalized.includes("canto")) return "canto";
  if (normalized.includes("danza")) return "danza";
  if (normalized.includes("teatro")) return "teatro";
  if (normalized.includes("plast")) return "artes-plasticas";
  return normalized;
}

function slugifyArt(value = "") {
  return safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/*
  Lista de posibles ids de plantilla (artKey) para un estudiante. Probamos
  varias porque el editor de Bitácoras pudo guardar la plantilla con un nombre
  ligeramente distinto (con/sin tilde, "guitarra-acustica", "musica", etc.).
*/
function buildRouteArtKeyCandidates(student = null) {
  const activeProcess =
    resolveStudentProcess(student) ||
    normalizeStudentProcesses(student)[0] ||
    null;

  const rawValues = [
    resolveRouteArtKey(student),
    activeProcess?.detalle,
    activeProcess?.instrumento,
    activeProcess?.instrument,
    activeProcess?.arte,
    activeProcess?.programa,
    activeProcess?.program,
    activeProcess?.label,
    student?.instrumento,
    student?.instrument,
    student?.area,
    student?.programa,
    student?.program,
  ];

  const candidates = [];
  for (const value of rawValues) {
    const slug = slugifyArt(value);
    if (slug && !candidates.includes(slug)) candidates.push(slug);
  }

  return candidates;
}

/*
  Si no encontramos plantilla con los ids candidatos, leemos la colección
  completa de route_templates (es pequeña) y emparejamos por similitud entre
  el arte del estudiante y los datos de cada plantilla. Así la ruta se conecta
  aunque el id no coincida exactamente.
*/
async function findRouteTemplateByMatch(student = null) {
  try {
    const studentTerms = expandResourceTerms(
      buildRouteArtKeyCandidates(student).concat(collectStudentResourceTerms(student))
    ).filter((term) => !BROAD_MUSIC_TERMS.has(term));

    if (!studentTerms.length) return null;

    const templatesRef = collection(db, COLLECTIONS.routeTemplates);
    const snap = await getDocs(query(templatesRef, limit(100)));
    if (snap.empty) return null;

    let best = null;

    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const templateTerms = expandResourceTerms([
        docSnap.id,
        data.routeTemplateId,
        data.areaKey,
        data.instrumentKey,
        data.artKey,
        data.arte,
        data.area,
        data.instrumento,
        data.instrument,
        data.programa,
        data.program,
        data.focusArea,
        data.processLabel,
        data.routeName,
      ]).filter((term) => !BROAD_MUSIC_TERMS.has(term));

      const score = templateTerms.reduce((acc, term) => {
        const hit = studentTerms.some(
          (st) => st === term || st.includes(term) || term.includes(st)
        );
        return acc + (hit ? 1 : 0);
      }, 0);

      const goalsCount = Array.isArray(data.goals)
        ? data.goals.length
        : Array.isArray(data.customGoals)
          ? data.customGoals.length
          : 0;

      if (score > 0 && (!best || score > best.score)) {
        best = { artKey: docSnap.id, template: data, score, goalsCount };
      }
    });

    return best;
  } catch (error) {
    return null;
  }
}

function normalizeLearningGoal(raw = {}, index = 0, sets = {}) {
  if (!raw || typeof raw !== "object") return null;

  const id = safeText(raw.id) || `goal-${index + 1}`;
  const title = safeText(raw.title || raw.titulo || raw.nombre);
  if (!title) return null;

  const component = toComponentId(raw.component || raw.componentLabel);
  const componentLabel =
    safeText(raw.componentLabel) || ROUTE_COMPONENT_LABELS[component] || "General";

  const done = sets.completed?.has(id) || false;
  const active = !done && (sets.active?.has(id) || false);

  return {
    id,
    title,
    description: safeText(raw.description || raw.descripcion),
    component,
    componentLabel,
    experience: Number(raw.experience) || 1,
    order: Number(raw.order) || index + 1,
    done,
    active,
    status: done ? "Logrado" : active ? "En foco" : "",
  };
}

function buildLearningRoute({ student, artKey, template, progress }) {
  const tmpl = template && typeof template === "object" ? template : {};
  const prog = progress && typeof progress === "object" ? progress : {};

  const completed = new Set((prog.completedGoalIds || []).map((v) => safeText(v)));
  const active = new Set((prog.activeGoalIds || []).map((v) => safeText(v)));

  const rawGoals = Array.isArray(tmpl.goals)
    ? tmpl.goals
    : Array.isArray(tmpl.customGoals)
      ? tmpl.customGoals
      : [];

  const goals = rawGoals
    .map((goal, index) => normalizeLearningGoal(goal, index, { completed, active }))
    .filter(Boolean)
    .sort((a, b) => a.experience - b.experience || a.order - b.order);

  const totalGoals = goals.length;
  const completedGoals = goals.filter((goal) => goal.done).length;
  const progressPct = totalGoals ? Math.round((completedGoals / totalGoals) * 100) : 0;

  // Agrupación por bloque (componente), respetando el orden canónico.
  const byComponent = new Map();
  for (const goal of goals) {
    if (!byComponent.has(goal.component)) byComponent.set(goal.component, []);
    byComponent.get(goal.component).push(goal);
  }

  const blocks = [...byComponent.keys()]
    .sort((a, b) => {
      const ia = ROUTE_COMPONENT_ORDER.indexOf(a);
      const ib = ROUTE_COMPONENT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map((component) => {
      const items = byComponent.get(component);
      return {
        component,
        label: ROUTE_COMPONENT_LABELS[component] || items[0]?.componentLabel || "General",
        goals: items,
        total: items.length,
        done: items.filter((g) => g.done).length,
      };
    });

  const experienceDescriptions =
    tmpl.experienceDescriptions && typeof tmpl.experienceDescriptions === "object"
      ? tmpl.experienceDescriptions
      : {};

  const experiences = [...new Set(goals.map((g) => g.experience))]
    .sort((a, b) => a - b)
    .map((experience) => {
      const items = goals.filter((g) => g.experience === experience);
      return {
        experience,
        label: `Experiencia ${experience}`,
        description: safeText(experienceDescriptions[String(experience)]),
        goals: items,
        total: items.length,
        done: items.filter((g) => g.done).length,
      };
    });

  const processLabel = firstNonEmpty(tmpl.processLabel, prog.processLabel, tmpl.focusArea);

  return {
    id: `${getStudentIdentity(student)}__${artKey}`,
    studentId: getStudentIdentity(student),
    artKey,
    routeTemplateId: artKey,
    isLearningRoute: true,

    title: firstNonEmpty(tmpl.routeName, "Ruta de aprendizaje"),
    routeName: firstNonEmpty(tmpl.routeName, "Ruta de aprendizaje"),
    processLabel,
    description: firstNonEmpty(tmpl.description, tmpl.descripcion),

    stage: firstNonEmpty(prog.stage, "Experiencia 1"),
    experience: Number(prog.experience) || 1,

    goals,
    blocks,
    experiences,
    experienceDescriptions,

    totalGoals,
    completedGoals,
    progress: progressPct,

    recommendations: Array.isArray(prog.recommendations) ? prog.recommendations : [],
    history: Array.isArray(prog.history) ? prog.history : [],
    milestones: Array.isArray(prog.milestones) ? prog.milestones : [],

    hasTemplate: Boolean(template),
    hasProgress: Boolean(progress),
  };
}

export async function getStudentLearningRoute(student = null, options = {}) {
  try {
    const studentId = getStudentIdentity(student);
    if (!studentId) return null;

    // Probamos varios ids posibles de plantilla (no solo uno), porque el editor
    // pudo guardarla con un nombre ligeramente distinto.
    const candidates = options.artKey
      ? [safeText(options.artKey)]
      : buildRouteArtKeyCandidates(student);

    let artKey = null;
    let template = null;

    for (const candidate of candidates) {
      if (!candidate) continue;
      const snap = await getDoc(doc(db, COLLECTIONS.routeTemplates, candidate)).catch(() => null);
      if (snap?.exists()) {
        artKey = candidate;
        template = snap.data();
        break;
      }
    }

    // Si ningún id coincidió, emparejamos por similitud con toda la colección.
    if (!template) {
      const match = await findRouteTemplateByMatch(student);
      if (match) {
        artKey = match.artKey;
        template = match.template;
      }
    }

    // Último recurso: usamos el artKey derivado para al menos buscar progreso.
    if (!artKey) artKey = candidates[0] || resolveRouteArtKey(student);
    if (!artKey) return null;

    // El progreso se guarda como {studentId}__{artKey}, pero el editor pudo usar
    // otra llave del estudiante. Probamos todas las llaves conocidas.
    const aliasIds = buildStudentAliasIds(student, studentId);
    let progress = null;
    for (const aliasId of aliasIds) {
      const progressSnap = await getDoc(
        doc(db, COLLECTIONS.studentRouteProgress, `${aliasId}__${artKey}`)
      ).catch(() => null);
      if (progressSnap?.exists()) {
        progress = progressSnap.data();
        break;
      }
    }

    if (!template && !progress) return null;

    return buildLearningRoute({ student, artKey, template, progress });
  } catch (error) {
    // La ruta de aprendizaje es complementaria: si falla, la vista usa su fallback.
    return null;
  }
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

function normalizeResourceText(value) {
  return safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const BROAD_MUSIC_TERMS = new Set([
  "musica",
  "musical",
  "musicala",
  "instrumento",
  "instrumental",
]);

const MUSIC_THEORY_TERMS = [
  "teoria",
  "teoria musical",
  "gramatica musical",
  "gramatica",
  "lenguaje musical",
  "lenguaje",
  "lectura musical",
  "lectura ritmica",
  "lectura de partitura",
  "partitura",
  "partituras",
  "solfeo",
  "armonia",
  "apreciacion musical",
  "apreciacion",
  "historia de la musica",
  "entrenamiento auditivo",
  "audioperceptiva",
  "dictado",
  "dictados",
  "ritmo",
  "ritmica",
  "intervalos",
  "escalas",
  "acordes",
  "circulo de quintas",
  "figuras musicales",
];

/*
  Artes distintas a la música. Sirven para bloquear que, por ejemplo, un
  estudiante de música vea material de danza/teatro/plásticas (y viceversa).
  El término "ritmo" aparece tanto en teoría musical como en danza, por eso
  el bloqueo se decide por el ARTE del recurso (su área/instrumento/programa),
  no por palabras sueltas del texto.
*/
const NON_MUSIC_ART_ALIASES = {
  danza: [
    "danza",
    "danzas",
    "baile",
    "bailes",
    "ballet",
    "dancing",
    "coreografia",
    "coreografias",
    "urbano",
    "salsa",
    "folclor",
    "folclore",
  ],
  teatro: [
    "teatro",
    "teatral",
    "actuacion",
    "dramaturgia",
    "improvisacion teatral",
    "expresion corporal",
  ],
  "artes-plasticas": [
    "artes plasticas",
    "plastica",
    "plasticas",
    "dibujo",
    "pintura",
    "arte visual",
    "artes visuales",
    "manualidades",
    "modelado",
  ],
};

const NON_MUSIC_ART_TERMS = new Map();
for (const [art, aliases] of Object.entries(NON_MUSIC_ART_ALIASES)) {
  for (const alias of aliases) {
    NON_MUSIC_ART_TERMS.set(normalizeResourceText(alias), art);
  }
}

/*
  Clasifica un término en un "arte": danza, teatro, artes-plasticas o musica.
  Devuelve "" cuando el término no permite decidir (genérico).
*/
function detectArtFromTerm(term = "") {
  const normalized = normalizeResourceText(term);
  if (!normalized) return "";

  // Artes no musicales primero (orden importa: "dibujo" no es instrumento).
  if (NON_MUSIC_ART_TERMS.has(normalized)) {
    return NON_MUSIC_ART_TERMS.get(normalized);
  }
  for (const [aliasTerm, art] of NON_MUSIC_ART_TERMS.entries()) {
    if (normalized.includes(aliasTerm) || aliasTerm.includes(normalized)) {
      return art;
    }
  }

  if (RESOURCE_INSTRUMENT_TERMS.has(normalized)) return "musica";
  if (BROAD_MUSIC_TERMS.has(normalized)) return "musica";
  if (normalized.includes("musica") || normalized.includes("musical")) return "musica";
  if (
    MUSIC_THEORY_TERMS.some(
      (theory) => normalized === theory || normalized.includes(theory)
    )
  ) {
    return "musica";
  }

  return "";
}

function detectArts(terms = []) {
  const arts = new Set();
  for (const term of terms) {
    const art = detectArtFromTerm(term);
    if (art) arts.add(art);
  }
  return arts;
}

const RESOURCE_INSTRUMENT_ALIASES = {
  percusion: [
    "percusion",
    "bateria",
    "drums",
    "drum",
    "tambor",
    "tambores",
    "redoblante",
    "caja",
    "cajon",
    "conga",
    "congas",
    "bongo",
    "bongos",
    "timbal",
    "timbales",
    "platillos",
    "baquetas",
    "rudimentos",
  ],
  bateria: [
    "bateria",
    "percusion",
    "drums",
    "drum",
    "redoblante",
    "platillos",
    "baquetas",
    "rudimentos",
  ],
  guitarra: ["guitarra", "guitar", "guitarra acustica", "guitarra electrica"],
  piano: [
    "piano",
    "pianos",
    "pianista",
    "piano funcional",
    "piano complementario",
    "teclado",
    "teclados",
    "keyboard",
    "organeta",
  ],
  canto: ["canto", "voz", "vocal", "tecnica vocal"],
  violin: ["violin"],
  cello: ["cello", "violoncello", "chelo"],
  bajo: ["bajo", "bass", "bajo electrico"],
  ukelele: ["ukelele", "ukulele"],
  cuatro: ["cuatro"],
  dibujo: ["dibujo", "artes plasticas", "arte visual"],
  produccion: ["produccion musical", "produccion", "audio", "grabacion"],
};

const RESOURCE_INSTRUMENT_TERMS = new Set(
  Object.entries(RESOURCE_INSTRUMENT_ALIASES).flatMap(([instrument, aliases]) => [
    normalizeResourceText(instrument),
    ...aliases.map((alias) => normalizeResourceText(alias)),
  ])
);

function splitSearchTerms(value = "") {
  return normalizeResourceText(value)
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function expandResourceTerms(values = []) {
  const terms = new Set();

  for (const value of values) {
    const normalized = normalizeResourceText(value);
    if (!normalized) continue;

    terms.add(normalized);
    splitSearchTerms(normalized).forEach((term) => terms.add(term));
  }

  for (const term of [...terms]) {
    const aliases = RESOURCE_INSTRUMENT_ALIASES[term] || [];
    aliases.map((alias) => normalizeResourceText(alias)).forEach((alias) => terms.add(alias));
  }

  return [...terms].filter(Boolean);
}

function collectStudentResourceTerms(student = null) {
  if (!student) return [];

  const processes = normalizeStudentProcesses(student);

  return expandResourceTerms([
    student.area,
    student.instrument,
    student.instrumento,
    student.program,
    student.programa,
    student.process,
    student.proceso,
    ...processes.flatMap((process) => [
      process.arte,
      process.detalle,
      process.label,
      process.instrument,
      process.instrumento,
      process.program,
      process.programa,
    ]),
  ]);
}

function collectResourceTerms(resource = {}) {
  return expandResourceTerms([
    resource.area,
    resource.instrument,
    resource.instrumento,
    resource.program,
    resource.programa,
    resource.category,
    resource.categoria,
    resource.folder,
    resource.carpeta,
    resource.tema,
    resource.type,
    resource.tipo,
    resource.title,
    resource.titulo,
    resource.description,
    resource.descripcion,
    resource.observaciones,
    resource.observacion,
    resource.observations,
    resource.notas,
    resource.nota,
    resource.notes,
    resource.subtema,
    resource.subarea,
    ...safeArray(resource.tags || resource.etiquetas),
  ]);
}

/*
  ¿El texto del recurso (cualquier campo: área, categoría, tema, etiquetas,
  título, descripción, observaciones…) menciona el instrumento del estudiante?
  Detecta el instrumento aunque venga dentro de una frase ("Material de Piano",
  "...para Piano"), no solo cuando el término es exactamente "piano". Esto da
  PRIORIDAD a la coincidencia por instrumento sobre cualquier bloqueo.
*/
function resourceMentionsStudentInstrument(resourceTerms = [], studentTerms = []) {
  const studentInstruments = studentTerms.filter((term) =>
    RESOURCE_INSTRUMENT_TERMS.has(term)
  );
  if (!studentInstruments.length) return false;

  return studentInstruments.some((instrument) =>
    resourceTerms.some((resourceTerm) => resourceTerm.includes(instrument))
  );
}

function hasTermMatch(resourceTerms = [], studentTerms = []) {
  const preciseStudentTerms = studentTerms.filter((term) => !BROAD_MUSIC_TERMS.has(term));
  const preciseResourceTerms = resourceTerms.filter((term) => !BROAD_MUSIC_TERMS.has(term));

  return preciseStudentTerms.some((studentTerm) =>
    preciseResourceTerms.some((resourceTerm) =>
      resourceTerm === studentTerm ||
      resourceTerm.includes(studentTerm) ||
      studentTerm.includes(resourceTerm)
    )
  );
}

function isMusicStudent(studentTerms = []) {
  /*
    Un estudiante es "de música" si su texto menciona música/musical, o si su
    proceso es un instrumento reconocido (piano, guitarra, canto…), un término
    musical amplio o de teoría. Antes solo se aceptaba la palabra "musica", así
    que un estudiante registrado SOLO como "Piano" no recibía el material de
    teoría/lenguaje musical ni el material general. Ahora el instrumento basta.
  */
  return studentTerms.some((term) => {
    if (
      term === "musica" ||
      term.includes("musica") ||
      term === "musical" ||
      term.includes("musical")
    ) {
      return true;
    }
    if (RESOURCE_INSTRUMENT_TERMS.has(term) || BROAD_MUSIC_TERMS.has(term)) {
      return true;
    }
    return detectArtFromTerm(term) === "musica";
  });
}

function isMusicTheoryResource(resourceTerms = []) {
  return MUSIC_THEORY_TERMS.some((theoryTerm) =>
    resourceTerms.some((resourceTerm) =>
      resourceTerm === theoryTerm ||
      resourceTerm.includes(theoryTerm)
    )
  );
}

function targetsAnotherInstrument(resourceTerms = [], studentTerms = []) {
  const resourceInstruments = resourceTerms.filter((term) =>
    RESOURCE_INSTRUMENT_TERMS.has(term)
  );

  if (!resourceInstruments.length) return false;

  return !resourceInstruments.some((resourceInstrument) =>
    studentTerms.some((studentTerm) =>
      resourceInstrument === studentTerm ||
      resourceInstrument.includes(studentTerm) ||
      studentTerm.includes(resourceInstrument)
    )
  );
}

function targetsStudentInstrument(resourceTerms = [], studentTerms = []) {
  const resourceInstruments = resourceTerms.filter((term) =>
    RESOURCE_INSTRUMENT_TERMS.has(term)
  );

  if (!resourceInstruments.length) return false;

  return resourceInstruments.some((resourceInstrument) =>
    studentTerms.some((studentTerm) =>
      resourceInstrument === studentTerm ||
      resourceInstrument.includes(studentTerm) ||
      studentTerm.includes(resourceInstrument)
    )
  );
}

const UNPUBLISHED_RESOURCE_STATES = new Set([
  "borrador",
  "inactivo",
  "archivado",
  "oculto",
  "draft",
  "inactive",
  "archived",
  "hidden",
]);

/*
  ¿El recurso está publicado? Tolerante a mayúsculas/tildes: "Publicado",
  "publicado" o estado vacío se consideran visibles. Solo se ocultan los estados
  explícitos de no-publicado (borrador, inactivo, archivado, oculto).
*/
function isPublishedResource(resource = {}) {
  if (resource.active === false) return false;
  const estado = normalizeResourceText(resource.estado);
  if (!estado) return true;
  return !UNPUBLISHED_RESOURCE_STATES.has(estado);
}

function getStudentAreas(student) {
  return unique(collectStudentResourceTerms(student));
}

/*
  Especialidades "comunes" a toda una disciplina: un estudiante las ve aunque su
  instrumento no coincida (teoría/lenguaje musical, lectura, ritmo, material
  general). Debe coincidir con `generales` en config/taxonomia del Manager.
*/
const CLEAN_GENERAL_ESPECIALIDADES = new Set([
  "",
  "general",
  "teoria-musical",
  "lenguaje-musical",
  "lectura",
  "ritmo",
]);

/*
  Camino LIMPIO: cuando el recurso trae el campo nuevo `disciplina`, decidimos su
  visibilidad por campos exactos en lugar de adivinar por texto. Regla:
    disciplina coincide con el arte del estudiante
    Y (especialidad es general/teoría  O  coincide con su instrumento).
  Devuelve true/false si el recurso está clasificado; null si aún no lo está
  (entonces se usa la heurística legacy de abajo).
*/
function cleanResourceMatch(resource, student) {
  // Candado de público: si el recurso declara para quién es y no incluye
  // estudiantes (p. ej. material institucional de docentes), nunca se muestra.
  const publico = safeArray(resource.publico).map(normalizeResourceText);
  if (publico.length && !publico.includes("estudiantes")) return false;

  const disciplina = normalizeResourceText(resource.disciplina);
  if (!disciplina) return null; // recurso sin clasificar -> heurística legacy

  const studentAreas = getStudentAreas(student);
  if (!studentAreas.length) return true; // sin datos del estudiante -> mostrar

  const studentArts = detectArts(studentAreas);
  const resourceArt = detectArtFromTerm(disciplina) || disciplina;
  if (studentArts.size && !studentArts.has(resourceArt)) return false;

  const especialidad = normalizeResourceText(resource.especialidad);
  if (CLEAN_GENERAL_ESPECIALIDADES.has(especialidad)) return true;

  // Especialidad concreta: debe coincidir con el instrumento del estudiante.
  return studentAreas.some(
    (term) =>
      term === especialidad ||
      term.includes(especialidad) ||
      especialidad.includes(term)
  );
}

function resourceMatchesStudent(resource, student) {
  const limpio = cleanResourceMatch(resource, student);
  if (limpio !== null) return limpio;

  const resourceScopeTerms = expandResourceTerms([
    resource.area,
    resource.instrument,
    resource.instrumento,
    resource.program,
    resource.programa,
  ]);

  // Recurso sin área/instrumento definido: material general, visible para todos.
  const studentAreas = getStudentAreas(student);

  // Si no sabemos el área del estudiante, mostramos todo en vez de ocultar.
  if (!studentAreas.length) return true;

  const studentArts = detectArts(studentAreas);

  /*
    Compuerta por ARTE: si el recurso está claramente marcado para un arte
    (danza, teatro, plásticas o música) por su área/instrumento/programa, y ese
    arte no es el del estudiante, se bloquea. Así un estudiante de música no ve
    danza/teatro/plásticas y un estudiante de danza no ve material musical.
  */
  const scopeArts = detectArts(resourceScopeTerms);
  if (scopeArts.size && studentArts.size) {
    const sharesArt = [...scopeArts].some((art) => studentArts.has(art));
    if (!sharesArt) return false;
  }

  const concreteStudentAreas = studentAreas.filter((studentTerm) =>
    !BROAD_MUSIC_TERMS.has(studentTerm) &&
    !studentTerm.includes("musica") &&
    !studentTerm.includes("musical")
  );

  const resourceTerms = collectResourceTerms(resource);

  /*
    PRIORIDAD POR INSTRUMENTO: si cualquier campo del recurso (área, categoría,
    tema, etiquetas, título, descripción, observaciones…) menciona el instrumento
    del estudiante, se muestra. Ya pasamos la compuerta de arte, así que aquí solo
    decidimos dentro de la misma arte. Esto garantiza que "todo lo que diga Piano"
    le llegue a los estudiantes de Piano, aunque el Área diga otra cosa.
  */
  if (resourceMentionsStudentInstrument(resourceTerms, studentAreas)) {
    return true;
  }

  // Estudiante sin instrumento concreto (solo "música"): mostramos material
  // musical (de cualquier instrumento) y el material sin arte definido, pero
  // no el de otras artes.
  if (!concreteStudentAreas.length) {
    if (!scopeArts.size) {
      const looseArts = detectArts(resourceTerms);
      if (looseArts.size && ![...looseArts].some((art) => studentArts.has(art))) {
        return false;
      }
      return true;
    }
    return scopeArts.has("musica");
  }

  if (!resourceScopeTerms.length) {
    // Recurso sin scope: por instrumento del estudiante o teoría musical.
    if (targetsStudentInstrument(resourceTerms, studentAreas)) return true;

    // Si apunta claramente a OTRO instrumento, bloquear.
    if (targetsAnotherInstrument(resourceTerms, studentAreas)) return false;

    // Si los textos del recurso lo ubican claramente en otro arte, bloquear.
    const looseArts = detectArts(resourceTerms);
    if (
      looseArts.size &&
      studentArts.size &&
      ![...looseArts].some((art) => studentArts.has(art))
    ) {
      return false;
    }

    /*
      Material general (sin área ni instrumento que apunte a otro lado): visible
      para todo estudiante de música. Antes solo pasaba si era teoría, así que el
      material etiquetado "Música"/"Material general" no le cargaba a los de un
      instrumento concreto.
    */
    if (isMusicStudent(studentAreas)) return true;

    return isMusicTheoryResource(resourceTerms);
  }

  // Coincidencia directa de área/instrumento.
  const scopeMatch = resourceScopeTerms.some((resourceTerm) =>
    concreteStudentAreas.some((studentTerm) =>
      resourceTerm === studentTerm ||
      resourceTerm.includes(studentTerm) ||
      studentTerm.includes(resourceTerm)
    )
  );

  if (scopeMatch) return true;

  // Dentro de la misma arte: si el recurso apunta a OTRO instrumento, bloquear.
  if (targetsAnotherInstrument(resourceTerms, studentAreas)) return false;

  /*
    Coincidencia flexible adicional usando todos los textos del recurso
    (categoría, tema, título, etiquetas…). Y para estudiantes de música,
    el material de teoría/lenguaje musical es común a todos los instrumentos.
  */
  if (hasTermMatch(resourceTerms, studentAreas)) return true;

  return (
    isMusicStudent(studentAreas) &&
    isMusicTheoryResource(resourceTerms) &&
    !targetsAnotherInstrument(resourceTerms, studentAreas)
  );
}

/* =============================================================================
  Overrides de recursos por estudiante (gestionados por admin desde el HUB)
  Se guardan en el documento del estudiante (students/{id}):
    - showAllResources: boolean
    - extraResourceIds: string[]   (ids de la biblioteca asignados a mano)
  Las reglas de Firestore permiten que un admin escriba `students/{id}` y que el
  propio estudiante lea su documento, así que no hace falta tocar otras reglas.
============================================================================= */

function getStudentShowAllResources(student = null) {
  return (
    student?.showAllResources === true ||
    student?.verTodosLosRecursos === true
  );
}

function getStudentExtraResourceIds(student = null) {
  const raw = [
    ...safeArray(student?.extraResourceIds),
    ...safeArray(student?.recursosAsignados),
  ]
    .map((id) => safeText(id))
    .filter(Boolean);

  return new Set(unique(raw));
}

function getStudentExcludedResourceIds(student = null) {
  const raw = [
    ...safeArray(student?.excludedResourceIds),
    ...safeArray(student?.recursosOcultos),
  ]
    .map((id) => safeText(id))
    .filter(Boolean);

  return new Set(unique(raw));
}

/*
  Decisión final de visibilidad de un recurso para un estudiante. Combina el
  "preset" automático (filtro por arte/instrumento) con los ajustes manuales del
  admin. Orden de prioridad:
    1. Oculto manual  -> nunca se ve.
    2. Asignado manual -> siempre se ve.
    3. Resto -> debe estar publicado y (ver-todo o pasar el filtro por proceso).
*/
function isResourceVisibleForStudent(resource, ctx) {
  const id = safeText(resource.id);

  if (ctx.excluded.has(id)) return false;
  if (ctx.assigned.has(id)) return true;

  if (ctx.activeOnly && !isPublishedResource(resource)) return false;
  if (ctx.showAll) return true;

  return resourceMatchesStudent(resource, ctx.student);
}
export async function listResources(options = {}) {
  try {
    const {
      max = LIMITS?.maxResourcesPage || DEFAULT_MAX,
      student = null,
      studentId = null,
      activeOnly = true,
    } = options;

    // La vista por carpetas se arma en el cliente, así que dejamos un techo alto:
    // un estudiante de un instrumento puede ver cientos de recursos (su material +
    // el general de su arte). Con 120 se quedaban fuera muchos (p. ej. las listas
    // de repertorio), aunque el panel admin sí los veía.
    const finalMax = clampLimit(max, DEFAULT_MAX, 1500);

    /*
      Los recursos viven en el proyecto biblioteca-guitarra-fa182,
      colección "recursos". Solo se muestran los publicados, filtrados
      por el área a la que está inscrito el estudiante.
    */
    const resourcesRef = collection(libraryDb, LIBRARY_COLLECTIONS.resources);

    /*
      Se leen TODOS los recursos (la biblioteca tiene ~200) y el filtro de
      "publicado" se hace en cliente, sin where("estado","=="...), porque el
      estado puede venir con mayúsculas o tildes ("Publicado") y un where exacto
      en minúscula los descartaba silenciosamente. El filtro por área/instrumento
      también es en cliente por la misma razón.
    */
    const fetchCap = 1000;

    const primary = query(
      resourcesRef,
      limit(fetchCap)
    );

    const fallback = query(
      resourcesRef,
      limit(fetchCap)
    );

    const snap = await getDocsSafe(primary, fallback, "listResources");

    let studentData = student;

    if (!studentData && studentId) {
      studentData = await getStudent(studentId);
    }

    /*
      Overrides administrados desde el HUB (guardados en el documento del
      estudiante por un admin):
      - showAllResources / verTodosLosRecursos: ve TODA la biblioteca publicada,
        ignorando el filtro automático por arte/instrumento.
      - extraResourceIds / recursosAsignados: recursos forzados a aparecer aunque
        el filtro (o incluso el estado de publicación) los ocultaría.
    */
    const visibilityCtx = {
      student: studentData,
      activeOnly,
      showAll: getStudentShowAllResources(studentData),
      assigned: getStudentExtraResourceIds(studentData),
      excluded: getStudentExcludedResourceIds(studentData),
    };

    let resources = docsToObjects(snap)
      .map((item) => normalizeResource(item))
      .filter(Boolean)
      .filter((resource) => isResourceVisibleForStudent(resource, visibilityCtx));

    resources = sortByText(resources, "title", "asc");

    return resources.slice(0, finalMax);
  } catch (error) {
    throw withContextError(error, "listResources");
  }
}

/*
  Diagnóstico: explica, para un estudiante, qué ve y qué se le oculta de la
  biblioteca y por qué. Útil desde consola para entender un "no me aparece".
  Uso: await api.diagnoseResources({ student }) o { studentId }.
*/
export async function diagnoseResources(options = {}) {
  const { student = null, studentId = null } = options;

  let studentData = student;
  if (!studentData && studentId) {
    studentData = await getStudent(studentId);
  }

  const studentAreas = getStudentAreas(studentData);

  const resourcesRef = collection(libraryDb, LIBRARY_COLLECTIONS.resources);
  const snap = await getDocsSafe(
    query(resourcesRef, limit(1000)),
    query(resourcesRef, limit(1000)),
    "diagnoseResources"
  );

  const all = docsToObjects(snap).map((item) => normalizeResource(item)).filter(Boolean);

  const visibilityCtx = {
    student: studentData,
    activeOnly: true,
    showAll: getStudentShowAllResources(studentData),
    assigned: getStudentExtraResourceIds(studentData),
    excluded: getStudentExcludedResourceIds(studentData),
  };

  const visibles = [];
  const ocultos = [];

  for (const r of all) {
    const id = safeText(r.id);
    const publicado = isPublishedResource(r);
    const matchInstrumento = resourceMentionsStudentInstrument(collectResourceTerms(r), studentAreas);
    const matchEstudiante = resourceMatchesStudent(r, studentData);
    const asignado = visibilityCtx.assigned.has(id);
    const oculto = visibilityCtx.excluded.has(id);

    const visible = isResourceVisibleForStudent(r, visibilityCtx);

    const fila = {
      id,
      titulo: r.title || r.titulo,
      area: r.area || "(sin área)",
      tema: r.tema || "",
      estado: r.estado || "(sin estado)",
      publicado,
      asignado,
      oculto,
      mencionaInstrumento: matchInstrumento,
      pasaFiltroArea: matchEstudiante,
      visible,
    };

    (visible ? visibles : ocultos).push(fila);
  }

  const procesos = (() => {
    try {
      return normalizeStudentProcesses(studentData || {}).map((p) => ({
        arte: p.arte,
        detalle: p.detalle,
        label: p.label,
      }));
    } catch {
      return [];
    }
  })();

  const resumen = {
    estudiante: safeText(
      studentData?.name ||
        studentData?.nombre ||
        studentData?.fullName ||
        studentData?.displayName,
      "(sin estudiante)"
    ),
    areasDetectadas: studentAreas,
    camposEstudiante: {
      area: studentData?.area ?? null,
      instrumento: studentData?.instrumento ?? studentData?.instrument ?? null,
      programa: studentData?.programa ?? studentData?.program ?? null,
      proceso: studentData?.proceso ?? studentData?.process ?? null,
      procesos,
    },
    totalBiblioteca: all.length,
    visibles: visibles.length,
    ocultos: ocultos.length,
    verTodoSinFiltro: visibilityCtx.showAll,
    asignadosManualmente: visibilityCtx.assigned.size,
    ocultosManualmente: visibilityCtx.excluded.size,
  };

  console.log("[DIAG recursos] Resumen:", resumen);
  console.log("[DIAG recursos] Campos del estudiante:", resumen.camposEstudiante);
  console.log("[DIAG recursos] Ocultos (revisa 'publicado' y 'pasaFiltroArea'):");
  console.table(ocultos);

  // Lista completa ordenada por título, para la UI de asignación del admin.
  const todos = [...visibles, ...ocultos].sort((a, b) =>
    safeText(a.titulo).localeCompare(safeText(b.titulo), "es")
  );

  return { resumen, visibles, ocultos, todos };
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
      getBestStudentRoute(queryStudentId, { student }).catch(() => null),
      getStudentRoutes(queryStudentId, { student }).catch(() => []),
      getRecentBitacoras(queryStudentId, undefined, { student }).then((items) => {
        if (items.length || !fallbackStudentId || fallbackStudentId === queryStudentId) {
          return items;
        }

        return getRecentBitacoras(fallbackStudentId);
      }).catch((error) => {
        console.warn("[data] getStudentPortalHome: bitácoras no disponibles.", error);
        return [];
      }),
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
      getBestStudentRoute(id, { student }).catch(() => null),
      getStudentRoutes(id, { student }).catch(() => []),
      listBitacorasByStudent(id, {
        max: LIMITS?.maxBitacorasPage || 30,
        student,
      }).catch((error) => {
        console.warn("[data] getFullStudentPortalBundle: bitácoras no disponibles.", error);
        return [];
      }),
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
    senderEmail: safeText(raw.senderEmail || ""),
    teacherEmail: safeText(raw.teacherEmail || ""),
    read:        Boolean(raw.read),
    createdAt:   raw.createdAt || null,
    _createdAt:  toDateMaybe(raw.createdAt),
  };
}

export async function listMessageTeachers() {
  try {
    const snap = await getDocs(query(collection(teachersHubDb, "teacherDirectory"), orderBy("name", "asc")));
    const rows = docsToObjects(snap)
      .filter((item) => item.enabled !== false && safeText(item.email))
      .map((item) => ({ email: safeText(item.email).toLowerCase(), name: safeText(item.name || item.label || item.email) }));
    return rows;
  } catch (error) {
    console.warn("[data] No se pudo consultar el directorio docente.", error);
    return [];
  }
}

export async function getMessageConversation(studentId) {
  const snap = await getDoc(doc(db, COLLECTIONS.studentMessages, safeText(studentId)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function assignMessageTeacher(studentId, teacher = {}, student = {}) {
  const id = safeText(studentId);
  const teacherEmail = safeText(teacher.email).toLowerCase();
  assertNonEmptyString(id, "studentId");
  assertNonEmptyString(teacherEmail, "teacherEmail");
  await setDoc(doc(db, COLLECTIONS.studentMessages, id), removeUndefinedFields({
    studentId: id,
    studentName: safeText(student.name || student.nombre || "Estudiante"),
    teacherEmail,
    teacherName: safeText(teacher.name || teacher.label || teacherEmail),
    updatedAt: serverTimestamp(),
  }), { merge: true });
  return getMessageConversation(id);
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
    const conversation = await getMessageConversation(id);
    const teacherEmail = safeText(payload.teacherEmail || conversation?.teacherEmail).toLowerCase();
    if (!teacherEmail) throw new Error("Primero elige el docente que recibirá el mensaje.");

    const msgData = removeUndefinedFields({
      studentId: id,
      text,
      senderRole:  safeText(payload.senderRole || "student"),
      senderName:  safeText(payload.senderName || ""),
      senderEmail: safeText(payload.senderEmail || "").toLowerCase(),
      teacherEmail,
      read:        false,
      createdAt:   serverTimestamp(),
    });

    const docRef = await addDoc(messagesRef, msgData);
    await setDoc(doc(db, COLLECTIONS.studentMessages, id), {
      studentId: id,
      teacherEmail,
      lastMessage: text.slice(0, 160),
      lastSenderRole: "student",
      teacherUnread: true,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return normalizeMessage({ id: docRef.id, ...msgData });
  } catch (error) {
    throw withContextError(error, "sendStudentMessage");
  }
}

export async function markTeacherMessagesRead(studentId) {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.studentMessages, safeText(studentId), "messages"),
    where("senderRole", "==", "teacher"),
    where("read", "==", false)
  ));
  await Promise.all(snap.docs.map((item) => updateDoc(item.ref, { read: true })));
  await setDoc(doc(db, COLLECTIONS.studentMessages, safeText(studentId)), { studentUnread: false }, { merge: true });
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
