// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { nearestScrollport, padScrollportForKeyboard, restoreScrollportPad } from './viewport';

const build = () => {
  document.body.innerHTML = '';
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  const wrapper = document.createElement('div'); // plain, not a scroller
  const field = document.createElement('textarea');
  wrapper.appendChild(field);
  scroller.appendChild(wrapper);
  document.body.appendChild(scroller);
  return { scroller, field };
};

const setViewport = (innerHeight: number, visualHeight: number) => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: { height: visualHeight, offsetTop: 0 },
  });
};

describe('keyboard scrollport padding (iOS layout viewport never shrinks)', () => {
  afterEach(() => {
    restoreScrollportPad();
    setViewport(800, 800);
  });

  it('nearestScrollport walks past non-scrolling wrappers and stops at body', () => {
    const { scroller, field } = build();
    expect(nearestScrollport(field)).toBe(scroller);
    const loose = document.createElement('input');
    document.body.appendChild(loose);
    expect(nearestScrollport(loose)).toBeNull();
  });

  it('pads by the keyboard inset and restores the previous padding on close', () => {
    const { scroller, field } = build();
    scroller.style.paddingBottom = '24px';
    setViewport(800, 500); // keyboard took 300px, layout stayed 800
    padScrollportForKeyboard(field);
    expect(scroller.style.paddingBottom).toBe('316px'); // 300 inset + 16 breathing room
    restoreScrollportPad();
    expect(scroller.style.paddingBottom).toBe('24px');
  });

  it('is a no-op when the layout viewport resized with the keyboard (Android/native)', () => {
    const { scroller, field } = build();
    setViewport(500, 500); // resized together — inset 0
    padScrollportForKeyboard(field);
    expect(scroller.style.paddingBottom).toBe('');
  });
});
