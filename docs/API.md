# Local API

Start `python run_local.py`. Interactive OpenAPI documentation: `http://127.0.0.1:8765/docs`.

| Method / path | Behavior |
|---|---|
| GET `/health` | Application, worker, FFmpeg, browser and model-service readiness |
| POST `/v1/videos` | Multipart `file` MP4; returns video ID and import job ID (202) |
| GET `/v1/videos` | Recent local videos |
| GET `/v1/videos/{id}` | Metadata, saved analysis, jobs and preview links |
| POST `/v1/videos/{id}/analysis` | Validated sphere focus points and analyzer; returns job (202) |
| GET `/v1/jobs/{id}` | Durable state, real processing stage, error/result |
| POST `/v1/soundtracks` | Analyzed video, mood/engine/seed; returns job (202) |
| GET `/v1/soundtracks/{id}` | Soundtrack state and saved output links |
| GET `/v1/soundtracks/{id}/audio` | Final WAV |
| GET `/v1/soundtracks/{id}/video` | MP4 with generated soundtrack |
| GET `/v1/soundtracks/{id}/preview` | WebM alternative for codec compatibility |
| GET `/v1/soundtracks/{id}/metadata` | Brief, provenance, score when available, audio measurements |
| DELETE `/v1/jobs/{id}` | Request cancellation for an active job |
| DELETE `/v1/soundtracks/{id}` | Cancel an active take; delete a terminal take on a subsequent request |
| DELETE `/v1/videos/{id}` | Delete source and analyses after active jobs/takes are removed |

Import deliberately stops before analysis: the user must choose a sphere focus first. Dimensions and coordinates refer to the normalized silent preview, not the raw file's encoded rotation. Evidence frames contain only masked sphere crops. The original audio never informs the analysis.

Example analysis body:

```json
{
  "analyzer": "measurements",
  "focus": [
    {"time": 0, "cx": 0.5, "cy": 0.6, "rx": 0.1, "ry": 0.18},
    {"time": 9.9, "cx": 0.5, "cy": 0.55, "rx": 0.22, "ry": 0.39}
  ]
}
```

`cx/cy` are center fractions of frame width/height; `rx/ry` are radius fractions. Points must begin at time zero, be strictly time-ordered, fit inside the frame and number at most 16. Position and radii interpolate linearly. `qwen` is the optional semantic analyzer; `measurements` is explicitly a product-palette heuristic plus motion measurements.

Example soundtrack body:

```json
{"video_id":"<32-character video ID>","mood":"auto","engine":"composer","seed":42}
```

Moods: `auto`, `warm`, `calm`, `sad`, `anger`. Engines: `composer`, `ace`. Automatic generation returns 409 when analysis has no clear mood; choose a manual mood. Manual selection preserves `observed_mood` in provenance. A soundtrack freezes its analysis/brief when submitted, so later analysis does not alter an existing take.

Send a unique `Idempotency-Key` on analysis and generation POST requests. Retrying the same key and payload returns the same job. Reusing it for different inputs returns 409. After a failed job, use a new key for an intentional retry. Upload itself is not idempotent. Queue capacity is 20 active jobs.

States: `queued`, `running`, `complete`, `failed`, `cancelled`. `phase` describes actual work; there are no invented progress percentages. Files are published only after successful finishing. Invalid media can fail asynchronously in its import job. Keep polling until a terminal state.

Browser-independent example:

```powershell
.\.venv\Scripts\python.exe scripts/api_example.py "C:\path\demo.mp4" --focus docs/demo-focus.example.json --engine composer --mood warm --seed 42
```

Use the bundled focus JSON only for the supplied demo. The script uploads, polls, analyzes, generates and downloads WAV/MP4 plus metadata. To exercise both model services, pass `--analyzer qwen --engine ace` after installing them.

Files and SQLite are local in this version. No API secrets belong in the static website. A future cloud adapter can preserve the user-facing workflow, but authentication, durable hosted storage and provider quotas still need implementation and deployment tests.
