// Video-pipeline regression (FR-29, AC-2.6): the guide feature must not change `record --dry` / `validate`.
// Fast: no TTS, no ffmpeg, no full build.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureCopy, demo, snapshot, read, browserSkipReason, SCRIPTS } from './helpers.mjs';

const SKIP = await browserSkipReason();
const norm = (s, dir) => s.split(dir).join('<DIR>').replace(/\x1b\[[0-9;]*m/g, '').replace(/\d+(\.\d+)?\s*ms/g, '<ms>');

describe('video pipeline is unaffected by the guide feature', () => {
  test('validate passes on the sample-app (with guide.yaml present)', () => {
    const ws = fixtureCopy('sample-app');
    const r = demo(['validate', path.join(ws, 'demo.yaml')], { cwd: ws });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Spec is valid/);
  });
  test('validate output is identical with and without guide.yaml (AC-2.6)', () => {
    const a = fixtureCopy('sample-app'); const b = fixtureCopy('sample-app'); fs.rmSync(path.join(b, 'guide.yaml'));
    const ra = demo(['validate', path.join(a, 'demo.yaml')], { cwd: a }); const rb = demo(['validate', path.join(b, 'demo.yaml')], { cwd: b });
    assert.equal(norm(ra.stdout + ra.stderr, a), norm(rb.stdout + rb.stderr, b));
  });
  test('record.mjs and assemble.mjs do not import guide.mjs (isolation)', () => {
    for (const f of ['record.mjs', 'assemble.mjs', 'cards.mjs', 'tts.mjs', 'review.mjs']) assert.ok(!/guide(-md)?\.mjs/.test(fs.readFileSync(path.join(SCRIPTS, 'lib', f), 'utf8')), `${f} imports guide`);
  });
  test('record --dry succeeds on the sample-app, with and without guide.yaml, with identical output (AC-2.6)', { skip: SKIP || false }, () => {
    const a = fixtureCopy('sample-app'); const b = fixtureCopy('sample-app'); fs.rmSync(path.join(b, 'guide.yaml'));
    const ra = demo(['record', path.join(a, 'demo.yaml'), '--dry'], { cwd: a }); const rb = demo(['record', path.join(b, 'demo.yaml'), '--dry'], { cwd: b });
    assert.equal(ra.status, 0, ra.stderr + ra.stdout); assert.equal(rb.status, 0, rb.stderr + rb.stdout);
    assert.match(ra.stdout, /Dry run passed for 2 scene\(s\)/);
    assert.equal(norm(ra.stdout + ra.stderr, a), norm(rb.stdout + rb.stderr, b));
  });
  test('record --dry creates no guide/ directory and leaves the workspace free of guide files', { skip: SKIP || false }, () => {
    const ws = fixtureCopy('sample-app');
    assert.equal(demo(['record', path.join(ws, 'demo.yaml'), '--dry'], { cwd: ws }).status, 0);
    assert.ok(!fs.existsSync(path.join(ws, 'guide')));
  });
  test('record --dry still reports a broken selector (runActions error path with errorDir unchanged)', { skip: SKIP || false }, () => {
    const ws = fixtureCopy('sample-app');
    fs.writeFileSync(path.join(ws, 'demo.yaml'), read(ws, 'demo.yaml').replace('click: "#add"', 'click: "#nope"'));
    const r = demo(['record', path.join(ws, 'demo.yaml'), '--dry'], { cwd: ws, timeout: 120000 });
    assert.equal(r.status, 1); assert.match(r.stderr, /#nope/);
    assert.ok(!fs.existsSync(path.join(ws, 'guide')), 'video errors do not go to guide/errors');
    assert.ok(fs.existsSync(path.join(ws, 'recordings')), 'video errors stay under recordings/');
  });
  test('video dry-run is a no-op for existing guide/ files', { skip: SKIP || false }, () => {
    const ws = fixtureCopy('sample-app'); fs.mkdirSync(path.join(ws, 'guide')); fs.writeFileSync(path.join(ws, 'guide', 'guide.md'), 'mine');
    const before = snapshot(path.join(ws, 'guide'));
    demo(['record', path.join(ws, 'demo.yaml'), '--dry'], { cwd: ws });
    assert.deepEqual(snapshot(path.join(ws, 'guide')), before);
  });
});
