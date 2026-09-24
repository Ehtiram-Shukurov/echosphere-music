"""Configuration stays outside the pipeline so storage/services can move later."""
import os
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get('ECHOSPHERE_DATA', ROOT / 'data')).resolve()
MAX_BYTES = 100 * 1024 * 1024
MIN_SECONDS, MAX_SECONDS = 10, 60
OLLAMA_MODEL = os.environ.get('ECHOSPHERE_VISION_MODEL', 'qwen3-vl:4b')


def local_url(name, default):
    value = os.environ.get(name, default).rstrip('/')
    parsed = urlparse(value)
    if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError(f'{name} must use a local HTTP service in this release.')
    return value


OLLAMA_URL = local_url('ECHOSPHERE_OLLAMA_URL', 'http://127.0.0.1:11434')
ACE_URL = local_url('ECHOSPHERE_ACE_URL', 'http://127.0.0.1:8001')
ACE_KEY = os.environ.get('ECHOSPHERE_ACE_KEY', '')
ACE_MODEL = os.environ.get('ECHOSPHERE_ACE_MODEL', '')
