import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDurationSeconds, extractFrames } from './ffmpeg.js';
import { insertContent, contentExistsByFilename } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROCESSED_DIR = path.join(ROOT, 'processed');
const FRAMES_DIR = path.join(ROOT, 'frames');
const INCOMING_DIR = path.join(ROOT, 'incoming');

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
 * Prepara un video appena arrivato in incoming/: estrae durata e fotogrammi
 * (lasciandoli su disco), crea una riga "pending_analysis" nel database e
 * sposta il video in processed/. L'analisi visiva vera e propria la fa poi
 * Claude Code guardando i fotogrammi (vedi CLAUDE.md) — qui non si chiama
 * nessuna API a pagamento.
 * @param {string} videoPath - path assoluto del file .mp4 in incoming/
 * @returns {Promise<{ id: string, framesDir: string, frameCount: number, durationSec: number|null }>}
 */
export async function prepareVideo(videoPath) {
  const filename = path.basename(videoPath);

  if (contentExistsByFilename(filename)) {
    throw new Error(`Un contenuto con il file "${filename}" è già stato elaborato in precedenza.`);
  }

  const id = makeContentId(filename);
  const framesDir = path.join(FRAMES_DIR, id);

  const durationSec = await getDurationSeconds(videoPath);
  const framePaths = await extractFrames(videoPath, framesDir);
  if (framePaths.length === 0) {
    throw new Error('Nessun fotogramma estratto dal video (file corrotto o vuoto?).');
  }

  const processedPath = path.join(PROCESSED_DIR, filename);
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  fs.renameSync(videoPath, processedPath);

  insertContent({
    id,
    filename,
    processed_path: processedPath,
    duration_sec: durationSec,
    status: 'pending_analysis',
    hook_type: null,
    text_layering: null,
    image_text_coherence: null,
    coherence_score: null,
    format: null,
    editing_style: null,
    pacing: null,
    analysis_notes: null,
    analysis_raw: null,
    analyzed_at: null,
  });

  return { id, framesDir, frameCount: framePaths.length, durationSec };
}

/**
 * Scansiona incoming/ e prepara (estrazione fotogrammi, nessuna analisi) tutti
 * i video .mp4 trovati.
 * @returns {Promise<{ prepared: object[], errors: {file: string, error: string}[] }>}
 */
export async function prepareIncoming() {
  fs.mkdirSync(INCOMING_DIR, { recursive: true });
  const files = fs
    .readdirSync(INCOMING_DIR)
    .filter((f) => f.toLowerCase().endsWith('.mp4'));

  const prepared = [];
  const errors = [];

  for (const file of files) {
    const fullPath = path.join(INCOMING_DIR, file);
    try {
      const result = await prepareVideo(fullPath);
      prepared.push({ filename: file, ...result });
    } catch (err) {
      errors.push({ file, error: err.message });
    }
  }

  return { prepared, errors };
}
