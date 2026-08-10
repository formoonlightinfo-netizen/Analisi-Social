import { prepareIncoming } from './processVideo.js';

const { prepared, errors } = await prepareIncoming();

if (prepared.length === 0 && errors.length === 0) {
  console.log('Nessun nuovo video trovato in incoming/.');
}

if (prepared.length > 0) {
  console.log(JSON.stringify(prepared, null, 2));
}

for (const { file, error } of errors) {
  console.error(`✘ Errore su ${file}: ${error}`);
}

process.exit(errors.length > 0 ? 1 : 0);
