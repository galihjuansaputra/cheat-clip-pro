#!/usr/bin/env bash
# ===================================================
#   Updating Cheat Clip PRO to Latest Version (Linux / macOS)
# ===================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==================================================="
echo "  Updating Cheat Clip PRO to Latest Version"
echo "==================================================="

# Setup virtual environment path
if [ -d "$SCRIPT_DIR/venv/bin" ]; then
    export PATH="$SCRIPT_DIR/venv/bin:$PATH"
    PY_BIN="$SCRIPT_DIR/venv/bin/python"
elif [ -d "$SCRIPT_DIR/.venv/bin" ]; then
    export PATH="$SCRIPT_DIR/.venv/bin:$PATH"
    PY_BIN="$SCRIPT_DIR/.venv/bin/python"
else
    PY_BIN="python3"
fi

# Run Git Pull
if command -v git &> /dev/null; then
    echo "[1/3] Pulling latest code from Git..."
    git pull origin master || echo "[!] Git pull failed or has local conflicts."
else
    echo "[!] Git not in PATH, skipping git pull..."
fi

# Install Node dependencies
echo ""
echo "[2/3] Checking Node modules..."
npm install

# Install Python dependencies
echo ""
echo "[3/3] Checking Python dependencies..."
$PY_BIN -m pip install -r "$SCRIPT_DIR/backend/requirements.txt"

echo ""
echo "==================================================="
echo "  Update completed successfully!"
echo "==================================================="
