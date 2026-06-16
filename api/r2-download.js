function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function safeFileName(value) {
  return String(value || 'photo.jpg')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .slice(0, 180) || 'photo.jpg';
}

function isAllowedR2Url(url, publicUrl) {
  try {
    const parsed = new URL(url);
    const allowed = new URL(publicUrl);
    return parsed.origin === allowed.origin && parsed.pathname.startsWith(`${allowed.pathname.replace(/\/$/, '')}/`);
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const publicUrl = getEnv('R2_PUBLIC_URL').replace(/\/$/, '');
    const url = String(req.query?.url || '');
    const name = safeFileName(req.query?.name);

    if (!isAllowedR2Url(url, publicUrl)) {
      return res.status(400).json({ error: 'Unsupported download URL' });
    }

    const download = await fetch(url);
    if (!download.ok) {
      return res.status(502).json({ error: `R2 download failed with ${download.status}` });
    }

    const bytes = Buffer.from(await download.arrayBuffer());
    res.setHeader('Content-Type', download.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(bytes);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'R2 download failed' });
  }
};
