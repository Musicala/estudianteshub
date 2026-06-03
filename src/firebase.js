"use strict";

/* =============================================================================
  src/firebase.js — Estudiantes HUB · Musicala
  Inicialización única de Firebase

  Responsabilidades:
  - Importar configuración desde config.js
  - Inicializar Firebase una sola vez
  - Exportar singletons: app, auth, db, storage
  - Validar configuración básica
  - Mantener compatibilidad con módulos existentes

  Importante:
  Este archivo NO define permisos.
  La seguridad real vive en firestore.rules.
============================================================================= */

import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getStorage,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import {
  CONFIG,
  FIREBASE_CONFIG,
  firebaseConfig,
  assertFirebaseConfig,
} from "./config.js";

/* =============================================================================
  Validación
============================================================================= */

function assertValidRuntimeConfig(config) {
  assertFirebaseConfig(config);

  const expectedProjectId = "bitacoras-de-clase";

  if (config.projectId !== expectedProjectId) {
    console.warn(
      `[firebase] Este portal debería apuntar a "${expectedProjectId}", pero está apuntando a "${config.projectId}". Revisa src/config.js.`
    );
  }

  return true;
}

assertValidRuntimeConfig(FIREBASE_CONFIG);

/* =============================================================================
  Inicialización singleton
============================================================================= */

function initFirebaseApp() {
  const apps = getApps();

  if (apps.length > 0) {
    return getApp();
  }

  return initializeApp(FIREBASE_CONFIG);
}

export const app = initFirebaseApp();

/* =============================================================================
  Servicios singleton
============================================================================= */

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* =============================================================================
  Compatibilidad
============================================================================= */

/*
  Algunas partes antiguas pueden importar firebaseApp o firebase.
  Dejamos alias para no romper módulos mientras hacemos la migración.
*/

export const firebaseApp = app;

export const services = Object.freeze({
  app,
  auth,
  db,
  storage,
});

export const firebase = Object.freeze({
  app,
  auth,
  db,
  storage,
  config: firebaseConfig,
});

/* =============================================================================
  Helpers públicos
============================================================================= */

export function getFirebaseApp() {
  return app;
}

export function getFirebaseAuth() {
  return auth;
}

export function getFirebaseDb() {
  return db;
}

export function getFirebaseStorage() {
  return storage;
}

export function getFirebaseProjectId() {
  return FIREBASE_CONFIG.projectId;
}

export function isFirebaseReady() {
  return Boolean(app && auth && db);
}

/* =============================================================================
  Debug
============================================================================= */

function logFirebaseSummary() {
  const debugEnabled =
    Boolean(CONFIG?.debug) ||
    Boolean(window?.__MUSICALA_DEBUG__);

  if (!debugEnabled) return;

  console.info("[firebase] Inicializado", {
    appName: app.name,
    projectId: FIREBASE_CONFIG.projectId,
    authDomain: FIREBASE_CONFIG.authDomain,
    storageBucket: FIREBASE_CONFIG.storageBucket,
    services: {
      auth: Boolean(auth),
      firestore: Boolean(db),
      storage: Boolean(storage),
    },
  });
}

try {
  logFirebaseSummary();
} catch (error) {
  console.warn("[firebase] No se pudo imprimir debug:", error);
}