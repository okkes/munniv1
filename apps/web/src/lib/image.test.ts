// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downscaleImage, fitWithin, isDataImage } from './image';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fitWithin', () => {
  it('keeps small images untouched', () => {
    expect(fitWithin(100, 80, 256)).toEqual({ width: 100, height: 80 });
  });

  it('scales down preserving aspect ratio on the long side', () => {
    expect(fitWithin(1024, 512, 256)).toEqual({ width: 256, height: 128 });
    expect(fitWithin(512, 1024, 256)).toEqual({ width: 128, height: 256 });
    expect(fitWithin(3000, 3000, 128)).toEqual({ width: 128, height: 128 });
  });

  it('never collapses a dimension to zero', () => {
    expect(fitWithin(10_000, 1, 128).height).toBe(1);
  });
});

describe('isDataImage', () => {
  it('detects data-URL images and nothing else', () => {
    expect(isDataImage('data:image/jpeg;base64,abc')).toBe(true);
    expect(isDataImage('account-outline|#08372B')).toBe(false);
    expect(isDataImage('data:text/plain;base64,x')).toBe(false);
    expect(isDataImage(null)).toBe(false);
    expect(isDataImage(undefined)).toBe(false);
  });
});

describe('downscaleImage', () => {
  it('draws the bitmap onto a fitted canvas and returns the JPEG data URL', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1000, height: 500, close }));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,tiny');

    const url = await downscaleImage(new Blob(['x']), 256);
    expect(url).toBe('data:image/jpeg;base64,tiny');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 256, 128);
    expect(close).toHaveBeenCalled(); // bitmap released on success
  });

  it('releases the bitmap when the canvas is unavailable', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(downscaleImage(new Blob(['x']))).rejects.toThrow('canvas unavailable');
    expect(close).toHaveBeenCalled();
  });
});
