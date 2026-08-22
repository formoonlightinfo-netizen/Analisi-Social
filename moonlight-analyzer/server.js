import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import {
  listContents,
  getContentById,
  updateContentFields,
  upsertPlatformMetrics,
  contentExistsByFilename,
  deleteContent,
} from './src/db.js';
import { generateReport, engagementRate, platformGap } from './src/report.js';
import { ingestIncoming, ingestVideo, ingestCarousel } from './src/pipeline.js';
import { runAnalysis, runCarouselAnalysis } from './src/runAnalysis.js';
import { askClaude } from './src/askClaude.js';
import { persistDb, getPersistStatus } from './src/persist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const INCOMING_DIR = path.join(__dirname, 'incoming');
const FRAMES_DIR = path.join(__dirname, 'frames');
const PROCESSED_DIR = path.join(__dirname, 'processed');
const THUMBNAILS_DIR = path.join(__dirname, 'public', 'thumbnails');

// Protezione con nome utente/password: necessaria perché l'app può essere
// esposta con un link pubblico (es. ngrok) e non ha altro tipo di accesso.
// Cambia AUTH_USER / AUTH_PASSWORD in .env per personalizzarli.
const AUTH_USER = process.env.AUTH_USER || 'helga';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'moonlight2026';

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Basic ')) {
    const [user, password] = Buffer.from(header.slice(6), 'base64').toString().split(':');
    if (user && password && safeEqual(user, AUTH_USER) && safeEqual(password, AUTH_PASSWORD)) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Moonlight Content Analyzer"');
  res.status(401).send('Accesso richiesto.');
}

const app = express();
app.use(requireAuth);
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function decorate(content) {
  const metrics = content.metrics.map((m) => ({ ...m, engagement: engagementRate(m) }));
  return { ...content, metrics, gap: platformGap(content) };
}

app.get('/api/persist-status', (req, res) => {
  res.json(getPersistStatus());
});

app.get('/api/contents', (req, res) => {
  const contents = listContents().map(decorate);
  res.json(contents);
});

app.get('/api/contents/:id', (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });
  res.json(decorate(content));
});

app.patch('/api/contents/:id', (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });

  const textFields = [
    'caption', 'category', 'hook_type', 'text_layering', 'image_text_coherence', 'format', 'pacing', 'analysis_notes',
  ];
  const numberFields = ['coherence_score', 'duration_sec'];
  const fields = {};
  for (const key of textFields) {
    if (key in req.body) fields[key] = String(req.body[key] ?? '');
  }
  for (const key of numberFields) {
    if (key in req.body) {
      const n = Number(req.body[key]);
      fields[key] = Number.isFinite(n) ? n : null;
    }
  }
  // editing_style è salvato come JSON (vedi src/db.js) — il client manda un
  // oggetto con le sotto-voci (ritmo tagli, zoom, ecc.), qui lo serializziamo.
  if ('editing_style' in req.body) fields.editing_style = JSON.stringify(req.body.editing_style ?? {});

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'Nessun campo valido da aggiornare.' });
  }
  updateContentFields(req.params.id, fields);
  persistDb(`Aggiorna contenuto: ${req.params.id}`);
  res.json(decorate(getContentById(req.params.id)));
});

// Rinomina un contenuto (nome mostrato in lista/dettaglio). Per i video
// rinomina anche il file .mp4 in processed/ (forzando l'estensione); per i
// caroselli è solo un'etichetta, non c'è un singolo file da rinominare.
app.post('/api/contents/:id/rename', (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });

  let newFilename = String(req.body.filename || '').trim();
  if (!newFilename) return res.status(400).json({ error: 'Il nome non può essere vuoto.' });

  const updates = {};
  if (content.content_type === 'carousel') {
    newFilename = newFilename.slice(0, 120);
    updates.filename = newFilename;
  } else {
    newFilename = path.basename(newFilename).replace(/[^a-zA-Z0-9._\- ]/g, '_');
    if (!/\.mp4$/i.test(newFilename)) newFilename += '.mp4';
    if (newFilename !== content.filename && contentExistsByFilename(newFilename)) {
      return res.status(409).json({ error: `Esiste già un contenuto chiamato "${newFilename}".` });
    }
    updates.filename = newFilename;
    if (content.processed_path && fs.existsSync(content.processed_path)) {
      const newPath = path.join(PROCESSED_DIR, newFilename);
      fs.renameSync(content.processed_path, newPath);
      updates.processed_path = newPath;
    }
  }

  updateContentFields(content.id, updates);
  persistDb(`Rinomina contenuto: ${content.id} -> ${newFilename}`);
  res.json(decorate(getContentById(content.id)));
});

// Elimina definitivamente un contenuto: riga nel database (e metriche
// collegate), video/immagini in processed/, miniatura, eventuali
// fotogrammi rimasti.
app.delete('/api/contents/:id', (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });

  if (content.processed_path && fs.existsSync(content.processed_path)) {
    fs.rmSync(content.processed_path, { recursive: true, force: true });
  }
  fs.rmSync(path.join(THUMBNAILS_DIR, `${content.id}${content.thumbnail_ext || '.jpg'}`), { force: true });
  fs.rmSync(path.join(FRAMES_DIR, content.id), { recursive: true, force: true });

  deleteContent(content.id);
  persistDb(`Elimina contenuto: ${content.id}`);
  res.json({ ok: true });
});

const NUMERIC_FIELDS = ['likes', 'comments', 'shares', 'saves', 'reposts', 'reach'];

app.post('/api/contents/:id/metrics', (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });

  const { platform, url, published_at } = req.body;
  if (!['instagram', 'tiktok'].includes(platform)) {
    return res.status(400).json({ error: 'platform deve essere "instagram" o "tiktok".' });
  }

  const metrics = { url: url ?? null, published_at: published_at ?? null };
  for (const field of NUMERIC_FIELDS) {
    const raw = req.body[field];
    if (raw === undefined || raw === null || raw === '') {
      metrics[field] = field === 'reposts' ? null : 0;
      continue;
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: `${field} deve essere un numero non negativo.` });
    }
    metrics[field] = num;
  }

  upsertPlatformMetrics(req.params.id, platform, metrics);
  persistDb(`Aggiorna metriche ${platform}: ${req.params.id}`);
  res.json(decorate(getContentById(req.params.id)));
});

app.get('/api/report', (req, res) => {
  res.json(generateReport());
});

// Chiede a Claude Code (headless, stesso meccanismo gratuito dell'analisi
// video) di guardare l'intero archivio e rispondere a una domanda libera —
// es. idee per nuovi contenuti basate sui pattern reali di performance.
app.post('/api/ask', async (req, res) => {
  const question = String(req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'Scrivi una domanda.' });
  try {
    const answer = await askClaude(question);
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Carica un video dalla pagina web: viene salvato in incoming/, preparato
// (estrazione fotogrammi) e l'analisi visiva parte subito in background —
// non serve nessuna azione manuale né chat con Claude Code.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(INCOMING_DIR, { recursive: true });
      cb(null, INCOMING_DIR);
    },
    filename: (req, file, cb) => {
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.mp4$/i.test(file.originalname)) {
      return cb(new Error('Sono accettati solo file .mp4.'));
    }
    cb(null, true);
  },
});

app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto (campo "video").' });

    try {
      const id = await ingestVideo(req.file.path);
      res.json({ id, status: 'analyzing' });
    } catch (err) {
      fs.rmSync(req.file.path, { force: true });
      res.status(400).json({ error: err.message });
    }
  });
});

// Carica le immagini di un carosello: vengono salvate direttamente in
// processed/<id>/ (sono il contenuto stesso, niente ffmpeg) e l'analisi
// visiva parte subito in background, come per i video.
const uploadCarousel = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tmpDir = path.join(__dirname, 'incoming', '.carousel-tmp');
      fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (!/\.(jpe?g|png)$/i.test(file.originalname)) {
      return cb(new Error('Sono accettate solo immagini .jpg/.png.'));
    }
    cb(null, true);
  },
});

app.post('/api/upload-carousel', (req, res) => {
  uploadCarousel.array('images', 20)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nessuna immagine ricevuta (campo "images").' });
    }
    try {
      const id = await ingestCarousel(req.files);
      res.json({ id, status: 'analyzing' });
    } catch (err) {
      for (const file of req.files) fs.rmSync(file.path, { force: true });
      res.status(400).json({ error: err.message });
    }
  });
});

// Riprova l'analisi per un contenuto in stato "analysis_failed" (per i
// video, i fotogrammi devono essere ancora presenti su disco; per i
// caroselli le immagini sono sempre lì, sono il contenuto permanente).
app.post('/api/contents/:id/reanalyze', async (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });

  const isCarousel = content.content_type === 'carousel';
  const analysisDir = isCarousel ? content.processed_path : path.join(FRAMES_DIR, content.id);
  if (!analysisDir || !fs.existsSync(analysisDir)) {
    return res.status(400).json({
      error: isCarousel
        ? 'Immagini del carosello non più disponibili.'
        : 'Fotogrammi non più disponibili: ritrascina il video in incoming/.',
    });
  }

  updateContentFields(content.id, { status: 'analyzing' });
  res.json(decorate(getContentById(content.id)));

  const analysisFn = isCarousel ? runCarouselAnalysis : runAnalysis;
  analysisFn(content.id, analysisDir)
    .then(() => persistDb(`Analisi completata: ${content.id}`))
    .catch((err) => {
      console.error(`✘ Nuovo tentativo fallito per ${content.id}: ${err.message}`);
      persistDb(`Analisi fallita: ${content.id}`);
    });
});

// Prepara e avvia l'analisi per eventuali video trascinati manualmente in
// incoming/ (es. da un altro dispositivo/sync di cartelle).
app.post('/api/scan', async (req, res) => {
  try {
    const result = await ingestIncoming();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Moonlight Analyzer in ascolto su http://localhost:${PORT}`);
});
