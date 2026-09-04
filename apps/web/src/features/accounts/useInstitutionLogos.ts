import { config } from '@/app/config';
import { readSessionIdentity } from '@/app/session';

/**
 * The vendored bank-mark URL for an account's institution (#176). Built
 * straight from the bankId — the server keeps ONE logo store across
 * providers, so an Enable Banking id resolves exactly like a GoCardless
 * one (the old per-active-provider institutions fetch missed whichever
 * provider was inactive, and its relative paths resolved against the WEB
 * origin — both faces of the broken-image bug). 404s land in the <img>
 * onError fallback. Local-only identities keep the generic icon and
 * never touch the network.
 */
export function institutionLogoUrl(bankId: string | undefined): string | undefined {
  if (!bankId || !config.apiUrl || readSessionIdentity()?.kind !== 'user') return undefined;
  return `${config.apiUrl}/gocardless/institutions/${encodeURIComponent(bankId)}/logo`;
}
