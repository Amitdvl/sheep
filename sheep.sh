#!/bin/bash
# Sheep launcher — auto-restarts on exit code 75 (restart request from dashboard)
cd "$(dirname "$0")"

if [ -n "${SHEEP_PACKAGE_MANAGER:-}" ] && command -v "$SHEEP_PACKAGE_MANAGER" >/dev/null 2>&1; then
  RUN_DEV="$SHEEP_PACKAGE_MANAGER"
elif [ -f package-lock.json ] && { [ ! -f pnpm-lock.yaml ] || [ package-lock.json -nt pnpm-lock.yaml ]; } && command -v npm >/dev/null 2>&1; then
  RUN_DEV="npm"
elif command -v pnpm >/dev/null 2>&1; then
  RUN_DEV="pnpm"
elif command -v npm >/dev/null 2>&1; then
  RUN_DEV="npm"
else
  echo "[sheep] Neither pnpm nor npm is installed"
  exit 1
fi

if [ "$RUN_DEV" = "pnpm" ]; then
  DEV_COMMAND=(pnpm dev)
elif [ "$RUN_DEV" = "npm" ]; then
  DEV_COMMAND=(npm run dev)
else
  echo "[sheep] Unsupported package manager: $RUN_DEV"
  exit 1
fi

while true; do
  "${DEV_COMMAND[@]}"
  EXIT_CODE=$?

  if [ "$EXIT_CODE" -eq 75 ]; then
    echo "[sheep] Restarting..."
    sleep 1
    continue
  fi

  echo "[sheep] Exited with code $EXIT_CODE"
  break
done
