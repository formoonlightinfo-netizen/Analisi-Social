import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { prepareVideo } from './processVideo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INCOMING_DIR = path.join(__dirname, '..', 'incoming');

console.log(`In ascolto su ${INCOMING_DIR} — trascina qui i video .mp4 da preparare.`);
console.log('Nota: questo processo estrae solo i fotogrammi. Per l\'analisi vera e propria, apri una chat con Claude Code e chiedi di analizzare i video in sospeso.');

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
    console.log(`→ Nuovo video rilevato: ${filename}, estrazione fotogrammi in corso...`);
    try {
      const { id, frameCount } = await prepareVideo(filePath);
      console.log(`✔ Pronto per l'analisi: ${id} (${frameCount} fotogrammi). Chiedi a Claude Code di analizzarlo.`);
    } catch (err) {
      console.error(`✘ Errore durante la preparazione di ${filename}: ${err.message}`);
    }
  });
});
