import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
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
import { ingestIncoming, ingestVideo } from './src/pipeline.js';
import { runAnalysis } from './src/runAnalysis.js';
import { persistDb } from './src/persist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const INCOMING_DIR = path.join(__dirname, 'incoming');
const FRAMES_DIR = path.join(__dirname, 'frames');
const PROCESSED_DIR = path.join(__dirname, 'processed');
const THUMBNAILS_DIR = path.join(__dirname, 'public', 'thumbnails');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function decorate(content) {
  const metrics = content.metrics.map((m) => ({ ...m, engagement: engagementRate(m) }));
  return { ...content, metrics, gap: platformGap(content) };
}

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

  const allowed = ['caption', 'category'];
  const fields = {};
  for (const key of allowed) {
    if (key in req.body) fields[key] = String(req.body[key] ?? '');
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'Nessun campo valido da aggiornare (caption, category).' });
  }
  updateContentFields(req.params.id, fields);
  persistDb(`Aggiorna caption/categoria: ${req.params.id}`);
  res.json(decorate(getContentById(req.params.id)));
});

// Rinomina il file di un contenuto (nome mostrato in lista/dettaglio, e il
// file .mp4 in processed/ se ancora presente).
app.post('/api/contents/:id/rename', (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });

  let newFilename = String(req.body.filename || '').trim();
  if (!newFilename) return res.status(400).json({ error: 'Il nome non può essere vuoto.' });
  newFilename = path.basename(newFilename).replace(/[^a-zA-Z0-9._\- ]/g, '_');
  if (!/\.mp4$/i.test(newFilename)) newFilename += '.mp4';

  if (newFilename !== content.filename && contentExistsByFilename(newFilename)) {
    return res.status(409).json({ error: `Esiste già un contenuto chiamato "${newFilename}".` });
  }

  const updates = { filename: newFilename };
  if (content.processed_path && fs.existsSync(content.processed_path)) {
    const newPath = path.join(PROCESSED_DIR, newFilename);
    fs.renameSync(content.processed_path, newPath);
    updates.processed_path = newPath;
  }

  updateContentFields(content.id, updates);
  persistDb(`Rinomina file: ${content.id} -> ${newFilename}`);
  res.json(decorate(getContentById(content.id)));
});

// Elimina definitivamente un contenuto: riga nel database (e metriche
// collegate), video in processed/, miniatura, eventuali fotogrammi rimasti.
app.delete('/api/contents/:id', (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });

  if (content.processed_path && fs.existsSync(content.processed_path)) {
    fs.rmSync(content.processed_path, { force: true });
  }
  fs.rmSync(path.join(THUMBNAILS_DIR, `${content.id}.jpg`), { force: true });
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

// Riprova l'analisi per un contenuto in stato "analysis_failed" (i
// fotogrammi devono essere ancora presenti su disco).
app.post('/api/contents/:id/reanalyze', async (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });

  const framesDir = path.join(FRAMES_DIR, content.id);
  if (!fs.existsSync(framesDir)) {
    return res.status(400).json({ error: 'Fotogrammi non più disponibili: ritrascina il video in incoming/.' });
  }

  updateContentFields(content.id, { status: 'analyzing' });
  res.json(decorate(getContentById(content.id)));

  runAnalysis(content.id, framesDir)
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
