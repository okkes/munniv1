import { useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useAttentionMap, useOtherSpacesDot } from '@/application/spaceAttention';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import type { SpaceRow } from '@/db/types';

function avatarIcon(space: SpaceRow): string {
  return space.icon ?? (space.kind === 'shared' ? 'account-group-outline' : 'leaf');
}

/**
 * Home app-bar entry point for quick space switching (the full Spaces
 * screen lives behind Settings): the active space's avatar opens a sheet
 * with one tap per space.
 */
export function SpaceSwitcher() {
  const { t } = useLang();
  const { store, spaceId, setActiveSpace } = useData();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const spaces = useQuery(store, async () => (await store.allRows('space')).filter((s) => s.deleted === 0), []);
  const active = spaces?.find((s) => s.id === spaceId);
  // attention (arc 7): counted lazily when the sheet opens; the avatar
  // dot says "somewhere ELSE needs you" without opening anything
  const attention = useAttentionMap(open);
  const otherDot = useOtherSpacesDot();

  return (
    <>
      <button
        aria-label={t('space.switch')}
        data-testid="home-space-switcher"
        onClick={() => setOpen(true)}
        className="m-tap relative flex h-9 w-9 items-center justify-center rounded-full border-none bg-transparent"
      >
        {active?.picture ? (
          <img src={active.picture} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: `color-mix(in srgb, ${active?.color ?? 'var(--m-accent)'} 16%, transparent)`,
              color: active?.color ?? 'var(--m-accent-deep)',
            }}
          >
            <Icon name={active ? avatarIcon(active) : 'leaf'} size={17} />
          </span>
        )}
        {otherDot && (
          <span
            data-testid="home-space-switcher-dot"
            className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-negative ring-2 ring-[var(--m-bg)]"
          />
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen} title={t('space.switch')} size="form">
        <div className="flex flex-col pt-1" data-testid="space-switcher-list">
          {(spaces ?? []).map((space) => (
            <button
              key={space.id}
              data-testid={`space-pick-${space.id}`}
              onClick={() => {
                if (space.id !== spaceId) void setActiveSpace(space.id);
                setOpen(false);
              }}
              className="m-tap flex items-center gap-3 border-none bg-transparent px-1 py-3 text-left"
            >
              {space.picture ? (
                <img src={space.picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: `color-mix(in srgb, ${space.color ?? 'var(--m-ink-4)'} 14%, transparent)`,
                    color: space.color ?? 'var(--m-ink-3)',
                  }}
                >
                  <Icon name={avatarIcon(space)} size={18} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">{space.name}</span>
                {space.id === spaceId && <span className="block text-xs text-accent-deep">{t('space.active')}</span>}
              </span>
              {/* what this space would ask of you (arc 7) */}
              {(attention?.get(space.id)?.reviewCount ?? 0) > 0 && (
                <span
                  data-testid={`space-attn-${space.id}`}
                  className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-deep"
                >
                  {t('space.toReview', { n: attention!.get(space.id)!.reviewCount })}
                </span>
              )}
              {attention?.get(space.id)?.budgetOver && (
                <span data-testid={`space-attn-budget-${space.id}`} className="h-2 w-2 shrink-0 rounded-full bg-negative" />
              )}
              {space.id === spaceId && <Icon name="check" size={18} color="var(--m-accent)" />}
            </button>
          ))}
          <button
            data-testid="space-pick-manage"
            onClick={() => {
              setOpen(false);
              void navigate({ to: '/spaces' });
            }}
            className="m-tap mt-1 flex items-center gap-3 border-t border-line-2 bg-transparent px-1 pt-3 pb-1 text-left text-[14px] text-ink-2"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center">
              <Icon name="cog-outline" size={18} color="var(--m-ink-3)" />
            </span>
            {t('space.manage')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
