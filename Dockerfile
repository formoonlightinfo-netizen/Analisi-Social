FROM node:20-slim

# ffmpeg: estrazione fotogrammi dai video. git: il server fa commit+push del
# database dopo ogni scrittura (src/persist.js), quindi serve anche qui, non
# solo in locale. build-essential/python3: fallback per compilare
# better-sqlite3 se non è disponibile un binario precompilato per l'immagine.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git ca-certificates build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# CLI di Claude Code: fa l'analisi visiva headless (vedi src/runAnalysis.js).
# Si autentica con CLAUDE_CODE_OAUTH_TOKEN (abbonamento Claude di Helga), non
# con una chiave API a consumo.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY . .

WORKDIR /app/moonlight-analyzer
RUN npm ci --omit=dev

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
