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

  Cómo correrlo (necesita Java 11+ para el emulador):
    cd tests/firestore-rules && npm install && npm test
  (el script ejecuta desde la raíz del HUB con firebase.test.json, que
  referencia firestore.rules de la raíz: una sola copia de reglas, sin
  duplicados que puedan divergir)
============================================================================= */

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import {
  collection, query, where, getDocs, getDoc, doc, setDoc, deleteDoc, serverTimestamp,
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
  // Acudiente con DOS hijos (multi-estudiante)
  await setDoc(doc(db, "users/acudiente2@test.com"), {
    role: "acudiente", active: true, studentIds: ["S1", "S2"],
  });
  // Docente operativo y admin (rol en users, no bootstrap)
  await setDoc(doc(db, "users/docente@test.com"), { role: "teacher", active: true });
  await setDoc(doc(db, "users/admin@test.com"), { role: "admin", active: true });
  // Usuario BLOQUEADO por la política de RIP (accountEnabled=false → active=false)
  await setDoc(doc(db, "users/bloqueado@test.com"), {
    role: "student", active: false, accountEnabled: false, canAccessHub: false,
    studentIds: ["S1"], statusSource: "rip-musicala",
  });
  // Usuario en PAUSA CORTA (RIP publica accountEnabled=true → active=true)
  await setDoc(doc(db, "users/pausa@test.com"), {
    role: "student", active: true, accountEnabled: true, canAccessHub: true,
    studentIds: ["S1"], studentStatus: "Inactivo en pausa (1-3 meses)",
    statusSource: "rip-musicala",
  });
  // Docs de estudiantes (S1 propio, S2 del acudiente2, SX ajeno)
  await setDoc(doc(db, "students/S1"), {
    displayName: "Test", documento: "DOC99", studentId: "S1",
    rip: { statusLabel: "Activo", canAccessHub: true, statusVersion: 1 },
  });
  await setDoc(doc(db, "students/S2"), { displayName: "Hermano", studentId: "S2" });
  await setDoc(doc(db, "students/SX"), { displayName: "Ajeno", studentId: "SX" });
  // Bitácoras en los formatos que existen en producción
  await setDoc(doc(db, "bitacoras/b1"), { titulo: "nueva", studentIds: ["S1"] });
  await setDoc(doc(db, "bitacoras/b2"), { titulo: "solo-alias", studentIds: ["DOC99"] });
  await setDoc(doc(db, "bitacoras/b3"), { titulo: "legacy-string", studentId: "S1" });
  await setDoc(doc(db, "bitacoras/b4"), { titulo: "ajena", studentIds: ["OTRO"] });
  // Comentarios y evidencias vinculados / ajenos
  await setDoc(doc(db, "student_comments/c1"), { studentId: "S1", texto: "propio" });
  await setDoc(doc(db, "student_comments/c2"), { studentId: "SX", texto: "ajeno" });
  await setDoc(doc(db, "student_evidence/e1"), { studentId: "S1", url: "x" });
  await setDoc(doc(db, "student_evidence/e2"), { studentId: "SX", url: "y" });
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

/* ── Escenarios de la integración studentId (2026-07-11) ─────────────────── */

const acudiente2 = env
  .authenticatedContext("uid-acu2", { email: "acudiente2@test.com", email_verified: true })
  .firestore();
const docente = env
  .authenticatedContext("uid-doc", { email: "docente@test.com", email_verified: true })
  .firestore();
const admin = env
  .authenticatedContext("uid-adm", { email: "admin@test.com", email_verified: true })
  .firestore();
const bloqueado = env
  .authenticatedContext("uid-blo", { email: "bloqueado@test.com", email_verified: true })
  .firestore();
const pausa = env
  .authenticatedContext("uid-pau", { email: "pausa@test.com", email_verified: true })
  .firestore();

// 10b. Un admin puede vincular y quitar un correo de portal, pero nunca crear
// perfiles internos ni un estudiante puede otorgarse acceso por sí mismo.
await check("admin crea correo vinculado de portal", "ALLOW", async () => {
  await setDoc(doc(admin, "users/familia@test.com"), {
    email: "familia@test.com", role: "acudiente", active: true,
    studentId: "S1", studentIds: ["S1"], portalAccessManaged: true,
    linkedBy: "admin@test.com", linkedAt: new Date(), updatedAt: new Date(),
  });
  return 1;
});
await check("estudiante no puede vincular otro correo", "DENY", async () => {
  await setDoc(doc(student, "users/intruso@test.com"), {
    email: "intruso@test.com", role: "acudiente", active: true,
    studentId: "S1", studentIds: ["S1"], portalAccessManaged: true,
    linkedBy: "estudiante@test.com", linkedAt: new Date(), updatedAt: new Date(),
  });
  return 1;
});
await check("admin no puede crear perfil interno desde vinculos", "DENY", async () => {
  await setDoc(doc(admin, "users/interno@test.com"), {
    email: "interno@test.com", role: "admin", active: true,
    studentId: "S1", studentIds: ["S1"], portalAccessManaged: true,
    linkedBy: "admin@test.com", linkedAt: new Date(), updatedAt: new Date(),
  });
  return 1;
});
await check("admin quita correo vinculado de portal", "ALLOW", async () => {
  await deleteDoc(doc(admin, "users/familia@test.com"));
  return 1;
});
await check("admin agrega estudiante a acudiente existente", "ALLOW", async () => {
  await setDoc(doc(admin, "users/acudiente2@test.com"), {
    studentIds: ["S1", "S2", "SX"], updatedAt: serverTimestamp(),
  }, { merge: true });
  return 1;
});
// 11. Estudiante NO lee otro perfil aunque conozca su ID
await check("get students/SX (ID ajeno)", "DENY", async () => {
  const snap = await getDoc(doc(student, "students/SX"));
  return snap.exists() ? 1 : 0;
});

// 12-13. Comentarios: propio sí, ajeno no
await check("get student_comments/c1 propio", "ALLOW", async () => {
  const snap = await getDoc(doc(student, "student_comments/c1"));
  return snap.exists() ? 1 : 0;
});
await check("get student_comments/c2 ajeno", "DENY", async () => {
  const snap = await getDoc(doc(student, "student_comments/c2"));
  return snap.exists() ? 1 : 0;
});

// 14-15. Evidencias: propia sí, ajena no
await check("get student_evidence/e1 propia", "ALLOW", async () => {
  const snap = await getDoc(doc(student, "student_evidence/e1"));
  return snap.exists() ? 1 : 0;
});
await check("get student_evidence/e2 ajena", "DENY", async () => {
  const snap = await getDoc(doc(student, "student_evidence/e2"));
  return snap.exists() ? 1 : 0;
});

// 16-17. Crear comentario/evidencia exige studentId autorizado
await check("create comentario con studentId propio", "ALLOW", async () => {
  await setDoc(doc(student, "student_comments/nuevo1"), { studentId: "S1", texto: "hola" });
  return 1;
});
await check("create comentario con studentId AJENO", "DENY", async () => {
  await setDoc(doc(student, "student_comments/nuevo2"), { studentId: "SX", texto: "no" });
  return 1;
});

// 18-19. Acudiente con dos hijos lee ambos
await check("acudiente2 get students/S1", "ALLOW", async () => {
  const snap = await getDoc(doc(acudiente2, "students/S1"));
  return snap.exists() ? 1 : 0;
});
await check("acudiente2 get students/S2", "ALLOW", async () => {
  const snap = await getDoc(doc(acudiente2, "students/S2"));
  return snap.exists() ? 1 : 0;
});

// 20-21. Docente mantiene acceso operativo (lee estudiantes y crea bitácoras)
await check("docente get students/SX", "ALLOW", async () => {
  const snap = await getDoc(doc(docente, "students/SX"));
  return snap.exists() ? 1 : 0;
});
await check("docente create bitacora", "ALLOW", async () => {
  await setDoc(doc(docente, "bitacoras/nueva-docente"), {
    titulo: "clase", studentIds: ["S1"], studentId: "S1",
  });
  return 1;
});

// 22-23. Ni siquiera un ADMIN (cliente) cambia studentId ni toca el mapa rip
await check("admin actualiza un campo pedagógico permitido", "ALLOW", async () => {
  await setDoc(doc(admin, "students/S1"), {
    modalidad: "Virtual",
    modality: "Virtual",
    updatedBy: "admin@test.com",
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return 1;
});
await check("admin cambia studentId (inmutable)", "DENY", async () => {
  await setDoc(doc(admin, "students/S1"), { studentId: "S2" }, { merge: true });
  return 1;
});
await check("admin modifica mapa rip (solo Admin SDK)", "DENY", async () => {
  await setDoc(doc(admin, "students/S1"), { rip: { statusLabel: "hack" } }, { merge: true });
  return 1;
});

// 24. Estudiante tampoco puede escribir students/
await check("estudiante update students/S1", "DENY", async () => {
  await setDoc(doc(student, "students/S1"), { displayName: "Hack" }, { merge: true });
  return 1;
});

// 25. Usuario BLOQUEADO (active=false por RIP) no accede
await check("bloqueado get students/S1", "DENY", async () => {
  const snap = await getDoc(doc(bloqueado, "students/S1"));
  return snap.exists() ? 1 : 0;
});
await check("bloqueado lee bitácoras", "DENY", async () => {
  const snap = await getDocs(query(bitacoras(bloqueado),
    where("studentIds", "array-contains", "S1")));
  return snap.size;
});

// 26. Usuario en PAUSA CORTA sí accede
await check("pausa corta get students/S1", "ALLOW", async () => {
  const snap = await getDoc(doc(pausa, "students/S1"));
  return snap.exists() ? 1 : 0;
});
await check("pausa corta lee bitácoras", "ALLOW", async () => {
  const snap = await getDocs(query(bitacoras(pausa),
    where("studentIds", "array-contains", "S1")));
  return snap.size;
});

await env.cleanup();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  →  esperado ${r.expected}, obtuvo ${r.outcome}`);
}
console.log(failed ? `\n${failed} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(failed ? 1 : 0);
