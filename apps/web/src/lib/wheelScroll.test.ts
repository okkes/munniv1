// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { wheelToHorizontal } from './wheelScroll';

/** a strip with mocked layout: happy-dom has no real layout engine */
function strip(overflowX: string, opts: { scrollWidth?: number; clientWidth?: number; scrollHeight?: number; clientHeight?: number } = {}) {
  const el = document.createElement('div');
  el.style.overflowX = overflowX;
  el.style.overflowY = 'hidden';
  Object.defineProperty(el, 'scrollWidth', { value: opts.scrollWidth ?? 500 });
  Object.defineProperty(el, 'clientWidth', { value: opts.clientWidth ?? 200 });
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight ?? 40 });
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight ?? 40 });
  document.body.appendChild(el);
  return el;
}

const wheel = (target: Element, deltaY: number, ctrlKey = false) => {
  const e = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true });
  Object.defineProperty(e, 'target', { value: target });
  // happy-dom's WheelEvent drops MouseEventInit modifiers — pin it
  if (ctrlKey) Object.defineProperty(e, 'ctrlKey', { value: true });
  wheelToHorizontal(e);
  return e;
};

describe('#153: vertical wheel drives horizontal-only scrollers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('translates deltaY into scrollLeft on a horizontal scroller and consumes the event', () => {
    const el = strip('auto');
    const e = wheel(el, 60);
    expect(el.scrollLeft).toBe(60);
    expect(e.defaultPrevented).toBe(true);
  });

  it('walks up to the nearest scrollable ancestor from an inner icon', () => {
    const el = strip('scroll');
    const icon = document.createElement('button');
    el.appendChild(icon);
    wheel(icon, 40);
    expect(el.scrollLeft).toBe(40);
  });

  it('at the end of the strip the event falls through so the page scrolls', () => {
    const el = strip('auto');
    el.scrollLeft = 300; // happy-dom does not clamp — treat as at-end
    const e = wheel(el, 0); // deltaY 0: never handled
    expect(e.defaultPrevented).toBe(false);
  });

  it('a VERTICAL scroller keeps its wheel; ctrl+wheel (zoom) is never touched', () => {
    const vertical = strip('hidden', { scrollHeight: 900, clientHeight: 300 });
    vertical.style.overflowY = 'auto';
    const inert = wheel(vertical, 60);
    expect(vertical.scrollLeft).toBe(0);
    expect(inert.defaultPrevented).toBe(false);

    const horizontal = strip('auto');
    const zoom = wheel(horizontal, 60, true);
    expect(horizontal.scrollLeft).toBe(0);
    expect(zoom.defaultPrevented).toBe(false);
  });

  it('a plain element without overflow lets the page scroll', () => {
    const el = strip('visible');
    const e = wheel(el, 60);
    expect(el.scrollLeft).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });
});
