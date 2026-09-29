"""The recorded-track engine: picking, cutting, levelling and crediting."""
import importlib
import json
import subprocess
import wave
import pytest
from tests.library_fixture import make_library


@pytest.fixture
def lib(tmp_path, monkeypatch):
    root = make_library(tmp_path / 'library')
    monkeypatch.setenv('ECHOSPHERE_LIBRARY', str(root))
    from server import config, library, media
    importlib.reload(config)
    return library, media, root


def frames(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def test_only_eligible_tracks_are_ever_chosen(lib):
    library, _, _ = lib
    assert library.counts() == {'warm': 3, 'calm': 3, 'sad': 3, 'anger': 3}
    picked = {library.choose(mood, 10.0, seed)[0]['id'] for mood in library.MOODS for seed in range(300)}
    assert picked and not any('held' in p for p in picked)


def test_the_choice_is_repeatable_and_varies_with_the_seed(lib):
    library, _, _ = lib
    assert library.choose('sad', 10.0, 5)[0]['id'] == library.choose('sad', 10.0, 5)[0]['id']
    assert len({library.choose('sad', 10.0, seed)[0]['id'] for seed in range(50)}) == 2      # both tracks that are long enough for 10 s


def test_short_tracks_are_used_only_when_nothing_is_long_enough(lib):
    library, _, _ = lib
    for seed in range(100):
        track, how = library.choose('warm', 10.0, seed)
        assert track['duration'] >= 10.5 and not how['looped']
    track, how = library.choose('warm', 30.0, 1)
    assert how['looped'] and track['duration'] == 14.0 and how['long_enough'] == 0


def test_render_cuts_to_length_levels_the_volume_and_carries_the_credit(lib, tmp_path):
    library, media, _ = lib
    levels = set()
    for seed in range(30):
        folder = tmp_path / f'out{seed}'
        folder.mkdir()
        prov = library.render({'mood': 'calm', 'duration': 10.0, 'seed': seed}, folder, lambda: None)
        assert frames(folder / 'raw.wav') >= 10.0                        # the shared finishing step trims to the exact length
        lufs = media.measure_loudness(folder / 'raw.wav')['integrated_lufs']
        assert abs(lufs - library.TARGET_LUFS) < 1.5, (prov['track']['id'], lufs)
        levels.add(round(prov['measured_lufs']))
        tags = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', str(folder / 'raw.wav')],
                                         capture_output=True, text=True).stdout)['format']['tags']
        assert 'Kevin MacLeod (incompetech.com)' in tags['comment'] and 'Edited' in tags['comment'] and tags['copyright'] == 'CC BY 4.0'
        assert prov['track']['credit'] in tags['comment'] and prov['engine'] == 'library'
    assert len(levels) == 2 and abs(max(levels) - min(levels)) > 10    # quiet and loud sources both ended up at the same level


def test_a_looped_track_still_fills_the_video(lib, tmp_path):
    library, _, _ = lib
    folder = tmp_path / 'loop'
    folder.mkdir()
    prov = library.render({'mood': 'anger', 'duration': 30.0, 'seed': 3}, folder, lambda: None)
    assert frames(folder / 'raw.wav') >= 30.0
    assert prov['selection']['looped'] and any('looped' in w for w in prov['warnings'])


def test_a_mood_with_no_approved_tracks_fails_clearly(lib):
    library, _, root = lib
    manifest = json.loads((root / 'manifest.json').read_text())
    for t in manifest['tracks']:
        if t['mood'] == 'warm':
            t['eligible'] = False
    (root / 'manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(library.LibraryError) as e:
        library.choose('warm', 10.0, 1)
    assert e.value.code == 'library_empty' and e.value.details['library']['calm'] == 3
    assert library.available() and library.choose('calm', 10.0, 1)


def test_manifest_paths_cannot_escape_the_library(lib):
    library, _, root = lib
    (root.parent / 'outside.wav').write_bytes((root / 'warm' / 'warm-0.wav').read_bytes())
    manifest = json.loads((root / 'manifest.json').read_text())
    manifest['tracks'].append({'id': 'x', 'file': '../outside.wav', 'title': 'x', 'mood': 'warm', 'folder': 'warm', 'duration': 14.0, 'eligible': True, 'features': {}})
    (root / 'manifest.json').write_text(json.dumps(manifest))
    assert all(t['id'] != 'x' for t in library.playable())


def test_a_missing_or_broken_manifest_means_unavailable(lib):
    library, _, root = lib
    (root / 'manifest.json').write_text('{not json')
    assert not library.available() and library.counts() == {'warm': 0, 'calm': 0, 'sad': 0, 'anger': 0}
    (root / 'manifest.json').unlink()
    assert not library.available()


def test_a_track_too_quiet_to_level_is_boosted_only_to_the_limit_and_says_so(tmp_path, monkeypatch):
    root = make_library(tmp_path / 'quiet', durations=(14, 14, 14), levels=(-30, -30, -30))      # about -52 LUFS: needs far more than the limit
    monkeypatch.setenv('ECHOSPHERE_LIBRARY', str(root))
    from server import config, library
    importlib.reload(config)
    folder = tmp_path / 'out'
    folder.mkdir()
    prov = library.render({'mood': 'sad', 'duration': 10.0, 'seed': 1}, folder, lambda: None)
    assert prov['gain_db'] == library.MAX_BOOST_DB
    assert any('limit' in w and 'quieter' in w for w in prov['warnings'])
