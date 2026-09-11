import os
import sys
import re
import queue
import threading
import json
import time
import uuid
import shutil
import subprocess
import yt_dlp
from mutagen.id3 import ID3, TIT2, TPE1, TALB
from flask import Flask, render_template, request, jsonify, Response, send_from_directory, url_for

app = Flask(__name__)

# Directory setup
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, 'downloads')
DATA_DIR = os.path.join(BASE_DIR, 'data')
HISTORY_FILE = os.path.join(DATA_DIR, 'download-history.json')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

COOKIES_FILE = os.path.join(DATA_DIR, 'cookies.txt')
active_downloads = {}
active_downloads_lock = threading.Lock()
mix_jobs = {}
mix_jobs_lock = threading.Lock()
history_lock = threading.Lock()


class DownloadCancelled(Exception):
    """Raised by the progress hook when a user cancels an active transfer."""


def ensure_cookies_from_env():
    """Hydrate data/cookies.txt from environment variables if present."""
    for env_var in ['YOUTUBE_COOKIES', 'YTDLP_COOKIES', 'COOKIES_TEXT']:
        cookies_text = os.environ.get(env_var, '').strip()
        if cookies_text:
            try:
                with open(COOKIES_FILE, 'w', encoding='utf-8') as f:
                    f.write(cookies_text)
                break
            except Exception:
                pass


def get_cookies_filepath():
    """Return valid cookies file path if available and non-empty."""
    ensure_cookies_from_env()
    if os.path.exists(COOKIES_FILE) and os.path.getsize(COOKIES_FILE) > 0:
        return COOKIES_FILE
    base_cookies = os.path.join(BASE_DIR, 'cookies.txt')
    if os.path.exists(base_cookies) and os.path.getsize(base_cookies) > 0:
        return base_cookies
    return None


def build_ydl_opts(extra_opts=None, player_clients=None):
    """Build yt-dlp options with cookie file support, JS runtimes, and optimized headers."""
    if player_clients is None:
        player_clients = ['mweb', 'ios', 'android', 'tv', 'web']

    opts = {
        'quiet': True,
        'nocheckcertificate': True,
        'geo_bypass': True,
        'socket_timeout': 30,
        'retries': 5,
        'fragment_retries': 5,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        'js_runtimes': {'deno': {}, 'node': {}},
        'extractor_args': {
            'youtube': {
                'player_client': player_clients,
            }
        },
    }

    cookies_path = get_cookies_filepath()
    if cookies_path:
        opts['cookiefile'] = cookies_path

    if extra_opts:
        opts.update(extra_opts)
    return opts



def load_history():
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as history_file:
            history = json.load(history_file)
            return history if isinstance(history, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def save_history(history):
    temporary_file = f'{HISTORY_FILE}.tmp'
    with open(temporary_file, 'w', encoding='utf-8') as history_file:
        json.dump(history[:100], history_file, ensure_ascii=False, indent=2)
    os.replace(temporary_file, HISTORY_FILE)


def add_history_entry(title, filename, mode):
    path = os.path.join(DOWNLOAD_DIR, filename)
    with history_lock:
        history = load_history()
        history.insert(0, {
            'id': str(uuid.uuid4()),
            'title': title,
            'filename': filename,
            'type': mode,
            'size': format_bytes(os.path.getsize(path)) if os.path.exists(path) else 'Unknown',
            'created': time.time(),
        })
        save_history(history)


def build_history_from_downloads():
    entries = []
    for filename in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, filename)
        if not os.path.isfile(path):
            continue
        extension = os.path.splitext(filename)[1].lower()
        if extension not in ['.mp3', '.mp4']:
            continue
        entries.append({
            'id': str(uuid.uuid4()),
            'title': os.path.splitext(filename)[0],
            'filename': filename,
            'type': 'audio' if extension == '.mp3' else 'video',
            'size': format_bytes(os.path.getsize(path)),
            'created': os.path.getmtime(path),
        })
    return sorted(entries, key=lambda entry: entry['created'], reverse=True)


def build_mix_filter(file_count, fade_duration=1.2):
    """Build an ffmpeg audio crossfade chain for a DJ-style track sequence."""
    if isinstance(file_count, (list, tuple)):
        file_count = len(file_count)

    if file_count <= 1:
        return ""

    filter_parts = []
    previous_label = "0"  # first input stream label
    for index in range(1, file_count):
        current_label = f"mix{index}"
        if index == 1:
            filter_parts.append(f"[{previous_label}:a][{index}:a]acrossfade=d={fade_duration}[{current_label}]")
        else:
            filter_parts.append(f"[{previous_label}][{index}:a]acrossfade=d={fade_duration}[{current_label}]")
        previous_label = current_label

    return ';'.join(filter_parts)


def resolve_download_path(file_name):
    if not isinstance(file_name, str) or not file_name.strip():
        raise ValueError('Invalid file reference.')

    normalized = os.path.normpath(file_name)
    if normalized.startswith(os.sep):
        candidate = normalized
    elif normalized.startswith('downloads' + os.sep) or normalized == 'downloads':
        candidate = os.path.join(BASE_DIR, normalized)
    else:
        candidate = os.path.join(DOWNLOAD_DIR, os.path.basename(normalized))

    resolved = os.path.abspath(candidate)
    if not os.path.exists(resolved):
        raise ValueError(f'Invalid file reference: {file_name}')

    return resolved


def is_generated_mix_file(filename):
    base_name = os.path.basename(filename).lower()
    return base_name.startswith('dj-mix-') or base_name.endswith('(mashup).mp3')


def sanitize_mix_title(value):
    if value is None:
        return 'Mashup'

    cleaned = str(value).strip()
    cleaned = cleaned.replace('_', ' ')
    cleaned = cleaned.replace('/', ' ')
    cleaned = re.sub(r'\(\s*mashup\s*\)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'[:<>"\\|?*]+', ' ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = cleaned.strip(' .')
    return cleaned or 'Mashup'


def build_output_mix_name(file_names, title=None):
    if title is not None:
        sanitized_title = sanitize_mix_title(title)
        if sanitized_title.lower().endswith('.mp3'):
            sanitized_title = os.path.splitext(sanitized_title)[0]
        return f'{sanitized_title}.mp3'

    song_names = []
    seen = set()
    for file_name in file_names[:2]:
        song_name = os.path.splitext(os.path.basename(file_name))[0]
        song_name = sanitize_mix_title(song_name)
        cleaned_tokens = [token for token in re.split(r'\s+|[-_]+', song_name) if token]
        filtered_tokens = []
        for token in cleaned_tokens:
            normalized = token.lower()
            if normalized in {'mp3', 'mix', 'mashup', 'dj'}:
                continue
            if len(normalized) <= 2 and normalized not in {'ah', 'oh', 'up'}:
                continue
            filtered_tokens.append(token)

        title_piece = ' '.join(filtered_tokens[:2]).strip()
        normalized = title_piece.lower()
        if not title_piece or normalized in {'mp3', 'mix', 'mashup'}:
            continue
        if normalized not in seen:
            seen.add(normalized)
            song_names.append(title_piece)

    if not song_names:
        return 'Mashup.mp3'

    mix_title = ' x '.join(song_names)
    mix_title = sanitize_mix_title(mix_title)
    return f'{mix_title} (Mashup).mp3'


def write_mp3_metadata(file_path, title, artist='Unknown Artist', album='Mashups'):
    if not file_path or not os.path.exists(file_path):
        return

    file_title = sanitize_mix_title(title)
    artist_name = sanitize_mix_title(artist) or 'Unknown Artist'
    album_name = sanitize_mix_title(album) or 'Mashups'

    try:
        tags = ID3(file_path)
    except Exception:
        tags = ID3()

    tags['TIT2'] = TIT2(encoding=3, text=[file_title])
    tags['TPE1'] = TPE1(encoding=3, text=[artist_name])
    tags['TALB'] = TALB(encoding=3, text=[album_name])
    tags.save(file_path)


def make_mix_name(file_names):
    return build_output_mix_name(file_names)


def merge_audio_tracks(file_names, fade_duration=1.2, output_name=None, title=None, artist='Unknown Artist'):
    if not file_names:
        raise ValueError('Please select at least one audio file to merge.')

    safe_files = []
    for file_name in file_names:
        if is_generated_mix_file(file_name):
            continue

        try:
            full_path = resolve_download_path(file_name)
        except ValueError:
            raise ValueError(f'Invalid file reference: {file_name}')

        if not os.path.exists(full_path):
            raise FileNotFoundError(f'Audio file not found: {os.path.basename(full_path)}')
        if os.path.splitext(full_path)[1].lower() != '.mp3':
            raise ValueError(f'Only MP3 files can be mixed: {os.path.basename(full_path)}')
        safe_files.append(full_path)

    if not safe_files:
        raise ValueError('No valid MP3 files were selected for the DJ mix.')

    if shutil.which('ffmpeg') is None:
        raise RuntimeError('ffmpeg is not installed or not available on PATH.')

    title_override = title if title is not None else output_name
    output_name = build_output_mix_name(safe_files, title=title_override)
    output_path = os.path.join(DOWNLOAD_DIR, output_name)
    if os.path.exists(output_path):
        os.remove(output_path)

    if len(safe_files) == 1:
        shutil.copy2(safe_files[0], output_path)
        write_mp3_metadata(output_path, title=os.path.splitext(output_name)[0], artist=artist, album='Mashups')
        return output_name

    ffmpeg_cmd = ['ffmpeg', '-y']
    for audio_path in safe_files:
        ffmpeg_cmd.extend(['-i', audio_path])

    filter_string = build_mix_filter(len(safe_files), fade_duration=fade_duration)
    final_label = f"mix{len(safe_files) - 1}"
    ffmpeg_cmd.extend([
        '-filter_complex', filter_string,
        '-map', f'[{final_label}]',
        '-c:a', 'libmp3lame',
        '-q:a', '2',
        output_path,
    ])

    try:
        subprocess.run(ffmpeg_cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        error_text = exc.stderr.strip() or exc.stdout.strip() or str(exc)
        raise RuntimeError(f'Unable to create DJ mix: {error_text}') from exc

    write_mp3_metadata(output_path, title=os.path.splitext(output_name)[0], artist=artist, album='Mashups')
    return output_name


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static', 'images'),
                               'beatdrop-icon.svg', mimetype='image/svg+xml')

@app.route('/manifest.json')
def manifest():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                               'manifest.json', mimetype='application/manifest+json')

@app.route('/sw.js')
def service_worker():
    response = send_from_directory(os.path.join(app.root_path, 'static'),
                                   'sw.js', mimetype='application/javascript')
    response.headers['Service-Worker-Allowed'] = '/'
    return response

@app.route('/.well-known/appspecific/com.chrome.devtools.json')
def chrome_devtools_json():
    return jsonify({}), 200

@app.errorhandler(404)
def page_not_found(e):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Endpoint not found'}), 404
    return render_template('index.html')

@app.route('/api/search', methods=['GET'])
def search():
    query = request.args.get('q', '')
    if not query:
        return jsonify({'error': 'Query parameter "q" is required'}), 400

    client_attempts = [
        ['mweb', 'ios', 'android', 'tv', 'web'],
        ['tv_embedded', 'mweb', 'ios', 'android'],
        ['android', 'ios', 'tv'],
    ]

    last_error = None
    for clients in client_attempts:
        ydl_opts = build_ydl_opts({
            'extract_flat': 'in_playlist',
            'skip_download': True,
        }, player_clients=clients)

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                search_result = ydl.extract_info(f"ytsearch5:{query}", download=False)
                entries = search_result.get('entries', [])

                results = []
                for entry in entries:
                    if not entry:
                        continue
                    results.append({
                        'id': entry.get('id'),
                        'title': entry.get('title'),
                        'duration': entry.get('duration'),
                        'uploader': entry.get('uploader'),
                        'url': f"https://www.youtube.com/watch?v={entry.get('id')}",
                        'thumbnail': f"https://i.ytimg.com/vi/{entry.get('id')}/hqdefault.jpg"
                    })
                return jsonify(results)
        except Exception as e:
            last_error = e

    error_msg = str(last_error) if last_error else "Search failed"
    if 'Sign in to confirm' in error_msg or 'bot' in error_msg.lower():
        error_msg = "YouTube bot detection triggered on cloud server. Please set YouTube cookies in BeatDrop Cookie Settings or set YOUTUBE_COOKIES env var on Render."
    return jsonify({'error': error_msg}), 500


def run_download_task(url, mode, q, task_id, cancel_event):
    temp_dir = os.path.join(DOWNLOAD_DIR, '.tmp')
    os.makedirs(temp_dir, exist_ok=True)

    def progress_hook(d):
        if cancel_event.is_set():
            raise DownloadCancelled()

        if d['status'] == 'downloading':
            downloaded = d.get('downloaded_bytes', 0)
            total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
            percent = (downloaded / total * 100) if total else 0
            speed = d.get('speed', 0)
            eta = d.get('eta', 0)

            progress_data = {
                'status': 'downloading',
                'percent': round(percent, 1),
                'downloaded_formatted': format_bytes(downloaded),
                'total_formatted': format_bytes(total) if total else 'Unknown',
                'speed_formatted': format_speed(speed) if speed else '0 KB/s',
                'eta_formatted': format_eta(eta) if eta else 'Unknown'
            }
            q.put(progress_data)
        elif d['status'] == 'finished':
            q.put({'status': 'processing', 'message': 'Processing audio stream...'})

    def postprocessor_hook(d):
        if cancel_event.is_set():
            raise DownloadCancelled()
        if d.get('status') == 'started':
            q.put({'status': 'processing', 'message': 'Converting audio format with FFmpeg...'})
        elif d.get('status') == 'finished':
            q.put({'status': 'processing', 'message': 'Writing ID3 tags and finalizing file...'})

    client_attempts = [
        ['mweb', 'ios', 'android', 'tv', 'web'],
        ['tv_embedded', 'mweb', 'ios', 'android'],
        ['android', 'ios', 'tv'],
    ]

    last_error = None
    download_success = False

    for clients in client_attempts:
        if cancel_event.is_set():
            q.put({'status': 'cancelled', 'message': 'Download cancelled'})
            return

        extra_opts = {
            'paths': {
                'home': DOWNLOAD_DIR,
                'temp': temp_dir,
            },
            'outtmpl': '%(title)s.%(ext)s',
            'keepvideo': False,
            'progress_hooks': [progress_hook],
            'postprocessor_hooks': [postprocessor_hook],
        }

        if mode == 'audio':
            extra_opts.update({
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
            })
        else:
            extra_opts.update({
                'format': 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[vcodec^=avc1]+bestaudio/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'postprocessors': [{
                    'key': 'FFmpegVideoConvertor',
                    'preferedformat': 'mp4',
                }],
            })

        ydl_opts = build_ydl_opts(extra_opts, player_clients=clients)

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                title = info.get('title', 'Unknown Title')
                filename = ydl.prepare_filename(info)
                if mode == 'audio':
                    filename = os.path.splitext(filename)[0] + '.mp3'

                q.put({
                    'status': 'starting',
                    'title': title,
                    'filename': os.path.basename(filename)
                })

                ydl.download([url])

                if cancel_event.is_set():
                    raise DownloadCancelled()

                final_filename = os.path.basename(filename)
                target_ext = '.mp3' if mode == 'audio' else '.mp4'
                if not os.path.exists(os.path.join(DOWNLOAD_DIR, final_filename)):
                    base_stem = os.path.splitext(final_filename)[0][:12].lower()
                    for file_in_dir in os.listdir(DOWNLOAD_DIR):
                        if file_in_dir.endswith(target_ext) and (base_stem in file_in_dir.lower()):
                            final_filename = file_in_dir
                            break

                if mode == 'audio':
                    base_stem = os.path.splitext(final_filename)[0]
                    for file_in_dir in os.listdir(DOWNLOAD_DIR):
                        if file_in_dir != final_filename and os.path.splitext(file_in_dir)[0] == base_stem:
                            ext_check = os.path.splitext(file_in_dir)[1].lower()
                            if ext_check in ['.webm', '.m4a', '.mp4', '.mkv', '.3gp']:
                                try:
                                    os.remove(os.path.join(DOWNLOAD_DIR, file_in_dir))
                                except Exception:
                                    pass

                add_history_entry(title, final_filename, mode)

                q.put({
                    'status': 'completed',
                    'title': title,
                    'filename': final_filename
                })
                download_success = True
                break
        except DownloadCancelled:
            q.put({'status': 'cancelled', 'message': 'Download cancelled'})
            return
        except Exception as e:
            last_error = e
            if cancel_event.is_set():
                q.put({'status': 'cancelled', 'message': 'Download cancelled'})
                return
            err_str = str(e)
            if 'Sign in to confirm' in err_str or 'bot' in err_str.lower():
                continue
            break

    if not download_success:
        err_msg = str(last_error) if last_error else 'Download failed.'
        if 'Sign in to confirm' in err_msg or 'bot' in err_msg.lower():
            err_msg = "Sign in to confirm you're not a bot (Render cloud IP block). Please upload YouTube cookies in BeatDrop Cookie Settings or set YOUTUBE_COOKIES env var on Render."
        q.put({
            'status': 'error',
            'message': err_msg
        })

    with active_downloads_lock:
        active_downloads.pop(task_id, None)


@app.route('/api/cookies', methods=['GET'])
def get_cookies_info():
    cookies_path = get_cookies_filepath()
    if not cookies_path:
        return jsonify({
            'has_cookies': False,
            'lines': 0,
            'message': 'No YouTube cookies loaded'
        })
    try:
        with open(cookies_path, 'r', encoding='utf-8') as f:
            lines = [l for l in f.readlines() if l.strip() and not l.strip().startswith('#')]
        return jsonify({
            'has_cookies': True,
            'lines': len(lines),
            'file_size': format_bytes(os.path.getsize(cookies_path)),
            'updated_at': os.path.getmtime(cookies_path)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/cookies', methods=['POST'])
def save_cookies():
    cookies_text = None
    if request.is_json:
        cookies_text = request.json.get('cookies')
    elif 'file' in request.files:
        file = request.files['file']
        cookies_text = file.read().decode('utf-8', errors='ignore')
    elif 'cookies' in request.form:
        cookies_text = request.form.get('cookies')

    if not cookies_text or not cookies_text.strip():
        return jsonify({'error': 'No cookies content provided'}), 400

    cookies_text = cookies_text.strip()
    try:
        with open(COOKIES_FILE, 'w', encoding='utf-8') as f:
            f.write(cookies_text)

        valid_lines = [l for l in cookies_text.splitlines() if l.strip() and not l.strip().startswith('#')]
        return jsonify({
            'success': True,
            'message': 'YouTube cookies saved successfully!',
            'lines': len(valid_lines)
        })
    except Exception as e:
        return jsonify({'error': f'Failed to save cookies: {str(e)}'}), 500


@app.route('/api/cookies', methods=['DELETE'])
def delete_cookies():
    try:
        if os.path.exists(COOKIES_FILE):
            os.remove(COOKIES_FILE)
        base_cookies = os.path.join(BASE_DIR, 'cookies.txt')
        if os.path.exists(base_cookies):
            os.remove(base_cookies)
        return jsonify({'success': True, 'message': 'Cookies cleared successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Helper formatting functions
def format_bytes(b):
    if b is None:
        return 'Unknown'
    for unit in ['B', 'KB', 'MB', 'GB']:
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"

def format_speed(s):
    if s is None:
        return '0 KB/s'
    for unit in ['B/s', 'KB/s', 'MB/s']:
        if s < 1024:
            return f"{s:.1f} {unit}"
        s /= 1024
    return f"{s:.1f} GB/s"

def format_eta(seconds):
    if seconds is None:
        return 'Unknown'
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    seconds = seconds % 60
    return f"{minutes}m {seconds}s"

@app.route('/api/download', methods=['GET'])
def download():
    url = request.args.get('url', '')
    mode = request.args.get('mode', 'audio')
    task_id = request.args.get('task_id', '')
    
    if not url:
        return jsonify({'error': 'URL parameter is required'}), 400
    if mode not in ['audio', 'video']:
        return jsonify({'error': 'Invalid download mode. Must be "audio" or "video"'}), 400

    if not task_id or len(task_id) > 80 or not task_id.replace('-', '').replace('_', '').isalnum():
        return jsonify({'error': 'Invalid download task ID'}), 400

    q = queue.Queue()
    cancel_event = threading.Event()
    with active_downloads_lock:
        if task_id in active_downloads:
            return jsonify({'error': 'A download with this task ID already exists'}), 409
        active_downloads[task_id] = cancel_event

    thread = threading.Thread(target=run_download_task, args=(url, mode, q, task_id, cancel_event), daemon=True)
    thread.start()

    def sse_generator():
        while True:
            try:
                data = q.get(timeout=10)
                yield f"data: {json.dumps(data)}\n\n"
                if data.get('status') in ['completed', 'error', 'cancelled']:
                    break
            except queue.Empty:
                if not thread.is_alive():
                    yield f"data: {json.dumps({'status': 'error', 'message': 'Download process stopped.'})}\n\n"
                    break
                yield ": keep-alive\n\n"
            except GeneratorExit:
                break

    return Response(
        sse_generator(),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@app.route('/api/download/<task_id>/cancel', methods=['POST'])
def cancel_download(task_id):
    with active_downloads_lock:
        cancel_event = active_downloads.get(task_id)

    if not cancel_event:
        return jsonify({'error': 'Download is no longer active'}), 404

    cancel_event.set()
    return jsonify({'success': True, 'message': 'Cancelling download'})


@app.route('/api/history', methods=['GET'])
def download_history():
    with history_lock:
        history = load_history()
        if not history:
            history = build_history_from_downloads()
            if history:
                save_history(history)
        return jsonify(history)

@app.route('/api/library', methods=['GET'])
def library():
    files = []
    try:
        for f in os.listdir(DOWNLOAD_DIR):
            if f.startswith('.') or f.endswith('.part') or f.endswith('.ytdl') or f.endswith('.tmp'):
                continue
            path = os.path.join(DOWNLOAD_DIR, f)
            if os.path.isfile(path):
                ext = os.path.splitext(f)[1].lower()
                if ext not in ['.mp3', '.mp4']:
                    continue
                stat = os.stat(path)
                files.append({
                    'name': f,
                    'size': format_bytes(stat.st_size),
                    'bytes': stat.st_size,
                    'created': stat.st_mtime,
                    'type': 'audio' if ext == '.mp3' else 'video'
                })
        # Sort by creation time (newest first)
        files.sort(key=lambda x: x['created'], reverse=True)
        return jsonify(files)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/play/<path:filename>', methods=['GET'])
def play(filename):
    try:
        path = resolve_download_path(filename)
    except Exception:
        return jsonify({'error': 'File not found'}), 404

    if not os.path.isfile(path):
        return jsonify({'error': 'File not found'}), 404

    file_size = os.path.getsize(path)
    range_header = request.headers.get('Range', None)
    ext = os.path.splitext(filename)[1].lower()
    mimetype = 'audio/mpeg' if ext == '.mp3' else 'video/mp4' if ext == '.mp4' else 'application/octet-stream'

    if not range_header:
        response = send_from_directory(DOWNLOAD_DIR, os.path.basename(path), conditional=True)
        response.headers['Accept-Ranges'] = 'bytes'
        response.headers['Content-Type'] = mimetype
        return response

    try:
        bytes_str = range_header.replace('bytes=', '')
        parts = bytes_str.split('-')
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
    except ValueError:
        start = 0
        end = file_size - 1

    if start >= file_size:
        return Response(status=416, headers={'Content-Range': f'bytes */{file_size}'})

    end = min(end, file_size - 1)
    length = end - start + 1

    with open(path, 'rb') as f:
        f.seek(start)
        data = f.read(length)

    rv = Response(data, 206, mimetype=mimetype, content_type=mimetype, direct_passthrough=True)
    rv.headers.add('Content-Range', f'bytes {start}-{end}/{file_size}')
    rv.headers.add('Accept-Ranges', 'bytes')
    rv.headers.add('Content-Length', str(length))
    return rv

@app.route('/api/delete/<path:filename>', methods=['DELETE'])
def delete_file(filename):
    try:
        path = os.path.join(DOWNLOAD_DIR, filename)
        if os.path.exists(path):
            os.remove(path)
            return jsonify({'success': True, 'message': f'Deleted {filename}'})
        else:
            return jsonify({'error': 'File not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/mix-audio', methods=['POST'])
def mix_audio():
    payload = request.get_json(silent=True) or {}
    file_names = payload.get('files', [])
    if not isinstance(file_names, list):
        return jsonify({'error': 'Expected a list of audio files to mix.'}), 400

    if not file_names:
        return jsonify({'error': 'Please select at least one song before creating a DJ mix.'}), 400

    fade_duration = payload.get('fade_duration', 1.2)
    title = payload.get('title')
    artist = payload.get('artist') or 'Unknown Artist'
    try:
        fade_duration = float(fade_duration)
    except (TypeError, ValueError):
        fade_duration = 1.2

    file_names = [
        name for name in file_names
        if isinstance(name, str)
        and os.path.splitext(name)[1].lower() == '.mp3'
        and not is_generated_mix_file(name)
    ]

    if not file_names:
        return jsonify({'error': 'Please select at least one valid MP3 song before creating a DJ mix.'}), 400

    task_id = f"mix-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    update_mix_job(task_id, status='queued', progress=5)

    thread = threading.Thread(
        target=run_mix_task,
        args=(file_names, fade_duration, task_id, title, artist),
        daemon=True,
    )
    thread.start()

    return jsonify({
        'success': True,
        'task_id': task_id,
        'status': 'queued',
        'message': 'DJ mix started in the background.'
    }), 202


@app.route('/api/mix-audio-sync', methods=['POST'])
def mix_audio_sync():
    """Synchronous DJ mix endpoint: merges selected MP3s and returns the output filename and play URL.

    Use when the client prefers an immediate blocking response instead of a background task.
    """
    payload = request.get_json(silent=True) or {}
    file_names = payload.get('files', [])
    if not isinstance(file_names, list):
        return jsonify({'error': 'Expected a list of audio files to mix.'}), 400

    if not file_names:
        return jsonify({'error': 'Please select at least one song before creating a DJ mix.'}), 400

    fade_duration = payload.get('fade_duration', 1.2)
    title = payload.get('title')
    artist = payload.get('artist') or 'Unknown Artist'
    try:
        fade_duration = float(fade_duration)
    except (TypeError, ValueError):
        fade_duration = 1.2

    # Filter only valid mp3 names (allow full paths too)
    file_names = [
        name for name in file_names
        if isinstance(name, str) and os.path.splitext(name)[1].lower() == '.mp3'
    ]

    if not file_names:
        return jsonify({'error': 'Please select at least one valid MP3 song before creating a DJ mix.'}), 400

    try:
        output_filename = merge_audio_tracks(file_names, fade_duration=fade_duration, title=title, artist=artist)
        # Add to history so the client will see the result in /api/history
        add_history_entry(title or os.path.splitext(output_filename)[0], output_filename, 'audio')

        play_url = url_for('play', filename=output_filename)
        return jsonify({'success': True, 'filename': output_filename, 'url': play_url}), 200
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


def get_mix_job(task_id):
    with mix_jobs_lock:
        return dict(mix_jobs.get(task_id, {}))


def update_mix_job(task_id, status=None, progress=None, filename=None, error=None):
    with mix_jobs_lock:
        job = mix_jobs.setdefault(task_id, {})
        if status is not None:
            job['status'] = status
        if progress is not None:
            job['progress'] = max(0, min(100, int(progress)))
        if filename is not None:
            job['filename'] = filename
        if error is not None:
            job['error'] = error
        job['updated_at'] = time.time()
        return dict(job)


def run_mix_task(file_names, fade_duration, task_id, title=None, artist='Unknown Artist'):
    update_mix_job(task_id, status='processing', progress=10)
    try:
        filename = merge_audio_tracks(file_names, fade_duration=fade_duration, title=title, artist=artist)
        update_mix_job(task_id, status='completed', progress=100, filename=filename)
    except Exception as exc:
        update_mix_job(task_id, status='failed', progress=100, error=str(exc))


@app.route('/api/mix-status/<task_id>', methods=['GET'])
def mix_status(task_id):
    job = get_mix_job(task_id)
    if not job:
        return jsonify({'error': 'Mix task not found'}), 404
    return jsonify({
        'task_id': task_id,
        'status': job.get('status', 'queued'),
        'progress': job.get('progress', 0),
        'filename': job.get('filename'),
        'error': job.get('error'),
    })


def library_entries():
    files = []
    for f in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, f)
        if os.path.isfile(path):
            stat = os.stat(path)
            ext = os.path.splitext(f)[1].lower()
            media_type = 'audio' if ext == '.mp3' else 'video' if ext == '.mp4' else 'other'
            files.append({
                'name': f,
                'size': format_bytes(stat.st_size),
                'bytes': stat.st_size,
                'created': stat.st_mtime,
                'type': media_type,
            })
    files.sort(key=lambda x: x['created'], reverse=True)
    return files


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
