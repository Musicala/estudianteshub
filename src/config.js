"use strict";

/* =============================================================================
  src/config.js — Estudiantes HUB · Musicala
  Configuración central del portal estudiantil

  Este archivo NO inicializa Firebase.
  Solo exporta configuración, nombres de colecciones, rutas, textos y helpers.

  Firebase real:
  - Usa el proyecto de Bitácoras de Clase.
  - Estudiantes HUB consume los datos guardados allí.
============================================================================= */

/* =============================================================================
  Entorno
============================================================================= */

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

function detectEnvironment() {
  const hostname = window.location.hostname || "";
  return LOCAL_HOSTNAMES.has(hostname) ? "development" : "production";
}

export const ENV = detectEnvironment();

export const IS_DEV = ENV === "development";

export const DEBUG =
  IS_DEV ||
  Boolean(window?.__MUSICALA_DEBUG__);

/* =============================================================================
  App
============================================================================= */

export const APP_META = Object.freeze({
  name: "Estudiantes HUB · Musicala",
  shortName: "Estudiantes HUB",
  institution: "Musicala",
  version: "1.0.1",
  build: "2026-07-13.3-correccion-correos-vinculados",
  lang: "es-CO",
  defaultRoute: "home",
});

/* =============================================================================
  Firebase
  Proyecto: bitacoras-de-clase
============================================================================= */

export const FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyDQcHQEzGE1DDpD1b_foUTmVo3D9LK_0N0",
  /*
    Login del MISMO dominio que la app (Firebase Hosting: musicala-estudianteshub).
    Esto es lo que arregla de raíz el bucle de login en iPhone: el handler de
    autenticación se sirve en el mismo origen que el portal, así Safari no bloquea
    el almacenamiento entre dominios. Si algún día cambia el sitio de Hosting,
    actualiza también esta línea.
  */
  authDomain: "musicala-estudianteshub.web.app",
  projectId: "bitacoras-de-clase",
  storageBucket: "bitacoras-de-clase.firebasestorage.app",
  messagingSenderId: "1047385643159",
  appId: "1:1047385643159:web:074d75890a648f6ac5f1d2",
});

/*
  Compatibilidad con firebase.js anteriores que importen firebaseConfig.
*/
export const firebaseConfig = FIREBASE_CONFIG;

/* =============================================================================
  Firebase secundario — Biblioteca de recursos
  Proyecto: biblioteca-guitarra-fa182
  La sección "Recursos" se carga desde este proyecto, filtrada por el área
  a la que está inscrito el estudiante.
============================================================================= */

export const LIBRARY_FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyD8p1Ges94PMBPE-wuFVjeE5uGzeUQYBS0",
  authDomain: "biblioteca-guitarra-fa182.firebaseapp.com",
  projectId: "biblioteca-guitarra-fa182",
  storageBucket: "biblioteca-guitarra-fa182.firebasestorage.app",
  messagingSenderId: "803045423554",
  appId: "1:803045423554:web:9bd5bda0d45f9e33f07e5b",
});

export const LIBRARY_COLLECTIONS = Object.freeze({
  resources: "recursos",
});

export const FIREBASE_OPTIONS = Object.freeze({
  sdkVersion: "10.12.5",
  useEmulators: false,
});

/* =============================================================================
  Colecciones Firestore
============================================================================= */

export const COLLECTIONS = Object.freeze({
  users: "users",

  students: "students",
  bitacoras: "bitacoras",
  studentRoutes: "student_routes",

  // Rutas de aprendizaje (fuente: editor de Bitácoras de Clase).
  // route_templates: estructura compartida por área/instrumento (artKey).
  // student_route_progress: avance por estudiante ({studentId}__{artKey}).
  routeTemplates: "route_templates",
  studentRouteProgress: "student_route_progress",

  appConfig: "app_config",
  resources: "resources",
  events: "events",

  practiceLogs: "practice_logs",
  studentMessages: "student_messages",
  studentComments: "student_comments",
  studentEvidence: "student_evidence",
});

export const DOCS = Object.freeze({
  catalogs: "catalogos",
  portalSettings: "student_portal",
});

/*
  Compatibilidad con nombres tipo Bitácoras.
*/
export const FIRESTORE_CONFIG = Object.freeze({
  usersCollection: COLLECTIONS.users,
  studentsCollection: COLLECTIONS.students,
  bitacorasCollection: COLLECTIONS.bitacoras,
  studentRoutesCollection: COLLECTIONS.studentRoutes,
  appConfigCollection: COLLECTIONS.appConfig,
  resourcesCollection: COLLECTIONS.resources,
  eventsCollection: COLLECTIONS.events,
  catalogsDocumentId: DOCS.catalogs,
});

/* =============================================================================
  Storage
============================================================================= */

export const STORAGE_CONFIG = Object.freeze({
  baseFolders: Object.freeze({
    bitacoras: "bitacoras",
    studentEvidence: "student-evidence",
    resources: "resources",
    profile: "profiles",
  }),

  allowedTypes: Object.freeze([
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/mpeg",
    "audio/mp3",
    "audio/webm",
    "audio/wav",
    "video/mp4",
    "video/webm",
    "application/pdf",
  ]),

  maxFiles: 5,
  maxSizeMb: 15,
  maxSizeBytes: 15 * 1024 * 1024,
});

/* =============================================================================
  Rutas del portal
============================================================================= */

export const ROUTES = Object.freeze({
  home: "home",
  route: "route",
  journal: "journal",
  resources: "resources",
  events: "events",
  profile: "profile",
  musiprofe: "musiprofe",
  routine: "routine",
  practice: "practice",
  messages: "messages",
  timeline: "timeline",
  report: "report",
});

export const ROUTE_LIST = Object.freeze([
  ROUTES.home,
  ROUTES.route,
  ROUTES.journal,
  ROUTES.resources,
  ROUTES.events,
  ROUTES.profile,
  ROUTES.musiprofe,
  ROUTES.routine,
  ROUTES.practice,
  ROUTES.messages,
  ROUTES.timeline,
  ROUTES.report,
]);

export const ROUTE_ALIASES = Object.freeze({
  inicio: ROUTES.home,

  ruta: ROUTES.route,
  "mi-ruta": ROUTES.route,

  bitacora: ROUTES.journal,
  "bitácora": ROUTES.journal,
  journal: ROUTES.journal,

  recursos: ROUTES.resources,
  biblioteca: ROUTES.resources,
  library: ROUTES.resources,

  eventos: ROUTES.events,
  calendario: ROUTES.events,
  calendar: ROUTES.events,
  muestras: ROUTES.events,
  showcases: ROUTES.events,

  perfil: ROUTES.profile,
  info: ROUTES.profile,

  profe: ROUTES.musiprofe,
  "musi-profe": ROUTES.musiprofe,
  coach: ROUTES.musiprofe,

  rutina: ROUTES.routine,
  "mi-rutina": ROUTES.routine,
  semana: ROUTES.routine,

  diario: ROUTES.practice,
  practica: ROUTES.practice,
  "practice-log": ROUTES.practice,

  mensajes: ROUTES.messages,
  chat: ROUTES.messages,

  "linea-del-tiempo": ROUTES.timeline,
  historial: ROUTES.timeline,

  reporte: ROUTES.report,
  informe: ROUTES.report,

  // Compatibilidad con Estudiantes HUB anterior
  classes: ROUTES.journal,
});

export const ROUTE_LABELS = Object.freeze({
  [ROUTES.home]: "Inicio",
  [ROUTES.route]: "Mi ruta",
  [ROUTES.journal]: "Bitácora",
  [ROUTES.resources]: "Recursos",
  [ROUTES.events]: "Eventos",
  [ROUTES.profile]: "Perfil",
  [ROUTES.musiprofe]: "MusiProfe",
  [ROUTES.routine]: "Mi rutina",
  [ROUTES.practice]: "Diario",
  [ROUTES.messages]: "Mensajes",
  [ROUTES.timeline]: "Línea del tiempo",
  [ROUTES.report]: "Reporte mensual",
});

export const ROUTE_DESCRIPTIONS = Object.freeze({
  [ROUTES.home]: "Resumen de tu proceso artístico en Musicala.",
  [ROUTES.route]: "Objetivos, avances y próximos pasos de tu aprendizaje.",
  [ROUTES.journal]: "Registro de lo trabajado en clase y recomendaciones.",
  [ROUTES.resources]: "Materiales de apoyo para estudiar y practicar.",
  [ROUTES.events]: "Muestras, actividades y eventos importantes.",
  [ROUTES.profile]: "Información general de tu perfil como estudiante.",
  [ROUTES.musiprofe]: "Tu asistente inteligente de práctica musical.",
  [ROUTES.routine]: "Diseña tu semana de estudio según tus objetivos.",
  [ROUTES.practice]: "Registra tu práctica diaria y mide tu constancia.",
  [ROUTES.messages]: "Comunícate con tu docente directamente.",
  [ROUTES.timeline]: "Mira todo tu proceso en orden cronológico.",
  [ROUTES.report]: "Genera un informe de tu progreso mensual.",
});

/* =============================================================================
  Roles y permisos
============================================================================= */

export const ROLES = Object.freeze({
  admin: "admin",
  administrator: "administrator",
  administratorEs: "administrador",
  administratorEsFemale: "administradora",
  administrativeEn: "administrative",
  direction: "direccion",
  directionEn: "direction",
  administrative: "administrativo",
  administrativeEsFemale: "administrativa",
  teacher: "teacher",
  teacherEs: "docente",
  teacherEsAlt: "profesor",
  teacherEsFemale: "profesora",
  student: "student",
  studentEs: "estudiante",
  guardian: "guardian",
  guardianEs: "acudiente",
  parent: "parent",
});

export const ROLE_GROUPS = Object.freeze({
  admins: Object.freeze([
    ROLES.admin,
    ROLES.administrator,
    ROLES.administratorEs,
    ROLES.administratorEsFemale,
    ROLES.administrativeEn,
    ROLES.direction,
    ROLES.directionEn,
    "dirección",
    ROLES.administrative,
    ROLES.administrativeEsFemale,
  ]),

  teachers: Object.freeze([
    ROLES.teacher,
    ROLES.teacherEs,
    ROLES.teacherEsAlt,
    ROLES.teacherEsFemale,
  ]),
  students: Object.freeze([
    ROLES.student,
    ROLES.studentEs,
    ROLES.guardian,
    ROLES.guardianEs,
    ROLES.parent,
  ]),

  portalAllowed: Object.freeze([
    ROLES.admin,
    ROLES.administrator,
    ROLES.administratorEs,
    ROLES.administratorEsFemale,
    ROLES.administrativeEn,
    ROLES.direction,
    ROLES.directionEn,
    "dirección",
    ROLES.administrative,
    ROLES.administrativeEsFemale,
    ROLES.teacher,
    ROLES.teacherEs,
    ROLES.teacherEsAlt,
    ROLES.teacherEsFemale,
    ROLES.student,
    ROLES.studentEs,
    ROLES.guardian,
    ROLES.guardianEs,
    ROLES.parent,
  ]),
});

export const ACCESS_CONFIG = Object.freeze({
  requireActiveUser: true,
  requireLinkedStudent: true,
});

/* =============================================================================
  Campos conocidos
============================================================================= */

export const USER_FIELDS = Object.freeze({
  email: "email",
  role: "role",
  active: "active",
  studentId: "studentId",
  studentIds: "studentIds",
  displayName: "displayName",
});

export const STUDENT_FIELDS = Object.freeze({
  id: "id",
  name: "displayName",
  altName: "nombre",
  email: "email",
  program: "program",
  altProgram: "programa",
  instrument: "instrument",
  altInstrument: "instrumento",
  level: "level",
  altLevel: "nivel",
  modality: "modality",
  altModality: "modalidad",
  teacher: "teacher",
  altTeacher: "docente",
  status: "status",
  altStatus: "estado",
});

export const BITACORA_FIELDS = Object.freeze({
  studentIds: "studentIds",
  studentRefs: "studentRefs",
  title: "title",
  content: "content",
  process: "process",
  tags: "tags",
  attachments: "attachments",
  author: "author",
  fechaClase: "fechaClase",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
});

export const ROUTE_FIELDS = Object.freeze({
  studentId: "studentId",
  processKey: "processKey",
  goals: "goals",
  progress: "progress",
  milestones: "milestones",
  updatedAt: "updatedAt",
});

/* =============================================================================
  Límites de consulta y UI
============================================================================= */

export const LIMITS = Object.freeze({
  maxStudentsPicker: 20,

  maxRecentBitacorasHome: 3,
  maxBitacorasPage: 30,
  maxBitacorasQuery: 80,

  maxResourcesHome: 4,
  maxResourcesPage: 60,

  maxEventsHome: 4,
  maxEventsPage: 60,

  maxJournalPreviewLength: 260,
  maxCardTextLength: 180,
  maxTitleLength: 140,

  firestoreInQueryLimit: 10,
});

/* =============================================================================
  Ordenamientos por defecto
============================================================================= */

export const SORTING = Object.freeze({
  bitacoras: Object.freeze({
    primaryField: "fechaClase",
    fallbackField: "createdAt",
    direction: "desc",
  }),

  resources: Object.freeze({
    primaryField: "createdAt",
    direction: "desc",
  }),

  events: Object.freeze({
    primaryField: "dateStart",
    fallbackField: "createdAt",
    direction: "asc",
  }),
});

/* =============================================================================
  LocalStorage
============================================================================= */

export const STORAGE_KEYS = Object.freeze({
  activeStudentId: "musicala.estudiantesHub.activeStudentId",
  lastRoute: "musicala.estudiantesHub.lastRoute",
  lastVersion: "musicala.estudiantesHub.lastVersion",
  dismissedBanners: "musicala.estudiantesHub.dismissedBanners",
});

/* =============================================================================
  Textos de UI
============================================================================= */

export const UI_TEXT = Object.freeze({
  appName: APP_META.name,

  loadingTitle: "Cargando Estudiantes HUB…",
  loadingText: "Estamos preparando tu portal.",

  loginTitle: "Bienvenido a Estudiantes HUB",
  loginText:
    "Consulta tu ruta de aprendizaje, bitácoras de clase, recursos recomendados y eventos de Musicala en un solo lugar.",

  noAccessTitle: "No encontramos información vinculada",
  noAccessText:
    "Tu correo todavía no tiene un estudiante vinculado en Musicala.",

  emptyBitacoras:
    "Todavía no tienes bitácoras registradas. Cuando tus docentes guarden seguimientos, aparecerán aquí.",
  emptyRoute:
    "Todavía no hay una ruta de aprendizaje configurada para este proceso.",
  emptyResources:
    "Todavía no hay recursos recomendados para mostrar.",
  emptyEvents:
    "No hay eventos próximos registrados por ahora.",

  genericError:
    "Ocurrió un error inesperado. Revisa la consola o intenta recargar.",
  permissionError:
    "No tienes permisos para ver estos datos. Revisa que tu correo esté registrado en Musicala.",
  networkError:
    "Hay un problema de conexión. Revisa internet e intenta nuevamente.",
});

/* =============================================================================
  Estados visuales
============================================================================= */

export const STATUS = Object.freeze({
  active: "active",
  inactive: "inactive",
  pending: "pending",
  completed: "completed",
  archived: "archived",
});

export const STATUS_LABELS = Object.freeze({
  active: "Activo",
  inactive: "Inactivo",
  pending: "Pendiente",
  completed: "Completado",
  archived: "Archivado",

  activo: "Activo",
  inactivo: "Inactivo",
  pendiente: "Pendiente",
  completado: "Completado",
  archivado: "Archivado",
});

export const STATUS_CLASSES = Object.freeze({
  active: "chip--success",
  activo: "chip--success",

  pending: "chip--warning",
  pendiente: "chip--warning",

  inactive: "chip--danger",
  inactivo: "chip--danger",

  completed: "chip--success",
  completado: "chip--success",

  archived: "chip--ghost",
  archivado: "chip--ghost",
});

/* =============================================================================
  Recursos y eventos
============================================================================= */

export const RESOURCE_TYPES = Object.freeze({
  link: "link",
  video: "video",
  audio: "audio",
  pdf: "pdf",
  image: "image",
  file: "file",
  exercise: "exercise",
  playlist: "playlist",
});

export const RESOURCE_TYPE_LABELS = Object.freeze({
  link: "Enlace",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  image: "Imagen",
  file: "Archivo",
  exercise: "Ejercicio",
  playlist: "Playlist",
});

export const EVENT_TYPES = Object.freeze({
  showcase: "showcase",
  class: "class",
  workshop: "workshop",
  reminder: "reminder",
  concert: "concert",
  meeting: "meeting",
});

export const EVENT_TYPE_LABELS = Object.freeze({
  showcase: "Muestra",
  class: "Clase",
  workshop: "Taller",
  reminder: "Recordatorio",
  concert: "Concierto",
  meeting: "Reunión",
});

/* =============================================================================
  Feature flags
============================================================================= */

export const FEATURE_FLAGS = Object.freeze({
  enableStudentPicker: true,
  enableRouteView: true,
  enableJournalView: true,
  enableResourcesView: true,
  enableEventsView: true,
  enableProfileView: true,
  enableMusiProfe: true,
  enableRoutine: true,
  enablePracticeLogs: true,
  enableMessages: true,
  enableTimeline: true,
  enableReport: true,
  enableBadges: true,
  enableAutoEval: true,

  enableStudentComments: false,
  enableEvidenceUploads: false,
});

/* =============================================================================
  Config agrupada
============================================================================= */

export const CONFIG = Object.freeze({
  env: ENV,
  debug: DEBUG,

  app: APP_META,

  firebase: FIREBASE_CONFIG,
  firebaseOptions: FIREBASE_OPTIONS,

  collections: COLLECTIONS,
  docs: DOCS,
  firestore: FIRESTORE_CONFIG,
  storage: STORAGE_CONFIG,

  routes: ROUTES,
  routeList: ROUTE_LIST,
  routeAliases: ROUTE_ALIASES,
  routeLabels: ROUTE_LABELS,
  routeDescriptions: ROUTE_DESCRIPTIONS,

  roles: ROLES,
  roleGroups: ROLE_GROUPS,
  access: ACCESS_CONFIG,

  fields: Object.freeze({
    user: USER_FIELDS,
    student: STUDENT_FIELDS,
    bitacora: BITACORA_FIELDS,
    route: ROUTE_FIELDS,
  }),

  limits: LIMITS,
  sorting: SORTING,
  localStorage: STORAGE_KEYS,
  text: UI_TEXT,

  status: STATUS,
  statusLabels: STATUS_LABELS,
  statusClasses: STATUS_CLASSES,

  resourceTypes: RESOURCE_TYPES,
  resourceTypeLabels: RESOURCE_TYPE_LABELS,

  eventTypes: EVENT_TYPES,
  eventTypeLabels: EVENT_TYPE_LABELS,

  features: FEATURE_FLAGS,
});

/* =============================================================================
  Helpers
============================================================================= */

export function getCollectionName(key) {
  const name = COLLECTIONS[key];

  if (!name) {
    throw new Error(`[config] Colección no configurada: ${key}`);
  }

  return name;
}

export function getRouteLabel(route) {
  return ROUTE_LABELS[route] || "Sección";
}

export function getRouteDescription(route) {
  return ROUTE_DESCRIPTIONS[route] || "";
}

export function normalizeRoute(route) {
  const raw = String(route || APP_META.defaultRoute)
    .replace(/^#\/?/, "")
    .trim();

  const aliased = ROUTE_ALIASES[raw] || raw;

  return ROUTE_LIST.includes(aliased)
    ? aliased
    : APP_META.defaultRoute;
}

export function isKnownRoute(route) {
  return ROUTE_LIST.includes(route);
}

export function isAdminRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ROLE_GROUPS.admins.includes(normalized);
}

export function isTeacherRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ROLE_GROUPS.teachers.includes(normalized);
}

export function isStudentRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ROLE_GROUPS.students.includes(normalized);
}

export function isPortalAllowedRole(role) {
  const normalized = String(role || "").trim().toLowerCase();

  if (!normalized) return true;

  return ROLE_GROUPS.portalAllowed.includes(normalized);
}

export function getStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return STATUS_LABELS[normalized] || status || "Sin estado";
}

export function getStatusClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return STATUS_CLASSES[normalized] || "chip--ghost";
}

export function getResourceTypeLabel(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return RESOURCE_TYPE_LABELS[normalized] || "Recurso";
}

export function getEventTypeLabel(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return EVENT_TYPE_LABELS[normalized] || "Evento";
}

export function assertFirebaseConfig(config = FIREBASE_CONFIG) {
  const required = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "appId",
  ];

  const missing = required.filter((key) => !config?.[key]);

  if (missing.length) {
    throw new Error(
      `[config] Firebase config incompleta. Faltan: ${missing.join(", ")}`
    );
  }

  return true;
}

export function logConfigSummary() {
  if (!DEBUG) return;

  console.info("[config] Estudiantes HUB", {
    env: ENV,
    app: APP_META.name,
    version: APP_META.version,
    projectId: FIREBASE_CONFIG.projectId,
    routes: ROUTE_LIST,
    collections: COLLECTIONS,
  });
}

assertFirebaseConfig();

logConfigSummary();
