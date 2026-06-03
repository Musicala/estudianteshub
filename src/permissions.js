"use strict";

/* =============================================================================
  src/permissions.js — Estudiantes HUB · Musicala

  Capa de permisos del portal estudiantil.

  Responsabilidades:
  - Normalizar roles.
  - Validar si un usuario puede entrar al portal.
  - Validar si puede ver un estudiante específico.
  - Resolver mensajes claros de acceso.
  - NO consulta Firestore.
  - NO toca Firebase Auth.
  - NO modifica datos.

  La seguridad real debe estar en firestore.rules.
  Este archivo ayuda a que la interfaz tome buenas decisiones y muestre mensajes
  humanos en vez de errores crípticos, porque ya bastante hace Firebase.
============================================================================= */

import {
  ROLE_GROUPS,
  ACCESS_CONFIG,
  isAdminRole,
  isTeacherRole,
  isStudentRole,
  isPortalAllowedRole,
} from "./config.js";

import {
  safeText,
  safeArray,
  uniqueArray,
  normalizeEmail,
} from "./normalizers.js";

/* =============================================================================
  Constantes
============================================================================= */

export const ACCESS_REASONS = Object.freeze({
  OK: "OK",

  NO_AUTH_USER: "NO_AUTH_USER",
  NO_AUTH_EMAIL: "NO_AUTH_EMAIL",

  NO_ACCESS_PROFILE: "NO_ACCESS_PROFILE",
  INACTIVE_PROFILE: "INACTIVE_PROFILE",
  INVALID_ROLE: "INVALID_ROLE",

  NO_LINKED_STUDENTS: "NO_LINKED_STUDENTS",
  STUDENT_NOT_ALLOWED: "STUDENT_NOT_ALLOWED",
  NO_STUDENT_SELECTED: "NO_STUDENT_SELECTED",

  UNKNOWN: "UNKNOWN",
});

export const ACCESS_MESSAGES = Object.freeze({
  [ACCESS_REASONS.OK]: "Acceso permitido.",

  [ACCESS_REASONS.NO_AUTH_USER]:
    "Debes iniciar sesión con Google para entrar al portal.",

  [ACCESS_REASONS.NO_AUTH_EMAIL]:
    "Tu cuenta de Google no entregó un correo válido. Revisa que estés usando una cuenta normal de Google.",

  [ACCESS_REASONS.NO_ACCESS_PROFILE]:
    "Tu correo todavía no tiene acceso al portal de estudiantes. Revisa que esté registrado en Musicala.",

  [ACCESS_REASONS.INACTIVE_PROFILE]:
    "Tu acceso está inactivo. Si crees que es un error, revisa con el equipo administrativo de Musicala.",

  [ACCESS_REASONS.INVALID_ROLE]:
    "Tu usuario existe, pero no tiene un rol habilitado para ver Estudiantes HUB.",

  [ACCESS_REASONS.NO_LINKED_STUDENTS]:
    "Tu usuario no tiene estudiantes vinculados todavía.",

  [ACCESS_REASONS.STUDENT_NOT_ALLOWED]:
    "Este estudiante no está vinculado a tu usuario.",

  [ACCESS_REASONS.NO_STUDENT_SELECTED]:
    "No hay un estudiante seleccionado para mostrar.",

  [ACCESS_REASONS.UNKNOWN]:
    "No se pudo validar el acceso al portal.",
});

/* =============================================================================
  Helpers base
============================================================================= */

function makeResult({
  ok = false,
  reason = ACCESS_REASONS.UNKNOWN,
  message = "",
  details = {},
} = {}) {
  return {
    ok: Boolean(ok),
    reason,
    message: message || ACCESS_MESSAGES[reason] || ACCESS_MESSAGES.UNKNOWN,
    details,
  };
}

export function normalizeRole(role = "") {
  return safeText(role).toLowerCase();
}

export function normalizeStatus(value = "") {
  return safeText(value).toLowerCase();
}

export function getAuthEmail(user = null) {
  return normalizeEmail(user?.email || "");
}

export function getProfileEmail(profile = null) {
  return normalizeEmail(
    profile?.email ||
      profile?.correo ||
      profile?.userEmail ||
      profile?.id ||
      ""
  );
}

export function getProfileRole(profile = null) {
  return normalizeRole(
    profile?.role ||
      profile?.rol ||
      profile?.type ||
      profile?.tipo ||
      "student"
  );
}

export function isProfileActive(profile = null) {
  if (!profile) return false;

  const status = normalizeStatus(profile.status || profile.estado);

  if (profile.active === false) return false;
  if (status === "inactive" || status === "inactivo") return false;
  if (status === "disabled" || status === "deshabilitado") return false;
  if (status === "archived" || status === "archivado") return false;

  return true;
}

export function getLinkedStudentIds(profile = null) {
  if (!profile) return [];

  return uniqueArray([
    ...safeArray(profile.studentIds),
    ...safeArray(profile.students),
    ...safeArray(profile.estudiantes),
    profile.studentId,
    profile.studentKey,
    profile.estudianteId,
  ].map((item) => safeText(item)));
}

export function hasRole(profile = null, roles = []) {
  const role = getProfileRole(profile);
  const allowed = safeArray(roles).map((item) => normalizeRole(item));

  return allowed.includes(role);
}

export function hasAnyRole(profile = null, roles = []) {
  return hasRole(profile, roles);
}

export function isAdminProfile(profile = null) {
  return isAdminRole(getProfileRole(profile));
}

export function isTeacherProfile(profile = null) {
  return isTeacherRole(getProfileRole(profile));
}

export function isStudentProfile(profile = null) {
  return isStudentRole(getProfileRole(profile));
}

export function isInternalProfile(profile = null) {
  return isAdminProfile(profile) || isTeacherProfile(profile);
}

export function canUseStudentPicker(profile = null) {
  return getLinkedStudentIds(profile).length > 1;
}

/* =============================================================================
  Validación principal de acceso al portal
============================================================================= */

export function validateAuthUser(user = null) {
  if (!user) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.NO_AUTH_USER,
    });
  }

  const email = getAuthEmail(user);

  if (!email) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.NO_AUTH_EMAIL,
    });
  }

  return makeResult({
    ok: true,
    reason: ACCESS_REASONS.OK,
    details: {
      email,
      uid: user.uid || "",
    },
  });
}

export function validateAccessProfile(profile = null, user = null, options = {}) {
  const {
    requireLinkedStudent = ACCESS_CONFIG?.requireLinkedStudent !== false,
    requireActiveUser = ACCESS_CONFIG?.requireActiveUser !== false,
  } = options;

  const authValidation = user ? validateAuthUser(user) : makeResult({ ok: true });

  if (!authValidation.ok) {
    return authValidation;
  }

  if (!profile) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.NO_ACCESS_PROFILE,
    });
  }

  const authEmail = user ? getAuthEmail(user) : "";
  const profileEmail = getProfileEmail(profile);
  const role = getProfileRole(profile);
  const studentIds = getLinkedStudentIds(profile);

  if (requireActiveUser && !isProfileActive(profile)) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.INACTIVE_PROFILE,
      details: {
        role,
        profileEmail,
        authEmail,
      },
    });
  }

  if (!isPortalAllowedRole(role)) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.INVALID_ROLE,
      details: {
        role,
        profileEmail,
        authEmail,
      },
    });
  }

  /*
    Admins/docentes pueden entrar al portal aunque no tengan estudiante vinculado,
    siempre que luego seleccionen o se les entregue un studentId permitido por reglas.
    Para estudiantes sí pedimos vínculo.
  */
  const shouldRequireStudent =
    requireLinkedStudent && !isAdminProfile(profile) && !isTeacherProfile(profile);

  if (shouldRequireStudent && !studentIds.length) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.NO_LINKED_STUDENTS,
      details: {
        role,
        profileEmail,
        authEmail,
        studentIds,
      },
    });
  }

  return makeResult({
    ok: true,
    reason: ACCESS_REASONS.OK,
    details: {
      role,
      profileEmail,
      authEmail,
      studentIds,
      isAdmin: isAdminProfile(profile),
      isTeacher: isTeacherProfile(profile),
      isStudent: isStudentProfile(profile),
    },
  });
}

/* =============================================================================
  Permisos sobre estudiante
============================================================================= */

export function canViewStudent(profile = null, studentId = "", options = {}) {
  const id = safeText(studentId);

  if (!id) {
    return false;
  }

  if (!profile) {
    return false;
  }

  if (!isProfileActive(profile)) {
    return false;
  }

  const role = getProfileRole(profile);

  if (!isPortalAllowedRole(role)) {
    return false;
  }

  /*
    En Estudiantes HUB recomendamos mantener todo restringido por vínculo.
    Aunque un admin pueda existir, Firestore rules deberían definir si puede leer.
    Para la UI, permitimos admin/docente si la opción lo permite.
  */
  const allowInternal = options.allowInternal !== false;

  if (allowInternal && (isAdminProfile(profile) || isTeacherProfile(profile))) {
    const linkedIds = getLinkedStudentIds(profile);

    /*
      Si el perfil interno tiene studentIds, se respeta esa lista.
      Si no tiene lista, se deja pasar a la UI, pero Firestore rules mandan.
    */
    return linkedIds.length ? linkedIds.includes(id) : true;
  }

  return getLinkedStudentIds(profile).includes(id);
}

export function validateStudentAccess(profile = null, studentId = "", options = {}) {
  const id = safeText(studentId);

  if (!id) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.NO_STUDENT_SELECTED,
    });
  }

  if (!profile) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.NO_ACCESS_PROFILE,
    });
  }

  const profileValidation = validateAccessProfile(profile, null, {
    requireLinkedStudent: false,
  });

  if (!profileValidation.ok) {
    return profileValidation;
  }

  if (!canViewStudent(profile, id, options)) {
    return makeResult({
      ok: false,
      reason: ACCESS_REASONS.STUDENT_NOT_ALLOWED,
      details: {
        studentId: id,
        linkedStudentIds: getLinkedStudentIds(profile),
        role: getProfileRole(profile),
      },
    });
  }

  return makeResult({
    ok: true,
    reason: ACCESS_REASONS.OK,
    details: {
      studentId: id,
      linkedStudentIds: getLinkedStudentIds(profile),
      role: getProfileRole(profile),
    },
  });
}

export function filterAllowedStudentIds(profile = null, studentIds = [], options = {}) {
  const ids = uniqueArray(safeArray(studentIds).map((item) => safeText(item)));

  return ids.filter((id) => canViewStudent(profile, id, options));
}

export function getDefaultStudentId(profile = null, preferredStudentId = "") {
  const ids = getLinkedStudentIds(profile);
  const preferred = safeText(preferredStudentId);

  if (preferred && ids.includes(preferred)) {
    return preferred;
  }

  return ids[0] || null;
}

/* =============================================================================
  Permisos sobre módulos
============================================================================= */

export function canViewRoute(profile = null, studentId = "") {
  return canViewStudent(profile, studentId);
}

export function canViewJournal(profile = null, studentId = "") {
  return canViewStudent(profile, studentId);
}

export function canViewResources(profile = null) {
  if (!profile) return false;
  if (!isProfileActive(profile)) return false;

  return isPortalAllowedRole(getProfileRole(profile));
}

export function canViewEvents(profile = null) {
  if (!profile) return false;
  if (!isProfileActive(profile)) return false;

  return isPortalAllowedRole(getProfileRole(profile));
}

export function canViewProfile(profile = null, studentId = "") {
  return canViewStudent(profile, studentId);
}

/*
  Writes futuros.
  Por ahora Estudiantes HUB es principalmente lectura.
*/

export function canCreatePracticeLog(profile = null, studentId = "") {
  return canViewStudent(profile, studentId);
}

export function canCreateStudentComment(profile = null, studentId = "") {
  return canViewStudent(profile, studentId);
}

export function canUploadEvidence(profile = null, studentId = "") {
  return canViewStudent(profile, studentId);
}

/* =============================================================================
  Resumen de permisos para la app
============================================================================= */

export function getPermissionSummary(profile = null, studentId = "") {
  const role = getProfileRole(profile);
  const linkedStudentIds = getLinkedStudentIds(profile);
  const selectedStudentId = safeText(studentId);

  const profileValidation = validateAccessProfile(profile, null, {
    requireLinkedStudent: false,
  });

  const studentValidation = selectedStudentId
    ? validateStudentAccess(profile, selectedStudentId)
    : makeResult({
        ok: false,
        reason: ACCESS_REASONS.NO_STUDENT_SELECTED,
      });

  return {
    ok: profileValidation.ok && (!selectedStudentId || studentValidation.ok),

    role,
    linkedStudentIds,
    selectedStudentId,

    isAdmin: isAdminProfile(profile),
    isTeacher: isTeacherProfile(profile),
    isStudent: isStudentProfile(profile),
    isInternal: isInternalProfile(profile),

    canUseStudentPicker: canUseStudentPicker(profile),

    modules: {
      route: selectedStudentId ? canViewRoute(profile, selectedStudentId) : false,
      journal: selectedStudentId ? canViewJournal(profile, selectedStudentId) : false,
      resources: canViewResources(profile),
      events: canViewEvents(profile),
      profile: selectedStudentId ? canViewProfile(profile, selectedStudentId) : false,
    },

    futureWrites: {
      practiceLogs: selectedStudentId
        ? canCreatePracticeLog(profile, selectedStudentId)
        : false,
      comments: selectedStudentId
        ? canCreateStudentComment(profile, selectedStudentId)
        : false,
      evidence: selectedStudentId
        ? canUploadEvidence(profile, selectedStudentId)
        : false,
    },

    validation: {
      profile: profileValidation,
      student: studentValidation,
    },
  };
}

/* =============================================================================
  Diagnóstico y mensajes
============================================================================= */

export function getAccessMessage(reason = ACCESS_REASONS.UNKNOWN) {
  return ACCESS_MESSAGES[reason] || ACCESS_MESSAGES.UNKNOWN;
}

export function describeAccessProfile(profile = null) {
  if (!profile) {
    return {
      exists: false,
      role: "",
      active: false,
      email: "",
      studentIds: [],
      label: "Sin perfil",
    };
  }

  const role = getProfileRole(profile);
  const active = isProfileActive(profile);
  const studentIds = getLinkedStudentIds(profile);
  const email = getProfileEmail(profile);

  return {
    exists: true,
    role,
    active,
    email,
    studentIds,
    label: [
      active ? "Activo" : "Inactivo",
      role || "sin rol",
      studentIds.length
        ? `${studentIds.length} estudiante(s)`
        : "sin estudiantes vinculados",
    ].join(" · "),
  };
}

export function createPermissionError(reason, details = {}) {
  const error = new Error(getAccessMessage(reason));

  error.code = reason;
  error.reason = reason;
  error.details = details;

  return error;
}

/* =============================================================================
  Compatibilidad / export agrupado
============================================================================= */

export const permissions = Object.freeze({
  ACCESS_REASONS,
  ACCESS_MESSAGES,

  normalizeRole,
  normalizeStatus,

  getAuthEmail,
  getProfileEmail,
  getProfileRole,
  getLinkedStudentIds,

  isProfileActive,
  isAdminProfile,
  isTeacherProfile,
  isStudentProfile,
  isInternalProfile,

  validateAuthUser,
  validateAccessProfile,
  validateStudentAccess,

  canViewStudent,
  canUseStudentPicker,

  filterAllowedStudentIds,
  getDefaultStudentId,

  canViewRoute,
  canViewJournal,
  canViewResources,
  canViewEvents,
  canViewProfile,

  canCreatePracticeLog,
  canCreateStudentComment,
  canUploadEvidence,

  getPermissionSummary,
  getAccessMessage,
  describeAccessProfile,
  createPermissionError,
});

export default permissions;