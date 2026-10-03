import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const Lib = require('../../video-music/library.js');
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, '../fixtures/choose-parity.json'), 'utf8'));

// The hash must stay bit-identical to _hash32() in server/library.py: the same
// seed has to pick the same track on the server and in the browser.
test('hash32 matches the server hash vectors', () => {
  assert.equal(Lib.hash32('clip:7|warm'), 2760582269);
  assert.equal(Lib.hash32('a:0|sad'), 3462567549);
  assert.equal(Lib.hash32('12345|calm'), 1180301838);
  assert.equal(Lib.hash32('My Video.mp4|123456|10.00:3|anger'), 654948314);
  assert.equal(Lib.hash32('x'), 794621484);
});

// The Python test test_track_choice_matches_browser in tests/test_library.py
// asserts the same picks from the same fixture; the two must never disagree.
test('choose() picks the agreed tracks for the shared fixture', () => {
  const cases = [
    ['warm', 60, 'clip:7', 't2', false],
    ['warm', 60, 'a:0', 't1', false],
    ['sad', 10, 'x', 't4', false],
    ['warm', 5000, 'clip:7', 't2', true],   // nothing long enough: the longest is looped
    ['warm', 10, 'My Video.mp4|123456|10.00:3', 't3', false],
  ];
  for (const [mood, duration, seed, id, looped] of cases) {
    const r = Lib.choose(manifest, mood, duration, seed);
    assert.equal(r.track.id, id, `${mood}/${duration}/${seed}`);
    assert.equal(r.looped, looped);
  }
});
