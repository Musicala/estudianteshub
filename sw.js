/* =============================================================================
  Estudiantes HUB · Musicala — sw.js
  Service Worker para PWA estática
  - Cache seguro del app shell
  - Fallback de navegación para rutas con hash
  - Limpieza de versiones antiguas
  - No cachea peticiones externas ni POST/PUT/DELETE
============================================================================= */

const APP_NAME = "estudiantes-hub-musicala";
const CACHE_VERSION = "v1.3.1";

const STATIC_CACHE = `${APP_NAME}-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${APP_NAME}-runtime-${CACHE_VERSION}`;

const CACHE_ALLOWLIST = [STATIC_CACHE, RUNTIME_CACHE];

/*
  Importante:
  Estos archivos se intentan cachear de forma segura.
  Si alguno todavía no existe, el Service Worker NO falla.
*/
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",

  "./src/app.js",
  "./src/config.js",
  "./src/firebase.js",
  "./src/auth.js",
  "./src/permissions.js",
  "./src/data.js",
  "./src/normalizers.js",
  "./src/ui.js",
  "./src/views.js",
  "./src/musiprofe.js",

  "./assets/logo.png",
  "./assets/musiprofe.png",

  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-192.png",
  "./assets/icons/icon-maskable-512.png"
];

const STATIC_EXTENSIONS = [
  ".css",
  ".js",
  ".json",
  ".webmanifest",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2"
];

/* =============================================================================
  Helpers
============================================================================= */

function getAbsoluteUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function isGetRequest(request) {
  return request.method === "GET";
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  return STATIC_EXTENSIONS.some((extension) =>
    url.pathname.toLowerCase().endsWith(extension)
  );
}

async function safeCacheAdd(cache, path) {
  try {
    const url = getAbsoluteUrl(path);
    const response = await fetch(url, { cache: "reload" });

    if (!response || !response.ok) {
      console.warn(`[SW] No se pudo cachear ${path}:`, response?.status);
      return;
    }

    await cache.put(url, response);
  } catch (error) {
    console.warn(`[SW] Archivo omitido del cache: ${path}`, error);
  }
}

async function trimCache(cacheName, maxItems = 80) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length <= maxItems) return;

  const keysToDelete = keys.slice(0, keys.length - maxItems);
  await Promise.all(keysToDelete.map((key) => cache.delete(key)));
}

/* =============================================================================
  Install
============================================================================= */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);

      await Promise.allSettled(
        APP_SHELL.map((path) => safeCacheAdd(cache, path))
      );

      await self.skipWaiting();
    })()
  );
});

/* =============================================================================
  Activate
============================================================================= */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames.map((cacheName) => {
          if (!CACHE_ALLOWLIST.includes(cacheName)) {
            return caches.delete(cacheName);
          }

          return Promise.resolve();
        })
      );

      await self.clients.claim();
    })()
  );
});

/* =============================================================================
  Fetch strategies
============================================================================= */

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (!isGetRequest(request)) return;
  if (!isSameOrigin(request)) return;

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirstRuntime(request));
});

/* -----------------------------------------------------------------------------
  Navegación:
  Intenta red. Si no hay internet, devuelve index.html cacheado.
----------------------------------------------------------------------------- */

async function networkFirstNavigation(request) {
  const cache = await caches.open(STATIC_CACHE);

  try {
    const freshResponse = await fetch(request);

    if (freshResponse && freshResponse.ok) {
      await cache.put(getAbsoluteUrl("./index.html"), freshResponse.clone());
    }

    return freshResponse;
  } catch (error) {
    const cachedIndex =
      (await cache.match(getAbsoluteUrl("./index.html"))) ||
      (await cache.match(getAbsoluteUrl("./")));

    if (cachedIndex) return cachedIndex;

    return new Response(
      `
        <!doctype html>
        <html lang="es-CO">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Sin conexión · Estudiantes HUB</title>
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: #f7f8fc;
                color: #111827;
              }

              main {
                width: min(520px, calc(100% - 32px));
                padding: 24px;
                border-radius: 24px;
                background: #ffffff;
                box-shadow: 0 18px 48px rgba(16, 24, 40, 0.12);
                text-align: center;
              }

              h1 {
                margin: 0 0 10px;
                font-size: 1.5rem;
              }

              p {
                margin: 0;
                color: #667085;
                line-height: 1.5;
              }
            </style>
          </head>

          <body>
            <main>
              <h1>Sin conexión</h1>
              <p>
                No pudimos cargar Estudiantes HUB en este momento.
                Revisa tu conexión e intenta nuevamente.
              </p>
            </main>
          </body>
        </html>
      `,
      {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      }
    );
  }
}

/* -----------------------------------------------------------------------------
  Assets estáticos:
  Devuelve cache rápido y actualiza en segundo plano.
----------------------------------------------------------------------------- */

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }

      return networkResponse;
    })
    .catch(() => null);

  return cachedResponse || fetchPromise || Response.error();
}

/* -----------------------------------------------------------------------------
  Runtime:
  Intenta red primero. Si falla, usa cache.
----------------------------------------------------------------------------- */

async function networkFirstRuntime(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      await trimCache(RUNTIME_CACHE, 80);
    }

    return networkResponse;
  } catch (error) {
    const cachedResponse = await cache.match(request);

    if (cachedResponse) return cachedResponse;

    return Response.error();
  }
}

/* =============================================================================
  Mensajes desde la app
============================================================================= */

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (data.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((cacheNames) =>
        Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
      )
    );
  }
});
