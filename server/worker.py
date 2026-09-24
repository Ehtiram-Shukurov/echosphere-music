"""Run with python -m server.worker. Exactly one worker per data directory."""
import json
import logging
import threading
import time
from contextlib import contextmanager
from . import store, media, analysis, engines
from .config import DATA

log = logging.getLogger(__name__)


class Cancelled(Exception):
    pass


@contextmanager
def exclusive_worker():
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA/'worker.lock').open('a+b') as f:
        try:
            if __import__('os').name == 'nt':
                import msvcrt
                f.seek(0); f.write(b'0'); f.flush(); f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e:
            raise RuntimeError('Another EchoSphere worker is already running.') from e
        yield


def process(job):
    id, kind = job['id'], job['kind']
    video = store.get('videos', job['video_id'])
    folder = DATA/'jobs'/id
    folder.mkdir(parents=True, exist_ok=True)

    def check():
        current = store.get('jobs',id)
        if not current or current['cancelled']:
            raise Cancelled()

    def stage(text):
        store.update('jobs',id,phase=text)

    try:
        check()
        source = DATA/'videos'/video['id']
        if kind == 'import':
            stage('Preparing silent video')
            store.update('videos', video['id'],state='importing')
            metadata = media.prepare_video(source/'source.mp4',source,check)
            check()
            store.update('videos', video['id'],state='ready',metadata=metadata,error=None)
            result = {'metadata':metadata}
        elif kind == 'analysis':
            if job['payload']['analyzer']=='qwen':
                engines.ensure_ace_idle()
            stage('Reading the selected sphere')
            result = analysis.analyze(source/'preview.mp4',folder,job['payload'],check)
            result['job_id'] = id
            check()
            store.update('videos',video['id'],analysis=result)
        elif kind == 'soundtrack':
            brief = job['payload']['brief']
            if job['payload']['engine']=='ace':
                engines.ensure_ace_idle()
            stage('Composing with instrument samples' if job['payload']['engine']=='composer' else 'Generating with ACE-Step')
            provenance = engines.composer(brief,folder,check) if job['payload']['engine']=='composer' else engines.ace(brief,folder,check,stage)
            check()
            stage('Finishing audio')
            stats = media.finish_audio(folder/'raw.wav',folder,brief['duration'],check)
            stage('Combining video and music')
            media.mux(source/'preview.mp4',folder/'soundtrack.wav',folder,check)
            result = {'brief':brief,'audio':stats,'provenance':provenance}
            (folder/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        else:
            raise RuntimeError('Unknown job kind.')
        check()
        store.update('jobs',id,state='complete',phase='Ready',result=result)
    except Cancelled:
        store.update('jobs',id,state='cancelled',phase='Cancelled')
        if kind == 'import':
            store.update('videos',video['id'],state='failed',error='Import cancelled.')
    except Exception as e:
        log.exception('Job %s failed',id)
        message = str(e)
        if isinstance(e, __import__('httpx').ConnectError):
            message = 'The selected local model service is not running. See docs/LOCAL_SETUP.md.'
        store.update('jobs',id,state='failed',phase='Failed',error=message[:1600])
        if kind == 'import':
            store.update('videos',video['id'],state='failed',error=message[:1600])


def main():
    logging.basicConfig(level=logging.INFO)
    store.init()
    with exclusive_worker():
        store.recover()
        stopped = threading.Event()
        def pulse():
            while not stopped.is_set():
                store.heartbeat()
                stopped.wait(3)
        thread = threading.Thread(target=pulse,daemon=True)
        thread.start()
        try:
            while True:
                job = store.claim()
                if job:
                    process(job)
                else:
                    time.sleep(.4)
        except KeyboardInterrupt:
            pass
        finally:
            stopped.set()
            thread.join(4)
            with store.connect() as db:
                db.execute('DELETE FROM worker')


if __name__ == '__main__':
    main()
