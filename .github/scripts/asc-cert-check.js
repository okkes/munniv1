// The persistent signing certificate (secret APPLE_DEV_CERT_P12) must
// still be one of the team's Development certificates: a revoked or
// expired p12 imports into the keychain without complaint, and Xcode
// then silently mints a throwaway per build until Apple's cap ends the
// builds (2026-09-09: ten piled up in a day after a mint had wiped the
// hosted track's certificate). Fail fast and name the repair instead.
//
// Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID, CERT_SERIAL (hex, as
// openssl prints it). Exit 0 = listed and unexpired (a warning under 30
// days left); exit 1 = not listed / expired.
const crypto = require('node:crypto');
const fs = require('node:fs');

const normSerial = (s) => String(s ?? '').trim().toUpperCase().replace(/^0+/, '');
const REPAIR = 'Repair: dispatch mint-apple-cert.yml (the wizard\'s iOS build does it for the local track), then store the new p12 + password as APPLE_DEV_CERT_P12 / APPLE_DEV_CERT_PASSWORD at repository level AND in every environment that overrides them (staging, production, local) — the whole Apple team shares ONE certificate.';

function jwt() {
  const key = fs.readFileSync(process.env.ASC_KEY_PATH, 'utf8');
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

// exitCode instead of process.exit(): exiting while the fetch socket is
// still closing trips a libuv assertion on Windows (seen 2026-09-09)
async function main() {
  const want = normSerial(process.env.CERT_SERIAL);
  if (!want) throw new Error('CERT_SERIAL is empty — the import step could not read the serial of APPLE_DEV_CERT_P12');
  const url = 'https://api.appstoreconnect.apple.com/v1/certificates?filter%5BcertificateType%5D=DEVELOPMENT,IOS_DEVELOPMENT&limit=200';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt()}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`certificate list failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  const hit = (body.data ?? []).find((c) => normSerial(c.attributes.serialNumber) === want);
  if (!hit) {
    console.log(`::error title=Persistent signing certificate is no longer valid::APPLE_DEV_CERT_P12 (serial ${want}) is not among the team's Development certificates any more — revoked or expired. Until it is replaced every build would mint a throwaway certificate and Apple's cap ends the builds. ${REPAIR}`);
    process.exitCode = 1;
    return;
  }
  const expires = new Date(hit.attributes.expirationDate);
  const daysLeft = Math.floor((expires.getTime() - Date.now()) / 86400000);
  if (daysLeft < 0) {
    console.log(`::error title=Persistent signing certificate expired::APPLE_DEV_CERT_P12 (${hit.id}, serial ${want}) expired on ${hit.attributes.expirationDate}. ${REPAIR}`);
    process.exitCode = 1;
    return;
  }
  if (daysLeft < 30) {
    console.log(`::warning title=Signing certificate expires in ${daysLeft} days::APPLE_DEV_CERT_P12 (${hit.id}) expires on ${hit.attributes.expirationDate}. ${REPAIR}`);
  }
  console.log(`persistent certificate ${hit.id} (serial ${want}) is valid until ${hit.attributes.expirationDate} (${daysLeft} days)`);
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
