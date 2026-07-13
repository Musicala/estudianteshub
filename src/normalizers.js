"use strict";

/* =============================================================================
  src/normalizers.js - Estudiantes HUB · Musicala

  Helpers puros para normalizar datos que vienen desde Firestore.

  Este archivo:
  - NO importa Firebase
  - NO consulta Firestore
  - NO toca el DOM
  - NO renderiza HTML

  Su trabajo es convertir datos medio inconsistentes en objetos más estables
  para que views.js no tenga que adivinar si algo se llama nombre, name,
  displayName, titulo, title, fechaClase o "lo que se le ocurrió al humano".
============================================================================= */

/* =============================================================================
  Helpers base
============================================================================= */

export function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
  );
}

export function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;

  const text = String(value).trim();

  return text || fallback;
}

export function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

export function safeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const text = value.trim().toLowerCase();

    if (["true", "sí", "si", "yes", "1", "activo", "active"].includes(text)) {
      return true;
    }

    if (["false", "no", "0", "inactivo", "inactive"].includes(text)) {
      return false;
    }
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return fallback;
}

export function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

export function uniqueArray(values = []) {
  return [...new Set(safeArray(values).filter(Boolean))];
}

export function normalizeEmail(email = "") {
  return safeText(email).replace(/\s+/g, "").toLowerCase();
}

export function normalizeKey(value = "") {
  return safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeText(value = "") {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStudentKeyText(value = "") {
  return normalizeText(value)
    .replace(/[^a-z0-9@._+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && safeText(value)) {
      return value;
    }
  }

  return "";
}

export function clamp(value, min = 0, max = 100) {
  const number = safeNumber(value, min);

  return Math.max(min, Math.min(max, number));
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
    isPlainObject(value) &&
    typeof value.seconds === "number" &&
    typeof value.nanoseconds === "number"
  ) {
    const date = new Date(value.seconds * 1000 + Math.round(value.nanoseconds / 1e6));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    // Fecha sin hora (YYYY-MM-DD): parsear como fecha LOCAL para no perder un día
    // por la zona horaria.
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

  return null;
}

export function dateToTime(value) {
  const date = toDateMaybe(value);
  return date ? date.getTime() : 0;
}

export function normalizeDateFields(object = {}, fields = []) {
  const normalized = { ...object };

  const defaultFields = [
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

  for (const field of uniqueArray([...defaultFields, ...fields])) {
    if (field in normalized) {
      normalized[`_${field}`] = toDateMaybe(normalized[field]);
    }
  }

  return normalized;
}

export function formatDate(value, options = {}) {
  const date = toDateMaybe(value);

  if (!date) return options.fallback || "Sin fecha";

  const locale = options.locale || "es-CO";

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatDateTime(value, options = {}) {
  const date = toDateMaybe(value);

  if (!date) return options.fallback || "Sin fecha";

  const locale = options.locale || "es-CO";

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(date);
}

export function sortByDate(items = [], fields = [], direction = "desc") {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...safeArray(items)].sort((a, b) => {
    const aTime = getBestDateTime(a, fields);
    const bTime = getBestDateTime(b, fields);

    if (aTime === bTime) {
      return safeText(a?.title || a?.titulo || a?.name || a?.nombre || a?.id)
        .localeCompare(
          safeText(b?.title || b?.titulo || b?.name || b?.nombre || b?.id),
          "es"
        );
    }

    return (aTime - bTime) * multiplier;
  });
}

export function getBestDateTime(item = {}, fields = []) {
  const possibleFields = fields.length
    ? fields
    : ["fechaClase", "dateStart", "date", "fecha", "createdAt", "updatedAt"];

  for (const field of possibleFields) {
    const value = item?.[field] || item?.[`_${field}`];
    const time = dateToTime(value);

    if (time) return time;
  }

  return 0;
}

export function sortByText(items = [], field = "title", direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1;

  return [...safeArray(items)].sort((a, b) => {
    const av = safeText(a?.[field]);
    const bv = safeText(b?.[field]);

    return av.localeCompare(bv, "es") * multiplier;
  });
}

/* =============================================================================
  Texto y previews
============================================================================= */

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
  Documentos Firestore
============================================================================= */

export function normalizeDoc(id, data = {}) {
  return normalizeDateFields({
    id,
    ...data,
  });
}

export function normalizeFirestoreSnap(snap) {
  if (!snap?.exists?.()) return null;

  return normalizeDoc(snap.id, snap.data() || {});
}

export function normalizeFirestoreDocs(snapshot) {
  return safeArray(snapshot?.docs).map((docSnap) =>
    normalizeDoc(docSnap.id, docSnap.data() || {})
  );
}

/* =============================================================================
  Usuarios / acceso
============================================================================= */

export function normalizeAccessProfile(raw = null) {
  if (!raw) return null;

  const email = normalizeEmail(
    firstValue(raw.email, raw.correo, raw.userEmail, raw.id)
  );

  const role = safeText(
    firstValue(raw.role, raw.rol, raw.type, raw.tipo, "")
  ).toLowerCase();
  const canonicalStudentId = safeText(raw.studentId);

  const studentIds = uniqueArray([
    ...safeArray(raw.studentIds),
    canonicalStudentId,
  ].map((item) => safeText(item)));

  const active =
    raw.active !== false &&
    raw.estado !== "inactivo" &&
    raw.status !== "inactive";

  return normalizeDateFields({
    ...raw,

    id: raw.id || email,
    email,
    correo: raw.correo || email,

    role,
    rol: raw.rol || role,

    active,
    studentIds,
    studentId: canonicalStudentId || studentIds[0] || null,

    displayName: firstValue(
      raw.displayName,
      raw.nombre,
      raw.name,
      raw.fullName,
      raw.email,
      "Usuario"
    ),
  });
}

export function isActiveAccessProfile(profile = null) {
  if (!profile) return false;

  return profile.active !== false &&
    profile.estado !== "inactivo" &&
    profile.status !== "inactive";
}

/* =============================================================================
  Estudiantes
============================================================================= */

export function normalizeStudent(raw = null) {
  if (!raw) return null;

  const id = safeText(
    firstValue(raw.id, raw.studentId, raw.key, raw.uid)
  );

  const displayName = safeText(
    firstValue(
      raw.displayName,
      raw.nombre,
      raw.name,
      raw.fullName,
      raw.studentName,
      "Estudiante"
    ),
    "Estudiante"
  );

  const email = normalizeEmail(
    firstValue(raw.email, raw.correo, raw.studentEmail)
  );

  const program = safeText(
    firstValue(raw.program, raw.programa, raw.process, raw.proceso)
  );

  const instrument = safeText(
    firstValue(raw.instrument, raw.instrumento, raw.area, raw.discipline, raw.disciplina)
  );

  const level = safeText(
    firstValue(raw.level, raw.nivel, raw.stage, raw.etapa)
  );

  const modality = safeText(
    firstValue(raw.modality, raw.modalidad, raw.mode)
  );

  const teacher = safeText(
    firstValue(raw.teacher, raw.docente, raw.teacherName, raw.mainTeacher)
  );

  /*
    Estado publicado por RIP (students/{id}.rip): es la fuente de verdad del
    estado operativo. El HUB nunca lo calcula; solo lo muestra. Los campos
    planos (status/estado) quedan como compatibilidad para docs sin sync.
  */
  const rip = raw.rip && typeof raw.rip === "object" ? raw.rip : null;
  const status = safeText(
    firstValue(rip?.statusLabel, raw.status, raw.estado, raw.state)
  );

  return normalizeDateFields({
    ...raw,

    rip: rip || undefined,
    canAccessHub: rip && typeof rip.canAccessHub === "boolean" ? rip.canAccessHub : undefined,
    remainingClasses: rip && Number.isFinite(Number(rip.remainingClasses))
      ? Number(rip.remainingClasses)
      : raw.remainingClasses,
    nextClassDate: safeText(firstValue(rip?.nextClassDate, raw.nextClassDate)),
    lastClassDate: safeText(firstValue(rip?.lastClassDate, raw.lastClassDate)),

    id,

    displayName,
    name: raw.name || displayName,
    nombre: raw.nombre || displayName,

    email,
    correo: raw.correo || email,

    program,
    programa: raw.programa || program,

    instrument,
    instrumento: raw.instrumento || instrument,

    level,
    nivel: raw.nivel || level,

    modality,
    modalidad: raw.modalidad || modality,

    teacher,
    docente: raw.docente || teacher,

    status,
    estado: raw.estado || status,

    initials: getInitials(displayName),
  });
}

export function normalizeStudentKey(student = null) {
  if (!student) return "";

  return (
    safeText(student.studentId) ||
    safeText(student.studentKey) ||
    safeText(student.estudianteId) ||
    ""
  );
}

export function getCanonicalStudentKey(student = null) {
  const directKey = normalizeStudentKey(student);
  if (directKey) return directKey;

  const name = normalizeStudentKeyText(
    firstValue(
      student?.displayName,
      student?.nombre,
      student?.name,
      student?.fullName,
      student?.studentName
    )
  );
  const email = normalizeEmail(
    firstValue(student?.email, student?.correo, student?.studentEmail)
  );
  const fallbackId = safeText(firstValue(student?.id, student?.key, student?.uid));

  if (name || email) {
    return `student:${name || "sin-nombre"}:${email || "sin-correo"}`;
  }

  return fallbackId ? `student:id:${fallbackId}` : "";
}

export function getStudentRecordTime(student = null) {
  return getBestDateTime(student || {}, [
    "updatedAt",
    "approvedAt",
    "createdAt",
    "importedAt",
    "timestamp",
  ]);
}

export function pickLatestStudentRecord(records = []) {
  const items = safeArray(records).filter(Boolean);
  if (!items.length) return null;

  return items.reduce((latest, item) => {
    if (!latest) return item;

    const itemTime = getStudentRecordTime(item);
    const latestTime = getStudentRecordTime(latest);

    if (itemTime || latestTime) {
      return itemTime >= latestTime ? item : latest;
    }

    return item;
  }, null);
}

function collectStudentEmails(records = []) {
  return uniqueArray(
    safeArray(records)
      .flatMap((record) => [
        record?.email,
        record?.correo,
        record?.studentEmail,
        ...(Array.isArray(record?.linkedEmails) ? record.linkedEmails : []),
        ...(Array.isArray(record?.allEmails) ? record.allEmails : []),
      ])
      .map((email) => normalizeEmail(email))
      .filter(Boolean)
  );
}

export function dedupeStudents(records = [], options = {}) {
  const normalizedRecords = safeArray(records)
    .map((record) => normalizeStudent(record))
    .filter(Boolean);
  const groups = new Map();

  normalizedRecords.forEach((record, index) => {
    const canonicalKey = getCanonicalStudentKey(record) || `student:index:${index}`;
    const group = groups.get(canonicalKey) || [];
    group.push({
      ...record,
      _dedupeIndex: index,
      canonicalStudentKey: canonicalKey,
    });
    groups.set(canonicalKey, group);
  });

  const students = [];
  let duplicateCount = 0;

  for (const [canonicalKey, group] of groups.entries()) {
    const principal = pickLatestStudentRecord(group);
    const duplicateRecords = group.filter((record) => record !== principal);
    const allEmails = collectStudentEmails(group);
    const linkedEmails = allEmails.filter((email) => email !== principal.email);

    duplicateCount += duplicateRecords.length;

    students.push({
      ...principal,
      canonicalStudentKey: canonicalKey,
      linkedEmails,
      allEmails,
      duplicateRecords,
      duplicateCount: duplicateRecords.length,
    });
  }

  if (options.debug) {
    console.info("[Students] Deduplicacion", {
      originalCount: normalizedRecords.length,
      uniqueCount: students.length,
      duplicateCount,
      canonicalKeys: students.map((student) => student.canonicalStudentKey),
    });
  }

  return students;
}

export function getStudentIdentity(student = null) {
  if (!student) return "";

  return (
    safeText(student.studentKey) ||
    safeText(student.id) ||
    safeText(student.studentId) ||
    safeText(student.documento)
  );
}

export function getStudentFallbackId(student = null) {
  if (!student) return "";

  return (
    safeText(student.id) ||
    safeText(student.studentId) ||
    safeText(student.documento)
  );
}

export function slugifyProcessKey(value = "") {
  const normalized = normalizeText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "general";
}

export function normalizeStudentProcesses(student = {}) {
  const rawProcesses = Array.isArray(student?.processes) ? student.processes : [];

  if (!rawProcesses.length) {
    const fallbackArte = safeText(firstValue(student?.area));
    const fallbackDetalle = safeText(firstValue(student?.instrumento, student?.instrument, student?.programa, student?.program));
    const fallbackLabel = safeText(
      firstValue(
        student?.programa,
        student?.program,
        student?.instrumento,
        student?.instrument,
        student?.area,
        "Proceso general"
      )
    );

    return [
      {
        processKey: `fallback_${slugifyProcessKey(fallbackLabel)}`,
        arte: fallbackArte,
        detalle: fallbackDetalle,
        label: fallbackLabel,
      },
    ];
  }

  return rawProcesses
    .map((process, index) => {
      if (!isPlainObject(process)) return null;

      const arte = safeText(firstValue(process.arte, process.area));
      const detalle = safeText(firstValue(process.detalle, process.instrumento, process.instrument));
      const label =
        safeText(process.label) ||
        [arte, detalle].filter(Boolean).join(" - ") ||
        `Proceso ${index + 1}`;

      return {
        ...process,
        processKey:
          safeText(process.processKey) ||
          `${slugifyProcessKey(arte || label)}_${slugifyProcessKey(detalle || label)}_${index + 1}`,
        arte,
        detalle,
        label,
      };
    })
    .filter(Boolean);
}

export function resolveStudentProcess(student = {}, processRef = "") {
  const processes = normalizeStudentProcesses(student);
  const safeRef = safeText(processRef);

  if (!safeRef) return processes[0] || null;

  return (
    processes.find((process) => safeText(process.processKey) === safeRef) ||
    processes.find((process) => normalizeText(process.label) === normalizeText(safeRef)) ||
    processes[0] ||
    null
  );
}

export function buildDefaultStudentRoute(student = null, baseRoute = {}, options = {}) {
  if (!student) return null;

  const activeProcess = resolveStudentProcess(student, options.processKey || baseRoute?.processKey);
  const processKey = safeText(options.processKey || activeProcess?.processKey || baseRoute?.processKey || "general");
  const processLabel = safeText(
    firstValue(
      activeProcess?.label,
      activeProcess?.detalle,
      activeProcess?.arte,
      baseRoute?.processLabel,
      "Proceso general"
    )
  );

  const completedGoalIds = uniqueArray(baseRoute?.completedGoalIds);
  const baseGoals = safeArray(baseRoute?.goals || baseRoute?.objetivos);
  const goals = baseGoals.length
    ? baseGoals.map((goal, index) => normalizeGoal(goal, index)).filter(Boolean)
    : [
        {
          id: `${processKey}-tecnico-1`,
          title: `Tecnica base - ${processLabel}`,
          component: "tecnico",
          description: "Siguiente foco tecnico del proceso.",
        },
        {
          id: `${processKey}-teorico-1`,
          title: `Teoria aplicada - ${processLabel}`,
          component: "teorico",
          description: "Siguiente foco teorico del proceso.",
        },
        {
          id: `${processKey}-repertorio-1`,
          title: `Repertorio - ${processLabel}`,
          component: "repertorio",
          description: "Siguiente foco musical del proceso.",
        },
      ];

  const normalizedGoals = goals.map((goal) => ({
    ...goal,
    status: completedGoalIds.includes(goal.id)
      ? "completado"
      : goal.status || goal.estado || "activo",
    progress: completedGoalIds.includes(goal.id)
      ? 100
      : Number.isFinite(Number(goal.progress ?? goal.progreso))
        ? Number(goal.progress ?? goal.progreso)
        : 0,
  }));

  const completedGoals = normalizedGoals.filter((goal) =>
    ["done", "completed", "completado", "finalizado"].includes(
      safeText(goal.status || goal.estado).toLowerCase()
    )
  ).length;

  const progress = normalizedGoals.length
    ? Math.round((completedGoals / normalizedGoals.length) * 100)
    : 0;

  return normalizeStudentRoute({
    ...baseRoute,
    id: baseRoute?.id || `${getStudentIdentity(student)}__${processKey}`,
    studentId: getStudentIdentity(student),
    studentKey: student.studentKey || getStudentIdentity(student),
    title: baseRoute?.title || baseRoute?.routeName || "Ruta base Musicala",
    routeName: baseRoute?.routeName || baseRoute?.title || "Ruta base Musicala",
    description: baseRoute?.description || `Ruta de aprendizaje para ${processLabel}.`,
    processKey,
    processLabel,
    focusArea: baseRoute?.focusArea || processLabel,
    goals: normalizedGoals,
    objetivos: normalizedGoals,
    progress,
    progreso: progress,
    status: baseRoute?.status || "active",
  });
}

export function getStudentDisplayName(student = null, fallback = "Estudiante") {
  return safeText(
    firstValue(
      student?.displayName,
      student?.nombre,
      student?.name,
      student?.fullName,
      student?.studentName
    ),
    fallback
  );
}

export function getStudentSubtitle(student = null) {
  const processSummary = normalizeStudentProcesses(student || {})
    .map((process) => process.label)
    .filter(Boolean)
    .join(" · ");

  return joinClean([
    processSummary,
    student?.instrument,
    student?.instrumento,
    student?.program,
    student?.programa,
    student?.level,
    student?.nivel,
  ]);
}

export function getStudentProfileRows(student = null) {
  if (!student) return [];

  const normalized = normalizeStudent(student);
  const allEmails = collectStudentEmails([student]);
  const linkedEmails = allEmails.length > 1 ? allEmails.join(", ") : "";

  return [
    ["Nombre", normalized.displayName],
    ["Correo", normalized.email],
    ["Correos vinculados", linkedEmails],
    ["Programa", normalized.program],
    ["Instrumento / área", normalized.instrument],
    ["Nivel", normalized.level],
    ["Modalidad", normalized.modality],
    ["Docente", normalized.teacher],
    ["Estado", normalized.status],
  ].filter(([, value]) => safeText(value));
}

/* =============================================================================
  Bitácoras
============================================================================= */

export function normalizeAuthor(rawAuthor = null, raw = {}) {
  if (isPlainObject(rawAuthor)) {
    return {
      name: safeText(
        firstValue(
          rawAuthor.name,
          rawAuthor.displayName,
          rawAuthor.nombre,
          rawAuthor.email,
          raw.authorName,
          raw.docente,
          raw.teacher
        )
      ),
      email: normalizeEmail(firstValue(rawAuthor.email, raw.authorEmail)),
      role: safeText(firstValue(rawAuthor.role, rawAuthor.rol)),
    };
  }

  return {
    name: safeText(
      firstValue(
        rawAuthor,
        raw.authorName,
        raw.docente,
        raw.teacher,
        raw.teacherName
      )
    ),
    email: normalizeEmail(firstValue(raw.authorEmail, raw.teacherEmail)),
    role: safeText(firstValue(raw.authorRole, raw.rol)),
  };
}

export function normalizeStudentRefs(value = []) {
  return safeArray(value)
    .map((item) => {
      if (typeof item === "string") {
        return {
          id: item,
          name: "",
        };
      }

      if (!isPlainObject(item)) return null;

      return {
        id: safeText(firstValue(item.id, item.studentId, item.key)),
        name: safeText(firstValue(item.name, item.displayName, item.nombre)),
      };
    })
    .filter(Boolean);
}

export function normalizeAttachment(raw = null) {
  if (!raw) return null;

  if (typeof raw === "string") {
    return {
      name: raw.split("/").pop() || "Archivo",
      url: raw,
      path: raw,
      type: "link",
    };
  }

  if (!isPlainObject(raw)) return null;

  return {
    ...raw,
    name: safeText(firstValue(raw.name, raw.filename, raw.fileName, "Archivo")),
    url: safeText(firstValue(raw.url, raw.downloadURL, raw.href, raw.link)),
    path: safeText(firstValue(raw.path, raw.storagePath)),
    type: safeText(firstValue(raw.type, raw.mimeType, raw.contentType, "file")),
    size: safeNumber(raw.size || raw.sizeBytes, 0),
  };
}

export function normalizeBitacora(raw = null) {
  if (!raw) return null;

  const id = safeText(firstValue(raw.id, raw.key));

  const title = safeText(
    firstValue(
      raw.title,
      raw.titulo,
      raw.topic,
      raw.tema,
      "Bitácora de clase"
    ),
    "Bitácora de clase"
  );

  const content = safeText(
    firstValue(
      raw.content,
      raw.contenido,
      raw.description,
      raw.descripcion,
      raw.notes,
      raw.observaciones,
      raw.summary,
      raw.resumen
    )
  );

  const fechaClase = firstValue(
    raw.fechaClase,
    raw.date,
    raw.fecha,
    raw.classDate,
    raw.createdAt,
    raw.updatedAt
  );

  const processObject = isPlainObject(raw.process) ? raw.process : null;
  const processLabel = safeText(
    firstValue(
      processObject?.processLabel,
      processObject?.label,
      processObject?.programa,
      processObject?.area,
      raw.proceso,
      raw.program,
      raw.programa,
      "general"
    )
  );

  const studentIds = uniqueArray([
    ...safeArray(raw.studentIds),
    ...safeArray(raw.students),
    ...safeArray(raw.estudiantes),
    raw.studentId,
    raw.estudianteId,
  ].map((item) => safeText(item)));

  const studentRefs = normalizeStudentRefs(raw.studentRefs || raw.estudiantesRefs);

  const tags = uniqueArray(
    safeArray(firstValue(raw.tags, raw.etiquetas, []))
      .flatMap((item) => {
        if (typeof item === "string" && item.includes(",")) {
          return item.split(",");
        }

        return item;
      })
      .map((item) => safeText(item))
  );

  const attachments = safeArray(
    firstValue(raw.attachments, raw.adjuntos, raw.files, raw.archivos, [])
  )
    .map((item) => normalizeAttachment(item))
    .filter(Boolean);

  const author = normalizeAuthor(raw.author, raw);

  const normalized = normalizeDateFields({
    ...raw,

    id,

    title,
    titulo: raw.titulo || title,

    content,
    contenido: raw.contenido || content,

    fechaClase,
    date: raw.date || fechaClase,

    process: processObject || processLabel,
    proceso: raw.proceso || processLabel,
    processKey: safeText(firstValue(processObject?.processKey, raw.processKey)),
    processLabel,

    studentIds,
    studentRefs,

    tags,
    etiquetas: raw.etiquetas || tags,

    attachments,
    adjuntos: raw.adjuntos || attachments,

    author,

    preview: truncateText(content, 220),
  });

  normalized._fechaClase = toDateMaybe(fechaClase);
  normalized._date = normalized._fechaClase;

  return normalized;
}

export function normalizeBitacoras(items = []) {
  return sortByDate(
    safeArray(items)
      .map((item) => normalizeBitacora(item))
      .filter(Boolean),
    ["fechaClase", "date", "createdAt", "updatedAt"],
    "desc"
  );
}

export function normalizeBitacorasResponse(response, normalizeItem = normalizeBitacora) {
  if (Array.isArray(response)) {
    return response.map(normalizeItem).filter(Boolean);
  }

  if (Array.isArray(response?.data)) {
    return response.data.map(normalizeItem).filter(Boolean);
  }

  if (Array.isArray(response?.items)) {
    return response.items.map(normalizeItem).filter(Boolean);
  }

  if (Array.isArray(response?.bitacoras)) {
    return response.bitacoras.map(normalizeItem).filter(Boolean);
  }

  return [];
}

export function getBitacoraDate(bitacora = null) {
  if (!bitacora) return null;

  return toDateMaybe(
    firstValue(
      bitacora.fechaClase,
      bitacora.date,
      bitacora.fecha,
      bitacora.createdAt,
      bitacora.updatedAt
    )
  );
}

/* =============================================================================
  Rutas de aprendizaje
============================================================================= */

export function normalizeGoal(raw = null, index = 0) {
  if (!raw && raw !== 0) return null;

  if (typeof raw === "string") {
    return {
      id: `goal-${index + 1}`,
      title: raw,
      description: "",
      status: "",
      progress: 0,
    };
  }

  if (!isPlainObject(raw)) return null;

  const title = safeText(
    firstValue(raw.title, raw.titulo, raw.name, raw.nombre, `Objetivo ${index + 1}`)
  );

  const status = safeText(
    firstValue(raw.status, raw.estado, raw.state)
  ).toLowerCase();

  return normalizeDateFields({
    ...raw,
    id: safeText(firstValue(raw.id, raw.key, `goal-${index + 1}`)),
    title,
    titulo: raw.titulo || title,
    description: safeText(firstValue(raw.description, raw.descripcion, raw.text, raw.detalle)),
    status,
    estado: raw.estado || status,
    progress: clamp(firstValue(raw.progress, raw.progreso, raw.percent, 0), 0, 100),
  });
}

export function normalizeMilestone(raw = null, index = 0) {
  if (!raw && raw !== 0) return null;

  if (typeof raw === "string") {
    return {
      id: `milestone-${index + 1}`,
      title: raw,
      description: "",
      status: "",
      date: null,
    };
  }

  if (!isPlainObject(raw)) return null;

  const title = safeText(
    firstValue(raw.title, raw.titulo, raw.name, raw.nombre, `Paso ${index + 1}`)
  );

  const status = safeText(
    firstValue(raw.status, raw.estado, raw.state)
  ).toLowerCase();

  return normalizeDateFields({
    ...raw,
    id: safeText(firstValue(raw.id, raw.key, `milestone-${index + 1}`)),
    title,
    titulo: raw.titulo || title,
    description: safeText(firstValue(raw.description, raw.descripcion, raw.text, raw.detalle)),
    status,
    estado: raw.estado || status,
    date: firstValue(raw.date, raw.fecha, raw.createdAt, raw.updatedAt),
  });
}

export function normalizeStudentRoute(raw = null) {
  if (!raw) return null;

  const id = safeText(firstValue(raw.id, raw.key));

  const processKey = safeText(
    firstValue(raw.processKey, raw.process?.processKey, raw.proceso, "general")
  );

  const title = safeText(
    firstValue(
      raw.title,
      raw.titulo,
      raw.name,
      raw.nombre,
      "Ruta de aprendizaje"
    ),
    "Ruta de aprendizaje"
  );

  const description = safeText(
    firstValue(raw.description, raw.descripcion, raw.summary, raw.resumen)
  );

  const goals = safeArray(firstValue(raw.goals, raw.objetivos, raw.objectives, []))
    .map((item, index) => normalizeGoal(item, index))
    .filter(Boolean);

  const milestones = safeArray(firstValue(raw.milestones, raw.hitos, raw.steps, []))
    .map((item, index) => normalizeMilestone(item, index))
    .filter(Boolean);

  const completedGoals = goals.filter((goal) =>
    ["done", "completed", "completado", "finalizado"].includes(
      safeText(goal.status || goal.estado).toLowerCase()
    )
  );

  const progressFromGoals = goals.length
    ? Math.round((completedGoals.length / goals.length) * 100)
    : 0;

  const progress = clamp(
    firstValue(
      raw.progress,
      raw.progreso,
      raw.progressPercent,
      raw.porcentaje,
      progressFromGoals
    ),
    0,
    100
  );

  return normalizeDateFields({
    ...raw,

    id,

    studentId: safeText(firstValue(raw.studentId, raw.student, raw.estudianteId)),
    processKey,
    process: raw.process || processKey,
    proceso: raw.proceso || processKey,

    title,
    titulo: raw.titulo || title,

    description,
    descripcion: raw.descripcion || description,

    goals,
    objetivos: raw.objetivos || goals,

    milestones,
    hitos: raw.hitos || milestones,

    progress,
    progreso: raw.progreso ?? progress,

    status: safeText(firstValue(raw.status, raw.estado)),
    estado: raw.estado || raw.status || "",

    completedGoals: completedGoals.length,
    totalGoals: goals.length,
  });
}

export function normalizeStudentRoutes(items = []) {
  return sortByDate(
    safeArray(items)
      .map((item) => normalizeStudentRoute(item))
      .filter(Boolean),
    ["updatedAt", "createdAt"],
    "desc"
  );
}

/* =============================================================================
  Recursos
============================================================================= */

export function normalizeResource(raw = null) {
  if (!raw) return null;

  const title = safeText(
    firstValue(raw.title, raw.titulo, raw.name, raw.nombre, "Recurso")
  );

  const type = safeText(
    firstValue(raw.type, raw.tipo, "link")
  ).toLowerCase();

  const url = safeText(firstValue(raw.url, raw.link, raw.href, raw.downloadURL));

  const active =
    raw.active !== false &&
    raw.estado !== "inactivo" &&
    raw.status !== "inactive";

  return normalizeDateFields({
    ...raw,

    id: safeText(firstValue(raw.id, raw.key)),

    title,
    titulo: raw.titulo || title,

    description: safeText(
      firstValue(raw.description, raw.descripcion, raw.summary, raw.resumen)
    ),

    type,
    tipo: raw.tipo || type,

    url,

    area: safeText(firstValue(raw.area, raw.instrument, raw.instrumento, raw.program)),
    instrument: safeText(firstValue(raw.instrument, raw.instrumento, raw.area)),

    visibility: safeText(firstValue(raw.visibility, raw.visibilidad, "students")),
    active,

    icon: safeText(firstValue(raw.icon, raw.emoji, getResourceIcon(type))),
  });
}

export function normalizeResources(items = []) {
  return sortByText(
    safeArray(items)
      .map((item) => normalizeResource(item))
      .filter(Boolean)
      .filter((item) => item.active !== false),
    "title",
    "asc"
  );
}

export function getResourceIcon(type = "") {
  const normalized = safeText(type).toLowerCase();

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

  return icons[normalized] || "▦";
}

/* =============================================================================
  Eventos
============================================================================= */

export function normalizeEvent(raw = null) {
  if (!raw) return null;

  const title = safeText(
    firstValue(raw.title, raw.titulo, raw.name, raw.nombre, "Evento")
  );

  const type = safeText(
    firstValue(raw.type, raw.tipo, "event")
  ).toLowerCase();

  const dateStart = firstValue(
    raw.dateStart,
    raw.startDate,
    raw.fechaInicio,
    raw.date,
    raw.fecha,
    raw.createdAt
  );

  const dateEnd = firstValue(
    raw.dateEnd,
    raw.endDate,
    raw.fechaFin
  );

  const active =
    raw.active !== false &&
    raw.estado !== "inactivo" &&
    raw.status !== "inactive";

  return normalizeDateFields({
    ...raw,

    id: safeText(firstValue(raw.id, raw.key)),

    title,
    titulo: raw.titulo || title,

    description: safeText(
      firstValue(raw.description, raw.descripcion, raw.summary, raw.resumen)
    ),

    type,
    tipo: raw.tipo || type,

    dateStart,
    dateEnd,

    location: safeText(firstValue(raw.location, raw.lugar, raw.sede)),
    lugar: raw.lugar || raw.location || raw.sede || "",

    visibility: safeText(firstValue(raw.visibility, raw.visibilidad, "students")),
    active,

    icon: safeText(firstValue(raw.icon, raw.emoji, getEventIcon(type))),
  });
}

export function normalizeEvents(items = []) {
  return sortByDate(
    safeArray(items)
      .map((item) => normalizeEvent(item))
      .filter(Boolean)
      .filter((item) => item.active !== false),
    ["dateStart", "date", "fecha", "createdAt"],
    "asc"
  );
}

export function getEventIcon(type = "") {
  const normalized = safeText(type).toLowerCase();

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

  return icons[normalized] || "◷";
}

export function isUpcomingEvent(event = null, from = new Date()) {
  if (!event) return false;

  const date = toDateMaybe(
    firstValue(event.dateStart, event.date, event.fecha, event.createdAt)
  );

  if (!date) return true;

  const base = from instanceof Date && !Number.isNaN(from.getTime())
    ? new Date(from)
    : new Date();

  base.setHours(0, 0, 0, 0);

  return date.getTime() >= base.getTime();
}

/* =============================================================================
  Home bundle
============================================================================= */

export function normalizePortalBundle(raw = {}) {
  const student = normalizeStudent(raw.student);
  const route = normalizeStudentRoute(raw.route);
  const routes = normalizeStudentRoutes(raw.routes);
  const bitacoras = normalizeBitacoras(raw.bitacoras);
  const resources = normalizeResources(raw.resources);
  const events = normalizeEvents(raw.events);

  return {
    ...raw,
    student,
    route,
    routes,
    bitacoras,
    resources,
    events,
    catalogs: raw.catalogs || null,
  };
}

/* =============================================================================
  Compatibilidad con nombres anteriores
============================================================================= */

export const normalizers = Object.freeze({
  safeText,
  safeNumber,
  safeBoolean,
  safeArray,
  uniqueArray,
  normalizeEmail,
  normalizeKey,
  normalizeText,

  toDateMaybe,
  formatDate,
  formatDateTime,
  sortByDate,
  sortByText,

  normalizeDoc,
  normalizeFirestoreSnap,
  normalizeFirestoreDocs,

  normalizeAccessProfile,
  normalizeStudent,
  normalizeStudentKey,
  normalizeStudentKeyText,
  getCanonicalStudentKey,
  getStudentRecordTime,
  pickLatestStudentRecord,
  dedupeStudents,
  getStudentIdentity,
  getStudentFallbackId,
  normalizeStudentProcesses,
  resolveStudentProcess,
  buildDefaultStudentRoute,
  normalizeBitacora,
  normalizeBitacoras,
  normalizeBitacorasResponse,
  normalizeStudentRoute,
  normalizeStudentRoutes,
  normalizeResource,
  normalizeResources,
  normalizeEvent,
  normalizeEvents,
  normalizePortalBundle,

  getStudentDisplayName,
  getStudentSubtitle,
  getStudentProfileRows,
  getResourceIcon,
  getEventIcon,
  isUpcomingEvent,
});

export default normalizers;
