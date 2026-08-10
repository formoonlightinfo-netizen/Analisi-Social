# Moonlight Content Analyzer — istruzioni per Claude Code

Questo repository contiene `moonlight-analyzer/`, un'app che aiuta Helga (@moonlight.coach) ad analizzare i video già pubblicati su Instagram/TikTok e a trovare pattern di performance. Vedi `moonlight-analyzer/README.md` per la panoramica completa.

**Principio chiave**: l'analisi visiva dei video la fai TU, Claude Code, guardando i fotogrammi con lo strumento Read — non si chiama nessuna API Claude esterna a pagamento. Questo perché Helga paga già un abbonamento Claude e non vuole costi aggiuntivi.

## Quando l'utente chiede di "analizzare i video nuovi / in sospeso"

1. **Estrai i fotogrammi dei nuovi video**: esegui da terminale, nella cartella `moonlight-analyzer/`:
   ```
   node src/prepareIncoming.js
   ```
   Questo scansiona `incoming/`, per ogni video `.mp4` estrae durata e fotogrammi (1 al secondo, lasciati su disco), crea una riga nel database con stato `pending_analysis`, sposta il video in `processed/`. Stampa un JSON con `{ id, framesDir, frameCount, durationSec }` per ciascun video preparato.

   Se vuoi invece recuperare video già preparati in sessioni precedenti (fotogrammi già estratti ma non ancora analizzati, es. sessione interrotta), usa:
   ```
   node src/listPending.js
   ```

2. **Guarda i fotogrammi**: per ciascun video preparato, usa lo strumento Read per aprire i file `.jpg` dentro `framesDir` (sono in ordine cronologico, es. `frame-0001.jpg`, `frame-0002.jpg`, ...). Guardali come guarderesti un video: hook iniziale, come evolve il testo in overlay, ambientazione, montaggio.

3. **Produci l'analisi** secondo questo schema esatto (stessi valori enum, non altri):
   ```json
   {
     "hook_type": "loop_aperto" | "rivelazione_diretta" | "domanda" | "testimonianza" | "contro_affermazione" | "altro",
     "text_layering": "progressivo" | "tutto_insieme",
     "image_text_coherence": "descrizione di quanto l'inquadratura/ambientazione è coerente col messaggio testuale",
     "coherence_score": <intero 1-5, 5 = massima coerenza>,
     "format": "parlato_in_camera" | "voiceover_testo" | "montaggio_multiclip" | "slideshow" | "altro",
     "editing_style": {
       "ritmo_tagli": "descrizione del ritmo dei tagli",
       "zoom_transizioni": "uso di zoom, transizioni, effetti",
       "stile_testo_overlay": "font, animazione, posizione del testo overlay",
       "coerenza_editing_tono": "quanto lo stile di montaggio è coerente col tono del contenuto"
     },
     "pacing": "descrizione del ritmo generale e della durata percepita",
     "notes": "altre osservazioni utili su cosa funziona o non funziona"
   }
   ```

4. **Salva l'analisi** eseguendo (JSON compatto su una riga, entro apici singoli):
   ```
   node src/saveAnalysis.js <id> '<json>'
   ```
   Questo aggiorna il database (stato passa ad `analyzed`) e ripulisce i fotogrammi temporanei in `frames/<id>/`.

5. Ripeti i passi 2-4 per ogni video restituito al passo 1, poi conferma a Helga quanti video sono stati analizzati (es. "Ho analizzato 3 video, ora puoi inserire caption e metriche dall'interfaccia web").

## Cosa NON fare

- Non installare o usare `@anthropic-ai/sdk` né variabili come `ANTHROPIC_API_KEY` in questo progetto — è stato rimosso intenzionalmente.
- Non tentare mai di accedere a Instagram/TikTok in modo automatizzato (scraping, login bot). I video e le metriche li inserisce sempre Helga manualmente.
- Non cancellare `frames/<id>/` prima di aver letto e salvato l'analisi — `saveAnalysis.js` lo fa già automaticamente dopo il salvataggio.

## Altri comandi utili

- `npm start` — avvia il server web locale (form caption/metriche, lista contenuti, report pattern) su `http://localhost:3000`
- `npm run watch` — osserva `incoming/` e prepara automaticamente ogni nuovo video (solo estrazione fotogrammi, non analisi)
- `npm run report` — stampa il report pattern aggregato da riga di comando
