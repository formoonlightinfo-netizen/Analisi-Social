import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_RELATIVE_PATH = path.join('moonlight-analyzer', 'data', 'contenuti.db');
const THUMBNAILS_RELATIVE_PATH = path.join('moonlight-analyzer', 'public', 'thumbnails');
const ICONS_RELATIVE_PATH = path.join('moonlight-analyzer', 'public', 'icons');
const LOGO_RELATIVE_PATH = path.join('moonlight-analyzer', 'public', 'logo.png');

/**
 * Salva su GitHub il database dell'archivio dopo ogni modifica, così i dati
 * non si perdono quando una sessione cloud di Claude Code termina (il
 * container è "usa e getta"). Non blocca né fa fallire la richiesta HTTP se
 * git non è disponibile o non ci sono modifiche da salvare.
 */
export function persistDb(message) {
  const repoRoot = path.join(__dirname, '..', '..');
  const opts = { cwd: repoRoot, stdio: 'pipe' };
  try {
    // Il database gira in modalità WAL: i dati scritti restano nel file
    // -wal (non tracciato da git) finché non viene fatto un checkpoint. Va
    // forzato prima di ogni commit, altrimenti si rischia di salvare su git
    // un file .db "vecchio" mentre i dati reali restano solo sul disco locale.
    db.pragma('wal_checkpoint(TRUNCATE)');
    // git add fallisce (ed esce senza aggiungere nulla) se anche un solo
    // pathspec non esiste — logo.png è opzionale, va incluso solo se c'è.
    const paths = [DB_RELATIVE_PATH, THUMBNAILS_RELATIVE_PATH, ICONS_RELATIVE_PATH];
    if (fs.existsSync(path.join(repoRoot, LOGO_RELATIVE_PATH))) paths.push(LOGO_RELATIVE_PATH);
    execFileSync('git', ['add', ...paths], opts);
    const diff = execFileSync('git', ['diff', '--cached', '--name-only'], opts).toString().trim();
    if (!diff) return; // nessuna modifica reale (es. solo timestamp WAL)
    execFileSync('git', ['commit', '-m', message], opts);
    try {
      execFileSync('git', ['push'], opts);
    } catch {
      // Il push è stato respinto perché il branch remoto è avanzato nel
      // frattempo (es. un deploy pushato da un'altra postazione). Senza
      // questo recupero il fallimento veniva ignorato in silenzio — i dati
      // restavano solo su questo container e sparivano al riavvio
      // successivo. Ci riallineiamo tenendo la versione appena scritta qui
      // (-X ours, i dati più recenti) e riproviamo il push una volta.
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).toString().trim();
      execFileSync('git', ['fetch', 'origin', branch], opts);
      execFileSync('git', ['merge', '-X', 'ours', '--no-edit', 'FETCH_HEAD'], opts);
      execFileSync('git', ['push'], opts);
    }
  } catch (err) {
    console.error(`⚠ Impossibile salvare l'archivio su GitHub: ${err.message}`);
  }
}
