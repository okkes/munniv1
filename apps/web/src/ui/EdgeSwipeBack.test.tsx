// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeSwipeBack } from './EdgeSwipeBack';

const swipe = (fromX: number, toX: number, y = 300, endY?: number) => {
  fireEvent.touchStart(window, { touches: [{ clientX: fromX, clientY: y }] });
  fireEvent.touchMove(window, { touches: [{ clientX: toX, clientY: endY ?? y }] });
  fireEvent.touchEnd(window, { touches: [] });
};

describe('EdgeSwipeBack', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a left-edge horizontal swipe goes back — only on screens with a back arrow', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { rerender } = render(
      <>
        <EdgeSwipeBack />
        <button data-testid="screen-back" />
      </>,
    );
    swipe(10, 120);
    expect(back).toHaveBeenCalledTimes(1);

    // starting away from the edge is a scroll, not a back
    swipe(80, 220);
    expect(back).toHaveBeenCalledTimes(1);

    // wandering vertically disarms the gesture
    fireEvent.touchStart(window, { touches: [{ clientX: 5, clientY: 100 }] });
    fireEvent.touchMove(window, { touches: [{ clientX: 40, clientY: 300 }] });
    fireEvent.touchMove(window, { touches: [{ clientX: 140, clientY: 300 }] });
    fireEvent.touchEnd(window, { touches: [] });
    expect(back).toHaveBeenCalledTimes(1);

    // no back arrow on screen → the gesture stands down entirely
    rerender(<EdgeSwipeBack />);
    swipe(10, 120);
    expect(back).toHaveBeenCalledTimes(1);
  });
});
