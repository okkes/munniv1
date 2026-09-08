// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDragReorder } from './dragReorder';

afterEach(cleanup);

/** three 40px rows stacked from y=0 — happy-dom rects are all zero, so
 *  each row fakes its own box for the midpoint math */
function Harness({ onMove }: Readonly<{ onMove: (from: number, to: number) => void }>) {
  const { drag, setRowRef, handleProps } = useDragReorder(3, onMove);
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          data-testid={`row-${i}`}
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => ({ top: i * 40, height: 40 }) as DOMRect;
            setRowRef(i)(el);
          }}
          className={drag?.over === i ? 'over' : ''}
        >
          <button data-testid={`handle-${i}`} {...handleProps(i)}>
            drag
          </button>
        </div>
      ))}
    </div>
  );
}

describe('useDragReorder', () => {
  it('commits one move from the pressed row to the hovered row on release', async () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const handle = screen.getByTestId('handle-0');

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 90 }); // row 2's midpoint zone
    expect(screen.getByTestId('row-2').className).toContain('over');
    fireEvent.pointerUp(handle, { pointerId: 1 });

    // v3 settles the ghost into its slot before committing (drop animation)
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(0, 2));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('a cancelled or unmoved drag commits nothing', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const handle = screen.getByTestId('handle-1');

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1 }); // released in place

    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 110 });
    fireEvent.pointerCancel(handle, { pointerId: 2 }); // e.g. scroll takeover

    expect(onMove).not.toHaveBeenCalled();
  });
});
