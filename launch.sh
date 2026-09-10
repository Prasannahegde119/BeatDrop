#!/usr/bin/env bash
# Starts BeatDrop, then opens it in the default web browser.
set -u

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_URL="http://127.0.0.1:5000"
VENV_PYTHON="$APP_DIR/venv/bin/python"

cd "$APP_DIR"

server_is_ready() {
    command -v curl >/dev/null 2>&1 && curl --silent --fail --max-time 1 "$APP_URL" >/dev/null 2>&1
}

if server_is_ready; then
    echo "BeatDrop is already running."
else
    if [ ! -x "$VENV_PYTHON" ]; then
        echo "Creating the Python environment..."
        if ! python3 -m venv venv; then
            echo "Unable to create the Python environment. Install Python 3 and try again."
            exit 1
        fi
    fi

    if ! "$VENV_PYTHON" -c 'import flask, yt_dlp' >/dev/null 2>&1; then
        echo "Installing required packages (first run only)..."
        if ! "$VENV_PYTHON" -m pip install -r requirements.txt; then
            echo "Unable to install required packages. Check your internet connection and try again."
            exit 1
        fi
    fi

    echo "Starting BeatDrop server..."
    nohup "$VENV_PYTHON" app.py >"$APP_DIR/server.log" 2>&1 &

    for _ in {1..20}; do
        if server_is_ready; then
            break
        fi
        sleep 0.5
    done

    if ! server_is_ready; then
        echo "BeatDrop did not start. See $APP_DIR/server.log for details."
        exit 1
    fi
fi

echo "Opening BeatDrop in your browser..."
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 &
elif command -v gio >/dev/null 2>&1; then
    gio open "$APP_URL" >/dev/null 2>&1 &
else
    echo "Open $APP_URL in your browser."
fi
