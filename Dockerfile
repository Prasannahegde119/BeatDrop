# Production Dockerfile for BeatDrop on Render.com
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=10000 \
    PATH="/root/.deno/bin:$PATH"

# Install system dependencies: FFmpeg, Node.js, Curl, Unzip, CA-Certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Deno JS engine for yt-dlp runtime
RUN curl -fsSL https://deno.land/install.sh | sh

# Set working directory
WORKDIR /app

# Copy requirement definitions
COPY requirements.txt .

# Install Python packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Ensure storage directories exist
RUN mkdir -p downloads data

# Expose Render default web port
EXPOSE 10000

# Run with Gunicorn WSGI server
CMD ["gunicorn", "--workers=2", "--threads=4", "--bind=0.0.0.0:10000", "--timeout=300", "app:app"]
