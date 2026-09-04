// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LangProvider } from '@/i18n';
// harness registers RTL cleanup between tests
import '@/test/harness';
import { WebcamCaptureSheet } from './WebcamCaptureSheet';

/** happy-dom may or may not ship a mediaDevices stub — pin it per test */
const setMediaDevices = (value: unknown) => {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
};

const renderSheet = (onCapture = vi.fn(), onOpenChange = vi.fn()) => {
  localStorage.setItem('munni_lang', 'en');
  render(
    <LangProvider>
      <WebcamCaptureSheet open onOpenChange={onOpenChange} onCapture={onCapture} />
    </LangProvider>,
  );
  return { onCapture, onOpenChange };
};

describe('WebcamCaptureSheet', () => {
  it('shows the error note instead of crashing when mediaDevices is missing (#160)', async () => {
    setMediaDevices(undefined);
    renderSheet();
    expect(await screen.findByTestId('webcam-error')).toBeTruthy();
    // r2: the video shell stays mounted; only Start/Capture stand down
    expect(screen.queryByTestId('webcam-capture')).toBeNull();
    expect(screen.queryByTestId('webcam-start')).toBeNull();
  });

  it('shows the error note when the camera permission is refused', async () => {
    setMediaDevices({ getUserMedia: vi.fn(() => Promise.reject(new Error('denied'))) });
    renderSheet();
    expect(await screen.findByTestId('webcam-error')).toBeTruthy();
  });

  it('#160 r2: a suppressed prompt leaves the GESTURE start — clicking it asks again', async () => {
    // Chromium auto-denies gesture-less requests: NotAllowedError first…
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const getUserMedia = vi
      .fn<() => Promise<MediaStream>>()
      .mockRejectedValueOnce(denied)
      .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream);
    setMediaDevices({ getUserMedia });
    renderSheet();
    // …the note names the cure and the Start button waits for a real tap
    expect(await screen.findByTestId('webcam-error')).toBeTruthy();
    const start = await screen.findByTestId('webcam-start');
    fireEvent.click(start);
    // the gesture attempt succeeds: capture arms, the note clears
    expect(await screen.findByTestId('webcam-capture')).toBeTruthy();
    expect(screen.queryByTestId('webcam-error')).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('starts the front camera into the preview and stops tracks on close', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);
    setMediaDevices({ getUserMedia });

    localStorage.setItem('munni_lang', 'en');
    const onCapture = vi.fn();
    const view = render(
      <LangProvider>
        <WebcamCaptureSheet open onOpenChange={vi.fn()} onCapture={onCapture} />
      </LangProvider>,
    );

    expect(await screen.findByTestId('webcam-video')).toBeTruthy();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user' } });

    // happy-dom has no canvas pixels — the capture handler must stay
    // defensive: no blob, no capture, the sheet simply stays open
    fireEvent.click(screen.getByTestId('webcam-capture'));
    expect(onCapture).not.toHaveBeenCalled();

    view.unmount();
    // the stream may resolve before OR after unmount — both paths stop the tracks
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });
});
