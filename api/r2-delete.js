const crypto = require('crypto');

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
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

function signDeleteUrl({ accountId, accessKeyId, secretAccessKey, bucket, key }) {
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
    'DELETE',
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

function keyFromPublicUrl(url, publicUrl) {
  if (!url || !publicUrl) return null;
  const base = publicUrl.replace(/\/$/, '');
  if (!url.startsWith(`${base}/`)) return null;
  return decodeURIComponent(url.slice(base.length + 1));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const publicUrl = getEnv('R2_PUBLIC_URL');
    const key = req.body?.key || keyFromPublicUrl(req.body?.url, publicUrl);
    if (!key) return res.status(200).json({ skipped: true });

    const deleteUrl = signDeleteUrl({
      accountId: getEnv('R2_ACCOUNT_ID'),
      accessKeyId: getEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: getEnv('R2_SECRET_ACCESS_KEY'),
      bucket: getEnv('R2_BUCKET'),
      key
    });
    const deleted = await fetch(deleteUrl, { method: 'DELETE' });
    if (!deleted.ok && deleted.status !== 404) {
      return res.status(502).json({ error: `R2 delete failed with ${deleted.status}` });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'R2 delete failed' });
  }
};
