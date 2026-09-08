// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LangProvider } from '@/i18n';
// harness registers RTL cleanup between tests
import '@/test/harness';
import { ColorPicker, hexToHsl, hslToHex } from './ColorPicker';

const PRESETS = ['#3498DB', '#E74C3C'] as const;

const renderPicker = (value = '#3498DB', onChange = vi.fn()) => {
  localStorage.setItem('munni_lang', 'en');
  render(
    <LangProvider>
      <ColorPicker colors={PRESETS} value={value} onChange={onChange} testIdPrefix="pk" customLabel="Custom" />
    </LangProvider>,
  );
  return onChange;
};

describe('color math', () => {
  it('converts between hex and hsl for the primaries', () => {
    expect(hexToHsl('#FF0000')).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl('#00FF00')).toEqual({ h: 120, s: 100, l: 50 });
    expect(hslToHex(0, 100, 50)).toBe('#FF0000');
    expect(hslToHex(240, 100, 50)).toBe('#0000FF');
  });

  it('round-trips arbitrary colors through hsl', () => {
    for (const hex of ['#FF8800', '#08372B', '#3498DB', '#FFFFFF', '#000000']) {
      const hsl = hexToHsl(hex)!;
      expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe(hex);
    }
  });

  it('rejects malformed hex strings', () => {
    expect(hexToHsl('nope')).toBeNull();
    expect(hexToHsl('#FFF')).toBeNull();
    expect(hexToHsl('#GGGGGG')).toBeNull();
  });
});

describe('ColorPicker', () => {
  it('preset swatch picks directly, wheel swatch shows the custom value', () => {
    const onChange = renderPicker('#123456'); // not in presets -> custom active
    fireEvent.click(screen.getByTestId('pk-3498DB'));
    expect(onChange).toHaveBeenCalledWith('#3498DB');
    const custom = screen.getByTestId('pk-custom') as HTMLButtonElement;
    expect(custom.style.background.toUpperCase()).toContain('#123456');
  });

  it('opens the wheel sheet and applies a hue drag', async () => {
    const onChange = renderPicker('#3498DB');
    fireEvent.click(screen.getByTestId('pk-custom'));
    const ring = await screen.findByTestId('colorwheel-ring');
    // happy-dom rects are 0x0, so the center is (0,0): pointing right = 3
    // o'clock = 90° hue on our 12-o'clock-based conic wheel
    fireEvent.pointerDown(ring, { clientX: 10, clientY: 0, pointerId: 1 });
    const { s, l } = hexToHsl('#3498DB')!;
    fireEvent.click(screen.getByTestId('colorwheel-apply'));
    expect(onChange).toHaveBeenCalledWith(hslToHex(90, s, l));
  });

  it('accepts precise hex input and normalizes it on apply', async () => {
    const onChange = renderPicker('#3498DB');
    fireEvent.click(screen.getByTestId('pk-custom'));
    const hexInput = await screen.findByTestId('colorwheel-hex');
    fireEvent.change(hexInput, { target: { value: 'ff8800' } }); // no # needed
    fireEvent.click(screen.getByTestId('colorwheel-apply'));
    expect(onChange).toHaveBeenCalledWith('#FF8800');
  });

  it('saturation and lightness sliders reshape the color', async () => {
    const onChange = renderPicker('#FF0000');
    fireEvent.click(screen.getByTestId('pk-custom'));
    const saturation = await screen.findByTestId('colorwheel-saturation');
    fireEvent.change(saturation, { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('colorwheel-lightness'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('colorwheel-apply'));
    expect(onChange).toHaveBeenCalledWith('#808080'); // fully desaturated mid-grey
  });
});
