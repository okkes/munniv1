// Prune the Apple Development certificates that pile up from
// ephemeral-runner archives (each CI run mints one; unchecked they hit
// Apple's cap: "Choose a certificate to revoke").
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
// Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID.
const crypto = require('node:crypto');
const fs = require('node:fs');

// dev + master in flight + one margin; the mint workflow passes 0 to
// clear the deck before creating the persistent certificate
const KEEP_NEWEST = Number(process.env.KEEP_NEWEST ?? 3);
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
  let pruned = 0;
  for (const [index, cert] of certs.entries()) {
    if (index < KEEP_NEWEST) {
      console.log(`keeping ${cert.id} (expires ${cert.attributes.expirationDate}) — among the ${KEEP_NEWEST} newest`);
      continue;
    }
    const del = await fetch(`https://api.appstoreconnect.apple.com/v1/certificates/${cert.id}`, { method: 'DELETE', headers: auth });
    console.log(`revoked ${cert.id} (expires ${cert.attributes.expirationDate}) -> HTTP ${del.status}`);
    pruned++;
  }
  console.log(`${pruned} development certificate(s) pruned, ${Math.min(KEEP_NEWEST, certs.length)} kept`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
