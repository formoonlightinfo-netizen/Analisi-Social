import os from 'node:os';
import path from 'node:path';

const EXTRA_PATH_DIRS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

// Variabili di sessione da rimuovere per evitare che il processo headless si
// agganci alla sessione interattiva corrente. CLAUDE_CODE_OAUTH_TOKEN NON va
// qui: su hosting senza login interattivo (es. container Docker) è l'unico
// modo per autenticare `claude` con l'abbonamento dell'utente.
const SESSION_BINDING_KEYS = ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDECODE'];

/**
 * Ambiente per lanciare `claude` in modo headless e isolato: rimuove le
 * variabili che legherebbero il processo alla sessione interattiva
 * corrente, e assicura che il PATH includa dove `claude` è installato
 * anche quando il server gira come servizio di sistema (PATH minimo).
 */
export function buildClaudeEnv() {
  const env = { ...process.env };
  for (const key of SESSION_BINDING_KEYS) delete env[key];
  const existingPathDirs = new Set((env.PATH || '').split(path.delimiter));
  const missingDirs = EXTRA_PATH_DIRS.filter((dir) => !existingPathDirs.has(dir));
  if (missingDirs.length > 0) {
    env.PATH = [...missingDirs, env.PATH || ''].filter(Boolean).join(path.delimiter);
  }
  return env;
}
