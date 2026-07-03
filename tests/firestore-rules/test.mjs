/* =============================================================================
  Test de reglas de Firestore — Estudiantes HUB

  Verifica, contra el emulador, que un estudiante/acudiente puede leer SUS
  bitácoras con las consultas exactas que hace la app, y que lo ajeno se
  niega con permission-denied.

  Por qué existe: en 2026-07-02/03 las reglas eran tan costosas de evaluar
  (ternarios anidados con get()/exists() repetidos) que el motor agotaba su
  límite de ~1000 expresiones en consultas 'list' y NEGABA TODO a los
  estudiantes, aunque la lógica fuera correcta. Este test detecta tanto
  errores de lógica como esa explosión de costo.

  Cómo correrlo (necesita Java para el emulador):
    cd tests/firestore-rules
    npm install
    npx firebase-tools emulators:exec --only firestore --project bitacoras-de-clase "node test.mjs"
============================================================================= */

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import {
  collection, query, where, getDocs, getDoc, doc, setDoc,
} from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "bitacoras-de-clase",
  firestore: {
    rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
    host: "127.0.0.1",
    port: 8975,
  },
});

// ── Datos de prueba (se escriben sin reglas) ────────────────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // Perfil estudiante: SOLO conoce la llave S1 (como los users/{correo} reales)
  await setDoc(doc(db, "users/estudiante@test.com"), {
    role: "student", active: true, studentIds: ["S1"],
  });
  // Acudiente con studentId string (sin lista)
  await setDoc(doc(db, "users/acudiente@test.com"), {
    role: "acudiente", active: true, studentId: "S1",
  });
  // Doc del estudiante con alias extra (documento de identidad)
  await setDoc(doc(db, "students/S1"), { displayName: "Test", documento: "DOC99" });
  // Bitácoras en los formatos que existen en producción
  await setDoc(doc(db, "bitacoras/b1"), { titulo: "nueva", studentIds: ["S1"] });
  await setDoc(doc(db, "bitacoras/b2"), { titulo: "solo-alias", studentIds: ["DOC99"] });
  await setDoc(doc(db, "bitacoras/b3"), { titulo: "legacy-string", studentId: "S1" });
  await setDoc(doc(db, "bitacoras/b4"), { titulo: "ajena", studentIds: ["OTRO"] });
});

const results = [];
async function check(name, expected, fn) {
  let outcome;
  try {
    const value = await fn();
    outcome = `ALLOW(${value})`;
  } catch (error) {
    const code = String(error?.code || "");
    const msg = String(error?.message || error);
    outcome = code.includes("permission-denied") || /permission|insufficient/i.test(msg)
      ? "DENY"
      : `ERROR code=[${code}] msg=[${msg.slice(0, 160)}]`;
  }
  const ok = outcome === expected || outcome.startsWith(expected);
  results.push({ name, expected, outcome, ok });
}

const student = env
  .authenticatedContext("uid-est", { email: "estudiante@test.com", email_verified: true })
  .firestore();
const acudiente = env
  .authenticatedContext("uid-acu", { email: "acudiente@test.com", email_verified: true })
  .firestore();
const bitacoras = (db) => collection(db, "bitacoras");

// 1. Consulta agrupada con alias NO vinculados: debe negarse (no romperse)
await check("array-contains-any [S1, DOC99, student:key]", "DENY", async () => {
  const snap = await getDocs(query(bitacoras(student),
    where("studentIds", "array-contains-any", ["S1", "DOC99", "student:test:sin-correo"])));
  return snap.size;
});

// 2. Consulta agrupada SOLO con llaves vinculadas
await check("array-contains-any [S1]", "ALLOW", async () => {
  const snap = await getDocs(query(bitacoras(student),
    where("studentIds", "array-contains-any", ["S1"])));
  return snap.size;
});

// 3. Fallback de la app: array-contains por alias vinculado
await check("array-contains S1", "ALLOW", async () => {
  const snap = await getDocs(query(bitacoras(student),
    where("studentIds", "array-contains", "S1")));
  return snap.size;
});

// 4. array-contains por alias NO vinculado: negado limpio
await check("array-contains DOC99", "DENY", async () => {
  const snap = await getDocs(query(bitacoras(student),
    where("studentIds", "array-contains", "DOC99")));
  return snap.size;
});

// 5. Fallback legacy: igualdad por studentId string
await check("studentId == S1 (legacy)", "ALLOW", async () => {
  const snap = await getDocs(query(bitacoras(student),
    where("studentId", "==", "S1")));
  return snap.size;
});

// 6. Lectura directa de una bitácora propia (modal "Ver")
await check("get bitacoras/b1 propia", "ALLOW", async () => {
  const snap = await getDoc(doc(student, "bitacoras/b1"));
  return snap.exists() ? 1 : 0;
});

// 7. Lectura directa de bitácora ajena
await check("get bitacoras/b4 ajena", "DENY", async () => {
  const snap = await getDoc(doc(student, "bitacoras/b4"));
  return snap.exists() ? 1 : 0;
});

// 8. Acudiente con studentId string en su perfil
await check("acudiente array-contains S1", "ALLOW", async () => {
  const snap = await getDocs(query(bitacoras(acudiente),
    where("studentIds", "array-contains", "S1")));
  return snap.size;
});

// 9. Acudiente + legacy
await check("acudiente studentId == S1", "ALLOW", async () => {
  const snap = await getDocs(query(bitacoras(acudiente),
    where("studentId", "==", "S1")));
  return snap.size;
});

// 10. El estudiante puede leer su propio doc students/{id}
await check("get students/S1", "ALLOW", async () => {
  const snap = await getDoc(doc(student, "students/S1"));
  return snap.exists() ? 1 : 0;
});

await env.cleanup();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  →  esperado ${r.expected}, obtuvo ${r.outcome}`);
}
console.log(failed ? `\n${failed} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(failed ? 1 : 0);
