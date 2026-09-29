// Chooses a song for a mood from music-library/manifest.json and works out how to play it. The browser twin of server/library.py.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EchoLibrary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MOODS = ['warm', 'calm', 'sad', 'anger'];
  const TARGET_LUFS = -20;                   // about where the instrument composer sits
  const MAX_BOOST_DB = 18, MAX_CUT_DB = 12;
  const END_MARGIN = .5;                     // a track must outlast the video by this much, or it would have to loop
  const EDIT_NOTE = 'Edited: shortened and faded to fit the video.';
  const CREDITS_URL = 'https://github.com/Ehtiram-Shukurov/echosphere-music/blob/main/music-library/CREDITS.md';

  // A small, stable string hash (FNV-1a with a final mix), so the same input always picks the same song.
  function hash32(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
    return h >>> 0;
  }

  // Only tracks the manifest marks eligible are ever played.
  function playable(manifest) {
    return ((manifest && manifest.tracks) || []).filter((t) => t.eligible && MOODS.includes(t.mood) && t.file && t.duration > 0);
  }

  function counts(manifest) {
    const out = { warm: 0, calm: 0, sad: 0, anger: 0 };
    for (const t of playable(manifest)) out[t.mood]++;
    return out;
  }

  // Start after any digital silence, keeping a quarter second so a soft attack is not clipped.
  function startOf(track) {
    return Math.max(0, ((track.features && track.features.lead_silence_s) || 0) - .25);
  }

  // The loudness of the stretch that will actually play, from the closest measured excerpt (10 s, 30 s or 60 s).
  function loudnessOf(track, seconds) {
    const f = track.features || {};
    const order = seconds <= 20 ? ['lufs_10', 'lufs_30', 'lufs'] : seconds <= 45 ? ['lufs_30', 'lufs_10', 'lufs'] : ['lufs', 'lufs_30', 'lufs_10'];
    for (const key of order) if (typeof f[key] === 'number' && Number.isFinite(f[key])) return f[key];
    return null;
  }

  // Volume change that brings the excerpt to the target level. `limited` is true when the limit stopped it short.
  function gainFor(track, seconds) {
    const lufs = loudnessOf(track, seconds);
    if (lufs === null) return { db: 0, measured: null, limited: false };
    const wanted = TARGET_LUFS - lufs, db = Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, wanted));
    return { db, measured: lufs, limited: db !== wanted, wanted };
  }

  // Repeatable pick among approved tracks long enough for the video; the longest one is looped only as a last resort.
  // `avoid` is a track id to skip when there is any alternative (used by "Another song").
  function choose(manifest, mood, duration, seed, avoid) {
    const pool = playable(manifest).filter((t) => t.mood === mood).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!pool.length) return null;
    const fits = pool.filter((t) => t.duration - startOf(t) >= duration + END_MARGIN);
    const use = fits.length ? fits : [pool.reduce((best, t) => (t.duration - startOf(t) > best.duration - startOf(best) ? t : best))];
    let index = hash32(`${seed}|${mood}`) % use.length;
    if (avoid && use.length > 1 && use[index].id === avoid) index = (index + 1) % use.length;
    return { track: use[index], candidates: pool.length, longEnough: fits.length, looped: !fits.length };
  }

  function fadeSeconds(duration) { return Math.min(.6, duration * .06); }

  // 0..1 multiplier at time t of a `duration`-long video: a short fade in and a fade out at the end.
  function envelope(t, duration) {
    const fade = fadeSeconds(duration);
    return Math.max(0, Math.min(1, t / .025)) * Math.max(0, Math.min(1, (duration - t) / fade));
  }

  function creditLine(track) {
    return track.credit || `${track.title} (${track.license || 'licence not recorded'})`;
  }

  function urlOf(base, track) {
    return base + track.file.split('/').map(encodeURIComponent).join('/');
  }

  return { MOODS, TARGET_LUFS, MAX_BOOST_DB, MAX_CUT_DB, END_MARGIN, EDIT_NOTE, CREDITS_URL, hash32, playable, counts, startOf, loudnessOf, gainFor, choose, fadeSeconds, envelope, creditLine, urlOf };
});
