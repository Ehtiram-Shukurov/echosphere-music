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
