const crypto = require('crypto');

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function sanitizeKeyPart(value) {
  return String(value || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .filter(Boolean)
    .join('/');
}

function decodeHeader(value, fallback) {
  try {
    return decodeURIComponent(String(value || fallback));
  } catch {
    return String(value || fallback);
  }
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signingKey(secret, date, region, service) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function signPutUrl({ accountId, accessKeyId, secretAccessKey, bucket, key }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const signedHeaders = 'host';
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '300',
    'X-Amz-SignedHeaders': signedHeaders
  });
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    params.toString(),
    `host:${host}`,
    '',
    signedHeaders,
    'UNSIGNED-PAYLOAD'
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const signature = hmac(signingKey(secretAccessKey, dateStamp, region, service), stringToSign, 'hex');
  params.set('X-Amz-Signature', signature);
  return `https://${host}${canonicalUri}?${params.toString()}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const bucket = getEnv('R2_BUCKET');
    const publicUrl = getEnv('R2_PUBLIC_URL').replace(/\/$/, '');
    const safePath = sanitizeKeyPart(decodeHeader(req.headers['x-r2-path'], 'uploads'));
    const safeName = sanitizeKeyPart(decodeHeader(req.headers['x-r2-file-name'], 'file'));
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const file = await readBody(req);

    if (!file.length) return res.status(400).json({ error: 'No file received' });

    const key = [safePath, `${Date.now()}_${safeName}`].filter(Boolean).join('/');
    const uploadUrl = signPutUrl({
      accountId: getEnv('R2_ACCOUNT_ID'),
      accessKeyId: getEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: getEnv('R2_SECRET_ACCESS_KEY'),
      bucket,
      key
    });

    const upload = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file
    });

    if (!upload.ok) {
      const body = await upload.text().catch(() => '');
      return res.status(502).json({ error: `R2 upload failed with ${upload.status}`, detail: body.slice(0, 500) });
    }

    return res.status(200).json({
      key,
      publicUrl: `${publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'R2 upload failed' });
  }
};
