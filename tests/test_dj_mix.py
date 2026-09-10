import os

from app import DOWNLOAD_DIR, app, build_mix_filter, library_entries, merge_audio_tracks


def test_build_mix_filter_creates_crossfade_chain():
    result = build_mix_filter(["track1.mp3", "track2.mp3", "track3.mp3"], fade_duration=1.2)

    assert "acrossfade=d=1.2" in result
    assert result.count("acrossfade") == 2
    assert "[mix1]" in result
    assert "[mix2]" in result
    assert "[mix1:a]" not in result
    assert "[mix2:a]" not in result


def test_merge_audio_tracks_accepts_download_paths(tmp_path):
    audio_a = tmp_path / "a.mp3"
    audio_b = tmp_path / "b.mp3"

    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=440:duration=0.2 -q:a 9 {audio_a} >/dev/null 2>&1")
    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=660:duration=0.2 -q:a 9 {audio_b} >/dev/null 2>&1")

    output_name = merge_audio_tracks([str(audio_a), str(audio_b)], fade_duration=0.4)

    assert output_name.endswith('.mp3')
    assert os.path.exists(os.path.join(DOWNLOAD_DIR, output_name))


def test_library_entries_keeps_generated_mix_files_visible(tmp_path):
    mix_file = tmp_path / 'dj-mix-test.mp3'
    mix_file.write_bytes(b'not-real-mp3')
    real_song = tmp_path / 'real-song.mp3'
    real_song.write_bytes(b'valid-mp3-data')

    import app as app_module
    original_dir = app_module.DOWNLOAD_DIR
    app_module.DOWNLOAD_DIR = str(tmp_path)
    try:
        result = library_entries()
    finally:
        app_module.DOWNLOAD_DIR = original_dir

    assert any(item['name'].startswith('dj-mix-') for item in result)
    assert any(item['name'] == 'real-song.mp3' for item in result)


def test_mix_audio_requires_selected_tracks():
    client = app.test_client()
    response = client.post('/api/mix-audio', json={'files': []})

    assert response.status_code == 400
    payload = response.get_json()
    assert 'select at least one song' in payload['error'].lower()


def test_mix_audio_starts_background_task():
    client = app.test_client()
    response = client.post('/api/mix-audio', json={'files': ['song1.mp3', 'song2.mp3']})

    assert response.status_code == 202
    payload = response.get_json()
    assert payload['success'] is True
    assert 'task_id' in payload
    assert payload['status'] in {'queued', 'processing'}


def test_merge_audio_tracks_uses_words_from_each_song_name(tmp_path):
    audio_a = tmp_path / 'sunset-love.mp3'
    audio_b = tmp_path / 'midnight-dance.mp3'

    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=440:duration=0.2 -q:a 9 {audio_a} >/dev/null 2>&1")
    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=660:duration=0.2 -q:a 9 {audio_b} >/dev/null 2>&1")

    output_name = merge_audio_tracks([str(audio_a), str(audio_b)], fade_duration=0.4)

    assert output_name.endswith('.mp3')
    assert 'sunset' in output_name.lower()
    assert 'midnight' in output_name.lower()
    assert 'mashup' in output_name.lower()


def test_merge_audio_tracks_writes_clean_metadata_and_custom_title(tmp_path):
    from mutagen.id3 import ID3

    audio_a = tmp_path / 'sunset-love.mp3'
    audio_b = tmp_path / 'midnight-dance.mp3'

    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=440:duration=0.2 -q:a 9 {audio_a} >/dev/null 2>&1")
    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=660:duration=0.2 -q:a 9 {audio_b} >/dev/null 2>&1")

    output_name = merge_audio_tracks(
        [str(audio_a), str(audio_b)],
        fade_duration=0.4,
        title='Night Drive Session',
        artist='DJ Vega',
    )

    assert output_name == 'Night Drive Session.mp3'

    tags = ID3(os.path.join(DOWNLOAD_DIR, output_name))
    assert tags['TIT2'].text[0] == 'Night Drive Session'
    assert tags['TPE1'].text[0] == 'DJ Vega'
    assert tags['TALB'].text[0] == 'Mashups'


def test_merge_audio_tracks_uses_compact_2_song_name_for_three_song_mix(tmp_path):
    audio_a = tmp_path / 'sunset-love.mp3'
    audio_b = tmp_path / 'midnight-dance.mp3'
    audio_c = tmp_path / 'afterglow-rain.mp3'

    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=440:duration=0.2 -q:a 9 {audio_a} >/dev/null 2>&1")
    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=660:duration=0.2 -q:a 9 {audio_b} >/dev/null 2>&1")
    os.system(f"ffmpeg -y -f lavfi -i sine=frequency=520:duration=0.2 -q:a 9 {audio_c} >/dev/null 2>&1")

    output_name = merge_audio_tracks([str(audio_a), str(audio_b), str(audio_c)], fade_duration=0.4)

    assert output_name.count('x') == 1
    assert output_name.lower().startswith('sunset') or output_name.lower().startswith('midnight')
    assert 'mashup' in output_name.lower()
    assert len(os.path.splitext(output_name)[0]) < 60
