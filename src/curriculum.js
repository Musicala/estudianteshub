"use strict";

/* =============================================================================
  Adaptador puro del currículo publicado por Mapa de Experiencias.

  Este módulo no conoce Firebase ni el DOM. Mantiene separado el contrato
  curricular de la capa de datos para poder probarlo sin tocar producción.
============================================================================= */

export const PIANO_CURRICULUM_DOCUMENT_ID = "piano";
export const PIANO_ROUTE_TEMPLATE_ID = "mapa-piano";
export const PIANO_PROGRESS_EPOCH = "mapa-piano-20260815-v1";
export const GUITAR_CURRICULUM_DOCUMENT_ID = "guitarra";
export const GUITAR_ROUTE_TEMPLATE_ID = "mapa-guitarra";
export const GUITAR_PROGRESS_EPOCH = "mapa-guitarra-20260831-v1";
export const VIOLIN_CURRICULUM_DOCUMENT_ID = "violin";
export const VIOLIN_ROUTE_TEMPLATE_ID = "mapa-violin";
export const VIOLIN_PROGRESS_EPOCH = "mapa-violin-20260831-v1";
export const BATERIA_CURRICULUM_DOCUMENT_ID = "bateria";
export const BATERIA_ROUTE_TEMPLATE_ID = "mapa-bateria";
export const BATERIA_PROGRESS_EPOCH = "mapa-bateria-20260918-v1";

const COMPONENT_LABELS = Object.freeze({
  corporal: "Corporal",
  tecnico: "Técnica",
  teorico: "Teórico",
  repertorio: "Repertorio",
  creativo: "Creativo",
  obras: "Obras",
  general: "General",
});

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value = "") {
  return safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toRoman(value) {
  const number = Math.max(1, Math.min(3999, Math.round(Number(value) || 1)));
  const pairs = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let rest = number;
  let output = "";
  for (const [amount, glyph] of pairs) {
    while (rest >= amount) {
      output += glyph;
      rest -= amount;
    }
  }
  return output;
}

function normalizeComponent(value = "") {
  const text = normalizeText(value);
  if (text.includes("corporal")) return "corporal";
  if (text.includes("tecnic")) return "tecnico";
  if (text.includes("teoric")) return "teorico";
  if (text.includes("repertorio")) return "repertorio";
  if (text.includes("creativ")) return "creativo";
  if (text.includes("obra")) return "obras";
  return text.replace(/\s+/g, "-") || "general";
}

function componentLabel(component, rawLabel = "") {
  return safeText(rawLabel) || COMPONENT_LABELS[component] || "General";
}

function hasValidPublishedPianoContract(raw = null) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.schemaVersion !== 1) return false;
  if (!/^sha256:[a-f0-9]{64}$/i.test(safeText(raw.revision))) return false;
  if (safeText(raw.routeKey) !== "piano") return false;

  const source = raw.source;
  if (!source || typeof source !== "object") return false;
  if (safeText(source.projectId) !== "mapa-de-experiencias") return false;
  if (safeText(source.slug) !== "piano") return false;

  const rawExperiences = safeArray(raw.experiences);
  const experienceCount = raw.experienceCount;
  const goalCount = raw.goalCount;
  if (
    !Number.isInteger(experienceCount) ||
    experienceCount <= 0 ||
    experienceCount !== rawExperiences.length ||
    !Number.isInteger(goalCount) ||
    goalCount <= 0
  ) {
    return false;
  }

  const experienceIds = new Set();
  const experienceOrders = new Set();
  const goalIds = new Set();
  let actualGoalCount = 0;

  for (const experience of rawExperiences) {
    if (!experience || typeof experience !== "object") return false;
    const experienceId = safeText(experience.id);
    const experienceOrder = experience.order;
    if (
      !experienceId ||
      experienceIds.has(experienceId) ||
      !Number.isInteger(experienceOrder) ||
      experienceOrder <= 0 ||
      experienceOrders.has(experienceOrder) ||
      !safeText(experience.objective) ||
      !safeText(experience.evidence)
    ) {
      return false;
    }
    experienceIds.add(experienceId);
    experienceOrders.add(experienceOrder);

    const skills = safeArray(experience.skills);
    if (!skills.length) return false;
    for (const skill of skills) {
      if (!skill || typeof skill !== "object") return false;
      const skillId = safeText(skill.id);
      const goalId = safeText(skill.goalId);
      const expectedGoalId = `${experienceId}:${skillId}`;
      if (
        !skillId ||
        !safeText(skill.title) ||
        goalId !== expectedGoalId ||
        goalIds.has(goalId)
      ) {
        return false;
      }
      goalIds.add(goalId);
      actualGoalCount += 1;
    }
  }

  for (let expectedOrder = 1; expectedOrder <= experienceCount; expectedOrder += 1) {
    if (!experienceOrders.has(expectedOrder)) return false;
  }

  return actualGoalCount === goalCount;
}

const INACTIVE_PROCESS_STATES = new Set([
  "inactive",
  "inactivo",
  "archivado",
  "archived",
  "cerrado",
  "closed",
  "retirado",
  "retired",
  "historico",
  "finalizado",
]);

const ACTIVE_PROCESS_STATES = new Set([
  "active",
  "activo",
  "actual",
  "current",
  "en curso",
  "vigente",
]);

function isPianoTerm(value = "") {
  return /(^|\s)(piano|teclado)(\s|$)/.test(normalizeText(value));
}

function isGuitarTerm(value = "") {
  return /(^|\s)(guitarra|guitar)(\s|$)/.test(normalizeText(value));
}

function isViolinTerm(value = "") {
  return /(^|\s)(violin|violinista)(\s|$)/.test(normalizeText(value));
}
function isBateriaTerm(value = "") { return /(^|\s)(bateria|baterista|percusion)(\s|$)/.test(normalizeText(value)); }

function processState(process = {}) {
  return normalizeText(
    process.status || process.estado || process.state || process.processStatus
  );
}

function isInactiveProcess(process = {}) {
  if (process.active === false || process.isActive === false) return true;
  return INACTIVE_PROCESS_STATES.has(processState(process));
}

function isExplicitlyActiveProcess(process = {}) {
  if (process.active === true || process.isActive === true) return true;
  return ACTIVE_PROCESS_STATES.has(processState(process));
}

function processTerms(process = {}) {
  return unique([
    process.processKey,
    process.id,
    process.detalle,
    process.label,
    process.instrumento,
    process.instrument,
    process.programa,
    process.program,
    process.arte,
    process.area,
    process.artKey,
  ].map(normalizeText));
}

function resolveProcessReference(student = {}, options = {}) {
  return safeText(
    options.processKey ||
    options.artKey ||
    student.activeProcessKey ||
    student.currentProcessKey ||
    student.resolvedProcessKey ||
    student.activeArtKey ||
    student.currentArtKey ||
    student.artKey ||
    student.processKey
  );
}

function selectedCurriculumProcesses(student = null, options = {}) {
  if (!student || typeof student !== "object") return [];
  const processes = safeArray(student.processes)
    .filter((process) => process && typeof process === "object");
  if (!processes.length) return [];

  const reference = normalizeText(resolveProcessReference(student, options));
  if (reference) {
    const referenced = processes.find((process) =>
      processTerms(process).includes(reference)
    );
    if (referenced) return isInactiveProcess(referenced) ? [] : [referenced];
  }

  const explicitlyActive = processes.filter(
    (process) => !isInactiveProcess(process) && isExplicitlyActiveProcess(process)
  );
  if (explicitlyActive.length) return explicitlyActive;

  // La resolución canónica existente usa el primer proceso cuando no hay una
  // referencia explícita. Imitamos esa decisión y no inspeccionamos procesos
  // históricos posteriores para evitar activar Piano por accidente.
  const firstAvailable = processes.find((process) => !isInactiveProcess(process));
  return firstAvailable ? [firstAvailable] : [];
}

export function isPianoCurriculumStudent(student = null, options = {}) {
  return isInstrumentCurriculumStudent(student, options, isPianoTerm);
}

export function isGuitarCurriculumStudent(student = null, options = {}) {
  return isInstrumentCurriculumStudent(student, options, isGuitarTerm);
}

export function isViolinCurriculumStudent(student = null, options = {}) {
  return isInstrumentCurriculumStudent(student, options, isViolinTerm);
}
export function isBateriaCurriculumStudent(student = null, options = {}) { return isInstrumentCurriculumStudent(student, options, isBateriaTerm); }

function isInstrumentCurriculumStudent(student = null, options = {}, matchesInstrument = () => false) {
  if (!student || typeof student !== "object") return false;

  const reference = resolveProcessReference(student, options);
  if (matchesInstrument(options.artKey || student.activeArtKey || student.currentArtKey)) {
    return true;
  }

  const processes = safeArray(student.processes);
  if (processes.length) {
    const selected = selectedCurriculumProcesses(student, options);
    return selected.some((process) => processTerms(process).some(matchesInstrument));
  }

  // Los campos generales solo son respaldo para registros antiguos sin una
  // lista de procesos. Nunca se mezclan con otro proceso ya resuelto.
  return unique([
    reference,
    student.instrumento,
    student.instrument,
    student.programa,
    student.program,
    student.area,
    student.discipline,
    student.disciplina,
  ].map(normalizeText)).some(matchesInstrument);
}

export function getPianoCanonicalStudentId(student = null) {
  return getMapCanonicalStudentId(student);
}

export function getGuitarCanonicalStudentId(student = null) { return getMapCanonicalStudentId(student); }
export function getViolinCanonicalStudentId(student = null) { return getMapCanonicalStudentId(student); }
export function getBateriaCanonicalStudentId(student = null) { return getMapCanonicalStudentId(student); }

function getMapCanonicalStudentId(student = null) {
  if (!student || typeof student !== "object") return "";
  const canonicalStudentId = safeText(student.canonicalStudentId);
  if (!canonicalStudentId || /^stu_/i.test(canonicalStudentId)) return "";

  const identityStates = [
    student.identityResolutionStatus,
    student.identityStatus,
    student.identityLinkStatus,
    student.canonicalIdentityStatus,
  ].map(normalizeText);
  if (identityStates.some((state) =>
    /(^|\s)(pending|pendiente)(\s|$)/.test(state)
  )) {
    return "";
  }

  return canonicalStudentId;
}

export function getPianoProgressDocumentId(student = null) {
  const canonicalStudentId = getPianoCanonicalStudentId(student);
  return canonicalStudentId
    ? `${canonicalStudentId}__${PIANO_ROUTE_TEMPLATE_ID}`
    : "";
}

export function getGuitarProgressDocumentId(student = null) {
  const canonicalStudentId = getGuitarCanonicalStudentId(student);
  return canonicalStudentId ? `${canonicalStudentId}__${GUITAR_ROUTE_TEMPLATE_ID}` : "";
}

export function getViolinProgressDocumentId(student = null) {
  const canonicalStudentId = getViolinCanonicalStudentId(student);
  return canonicalStudentId ? `${canonicalStudentId}__${VIOLIN_ROUTE_TEMPLATE_ID}` : "";
}
export function getBateriaProgressDocumentId(student = null) { const id = getBateriaCanonicalStudentId(student); return id ? `${id}__${BATERIA_ROUTE_TEMPLATE_ID}` : ""; }

function normalizePublishedSkill(rawSkill = {}, experience, index = 0) {
  const source = rawSkill?.skill && typeof rawSkill.skill === "object"
    ? { ...rawSkill.skill, ...rawSkill }
    : rawSkill;
  if (!source || typeof source !== "object") return null;

  const sourceSkillId = safeText(
    source.id || source.sourceSkillId || source.skillId || source.refId
  );
  if (!sourceSkillId || !experience?.id) return null;

  const title = safeText(source.title || source.name || source.nombre);
  if (!title) return null;

  const component = normalizeComponent(source.component || source.componente);
  const achievement = safeText(
    source.achievement || source.logro || source.expectedAchievement
  );
  const sourceDescription = safeText(source.description || source.descripcion);

  return {
    id: `${experience.id}:${sourceSkillId}`,
    sourceSkillId,
    experienceId: experience.id,
    experience: experience.order,
    experienceOrder: experience.order,
    order: positiveNumber(source.order, index + 1),
    title,
    description: achievement || sourceDescription,
    sourceDescription,
    achievement,
    component,
    componentLabel: componentLabel(
      component,
      source.componentLabel || source.componenteLabel
    ),
    category: safeText(source.category || source.categoria),
    difficulty: safeText(source.difficulty || source.dificultad),
    note: safeText(source.note || source.nota),
    tags: unique(safeArray(source.tags || source.etiquetas).map(safeText)),
  };
}

function normalizePublishedExperience(rawExperience = {}, index = 0) {
  if (!rawExperience || typeof rawExperience !== "object") return null;
  const id = safeText(
    rawExperience.id ||
    rawExperience.sourceExperienceId ||
    rawExperience.experienceId
  );
  if (!id) return null;

  const order = positiveNumber(rawExperience.order, index + 1);
  const experience = {
    id,
    order,
    experience: order,
    label: safeText(rawExperience.label, `Experiencia ${toRoman(order)}`),
    name: safeText(rawExperience.name || rawExperience.nombre),
    description: safeText(rawExperience.description || rawExperience.descripcion),
    objective: safeText(rawExperience.objective || rawExperience.objetivo),
    evidence: safeText(rawExperience.evidence || rawExperience.evidencia),
    difficulty: safeText(rawExperience.difficulty || rawExperience.dificultad),
    estimatedDuration: safeText(
      rawExperience.estimatedDuration || rawExperience.duracionEstimada
    ),
    suggestedAge: safeText(rawExperience.suggestedAge || rawExperience.edadSugerida),
    prerequisiteExperienceIds: unique(
      safeArray(rawExperience.prerequisiteExperienceIds).map(safeText)
    ),
    personalRepertoire:
      rawExperience.personalRepertoire &&
      typeof rawExperience.personalRepertoire === "object"
        ? {
            title: safeText(rawExperience.personalRepertoire.title),
            focus: safeText(rawExperience.personalRepertoire.focus),
            evidence: safeText(rawExperience.personalRepertoire.evidence),
          }
        : null,
  };

  const rawSkills = safeArray(rawExperience.skills || rawExperience.skillRefs);
  experience.goals = rawSkills
    .map((skill, skillIndex) =>
      normalizePublishedSkill(skill, experience, skillIndex)
    )
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);

  return experience;
}

export function normalizePublishedPianoCurriculum(raw = null) {
  if (!hasValidPublishedPianoContract(raw)) return null;

  const route = raw.route && typeof raw.route === "object" ? raw.route : {};
  const source = raw.source && typeof raw.source === "object" ? raw.source : {};

  const experiences = safeArray(raw.experiences)
    .map(normalizePublishedExperience)
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);
  const goals = experiences.flatMap((experience) => experience.goals);

  return {
    isPublishedPianoCurriculum: true,
    routeTemplateId: PIANO_ROUTE_TEMPLATE_ID,
    progressEpoch: PIANO_PROGRESS_EPOCH,
    schemaVersion: 1,
    revision: safeText(raw.revision),
    publishedAt: raw.publishedAt || null,
    sourceUpdatedAt: raw.sourceUpdatedAt || null,
    source: {
      projectId: safeText(source.projectId),
      artId: safeText(source.artId),
      routeId: safeText(source.routeId),
      slug: safeText(source.slug),
    },
    routeName: safeText(route.name || raw.routeName, "Piano"),
    description: safeText(route.description || raw.description),
    experienceCount: experiences.length,
    goalCount: goals.length,
    skillCount: goals.length,
    experiences,
    goals,
  };
}

export function normalizePublishedGuitarCurriculum(raw = null) {
  const normalized = normalizePublishedPianoCurriculum({
    ...raw, routeKey: "piano", source: { ...(raw?.source || {}), slug: "piano" },
  });
  return normalized ? {
    ...normalized,
    isPublishedPianoCurriculum: false,
    isPublishedGuitarCurriculum: true,
    routeTemplateId: GUITAR_ROUTE_TEMPLATE_ID,
    progressEpoch: GUITAR_PROGRESS_EPOCH,
    routeName: safeText(raw?.route?.name, "Guitarra"),
    source: raw?.source && typeof raw.source === "object" ? raw.source : {},
  } : null;
}

export function normalizePublishedViolinCurriculum(raw = null) {
  const normalized = normalizePublishedPianoCurriculum({
    ...raw, routeKey: "piano", source: { ...(raw?.source || {}), slug: "piano" },
  });
  return normalized ? {
    ...normalized,
    isPublishedPianoCurriculum: false,
    isPublishedGuitarCurriculum: false,
    isPublishedViolinCurriculum: true,
    routeTemplateId: VIOLIN_ROUTE_TEMPLATE_ID,
    progressEpoch: VIOLIN_PROGRESS_EPOCH,
    routeName: safeText(raw?.route?.name, "Violín"),
    source: raw?.source && typeof raw.source === "object" ? raw.source : {},
  } : null;
}
export function normalizePublishedBateriaCurriculum(raw = null) {
  const normalized = normalizePublishedPianoCurriculum({ ...raw, routeKey: "piano", source: { ...(raw?.source || {}), slug: "piano" } });
  return normalized ? { ...normalized, isPublishedPianoCurriculum: false, isPublishedGuitarCurriculum: false, isPublishedViolinCurriculum: false, isPublishedBateriaCurriculum: true, routeTemplateId: BATERIA_ROUTE_TEMPLATE_ID, progressEpoch: BATERIA_PROGRESS_EPOCH, routeName: safeText(raw?.route?.name, "Batería"), source: raw?.source && typeof raw.source === "object" ? raw.source : {} } : null;
}

export function isValidPianoProgress(progress = null, canonicalStudentId = "") {
  if (!progress || typeof progress !== "object") return false;
  const studentId = safeText(canonicalStudentId);
  if (!studentId) return false;
  return (
    safeText(progress.studentId) === studentId &&
    safeText(progress.studentKey) === studentId &&
    safeText(progress.routeTemplateId) === PIANO_ROUTE_TEMPLATE_ID &&
    safeText(progress.progressEpoch) === PIANO_PROGRESS_EPOCH
  );
}

export function isValidGuitarProgress(progress = null, canonicalStudentId = "") {
  return Boolean(progress) && safeText(progress.studentId) === safeText(canonicalStudentId) &&
    safeText(progress.studentKey) === safeText(canonicalStudentId) &&
    safeText(progress.routeTemplateId) === GUITAR_ROUTE_TEMPLATE_ID &&
    safeText(progress.progressEpoch) === GUITAR_PROGRESS_EPOCH;
}

export function isValidViolinProgress(progress = null, canonicalStudentId = "") {
  return Boolean(progress) && safeText(progress.studentId) === safeText(canonicalStudentId) &&
    safeText(progress.studentKey) === safeText(canonicalStudentId) &&
    safeText(progress.routeTemplateId) === VIOLIN_ROUTE_TEMPLATE_ID &&
    safeText(progress.progressEpoch) === VIOLIN_PROGRESS_EPOCH;
}
export function isValidBateriaProgress(progress = null, canonicalStudentId = "") { return Boolean(progress) && safeText(progress.studentId) === safeText(canonicalStudentId) && safeText(progress.studentKey) === safeText(canonicalStudentId) && safeText(progress.routeTemplateId) === BATERIA_ROUTE_TEMPLATE_ID && safeText(progress.progressEpoch) === BATERIA_PROGRESS_EPOCH; }

function normalizeHistory(progress, validGoalIds) {
  return safeArray(progress?.history)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const goalId = safeText(entry.goalId);
      if (!goalId || !validGoalIds.has(goalId)) return null;
      return {
        ...entry,
        goalId,
        title: safeText(entry.title),
        component: safeText(entry.component),
        experience: positiveNumber(entry.experience, 1),
        completedAt: entry.completedAt || entry.markedAt || null,
      };
    })
    .filter(Boolean);
}

export function buildPianoLearningRoute({
  curriculum,
  progress = null,
  canonicalStudentId = "",
} = {}) {
  const template = curriculum?.isPublishedPianoCurriculum
    ? curriculum
    : normalizePublishedPianoCurriculum(curriculum);
  const candidateStudentId = safeText(canonicalStudentId);
  const studentId = /^stu_/i.test(candidateStudentId) ? "" : candidateStudentId;
  if (!template || !template.experiences.length) return null;

  const validGoalIds = new Set(template.goals.map((goal) => goal.id));
  const validProgress = isValidPianoProgress(progress, studentId)
    ? progress
    : null;
  const completed = new Set(
    unique(safeArray(validProgress?.completedGoalIds).map(safeText))
      .filter((goalId) => validGoalIds.has(goalId))
  );

  const goalsWithDone = template.goals.map((goal) => ({
    ...goal,
    done: completed.has(goal.id),
    active: false,
    status: completed.has(goal.id) ? "Logrado" : "Pendiente",
  }));
  const goalsById = new Map(goalsWithDone.map((goal) => [goal.id, goal]));

  let experiences = template.experiences.map((experience) => {
    const goals = experience.goals.map((goal) => goalsById.get(goal.id)).filter(Boolean);
    const done = goals.filter((goal) => goal.done).length;
    return {
      ...experience,
      goals,
      total: goals.length,
      done,
      isDone: goals.length > 0 && done === goals.length,
      isCurrent: false,
    };
  });

  const currentExperience =
    experiences.find((experience) => !experience.isDone) ||
    experiences[experiences.length - 1];
  const activeGoalIds = new Set(
    currentExperience.goals.filter((goal) => !goal.done).map((goal) => goal.id)
  );

  const goals = goalsWithDone.map((goal) => ({
    ...goal,
    active: !goal.done && activeGoalIds.has(goal.id),
    status: goal.done
      ? "Logrado"
      : activeGoalIds.has(goal.id)
        ? "En foco"
        : "Pendiente",
  }));
  const finalGoalsById = new Map(goals.map((goal) => [goal.id, goal]));
  experiences = experiences.map((experience) => ({
    ...experience,
    goals: experience.goals.map((goal) => finalGoalsById.get(goal.id)).filter(Boolean),
    isCurrent: experience.id === currentExperience.id,
  }));

  const components = new Map();
  for (const goal of goals) {
    if (!components.has(goal.component)) components.set(goal.component, []);
    components.get(goal.component).push(goal);
  }
  const blocks = [...components.entries()].map(([component, blockGoals]) => ({
    component,
    label: blockGoals[0]?.componentLabel || componentLabel(component),
    goals: blockGoals,
    total: blockGoals.length,
    done: blockGoals.filter((goal) => goal.done).length,
  }));

  const completedGoals = goals.filter((goal) => goal.done).length;
  const totalGoals = goals.length;
  const progressPct = totalGoals
    ? Math.round((completedGoals / totalGoals) * 100)
    : 0;
  const finalCurrentExperience = experiences.find((experience) => experience.isCurrent);

  return {
    id: studentId ? `${studentId}__${PIANO_ROUTE_TEMPLATE_ID}` : "",
    studentId,
    identityResolved: Boolean(studentId),
    artKey: "piano",
    routeTemplateId: PIANO_ROUTE_TEMPLATE_ID,
    progressEpoch: PIANO_PROGRESS_EPOCH,
    isLearningRoute: true,
    isMapCurriculum: true,
    sourceSystem: "mapa-de-experiencias",
    source: template.source,
    templateRevision: template.revision,
    publishedAt: template.publishedAt,
    sourceUpdatedAt: template.sourceUpdatedAt,

    title: template.routeName,
    routeName: template.routeName,
    processLabel: "Piano",
    description: template.description,
    stage: finalCurrentExperience?.label || "Experiencia I",
    experience: finalCurrentExperience?.order || 1,

    goals,
    blocks,
    experiences,
    currentExperience: finalCurrentExperience,
    totalGoals,
    completedGoals,
    progress: progressPct,

    activeGoalIds: [...activeGoalIds],
    completedGoalIds: [...completed],
    recommendations: safeArray(validProgress?.recommendations),
    history: normalizeHistory(validProgress, validGoalIds),
    milestones: experiences.map((experience) => ({
      experience: experience.order,
      total: experience.total,
      completed: experience.done,
      unlocked: experience.order <= (finalCurrentExperience?.order || 1),
      done: experience.isDone,
    })),
    hasTemplate: true,
    hasProgress: Boolean(validProgress),
  };
}

export function buildGuitarLearningRoute({ curriculum, progress = null, canonicalStudentId = "" } = {}) {
  const normalized = curriculum?.isPublishedGuitarCurriculum ? curriculum : normalizePublishedGuitarCurriculum(curriculum);
  if (!normalized) return null;
  const route = buildPianoLearningRoute({
    curriculum: { ...normalized, isPublishedPianoCurriculum: true, routeTemplateId: PIANO_ROUTE_TEMPLATE_ID, progressEpoch: PIANO_PROGRESS_EPOCH },
    progress: isValidGuitarProgress(progress, canonicalStudentId)
      ? { ...progress, routeTemplateId: PIANO_ROUTE_TEMPLATE_ID, progressEpoch: PIANO_PROGRESS_EPOCH }
      : null,
    canonicalStudentId,
  });
  return route ? { ...route, id: route.studentId ? `${route.studentId}__${GUITAR_ROUTE_TEMPLATE_ID}` : "", artKey: "guitarra", routeTemplateId: GUITAR_ROUTE_TEMPLATE_ID, progressEpoch: GUITAR_PROGRESS_EPOCH, title: normalized.routeName, routeName: normalized.routeName, processLabel: "Guitarra", source: normalized.source, templateRevision: normalized.revision } : null;
}

export function buildViolinLearningRoute({ curriculum, progress = null, canonicalStudentId = "" } = {}) {
  const normalized = curriculum?.isPublishedViolinCurriculum ? curriculum : normalizePublishedViolinCurriculum(curriculum);
  if (!normalized) return null;
  const route = buildPianoLearningRoute({
    curriculum: { ...normalized, isPublishedPianoCurriculum: true, routeTemplateId: PIANO_ROUTE_TEMPLATE_ID, progressEpoch: PIANO_PROGRESS_EPOCH },
    progress: isValidViolinProgress(progress, canonicalStudentId)
      ? { ...progress, routeTemplateId: PIANO_ROUTE_TEMPLATE_ID, progressEpoch: PIANO_PROGRESS_EPOCH }
      : null,
    canonicalStudentId,
  });
  return route ? { ...route, id: route.studentId ? `${route.studentId}__${VIOLIN_ROUTE_TEMPLATE_ID}` : "", artKey: "violin", routeTemplateId: VIOLIN_ROUTE_TEMPLATE_ID, progressEpoch: VIOLIN_PROGRESS_EPOCH, title: normalized.routeName, routeName: normalized.routeName, processLabel: "Violín", source: normalized.source, templateRevision: normalized.revision } : null;
}
export function buildBateriaLearningRoute({ curriculum, progress = null, canonicalStudentId = "" } = {}) {
  const normalized = curriculum?.isPublishedBateriaCurriculum ? curriculum : normalizePublishedBateriaCurriculum(curriculum); if (!normalized) return null;
  const route = buildPianoLearningRoute({ curriculum: { ...normalized, isPublishedPianoCurriculum: true, routeTemplateId: PIANO_ROUTE_TEMPLATE_ID, progressEpoch: PIANO_PROGRESS_EPOCH }, progress: isValidBateriaProgress(progress, canonicalStudentId) ? { ...progress, routeTemplateId: PIANO_ROUTE_TEMPLATE_ID, progressEpoch: PIANO_PROGRESS_EPOCH } : null, canonicalStudentId });
  return route ? { ...route, id: route.studentId ? `${route.studentId}__${BATERIA_ROUTE_TEMPLATE_ID}` : "", artKey: "bateria", routeTemplateId: BATERIA_ROUTE_TEMPLATE_ID, progressEpoch: BATERIA_PROGRESS_EPOCH, title: normalized.routeName, routeName: normalized.routeName, processLabel: "Batería", source: normalized.source, templateRevision: normalized.revision } : null;
}
