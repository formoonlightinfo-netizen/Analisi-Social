import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { ingestVideo } from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INCOMING_DIR = path.join(__dirname, '..', 'incoming');

console.log(`In ascolto su ${INCOMING_DIR} — trascina qui i video .mp4: vengono preparati e analizzati automaticamente.`);

const watcher = chokidar.watch(INCOMING_DIR, {
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 3000,
    pollInterval: 500,
  },
});

let queue = Promise.resolve();

watcher.on('add', (filePath) => {
  if (!filePath.toLowerCase().endsWith('.mp4')) return;
  queue = queue.then(async () => {
    const filename = path.basename(filePath);
    console.log(`→ Nuovo video rilevato: ${filename}, preparazione e analisi in corso...`);
    try {
      const id = await ingestVideo(filePath);
      console.log(`✔ Analisi avviata in background per ${id}.`);
    } catch (err) {
      console.error(`✘ Errore durante l'elaborazione di ${filename}: ${err.message}`);
    }
  });
});
