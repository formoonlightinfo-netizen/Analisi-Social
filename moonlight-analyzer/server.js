import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  listContents,
  getContentById,
  updateContentFields,
  upsertPlatformMetrics,
} from './src/db.js';
import { generateReport, engagementRate, platformGap } from './src/report.js';
import { prepareIncoming } from './src/processVideo.js';
import { saveAnalysis } from './src/saveAnalysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

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
  res.json(decorate(getContentById(req.params.id)));
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
  res.json(decorate(getContentById(req.params.id)));
});

app.get('/api/report', (req, res) => {
  res.json(generateReport());
});

app.post('/api/scan', async (req, res) => {
  try {
    const result = await prepareIncoming();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Usato da Claude Code (non dall'interfaccia utente) per salvare l'analisi
// visiva dopo aver guardato i fotogrammi estratti — vedi CLAUDE.md.
app.post('/api/contents/:id/analysis', (req, res) => {
  const content = getContentById(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenuto non trovato.' });
  try {
    saveAnalysis(req.params.id, req.body);
    res.json(decorate(getContentById(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Moonlight Analyzer in ascolto su http://localhost:${PORT}`);
});
