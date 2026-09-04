// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { institutionLogoUrl } from './useInstitutionLogos';

vi.mock('@/app/config', () => ({
  config: { apiUrl: 'http://api.example', logto: { endpoint: '', appId: '', resource: '' }, glitchtipDsn: '', channel: '' },
  logtoConfigured: false,
  publicOrigin: () => window.location.origin,
}));

describe('institutionLogoUrl (#176)', () => {
  beforeEach(() => localStorage.clear());

  it('builds the vendored URL on the API origin for user identities — provider-independent, pipe ids escaped', () => {
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: 'u1' }));
    // a GoCardless-style id and an Enable Banking "name|country" id both
    // resolve against the ONE server-side logo store
    expect(institutionLogoUrl('ING_NL')).toBe('http://api.example/gocardless/institutions/ING_NL/logo');
    expect(institutionLogoUrl('ASN Bank|NL')).toBe('http://api.example/gocardless/institutions/ASN%20Bank%7CNL/logo');
  });

  it('local-only identities and missing ids keep the generic icon (no URL, no network)', () => {
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'demo' }));
    expect(institutionLogoUrl('ING_NL')).toBeUndefined();
    localStorage.setItem('munni_session', JSON.stringify({ kind: 'user', sub: 'u1' }));
    expect(institutionLogoUrl(undefined)).toBeUndefined();
  });
});
