import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";

const CANONICAL_ID = "andres@example.com";
const ACADEMIC_ID = "stu_andres_example_1";

const env = await initializeTestEnvironment({
  projectId: "bitacoras-de-clase",
  firestore: {
    rules: readFileSync(
      new URL(
        "../../../Bitácoras de clase/firebase rules/firestore.rules",
        import.meta.url
      ),
      "utf8"
    ),
    host: "127.0.0.1",
    port: 8975,
  },
});

try {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, "users/meraki@example.com"), {
      role: "acudiente",
      active: true,
      studentId: CANONICAL_ID,
      studentIds: [CANONICAL_ID],
    });

    await setDoc(doc(db, "users", CANONICAL_ID), {
      role: "student",
      active: true,
      studentId: CANONICAL_ID,
      studentIds: [CANONICAL_ID],
    });

    await setDoc(doc(db, "users/other@example.com"), {
      role: "acudiente",
      active: true,
      studentId: "unrelated@example.com",
      studentIds: ["unrelated@example.com"],
    });

    // El canónico no declara enlaces hacia adelante: este es el caso que debe
    // seguir resolviendo el HUB mediante la relación inversa canonicalStudentId.
    await setDoc(doc(db, "students", CANONICAL_ID), {
      studentId: CANONICAL_ID,
      canonicalStudentId: CANONICAL_ID,
      nombre: "Andrés Ejemplo",
    });

    await setDoc(doc(db, "students", ACADEMIC_ID), {
      studentId: ACADEMIC_ID,
      canonicalStudentId: CANONICAL_ID,
      identityLinkStatus: "confirmed",
      nombre: "Andrés Ejemplo",
      repertorioEscogido: ["Basket Case"],
      repertorioProceso: [{ nombre: "Basket Case", estado: "proceso" }],
    });

    await setDoc(doc(db, "students/unrelated@example.com"), {
      studentId: "unrelated@example.com",
      canonicalStudentId: "unrelated@example.com",
      nombre: "Otro estudiante",
    });
  });

  const meraki = env.authenticatedContext("uid-meraki", {
    email: "meraki@example.com",
    email_verified: true,
  }).firestore();

  const canonical = await getDoc(doc(meraki, "students", CANONICAL_ID));
  if (!canonical.exists()) {
    throw new Error("No se pudo leer el documento canónico autorizado.");
  }

  const readAliasIds = async (db) => {
    const aliases = await getDocs(query(
      collection(db, "students"),
      // Es la forma exacta usada por getStudentsByIds para soportar acudientes
      // con más de un estudiante sin disparar una consulta por cada hijo.
      where("canonicalStudentId", "in", [CANONICAL_ID])
    ));
    return aliases.docs.map((item) => item.id).sort();
  };

  const aliasIds = await readAliasIds(meraki);
  if (aliasIds.length !== 2 || !aliasIds.includes(ACADEMIC_ID)) {
    throw new Error(`La consulta inversa devolvió: ${JSON.stringify(aliasIds)}`);
  }

  const principal = env.authenticatedContext("uid-principal", {
    email: CANONICAL_ID,
    email_verified: true,
  }).firestore();
  const principalAliasIds = await readAliasIds(principal);
  if (JSON.stringify(principalAliasIds) !== JSON.stringify(aliasIds)) {
    throw new Error("El correo principal y el acudiente no ven la misma identidad.");
  }

  const outsider = env.authenticatedContext("uid-other", {
    email: "other@example.com",
    email_verified: true,
  }).firestore();
  let outsiderDenied = false;
  try {
    await readAliasIds(outsider);
  } catch (error) {
    outsiderDenied = String(error?.code || "").includes("permission-denied");
  }
  if (!outsiderDenied) {
    throw new Error("Un acudiente ajeno pudo consultar los aliases de Andrés.");
  }

  console.log("PASS canonicalStudentId query principal/acudiente", aliasIds);
  console.log("PASS canonicalStudentId query niega acudiente ajeno");
} finally {
  await env.cleanup();
}
