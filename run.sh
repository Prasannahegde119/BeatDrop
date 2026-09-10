#!/bin/bash
# Exit on error
set -e

# Change directory to script's location
cd "$(dirname "$0")"

echo "Initializing Python Virtual Environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

echo "Activating Virtual Environment..."
source venv/bin/activate

echo "Upgrading pip and installing requirements..."
pip install --upgrade pip
pip install -r requirements.txt

echo "Starting YouTube Downloader Flask application..."
python app.py
