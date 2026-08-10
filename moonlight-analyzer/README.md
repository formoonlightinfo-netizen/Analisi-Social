# Moonlight Content Analyzer

Applicazione locale per analizzare automaticamente i video già pubblicati su Instagram e TikTok da @moonlight.coach, inserire manualmente caption e metriche per piattaforma, e accumulare tutto in un archivio interrogabile per trovare pattern tra caratteristiche del contenuto e performance.

**Vincolo di sicurezza rispettato**: l'app non accede mai a Instagram/TikTok in modo automatizzato (nessuno scraping, nessun bot di login). I video vanno scaricati manualmente e trascinati nella cartella `incoming/`; anche le metriche si inseriscono a mano dall'interfaccia web.

## 1. Prerequisiti

- **Node.js** 18 o superiore ([nodejs.org](https://nodejs.org))
- **ffmpeg** installato e disponibile nel PATH (serve per estrarre i fotogrammi dai video):
  - macOS: `brew install ffmpeg`
  - Windows: `winget install ffmpeg` (o scarica da [ffmpeg.org](https://ffmpeg.org/download.html))
  - Linux: `sudo apt install ffmpeg`
- Una **chiave API Claude** (vedi sotto)

## 2. Ottenere la chiave API Claude

1. Vai su [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Accedi o crea un account
3. Sezione **API Keys** → **Create Key**
4. Copia la chiave (inizia con `sk-ant-...`) — non sarà più visibile dopo, salvala subito

L'uso dell'API è a consumo (pay-as-you-go): ogni video analizzato costa pochi centesimi in base al numero di fotogrammi inviati (di norma 1 video di ~30-60s costa pochissimo). Serve un metodo di pagamento collegato all'account Anthropic Console.

## 3. Installazione

```bash
cd moonlight-analyzer
npm install
cp .env.example .env
```

Apri `.env` e incolla la tua chiave:

```
ANTHROPIC_API_KEY=sk-ant-la-tua-chiave-qui
```

## 4. Avvio

Servono **due processi** in parallelo (in due terminali, oppure uno alla volta a seconda del flusso che preferisci):

**A. Il server web** (interfaccia per inserire caption/metriche e vedere i report):

```bash
npm start
```

Apri il browser su [http://localhost:3000](http://localhost:3000)

**B. L'osservatore della cartella `incoming/`** (analizza automaticamente ogni video appena arriva):

```bash
npm run watch
```

Lascialo aperto: appena trascini un `.mp4` in `incoming/`, lo elabora da solo (estrazione fotogrammi + analisi visiva + spostamento in `processed/`).

In alternativa, se preferisci lanciare l'analisi manualmente invece di tenere un processo sempre acceso, usa:

```bash
npm run scan
```

Questo elabora una tantum tutti i video presenti in `incoming/` in quel momento. La stessa azione è disponibile anche come pulsante "Scansiona incoming/" nell'interfaccia web.

## 5. Flusso di lavoro quotidiano

1. **Scarica** da Instagram (o TikTok) il video già pubblicato, con i sottotitoli/testo in overlay come compare nel post reale
2. **Trascina** il file `.mp4` nella cartella `moonlight-analyzer/incoming/`
3. Attendi qualche secondo: l'analisi visiva automatica (hook, formato, coerenza, montaggio) viene generata e il video si sposta in `processed/`
4. Apri [http://localhost:3000](http://localhost:3000), seleziona il contenuto appena analizzato dalla lista
5. Inserisci **caption e categoria** (condivise) e le **metriche per ciascuna piattaforma** su cui è stato pubblicato (Instagram e/o TikTok): like, commenti, condivisioni, salvataggi, reach
6. Ripeti per ogni video — l'archivio cresce da solo nel tempo
7. Premi **"Report pattern"** quando vuoi un riepilogo aggregato: hook con engagement medio più alto, testo a strati vs blocco unico, confronto Instagram/TikTok, contenuti con forte divario di rendimento tra le due piattaforme

## 6. Accesso da telefono

- **Da computer**: apri semplicemente `http://localhost:3000` nel browser mentre il server gira in locale
- **Da telefono**: usa l'app mobile di Claude Code per avviare/controllare una sessione su questo progetto da remoto (ad es. per far girare `npm run scan` o rivedere i dati). Il caricamento del file video in `incoming/` resta più pratico da computer, a meno che tu non configuri una sincronizzazione di cartelle (iCloud Drive, Google Drive, ecc.) tra telefono e computer che punti dentro `moonlight-analyzer/incoming/`.

## 7. Struttura del progetto

```
moonlight-analyzer/
├── incoming/           ← trascina qui i video .mp4 già editati/pubblicati
├── processed/          ← video spostati qui dopo l'analisi
├── frames/              ← fotogrammi temporanei (puliti automaticamente dopo l'analisi)
├── data/
│   └── contenuti.db    ← database SQLite con tutti i contenuti e le metriche
├── src/
│   ├── db.js            ← schema e query del database
│   ├── ffmpeg.js         ← estrazione durata e fotogrammi
│   ├── analyzer.js       ← chiamata a Claude per l'analisi visiva
│   ├── processVideo.js   ← orchestrazione del flusso per un singolo video
│   ├── watcher.js         ← osservatore automatico di incoming/
│   ├── scanIncoming.js    ← scansione una tantum da riga di comando
│   ├── report.js          ← calcolo dei pattern aggregati
│   └── reportCli.js       ← report da riga di comando (stampa JSON)
├── public/               ← interfaccia web (HTML/CSS/JS, nessun framework)
├── server.js             ← server Express (API + interfaccia web)
└── .env                  ← chiave API e configurazione (non versionato)
```

## 8. API disponibili

- `GET /api/contents` — lista contenuti con metriche ed engagement calcolato
- `GET /api/contents/:id` — dettaglio di un contenuto
- `PATCH /api/contents/:id` — aggiorna caption/categoria
- `POST /api/contents/:id/metrics` — inserisce/aggiorna le metriche di una piattaforma (`platform: "instagram" | "tiktok"`)
- `GET /api/report` — report aggregato dei pattern (anche da riga di comando con `npm run report`)
- `POST /api/scan` — elabora tutti i video presenti in `incoming/`

## 9. Note su costi e limiti

- L'analisi visiva invia fino a 40 fotogrammi per video al modello Claude (circa 1 al secondo, sufficiente per i formati Reels/TikTok tipici di 15-90 secondi)
- Ogni file viene identificato per nome: se provi a rielaborare lo stesso file già presente in `processed/`, l'app segnala che è già stato analizzato (evita doppioni)
- Il modello usato è configurabile tramite `CLAUDE_MODEL` nel file `.env`
