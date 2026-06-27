"use strict";

/* =============================================================================
  src/auth.js — Estudiantes HUB · Musicala
  Firebase Auth con Google
  - initAuth(onUser)
  - loginGoogle(options?)
  - logout()
  - getCurrentUser()
  - waitForAuthReady()
  - humanAuthError(err)

  Nota importante:
  Este archivo SOLO maneja autenticación.
  La validación de permisos y lectura de users/{email} vive en data.js/app.js.
============================================================================= */

import { app } from "./firebase.js";

import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

/* =============================================================================
  Instancia única
============================================================================= */

export const auth = getAuth(app);

/* =============================================================================
  Provider Google
============================================================================= */

const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
});

/*
  Scopes mínimos.
  No pedimos Drive, Calendar ni cosas raras porque este portal solo necesita
  identificar al usuario. Menos permisos, menos drama. Qué concepto tan exótico.
*/
googleProvider.addScope("email");
googleProvider.addScope("profile");

/* =============================================================================
  Estado interno
============================================================================= */

let loginInFlight = null;
let logoutInFlight = null;
let authReadyPromise = null;
let redirectChecked = false;

/* =============================================================================
  Helpers internos
============================================================================= */

function normalizePersistenceMode(mode = "local") {
  const value = String(mode || "local").trim().toLowerCase();

  if (value === "session" || value === "temporary") {
    return browserSessionPersistence;
  }

  return browserLocalPersistence;
}

/*
  iPhone/iPad: los popups de Google son poco fiables, sobre todo cuando la app
  está instalada en la pantalla de inicio (modo standalone). En esos casos el
  login por popup se queda a medias y el usuario vuelve a la pantalla de inicio
  de sesión (el "bucle"). Por eso, en iOS preferimos el flujo por redirect.
*/
function isIOSDevice() {
  const ua = navigator.userAgent || "";
  const iOSUA = /iphone|ipad|ipod/i.test(ua);
  // iPadOS moderno se reporta como Mac con pantalla táctil.
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return (iOSUA || iPadOS) && !window.MSStream;
}

function shouldPreferRedirect() {
  // En iOS siempre redirect; el popup es el que genera el bucle.
  return isIOSDevice();
}

function isPopupProblem(error) {
  const code = String(error?.code || "");

  return (
    code.includes("auth/popup-blocked") ||
    code.includes("auth/popup-closed-by-user") ||
    code.includes("auth/cancelled-popup-request") ||
    code.includes("auth/web-storage-unsupported")
  );
}

function shouldFallbackToRedirect(error) {
  const code = String(error?.code || "");

  return (
    code.includes("auth/popup-blocked") ||
    code.includes("auth/web-storage-unsupported")
  );
}

function createGoogleProvider(options = {}) {
  const provider = new GoogleAuthProvider();

  provider.addScope("email");
  provider.addScope("profile");

  const {
    forceAccountPicker = false,
    prompt = "select_account",
    loginHint = "",
  } = options || {};

  const params = {
    prompt: forceAccountPicker ? "select_account" : prompt,
  };

  if (loginHint) {
    params.login_hint = String(loginHint).trim();
  }

  provider.setCustomParameters(params);

  return provider;
}

async function applyPersistence(options = {}) {
  const persistence = normalizePersistenceMode(options.persistence || "local");

  try {
    await setPersistence(auth, persistence);
  } catch (error) {
    console.warn("[auth] No se pudo configurar persistencia:", error);
  }
}

/* =============================================================================
  API pública
============================================================================= */

/**
 * initAuth(onUser)
 * Suscribe los cambios de sesión.
 *
 * Devuelve:
 * - unsubscribe()
 */
export function initAuth(onUser) {
  if (typeof onUser !== "function") {
    throw new Error("initAuth(onUser): onUser debe ser una función.");
  }

  checkRedirectResult().catch((error) => {
    console.warn("[auth] Error revisando redirect result:", error);
  });

  return onAuthStateChanged(
    auth,
    async (user) => {
      try {
        await onUser(user || null);
      } catch (error) {
        console.error("[auth] Error en callback onUser:", error);
      }
    },
    (error) => {
      console.error("[auth] onAuthStateChanged error:", error);

      try {
        onUser(null, error);
      } catch (callbackError) {
        console.error("[auth] Error notificando fallo de sesión:", callbackError);
      }
    }
  );
}

/**
 * waitForAuthReady()
 * Espera a que Firebase resuelva si hay sesión activa o no.
 */
export function waitForAuthReady() {
  if (authReadyPromise) return authReadyPromise;

  authReadyPromise = new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user || null);
      },
      () => {
        unsubscribe();
        resolve(null);
      }
    );
  });

  return authReadyPromise;
}

/**
 * checkRedirectResult()
 * Útil si el login tuvo que caer a redirect por bloqueo de popup.
 */
export async function checkRedirectResult() {
  if (redirectChecked) return null;

  redirectChecked = true;

  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error) {
    console.warn("[auth] getRedirectResult error:", error);
    throw error;
  }
}

/**
 * loginGoogle(options?)
 *
 * options:
 * - forceAccountPicker: boolean
 * - prompt: "select_account" | "consent" | "none" | etc.
 * - loginHint: correo sugerido
 * - persistence: "local" | "session"
 * - useRedirectFallback: boolean
 * - preferRedirect: boolean
 */
export async function loginGoogle(options = {}) {
  if (loginInFlight) return loginInFlight;

  const {
    useRedirectFallback = true,
    preferRedirect = shouldPreferRedirect(),
  } = options || {};

  loginInFlight = (async () => {
    try {
      await applyPersistence(options);

      const provider = createGoogleProvider(options);

      if (preferRedirect) {
        await signInWithRedirect(auth, provider);
        return null;
      }

      const result = await signInWithPopup(auth, provider);
      return result?.user || null;
    } catch (error) {
      console.error("[auth] loginGoogle error:", error);

      if (useRedirectFallback && shouldFallbackToRedirect(error)) {
        try {
          const provider = createGoogleProvider(options);
          await signInWithRedirect(auth, provider);
          return null;
        } catch (redirectError) {
          console.error("[auth] signInWithRedirect error:", redirectError);
          throw redirectError;
        }
      }

      throw error;
    } finally {
      loginInFlight = null;
    }
  })();

  return loginInFlight;
}

/**
 * logout()
 * Cierra sesión.
 */
export async function logout() {
  if (logoutInFlight) return logoutInFlight;

  logoutInFlight = (async () => {
    try {
      await signOut(auth);
      return true;
    } catch (error) {
      console.error("[auth] logout error:", error);
      throw error;
    } finally {
      logoutInFlight = null;
    }
  })();

  return logoutInFlight;
}

/**
 * getCurrentUser()
 */
export function getCurrentUser() {
  return auth.currentUser || null;
}

/**
 * isLoggedIn()
 */
export function isLoggedIn() {
  return Boolean(auth.currentUser);
}

/**
 * getCurrentUserEmail()
 */
export function getCurrentUserEmail() {
  return auth.currentUser?.email || "";
}

/**
 * getCurrentUserSummary()
 */
export function getCurrentUserSummary() {
  const user = getCurrentUser();

  if (!user) {
    return null;
  }

  return {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    emailVerified: Boolean(user.emailVerified),
    providerId: user.providerData?.[0]?.providerId || "google.com",
  };
}

/* =============================================================================
  Errores amigables
============================================================================= */

export function humanAuthError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code.includes("auth/popup-closed-by-user")) {
    return "Cerraste la ventana de inicio de sesión.";
  }

  if (code.includes("auth/cancelled-popup-request")) {
    return "Se canceló el intento anterior. Intenta de nuevo.";
  }

  if (code.includes("auth/popup-blocked")) {
    return "El navegador bloqueó la ventana de Google. Permite ventanas emergentes o intenta de nuevo.";
  }

  if (code.includes("auth/network-request-failed")) {
    return "Hay un problema de conexión. Revisa internet e intenta otra vez.";
  }

  if (code.includes("auth/too-many-requests")) {
    return "Hubo demasiados intentos. Espera un momento antes de volver a intentar.";
  }

  if (code.includes("auth/account-exists-with-different-credential")) {
    return "Ese correo ya existe con otro método de acceso.";
  }

  if (code.includes("auth/operation-not-allowed")) {
    return "El inicio de sesión con Google no está habilitado en Firebase Auth.";
  }

  if (code.includes("auth/unauthorized-domain")) {
    return "Este dominio no está autorizado en Firebase Auth. Agrega el dominio en Authorized domains.";
  }

  if (code.includes("auth/web-storage-unsupported")) {
    return "El navegador no permite guardar la sesión. Revisa cookies, modo incógnito o configuración de privacidad.";
  }

  if (code.includes("auth/user-disabled")) {
    return "Este usuario está deshabilitado en Firebase.";
  }

  if (code.includes("auth/user-token-expired")) {
    return "La sesión expiró. Vuelve a iniciar sesión.";
  }

  if (code.includes("auth/invalid-api-key")) {
    return "La API key de Firebase no es válida. Revisa firebase.js.";
  }

  if (code.includes("auth/app-deleted")) {
    return "La app de Firebase no está disponible. Revisa la configuración del proyecto.";
  }

  if (code.includes("auth/invalid-auth-domain")) {
    return "El dominio de autenticación de Firebase no es válido. Revisa authDomain en firebase.js.";
  }

  if (code.includes("auth/argument-error")) {
    return "Hay un error en la configuración de autenticación.";
  }

  if (isPopupProblem(error)) {
    return "No se pudo abrir correctamente el inicio de sesión con Google.";
  }

  if (message) {
    return `No se pudo iniciar sesión: ${message}`;
  }

  return "No se pudo iniciar sesión. Intenta nuevamente.";
}