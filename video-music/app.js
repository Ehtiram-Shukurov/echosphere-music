'use strict';
// EchoSphere, browser edition: add a video, find the sphere, read its feeling, play a song. Nothing leaves the device.
const $ = (id) => document.getElementById(id);
const BASE = '../music-library/';
const NAMES = { warm: 'Warm', calm: 'Calm', anger: 'Anger', sad: 'Sad' };
const THEME = { warm: ['#FFD166', '255,209,102'], calm: ['#B59BEA', '123,78,214'], anger: ['#F27982', '193,18,31'], sad: ['#98BEDF', '58,110,165'] };
const MAX_SIDE = 320, MAX_SAMPLES = 100, SAMPLES_PER_SECOND = 5;

const video = $('video'), audio = $('song'), overlay = $('overlay'), stage = document.querySelector('.video-stage');
const state = {
  manifest: null, run: 0, busy: false, file: null, url: null, duration: 0, frames: [], report: null, manual: null, sceneFallback: false,
  drawing: false, draft: null, decision: null, mood: null, seed: '', variation: 0, track: null, pick: null, gain: null,
};
let audioCtx = null, nodes = null, envelopeTimer = 0;

// ---- small helpers -----------------------------------------------------------------------------------------------

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function progress(fraction) { $('progress').hidden = fraction === null; if (fraction !== null) $('progressBar').style.width = `${Math.round(fraction * 100)}%`; }
function show(id, on) {
  const el = $(id), was = el.hidden;
  el.hidden = !on;
  if (on && was) { el.classList.remove('rise'); void el.offsetWidth; el.classList.add('rise'); }   // panels rise in once
}
// Sets an element's text from plain strings and {strong: '...'} pieces, without ever parsing HTML.
function say(el, ...parts) {
  el.replaceChildren(...parts.map((p) => (typeof p === 'string' ? document.createTextNode(p) : Object.assign(document.createElement('strong'), { textContent: p.strong }))));
}
const make = (tag, props, ...children) => { const el = Object.assign(document.createElement(tag), props); el.append(...children); return el; };
const channel = new MessageChannel(), waiting = [];
channel.port1.onmessage = () => { const next = waiting.shift(); if (next) next(); };
const yieldToPage = () => new Promise((resolve) => { waiting.push(resolve); channel.port2.postMessage(0); });   // not throttled in background tabs
class Cancelled extends Error {}
const alive = (token) => { if (token !== state.run) throw new Cancelled(); };

function applyMood(mood) {
  if (!mood) return;
  if (activeMood !== mood && !calmMode) transitions.push({ born: performance.now() });
  activeMood = mood;
  document.documentElement.style.setProperty('--accent', THEME[mood][0]);
  document.documentElement.style.setProperty('--accent-rgb', THEME[mood][1]);
  setTitle(NAMES[mood]);
  window.dispatchEvent(new Event('sphere-change'));
}

// The big title: a feeling once one is decided, otherwise plain words. `end` is the punctuation after it.
function setTitle(text, end = '.') {
  $('moodTitle').replaceChildren(document.createTextNode(text), Object.assign(document.createElement('span'), { textContent: end }));
}
const DEFAULT_SUBTITLE = 'Add a video to hear its song';

function paintMoodButtons() {
  const hinted = state.decision && state.decision.ambiguous ? state.decision.ranked.slice(0, 2) : [];
  document.querySelectorAll('.mood-btn').forEach((b) => {
    const m = b.dataset.mood;
    b.classList.toggle('active', m === state.mood);
    b.classList.toggle('hint', !state.mood && hinted.includes(m));
    b.setAttribute('aria-pressed', String(m === state.mood));
  });
}

function setQuiet(on) {
  calmMode = on;
  $('motionLabel').textContent = on ? 'Motion off' : 'Motion on';
  $('calmToggle').setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('quiet', on);
  window.dispatchEvent(new Event('sphere-change'));
}

// ---- the song library --------------------------------------------------------------------------------------------

async function loadLibrary() {
  if (location.protocol === 'file:') {
    $('library').textContent = 'Open from a web address';
    message('This page needs to be opened from a web address (the GitHub Pages site, or a local web server), not by double-clicking the file.', true);
    return;
  }
  try {
    const response = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(String(response.status));
    state.manifest = await response.json();
    const counts = EchoLibrary.counts(state.manifest), total = Object.values(counts).reduce((a, b) => a + b, 0);
    $('library').textContent = total ? `${total} songs ready` : 'No songs found';
    if (!total) message('The music library is empty, so no song can be chosen.', true);
  } catch {
    $('library').textContent = 'Songs unavailable';
    message('The song library could not be loaded. Check your connection and reload the page.', true);
  }
}

// ---- opening a video and reading it ------------------------------------------------------------------------------

function whenFirstFrame(el) {
  return new Promise((resolve, reject) => {
    const done = () => { clean(); resolve(); }, fail = () => { clean(); reject(new Error('cannot decode')); };
    const timer = setTimeout(fail, 20000);
    function clean() { clearTimeout(timer); el.removeEventListener('loadeddata', done); el.removeEventListener('error', fail); }
    if (el.readyState >= 2) return done();
    el.addEventListener('loadeddata', done);
    el.addEventListener('error', fail);
  });
}

function seek(el, t) {
  return new Promise((resolve, reject) => {
    if (Math.abs(el.currentTime - t) < 1e-3 && el.readyState >= 2) return resolve();
    const done = () => { clean(); resolve(); };
    const timer = setTimeout(() => { clean(); reject(new Error('seek timed out')); }, 8000);
    function clean() { clearTimeout(timer); el.removeEventListener('seeked', done); }
    el.addEventListener('seeked', done);
    el.currentTime = t;
  });
}

function resetForNewVideo() {
  stop();
  state.run++;
  Object.assign(state, { frames: [], report: null, manual: null, sceneFallback: false, drawing: false, draft: null, decision: null, timeline: null, mood: null, variation: 0, track: null, pick: null, gain: null });
  stage.classList.remove('drawing');
  $('stageRoot').classList.remove('has-video');
  for (const id of ['videoPanel', 'feelingPanel', 'songPanel', 'drawHint', 'wholeButton', 'autoButton', 'timelineWrap']) show(id, false);
  progress(null);
  setTitle('Your video'); $('soundMeta').textContent = DEFAULT_SUBTITLE;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = null;
}

async function handleFile(file) {
  if (!file) return;
  if (!(file.type || '').startsWith('video/') && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) return message('That does not look like a video. An MP4 works best.', true);
  resetForNewVideo();
  const token = state.run;
  state.file = file;
  state.busy = true;
  $('addButton').disabled = false;
  try {
    message('Opening your video…');
    progress(.02);
    state.url = URL.createObjectURL(file);
    video.src = state.url;
    await whenFirstFrame(video);
    alive(token);
    state.duration = video.duration;
    if (!Number.isFinite(state.duration) || state.duration < 1 || !video.videoWidth) throw new Error('unusable');
    state.seed = `${EchoLibrary.hash32(`${file.name}|${file.size}|${state.duration.toFixed(2)}`)}`;
    $('videoTitle').textContent = file.name.replace(/\.[^.]+$/, '') || 'Your video';
    show('videoPanel', true);
    $('stageRoot').classList.add('has-video');
    await sampleFrames(token);
    await findSphere(token);
    alive(token);
    presentAnalysis();
    progress(null);
  } catch (e) {
    if (e instanceof Cancelled) return;
    progress(null);
    message(e.message === 'cannot decode' || e.message === 'unusable'
      ? 'This browser could not open that video. Try an MP4 (H.264) in Chrome, Edge or Safari, or another file.'
      : `Something went wrong while reading the video (${e.message}). Try again, or use another video.`, true);
    console.warn('The video could not be read:', e);
  } finally {
    if (token === state.run) state.busy = false;
  }
}

// Frames are read from a second, hidden copy of the video, so the one on screen is never seeked while the analysis runs:
// a paused video that is seeked dozens of times can keep showing a stale picture, and the outline would not line up with it.
async function sampleFrames(token) {
  const sampler = document.createElement('video');
  sampler.muted = true; sampler.playsInline = true; sampler.preload = 'auto';
  sampler.setAttribute('aria-hidden', 'true');
  sampler.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.append(sampler);                       // some browsers only decode frames of videos that are in the page
  try {
    sampler.src = state.url;
    await whenFirstFrame(sampler);
    const n = Math.min(MAX_SAMPLES, Math.max(8, Math.round(state.duration * SAMPLES_PER_SECOND)));
    const scale = MAX_SIDE / Math.max(sampler.videoWidth, sampler.videoHeight);
    const w = Math.max(16, Math.round(sampler.videoWidth * scale)), h = Math.max(16, Math.round(sampler.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < n; i++) {
      alive(token);
      const t = Math.min(state.duration - .05, .03 + i * (state.duration - .08) / Math.max(1, n - 1));
      await seek(sampler, t);
      ctx.drawImage(sampler, 0, 0, w, h);
      state.frames.push({ time: t, width: w, height: h, data: ctx.getImageData(0, 0, w, h).data });
      progress(.05 + .3 * (i + 1) / n);
      message(`Looking through the video… ${i + 1} of ${n}`);
    }
  } finally {
    sampler.removeAttribute('src'); sampler.load(); sampler.remove();
  }
}

async function findSphere(token) {
  const perFrame = [], n = state.frames.length;
  for (let i = 0; i < n; i++) {
    alive(token);
    perFrame.push(EchoDetect.analyzeFrame(state.frames[i]));
    progress(.35 + .6 * (i + 1) / n);
    message(`Finding the sphere… ${i + 1} of ${n}`);
    await yieldToPage();
  }
  state.report = EchoDetect.summarize(state.frames.map((f) => f.time), perFrame, state.frames[0].width, state.frames[0].height);
}

// ---- what was found ----------------------------------------------------------------------------------------------

function focusFor(t) {
  if (state.manual) return state.manual;
  if (state.sceneFallback) return { cx: .5, cy: .5, rx: .5, ry: .5 };   // the whole scene
  return state.report && state.report.status === 'ok' ? EchoDetect.focusAt(state.report, t) : null;
}

function readMood() {
  const perFrame = state.frames.map((f) => {
    const e = focusFor(f.time);
    return EchoMood.readPalette(f, { cx: e.cx * f.width, cy: e.cy * f.height, rx: e.rx * f.width, ry: e.ry * f.height });
  });
  state.decision = EchoMood.decide(EchoMood.meanScores(perFrame));
  state.timeline = buildTimeline(perFrame);
}

// The light over time: the same decide() rule, run per window instead of over the whole clip.
// A null mood in a window means mixed light, shown striped rather than forced into a feeling.
function buildTimeline(perFrame) {
  const n = perFrame.length;
  if (!n) return [];
  const windows = Math.max(1, Math.min(12, Math.round(state.duration / 2) || 1));
  const out = [];
  for (let w = 0; w < windows; w++) {
    const a = Math.floor(w * n / windows), b = Math.max(a + 1, Math.floor((w + 1) * n / windows));
    const d = EchoMood.decide(EchoMood.meanScores(perFrame.slice(a, b)));
    out.push({ t0: state.frames[a].time, t1: state.frames[Math.min(b, n - 1)].time, mood: d.mood, top: d.closest });
  }
  return out;
}

function renderTimeline() {
  const wrap = $('timelineWrap'), box = $('timeline');
  box.replaceChildren();
  if (!state.timeline || !state.timeline.length) { show('timelineWrap', false); return; }
  const total = Math.max(state.duration, 1e-6);
  for (const seg of state.timeline) {
    const label = seg.mood ? NAMES[seg.mood] : `mixed light (closest: ${NAMES[seg.top]})`;
    const el = make('button', {
      className: 'tl-seg' + (seg.mood ? '' : ' tl-mixed'),
      title: `${fmt(seg.t0)} – ${fmt(seg.t1)}: ${label}`,
      ariaLabel: `Jump to ${fmt(seg.t0)}: ${label}`,
    });
    el.style.flexBasis = `${Math.max(1.5, (seg.t1 - seg.t0) / total * 100)}%`;
    el.dataset.t0 = seg.t0; el.dataset.t1 = seg.t1;
    if (seg.mood) el.style.setProperty('--seg', THEME[seg.mood][0]);
    el.addEventListener('click', () => { video.currentTime = Math.min(seg.t0 + .01, Math.max(0, state.duration - .05)); });
    box.append(el);
  }
  show('timelineWrap', true);
}

// The timeline marks where the music is: the window under the playhead glows.
function highlightTimeline(t) {
  const box = $('timeline');
  if (!box || !box.children.length) return;
  for (const el of box.children) {
    el.classList.toggle('playing', t >= Number(el.dataset.t0) && t < Number(el.dataset.t1));
  }
}

function presentAnalysis() {
  const { report } = state;
  show('wholeButton', false); show('autoButton', false); show('drawHint', false);
  state.drawing = false; stage.classList.remove('drawing');
  if (!state.manual && report.status !== 'ok') {
    if (trySceneFallback()) return;   // no sphere, but the scene itself reads clearly — use it, labeled as such
    $('detectionNote').textContent = `The sphere could not be found reliably. ${report.reasons.join(' ')} Mark it yourself and the reading will continue from there.`;
    message('The sphere could not be found reliably. Mark it yourself to continue.', true);
    show('feelingPanel', false); show('songPanel', false);
    startDrawing();
    drawOverlay();
    return;
  }
  if (state.manual) {
    $('detectionNote').textContent = 'Reading the region you marked (green).';
    show('autoButton', report.status === 'ok');
  } else {
    const m = report.metrics;
    $('detectionNote').textContent = `Found the sphere in ${Math.round(m.coverage * 100)}% of the frames. The light inside the green outline was read; the faint circle is the sphere's edge.`;
  }
  show('wholeButton', false);
  readMood();
  showFeeling();
  message('Ready. You can change the feeling or ask for another song at any time.');
  drawOverlay();
  $('videoPanel').scrollIntoView({ behavior: calmMode ? 'auto' : 'smooth', block: 'start' });
}

// No sphere was found. If the scene itself reads clearly, use that instead of stopping:
// the pipeline reads video mood, and the sphere is one way to read it, not the only one.
// An unclear scene keeps the old behavior (mark the sphere yourself).
function trySceneFallback() {
  const perFrame = state.frames.map((f) => EchoMood.readPalette(f, { cx: f.width / 2, cy: f.height / 2, rx: f.width / 2, ry: f.height / 2 }));
  if (!EchoMood.decide(EchoMood.meanScores(perFrame)).mood) return false;
  state.sceneFallback = true;
  $('detectionNote').textContent = 'No sphere was found, so the whole scene was read instead (green outline). If there is a sphere in the video, mark it yourself.';
  readMood();
  showFeeling();
  message('Ready. You can change the feeling or ask for another song at any time.');
  drawOverlay();
  $('videoPanel').scrollIntoView({ behavior: calmMode ? 'auto' : 'smooth', block: 'start' });
  return true;
}

const WORDS = EchoMood.COLOUR_WORDS;

function showFeeling() {
  const d = state.decision;
  show('feelingPanel', true);
  renderTimeline();
  if (d.mood) {
    state.mood = d.mood;
    if (state.sceneFallback) say($('interpretation'), `No sphere was found, so the whole scene was read. It is mostly ${WORDS[d.mood]}, which reads as `, { strong: NAMES[d.mood] }, '. Not right? Choose another feeling.');
    else say($('interpretation'), `The light inside the sphere is mostly ${WORDS[d.mood]}, which reads as `, { strong: NAMES[d.mood] }, '. Not right? Choose another feeling.');
  } else {
    state.mood = null;
    const [a, b] = d.ranked;
    say($('interpretation'), d.scores[a] < .35
      ? 'There is not much coloured light inside the sphere to read, so it does not point to one feeling. '
      : `The light inside the sphere mixes ${WORDS[a]} and ${WORDS[b]}, so it does not clearly point to one feeling. `, { strong: 'Choose the one that fits.' });
  }
  paintMoodButtons();
  fillDetails();
  if (state.mood) { applyMood(state.mood); state.variation = 0; pickSong(false); }
  else { show('songPanel', false); setTitle('Which feeling', '?'); $('soundMeta').textContent = 'The light does not settle on one'; message('Choose a feeling to hear a song.'); }
}

function fillDetails() {
  const d = state.decision, m = state.report && state.report.metrics;
  const shares = make('dl', {});
  for (const k of EchoMood.MOODS) {
    shares.append(make('dt', { textContent: NAMES[k] }), make('dd', {}, Object.assign(make('span', { className: 'bar' }), { style: `width:${Math.round(Math.min(1, d.scores[k]) * 90)}px` }), `${Math.round(d.scores[k] * 100)}%`));
  }
  const where = make('dl', {});
  if (state.sceneFallback) where.append(make('dt', { textContent: 'Region' }), make('dd', { textContent: 'whole scene (no sphere found)' }));
  else if (!state.manual && m) {
    where.append(make('dt', { textContent: 'Sphere found' }), make('dd', { textContent: `in ${Math.round(m.coverage * 100)}% of ${m.framesSampled} frames` }),
      make('dt', { textContent: 'Uncertainty' }), make('dd', { textContent: `${m.uncertaintyIndex.toFixed(2)} (0 confident, 1 unreliable; a rule of thumb, not a probability)` }));
  } else where.append(make('dt', { textContent: 'Region' }), make('dd', { textContent: 'marked by you' }));
  where.append(make('dt', { textContent: 'Frames read' }), make('dd', { textContent: String(state.frames.length) }));
  $('details').replaceChildren(shares, make('p', { textContent: d.note }), where);
}

// ---- marking the sphere by hand ----------------------------------------------------------------------------------

function startDrawing() {
  state.drawing = true; state.draft = null;
  stage.classList.add('drawing');
  show('drawHint', true); show('wholeButton', true);
  video.pause();
}

function setManual(ellipse) {
  state.manual = ellipse;
  state.draft = null;
  state.drawing = false;
  stage.classList.remove('drawing');
  show('drawHint', false); show('wholeButton', false);
  presentAnalysis();
}

function pointer(e) {
  const r = overlay.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
}
overlay.addEventListener('pointerdown', (e) => {
  if (!state.drawing) return;
  overlay.setPointerCapture(e.pointerId);
  const p = pointer(e);
  state.draft = { cx: p.x, cy: p.y, rx: 0, ry: 0, live: true };
});
overlay.addEventListener('pointermove', (e) => {
  if (!state.draft || !state.draft.live) return;
  const p = pointer(e), d = state.draft, radius = Math.hypot((p.x - d.cx) * p.w, (p.y - d.cy) * p.h);
  d.rx = radius / p.w; d.ry = radius / p.h;
  drawOverlay();
});
overlay.addEventListener('pointerup', (e) => {
  const d = state.draft;
  if (!d || !d.live) return;
  d.live = false;
  const r = overlay.getBoundingClientRect();
  if (d.ry * r.height < 10) { state.draft = null; drawOverlay(); return; }
  setManual({ cx: d.cx, cy: d.cy, rx: d.rx * EchoDetect.INTERIOR_SHRINK, ry: d.ry * EchoDetect.INTERIOR_SHRINK });
});

// ---- the outline drawn over the video ---------------------------------------------------------------------------

function drawEllipse(ctx, e, w, h, style, width, dash) {
  ctx.beginPath();
  ctx.ellipse(e.cx * w, e.cy * h, Math.max(1, e.rx * w), Math.max(1, e.ry * h), 0, 0, Math.PI * 2);
  ctx.setLineDash(dash || []); ctx.lineWidth = width; ctx.strokeStyle = style; ctx.stroke();
}

function drawOverlay() {
  const rect = overlay.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
  const ctx = overlay.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
  if (!$('showOverlay').checked && !state.drawing) return;
  const line = Math.max(2, 2 * dpr), t = video.currentTime;
  if (state.sceneFallback) drawEllipse(ctx, { cx: .5, cy: .5, rx: .5, ry: .5 }, w, h, '#6fe08a', line);
  else if (state.manual) drawEllipse(ctx, state.manual, w, h, '#6fe08a', line);
  else if (state.report && state.report.track.length) {
    const e = EchoDetect.focusAt(state.report, t);
    if (state.report.status === 'ok') {
      drawEllipse(ctx, e, w, h, '#6fe08a', line);
      drawEllipse(ctx, { cx: e.cx, cy: e.cy, rx: e.rx / EchoDetect.INTERIOR_SHRINK, ry: e.ry / EchoDetect.INTERIOR_SHRINK }, w, h, 'rgba(255,224,110,.75)', Math.max(1, dpr));
    } else drawEllipse(ctx, e, w, h, 'rgba(240,110,120,.9)', line, [8 * dpr, 6 * dpr]);       // what it found, marked as not reliable
  }
  if (state.draft) drawEllipse(ctx, state.draft, w, h, '#ffd166', line, [6 * dpr, 5 * dpr]);
}

// ---- choosing and loading the song -------------------------------------------------------------------------------

async function pickSong(another) {
  if (!state.manifest) return message('The song library could not be loaded.', true);
  if (another) state.variation++;
  const pick = EchoLibrary.choose(state.manifest, state.mood, state.duration, `${state.seed}:${state.variation}`, another && state.track ? state.track.id : null);
  if (!pick) { show('songPanel', false); return message(`There are no ${NAMES[state.mood]} songs in the library yet.`, true); }
  const wasPlaying = !video.paused && !video.ended;
  stopAudioOnly();
  state.pick = pick; state.track = pick.track;
  state.gain = EchoLibrary.gainFor(pick.track, state.duration);
  audio.loop = pick.looped;
  audio.src = EchoLibrary.urlOf(BASE, pick.track);
  audio.load();
  fillSongPanel();
  applyGain();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 30000);
      audio.oncanplay = () => { clearTimeout(timer); resolve(); };
      audio.onerror = () => { clearTimeout(timer); reject(new Error('audio')); };
    });
  } catch {
    return message('That song could not be loaded. Try “Another song”.', true);
  }
  syncAudio(true);
  if (wasPlaying) { try { await audio.play(); } catch { /* the play button starts it again */ } }
}

function fillSongPanel() {
  const t = state.track, pick = state.pick;
  show('songPanel', true);
  $('songTitle').textContent = t.title;
  $('songMeta').textContent = `${NAMES[state.mood]} · ${t.artist || 'Unknown artist'} · a ${fmt(t.duration)} song, playing for ${fmt(state.duration)}`;
  const credit = EchoLibrary.creditLine(t);
  $('credit').replaceChildren(`Music: ${credit}. ${EchoLibrary.EDIT_NOTE} `, make('a', { href: EchoLibrary.CREDITS_URL, textContent: 'All credits', target: '_blank', rel: 'noopener' }));
  const notes = [];
  if (pick.looped) notes.push('This song is shorter than your video, so it repeats.');
  if (state.gain.limited) notes.push('This song is very quiet, so it may sound softer than the others.');
  $('songNote').textContent = notes.join(' ');
  const link = $('downloadSong');
  link.href = EchoLibrary.urlOf(BASE, t);
  link.download = `${t.title}.mp3`;
  $('soundMeta').textContent = `${t.title} · ${t.artist || ''}`.trim();
  $('clock').textContent = `${fmt(video.currentTime)} / ${fmt(state.duration)}`;
}

// ---- playing the video with the song ----------------------------------------------------------------------------

function ensureGraph() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaElementSource(audio);
  const gain = audioCtx.createGain(), env = audioCtx.createGain(), master = audioCtx.createGain();
  const limiter = audioCtx.createDynamicsCompressor(), analyser = audioCtx.createAnalyser();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .003; limiter.release.value = .1;
  analyser.fftSize = 256; analyser.smoothingTimeConstant = .8;
  master.gain.value = Number($('volume').value);
  source.connect(gain); gain.connect(env); env.connect(limiter); limiter.connect(master); master.connect(analyser); analyser.connect(audioCtx.destination);
  nodes = { gain, env, master, analyser };
  analyserNode = analyser;
  applyGain();
}

function applyGain() {
  if (nodes && state.gain) nodes.gain.gain.value = Math.pow(10, state.gain.db / 20);      // brings every song to about the same level
}

function audioTimeFor(t) {
  const start = EchoLibrary.startOf(state.track);
  const span = Math.max(.1, state.track.duration - start);
  return start + (state.pick.looped ? t % span : Math.min(t, span - .05));
}

let lastCorrection = 0;
function syncAudio(force) {
  if (!state.track) return;
  const expected = audioTimeFor(video.currentTime), now = performance.now();
  if (!force) {
    // Small drift is left alone, and a seek already under way is never interrupted: on a slow connection every
    // correction is a new download, and correcting too eagerly makes the song stutter.
    if (audio.seeking || Math.abs(audio.currentTime - expected) < .5 || now - lastCorrection < 2000) return;
  }
  lastCorrection = now;
  try { audio.currentTime = expected; } catch { /* not seekable yet */ }
}

function tickEnvelope() {
  if (!nodes) return;
  nodes.env.gain.setTargetAtTime(EchoLibrary.envelope(video.currentTime, state.duration), audioCtx.currentTime, .015);
}

async function play() {
  if (!state.track) return;
  ensureGraph();
  await audioCtx.resume();
  if (video.ended || video.currentTime >= state.duration - .1) video.currentTime = 0;
  syncAudio(true);
  tickEnvelope();
  try { await Promise.all([video.play(), audio.play()]); } catch (e) { message('The browser blocked playback. Press Play again.', true); return; }
  isPlaying = true;
  window.dispatchEvent(new Event('sphere-change'));
  clearInterval(envelopeTimer);
  envelopeTimer = setInterval(tickEnvelope, 40);
  paintPlayButton();
  requestAnimationFrame(loop);
}

function stopAudioOnly() { audio.pause(); }

function stop() {
  video.pause(); audio.pause();
  isPlaying = false;
  clearInterval(envelopeTimer);
  paintPlayButton();
}

function paintPlayButton() {
  const on = !video.paused && !video.ended;
  $('playButton').textContent = on ? 'Pause' : 'Play with the video';
  $('playButton').classList.toggle('playing', on);
  $('playButton').setAttribute('aria-pressed', String(on));
}

function loop() {
  drawOverlay();
  highlightTimeline(video.currentTime);
  if (!video.paused && !video.ended) requestAnimationFrame(loop);
}

video.addEventListener('pause', () => { audio.pause(); isPlaying = false; clearInterval(envelopeTimer); paintPlayButton(); });
video.addEventListener('ended', () => { audio.pause(); isPlaying = false; clearInterval(envelopeTimer); if (nodes) nodes.env.gain.value = 0; paintPlayButton(); });
video.addEventListener('seeked', () => { if (state.track && !state.busy) syncAudio(true); drawOverlay(); highlightTimeline(video.currentTime); });
video.addEventListener('timeupdate', () => {
  if (state.busy) return;
  $('clock').textContent = `${fmt(video.currentTime)} / ${fmt(state.duration)}`;
  if (state.duration) $('scrub').value = String(Math.round(video.currentTime / state.duration * 1000));
  if (!video.paused && state.track) syncAudio(false);
  if (video.paused) drawOverlay();
});
$('scrub').addEventListener('input', () => { if (state.duration) video.currentTime = Number($('scrub').value) / 1000 * state.duration; });
$('volume').addEventListener('input', () => { if (nodes) nodes.master.gain.value = Number($('volume').value); });
$('playButton').addEventListener('click', () => { if (!video.paused && !video.ended) stop(); else play(); });
$('anotherButton').addEventListener('click', () => pickSong(true));

// ---- controls ---------------------------------------------------------------------------------------------------

document.querySelectorAll('.mood-btn').forEach((b) => b.addEventListener('click', () => {
  state.mood = b.dataset.mood; state.variation = 0;
  applyMood(state.mood); paintMoodButtons(); pickSong(false);
  message(`${NAMES[state.mood]} chosen.`);
}));
$('addButton').addEventListener('click', () => $('fileInput').click());
$('changeButton').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; handleFile(f); });
$('drawButton').addEventListener('click', () => { startDrawing(); drawOverlay(); message('Drag from the middle of the sphere out to its edge.'); });
$('wholeButton').addEventListener('click', () => setManual({ cx: .5, cy: .5, rx: .48, ry: .48 }));
$('autoButton').addEventListener('click', () => { state.manual = null; presentAnalysis(); });
$('showOverlay').addEventListener('change', drawOverlay);
window.addEventListener('resize', drawOverlay, { passive: true });
$('calmToggle').addEventListener('click', () => setQuiet(!calmMode));
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => setQuiet(e.matches));
$('creditsButton').onclick = () => $('creditsDialog').showModal();
$('closeCredits').onclick = () => $('creditsDialog').close();

for (const type of ['dragenter', 'dragover']) document.addEventListener(type, (e) => { e.preventDefault(); $('addButton').classList.add('over'); });
for (const type of ['dragleave', 'drop']) document.addEventListener(type, (e) => { e.preventDefault(); $('addButton').classList.remove('over'); });
document.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) handleFile(f); });

setQuiet(calmMode);
loadLibrary();
window.EchoApp = { state, handleFile, pickSong, play, stop, setManual, video, audio };      // for the automated browser tests
