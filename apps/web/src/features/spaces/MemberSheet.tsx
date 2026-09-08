import { LOCALES, useLang } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { Avatar } from '@/features/profile/ProfileScreen';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { RolePicker } from './InviteFriendSheet';
import type { SpaceRole } from './SpaceSharing';

export interface MemberInfo {
  userId: string;
  displayName: string | null;
  role: SpaceRole;
  picture?: string | null;
  /** #172: membership creation time; null on rows older than the column */
  joinedAt?: string | null;
}

const short = (id: string) => `${id.slice(0, 8)}…`;

/**
 * #172: one member, up close — identity, member-since, and (for owners
 * looking at someone else) the role control and the remove door. The
 * remove CONFIRM stays with the caller.
 */
export function MemberSheet({
  member,
  meIsOwner,
  isSelf,
  onOpenChange,
  onChangeRole,
  onKick,
}: Readonly<{
  member: MemberInfo | null;
  meIsOwner: boolean;
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeRole: (userId: string, role: SpaceRole) => void;
  onKick: (member: MemberInfo) => void;
}>) {
  const { t, lang } = useLang();
  const canManage = meIsOwner && !isSelf;
  const since = member?.joinedAt
    ? new Date(member.joinedAt).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
  return (
    <Sheet open={member !== null} onOpenChange={onOpenChange} size="form">
      <div className="flex flex-col items-center gap-3 pt-2" data-testid="member-sheet">
        <Avatar picture={member?.picture} size={96} />
        <div className="max-w-full truncate text-[17px] font-semibold text-ink">
          {member?.displayName ?? short(member?.userId ?? '')}
        </div>
        <p className="w-full text-center font-mono text-[11px] break-all text-ink-4" data-testid="member-sheet-id">
          {member?.userId ?? ''}
        </p>
        <p className="text-[12px] text-ink-3" data-testid="member-sheet-since">
          {t('member.since', { date: since })}
        </p>
        {canManage ? (
          <div className="w-full">
            <div className="m-cap mb-1">{t('invite.roleTitle')}</div>
            {/* picking "owner" transfers ownership — same as the old select */}
            <RolePicker
              value={member?.role ?? 'contributor'}
              onChange={(role) => {
                if (member && role !== member.role) onChangeRole(member.userId, role);
              }}
              testIdPrefix="member-sheet-role"
            />
          </div>
        ) : (
          <p className="text-[12px] text-ink-3" data-testid="member-sheet-rolelabel">
            {t(`space.role.${member?.role ?? 'contributor'}` as TranslationKey)}
          </p>
        )}
        {canManage && (
          <Button
            variant="danger"
            className="w-full"
            data-testid="member-sheet-remove"
            onClick={() => {
              if (member) onKick(member);
            }}
          >
            {t('space.kick')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
