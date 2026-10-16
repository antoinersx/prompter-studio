#!/bin/bash
# Double-click to start Prompter Studio. Keep this Terminal window open while you record.
cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT/index.html"

if ! curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  PY=""
  for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$HOME/.homebrew/bin/python3" /usr/bin/python3; do
    if [ -x "$p" ] && "$p" -c "import http.server" 2>/dev/null; then PY="$p"; break; fi
  done
  NODE=""
  for n in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.homebrew/bin/node" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1); do
    if [ -x "$n" ]; then NODE="$n"; break; fi
  done
  if [ -n "$PY" ]; then
    "$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  elif [ -n "$NODE" ]; then
    "$NODE" serve.js "$PORT" >/dev/null 2>&1 &
  else
    echo "Couldn't find python3 or node to run the local server."; read -r; exit 1
  fi
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null' EXIT
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "$URL" && break; sleep 0.3; done
fi

open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
echo ""
echo "  Prompter Studio is running at $URL"
echo "  Keep this window open while recording. Close it when you're done."
echo ""
wait
