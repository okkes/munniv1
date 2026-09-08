// Mint an Apple Development certificate from a CSR via the App Store
// Connect API — the no-Mac path to the persistent signing cert (the
// user has no macOS machine; docs/native-setup.md §5b).
//
// stdin: nothing. argv[2]: path to a PEM CSR. stdout: the cert DER as
// base64 (single line). Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID.
const crypto = require('node:crypto');
const fs = require('node:fs');

function jwt() {
  const key = fs.readFileSync(process.env.ASC_KEY_PATH, 'utf8');
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

async function main() {
  const csr = fs.readFileSync(process.argv[2], 'utf8');
  const res = await fetch('https://api.appstoreconnect.apple.com/v1/certificates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { type: 'certificates', attributes: { certificateType: 'DEVELOPMENT', csrContent: csr } },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`certificate create failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  console.log(body.data.attributes.certificateContent);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
