// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyboardReveal } from './keyboardReveal';

/** a controllable stand-in for window.visualViewport */
function makeViewport(height: number) {
  const listeners = new Set<() => void>();
  return {
    height,
    offsetTop: 0,
    addEventListener: (_: 'resize', l: () => void) => listeners.add(l),
    removeEventListener: (_: 'resize', l: () => void) => listeners.delete(l),
    fire() {
      for (const l of listeners) l();
    },
    shrink(next: number) {
      this.height = next;
      this.fire();
    },
  };
}

describe('installKeyboardReveal (#129)', () => {
  let uninstall: () => void;
  let viewport: ReturnType<typeof makeViewport>;
  let field: HTMLTextAreaElement;
  let scrolled: number;

  beforeEach(() => {
    vi.useFakeTimers();
    scrolled = 0;
    viewport = makeViewport(800);
    uninstall = installKeyboardReveal(viewport);
    field = document.createElement('textarea');
    document.body.appendChild(field);
    field.scrollIntoView = () => {
      scrolled += 1;
    };
  });

  afterEach(() => {
    uninstall();
    field.remove();
    vi.useRealTimers();
  });

  const placeField = (top: number, bottom: number) => {
    field.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
  };

  it('scrolls a field the keyboard swallowed back into view once the viewport settles', () => {
    placeField(700, 760); // visible at 800…
    field.focus();
    viewport.shrink(400); // …but the keyboard halves the viewport
    vi.advanceTimersByTime(350);
    expect(scrolled).toBe(1);
  });

  it('leaves a field that is already visible alone', () => {
    placeField(100, 160);
    field.focus();
    viewport.shrink(400);
    vi.advanceTimersByTime(350);
    expect(scrolled).toBe(0);
  });

  it('reveals on focus hops while the keyboard is already up (no resize fires)', () => {
    viewport.shrink(400);
    vi.advanceTimersByTime(350); // settle the shrink with nothing focused
    placeField(500, 560); // below the 400px fold
    field.focus(); // focusin schedules its own pass
    vi.advanceTimersByTime(350);
    expect(scrolled).toBe(1);
  });

  it('does nothing when focus is not on an editable', () => {
    field.blur();
    viewport.shrink(400);
    vi.advanceTimersByTime(350);
    expect(scrolled).toBe(0);
  });

  it('uninstall stops listening', () => {
    uninstall();
    placeField(700, 760);
    field.focus();
    viewport.shrink(400);
    vi.advanceTimersByTime(350);
    expect(scrolled).toBe(0);
  });

  it('is a no-op without a visual viewport (old browsers)', () => {
    expect(installKeyboardReveal(null)).toBeTypeOf('function');
  });
});
