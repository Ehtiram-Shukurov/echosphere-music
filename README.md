# EchoSphere Music

A single self-contained web page that turns an emotion — Warm, Calm, Anger, or Sad — into an original piece of instrumental music, expressed through a living sphere of light.

Bring a reference track and either let the page read its mood automatically or pick one yourself; either way, only a handful of musical descriptors (tempo, key, brightness, density) are ever read from the upload. No reference audio is uploaded anywhere or mixed into the output — everything is analyzed locally in your browser, and every note you hear is composed fresh.

## Running it

It's one HTML file with everything embedded — instrument samples included, no build step, no server, no external script dependencies besides Google Fonts. Open `index.html` directly in a browser, or visit the deployed page.

## Instrument credits

Instrument recordings from [tonejs-instruments by Nathaniel Brosowsky](https://github.com/nbrosowsky/tonejs-instruments), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Original sources: piano and violin — VSCO 2 Community Edition (Versilian Studios); cello — flcellogrl (Freesound); electric guitar — Karoryfer. Recordings are sequenced, pitch-shifted, enveloped, and mixed; drums are synthesized. The same credits are embedded in the page itself and in every exported WAV.

## Status

The standalone page above remains unchanged. A **local video-to-music development version** is now available in `video.html`, served by `python run_local.py`.

It adds MP4 import, adjustable sphere-only focus through camera movement, color/motion analysis, optional local Qwen interpretation, mood override, a persistent API/worker, video-length instrument composition, optional ACE-Step generation, saved takes, WAV export and video export. Cloud deployment is deferred.

Start with [Local setup](docs/LOCAL_SETUP.md), then [API usage](docs/API.md). [Validation status](docs/VALIDATION.md) distinguishes the tested composer workflow from the still-unverified local AI-model quality gate. No uploaded videos, generated media, model weights or credentials are committed.

Hosting preparation (authentication, quotas, cleanup, container) and a verified comparison of free hosting options are in [Hosting](docs/HOSTING.md). No cloud deployment exists yet.
