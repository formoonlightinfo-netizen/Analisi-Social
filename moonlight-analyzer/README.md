# Moonlight Content Analyzer

Applicazione per analizzare i video già pubblicati su Instagram e TikTok da @moonlight.coach, inserire manualmente caption e metriche per piattaforma, e accumulare tutto in un archivio interrogabile per trovare pattern tra caratteristiche del contenuto e performance.

**Vincolo di sicurezza rispettato**: l'app non accede mai a Instagram/TikTok in modo automatizzato (nessuno scraping, nessun bot di login). I video vanno scaricati manualmente; le metriche si inseriscono a mano dall'interfaccia web.

**Nessun costo API extra**: l'analisi visiva (hook, formato, coerenza, montaggio) parte da sola non appena carichi un video — nessuna chat, nessuna chiave API a pagamento. Il server lancia in background una sessione headless di Claude Code che guarda i fotogrammi, usando lo stesso accesso del tuo abbonamento Claude.

## 1. Come funziona, in breve

1. Apri l'app nel browser e **carichi il video** (trascinalo o scegli il file)
2. Il server estrae i fotogrammi e avvia da solo l'analisi visiva in background — vedi lo stato "🔄 analisi in corso" nella lista
3. Dopo 1-3 minuti l'analisi è pronta: hook, formato, coerenza immagine/testo, stile di montaggio, ritmo
4. Inserisci **caption e categoria** (condivise) e le **metriche per piattaforma** (Instagram e/o TikTok): like, commenti, condivisioni, salvataggi, reach
5. Premi "Report pattern" quando vuoi vedere cosa funziona meglio

Tutto avviene nella stessa pagina web — non serve mai aprire una chat o scrivere comandi.

## 2. Prerequisiti

- **Node.js** 18+ e **ffmpeg**, già disponibili nelle sessioni cloud di Claude Code (come questa) — non devi installare nulla.
- Se invece usi Claude Code installato sul tuo Mac/PC, installa ffmpeg una volta sola: macOS `brew install ffmpeg`, Windows `winget install ffmpeg`, Linux `sudo apt install ffmpeg`.

## 3. Installazione (una tantum)

```bash
cd moonlight-analyzer
npm install
```

Non serve creare un file `.env` né una chiave API.

## 4. Avvio

```bash
npm start
```

Apri [http://localhost:3000](http://localhost:3000). Da lì carichi i video, inserisci i dati, guardi i report — tutto in un unico posto.

(In alternativa a trascinare un video nel browser, puoi anche mettere un file `.mp4` nella cartella `moonlight-analyzer/incoming/` e tenere aperto `npm run watch`: viene preparato e analizzato automaticamente allo stesso modo — utile ad es. se sincronizzi una cartella dal telefono.)

## 5. Salvataggio dell'archivio

Ogni volta che carichi un video, salvi metriche o l'analisi finisce, l'app salva da sola l'archivio (`data/contenuti.db`) su GitHub, così i dati sopravvivono anche se una sessione cloud si chiude. I video originali e i fotogrammi temporanei invece NON vengono conservati a lungo termine (non servono più una volta fatta l'analisi) — se un'analisi resta bloccata a metà per un reset imprevisto, basta ricaricare il video.

## 6. Accesso protetto da password

L'app chiede nome utente e password prima di mostrare qualsiasi cosa (utile perché può essere raggiungibile anche da fuori il tuo computer, vedi sotto). Le credenziali di default sono:

- Utente: `helga`
- Password: `moonlight2026`

**Cambiale**: crea un file `.env` (copia `.env.example`) nella cartella `moonlight-analyzer` e imposta `AUTH_USER` e `AUTH_PASSWORD` con valori tuoi.

## 7. Accesso da telefono / altri dispositivi

Il modo più semplice è esporre l'app con un link pubblico fisso tramite [ngrok](https://ngrok.com) (gratuito): crei un account, installi `ngrok` (`brew install ngrok`), colleghi il tuo account (`ngrok config add-authtoken ...`), e lanci:

```bash
ngrok http 3000
```

Ti dà un indirizzo tipo `https://xxxx.ngrok-free.app` raggiungibile da qualsiasi dispositivo — protetto dalla password dell'app (punto 6). Con un account ngrok gratuito puoi anche riservare un dominio fisso così il link non cambia ogni volta.

Sul telefono, apri quel link nel browser e scegli "Aggiungi alla schermata Home" (Safari) o "Installa app" (Chrome): diventa un'icona vera, si apre a schermo intero come un'app normale.

## 7. Struttura del progetto

```
Analisi-Social/
├── CLAUDE.md                    ← note tecniche sull'architettura (per chi manutiene il codice)
└── moonlight-analyzer/
    ├── incoming/                ← video caricati/trascinati, in attesa di preparazione
    ├── processed/               ← video spostati qui dopo la preparazione
    ├── frames/                  ← fotogrammi temporanei (ripuliti dopo l'analisi)
    ├── data/
    │   └── contenuti.db         ← database SQLite con tutti i contenuti e le metriche (salvato su git)
    ├── src/
    │   ├── db.js                 ← schema e query del database
    │   ├── ffmpeg.js              ← estrazione durata e fotogrammi
    │   ├── processVideo.js        ← preparazione video (estrazione)
    │   ├── runAnalysis.js         ← lancia l'analisi visiva headless
    │   ├── pipeline.js            ← orchestrazione: prepara + avvia analisi in background
    │   ├── saveAnalysis.js        ← salva l'analisi nel database
    │   ├── persist.js             ← salva l'archivio su GitHub dopo ogni modifica
    │   ├── watcher.js             ← osservatore automatico di incoming/
    │   ├── prepareIncoming.js     ← (strumento di recupero) preparazione manuale da riga di comando
    │   ├── listPending.js         ← (strumento di recupero) elenca i video in attesa/bloccati
    │   ├── report.js              ← calcolo dei pattern aggregati
    │   └── reportCli.js           ← report da riga di comando (stampa JSON)
    ├── public/                  ← interfaccia web (HTML/CSS/JS, nessun framework)
    └── server.js                ← server Express (upload, API, interfaccia web)
```

## 8. API disponibili

- `POST /api/upload` — carica un video (`multipart/form-data`, campo `video`), avvia preparazione + analisi in background
- `GET /api/contents` — lista contenuti con metriche ed engagement calcolato
- `GET /api/contents/:id` — dettaglio di un contenuto
- `PATCH /api/contents/:id` — aggiorna caption/categoria
- `POST /api/contents/:id/rename` — rinomina il file (anche il file .mp4 su disco, se ancora presente)
- `POST /api/contents/:id/metrics` — inserisce/aggiorna le metriche di una piattaforma (`platform: "instagram" | "tiktok"`)
- `POST /api/contents/:id/reanalyze` — ripete l'analisi se era fallita
- `GET /api/report` — report aggregato dei pattern (anche da riga di comando con `npm run report`)
- `POST /api/scan` — prepara e analizza eventuali video presenti in `incoming/` (utile col flusso a cartella)

## 9. Note

- L'analisi guarda fino a 40 fotogrammi per video (circa 1 al secondo, sufficiente per i formati Reels/TikTok tipici di 15-90 secondi) e richiede in genere 1-3 minuti
- Ogni file viene identificato per nome: se provi a ricaricare lo stesso file già analizzato, l'app segnala che esiste già (evita doppioni)
- Se un'analisi fallisce (es. sessione interrotta), il contenuto mostra "⚠ analisi fallita" con un pulsante "Riprova analisi"
