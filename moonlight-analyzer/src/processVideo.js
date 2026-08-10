import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDurationSeconds, extractFrames, cleanupFrames } from './ffmpeg.js';
import { analyzeFrames } from './analyzer.js';
import { insertContent, contentExistsByFilename } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROCESSED_DIR = path.join(ROOT, 'processed');
const FRAMES_DIR = path.join(ROOT, 'frames');

function slugify(filename) {
  const base = path.basename(filename, path.extname(filename));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

function makeContentId(filename) {
  const slug = slugify(filename) || 'video';
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${slug}-${suffix}`;
}

/**
 * Elabora un video appena arrivato in incoming/: estrae fotogrammi, chiama l'analisi
 * visiva, salva la voce nel database e sposta il file in processed/.
 * @param {string} videoPath - path assoluto del file .mp4 in incoming/
 * @returns {Promise<string>} l'id del contenuto creato
 */
export async function processVideo(videoPath) {
  const filename = path.basename(videoPath);

  if (contentExistsByFilename(filename)) {
    throw new Error(`Un contenuto con il file "${filename}" è già stato elaborato in precedenza.`);
  }

  const id = makeContentId(filename);
  const framesDir = path.join(FRAMES_DIR, id);

  let analysis;
  let durationSec;
  try {
    durationSec = await getDurationSeconds(videoPath);
    const framePaths = await extractFrames(videoPath, framesDir);
    if (framePaths.length === 0) {
      throw new Error('Nessun fotogramma estratto dal video (file corrotto o vuoto?).');
    }
    analysis = await analyzeFrames(framePaths, { durationSec });
  } finally {
    cleanupFrames(framesDir);
  }

  const processedPath = path.join(PROCESSED_DIR, filename);
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  fs.renameSync(videoPath, processedPath);

  insertContent({
    id,
    filename,
    processed_path: processedPath,
    duration_sec: durationSec,
    status: 'analyzed',
    hook_type: analysis.hook_type ?? null,
    text_layering: analysis.text_layering ?? null,
    image_text_coherence: analysis.image_text_coherence ?? null,
    coherence_score: analysis.coherence_score ?? null,
    format: analysis.format ?? null,
    editing_style: analysis.editing_style ? JSON.stringify(analysis.editing_style) : null,
    pacing: analysis.pacing ?? null,
    analysis_notes: analysis.notes ?? null,
    analysis_raw: JSON.stringify(analysis),
    analyzed_at: new Date().toISOString(),
  });

  return id;
}

/**
 * Scansiona la cartella incoming/ ed elabora tutti i video .mp4 trovati, in sequenza.
 * @returns {Promise<{ processed: string[], errors: {file: string, error: string}[] }>}
 */
export async function scanIncoming() {
  const INCOMING_DIR = path.join(ROOT, 'incoming');
  fs.mkdirSync(INCOMING_DIR, { recursive: true });
  const files = fs
    .readdirSync(INCOMING_DIR)
    .filter((f) => f.toLowerCase().endsWith('.mp4'));

  const processed = [];
  const errors = [];

  for (const file of files) {
    const fullPath = path.join(INCOMING_DIR, file);
    try {
      const id = await processVideo(fullPath);
      processed.push(id);
    } catch (err) {
      errors.push({ file, error: err.message });
    }
  }

  return { processed, errors };
}
