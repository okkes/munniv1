import { useLang } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import type { SpaceRole } from './SpaceSharing';

// picker order (#171): the default first, the powerful role last
const PICKER_ROLES: SpaceRole[] = ['contributor', 'reader', 'owner'];

/** #171: the shared three-role control (invite flow, member sheet, new-person block) */
export function RolePicker({
  value,
  onChange,
  testIdPrefix,
}: Readonly<{
  value: SpaceRole;
  onChange: (role: SpaceRole) => void;
  testIdPrefix: string;
}>) {
  const { t } = useLang();
  return (
    <div className="flex gap-1 rounded-input border border-line bg-surface p-1">
      {PICKER_ROLES.map((role) => (
        <button
          key={role}
          data-testid={`${testIdPrefix}-${role}`}
          aria-pressed={value === role}
          onClick={() => onChange(role)}
          className={`m-tap flex-1 rounded-lg border-none px-2 py-1.5 text-[12px] ${
            value === role ? 'bg-accent-soft font-medium text-accent-deep' : 'bg-transparent text-ink-3'
          }`}
        >
          {t(`space.role.${role}` as TranslationKey)}
        </button>
      ))}
    </div>
  );
}
