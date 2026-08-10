# Moonlight Content Analyzer — istruzioni per Claude Code

Questo repository contiene `moonlight-analyzer/`, un'app che aiuta Helga (@moonlight.coach) ad analizzare i video già pubblicati su Instagram/TikTok e a trovare pattern di performance. Vedi `moonlight-analyzer/README.md` per la panoramica completa.

## Come funziona l'analisi visiva (nessuna azione manuale richiesta)

Quando Helga carica un video dall'interfaccia web (`server.js`, endpoint `POST /api/upload`), il server:

1. Estrae durata e fotogrammi con `ffmpeg` (`src/ffmpeg.js`, `src/processVideo.js`)
2. Lancia in background una sessione **headless e isolata** di Claude Code (`src/runAnalysis.js`, tramite `claude -p ... --allowedTools Read`) che guarda i fotogrammi con lo strumento Read e produce l'analisi in JSON
3. Salva il risultato nel database (`src/saveAnalysis.js`)

**Non serve mai che un utente scriva in chat "analizza i video"** — è tutto automatico dal momento in cui il video viene caricato. Questo usa lo stesso accesso di Claude Code già configurato in questo ambiente (nessuna chiave `ANTHROPIC_API_KEY` separata, nessun costo API a consumo aggiuntivo — rientra nell'abbonamento Claude di Helga).

Il processo headless viene lanciato con le variabili `CLAUDE_CODE_SESSION_ID` / `CLAUDE_CODE_REMOTE_SESSION_ID` rimosse dall'ambiente, per evitare che si agganci alla sessione interattiva corrente: deve essere una sessione indipendente e isolata (vedi `src/runAnalysis.js`).

## Se stai facendo manutenzione a questo codice

- Non reintrodurre `@anthropic-ai/sdk` né `ANTHROPIC_API_KEY` — rimossi intenzionalmente.
- Non tentare mai di accedere a Instagram/TikTok in modo automatizzato (scraping, login bot). Video e metriche li inserisce sempre Helga manualmente, dall'interfaccia web.
- `src/prepareIncoming.js`, `src/listPending.js`, `src/saveAnalysis.js` restano utilizzabili da riga di comando come strumenti di recupero/debug (es. se un'analisi resta bloccata), ma non fanno più parte del flusso principale, che passa da `src/pipeline.js`.

## Importante — sessioni cloud effimere

Se Helga lavora da una sessione cloud (container che si resetta quando la sessione finisce), i video in `incoming/`/`processed/` e i fotogrammi in `frames/` NON sono salvati su git e vanno persi al reset. Solo `data/contenuti.db` viene salvato automaticamente su GitHub (`src/persist.js`, chiamato dopo ogni scrittura: upload, metriche, caption, analisi completata/fallita). Se un'analisi resta bloccata a metà per un reset del container, il video va ricaricato dall'interfaccia web.

## Altri comandi utili

- `npm start` — avvia il server web (upload, lista contenuti, form caption/metriche, report pattern) su `http://localhost:3000`
- `npm run watch` — osserva `incoming/` e avvia automaticamente preparazione+analisi per ogni video trascinato lì (alternativa all'upload da web, es. se si sincronizza una cartella da telefono)
- `npm run report` — stampa il report pattern aggregato da riga di comando
