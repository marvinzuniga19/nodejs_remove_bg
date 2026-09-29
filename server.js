const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { removeBackground } = require('@imgly/background-removal-node');

const app = express();
app.disable('x-powered-by');
const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX) || 10;
const MODEL = process.env.MODEL || 'medium'; // small | medium | large

// Tipos de imagen permitidos -> extensión normalizada (nunca se toma del cliente)
const ALLOWED_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/tiff': '.tif'
};

const uploadDir = path.join(__dirname, 'uploads');

// Eliminar archivos temporales huérfanos de ejecuciones anteriores
function cleanUploadsDir() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    return;
  }
  for (const name of fs.readdirSync(uploadDir)) {
    if (name === '.gitkeep') continue;
    const filePath = path.join(uploadDir, name);
    try {
      if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`No se pudo limpiar ${filePath}:`, err.message);
    }
  }
}
cleanUploadsDir();

// Ruta absoluta de recursos para @imgly/background-removal-node (independiente del CWD)
function findPackageDir(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
const pkgDir = findPackageDir(path.dirname(require.resolve('@imgly/background-removal-node')));
if (!pkgDir) {
  throw new Error('No se encontró el paquete @imgly/background-removal-node');
}
const modelPublicPath = `file://${path.join(pkgDir, 'dist')}/`;
const removeBgConfig = { publicPath: modelPublicPath, model: MODEL };

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + ALLOWED_MIME[normalizeMime(file.mimetype)]);
  }
});

function normalizeMime(mimetype = '') {
  return String(mimetype).split(';')[0].trim().toLowerCase();
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME[normalizeMime(file.mimetype)]) {
      return cb(null, true);
    }
    const err = new Error('Formato no soportado. Usa PNG, JPG, WEBP, GIF, AVIF, BMP o TIFF');
    err.status = 415;
    cb(err);
  }
});

// Cabeceras de seguridad
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'"
  });
  next();
});

// Limitador simple en memoria (solo para el endpoint de procesamiento)
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  if (hits.size > 1000) {
    for (const [key, entry] of hits) {
      if (now - entry.start >= RATE_WINDOW_MS) hits.delete(key);
    }
  }
  let entry = hits.get(req.ip);
  if (!entry || now - entry.start >= RATE_WINDOW_MS) {
    entry = { start: now, count: 0 };
    hits.set(req.ip, entry);
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) {
    return res
      .status(429)
      .json({ error: 'Demasiadas solicitudes. Espera unos segundos y vuelve a intentarlo.' });
  }
  next();
}

// La inferencia satura la CPU: solo se procesa una imagen a la vez
let processing = false;
function singleFlight(req, res, next) {
  if (processing) {
    return res
      .status(429)
      .json({ error: 'El servidor está ocupado. Espera unos segundos y reintenta.' });
  }
  processing = true;
  res.locals.ownsProcessing = true;
  next();
}
function releaseProcessing(res) {
  if (res.locals.ownsProcessing) {
    res.locals.ownsProcessing = false;
    processing = false;
  }
}

// Servir archivos estáticos (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para procesar la imagen
app.post('/remove-bg', rateLimit, singleFlight, upload.single('image'), async (req, res) => {
  const inputPath = req.file?.path;

  if (!req.file) {
    releaseProcessing(res);
    return res.status(400).json({ error: 'No se subió ninguna imagen' });
  }

  try {
    const resultBlob = await removeBackground(inputPath, removeBgConfig);
    const buffer = Buffer.from(await resultBlob.arrayBuffer());

    res.set('Content-Type', resultBlob.type || 'image/png');
    res.send(buffer);
  } catch (error) {
    console.error('Error al procesar la imagen:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'No se pudo procesar la imagen. Inténtalo de nuevo.' });
    }
  } finally {
    releaseProcessing(res);
    if (inputPath && fs.existsSync(inputPath)) {
      try {
        fs.unlinkSync(inputPath);
      } catch (err) {
        console.error('Error al eliminar archivo temporal:', err.message);
      }
    }
  }
});

// Manejo de errores (Multer, validaciones y cualquier otro)
app.use((err, req, res, next) => {
  releaseProcessing(res);
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    console.error('Error de subida (Multer):', err.code, err.message);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'La imagen supera el máximo de 20MB' });
    }
    return res.status(400).json({ error: 'No se pudo subir la imagen' });
  }

  const status = Number(err.status) || 500;
  if (status < 500) {
    console.warn(`${status} ${req.method} ${req.originalUrl}: ${err.message}`);
  } else {
    console.error('Error no controlado:', err);
  }
  const message = status < 500 ? err.message || 'Solicitud no válida' : 'Error interno del servidor';
  res.status(status).json({ error: message });
});

// Precargar el modelo para evitar cargas concurrentes en la primera petición
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
async function warmUpModel() {
  processing = true;
  try {
    const t0 = Date.now();
    await removeBackground(new Blob([TINY_PNG], { type: 'image/png' }), removeBgConfig);
    console.log(`Modelo precargado en ${Date.now() - t0}ms`);
  } catch (error) {
    console.error('No se pudo precargar el modelo:', error.message);
  } finally {
    processing = false;
  }
}

// Iniciar el servidor
const server = app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  warmUpModel();
});

// Apagado limpio
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nRecibido ${signal}, cerrando servidor...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada sin manejar:', reason);
});
