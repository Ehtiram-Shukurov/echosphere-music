# Validation and remaining gates

Recorded September 24, 2026. Baseline: `9b02e0f29cc3f6603ecf08d0d21e213449a99dc7`. The existing `index.html` remains byte-for-byte unchanged.

## Completed here

- Python 3.12 local application; real FFmpeg processing and real Chromium Web Audio composition. No GPU or paid inference service was used.
- Eight automated tests pass. They cover the complete MP4 import/analysis/composer/export API, excluding original audio, manual mood versus observed mood, stable saved downloads, idempotency conflicts, invalid media/focus, origin restrictions, deletion dependencies, cancellation, restart recovery and model connection failures.
- Score validation covers all four moods at 10, 10.005, 30 and 60 seconds: finite ordered events, events fitting the output duration, and identical scores for the same brief/seed. Only the short end-to-end cases are audio-rendered by these tests.
- Qwen and ACE-Step **protocol fixture tests** validate request/response handling, sphere-image input, structured output, unload settings, one-item generation, polling/downloads and unfinished-provider blocking. These are not real model inference tests.
- The supplied 10-second demo passed the browser workflow: upload, eight interpolated sphere focus points, analysis, generation, playback, pause, seek, saved WAV/MP4 download and restoring the same take after reload. Desktop and 390-pixel mobile layout checks passed with no JavaScript errors.
- The provided video produces a Warm palette suggestion using only its selected sphere interior. Cropped evidence was inspected; the robot's face is excluded. Source audio is not used.
- The four supplied stills were inspected as palette calibration references. Warm and Anger are distinguishable; Sad and pale Calm overlap in blue. The latter overlap now marks the result ambiguous and requires a manual choice instead of claiming a confident Sad classification. This is not an independently held-out accuracy evaluation.
- The generated WAV has exactly 441,000 stereo frames at 44,100 Hz (10 seconds). Non-silence, sample peak, RMS, integrated loudness, loudness range and true peak are checked. Final WAV true peak must be at most -1 dBTP. Preview/export derive from this saved master; lossy encoding can alter encoded peaks slightly.
- Headless Chromium in this environment has no H.264/AAC decoder. A WebM preview path was therefore implemented and used for browser playback checks. The MP4 export was checked with FFmpeg; native Chrome/Edge MP4 playback remains a target-browser check.
- Instrument attribution survives final WAV and video metadata. The user videos, screenshots, generated files and model weights are excluded from Git.

The test runner emits a Starlette warning about its current httpx test-client integration. Tests pass; the application itself uses httpx as a model-service client.

## Not yet validated

1. **Qwen3-VL inference on the target laptop.** Verify its actual observations, memory and latency, especially on stylized sphere scenes. Current automatic palette analysis is not a semantic substitute.
2. **ACE-Step output and quality.** Verify installation, non-XL model revision, GPU/offload behavior, absence of vocals, musical coherence and natural endings. No ACE-Step-generated audio is represented as completed in this branch.
3. **User listening approval.** The provided demo is a functional example using the existing instrument engine with a duration-aware visual adapter. It is not evidence that the richer music-quality goal has been met.
4. **Windows and target browser setup.** Setup instructions are included, but this execution environment is Linux. Use `scripts/doctor.py` to check the actual machine.
5. **Broader release gates.** The original proposed multi-clip listening comparison, 20 consecutive valid generation jobs, long-session memory observations, low-disk fault injection, full offline model operation and quality averages are outstanding.
6. **Cloud deployment.** Authentication, hosted storage, retention/quota policy, remote access and provider-specific adapters still need implementation. Local URLs are configurable, but that does not make this a publicly hosted service.

## Known scope limits

- Focus tracking is manual with linear interpolation. Changes in pose, occlusion or non-linear camera motion may need extra points. Motion measurements include residual camera movement and lighting changes.
- The v6-based score can respond to the measured energy curve. The neural prompt currently communicates overall atmosphere and activity; it does not guarantee event-level timing or exact section changes.
- Export normalizes video to 24 fps and at most 1280 pixels on its longest side. This is a preview-quality workflow, not a full-resolution archival export.
- A crashed active job becomes failed rather than automatically rerun. A cancelled ACE job can continue inside its own service until completion. Unknown provider tasks block further GPU jobs until reconciled.
- No automatic retention or public multi-user access. Downloaded outputs need the included instrument credits where applicable.

The next acceptance step is the actual laptop setup and a short, matched-loudness listening comparison between the composer and ACE-Step on this same clip.

## Automatic video-to-music pipeline (branch `feature/auto-video-api`)

Recorded September 24 to 25, 2026. Added on top of the hosting work: `POST /v1/soundtracks/auto`, a CPU sphere detector with temporal tracking, detection overlays, and an explicit mood-ambiguity policy. **Nothing here is deployed.** The deployed server still runs commit `ac1b816`.

### What is validated, and how far that goes

**Demo validation (one clip, not general reliability).** The supplied 10-second demo (`EchoSphere Robot Design Demo-Ver 1.mp4`, camera zooming toward a golden sphere in a living room) was run through the detector and compared, at 50 sampled times, with the hand-marked focus points in `docs/demo-focus.example.json`. Command: `python scripts/validate_demo_detection.py <video>`.

| Measure | Result |
|---|---|
| Sphere found in sampled frames (coverage) | 100% |
| Mean overlap with the hand-marked ellipse (IoU) | 0.82 |
| Worst-frame overlap | 0.67 |
| Mean centre error | 16.6 px at 1280 px wide (worst 32.5 px) |
| Automatic radius relative to the hand mark | 0.93 on average |
| Keypoints produced | 8 (limit 16) |
| Detector heuristics | quality 0.95, ambiguous fraction 0.19, uncertainty index 0.39 |

The overlay contact sheet shows the selection on the glass sphere in all eight sampled frames, with the robot's face, the fireplace and the lamps not selected. The manual points came from the same footage and the same person who built the detector, and the detector's scoring was adjusted while looking at this clip. **Treat it as a demo check, not as evidence the detector generalises.**

**Full pipeline, real footage.** Through the one-call endpoint on an isolated local server (no key, composer engine):

| Input | `input_mode` | Outcome | Time |
|---|---|---|---|
| Demo video | robot | Completed, mood Warm (observed); 10.00 s stereo WAV | 25 s (job ID returned in 0.2 s) |
| Warm still as a 10 s video | robot | Completed, Warm (observed) | 22 s |
| Sad still | robot | Completed, Sad (observed) | 15 s |
| Anger still | robot | Completed, Anger (observed) | 20 s |
| Calm still | robot | **Failed with `ambiguous_mood`** (colour shares calm 0.24, sad 0.76) | 21 s |

The four stills are static images turned into video with FFmpeg, on a black background, in portrait. The Calm result is the policy working, but narrowly: the ambiguity rule fires when the second-ranked mood has a share above 0.22, and Calm scored 0.24. It is not robust, and the palette rule still reads a deep-blue interior as Sad. With `on_ambiguous=best_guess` this clip would have been reported as a **Sad best guess**, which is the wrong feeling for it; that is why the default is to fail.

**A failure found and fixed during validation.** The first detector scored saturated colour, so on the pale-violet Calm still it locked onto the small deep-blue patch at the top of the ball and the colour reading came out a confident, wrong "Sad" with no warning. Scoring was changed to recognise the robot body by smoothness (a pale sphere is as bright as the body but full of structure). After the change the selection covers the ball and the demo numbers above were unchanged. A second bug was found by the portrait stills: the overlay video had an odd height, which H.264 rejects. Overlay dimensions are now even, and an overlay failure no longer fails the job.

**Automated tests.** The suite runs `tests/test_detect.py` (synthetic scenes with a moving camera plus a fireplace, a lamp and a dark face; a no-sphere scene is rejected; keypoints satisfy the existing analysis contract) and `tests/test_auto.py` (the three input modes; stages; detection artifacts available for both accepted and rejected jobs; rejection of an unreliable sphere; ambiguity fails by default, `best_guess` is opt-in and reported, an explicit mood overrides and keeps the observation; invalid options refused before anything is stored; idempotent retry; sign-in and queue limit on the new route; cleanup removes the detection files). Synthetic scenes are easier than real footage, so they show the code does what it claims, not that it works on the robot's real camera.

### Not validated

- **Any footage other than the demo and the four stills.** In particular: a moving camera on real footage, a sphere partly hidden, motion blur, several similar circular objects, and clips with no visible sphere. The only no-sphere test is a synthetic scene.
- **Detection thresholds.** Coverage 0.7, quality 0.35, ambiguity 0.35, jitter 0.12 and the two-second gap limit were set by hand. They are not tuned on a range of clips and are not calibrated probabilities. `uncertainty_index` is a heuristic blend, not a probability.
- **Mood accuracy.** The colour rule is a product-palette heuristic tested on the four supplied stills plus one demo. Calm versus Sad remains unresolved.
- **Speed and memory on the hosted server.** Times above are from a Windows laptop.
- **The new endpoint on the deployed server, behind Caddy.** Not deployed.
- **Music quality.** Unchanged from the existing composer and not part of this work.
