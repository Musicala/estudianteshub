import test from "node:test";
import assert from "node:assert/strict";

import { buildPianoLearningRoute } from "../src/curriculum.js";
import { renderRoute } from "../src/views.js";

const STUDENT = {
  id: "CANON-1",
  studentId: "CANON-1",
  canonicalStudentId: "CANON-1",
  identityResolutionStatus: "resolved",
  nombre: "Estudiante Piano",
  processes: [
    { processKey: "piano", detalle: "Piano", active: true },
  ],
};

const CURRICULUM = {
  schemaVersion: 1,
  routeKey: "piano",
  revision: `sha256:${"b".repeat(64)}`,
  source: {
    projectId: "mapa-de-experiencias",
    slug: "piano",
  },
  route: { name: "Piano", description: "Ruta oficial." },
  experienceCount: 1,
  goalCount: 1,
  experiences: [
    {
      id: "exp-i",
      order: 1,
      label: "Experiencia I",
      name: "Primer encuentro",
      objective: "Reconocer el piano y producir los primeros sonidos.",
      evidence: "Interpreta una secuencia breve con postura consciente.",
      skills: [
        {
          id: "skill-postura",
          goalId: "exp-i:skill-postura",
          component: "tecnica",
          title: "Postura inicial",
          achievement: "Ubica el cuerpo y las manos con comodidad.",
        },
      ],
    },
  ],
};

function routeDeps(api = {}) {
  return {
    ctx: {
      user: { uid: "user-1" },
      studentId: STUDENT.canonicalStudentId,
      student: STUDENT,
    },
    api: {
      isPianoCurriculumStudent: () => true,
      ...api,
    },
  };
}

test("la vista de Piano muestra experiencia, objetivo y evidencia actuales desde cero", async () => {
  const learning = buildPianoLearningRoute({
    curriculum: CURRICULUM,
    canonicalStudentId: STUDENT.canonicalStudentId,
  });
  const output = await renderRoute("route", routeDeps({
    getStudentLearningRoute: async () => learning,
  }));
  const html = typeof output === "string" ? output : output?.html || "";

  assert.match(html, /Experiencia I/);
  assert.match(html, /Primer encuentro/);
  assert.match(html, /Reconocer el piano/);
  assert.match(html, /Evidencia esperada/);
  assert.match(html, /Interpreta una secuencia breve/);
  assert.match(html, /Postura inicial/);
  assert.match(html, />0%?</);
});

test("si falla Mapa, Piano no consulta ni muestra rutas heredadas", async () => {
  let legacyReads = 0;
  const output = await renderRoute("route", routeDeps({
    getStudentLearningRoute: async () => null,
    getStudentRoutes: async () => {
      legacyReads += 1;
      return [{ title: "Ruta de prueba anterior" }];
    },
    getStudentRoute: async () => {
      legacyReads += 1;
      return { title: "Ruta de prueba anterior" };
    },
  }));
  const html = typeof output === "string" ? output : output?.html || "";

  assert.equal(legacyReads, 0);
  assert.match(html, /Ruta de Piano no disponible/);
  assert.doesNotMatch(html, /Ruta de prueba anterior/);
});
