# Cómo publicar Estudiantes HUB (Firebase Hosting)

Esta guía deja la app en **un solo lugar**, siempre con la última versión, y
arregla de raíz el **bucle de login en iPhone** (porque el login pasa a ser del
mismo dominio que la app).

> Todo esto se hace **una sola vez** para la migración. Después, publicar una
> versión nueva es un solo comando (ver el final).

---

## 0) Requisitos (una vez)

1. Tener instalado Node.js.
2. Instalar la herramienta de Firebase:
   ```bash
   npm install -g firebase-tools
   ```
3. Iniciar sesión con la cuenta de Google que es dueña del proyecto
   `bitacoras-de-clase`:
   ```bash
   firebase login
   ```

---

## 1) Crear el sitio dedicado (una vez)

Creamos un sitio aparte llamado `estudianteshub` dentro del proyecto, para **no
tocar nada** de lo que ya tengas publicado en Firebase.

```bash
firebase hosting:sites:create estudianteshub --project bitacoras-de-clase
```

Esto crea la URL **https://estudianteshub.web.app**.

Luego conectamos ese sitio con la configuración del repo (el archivo
`firebase.json` ya apunta al target `estudianteshub`):

```bash
firebase target:apply hosting estudianteshub estudianteshub --project bitacoras-de-clase
```

---

## 2) Primer despliegue

Desde la carpeta del proyecto:

```bash
firebase deploy --only hosting:estudianteshub --project bitacoras-de-clase
```

Cuando termine, abre **https://estudianteshub.web.app** y confirma que la app
carga. (Todavía el login en iPhone no está 100%: falta el paso 3 y 4).

---

## 3) Autorizar el dominio para el login

1. Ve a la consola de Firebase → proyecto **bitacoras-de-clase**
   → **Authentication** → pestaña **Settings** → **Authorized domains**.
2. Verifica que esté `estudianteshub.web.app`. Si no está, agrégalo con
   **Add domain**.

---

## 4) Hacer el login "del mismo dominio" (arregla el iPhone)

1. Abre `src/config.js`.
2. Busca el comentario `👉 PASO FINAL de la migración` dentro de `FIREBASE_CONFIG`.
3. Cambia la línea:
   ```js
   authDomain: "bitacoras-de-clase.firebaseapp.com",
   ```
   por:
   ```js
   authDomain: "estudianteshub.web.app",
   ```
4. Guarda y vuelve a desplegar:
   ```bash
   firebase deploy --only hosting:estudianteshub --project bitacoras-de-clase
   ```

Ahora prueba en un iPhone (tanto en Safari como con la app agregada a la
pantalla de inicio): el login con Google debe entrar sin devolverte a la
pantalla de inicio de sesión.

---

## 5) Repartir el enlace

Comparte con todos **https://estudianteshub.web.app** (o conecta un dominio
propio desde Hosting si más adelante quieres `app.musicala...`).

Pídeles que, si tenían la versión vieja agregada a la pantalla de inicio, la
borren y vuelvan a agregar esta. A partir de aquí, **siempre** verán la última
versión automáticamente.

---

## Publicar una versión nueva (lo de cada día)

Cada vez que cambies código:

1. Sube el número de versión del Service Worker en `sw.js`:
   ```js
   const CACHE_VERSION = "v1.5.1"; // súbelo: v1.5.0 -> v1.5.1
   ```
   Esto fuerza a todos los dispositivos (incluido iPhone) a recargar a la
   última versión.
2. Despliega:
   ```bash
   firebase deploy --only hosting:estudianteshub --project bitacoras-de-clase
   ```

Eso es todo. No hay ramas que mantener ni copias en varios lados: **un solo
sitio, siempre actualizado**.

---

## Notas

- Las **reglas de Firestore** (`firestore.rules`) no se publican con este
  comando. Si las cambias, súbelas aparte con:
  ```bash
  firebase deploy --only firestore:rules --project bitacoras-de-clase
  ```
- GitHub Pages puede quedar como respaldo, pero el enlace oficial pasa a ser el
  de Firebase Hosting. (En GitHub Pages el login de iPhone seguirá fallando,
  porque ahí el dominio no coincide con el de autenticación.)
