const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_URL = 'https://hfkudpsqkuqsrdorchom.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhma3VkcHNxa3Vxc3Jkb3JjaG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5Mjk3ODYsImV4cCI6MjA5NDUwNTc4Nn0.DS_6GQ6XUGU3SpsUm4xszh1WKuBMvJxzV8boWnTpI-Y';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const deleteOld = args.has('--delete-old');

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.migration.local');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (name && process.env[name] === undefined) process.env[name] = value;
  }
}

loadLocalEnv();

function env(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function optionalEnv(name, fallback = '') {
  return process.env[name] || fallback;
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

function cleanKeyPart(value) {
  return String(value || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .filter(Boolean)
    .join('/');
}

function signR2Url({ method, accountId, accessKeyId, secretAccessKey, bucket, key }) {
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
    method,
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

function storagePathFromSupabaseUrl(url) {
  try {
    const parsed = new URL(url);
    const marker = '/storage/v1/object/public/album-images/';
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    return decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

async function fetchAllImages(supabase) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('images')
      .select('id, image_url')
      .range(from, to)
      .order('created_at', { ascending: true });

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function uploadToR2(r2, key, bytes, contentType) {
  const uploadUrl = signR2Url({ ...r2, method: 'PUT', key });
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: bytes
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`R2 upload failed for ${key}: HTTP ${response.status} ${body.slice(0, 500)}`);
  }
}

async function deleteFromR2(r2, key) {
  const deleteUrl = signR2Url({ ...r2, method: 'DELETE', key });
  const response = await fetch(deleteUrl, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed for ${key}: HTTP ${response.status}`);
  }
}

async function main() {
  const supabaseUrl = env('SUPABASE_URL', DEFAULT_SUPABASE_URL);
  const supabaseKey = optionalEnv('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_ANON_KEY', DEFAULT_SUPABASE_ANON_KEY);
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });

  const r2 = {
    accountId: env('R2_ACCOUNT_ID'),
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    bucket: env('R2_BUCKET')
  };
  const publicBase = env('R2_PUBLIC_URL').replace(/\/$/, '');
  const prefix = cleanKeyPart(optionalEnv('R2_MIGRATION_PREFIX', 'migrated/album-images'));

  console.log(apply ? 'Mode: APPLY' : 'Mode: DRY RUN');
  console.log(`Delete old Supabase files: ${deleteOld ? 'yes' : 'no'}`);

  const rows = await fetchAllImages(supabase);
  const candidates = rows
    .map(row => ({ ...row, storagePath: storagePathFromSupabaseUrl(row.image_url) }))
    .filter(row => row.storagePath);

  console.log(`Images in database: ${rows.length}`);
  console.log(`Supabase Storage images to migrate: ${candidates.length}`);

  if (!apply) {
    candidates.slice(0, 10).forEach(row => {
      const key = `${prefix}/${cleanKeyPart(row.storagePath)}`;
      console.log(`[dry-run] ${row.id}: ${row.image_url} -> ${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`);
    });
    if (candidates.length > 10) console.log(`[dry-run] ...and ${candidates.length - 10} more`);
    console.log('Run again with --apply after checking the settings.');
    return;
  }

  const migratedByUrl = new Map();
  let moved = 0;
  let updated = 0;

  for (const row of candidates) {
    let publicUrl = migratedByUrl.get(row.image_url);
    let key;

    if (!publicUrl) {
      key = `${prefix}/${cleanKeyPart(row.storagePath)}`;
      publicUrl = `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;

      console.log(`Downloading ${row.image_url}`);
      const download = await fetch(row.image_url);
      if (!download.ok) throw new Error(`Could not download ${row.image_url}: HTTP ${download.status}`);
      const bytes = Buffer.from(await download.arrayBuffer());
      const contentType = download.headers.get('content-type') || 'application/octet-stream';

      console.log(`Uploading ${key}`);
      await uploadToR2(r2, key, bytes, contentType);
      migratedByUrl.set(row.image_url, publicUrl);
      moved += 1;
    }

    const { error } = await supabase
      .from('images')
      .update({ image_url: publicUrl })
      .eq('id', row.id);
    if (error) throw error;
    updated += 1;
    console.log(`Updated image row ${row.id}`);

    if (deleteOld && key) {
      const { error: deleteError } = await supabase.storage.from('album-images').remove([row.storagePath]);
      if (deleteError) throw deleteError;
      console.log(`Deleted old Supabase file ${row.storagePath}`);
    }
  }

  console.log(`Done. Uploaded unique files: ${moved}. Updated rows: ${updated}.`);
  if (!deleteOld) {
    console.log('Old Supabase files were left in place. Run with --apply --delete-old later only after checking the website.');
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
