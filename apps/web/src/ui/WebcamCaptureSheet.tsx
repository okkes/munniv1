import { useEffect, useRef, useState } from 'react';
import { isNativeApp } from '@/lib/platform';
import { useLang } from '@/i18n';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/** #160: the webcam door shows only where it earns its place — desktop
 *  viewports (phones/native have the camera path already) whose browser
 *  actually exposes a mediaDevices camera API */
export function useWebcamDoor(): boolean {
  // #160 r3 (user): capability decides, not viewport size — a small
  // desktop window still has its webcam. Native shells keep their own
  // photo chooser instead.
  return !isNativeApp() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

interface WebcamCaptureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the snapshot, ready for the host's existing downscale/attach path */
  onCapture: (file: File) => void;
}

type CamError = 'denied' | 'nocamera' | 'busy' | 'unavailable';

/** map a getUserMedia rejection to the guidance the user can act on */
const camErrorOf = (err: unknown): CamError => {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'nocamera';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'denied';
};

/**
 * #160 (user): desktops have no camera-capable file input worth using —
 * a webcam snapshot sheet serves every own-picture upload site instead.
 * r2: Chromium suppresses permission prompts for gesture-less
 * getUserMedia (Edge/Chrome showed no popup while Firefox asked), so
 * the stream now starts from the explicit Start button — a real user
 * activation — with an auto-attempt on open kept for browsers that
 * allow it. Every failure names its cure (address-bar permission, no
 * camera, camera busy). Tracks stop on close/unmount, always.
 */
export function WebcamCaptureSheet({ open, onOpenChange, onCapture }: Readonly<WebcamCaptureSheetProps>) {
  const { t } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<CamError | null>(null);
  const [running, setRunning] = useState(false);

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRunning(false);
  };

  const start = async () => {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setError('unavailable'); // no API at all (old browser, test env)
      return;
    }
    setError(null);
    try {
      const stream = await media.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setRunning(true);
      const video = videoRef.current;
      if (video) {
        try {
          video.srcObject = stream;
        } catch {
          // happy-dom's <video> lacks a real srcObject sink — the
          // preview simply stays blank there
        }
      }
    } catch (err) {
      setError(camErrorOf(err));
    }
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRunning(false);
    // the auto-attempt: browsers that prompt without a gesture (Firefox)
    // get the old zero-tap flow; the rest land on the Start button
    void start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        // defensive: environments without canvas pixels (happy-dom)
        // yield null — keep the sheet open instead of faking a photo
        if (!blob) return;
        onCapture(new File([blob], 'webcam.jpg', { type: 'image/jpeg' }));
        onOpenChange(false);
      },
      'image/jpeg',
      0.85,
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('webcam.title')} size="tall">
      <div className="flex flex-col gap-3 pt-1">
        {error && (
          <p className="rounded-card bg-bg-2 px-4 py-3 text-[13px] leading-relaxed text-ink-3" data-testid="webcam-error">
            {t(`webcam.error.${error}`)}
          </p>
        )}
        {/* fixed px height — sheets must never size off vh */}
        <video
          ref={videoRef}
          data-testid="webcam-video"
          autoPlay
          playsInline
          muted
          className="h-[320px] w-full rounded-card bg-bg-2 object-cover"
        />
        {running ? (
          <Button data-testid="webcam-capture" onClick={capture}>
            <Icon name="camera-outline" size={16} />
            {t('webcam.capture')}
          </Button>
        ) : (
          error !== 'unavailable' && (
            // r2: the GESTURE start — Chromium only prompts from here
            <Button data-testid="webcam-start" onClick={() => void start()}>
              <Icon name="camera-outline" size={16} />
              {t('webcam.start')}
            </Button>
          )
        )}
      </div>
    </Sheet>
  );
}
