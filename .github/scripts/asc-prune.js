// Prune the Apple Development certificates that pile up from
// ephemeral-runner archives (each CI run WITHOUT a persistent
// certificate mints one; unchecked they hit Apple's cap: "Choose a
// certificate to revoke" — the twelfth was refused on 2026-09-09).
//
// Race-safe without validity assumptions: certificates of the same type
// expire in creation order, so the KEEP_NEWEST most recent (by
// expirationDate) are spared — they may belong to in-flight runs (at
// most one per branch thanks to the per-branch concurrency groups) —
// and everything older is revoked. Deriving age from expirationDate
// minus an assumed validity does NOT work: cloud-managed dev certs are
// short-lived, which made every cert look freshly created.
// Distribution certificates are never touched.
//
// PROTECT_SERIALS names certificates that are never revoked whatever
// their age: the persistent one a repo holds as APPLE_DEV_CERT_P12. The
// whole Apple team shares ONE such certificate — the 2026-09-08 mint
// cleared the deck blindly, revoked the hosted track's certificate and
// ten throwaways piled up within a day. Serials compare case- and
// leading-zero-insensitively (openssl prints 07C9…, Apple 7C9…).
// DRY_RUN=1 prints the plan and revokes nothing.
//
// Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID; KEEP_NEWEST (default 3),
// PROTECT_SERIALS (comma-separated), DRY_RUN.
const crypto = require('node:crypto');
const fs = require('node:fs');

// dev + master in flight + one margin; the iOS workflow passes 1 once a
// persistent certificate signs (nothing of its own mints any more) and
// the mint workflow 0 to clear the deck before creating the persistent one
const KEEP_NEWEST = Number(process.env.KEEP_NEWEST ?? 3);
const DRY_RUN = process.env.DRY_RUN === '1';
const normSerial = (s) => String(s ?? '').trim().toUpperCase().replace(/^0+/, '');
const PROTECT = new Set((process.env.PROTECT_SERIALS ?? '').split(/[\s,]+/).map(normSerial).filter(Boolean));

function jwt() {
  const key = fs.readFileSync(process.env.ASC_KEY_PATH, 'utf8');
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  // JOSE wants the raw r||s signature, not ASN.1/DER
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

async function main() {
  const auth = { Authorization: `Bearer ${jwt()}` };
  const url = 'https://api.appstoreconnect.apple.com/v1/certificates?filter%5BcertificateType%5D=DEVELOPMENT,IOS_DEVELOPMENT&limit=200';
  const res = await fetch(url, { headers: auth });
  const body = await res.json();
  if (!res.ok) throw new Error(`certificate list failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`);

  const certs = [...(body.data ?? [])].sort(
    (a, b) => new Date(b.attributes.expirationDate).getTime() - new Date(a.attributes.expirationDate).getTime(),
  );
  const seen = new Set();
  let pruned = 0;
  let kept = 0;
  let protectedCount = 0;
  for (const cert of certs) {
    const serial = normSerial(cert.attributes.serialNumber);
    const label = `${cert.id} (serial ${serial}, expires ${cert.attributes.expirationDate})`;
    if (PROTECT.has(serial)) {
      seen.add(serial);
      protectedCount++;
      console.log(`protected ${label} — the persistent certificate`);
      continue;
    }
    if (kept < KEEP_NEWEST) {
      kept++;
      console.log(`keeping ${label} — among the ${KEEP_NEWEST} newest`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`would revoke ${label}`);
      pruned++;
      continue;
    }
    const del = await fetch(`https://api.appstoreconnect.apple.com/v1/certificates/${cert.id}`, { method: 'DELETE', headers: auth });
    console.log(`revoked ${label} -> HTTP ${del.status}`);
    pruned++;
  }
  for (const serial of PROTECT) {
    if (!seen.has(serial)) console.log(`note: protected serial ${serial} is not among the team's Development certificates (revoked or expired?)`);
  }
  console.log(`${DRY_RUN ? 'dry run: ' : ''}${pruned} development certificate(s) ${DRY_RUN ? 'to prune' : 'pruned'}, ${kept} kept, ${protectedCount} protected`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
