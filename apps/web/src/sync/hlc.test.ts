import { describe, expect, it } from 'vitest';
import { HlcClock, compareHlc, decodeHlc, encodeHlc } from './hlc';

describe('encode/decode', () => {
  it('round-trips', () => {
    const hlc = { wallMs: 1751818000000, counter: 42, deviceId: 'devA' };
    expect(decodeHlc(encodeHlc(hlc))).toEqual(hlc);
  });

  it('string order matches (wallMs, counter, deviceId) order', () => {
    const base = { wallMs: 1751818000000, counter: 5, deviceId: 'b' };
    const laterWall = encodeHlc({ ...base, wallMs: base.wallMs + 1, counter: 0 });
    const laterCounter = encodeHlc({ ...base, counter: 6 });
    const laterDevice = encodeHlc({ ...base, deviceId: 'c' });
    const enc = encodeHlc(base);
    expect(compareHlc(enc, laterWall)).toBe(-1);
    expect(compareHlc(enc, laterCounter)).toBe(-1);
    expect(compareHlc(enc, laterDevice)).toBe(-1);
    expect(compareHlc(enc, enc)).toBe(0);
  });
});

describe('HlcClock', () => {
  it('produces strictly increasing stamps even when wall clock is frozen', () => {
    const clock = new HlcClock('dev', undefined, () => 1000);
    const stamps = Array.from({ length: 100 }, () => clock.now());
    for (let i = 1; i < stamps.length; i++) {
      expect(compareHlc(stamps[i - 1], stamps[i])).toBe(-1);
    }
  });

  it('survives wall clock jumping backwards', () => {
    let wall = 5000;
    const clock = new HlcClock('dev', undefined, () => wall);
    const a = clock.now();
    wall = 3000; // clock jumped back 2s
    const b = clock.now();
    expect(compareHlc(a, b)).toBe(-1);
  });

  it('observe() pushes local time past a remote stamp from the future', () => {
    const clock = new HlcClock('local', undefined, () => 1000);
    const remote = encodeHlc({ wallMs: 99000, counter: 7, deviceId: 'remote' });
    clock.observe(remote);
    const next = clock.now();
    expect(compareHlc(remote, next)).toBe(-1);
  });

  it('observe() of an older remote stamp does not move the clock backwards', () => {
    let wall = 50000;
    const clock = new HlcClock('local', undefined, () => wall);
    const before = clock.now();
    clock.observe(encodeHlc({ wallMs: 10, counter: 0, deviceId: 'remote' }));
    const after = clock.now();
    expect(compareHlc(before, after)).toBe(-1);
  });

  it('reports skew of a remote stamp', () => {
    const clock = new HlcClock('local', undefined, () => 1000);
    expect(clock.skewMs(encodeHlc({ wallMs: 400000, counter: 0, deviceId: 'r' }))).toBe(399000);
  });
});
