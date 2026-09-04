import { useEffect, useRef, useState } from 'react';
import { useLang } from '@/i18n';
import { Sheet } from './Sheet';
import { Button } from './Button';

interface ColorPickerProps {
  colors: readonly string[];
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  /** swatches render as `${testIdPrefix}-<hex-without-#>`, the wheel as `${testIdPrefix}-custom` */
  testIdPrefix: string;
  /** localized label for the custom-color wheel */
  customLabel: string;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

// ── color math (pure, exported for tests) ────────────────────────────────

export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`.toUpperCase();
}

// values stay fractional so a typed hex survives the round-trip exactly;
// only the sliders show rounded numbers
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  if (!HEX_RE.test(hex)) return null;
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

// ── the wheel sheet ──────────────────────────────────────────────────────

const WHEEL = 216; // px
const RING = 30; // ring thickness
const KNOB_R = (WHEEL - RING) / 2; // knob track radius

interface ColorWheelSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: string;
  onApply: (hex: string) => void;
}

/**
 * Custom color: a draggable hue ring with live preview, saturation and
 * lightness sliders, and a hex field for precision. Fully self-drawn —
 * the native color input never opened on iOS and its palette dialog on
 * desktop was a detour anyway.
 */
function ColorWheelSheet({ open, onOpenChange, initial, onApply }: Readonly<ColorWheelSheetProps>) {
  const { t } = useLang();
  const [h, setH] = useState(150);
  const [s, setS] = useState(70);
  const [l, setL] = useState(35);
  const [hexDraft, setHexDraft] = useState('');
  const wheelRef = useRef<HTMLDivElement>(null);

  // load the incoming color every time the sheet opens
  useEffect(() => {
    if (!open) return;
    const hsl = hexToHsl(HEX_RE.test(initial) ? initial : '#08372B');
    if (hsl) {
      setH(hsl.h);
      setS(hsl.s);
      setL(hsl.l);
    }
    setHexDraft('');
  }, [open, initial]);

  const hex = hslToHex(h, s, l);

  const hueFromEvent = (e: { clientX: number; clientY: number }) => {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    // conic-gradient starts at 12 o'clock going clockwise
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    setH(Math.round((angle + 360) % 360));
    setHexDraft('');
  };
  const hueRef = useRef(hueFromEvent);
  hueRef.current = hueFromEvent;

  // The wheel owns its gesture — with NATIVE target-phase listeners.
  // React synthetic stopPropagation was a no-op here (second user ss
  // 2026-08-01): React handles events at the ROOT, so by the time the
  // synthetic handler ran, the sheet library's native pointerdown on
  // its container (an ancestor between wheel and root) had ALREADY
  // armed the drag — downward ring drags kept dismissing the sheet.
  // Stopping at the target phase runs before any ancestor bubble
  // listener, pointer and touch families both. Keyed on the ELEMENT
  // (state via callback ref), not `open`: the sheet's content mounts a
  // render after `open` flips, and an open-keyed effect ran too early.
  const [wheelEl, setWheelEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wheelEl;
    if (!el) return;
    const down = (e: PointerEvent) => {
      e.stopPropagation();
      hueRef.current(e);
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        // test DOMs throw on capture without an active pointer — the
        // hue is already applied, capture is a real-device nicety
      }
    };
    const move = (e: PointerEvent) => {
      if (e.buttons !== 1) return;
      e.stopPropagation();
      hueRef.current(e);
    };
    const keepTouch = (e: TouchEvent) => e.stopPropagation();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('touchstart', keepTouch, { passive: true });
    el.addEventListener('touchmove', keepTouch, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('touchstart', keepTouch);
      el.removeEventListener('touchmove', keepTouch);
    };
  }, [wheelEl]);

  const applyHexDraft = (raw: string) => {
    setHexDraft(raw);
    const candidate = raw.startsWith('#') ? raw : `#${raw}`;
    const hsl = hexToHsl(candidate);
    if (hsl) {
      setH(hsl.h);
      setS(hsl.s);
      setL(hsl.l);
    }
  };

  const knobAngle = ((h - 90) * Math.PI) / 180;
  const knobX = WHEEL / 2 + KNOB_R * Math.cos(knobAngle);
  const knobY = WHEEL / 2 + KNOB_R * Math.sin(knobAngle);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('color.custom')} size="tall">
      <div className="flex flex-col items-center gap-4 pt-2">
        {/* hue ring with live preview in the middle */}
        <div
          ref={(el) => {
            wheelRef.current = el;
            setWheelEl(el);
          }}
          data-testid="colorwheel-ring"
          className="relative shrink-0 touch-none rounded-full"
          style={{
            width: WHEEL,
            height: WHEEL,
            background: 'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
        >
          <div
            className="absolute rounded-full bg-bg"
            style={{ inset: RING, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div
              data-testid="colorwheel-preview"
              className="rounded-full border border-line shadow-inner"
              style={{ width: WHEEL - RING * 2 - 44, height: WHEEL - RING * 2 - 44, background: hex }}
            />
          </div>
          <div
            className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-md"
            style={{ left: knobX, top: knobY, background: hslToHex(h, 100, 50) }}
          />
        </div>

        {/* saturation + lightness for the exact shade */}
        <label className="w-full text-[12px] text-ink-3">
          {t('color.saturation')}
          <input
            data-testid="colorwheel-saturation"
            type="range"
            min={0}
            max={100}
            value={Math.round(s)}
            onChange={(e) => {
              setS(Number(e.target.value));
              setHexDraft('');
            }}
            className="mt-1 h-3 w-full appearance-none rounded-full"
            style={{ background: `linear-gradient(to right, ${hslToHex(h, 0, l)}, ${hslToHex(h, 100, l)})` }}
          />
        </label>
        <label className="w-full text-[12px] text-ink-3">
          {t('color.lightness')}
          <input
            data-testid="colorwheel-lightness"
            type="range"
            min={5}
            max={95}
            value={Math.round(l)}
            onChange={(e) => {
              setL(Number(e.target.value));
              setHexDraft('');
            }}
            className="mt-1 h-3 w-full appearance-none rounded-full"
            style={{ background: `linear-gradient(to right, #000, ${hslToHex(h, s, 50)}, #fff)` }}
          />
        </label>

        {/* precise entry */}
        <div className="flex w-full items-center gap-2">
          <span
            className="h-10 w-10 shrink-0 rounded-xl border border-line"
            style={{ background: hex }}
            aria-hidden
          />
          <input
            data-testid="colorwheel-hex"
            value={hexDraft || hex}
            onChange={(e) => applyHexDraft(e.target.value.trim())}
            spellCheck={false}
            autoCapitalize="off"
            className="h-10 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 font-mono text-[14px] text-ink uppercase outline-none"
          />
          <Button
            data-testid="colorwheel-apply"
            onClick={() => {
              onApply(hex);
              onOpenChange(false);
            }}
          >
            {t('action.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Preset swatches plus a rainbow wheel opening the custom-color sheet.
 * A custom pick shows as the wheel swatch filled with that color.
 */
export function ColorPicker({ colors, value, onChange, disabled, testIdPrefix, customLabel }: Readonly<ColorPickerProps>) {
  const [wheelOpen, setWheelOpen] = useState(false);
  const customActive = !colors.includes(value);

  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          aria-label={c}
          data-testid={`${testIdPrefix}-${c.slice(1)}`}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={`m-tap h-8 w-8 rounded-full border-2 ${value === c ? 'border-ink' : 'border-transparent'}`}
          style={{ background: c }}
        />
      ))}
      <button
        aria-label={customLabel}
        title={customLabel}
        data-testid={`${testIdPrefix}-custom`}
        disabled={disabled}
        onClick={() => setWheelOpen(true)}
        className={`m-tap h-8 w-8 rounded-full border-2 ${customActive ? 'border-ink' : 'border-transparent'}`}
        style={
          customActive
            ? { background: value }
            : { background: 'conic-gradient(#e74c3c, #f39c12, #27ae60, #3498db, #9b59b6, #e74c3c)' }
        }
      />
      <ColorWheelSheet
        open={wheelOpen}
        onOpenChange={setWheelOpen}
        initial={value}
        onApply={onChange}
      />
    </div>
  );
}
