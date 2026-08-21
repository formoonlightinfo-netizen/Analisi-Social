#!/bin/sh
# Configura git nel container "usa e getta" prima di avviare il server, così
# src/persist.js riesce a fare commit+push del database dopo ogni scrittura
# (upload, metriche, caption, analisi) esattamente come quando l'app gira
# sul Mac di Helga. Senza questo, ogni riavvio del container perderebbe i
# dati non ancora salvati su GitHub.
set -e

cd /app

git config --global --add safe.directory /app
git config --global user.name "Moonlight Analyzer"
git config --global user.email "moonlight-bot@users.noreply.github.com"

if [ -n "$GIT_PUSH_TOKEN" ]; then
  git remote set-url origin "https://x-access-token:${GIT_PUSH_TOKEN}@github.com/formoonlightinfo-netizen/Analisi-Social.git"
fi

cd /app/moonlight-analyzer
exec "$@"
