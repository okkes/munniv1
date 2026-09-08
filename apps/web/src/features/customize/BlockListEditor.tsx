import { createPortal } from 'react-dom';
import { useLang } from '@/i18n';
import { useDragReorder } from '@/ui/dragReorder';
import { Icon } from '@/ui/Icon';

export interface BlockRow {
  id: string;
  label: string;
  icon: string;
  hidden: boolean;
}

/**
 * The shared customize list (Home blocks, transaction-detail sections):
 * eye toggles visibility, the right-side handle drags to reorder. The
 * floating ghost is PORTALED to document.body — rendered inside a
 * transformed ancestor (a sheet mid-gesture) its fixed coordinates
 * resolved against the transform and drifted wildly (user report).
 */
export function BlockListEditor({
  rows,
  testPrefix,
  onToggle,
  onReorder,
}: Readonly<{
  rows: BlockRow[];
  /** testids: `${p}-row-<id>`, `${p}-toggle-<id>`, `${p}-drag-<id>`, `${p}-ghost` */
  testPrefix: string;
  onToggle: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}>) {
  const { t } = useLang();
  const { drag, ghostRect, setRowRef, setGhostRef, rowStyle, handleProps } = useDragReorder(rows.length, onReorder);

  return (
    <>
      {rows.map((entry, index) => (
        <div
          key={entry.id}
          ref={setRowRef(index)}
          data-testid={`${testPrefix}-row-${entry.id}`}
          style={rowStyle(index)}
          className="flex items-center gap-2.5 border-b border-line-2 py-2 last:border-0"
        >
          <Icon name={entry.icon} size={19} color={entry.hidden ? 'var(--m-ink-4)' : 'var(--m-accent-deep)'} />
          <span className={`min-w-0 flex-1 truncate text-[14px] ${entry.hidden ? 'text-ink-4' : 'text-ink'}`}>
            {entry.label}
          </span>
          <button
            aria-label={t('home.blockToggle')}
            data-testid={`${testPrefix}-toggle-${entry.id}`}
            onClick={() => onToggle(index)}
            className="m-tap flex h-9 w-9 items-center justify-center rounded-full border-none bg-transparent"
          >
            <Icon name={entry.hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={entry.hidden ? 'var(--m-ink-4)' : 'var(--m-accent-deep)'} />
          </button>
          {/* handle on the RIGHT, matching the category manager (user request) */}
          <button
            aria-label={t('home.dragHandle')}
            data-testid={`${testPrefix}-drag-${entry.id}`}
            {...handleProps(index)}
            className="m-tap flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center border-none bg-transparent text-ink-4 select-none"
          >
            <Icon name="drag-horizontal-variant" size={18} />
          </button>
        </div>
      ))}
      {/* the floating clone that follows the finger — `top` is written
          imperatively (per-frame follow + the settle-into-slot drop) */}
      {drag && ghostRect &&
        createPortal(
          <div
            ref={setGhostRef}
            data-testid={`${testPrefix}-ghost`}
            className="pointer-events-none fixed z-50 flex items-center gap-2.5 rounded-input border border-accent bg-surface px-3 shadow-2xl"
            style={{ left: ghostRect.left, width: ghostRect.width, height: ghostRect.height }}
          >
            <Icon name={rows[drag.from].icon} size={19} color="var(--m-accent-deep)" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{rows[drag.from].label}</span>
            <Icon name="drag-horizontal-variant" size={18} color="var(--m-ink-4)" />
          </div>,
          document.body,
        )}
    </>
  );
}
