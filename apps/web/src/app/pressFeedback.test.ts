// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initPressFeedback } from './pressFeedback';

const touchDown = (el: Element) =>
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));

describe('press feedback (touch affordance)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('marks a resting touch as pressed and clears it on cancel (scroll takeover)', () => {
    vi.useFakeTimers();
    initPressFeedback();
    const row = document.createElement('button');
    row.className = 'm-tap';
    document.body.appendChild(row);

    touchDown(row);
    expect(row.hasAttribute('data-pressed')).toBe(false); // not yet — flick grace
    vi.advanceTimersByTime(80);
    expect(row.hasAttribute('data-pressed')).toBe(true);

    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch' }));
    expect(row.hasAttribute('data-pressed')).toBe(false);
  });

  it('a long-press context menu clears the pressed look and drops pointer capture', () => {
    // the copy-link menu on an <a> swallows pointerup; without these the
    // link stayed "pressed" and kept capturing every later touch
    vi.useFakeTimers();
    initPressFeedback();
    const link = document.createElement('a');
    link.className = 'm-tap';
    document.body.appendChild(link);
    const release = vi.fn();
    Object.assign(link, { hasPointerCapture: () => true, releasePointerCapture: release });

    touchDown(link);
    expect(release).toHaveBeenCalled(); // implicit capture dropped up front
    vi.advanceTimersByTime(80);
    expect(link.hasAttribute('data-pressed')).toBe(true);

    document.dispatchEvent(new Event('contextmenu', { bubbles: true }));
    expect(link.hasAttribute('data-pressed')).toBe(false);
  });

  it('switching away (store login opens) clears the pressed look', () => {
    vi.useFakeTimers();
    initPressFeedback();
    const row = document.createElement('button');
    row.className = 'm-tap';
    document.body.appendChild(row);

    touchDown(row);
    vi.advanceTimersByTime(80);
    expect(row.hasAttribute('data-pressed')).toBe(true);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(row.hasAttribute('data-pressed')).toBe(false);
  });

  it('ignores mouse pointers and non-tappable targets', () => {
    vi.useFakeTimers();
    initPressFeedback();
    const row = document.createElement('button');
    row.className = 'm-tap';
    const plain = document.createElement('div');
    document.body.append(row, plain);

    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    touchDown(plain);
    vi.advanceTimersByTime(120);
    expect(row.hasAttribute('data-pressed')).toBe(false);
    expect(plain.hasAttribute('data-pressed')).toBe(false);
  });
});
