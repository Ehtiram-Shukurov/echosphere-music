"""Recorded-track engine: pick a track from the mood's library folder and cut it to the video.

The library is a folder of licensed recordings plus a manifest.json written by
tools/build_music_manifest.py. Only tracks the manifest marks `eligible` are ever
played. Nothing is generated: the music is a real recording, trimmed from its start
(minus any digital silence) to the video's length, levelled to a common loudness, and
faded by the same finishing step every engine goes through. The track's credit line is
written into the audio's metadata so it travels with every exported WAV and MP4.
"""
import hashlib
import json
from . import auto, config, media

MOODS = ('warm', 'calm', 'sad', 'anger')
TARGET_LUFS = -20.0          # about where the instrument composer's output sits
MAX_BOOST_DB, MAX_CUT_DB = 18.0, 12.0
END_MARGIN = .5              # a track must outlast the video by this much to avoid looping
EDIT_NOTE = 'Edited: shortened and faded to fit the video.'


class LibraryError(auto.AutoFailure):
    """The library cannot supply a track. `code` is machine readable."""


def load_manifest():
    path = config.LIBRARY_DIR / 'manifest.json'
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def _inside(path):
    try:
        return path.resolve().is_relative_to(config.LIBRARY_DIR.resolve())
    except OSError:
        return False


def playable(manifest=None):
    """Eligible tracks whose files exist inside the library folder."""
    manifest = manifest if manifest is not None else load_manifest()
    found = []
    for t in (manifest or {}).get('tracks', []):
        if t.get('eligible') and t.get('mood') in MOODS:
            path = config.LIBRARY_DIR / t['file']
            if _inside(path) and path.is_file():
                found.append(t)
    return found


def counts():
    out = {m: 0 for m in MOODS}
    for t in playable():
        out[t['mood']] += 1
    return out


def available():
    return any(counts().values())


def _start(track):
    """Skip leading digital silence, but keep a quarter second so a soft attack is not clipped."""
    return max(0.0, float(track.get('features', {}).get('lead_silence_s', 0)) - .25)


def choose(mood, duration, seed):
    """Repeatable pick: the same mood, video length and seed always give the same track."""
    pool = sorted((t for t in playable() if t['mood'] == mood), key=lambda t: t['id'])
    if not pool:
        raise LibraryError('library_empty', f'The music library has no approved {mood} tracks. Add some and rebuild the manifest (docs/MUSIC_LIBRARY.md).',
                           {'mood': mood, 'library': counts()})
    fits = [t for t in pool if t['duration'] - _start(t) >= duration + END_MARGIN]
    use = fits or [max(pool, key=lambda t: t['duration'] - _start(t))]
    pick = use[int.from_bytes(hashlib.sha256(f'{seed}|{mood}'.encode()).digest()[:4], 'big') % len(use)]
    return pick, {'method': 'seeded random choice among approved tracks long enough for the video', 'candidates': len(pool),
                  'long_enough': len(fits), 'looped': not fits}


def credit_of(track):
    return track.get('credit') or f"{track['title']} ({track.get('license') or 'licence not recorded'})"


def render(brief, folder, check):
    """Write folder/raw.wav (>= the video's length) and return provenance. The shared finishing step does the rest."""
    mood, duration = brief['mood'], brief['duration']
    track, how = choose(mood, duration, brief['seed'])
    source = config.LIBRARY_DIR / track['file']
    start = _start(track)
    cut = folder / 'library-cut.wav'
    args = ['ffmpeg', '-v', 'error', '-y']
    if how['looped']:
        args += ['-stream_loop', '-1']
    args += ['-ss', f'{start:.3f}', '-i', str(source), '-t', f'{duration + .25:.3f}', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', str(cut)]
    media.run(args, 180, check)
    warnings = []
    if how['looped']:
        warnings.append(f"No approved {mood} track was long enough, so the longest one was looped; listen for the seam.")
    try:
        lufs = media.measure_loudness(cut)['integrated_lufs']
        wanted = TARGET_LUFS - lufs
        gain = max(-MAX_CUT_DB, min(MAX_BOOST_DB, wanted))
        if gain != wanted:
            warnings.append(f'This excerpt is {abs(wanted):.0f} dB away from the target level, more than the {abs(gain):.0f} dB limit, so it will play '
                            f"{'quieter' if wanted > 0 else 'louder'} than other tracks.")
    except Exception:
        lufs, gain = None, 0.0
        warnings.append('Loudness could not be measured, so the track was used at its original level.')
    credit = f'{credit_of(track)}. {EDIT_NOTE}'
    media.run(['ffmpeg', '-v', 'error', '-y', '-i', str(cut), '-af', f'volume={gain:.2f}dB', '-metadata', f"title={track['title']}",
               '-metadata', f"artist={track.get('artist') or ''}", '-metadata', f"copyright={track.get('license') or ''}", '-metadata', f'comment={credit}',
               '-c:a', 'pcm_s16le', str(folder / 'raw.wav')], 120, check)
    cut.unlink(missing_ok=True)
    return {'engine': 'library', 'version': 'library-v1',
            'track': {'id': track['id'], 'title': track['title'], 'artist': track.get('artist'), 'source': track.get('source'),
                      'license': track.get('license'), 'license_url': track.get('license_url'), 'credit': credit_of(track), 'edit_note': EDIT_NOTE,
                      'duration': track['duration'], 'listened': bool(track.get('listened'))},
            'selection': {**how, 'seed': brief['seed'], 'mood': mood, 'start_seconds': round(start, 2)},
            'measured_lufs': lufs, 'gain_db': round(gain, 2), 'target_lufs': TARGET_LUFS, 'warnings': warnings}
