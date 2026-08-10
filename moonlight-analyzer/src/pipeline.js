import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVideo } from './processVideo.js';
import { runAnalysis } from './runAnalysis.js';
import { updateContentFields } from './db.js';
import { persistDb } from './persist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INCOMING_DIR = path.join(__dirname, '..', 'incoming');

/**
 * Prepara un video (estrazione fotogrammi) e avvia l'analisi visiva in
 * background, senza bloccare il chiamante. Pensato per l'endpoint di
 * upload: risponde subito con l'id, l'analisi continua da sola.
 * @param {string} videoPath
 * @returns {Promise<string>} id del contenuto
 */
export async function ingestVideo(videoPath) {
  const { id, framesDir } = await prepareVideo(videoPath);
  updateContentFields(id, { status: 'analyzing' });
  persistDb(`Video pronto per l'analisi: ${id}`);

  runAnalysis(id, framesDir)
    .then(() => persistDb(`Analisi completata: ${id}`))
    .catch((err) => {
      console.error(`✘ Analisi fallita per ${id}: ${err.message}`);
      persistDb(`Analisi fallita: ${id}`);
    });

  return id;
}

/**
 * Scansiona incoming/ e avvia l'ingestione (preparazione + analisi in
 * background) per ogni video .mp4 trovato.
 */
export async function ingestIncoming() {
  fs.mkdirSync(INCOMING_DIR, { recursive: true });
  const files = fs.readdirSync(INCOMING_DIR).filter((f) => f.toLowerCase().endsWith('.mp4'));

  const started = [];
  const errors = [];
  for (const file of files) {
    try {
      const id = await ingestVideo(path.join(INCOMING_DIR, file));
      started.push({ filename: file, id });
    } catch (err) {
      errors.push({ file, error: err.message });
    }
  }
  return { started, errors };
}
