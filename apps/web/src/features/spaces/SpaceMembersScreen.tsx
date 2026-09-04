import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { SpaceMembersSection } from './SpaceSharing';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';

/**
 * Members, roles and invites for one space, extracted from the
 * overloaded space-settings screen (user remark). Sharing is a synced
 * capability — demo/offline identities see why it's unavailable.
 */
export function SpaceMembersScreen() {
  const { t } = useLang();
  const { store } = useData();
  const navigate = useNavigate();
  const router = useRouter();
  const identity = useSession((s) => s.identity);
  const syncing = identity?.kind === 'user';
  const { spaceId } = useParams({ strict: false }) as { spaceId: string };
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-space-members">
      <AppBar
        title={t('space.members')}
        sub={space?.name}
        leading={
          <IconButton label={t('action.back')} testId="spacemembers-back" onClick={() => router.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {syncing && space ? (
          <SpaceMembersSection
            spaceId={space.id}
            spaceName={space.name}
            onLeft={() => void navigate({ to: '/spaces' })}
          />
        ) : (
          <p className="pt-3 text-[13px] text-ink-3" data-testid="space-members-offline">
            {t('space.membersNeedAccount')}
          </p>
        )}
      </div>
    </div>
  );
}
