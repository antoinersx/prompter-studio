#!/bin/bash
# Double-click to start Prompter Studio. Keep this Terminal window open while you record.
cd "$(dirname "$0")" || exit 1
PORT=8765

# A token only this folder serves, so we can tell our server apart from anything else on the port.
TOKEN="ps-$$-$RANDOM$RANDOM"
echo "$TOKEN" > .ps-launch-check

ours() { [ "$(curl -s --max-time 2 "http://localhost:$1/.ps-launch-check" 2>/dev/null)" = "$TOKEN" ]; }
busy() { curl -s --max-time 2 -o /dev/null "http://localhost:$1/" 2>/dev/null; }

start_server() {
  PY=""
  for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$HOME/.homebrew/bin/python3" /usr/bin/python3; do
    if [ -x "$p" ] && "$p" -c "import http.server" 2>/dev/null; then PY="$p"; break; fi
  done
  NODE=""
  for n in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.homebrew/bin/node" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1); do
    if [ -x "$n" ]; then NODE="$n"; break; fi
  done
  if [ -n "$PY" ]; then "$PY" -m http.server "$1" --bind 127.0.0.1 >/dev/null 2>&1 &
  elif [ -n "$NODE" ]; then "$NODE" serve.js "$1" >/dev/null 2>&1 &
  else echo "Couldn't find python3 or node to run the local server."; read -r; exit 1; fi
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null; rm -f .ps-launch-check' EXIT
  for _ in $(seq 1 20); do ours "$1" && return 0; sleep 0.25; done
  return 1
}

if busy "$PORT" && ! ours "$PORT"; then
  PIDS=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')
  echo ""
  echo "  Port $PORT is already used by another program:"
  [ -n "$PIDS" ] && ps -o pid=,command= -p $(echo $PIDS | tr ' ' ',') 2>/dev/null | sed 's/^/    /'
  echo ""
  echo "  Your saved script and recordings folder belong to port $PORT."
  read -r -p "  Stop that program and use port $PORT? [Y/n] " ans
  if [ -z "$ans" ] || [[ "$ans" =~ ^[Yy] ]]; then
    [ -n "$PIDS" ] && kill $PIDS 2>/dev/null; sleep 1
  else
    for p in 8766 8767 8768 8769 8770; do if ! busy "$p"; then PORT=$p; break; fi; done
    echo "  Using port $PORT instead (settings start fresh there)."
  fi
fi

if ! ours "$PORT"; then
  if ! start_server "$PORT"; then echo "  Couldn't start the local server on port $PORT."; read -r; exit 1; fi
fi

URL="http://localhost:$PORT/index.html"
open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
echo ""
echo "  Prompter Studio is running at $URL"
echo "  Keep this window open while recording. Close it when you're done."
echo ""
wait
