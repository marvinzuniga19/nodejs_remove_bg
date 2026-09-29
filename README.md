# FondoFuera

Eliminador de fondos que corre **íntegramente en tu servidor**. Subes una imagen, el motor de
segmentación la recorta y devuelve un PNG con canal alfa. La imagen entra, se procesa y desaparece:
nada sale de la máquina.

No hay APIs de terceros, ni claves, ni cuentas. El modelo de IA viene empaquetado en las
dependencias y se ejecuta en local sobre CPU (ONNX Runtime).

## Características

- **Tres formas de elegir la imagen**: selector de archivos, arrastrar y soltar, o pegar
  directamente con `Ctrl+V` / `Cmd+V` desde el portapapeles.
- **Privacidad por diseño**: el archivo se guarda en disco solo durante el procesado y se borra al
  terminar, también si la operación falla.
- **Validación en cliente y servidor**: hasta 20 MB y siete formatos permitidos, comprobados en los
  dos lados.
- **Estado del motor en la interfaz**: la barra superior muestra si el modelo está calentando,
  procesando o listo, consultando el servidor real.
- **Una imagen a la vez**: la inferencia satura la CPU, así que el servidor rechaza en paralelo con
  un `429` en lugar de degradarse.
- **Descarga directa**: el PNG resultante se guarda como `<nombre-original>-sin-fondo.png`.
- **Limpieza automática**: los temporales que dejan ejecuciones anteriores se borran al arrancar.
- **Sin dependencias de red en el navegador**: tipografías locales, CSS y JS propios, CSP
  restrictiva.

## Stack

| Capa | Tecnología |
|------|------------|
| Servidor | [Express](https://expressjs.com) 5, [Multer](https://github.com/expressjs/multer) 2 |
| Motor de IA | [`@imgly/background-removal-node`](https://github.com/imgly/background-removal-node) 1.4.5 |
| Runtime de inferencia | ONNX Runtime (`onnxruntime-node`) 1.17.3 + `sharp` 0.32.6 |
| Frontend | HTML, CSS y JavaScript sin framework ni build |

## Requisitos

- **Node.js 18 o superior** (es el mínimo que exige Express 5). Probado con Node 26.
- ~300 MB de espacio en disco para `node_modules`.
- Espacio para el modelo: 84.1 MB con `medium` (por defecto) o 42.3 MB con `small`.

No hace falta GPU, ni Docker, ni variables de entorno obligatorias.

## Instalación

```bash
npm install
npm start
```

Abre <http://localhost:3000>.

El primer arranque precarga el modelo con una imagen de 1×1 píxel para que la primera petición real
no tenga que cargarlo. Verás en la consola `Modelo precargado en Nms`; hasta entonces la interfaz
muestra *calentando motor…*. Ese calentamiento puede tardar bastante más que un procesado normal.

Para desarrollo, con recarga automática al guardar:

```bash
npm run dev
```

## Uso

1. Elige la imagen con el selector, **arrástrala** sobre la barra de subida o **pégala** con
   `Ctrl+V`.
2. Pulsa **Eliminar fondo**.
3. Cuando termine, pulsa **Descargar PNG**.

El procesado tarda unos segundos porque el modelo corre en CPU. Mientras está ocupado, la barra
superior indica *procesando…* y el servidor rechaza nuevas imágenes hasta que termine.

## Variables de entorno

Todas son opcionales. El proyecto no carga archivos `.env` (no usa `dotenv`), así que pásalas por
consola: `PORT=8080 npm start`.

| Variable | Por defecto | Valores | Descripción |
|----------|-------------|---------|-------------|
| `PORT` | `3000` | cualquier entero | Puerto en el que escucha el servidor. |
| `MODEL` | `medium` | `small`, `medium` | Modelo de segmentación. Cualquier otro valor cae de vuelta a `medium`. |
| `RATE_LIMIT_MAX` | `10` | entero | Máximo de peticiones por IP dentro de la ventana de 60 s contra `/remove-bg`. |

## API

### `POST /remove-bg`

Procesa una imagen y devuelve el PNG recortado directamente en el cuerpo de la respuesta.

- **Content-Type:** `multipart/form-data`
- **Campo:** `image` (un solo archivo)

Formatos aceptados: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`, `image/bmp`,
`image/tiff`. La extensión del archivo temporal se decide en el servidor a partir del MIME
normalizado, nunca a partir de lo que envíe el cliente.

```bash
curl -X POST http://localhost:3000/remove-bg \
  -F "image=@foto.jpg" \
  -o foto-sin-fondo.png
```

Respuestas de error (todas en JSON, `{ "error": "..." }`):

| Código | Causa |
|--------|-------|
| `400` | No se subió ninguna imagen, o error genérico de subida. |
| `413` | La imagen supera el máximo de 20 MB. |
| `415` | Formato no soportado. |
| `429` | Se superó el rate limit, o el servidor ya está procesando otra imagen. |
| `500` | Fallo durante la inferencia. |

### `GET /api/status`

Devuelve el estado real del motor, que el frontend consulta para pintar la barra superior.

```json
{
  "status": "ready",
  "model": "medium",
  "maxFileSize": 20971520
}
```

`status` es `warming_up` (precargando el modelo), `busy` (procesando una imagen) o `ready`.
Este endpoint **no** está sujeto a rate limit.

## Estructura del proyecto

```
.
├── server.js          # Servidor Express: subida, inferencia, limpieza y apagado
├── public/
│   ├── index.html     # Estructura de la interfaz
│   ├── script.js      # Selección, drag & drop, pegado, envío y descarga
│   ├── styles.css     # Estilos (tema oscuro, tokens, componentes)
│   └── fonts/         # Satoshi y JetBrains Mono autoalojadas (woff2)
├── uploads/           # Temporales; se vacía al arrancar
├── package.json
└── .gitignore
```

## Notas de operación

- **La inferencia es CPU-bound.** Por eso el servidor procesa una sola imagen a la vez y responde
  `429` al resto. El rate limit es un `Map` en memoria: se reinicia con el proceso y no se comparte
  entre instancias.
- **`uploads/` es desechable.** Al arrancar, el servidor borra todo lo que encuentre ahí. No guardes
  nada que necesites conservar, y no lo montes como volumen persistente.
- **Sin CDN.** Las tipografías son locales y la CSP (`default-src 'self'`) impide que la página cargue
  recursos de terceros.
- **Apagado limpio.** `SIGINT` y `SIGTERM` cierran el servidor y esperan hasta 5 s antes de forzar
  la salida.
- **Sin tests automatizados.** `npm test` solo ejecuta `node --check` sobre `server.js` y
  `public/script.js`, es decir, valida la sintaxis.

## Scripts

| Comando | Qué hace |
|---------|----------|
| `npm start` | Arranca el servidor. |
| `npm run dev` | Arranca con `--watch`, reinicia al guardar. |
| `npm test` | Comprueba la sintaxis de los archivos JS. |
