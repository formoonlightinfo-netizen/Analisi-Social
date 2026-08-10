import 'dotenv/config';
import { scanIncoming } from './processVideo.js';

const { processed, errors } = await scanIncoming();

if (processed.length === 0 && errors.length === 0) {
  console.log('Nessun nuovo video trovato in incoming/.');
}

for (const id of processed) {
  console.log(`✔ Elaborato: ${id}`);
}

for (const { file, error } of errors) {
  console.error(`✘ Errore su ${file}: ${error}`);
}

process.exit(errors.length > 0 ? 1 : 0);
