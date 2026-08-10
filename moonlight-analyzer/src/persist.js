import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_RELATIVE_PATH = path.join('moonlight-analyzer', 'data', 'contenuti.db');

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
    execFileSync('git', ['add', DB_RELATIVE_PATH], opts);
    const diff = execFileSync('git', ['diff', '--cached', '--name-only'], opts).toString().trim();
    if (!diff) return; // nessuna modifica reale (es. solo timestamp WAL)
    execFileSync('git', ['commit', '-m', message], opts);
    execFileSync('git', ['push'], opts);
  } catch (err) {
    console.error(`⚠ Impossibile salvare l'archivio su GitHub: ${err.message}`);
  }
}
