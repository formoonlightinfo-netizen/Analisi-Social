# Moonlight Content Analyzer

Applicazione per analizzare i video già pubblicati su Instagram e TikTok da @moonlight.coach, inserire manualmente caption e metriche per piattaforma, e accumulare tutto in un archivio interrogabile per trovare pattern tra caratteristiche del contenuto e performance.

**Vincolo di sicurezza rispettato**: l'app non accede mai a Instagram/TikTok in modo automatizzato (nessuno scraping, nessun bot di login). I video vanno scaricati manualmente e trascinati nella cartella `incoming/`; anche le metriche si inseriscono a mano dall'interfaccia web.

**Nessun costo API extra**: l'analisi visiva dei video (hook, formato, coerenza, montaggio) la fa direttamente Claude Code, guardando i fotogrammi durante la chat — non c'è nessuna chiamata a un'API a pagamento separata. Basta il tuo abbonamento Claude già attivo.

## 1. Come funziona, in breve

1. Scarichi un video già pubblicato e lo trascini in `incoming/`
2. Un comando estrae automaticamente durata e fotogrammi (non serve nessuna chiave API)
3. Apri una chat con Claude Code su questo progetto e scrivi qualcosa come *"analizza i video in sospeso"* — Claude Code guarda i fotogrammi e salva l'analisi nel database
4. Apri l'interfaccia web per inserire caption e metriche (like, commenti, reach, ecc.) per Instagram e/o TikTok
5. Quando vuoi, premi "Report pattern" per vedere cosa funziona meglio

## 2. Prerequisiti

- **Node.js** 18+ e **ffmpeg** disponibili nell'ambiente in cui gira Claude Code. Se lavori tramite sessioni cloud di Claude Code (come questa), sono già pronti — non devi installare nulla sul tuo computer.
- Se invece usi Claude Code installato sul tuo Mac/PC, installa ffmpeg una volta sola: macOS `brew install ffmpeg`, Windows `winget install ffmpeg`, Linux `sudo apt install ffmpeg`.

## 3. Installazione (una tantum)

```bash
cd moonlight-analyzer
npm install
```

Non serve creare un file `.env` né una chiave API — il file `.env.example` resta come riferimento nel caso in futuro si voglia cambiare la porta del server.

## 4. Uso quotidiano

**A. Prepara i video nuovi** (estrazione fotogrammi, nessuna analisi):

```bash
npm run prepare-videos
```

In alternativa, tieni aperto `npm run watch` in un terminale: prepara automaticamente ogni video appena lo trascini in `incoming/`.

**B. Fai analizzare i video da Claude Code**: apri una chat su questo progetto (da computer o dall'app mobile di Claude Code) e chiedi semplicemente:

> analizza i video in sospeso

Claude Code sa cosa fare grazie alle istruzioni in `CLAUDE.md` alla radice del repository: guarda i fotogrammi già estratti, produce l'analisi (hook, formato, coerenza immagine/testo, stile di montaggio, ritmo) e la salva nel database.

**C. Avvia il server web** per inserire caption e metriche:

```bash
npm start
```

Apri [http://localhost:3000](http://localhost:3000). Seleziona il contenuto analizzato, inserisci **caption e categoria** (condivise) e le **metriche per ciascuna piattaforma** su cui è stato pubblicato: like, commenti, condivisioni, salvataggi, reach.

**D. Report pattern**: premi il pulsante "Report pattern" nell'interfaccia (oppure `npm run report` da riga di comando) per vedere quali hook, formati e stili funzionano meglio, e il confronto di rendimento tra Instagram e TikTok.

## 5. Accesso da telefono

Usa l'app mobile di Claude Code per aprire una sessione su questo progetto: puoi chiedere di analizzare i video in sospeso, controllare l'archivio o farti riassumere il report pattern direttamente in chat, senza bisogno del computer. Il caricamento del file video in `incoming/` resta più pratico da computer, a meno che tu non configuri una sincronizzazione di cartelle (iCloud Drive, Google Drive, ecc.) che punti dentro `moonlight-analyzer/incoming/`.

## 6. Struttura del progetto

```
Analisi-Social/
├── CLAUDE.md                    ← istruzioni per Claude Code (come analizzare i video)
└── moonlight-analyzer/
    ├── incoming/                ← trascina qui i video .mp4 già editati/pubblicati
    ├── processed/               ← video spostati qui dopo la preparazione
    ├── frames/                  ← fotogrammi temporanei (ripuliti dopo l'analisi)
    ├── data/
    │   └── contenuti.db         ← database SQLite con tutti i contenuti e le metriche
    ├── src/
    │   ├── db.js                 ← schema e query del database
    │   ├── ffmpeg.js              ← estrazione durata e fotogrammi
    │   ├── processVideo.js        ← preparazione video (estrazione, nessuna analisi)
    │   ├── saveAnalysis.js        ← salva l'analisi prodotta da Claude Code
    │   ├── watcher.js             ← osservatore automatico di incoming/
    │   ├── prepareIncoming.js     ← preparazione una tantum da riga di comando
    │   ├── listPending.js         ← elenca i video in attesa di analisi
    │   ├── report.js              ← calcolo dei pattern aggregati
    │   └── reportCli.js           ← report da riga di comando (stampa JSON)
    ├── public/                  ← interfaccia web (HTML/CSS/JS, nessun framework)
    └── server.js                ← server Express (API + interfaccia web)
```

## 7. API disponibili

- `GET /api/contents` — lista contenuti con metriche ed engagement calcolato
- `GET /api/contents/:id` — dettaglio di un contenuto
- `PATCH /api/contents/:id` — aggiorna caption/categoria
- `POST /api/contents/:id/metrics` — inserisce/aggiorna le metriche di una piattaforma (`platform: "instagram" | "tiktok"`)
- `POST /api/contents/:id/analysis` — salva l'analisi visiva (usato da Claude Code, non dall'interfaccia)
- `GET /api/report` — report aggregato dei pattern (anche da riga di comando con `npm run report`)
- `POST /api/scan` — prepara (estrazione fotogrammi) tutti i video presenti in `incoming/`

## 8. Note

- L'analisi guarda fino a 40 fotogrammi per video (circa 1 al secondo, sufficiente per i formati Reels/TikTok tipici di 15-90 secondi)
- Ogni file viene identificato per nome: se provi a rielaborare lo stesso file già presente in `processed/`, l'app segnala che è già stato analizzato (evita doppioni)
- Se una sessione di Claude Code si interrompe dopo la preparazione ma prima dell'analisi, i fotogrammi restano su disco: usa `npm run pending` (o chiedi a Claude Code) per ritrovare i video ancora in sospeso
