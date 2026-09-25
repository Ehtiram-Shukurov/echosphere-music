"""The one-call upload-to-soundtrack endpoint: modes, rejection, ambiguity policy, retries."""
import importlib
import json
import wave
import pytest
from fastapi.testclient import TestClient
from tests.synthetic import make_flat_video, make_video

KEY = 'k' * 32


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv('ECHOSPHERE_DATA', str(tmp_path / 'data'))
    for name in ('ECHOSPHERE_API_KEY', 'ECHOSPHERE_ALLOWED_HOSTS', 'ECHOSPHERE_RETENTION_HOURS', 'ECHOSPHERE_MAX_STORAGE_GB', 'ECHOSPHERE_MAX_QUEUE'):
        monkeypatch.delenv(name, raising=False)
    from server import config, auth, store, retention, media, analysis, detect, auto, engines, worker, app
    for module in (config, auth, store, retention, media, analysis, detect, auto, engines, worker, app):
        importlib.reload(module)
    with TestClient(app.app) as client:
        yield client, store, worker, config, retention


def submit(client, path, **fields):
    with open(path, 'rb') as f:
        return client.post('/v1/soundtracks/auto', files={'file': ('clip.mp4', f, 'video/mp4')}, data=fields)


def run(store, worker):
    job = store.claim()
    assert job, 'nothing queued'
    worker.process(job)
    return job['id']


def status(client, id):
    return client.get('/v1/soundtracks/' + id).json()


def gold(tmp_path):
    make_video(tmp_path / 'gold.mp4')
    return tmp_path / 'gold.mp4'


def test_robot_mode_end_to_end_with_stages_and_inspectable_detection(api, tmp_path):
    client, store, worker, config, retention = api
    r = submit(client, gold(tmp_path), input_mode='robot')
    assert r.status_code == 202, r.text
    body = r.json()
    id = body['id']
    queued = status(client, id)                      # the job ID comes back immediately, before any processing
    assert queued['state'] == 'queued' and queued['stages'][0]['state'] == 'active'
    assert [s['code'] for s in queued['stages']] == ['queued', 'importing', 'detecting', 'analyzing', 'deciding', 'composing', 'finishing', 'muxing']
    run(store, worker)
    done = status(client, id)
    assert done['state'] == 'complete', done.get('error')
    assert all(s['state'] == 'done' for s in done['stages'])
    result = done['result']
    assert result['input_mode'] == 'robot' and result['detection']['status'] == 'ok'
    assert result['mood']['source'] == 'observed' and result['mood']['used'] == result['analysis']['mood']
    assert 'not calibrated probabilities' in result['analysis']['palette_scores_note']
    assert 'payload' not in done
    with wave.open(str(config.DATA / 'jobs' / id / 'soundtrack.wav')) as w:
        assert w.getnframes() == 441000
    assert client.get(f'/v1/soundtracks/{id}/audio').status_code == 200
    assert client.get(f'/v1/soundtracks/{id}/video').status_code == 200
    vid = body['video_id']
    assert client.get(f'/v1/videos/{vid}/detection/overlay').headers['content-type'] == 'video/mp4'
    assert client.get(f'/v1/videos/{vid}/detection/sheet').headers['content-type'] == 'image/jpeg'
    assert client.get(f'/v1/videos/{vid}/detection').json()['status'] == 'ok'
    assert client.get(result['analysis']['evidence'][0]['url'] if 'url' in result['analysis']['evidence'][0] else done['result']['analysis']['evidence'][0]['url']).status_code == 200
    # Cleanup understands auto jobs: the video, detection files and soundtrack go together.
    assert retention.purge_video(vid) is True
    assert not (config.DATA / 'videos' / vid).exists() and not (config.DATA / 'jobs' / id).exists()


def test_focus_mode_uses_supplied_coordinates_and_skips_detection(api, tmp_path):
    client, store, worker, *_ = api
    truth = make_video(tmp_path / 'gold.mp4')
    first = {k: round(truth[0][k], 4) for k in ('time', 'cx', 'cy', 'rx', 'ry')}
    first['rx'] = first['ry'] = .12
    r = submit(client, tmp_path / 'gold.mp4', input_mode='focus', focus=json.dumps([first]))
    assert r.status_code == 202, r.text
    id = run(store, worker)
    done = status(client, id)
    assert done['state'] == 'complete', done.get('error')
    assert done['result']['detection'] is None and done['result']['focus'] == [first]
    assert client.get(f'/v1/videos/{r.json()["video_id"]}/detection').status_code == 404


def test_sphere_only_mode(api, tmp_path):
    client, store, worker, *_ = api
    make_flat_video(tmp_path / 'flat.mp4')
    r = submit(client, tmp_path / 'flat.mp4', input_mode='sphere')
    id = run(store, worker)
    done = status(client, id)
    assert done['state'] == 'complete', done.get('error')
    assert done['result']['mood']['used'] == 'warm' and done['result']['detection'] is None


def test_unreliable_sphere_is_rejected_with_evidence(api, tmp_path):
    client, store, worker, *_ = api
    make_video(tmp_path / 'none.mp4', sphere=False)
    r = submit(client, tmp_path / 'none.mp4', input_mode='robot')
    id = run(store, worker)
    done = status(client, id)
    assert done['state'] == 'failed' and done['result']['error_code'] == 'sphere_not_reliable'
    assert 'Inspect the detection overlay' in done['error']
    assert done['result']['detection']['status'] == 'rejected'
    assert client.get(f'/v1/videos/{r.json()["video_id"]}/detection/sheet').status_code == 200   # overlay kept for review
    assert not (client.get(f'/v1/soundtracks/{id}/audio').status_code == 200)


def ambiguous(tmp_path):
    # Blue (sad) on one side and violet (calm) on the other: the palette rule cannot pick one.
    make_video(tmp_path / 'mixed.mp4', hue=(215, 120, 40), hue2=(215, 60, 150))
    return tmp_path / 'mixed.mp4'


def test_ambiguity_fails_by_default(api, tmp_path):
    client, store, worker, *_ = api
    submit(client, ambiguous(tmp_path), input_mode='robot')
    done = status(client, run(store, worker))
    assert done['state'] == 'failed', done['result']['mood']
    assert done['result']['error_code'] == 'ambiguous_mood'
    assert 'palette_scores_note' in done['result']['analysis'] and done['result']['analysis']['mood'] is None


def test_best_guess_is_opt_in_and_reported(api, tmp_path):
    client, store, worker, *_ = api
    submit(client, ambiguous(tmp_path), input_mode='robot', on_ambiguous='best_guess')
    done = status(client, run(store, worker))
    assert done['state'] == 'complete', done.get('error')
    mood = done['result']['mood']
    assert mood['source'] == 'best_guess' and mood['observed'] is None and mood['used'] in ('calm', 'sad')
    assert any('best guess' in w for w in done['result']['brief']['warnings'])


def test_explicit_mood_overrides_and_keeps_the_observation(api, tmp_path):
    client, store, worker, *_ = api
    submit(client, ambiguous(tmp_path), input_mode='robot', mood='anger')
    done = status(client, run(store, worker))
    assert done['state'] == 'complete', done.get('error')
    assert done['result']['mood'] == {'used': 'anger', 'observed': None, 'source': 'override'}


def test_invalid_options_are_refused_before_anything_is_stored(api, tmp_path):
    client, store, worker, config, _ = api
    clip = gold(tmp_path)
    assert submit(client, clip, input_mode='focus').status_code == 422                                   # focus required
    assert submit(client, clip, input_mode='robot', focus='[]').status_code == 422                        # focus not allowed
    assert submit(client, clip, input_mode='robot', focus='not json').status_code == 422
    assert submit(client, clip, input_mode='telepathy').status_code == 422
    assert submit(client, clip, input_mode='robot', mood='joy').status_code == 422
    assert submit(client, clip, input_mode='robot', on_ambiguous='guess').status_code == 422
    (tmp_path / 'notes.txt').write_text('x')
    with open(tmp_path / 'notes.txt', 'rb') as f:
        assert client.post('/v1/soundtracks/auto', files={'file': ('notes.txt', f)}, data={'input_mode': 'robot'}).status_code == 415
    assert client.get('/v1/videos').json() == [] and store.claim() is None


def test_retry_with_the_same_key_returns_the_same_job(api, tmp_path):
    client, store, worker, *_ = api
    clip = gold(tmp_path)
    with open(clip, 'rb') as f:
        a = client.post('/v1/soundtracks/auto', files={'file': ('c.mp4', f, 'video/mp4')}, data={'input_mode': 'robot'}, headers={'Idempotency-Key': 'abc'})
    with open(clip, 'rb') as f:
        b = client.post('/v1/soundtracks/auto', files={'file': ('c.mp4', f, 'video/mp4')}, data={'input_mode': 'robot'}, headers={'Idempotency-Key': 'abc'})
    assert a.status_code == b.status_code == 202 and a.json()['id'] == b.json()['id']
    assert len(client.get('/v1/videos').json()) == 1                       # the duplicate upload was discarded
    with open(clip, 'rb') as f:
        c = client.post('/v1/soundtracks/auto', files={'file': ('c.mp4', f, 'video/mp4')}, data={'input_mode': 'sphere'}, headers={'Idempotency-Key': 'abc'})
    assert c.status_code == 409


def test_auto_endpoint_requires_the_key_and_shares_the_queue_limit(tmp_path, monkeypatch):
    monkeypatch.setenv('ECHOSPHERE_DATA', str(tmp_path / 'data'))
    monkeypatch.setenv('ECHOSPHERE_API_KEY', KEY)
    monkeypatch.setenv('ECHOSPHERE_MAX_QUEUE', '1')
    for name in ('ECHOSPHERE_ALLOWED_HOSTS', 'ECHOSPHERE_RETENTION_HOURS', 'ECHOSPHERE_MAX_STORAGE_GB'):
        monkeypatch.delenv(name, raising=False)
    from server import config, auth, store, retention, media, analysis, detect, auto, engines, worker, app
    for module in (config, auth, store, retention, media, analysis, detect, auto, engines, worker, app):
        importlib.reload(module)
    clip = gold(tmp_path)
    with TestClient(app.app) as client:
        assert submit(client, clip, input_mode='robot').status_code == 401
        headers = {'Authorization': f'Bearer {KEY}'}
        with open(clip, 'rb') as f:
            ok = client.post('/v1/soundtracks/auto', files={'file': ('c.mp4', f, 'video/mp4')}, data={'input_mode': 'robot'}, headers=headers)
        assert ok.status_code == 202
        with open(clip, 'rb') as f:
            full = client.post('/v1/soundtracks/auto', files={'file': ('c.mp4', f, 'video/mp4')}, data={'input_mode': 'robot'}, headers=headers)
        assert full.status_code == 409 and 'queue is full' in full.json()['detail']
        assert len(client.get('/v1/videos', headers=headers).json()) == 1      # the refused upload left nothing behind
