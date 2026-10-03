import test from "node:test";
import assert from "node:assert/strict";

import {
  PIANO_PROGRESS_EPOCH,
  PIANO_ROUTE_TEMPLATE_ID,
  buildPianoLearningRoute,
  buildBateriaLearningRoute,
  buildViolinLearningRoute,
  getPianoCanonicalStudentId,
  getPianoProgressDocumentId,
  isPianoCurriculumStudent,
  isBateriaCurriculumStudent,
  isViolinCurriculumStudent,
  normalizePublishedPianoCurriculum,
  normalizePublishedBateriaCurriculum,
  normalizePublishedViolinCurriculum,
} from "../src/curriculum.js";

const RAW_CURRICULUM = {
  schemaVersion: 1,
  routeKey: "piano",
  revision: `sha256:${"a".repeat(64)}`,
  source: {
    projectId: "mapa-de-experiencias",
    artId: "art-piano",
    routeId: "route-piano",
    slug: "piano",
  },
  route: {
    name: "Piano",
    description: "Ruta publicada de Piano.",
  },
  experienceCount: 2,
  goalCount: 3,
  experiences: [
    {
      id: "exp-i",
      order: 1,
      label: "Experiencia I",
      name: "Primer encuentro",
      objective: "Reconocer el instrumento y producir los primeros sonidos.",
      evidence: "Interpreta una secuencia breve con postura consciente.",
      personalRepertoire: {
        title: "Mi canción",
        focus: "Elegir una melodía significativa.",
        evidence: "Toca un fragmento reconocible.",
      },
      skills: [
        {
          id: "skill-postura",
          goalId: "exp-i:skill-postura",
          component: "tecnica",
          title: "Postura inicial",
          achievement: "Ubica el cuerpo y las manos con comodidad.",
        },
        {
          id: "skill-pulso",
          goalId: "exp-i:skill-pulso",
          component: "teorico",
          title: "Pulso estable",
          achievement: "Mantiene un pulso sencillo.",
        },
      ],
    },
    {
      id: "exp-ii",
      order: 2,
      label: "Experiencia II",
      name: "Cinco notas",
      objective: "Conectar cinco notas consecutivas.",
      evidence: "Interpreta un patrón de cinco notas.",
      skills: [
        {
          id: "skill-cinco-notas",
          goalId: "exp-ii:skill-cinco-notas",
          component: "repertorio",
          title: "Patrón de cinco notas",
          achievement: "Toca cinco notas de manera continua.",
        },
      ],
    },
  ],
};

function invalidCurriculum(change) {
  const value = structuredClone(RAW_CURRICULUM);
  change(value);
  return value;
}

test("detecta Piano solo en el proceso activo o resuelto", () => {
  assert.equal(isPianoCurriculumStudent({
    processes: [
      { processKey: "canto", detalle: "Canto", active: false },
      { processKey: "piano", detalle: "Piano", active: true },
    ],
  }), true);
  assert.equal(isPianoCurriculumStudent({
    processes: [
      { processKey: "piano-historico", detalle: "Piano", estado: "inactivo" },
      { processKey: "guitarra-actual", detalle: "Guitarra", estado: "activo" },
    ],
  }), false);
  assert.equal(isPianoCurriculumStudent({
    currentProcessKey: "guitarra-actual",
    instrumento: "Piano",
    processes: [
      { processKey: "piano-historico", detalle: "Piano" },
      { processKey: "guitarra-actual", detalle: "Guitarra" },
    ],
  }), false);
  assert.equal(isPianoCurriculumStudent({ instrumento: "Teclado" }), true);
  assert.equal(isPianoCurriculumStudent({ instrumento: "Guitarra" }), false);
});

test("detecta y construye Violín desde un currículo publicado flexible", () => {
  const violin = {
    ...structuredClone(RAW_CURRICULUM),
    routeKey: "violin",
    source: { ...RAW_CURRICULUM.source, slug: "violin" },
    route: { ...RAW_CURRICULUM.route, name: "Violín" },
  };
  assert.equal(isViolinCurriculumStudent({ instrumento: "Violín" }), true);
  const curriculum = normalizePublishedViolinCurriculum(violin);
  assert.ok(curriculum);
  assert.equal(curriculum.experienceCount, 2);
  assert.equal(buildViolinLearningRoute({ curriculum }).experiences.length, 2);
});

test("detecta y construye Batería desde un currículo publicado flexible", () => {
  const bateria = {
    ...structuredClone(RAW_CURRICULUM),
    routeKey: "bateria",
    source: { ...RAW_CURRICULUM.source, slug: "bateria" },
    route: { ...RAW_CURRICULUM.route, name: "Batería" },
  };
  assert.equal(isBateriaCurriculumStudent({ instrumento: "Batería" }), true);
  const curriculum = normalizePublishedBateriaCurriculum(bateria);
  assert.ok(curriculum);
  assert.equal(curriculum.experienceCount, 2);
  assert.equal(buildBateriaLearningRoute({ curriculum }).experiences.length, 2);
});

test("solo acepta un canonicalStudentId explícito, no stu_ ni identidad pendiente", () => {
  assert.equal(getPianoCanonicalStudentId({
    canonicalStudentId: "CANON-1",
    identityResolutionStatus: "resolved",
  }), "CANON-1");
  assert.equal(getPianoCanonicalStudentId({
    canonicalStudentId: "stu_legacy",
    identityResolutionStatus: "single",
  }), "");
  assert.equal(getPianoCanonicalStudentId({
    canonicalStudentId: "CANON-2",
    identityResolutionStatus: "Pendiente de revisión",
  }), "");
  assert.equal(getPianoCanonicalStudentId({ studentKey: "CANON-3" }), "");
  assert.equal(getPianoProgressDocumentId({
    canonicalStudentId: "CANON-1",
    identityResolutionStatus: "resolved",
  }), "CANON-1__mapa-piano");
  assert.equal(getPianoProgressDocumentId({
    canonicalStudentId: "stu_legacy",
  }), "");
});

test("normaliza el snapshot con IDs estables experiencia:saber", () => {
  const curriculum = normalizePublishedPianoCurriculum(RAW_CURRICULUM);
  assert.ok(curriculum);
  assert.equal(curriculum.routeTemplateId, PIANO_ROUTE_TEMPLATE_ID);
  assert.equal(curriculum.experiences.length, 2);
  assert.deepEqual(
    curriculum.goals.map((goal) => goal.id),
    [
      "exp-i:skill-postura",
      "exp-i:skill-pulso",
      "exp-ii:skill-cinco-notas",
    ]
  );
  assert.equal(curriculum.experiences[0].objective, RAW_CURRICULUM.experiences[0].objective);
  assert.equal(curriculum.experiences[0].evidence, RAW_CURRICULUM.experiences[0].evidence);
});

test("rechaza metadatos publicados incompatibles", () => {
  const invalidCases = [
    invalidCurriculum((value) => { value.schemaVersion = 2; }),
    invalidCurriculum((value) => { value.schemaVersion = "1"; }),
    invalidCurriculum((value) => { delete value.schemaVersion; }),
    invalidCurriculum((value) => { value.revision = "sha256:invalida"; }),
    invalidCurriculum((value) => { value.routeKey = "guitarra"; }),
    invalidCurriculum((value) => { value.source.projectId = "otro-proyecto"; }),
    invalidCurriculum((value) => { value.source.slug = "guitarra"; }),
    invalidCurriculum((value) => { delete value.experienceCount; }),
    invalidCurriculum((value) => { value.experienceCount = 3; }),
    invalidCurriculum((value) => { value.experienceCount = "2"; }),
    invalidCurriculum((value) => { delete value.goalCount; }),
    invalidCurriculum((value) => { value.goalCount = 4; }),
    invalidCurriculum((value) => { value.goalCount = "3"; }),
  ];

  invalidCases.forEach((value) => {
    assert.equal(normalizePublishedPianoCurriculum(value), null);
  });
});

test("rechaza experiencias y metas sin identidad o contenido estable", () => {
  const invalidCases = [
    invalidCurriculum((value) => { value.experiences[1].id = value.experiences[0].id; }),
    invalidCurriculum((value) => { value.experiences[1].order = 1; }),
    invalidCurriculum((value) => { value.experiences[1].order = 3; }),
    invalidCurriculum((value) => { value.experiences[1].order = "2"; }),
    invalidCurriculum((value) => { value.experiences[0].objective = ""; }),
    invalidCurriculum((value) => { value.experiences[0].evidence = ""; }),
    invalidCurriculum((value) => { value.experiences[0].skills = []; value.goalCount = 1; }),
    invalidCurriculum((value) => { value.experiences[0].skills[0].id = ""; }),
    invalidCurriculum((value) => { value.experiences[0].skills[0].title = ""; }),
    invalidCurriculum((value) => { value.experiences[0].skills[0].goalId = "adulterado"; }),
    invalidCurriculum((value) => {
      value.experiences[0].skills.push(structuredClone(value.experiences[0].skills[0]));
      value.goalCount += 1;
    }),
  ];

  invalidCases.forEach((value) => {
    assert.equal(normalizePublishedPianoCurriculum(value), null);
  });
});

test("sin progreso válido comienza en cero y enfoca la Experiencia I", () => {
  const learning = buildPianoLearningRoute({
    curriculum: RAW_CURRICULUM,
    canonicalStudentId: "CANON-1",
  });

  assert.equal(learning.progress, 0);
  assert.equal(learning.completedGoals, 0);
  assert.equal(learning.stage, "Experiencia I");
  assert.equal(learning.currentExperience.id, "exp-i");
  assert.deepEqual(
    learning.goals.filter((goal) => goal.active).map((goal) => goal.id),
    ["exp-i:skill-postura", "exp-i:skill-pulso"]
  );
  assert.equal(learning.hasProgress, false);
});

test("sin identidad canónica resuelta muestra la ruta en cero sin inventar un ID", () => {
  const learning = buildPianoLearningRoute({ curriculum: RAW_CURRICULUM });

  assert.equal(learning.id, "");
  assert.equal(learning.studentId, "");
  assert.equal(learning.identityResolved, false);
  assert.equal(learning.progress, 0);
  assert.equal(learning.currentExperience.id, "exp-i");

  const legacyLearning = buildPianoLearningRoute({
    curriculum: RAW_CURRICULUM,
    canonicalStudentId: "stu_legacy",
  });
  assert.equal(legacyLearning.id, "");
  assert.equal(legacyLearning.identityResolved, false);
});

test("ignora por completo progreso de prueba con epoch anterior", () => {
  const learning = buildPianoLearningRoute({
    curriculum: RAW_CURRICULUM,
    canonicalStudentId: "CANON-1",
    progress: {
      studentId: "CANON-1",
      studentKey: "CANON-1",
      routeTemplateId: PIANO_ROUTE_TEMPLATE_ID,
      progressEpoch: "prueba-anterior",
      completedGoalIds: ["exp-i:skill-postura", "exp-i:skill-pulso"],
    },
  });

  assert.equal(learning.progress, 0);
  assert.deepEqual(learning.completedGoalIds, []);
  assert.equal(learning.currentExperience.id, "exp-i");
});

test("acepta solo progreso canónico del epoch vigente y avanza de experiencia", () => {
  const learning = buildPianoLearningRoute({
    curriculum: RAW_CURRICULUM,
    canonicalStudentId: "CANON-1",
    progress: {
      studentId: "CANON-1",
      studentKey: "CANON-1",
      routeTemplateId: PIANO_ROUTE_TEMPLATE_ID,
      progressEpoch: PIANO_PROGRESS_EPOCH,
      completedGoalIds: ["exp-i:skill-postura", "exp-i:skill-pulso"],
      history: [
        {
          goalId: "exp-i:skill-postura",
          title: "Postura inicial",
          completedAt: "2026-08-15T12:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(learning.progress, 67);
  assert.equal(learning.completedGoals, 2);
  assert.equal(learning.currentExperience.id, "exp-ii");
  assert.deepEqual(
    learning.goals.filter((goal) => goal.active).map((goal) => goal.id),
    ["exp-ii:skill-cinco-notas"]
  );
  assert.equal(learning.hasProgress, true);
  assert.equal(learning.history.length, 1);
});

test("un documento de otro studentId no puede alterar el avance", () => {
  const learning = buildPianoLearningRoute({
    curriculum: RAW_CURRICULUM,
    canonicalStudentId: "CANON-1",
    progress: {
      studentId: "ALIAS-1",
      studentKey: "ALIAS-1",
      routeTemplateId: PIANO_ROUTE_TEMPLATE_ID,
      progressEpoch: PIANO_PROGRESS_EPOCH,
      completedGoalIds: ["exp-i:skill-postura"],
    },
  });

  assert.equal(learning.progress, 0);
  assert.equal(learning.hasProgress, false);
});

test("un studentKey alias tampoco puede alterar el avance canónico", () => {
  const learning = buildPianoLearningRoute({
    curriculum: RAW_CURRICULUM,
    canonicalStudentId: "CANON-1",
    progress: {
      studentId: "CANON-1",
      studentKey: "ALIAS-1",
      routeTemplateId: PIANO_ROUTE_TEMPLATE_ID,
      progressEpoch: PIANO_PROGRESS_EPOCH,
      completedGoalIds: ["exp-i:skill-postura", "exp-i:skill-pulso"],
    },
  });

  assert.equal(learning.progress, 0);
  assert.equal(learning.completedGoals, 0);
  assert.equal(learning.hasProgress, false);
  assert.equal(learning.currentExperience.id, "exp-i");
});
