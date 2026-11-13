#!/usr/bin/env bash
# ===================================================
#   Starting Cheat Clip PRO (Linux / macOS)
# ===================================================
set -e

# Change directory safely to current folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==================================================="
echo "  Starting Cheat Clip PRO"
echo "==================================================="

# If local virtualenv exists, prepend to PATH
if [ -d "$SCRIPT_DIR/venv/bin" ]; then
    export PATH="$SCRIPT_DIR/venv/bin:$PATH"
elif [ -d "$SCRIPT_DIR/.venv/bin" ]; then
    export PATH="$SCRIPT_DIR/.venv/bin:$PATH"
fi

# Verify Node.js and npm
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm is not found in your system PATH!"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Run the application
exec npm run dev
