// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
// harness registers RTL cleanup between tests
import '@/test/harness';
import { Highlight, splitHighlight } from './Highlight';

describe('splitHighlight', () => {
  it('finds all case-insensitive occurrences', () => {
    expect(splitHighlight('Netflix and netflix', 'netflix')).toEqual([
      { text: 'Netflix', hit: true },
      { text: ' and ', hit: false },
      { text: 'netflix', hit: true },
    ]);
  });

  it('returns the whole text unhit for empty or missing queries', () => {
    expect(splitHighlight('Albert Heijn', '')).toEqual([{ text: 'Albert Heijn', hit: false }]);
    expect(splitHighlight('Albert Heijn', '   ')).toEqual([{ text: 'Albert Heijn', hit: false }]);
    expect(splitHighlight('Albert Heijn', 'xyz')).toEqual([{ text: 'Albert Heijn', hit: false }]);
    expect(splitHighlight('', 'x')).toEqual([{ text: '', hit: false }]);
  });

  it('handles a hit spanning the whole string', () => {
    expect(splitHighlight('ING', 'ing')).toEqual([{ text: 'ING', hit: true }]);
  });
});

describe('Highlight', () => {
  it('wraps hits in <mark> and preserves the full text', () => {
    const { container } = render(<Highlight text="Spotify AB" query="spot" />);
    const mark = container.querySelector('mark')!;
    expect(mark.textContent).toBe('Spot');
    expect(container.textContent).toBe('Spotify AB');
  });

  it('renders plain text without marks when nothing matches', () => {
    const { container } = render(<Highlight text="Spotify" query="zz" />);
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe('Spotify');
  });
});
