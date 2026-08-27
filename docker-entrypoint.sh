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

BRANCH="${GIT_BRANCH:-claude/new-session-s3v1ng}"
REMOTE_URL="https://github.com/formoonlightinfo-netizen/Analisi-Social.git"
if [ -n "$GIT_PUSH_TOKEN" ]; then
  REMOTE_URL="https://x-access-token:${GIT_PUSH_TOKEN}@github.com/formoonlightinfo-netizen/Analisi-Social.git"
fi

# Render fornisce i file del repository senza la cartella .git (checkout
# "pulito"), quindi src/persist.js non troverebbe nulla su cui fare
# commit+push. La ricostruiamo puntando all'ultimo commit REALE su GitHub.
# BUG STORICO (causa della maggior parte delle perdite dati di questo
# progetto): qui c'era `git reset` senza `--hard`. Quel comando sposta solo
# l'indice/HEAD e NON tocca i file già copiati nell'immagine Docker — che
# sono quelli presenti al momento della build, cioè PRIMA di qualunque
# salvataggio fatto dal vivo dopo quel push. Risultato: ogni volta che
# veniva fatto un deploy dopo che erano stati caricati nuovi contenuti,
# git "pensava" di essere aggiornato (l'indice sì) ma il file
# contenuti.db sul disco restava quello vecchio — e al primo salvataggio
# successivo, quella versione vecchia veniva commit+pushata sopra i dati
# reali, cancellandoli per sempre. `--hard` forza anche i file su disco ad
# allinearsi al commit più recente su GitHub, non solo l'indice.
# Se questo blocco fallisce (rete, token scaduto...) il server deve partire
# comunque — persist.js già gestisce da solo il caso "git non disponibile"
# senza far fallire le richieste HTTP.
(
  set -e
  rm -rf .git
  git init -q
  git remote add origin "$REMOTE_URL"
  git fetch -q origin "$BRANCH"
  git symbolic-ref HEAD "refs/heads/$BRANCH"
  git reset -q --hard FETCH_HEAD
  # Senza questo, `git push` (senza argomenti, come lo chiama persist.js) non
  # sa su quale branch remoto mandare i dati e fallisce con "has no upstream
  # branch" — è esattamente quello che stava succedendo.
  git branch -q --set-upstream-to="origin/$BRANCH" "$BRANCH"
) || echo "⚠ Setup di git all'avvio fallito — l'app parte comunque ma non salverà su GitHub finché non si risolve."

cd /app/moonlight-analyzer
exec "$@"
