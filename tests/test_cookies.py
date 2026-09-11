import os
import json
import pytest
from app import app, COOKIES_FILE, ensure_cookies_from_env, get_cookies_filepath, build_ydl_opts


def test_get_cookies_filepath_when_no_cookies(tmp_path, monkeypatch):
    monkeypatch.delenv('YOUTUBE_COOKIES', raising=False)
    monkeypatch.delenv('YTDLP_COOKIES', raising=False)
    monkeypatch.delenv('COOKIES_TEXT', raising=False)
    
    if os.path.exists(COOKIES_FILE):
        try:
            os.remove(COOKIES_FILE)
        except Exception:
            pass

    assert get_cookies_filepath() is None


def test_ensure_cookies_from_env_hydrates_cookies(monkeypatch):
    fake_cookie_content = "# Netscape HTTP Cookie File\n.youtube.com TRUE / FALSE 1750000000 VISITOR_INFO1_LIVE testvalue\n"
    monkeypatch.setenv('YOUTUBE_COOKIES', fake_cookie_content)

    ensure_cookies_from_env()

    assert os.path.exists(COOKIES_FILE)
    with open(COOKIES_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    assert 'VISITOR_INFO1_LIVE' in content

    path = get_cookies_filepath()
    assert path == COOKIES_FILE

    # Cleanup
    try:
        os.remove(COOKIES_FILE)
    except Exception:
        pass


def test_build_ydl_opts_includes_js_runtimes_and_headers():
    opts = build_ydl_opts()

    assert 'remote_components' in opts
    assert 'ejs:github' in opts['remote_components']
    assert 'js_runtimes' in opts
    assert 'deno' in opts['js_runtimes']
    assert 'node' in opts['js_runtimes']
    assert 'extractor_args' in opts
    assert 'youtube' in opts['extractor_args']
    assert 'player_client' in opts['extractor_args']['youtube']


def test_cookies_api_endpoints():
    client = app.test_client()

    # GET cookies when empty
    resp = client.get('/api/cookies')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['has_cookies'] is False

    # POST cookies
    sample_text = "# Netscape HTTP Cookie File\n.youtube.com TRUE / FALSE 1750000000 TEST_COOKIE val\n"
    resp = client.post('/api/cookies', json={'cookies': sample_text})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['success'] is True
    assert data['lines'] == 1

    # GET cookies when present
    resp = client.get('/api/cookies')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['has_cookies'] is True
    assert data['lines'] == 1

    # DELETE cookies
    resp = client.delete('/api/cookies')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['success'] is True

    # Confirm deleted
    resp = client.get('/api/cookies')
    assert resp.get_json()['has_cookies'] is False
