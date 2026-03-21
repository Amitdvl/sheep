#!/bin/bash
# Sheep launcher — auto-restarts on exit code 75 (restart request from dashboard)
cd "$(dirname "$0")"

while true; do
  npm run dev
  EXIT_CODE=$?

  if [ "$EXIT_CODE" -eq 75 ]; then
    echo "[sheep] Restarting..."
    sleep 1
    continue
  fi

  echo "[sheep] Exited with code $EXIT_CODE"
  break
done
