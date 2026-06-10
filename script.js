
// SECURITY SAFEGUARD
window.es = window.es || function(t) {
  if (!t) return '';
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
};

const FALLBACK_IMAGE = 'logo.JPG';

window.useImageFallback = function(img) {
  if (!img || img.dataset.fallbackApplied === 'true') return;
  img.dataset.fallbackApplied = 'true';
  img.src = FALLBACK_IMAGE;
  img.alt = img.alt || 'Muirite Striders';
};

function fallbackAttr() {
  return ' onerror="window.useImageFallback(this)"';
}

function imageLoadAttr() {
  return ' loading="lazy" decoding="async" onerror="window.useImageFallback(this)"';
}

function imageNameWithExtension(name, extension) {
  const safeBase = String(name || 'photo')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_') || 'photo';
  return `${safeBase}.${extension}`;
}

async function compressImageForUpload(file, options = {}) {
  const {
    maxDimension = 1600,
    quality = 0.78,
    mimeType = 'image/jpeg'
  } = options;

  if (!file?.type?.startsWith('image/') || file.type === 'image/gif') {
    return { file, name: file?.name || 'upload' };
  }

  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = objectUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size <= 500 * 1024) return { file, name: file.name };

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
    if (!blob || blob.size >= file.size) return { file, name: file.name };

    const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
    const compressed = new File([blob], imageNameWithExtension(file.name, extension), { type: mimeType });
    return { file: compressed, name: compressed.name };
  } catch {
    return { file, name: file.name };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadFileToR2(file, path, fileName) {
  const signRes = await fetch('/api/r2-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      fileName,
      contentType: file.type || 'application/octet-stream'
    })
  });
  const signed = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new Error(signed.error || 'R2 upload could not start');

  const uploadRes = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
  if (!uploadRes.ok) throw new Error(`R2 upload failed with ${uploadRes.status}`);
  return signed.publicUrl;
}

async function deleteStoredImage(imageUrl) {
  const supabasePath = storagePathFromUrl(imageUrl);
  if (supabasePath) {
    await supabase.storage.from('album-images').remove([supabasePath]);
    return;
  }
  try {
    await fetch('/api/r2-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl })
    });
  } catch {}
}

document.addEventListener('error', event => {
  if (event.target?.tagName === 'IMG') window.useImageFallback(event.target);
}, true);

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

//  SUPABASE CLIENT
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://hfkudpsqkuqsrdorchom.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhma3VkcHNxa3Vxc3Jkb3JjaG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5Mjk3ODYsImV4cCI6MjA5NDUwNTc4Nn0.DS_6GQ6XUGU3SpsUm4xszh1WKuBMvJxzV8boWnTpI-Y'
);
window.supabase = supabase;

const ADMIN_SESSION_KEY = 'msc_admin_session';
const CAROUSEL_ALBUM_NAME = 'Homepage Carousel';
let _cachedHash = null; // in-memory cache only, never logged

async function sha256(str) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getStoredHash() {
  if (_cachedHash) return _cachedHash;
  const { data, error } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', 'password_hash')
    .single();
  if (!error && data) {
    _cachedHash = data.value;
    return _cachedHash;
  }
  return null;
}

// One-time setup function  call from console to set/change password
window.setupAdminPassword = async function(plainPassword) {
  if (!plainPassword || plainPassword.length < 6) {
    console.log('Password must be at least 6 characters.');
    return;
  }
  const hash = await sha256(plainPassword);
  const { error } = await supabase
    .from('admin_config')
    .upsert({ key: 'password_hash', value: hash }, { onConflict: 'key' });
  if (error) {
    console.log('Setup failed:', error.message);
  } else {
    _cachedHash = hash;
    console.log('Admin password updated successfully.');
  }
};

window.isAdmin = function() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
};

window.handleAdminNavClick = function() {
  if (window.isAdmin()) {
    if (confirm('Log out of admin mode?')) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      applyAdminState();
      toast('Logged out of admin mode', 'info');
    }
  } else {
    openAdminModal();
  }
};

function openAdminModal() {
  const bg = document.getElementById('adminModalBg');
  if (bg) {
    bg.classList.add('open');
    const err = document.getElementById('adminLoginError');
    if (err) err.style.display = 'none';
    setTimeout(() => document.getElementById('adminPassInput')?.focus(), 80);
  }
}

window.closeAdminModal = function() {
  const bg = document.getElementById('adminModalBg');
  if (bg) bg.classList.remove('open');
  const inp = document.getElementById('adminPassInput');
  if (inp) inp.value = '';
};

window.submitAdminLogin = async function() {
  const inp = document.getElementById('adminPassInput');
  const err = document.getElementById('adminLoginError');
  const btn = document.getElementById('adminLoginBtn');
  if (!inp) return;

  const val = inp.value;
  inp.value = '';
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }

  try {
    const [inputHash, storedHash] = await Promise.all([
      sha256(val),
      getStoredHash()
    ]);

    if (storedHash && inputHash === storedHash) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
      window.closeAdminModal();
      applyAdminState();
      toast('Admin mode activated', 'success');
    } else {
      if (err) err.style.display = 'block';
      inp.focus();
    }
  } catch (e) {
    toast('Auth error - check connection', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
  }
};

document.addEventListener('keydown', e => {
  const bg = document.getElementById('adminModalBg');
  if (bg?.classList.contains('open')) {
    if (e.key === 'Enter') window.submitAdminLogin();
    if (e.key === 'Escape') window.closeAdminModal();
  }
});

function applyAdminState() {
  const admin = window.isAdmin();
  const adminBtn = document.getElementById('adminNavBtn');
  if (adminBtn) {
    adminBtn.textContent = admin ? 'Admin' : 'Admin';
    adminBtn.style.background  = admin ? 'var(--danger)' : '';
    adminBtn.style.color       = admin ? '#fff' : '';
    adminBtn.style.borderColor = admin ? 'var(--danger)' : '';
  }
  const uploadPanel = document.getElementById('uploadPanel');
  if (uploadPanel) uploadPanel.style.display = admin ? 'flex' : 'none';
  const newAlbumBtn = document.getElementById('newAlbumBtn');
  if (newAlbumBtn) newAlbumBtn.style.display = admin ? 'inline-flex' : 'none';
  const lbAddBtn = document.getElementById('lbAddBtn');
  if (lbAddBtn) lbAddBtn.style.display = admin ? 'inline-flex' : 'none';
  const trainingPanel = document.getElementById('trainingUploadPanel');
  if (trainingPanel) trainingPanel.style.display = admin ? 'grid' : 'none';
  renderCarouselManager();
  if (document.getElementById('albumsGrid')) window.renderAlbums();
  if (document.getElementById('eventList')) renderResultsSidebar();
  if (document.getElementById('rg') && scrapedRaces.length) rr(currentRaceFilter);
  if (document.getElementById('trainingGrid')) window.renderTrainingRuns();
}


//  MOBILE-FIRST CSS INJECTION

function injectMobileStyles() {
  const style = document.createElement('style');
  style.id = 'msc-mobile-styles';
  style.textContent = `

  /*  GLOBAL MOBILE TOUCH TARGETS */
  @media (max-width: 768px) {
    * { -webkit-tap-highlight-color: transparent; }

 /*  ADMIN MODAL */
    #adminModalBg {
      padding: 0 !important;
      align-items: flex-end !important;
    }
    #adminModalBg .admin-modal,
    #adminModalBg > div {
      width: 100% !important;
      max-width: 100% !important;
      border-radius: 20px 20px 0 0 !important;
      padding: 32px 24px 40px !important;
      margin: 0 !important;
    }
    #adminPassInput {
      height: 52px !important;
      font-size: 16px !important; /* prevents iOS zoom */
      border-radius: 12px !important;
    }
    #adminLoginBtn,
    button[onclick="window.submitAdminLogin()"],
    [id*="loginBtn"] {
      height: 52px !important;
      font-size: 15px !important;
      border-radius: 12px !important;
      width: 100% !important;
    }

 /*  RESULTS LAYOUT */
    .results-layout,
    #resultsContainer,
    .results-wrap {
      flex-direction: column !important;
      height: auto !important;
      min-height: unset !important;
    }
    .results-sidebar,
    .sidebar-col,
    .sidebar,
    .event-list,
    #resultsSidebar {
      width: 100% !important;
      max-width: 100% !important;
      min-width: unset !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      border-right: none !important;
      border-bottom: 1px solid rgba(255,255,255,0.08) !important;
    }
    .results-main,
    .main-col,
    .main-results,
    #resultsPanel {
      width: 100% !important;
      min-width: unset !important;
      height: auto !important;
      max-height: none !important;
      padding: 16px !important;
      overflow: visible !important;
    }

 /*  EVENT CARDS (sidebar) */
    .event-card {
      padding: 12px 14px !important;
      border-radius: 12px !important;
    }
    .event-card-name {
      font-size: 12px !important;
      line-height: 1.3 !important;
    }
    .event-card-meta {
      font-size: 10px !important;
    }
    .dist-pill {
      font-size: 10px !important;
      padding: 2px 7px !important;
    }

 /*  UPLOAD PANEL */
    #uploadPanel {
      flex-direction: column !important;
      align-items: stretch !important;
      gap: 10px !important;
      padding: 16px !important;
      border-radius: 14px !important;
    }
    #uploadPanel input,
    #uploadPanel select,
    #uploadPanel label,
    #uploadPanel button {
      width: 100% !important;
      min-width: unset !important;
      height: 48px !important;
      font-size: 15px !important;
      box-sizing: border-box !important;
    }

 /*  EVENT RESULTS VIEW */
    .event-header {
      padding: 16px !important;
      flex-direction: column !important;
      gap: 10px !important;
    }
    .event-header-name {
      font-size: 17px !important;
      line-height: 1.2 !important;
    }
    .event-header-total {
      font-size: 11px !important;
    }

 /*  DISTANCE TABS */
    .dist-tabs {
      overflow-x: auto !important;
      flex-wrap: nowrap !important;
      -webkit-overflow-scrolling: touch !important;
      scrollbar-width: none !important;
      padding-bottom: 2px !important;
      gap: 6px !important;
    }
    .dist-tabs::-webkit-scrollbar { display: none; }
    .dist-tab {
      flex-shrink: 0 !important;
      white-space: nowrap !important;
      padding: 8px 14px !important;
      font-size: 12px !important;
      border-radius: 8px !important;
    }

 /*  SEARCH + CONTROLS */
    .controls {
      flex-direction: column !important;
      gap: 10px !important;
      padding: 12px 0 !important;
    }
    .search-wrap {
      width: 100% !important;
    }
    #searchInput {
      height: 44px !important;
      font-size: 15px !important; /* no iOS zoom */
      border-radius: 10px !important;
    }
    .del-race-btn {
      width: 100% !important;
      justify-content: center !important;
    }
    .results-count {
      font-size: 11px !important;
    }

 /*  RESULTS TABLE */
    .table-wrap {
      overflow-x: hidden !important;
      -webkit-overflow-scrolling: touch !important;
      border-radius: 12px !important;
    }
    .rtbl {
      font-size: 11.5px !important;
      width: 100% !important;
      min-width: 0 !important;
      table-layout: fixed !important;
    }
    .rtbl th {
      padding: 9px 5px !important;
      font-size: 10px !important;
      letter-spacing: 0.5px !important;
    }
    .rtbl td {
      padding: 9px 5px !important;
      word-break: break-word !important;
      line-height: 1.25 !important;
    }
    .rtbl th:nth-child(1), .rtbl td:nth-child(1) { width: 12% !important; }
    .rtbl th:nth-child(2), .rtbl td:nth-child(2) { width: 34% !important; }
    .rtbl th:nth-child(3), .rtbl td:nth-child(3) { width: 20% !important; }
    .rtbl th:nth-child(4), .rtbl td:nth-child(4) { width: 14% !important; }
    .rtbl th:nth-child(5), .rtbl td:nth-child(5) { width: 20% !important; }
    .name-cell,
    .club-cell,
    .time-cell {
      font-size: 11px !important;
    }
    .pos-cell {
      min-width: 28px !important;
      width: 28px !important;
      font-size: 11px !important;
    }
    .name-cell {
      max-width: 120px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .club-cell {
      max-width: 80px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .time-cell {
      white-space: nowrap !important;
    }

 /*  ALBUM / GALLERY GRID */
    #albumsGrid {
      grid-template-columns: 1fr 1fr !important;
      gap: 10px !important;
      padding: 12px !important;
    }
    .album-card {
      border-radius: 12px !important;
    }
    .album-name {
      font-size: 12px !important;
    }
    .album-count {
      font-size: 10px !important;
    }
    .album-del {
      font-size: 10px !important;
      padding: 3px 8px !important;
    }
  }

  /*  VERY SMALL SCREENS */
  @media (max-width: 380px) {
    #albumsGrid {
      grid-template-columns: 1fr !important;
    }
    .rtbl {
      font-size: 10.5px !important;
    }
  }
  `;
  document.head.appendChild(style);
}


//  STATE

let raceResults  = [];
let scrapedRaces = [];
let cachedDots   = [];


//  NAV


window.tmm = function() {
  const m = document.getElementById('mm');
  if (m) m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
};

window.addEventListener('scroll', () => {
  const nav = document.getElementById('nav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 60);
});


//  CAROUSEL


let ci = 0, ct2;
let sl = 4;
const tr = document.getElementById('ct'), dw = document.getElementById('cdots');
let carouselFallbackSlides = [];
let carouselAlbumId = null;
let carouselPhotos = [];

function shuffleList(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function renderCarouselSlides(slides) {
  if (!tr || !dw || !slides.length) return;
  const shuffled = shuffleList(slides);
  tr.innerHTML = shuffled.map(slide => `
    <div class="cs">
      <img src="${window.es(slide.src)}" alt="${window.es(slide.title || 'Race photo')}" decoding="async"${fallbackAttr()}>
    </div>`).join('');
  tr.classList.remove('carousel-loading');
  sl = shuffled.length;
  ci = 0;
  cachedDots = [];
  dw.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < sl; i++) {
    const d = document.createElement('div');
    d.className = 'cdot' + (i === 0 ? ' active' : '');
    d.onclick = () => { cg(i); rs(); };
    fragment.appendChild(d);
    cachedDots.push(d);
  }
  dw.appendChild(fragment);
  cg(0);
  rs();
}

async function getCarouselAlbumId() {
  if (carouselAlbumId) return carouselAlbumId;
  const { data: existing } = await supabase
    .from('albums')
    .select('id')
    .eq('name', CAROUSEL_ALBUM_NAME)
    .single();
  if (existing?.id) {
    carouselAlbumId = existing.id;
    return carouselAlbumId;
  }
  if (!window.isAdmin()) return null;
  const { data: created, error } = await supabase
    .from('albums')
    .insert({ name: CAROUSEL_ALBUM_NAME })
    .select('id')
    .single();
  if (error) {
    toast(`Carousel album could not be created: ${error.message}`, 'error');
    return null;
  }
  carouselAlbumId = created.id;
  return carouselAlbumId;
}

async function loadCarouselPhotos() {
  const albumId = await getCarouselAlbumId();
  if (!albumId) return [];
  const { data, error } = await supabase
    .from('images')
    .select('id, image_url, created_at')
    .eq('album_id', albumId)
    .order('created_at', { ascending: true });
  if (error) {
    toast('Carousel photos could not load.', 'error');
    return [];
  }
  carouselPhotos = data || [];
  return carouselPhotos.map(photo => ({
    id: photo.id,
    src: photo.image_url,
    title: 'Carousel photo'
  }));
}

function renderCarouselManager() {
  const panel = document.getElementById('carouselAdminPanel');
  const list = document.getElementById('carouselAdminList');
  if (!panel || !list) return;
  panel.style.display = window.isAdmin() ? 'block' : 'none';
  if (!window.isAdmin()) return;
  if (!carouselPhotos.length) {
    list.innerHTML = `<div class="carousel-admin-empty">No uploaded carousel photos yet.</div>`;
    return;
  }
  list.innerHTML = carouselPhotos.map(photo => `
    <div class="carousel-admin-item">
      <img src="${photo.image_url}" alt="Carousel photo"${imageLoadAttr()}>
      <button type="button" onclick="window.deleteCarouselPhoto('${photo.id}', '${photo.image_url}')">Remove</button>
    </div>`).join('');
}

async function initCarousel() {
  if (!tr || !dw) return;
  carouselFallbackSlides = [...tr.querySelectorAll('.cs')].map(slide => ({
    src: slide.querySelector('img')?.getAttribute('src') || '',
    title: slide.querySelector('h3')?.textContent || 'Muirite Striders',
    caption: slide.querySelector('p')?.textContent || 'Club moments'
  })).filter(slide => slide.src);
  const uploadedSlides = await loadCarouselPhotos();
  renderCarouselSlides(uploadedSlides.length ? uploadedSlides : carouselFallbackSlides);
  renderCarouselManager();
}

function cg(n) {
  ci = (n + sl) % sl;
  if (tr) tr.style.transform = `translateX(-${ci * 100}%)`;
  cachedDots.forEach((d, i) => d.classList.toggle('active', i === ci));
}
window.cn2 = function() { cg(ci + 1); rs(); };
window.cp  = function() { cg(ci - 1); rs(); };
function rs() {
  if (!tr) return;
  clearInterval(ct2);
  ct2 = setInterval(window.cn2, 5000);
}
if (tr) initCarousel();

window.addCarouselPhotos = async function(event) {
  if (!window.isAdmin()) return;
  const files = Array.from(event?.target?.files || []);
  if (!files.length) return;
  const albumId = await getCarouselAlbumId();
  if (!albumId) return;
  toast(`Uploading ${files.length} carousel photo${files.length === 1 ? '' : 's'}...`, 'info');
  const uploads = await Promise.all(files.map(async (file, index) => {
    const prepared = await compressImageForUpload(file, { maxDimension: 1600, quality: 0.78 });
    const safeName = prepared.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    try {
      const publicUrl = await uploadFileToR2(prepared.file, `carousel/${albumId}`, `${index}_${safeName}`);
      return { album_id: albumId, image_url: publicUrl };
    } catch (error) {
      return { error: error.message };
    }
  }));
  const rows = uploads.filter(item => !item.error);
  const failures = uploads.length - rows.length;
  if (rows.length) {
    const { error } = await supabase.from('images').insert(rows);
    if (error) {
      toast(`Upload saved but database failed: ${error.message}`, 'error');
      event.target.value = '';
      return;
    }
  }
  event.target.value = '';
  const uploadedSlides = await loadCarouselPhotos();
  renderCarouselSlides(uploadedSlides.length ? uploadedSlides : carouselFallbackSlides);
  renderCarouselManager();
  toast(failures ? `${rows.length} uploaded, ${failures} failed` : 'Carousel photo added.', failures ? 'error' : 'success');
};

window.deleteCarouselPhoto = async function(id, imageUrl) {
  if (!window.isAdmin()) return;
  if (!confirm('Remove this carousel photo?')) return;
  await deleteStoredImage(imageUrl);
  await supabase.from('images').delete().eq('id', id);
  const uploadedSlides = await loadCarouselPhotos();
  renderCarouselSlides(uploadedSlides.length ? uploadedSlides : carouselFallbackSlides);
  renderCarouselManager();
  toast('Carousel photo removed.', 'info');
};


//  BIG THREE  WITH ACTUAL RACE PHOTOS


const big3 = [
  {
    num: '01',
    n: 'Two Oceans Marathon',
    l: 'Cape Town, Western Cape',
    date: '11 April 2026',
    raceDate: '2026-04-11',
    ds: ['56km Ultra', '21.1km Half'],
    desc: "The world's most beautiful marathon, along Chapman's Peak and the Cape Peninsula.",
    img: 'https://media.twooceansmarathon.org.za/wp-content/uploads/2026/04/12122229/TTOMHALFMARATHON-1.jpg',
    logo: 'https://media.twooceansmarathon.org.za/wp-content/uploads/2025/09/10174438/TOM-LOGO-full-colour-on-blue-02.jpg',
    u: 'https://www.twooceansmarathon.org.za'
  },
  {
    num: '02',
    n: 'Cape Town Marathon',
    l: 'Cape Town, Western Cape',
    date: '24 May 2026',
    raceDate: '2026-05-24',
    ds: ['42.2km Marathon', '10km'],
    desc: "South Africa's Abbott World Marathon Majors candidate race through the Mother City.",
    img: 'https://ml9j0iwcwlbz.i.optimole.com/cb:3Ce8.54486/w:2560/h:1707/q:mauto/f:best/https://capetownmarathon.com/wp-content/uploads/2026/05/Fahwaaz_Cornelius-0015-scaled.jpg',
    logo: 'https://ml9j0iwcwlbz.i.optimole.com/cb:3Ce8.54486/w:800/h:286/q:mauto/f:best/https://capetownmarathon.com/wp-content/uploads/2025/12/cape-town-marathon-2026.webp',
    u: 'https://www.capetownmarathon.com'
  },
  {
    num: '03',
    n: 'Comrades Marathon',
    l: 'Durban to Pietermaritzburg',
    date: '14 June 2026',
    raceDate: '2026-06-14',
    ds: ['85.77km Ultra', 'Up Run'],
    desc: "The world's greatest ultra-marathon, 85.77km of grit, heart and South African spirit.",
    img: 'https://mosaic-cms.b-cdn.net/3k0rnfif4fsx6bhy7d7tx3tysti2',
    logo: 'https://comrades.com/assets/Comrades_Marathon_Transparent-361f4d0d.png',
    logoClass: 'comrades-logo',
    u: 'https://comrades.com/'
  }
];

function raceUrl(race) {
  return race?.u || RC_BASE;
}

function raceStatusFromDate(dateValue) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const date = new Date(`${dateValue}T00:00:00`);
  const days = Math.ceil((date - today) / 86400000);

  if (days < 0)
    return { status: 'past', label: 'Completed' };

  if (days <= 14)
    return {
      status: 'soon',
      label: days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} to go`
    };

  return {
    status: 'upcoming',
    label: `${days} day${days === 1 ? '' : 's'} to go`
  };
}

function renderBig3() {
  const g = document.getElementById('b3g');
  if (!g) return;
  g.innerHTML = big3.map(r => {
    const state = raceStatusFromDate(r.raceDate);
    const statusClass = state.status === 'soon' ? 'b3-soon' : state.status === 'upcoming' ? 'b3-upcoming' : 'b3-past';
    const dotClass = state.status === 'soon' ? 'soon' : state.status === 'upcoming' ? 'upcoming' : 'past';
    const url = raceUrl(r);
    return `<div class="b3c b3-${state.status}" data-num="${r.num}" onclick="window.open('${url}','_blank')">
      ${r.img ? `<div class="b3-img-wrap" style="position:absolute;inset:0;z-index:0;overflow:hidden;border-radius:inherit">
        <img src="${r.img}" alt="${window.es(r.n)}" style="width:100%;height:100%;object-fit:cover;opacity:0.28;filter:saturate(1.1)"${fallbackAttr()}>
        <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.1) 0%,rgba(0,0,0,0.6) 100%)"></div>
      </div>` : ''}
      ${r.logo ? `<div class="b3-logo ${r.logoClass || ''}"><img src="${r.logo}" alt="${window.es(r.n)} logo" loading="lazy"${fallbackAttr()}></div>` : ''}
      <div style="position:relative;z-index:1;display:flex;flex-direction:column;height:100%;">
        <div>
          <div class="b3badge ${statusClass}"><div class="b3-dot ${dotClass}"></div>${state.label}</div>
          <div class="b3n">${r.n}</div>
          <div class="b3l">${r.l}</div>
          <div class="b3desc">${r.desc}</div>
        </div>
        <div class="b3bottom">
          <div>
            <div class="b3date">${r.date}</div>
            <div class="b3dists" style="margin-top:12px">${r.ds.map(d => `<span class="b3di">${d}</span>`).join('')}</div>
          </div>
          <span class="b3link">Info &amp; Map</span>
        </div>
      </div>
    </div>`;
  }).join('');
}
//  EP HARDCODED RACE CALENDAR 2026
//  Races auto-disappear once their date has passed.
//  Update names/dates to match the official EP Athletics
//  calendar each season.

const RC_BASE = 'https://runningcalendar.co.za';
const RACE_IMG = {
  road: 'https://epathletics.co.za/wp-content/uploads/2026/03/Forest-run-2026.png',
  half: 'https://epathletics.co.za/wp-content/uploads/2026/05/Bay-Relay-2026.png',
  marathon: 'https://epathletics.co.za/wp-content/uploads/2021/09/Epa-Logo_REDRAW-01.png',
  trail: 'https://epathletics.co.za/wp-content/uploads/2026/04/cross-coutry-flyer.png',
  walk: 'https://epathletics.co.za/wp-content/uploads/2021/09/Epa-Logo_REDRAW-01.png'
};
const EPA_LOGO = 'https://epathletics.co.za/wp-content/uploads/2021/09/Epa-Logo_REDRAW-01.png';
const EPA_RACE_ALBUM_PREFIX = 'EPA Race Photo | ';
const TRAINING_ALBUM_PREFIX = 'Training Run | ';
const EPA_VISIBLE_LIMIT = 5;
let epaRacePhotos = {};
let currentRaceFilter = 'all';
let epaRacesExpanded = false;
let trainingPhotoFile = null;
let trainingUploadInFlight = false;
const RC_EVENT_IMAGES = {
  'bcmac-10km': 'https://admin.runningcalendar.co.za/storage/edition/5927/5MHXBfTK6HKJLZDkBJvvODJ5XUeOjwKBnGUQ8Bvh.webp',
  'cape-st-francis-resort-road-run-walk': 'https://admin.runningcalendar.co.za/storage/edition/6062/cape-st-francis-resort-road-run.webp',
  'cheetahs-marathon': 'https://admin.runningcalendar.co.za/storage/edition/5750/D1df9HjpALWdyUfUNbPBIbJruTn5YckPtXOqBFGv.jpg',
  'chillie-day-of-reconciliation-run': 'https://admin.runningcalendar.co.za/storage/edition/6058/l3dzXnvlejsKfTXUCFDMeNBHKa3VkGbZF2xwrHua.webp',
  'crusaders-road-race': 'https://admin.runningcalendar.co.za/storage/edition/5931/crusaders-10km-race.webp',
  'eclb-awareness-run': 'https://admin.runningcalendar.co.za/storage/edition/5686/eclb.webp',
  'forest-run-challenge': 'https://admin.runningcalendar.co.za/storage/edition/5648/forest-run-challenge-2026.webp',
  'gamtoosvalley-farm-run': 'https://admin.runningcalendar.co.za/storage/edition/5839/hZxvIV8GIBw5k2Qrmdp9ACKIyggqvKA4YhwGAEuJ.webp',
  'great-kei-marathon': 'https://admin.runningcalendar.co.za/storage/edition/5899/APYvj7rTCIY4dexc3W9hb5jXLkBL5RLlH2aqECWV.webp',
  'icons-journey-marathon': 'https://admin.runningcalendar.co.za/storage/edition/5788/5aRFGlw4Km9AHlg54yj4tZh45JeorCxuYfP7XVWN.webp',
  'komani-half-marathon': 'https://admin.runningcalendar.co.za/storage/edition/5921/komani-road-runners.webp',
  'kwelamampondo-half-marathon-challenge': 'https://admin.runningcalendar.co.za/storage/edition/5902/kwelamampondo-half-marathon.webp',
  'lusiki-harriers-10km-race': 'https://admin.runningcalendar.co.za/storage/edition/6051/lusiki-plaza.webp',
  'makro-10km-road-race': 'https://admin.runningcalendar.co.za/storage/edition/5762/makro.webp',
  'mdantsane-marathon': 'https://admin.runningcalendar.co.za/storage/edition/6050/VUIP4KhpT6FnUtsO01XAvUgl52LvXVWzB16l2JfP.webp',
  'mercedes-benz-17km-gallop': 'https://admin.runningcalendar.co.za/storage/edition/5817/XVKLjbgtoBpSf8SEojqRAElIfbgpPMAdIYI9ioyh.jpg',
  'mthatha-half-marathon': 'https://admin.runningcalendar.co.za/storage/edition/5637/mthatha-athletics-club.webp',
  'mthatha-street-race': 'https://admin.runningcalendar.co.za/storage/edition/6029/wx5FfcfMOCuAI7D7zh1ix2P47MIYxbbMyqpGx2Du.webp',
  'nelson-mandela-bay-choose-to-challenge': 'https://admin.runningcalendar.co.za/storage/edition/5793/BI4lI0a33ulg3q7RvWKnUHN1boncZKqsp3JGBb8y.webp',
  'nmu-madibaz-half-marathon': 'https://admin.runningcalendar.co.za/storage/edition/5783/qTyQhZ0YKouV0rfuDEdqAlL4Ai3vHEnRBbZqF1go.webp',
  'overtakers-sc-womens-day-race': 'https://admin.runningcalendar.co.za/storage/edition/5804/overtakers-sports-club.webp',
  'psj-river-mountain-run': 'https://admin.runningcalendar.co.za/storage/edition/5890/port-st-johns.webp',
  'qokolweni-16km': 'https://admin.runningcalendar.co.za/storage/edition/6121/Qokolweni-Athletics-Club.webp',
  'spar-womens-challenge-gqeberha': 'https://admin.runningcalendar.co.za/storage/edition/5756/womens-challenge-generic.webp',
  'the-bramble-berry-run': 'https://admin.runningcalendar.co.za/storage/edition/6096/S5LlTKNNIOpASKyaS6hZ6jz8cUQPsQWLMs4UWsTI.webp',
  'the-last-route-marathon': 'https://admin.runningcalendar.co.za/storage/edition/6056/last-route-marathon.webp',
  'two-views-challenge': 'https://admin.runningcalendar.co.za/storage/edition/5479/z8qEAx7ZH1ZermfSa9iBGUecB2PfzHQTGzLzpDmb.webp',
  'umzila-ka-tambo-marathon': 'https://admin.runningcalendar.co.za/storage/edition/5964/4oldrSnJ52rSkmVOtfx29XOpMN2rLUm2CQxJXi81.webp',
  'vukani-15km-road-race': 'https://admin.runningcalendar.co.za/storage/edition/5992/uHs9fE1r3tRVqXe0sJ8EKlOKVa3XKDFYrTuz7hzg.webp',
  'washie-100-miler': 'https://admin.runningcalendar.co.za/storage/edition/5768/washie-100miler.webp',
  'xj10': 'https://admin.runningcalendar.co.za/storage/edition/5933/xj10.webp'
};

const EP_CALENDAR_2026 = [
  { date: '2026-05-31', d: '31', m: 'May', n: 'Mthatha Half-Marathon 2026', l: 'Mthatha', ds: ['21.1', '10'], t: 'half', u: `${RC_BASE}/events/mthatha-half-marathon` },
  { date: '2026-06-06', d: '06', m: 'Jun', n: 'VQS Diesel Depot 15km Challenge 2026', l: 'East London', ds: ['15', '5'], t: 'road', u: `${RC_BASE}/events/vqs-diesel-depot-15km-challenge` },
  { date: '2026-06-20', d: '20', m: 'Jun', n: 'Forest Run Challenge 2026', l: 'Gqeberha', ds: ['15', '5'], t: 'road', u: `${RC_BASE}/events/forest-run-challenge` },
  { date: '2026-06-27', d: '27', m: 'Jun', n: 'NMB Half-Marathon 2026', l: 'Gqeberha', ds: ['21.1', '5'], t: 'half', u: `${RC_BASE}/events/nmb-half-marathon` },
  { date: '2026-06-28', d: '28', m: 'Jun', n: 'ECLB Awareness Run 2026', l: 'East London', ds: ['21.1', '10', '4', '2'], t: 'half', u: `${RC_BASE}/events/eclb-awareness-run` },
  { date: '2026-07-04', d: '04', m: 'Jul', n: 'Makro 10km Road Race 2026', l: 'Gqeberha', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/makro-10km-road-race` },
  { date: '2026-07-18', d: '18', m: 'Jul', n: 'Golden Oldies 10km 2026', l: 'East London', ds: ['10'], t: 'road', u: `${RC_BASE}/events/golden-oldies` },
  { date: '2026-07-25', d: '25', m: 'Jul', n: 'NMU Madibaz Half-Marathon 2026', l: 'Summerstrand', ds: ['21.1', '10', '5'], t: 'half', u: `${RC_BASE}/events/nmu-madibaz-half-marathon` },
  { date: '2026-07-26', d: '26', m: 'Jul', n: "Icon's Journey Marathon 2026", l: 'Mthatha', ds: ['35', '14'], t: 'marathon', u: `${RC_BASE}/events/icons-journey-marathon` },
  { date: '2026-08-01', d: '01', m: 'Aug', n: 'Nelson Mandela Bay Choose to Challenge 2026', l: 'Gqeberha', ds: ['10', '5', '1'], t: 'road', u: `${RC_BASE}/events/nelson-mandela-bay-choose-to-challenge` },
  { date: '2026-08-01', d: '31', m: 'Jul', n: 'Washie 100 Miler 2026', l: 'East London', ds: ['161'], t: 'marathon', u: `${RC_BASE}/events/washie-100-miler` },
  { date: '2026-08-09', d: '09', m: 'Aug', n: "Nyandeni Women's Day Road Race 2026", l: 'Libode', ds: ['21.1', '10', '5'], t: 'half', u: `${RC_BASE}/events/nyandeni-womens-day-road-race` },
  { date: '2026-08-09', d: '09', m: 'Aug', n: "Overtakers SC Women's Day Race 2026", l: 'East London', ds: ['21.1', '10', '5'], t: 'half', u: `${RC_BASE}/events/overtakers-sc-womens-day-race` },
  { date: '2026-08-15', d: '15', m: 'Aug', n: 'GBS Mutual Bank Mountain Drive Half Marathon 2026', l: 'Grahamstown', ds: ['21.1', '10', '1'], t: 'half', u: `${RC_BASE}/events/gbs-mutual-bank-mountain-drive-half-marathon` },
  { date: '2026-08-16', d: '16', m: 'Aug', n: 'DRIVEN MBSA 15KM Road Race 2026', l: 'East London', ds: ['15', '5'], t: 'road', u: `${RC_BASE}/events/driven-mbsa-15km-road-race` },
  { date: '2026-08-22', d: '22', m: 'Aug', n: 'Mercedes Benz 17km Gallop 2026', l: 'East London', ds: ['17', '5'], t: 'road', u: `${RC_BASE}/events/mercedes-benz-17km-gallop` },
  { date: '2026-08-29', d: '29', m: 'Aug', n: 'Despatch Road Race 2026', l: 'Despatch', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/despatch-road-race` },
  { date: '2026-08-30', d: '30', m: 'Aug', n: 'Mdantsane Kasi 10km 2026', l: 'Mdantsane', ds: ['10', '4', '1'], t: 'road', u: `${RC_BASE}/events/mdantsane-kasi-10km` },
  { date: '2026-09-05', d: '05', m: 'Sep', n: 'Gamtoosvalley Farm Run 2026', l: 'Patensie', ds: ['21.1', '10', '5'], t: 'trail', u: `${RC_BASE}/events/gamtoosvalley-farm-run` },
  { date: '2026-09-06', d: '06', m: 'Sep', n: 'Masters Marathon 2026', l: 'East London', ds: ['42.2', '21.1'], t: 'marathon', u: `${RC_BASE}/events/masters-marathon` },
  { date: '2026-09-12', d: '12', m: 'Sep', n: 'Sportsmans Warehouse 15km Road Race 2026', l: 'Gqeberha', ds: ['15'], t: 'road', u: `${RC_BASE}/events/sportsmans-warehouse-15km-road-race` },
  { date: '2026-09-13', d: '13', m: 'Sep', n: 'Astron Energy Sole Destroyer Half-Marathon 2026', l: 'East London', ds: ['21.1', '10', '5'], t: 'half', u: `${RC_BASE}/events/astron-energy-sole-destroyer-half-marathon` },
  { date: '2026-09-13', d: '13', m: 'Sep', n: 'Cheetah Chase 10km Powered by Vodacom 2026', l: 'Mthatha', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/cheetah-chase-10km-powered-by-vodacom` },
  { date: '2026-09-19', d: '19', m: 'Sep', n: 'Northern Areas 10km & 5km Family Run 2026', l: 'Gqeberha', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/northern-areas-10km-5km-family-run` },
  { date: '2026-09-20', d: '20', m: 'Sep', n: 'Elliot Madeira Marathon 2026', l: 'Mthatha', ds: ['42.2', '21.1', '10', '5'], t: 'marathon', u: `${RC_BASE}/events/elliot-madeira-marathon` },
  { date: '2026-09-20', d: '20', m: 'Sep', n: 'Friends of Pumpkins 10km Run 2026', l: 'East London', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/friends-of-pumpkins-10km-run` },
  { date: '2026-09-26', d: '26', m: 'Sep', n: 'Great Kei Marathon 2026', l: 'Kei Mouth', ds: ['42.2', '21.1', '5'], t: 'marathon', u: `${RC_BASE}/events/great-kei-marathon` },
  { date: '2026-09-27', d: '27', m: 'Sep', n: 'Cape St Francis Resort Calamari Half 2026', l: 'St Francis Bay', ds: ['21.1', '10'], t: 'half', u: `${RC_BASE}/events/cape-st-francis-resort-calamari-half` },
  { date: '2026-09-27', d: '27', m: 'Sep', n: 'Kwelamampondo Half Marathon Challenge 2026', l: 'Mngungundlovu', ds: ['21.1', '10', '7'], t: 'half', u: `${RC_BASE}/events/kwelamampondo-half-marathon-challenge` },
  { date: '2026-09-27', d: '27', m: 'Sep', n: 'PSJ River Mountain Run 2026', l: 'Port Saint Johns', ds: ['21.1', '10', '5'], t: 'trail', u: `${RC_BASE}/events/psj-river-mountain-run` },
  { date: '2026-09-27', d: '27', m: 'Sep', n: "SPAR Women's Challenge Gqeberha 2026", l: 'Gqeberha', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/spar-womens-challenge-gqeberha` },
  { date: '2026-10-03', d: '03', m: 'Oct', n: 'BayRun with Discovery Vitality 2026', l: 'Gqeberha', ds: ['21.1', '10', '5'], t: 'half', u: `${RC_BASE}/events/bayrun-with-discovery-vitality` },
  { date: '2026-10-03', d: '03', m: 'Oct', n: 'Komani Half Marathon 2026', l: 'Queenstown', ds: ['21.1', '10', '5'], t: 'half', u: `${RC_BASE}/events/komani-half-marathon` },
  { date: '2026-10-10', d: '10', m: 'Oct', n: 'BCMAC 10km 2026', l: 'East London', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/bcmac-10km` },
  { date: '2026-10-10', d: '10', m: 'Oct', n: 'Buco Smash The Pineapple Run 2026', l: 'Port Alfred', ds: ['27', '10'], t: 'half', u: `${RC_BASE}/events/buco-smash-the-pineapple-run` },
  { date: '2026-10-11', d: '11', m: 'Oct', n: 'Stutterheim 15km Spring Run 2026', l: 'Stutterheim', ds: ['15', '5'], t: 'road', u: `${RC_BASE}/events/stutterheim-15km-spring-run` },
  { date: '2026-10-11', d: '11', m: 'Oct', n: 'XJ10 2026', l: 'eMaxesibeni', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/xj10` },
  { date: '2026-10-17', d: '17', m: 'Oct', n: 'Crusaders Road Race 2026', l: 'Gqeberha', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/crusaders-road-race` },
  { date: '2026-10-17', d: '17', m: 'Oct', n: 'Galaxy Bingo Heroes Run 2026', l: 'eQonce', ds: ['15', '5'], t: 'road', u: `${RC_BASE}/events/galaxy-bingo-heroes-run` },
  { date: '2026-10-17', d: '17', m: 'Oct', n: 'Lilyfontein Tomato TROT 2026', l: 'East London', ds: ['15', '5'], t: 'trail', u: `${RC_BASE}/events/lilyfontein-tomato-trot` },
  { date: '2026-10-24', d: '24', m: 'Oct', n: 'Algoa FM Big Walk for Cancer 2026', l: 'Gqeberha', ds: ['5'], t: 'walk', u: `${RC_BASE}/events/algoa-fm-big-walk-for-cancer` },
  { date: '2026-10-24', d: '24', m: 'Oct', n: 'Kotelo Mbekeni Foundation 5km Fun Run 2026', l: 'Queenstown', ds: ['5'], t: 'road', u: `${RC_BASE}/events/kotelo-mbekeni-foundation-5km-fun-run` },
  { date: '2026-10-24', d: '24', m: 'Oct', n: 'Two Views Challenge 2026', l: 'Gqeberha', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/two-views-challenge` },
  { date: '2026-10-25', d: '25', m: 'Oct', n: 'Khulani 10km and 5km Fun Run 2026', l: 'Mdantsane', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/khulani-10km-and-5km-fun-run` },
  { date: '2026-10-25', d: '25', m: 'Oct', n: 'Umzila Ka Tambo Marathon 2026', l: 'Mbizana', ds: ['42.2', '21.1', '10', '5'], t: 'marathon', u: `${RC_BASE}/events/umzila-ka-tambo-marathon` },
  { date: '2026-10-31', d: '31', m: 'Oct', n: 'Galaxy Bingo Corkwood Run 2026', l: 'Kariega', ds: ['15', '5'], t: 'road', u: `${RC_BASE}/events/galaxy-bingo-corkwood-run` },
  { date: '2026-11-07', d: '07', m: 'Nov', n: 'Bonkolo Marathon & Half-Marathon 2026', l: 'Queenstown', ds: ['42.2', '21.1', '10'], t: 'marathon', u: `${RC_BASE}/events/bonkolo-marathon-half-marathon` },
  { date: '2026-11-08', d: '08', m: 'Nov', n: 'Cheetahs Marathon 2026', l: 'Mthatha', ds: ['42.2', '21.1', '10', '5'], t: 'marathon', u: `${RC_BASE}/events/cheetahs-marathon` },
  { date: '2026-11-08', d: '08', m: 'Nov', n: 'Xerox Lightning Fast 2026', l: 'East London', ds: ['10'], t: 'road', u: `${RC_BASE}/events/xerox-lightning-fast` },
  { date: '2026-11-14', d: '14', m: 'Nov', n: 'Vukani 15Km Road Race 2026', l: 'Gqeberha', ds: ['15', '5'], t: 'road', u: `${RC_BASE}/events/vukani-15km-road-race` },
  { date: '2026-11-15', d: '15', m: 'Nov', n: 'Haven Hills Athletics Club 21km 2026', l: 'East London', ds: ['21.1', '5'], t: 'half', u: `${RC_BASE}/events/haven-hills-athletics-club-21km` },
  { date: '2026-11-15', d: '15', m: 'Nov', n: 'O.R. Tambo Half Marathon 2026', l: 'Mthatha', ds: ['21.1', '10', '5'], t: 'half', u: `${RC_BASE}/events/o-r-tambo-half-marathon` },
  { date: '2026-11-21', d: '21', m: 'Nov', n: 'Bank to Bank 10km 2026', l: 'East London', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/bank-to-bank-10km` },
  { date: '2026-11-28', d: '28', m: 'Nov', n: 'Aspen 10km Run & Walk 2026', l: 'Gqeberha', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/aspen-10km-run-walk` },
  { date: '2026-11-28', d: '28', m: 'Nov', n: 'Bramble Berry Run 2026', l: 'East London', ds: ['15', '5'], t: 'road', u: `${RC_BASE}/events/the-bramble-berry-run` },
  { date: '2026-11-29', d: '29', m: 'Nov', n: 'Mthatha Street Race 2026', l: 'Mthatha', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/mthatha-street-race` },
  { date: '2026-12-05', d: '05', m: 'Dec', n: 'Hogsback Arminel Trail 2026', l: 'Hogsback', ds: ['21.1', '10', '5'], t: 'trail', u: `${RC_BASE}/events/hogsback-arminel-trail` },
  { date: '2026-12-05', d: '05', m: 'Dec', n: 'NMB 1City Marathon 2026', l: 'Gqeberha', ds: ['42.2', '21.1', '10', '5'], t: 'marathon', u: `${RC_BASE}/events/nmb-1city-marathon` },
  { date: '2026-12-06', d: '06', m: 'Dec', n: 'FLYA FESTIVE 15km 2026', l: 'Mdantsane', ds: ['15', '4', '1'], t: 'road', u: `${RC_BASE}/events/flya-festive-15km` },
  { date: '2026-12-06', d: '06', m: 'Dec', n: 'Runners Tour Race 2026', l: 'Port Saint Johns', ds: ['42.2', '21.1', '10', '5'], t: 'marathon', u: `${RC_BASE}/events/runners-tour-race` },
  { date: '2026-12-12', d: '12', m: 'Dec', n: 'Mdantsane Marathon 2026', l: 'Mdantsane', ds: ['42.2', '10', '5'], t: 'marathon', u: `${RC_BASE}/events/mdantsane-marathon` },
  { date: '2026-12-13', d: '13', m: 'Dec', n: 'Lusiki Harriers 10km Race 2026', l: 'Lusikisiki', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/lusiki-harriers-10km-race` },
  { date: '2026-12-16', d: '16', m: 'Dec', n: 'Chillie Day of Reconciliation Run 2026', l: 'East London', ds: ['16', '5'], t: 'road', u: `${RC_BASE}/events/chillie-day-of-reconciliation-run` },
  { date: '2026-12-16', d: '16', m: 'Dec', n: 'The Last Route Marathon 2026', l: 'Mthatha', ds: ['42.2', '10', '5'], t: 'marathon', u: `${RC_BASE}/events/the-last-route-marathon` },
  { date: '2026-12-18', d: '18', m: 'Dec', n: 'Cape St Francis Resort Road Run & Walk 2026', l: 'Cape Saint Francis', ds: ['10', '5'], t: 'road', u: `${RC_BASE}/events/cape-st-francis-resort-road-run-walk` },
  { date: '2026-12-24', d: '24', m: 'Dec', n: 'Qokolweni 16km 2026', l: 'Qokolweni', ds: ['16', '10', '5'], t: 'road', u: `${RC_BASE}/events/qokolweni-16km` }
];

function raceDateEnd(dateValue) {
  const d = new Date(`${dateValue}T23:59:59`);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function epaRaceKey(race) {
  const slug = String(race?.u || '').split('/events/')[1] || '';
  return slug || `${race?.date || 'race'}-${String(race?.n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function epaRaceAlbumName(race) {
  return `${EPA_RACE_ALBUM_PREFIX}${epaRaceKey(race)}`;
}

function findEpaRaceByKey(key) {
  return EP_CALENDAR_2026.find(r => epaRaceKey(r) === key);
}

function getActiveEPRaces() {
  const now = new Date();
  return EP_CALENDAR_2026
    .filter(r => raceDateEnd(r.date) >= now)
    .sort((a, b) => new Date(`${a.date}T00:00:00`) - new Date(`${b.date}T00:00:00`))
    .map(r => {
      const slug = String(r.u || '').split('/events/')[1] || '';
      const manualImg = epaRacePhotos[epaRaceKey(r)] || epaRacePhotos[r.date];
      return { ...r, u: raceUrl(r), img: manualImg || r.img || RC_EVENT_IMAGES[slug] || RACE_IMG[r.t] || RACE_IMG.road, logo: r.logo || EPA_LOGO };
    });
}

async function loadEpaRacePhotos() {
  const { data: albums, error } = await supabase
    .from('albums')
    .select('id, name')
    .like('name', `${EPA_RACE_ALBUM_PREFIX}%`);
  if (error || !albums?.length) {
    epaRacePhotos = {};
    return;
  }
  const albumIds = albums.map(album => album.id);
  const { data: photos } = await supabase
    .from('images')
    .select('album_id, image_url, created_at')
    .in('album_id', albumIds)
    .order('created_at', { ascending: false });
  const albumKeys = new Map(albums.map(album => [album.id, album.name.replace(EPA_RACE_ALBUM_PREFIX, '').trim()]));
  epaRacePhotos = {};
  (photos || []).forEach(photo => {
    const key = albumKeys.get(photo.album_id);
    if (key && !epaRacePhotos[key]) epaRacePhotos[key] = photo.image_url;
  });
}

async function fetchLiveEPRaces() {
  const grid = document.getElementById('rg');
  if (!grid) return;
  await loadEpaRacePhotos();
  scrapedRaces = getActiveEPRaces();
  rr('all');
}

function rr(filter) {
  currentRaceFilter = filter;
  const g = document.getElementById('rg');
  if (!g) return;
  const admin = window.isAdmin();
  const list = filter === 'all' ? [...scrapedRaces] : scrapedRaces.filter(r => {
    if (filter === 'road') return r.t === 'road' || r.t === 'trail' || r.t === 'walk';
    if (filter === 'half') return r.t === 'half';
    if (filter === 'marathon') return r.t === 'marathon';
    return true;
  });
  if (list.length === 0) {
    g.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--mu);font-style:italic;">No upcoming events in this category.</div>`;
    return;
  }
  const visibleList = epaRacesExpanded ? list : list.slice(0, EPA_VISIBLE_LIMIT);
  const cardsHtml = visibleList.map(r => {
    const canUploadPhoto = admin;
    const key = epaRaceKey(r);
    const url = raceUrl(r);
    const uploadHtml = canUploadPhoto ? `<div class="race-photo-admin" onclick="event.stopPropagation()">
        <label class="race-photo-btn">Upload Photo
          <input type="file" accept="image/*" onchange="window.uploadEpaRacePhoto('${window.es(key)}', event)">
        </label>
      </div>` : '';
    return `<div class="rc has-img" role="link" tabindex="0" onclick="window.open('${url}', '_blank', 'noopener')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.open('${url}', '_blank', 'noopener')}">
      <img class="rc-img" src="${r.img}" alt="${window.es(r.n)}"${imageLoadAttr()}><div class="rc-ov"></div>
      ${r.logo ? `<div class="rc-logo"><img src="${r.logo}" alt="Eastern Province Athletics logo"${imageLoadAttr()}></div>` : ''}
      <div class="rc-body">
        <div class="rdr">
          <div class="rday">${r.d}</div>
          <div class="rmeta"><div class="rmon">${r.m} 2026</div><div class="rloc">${window.es(r.l)}</div></div>
        </div>
        <div class="rn">${window.es(r.n)}</div>
        <div class="dists">${r.ds.map(d => `<span class="di${parseFloat(d) >= 21 ? ' long' : ''}">${d}km</span>`).join('')}</div>
        ${uploadHtml}
        <a href="${url}" target="_blank" rel="noopener" class="rl" onclick="event.stopPropagation()">Entry &amp; Details</a>
      </div>
    </div>`;
  }).join('');
  const remaining = list.length - EPA_VISIBLE_LIMIT;
  const expandHtml = list.length > EPA_VISIBLE_LIMIT
    ? `<div class="race-expand-row">
        <button type="button" class="race-expand-btn" onclick="window.toggleEpaRaces()">
          ${epaRacesExpanded ? 'Show Fewer Fixtures' : `Show All Fixtures (${remaining} More)`}
        </button>
      </div>`
    : '';
  g.innerHTML = cardsHtml + expandHtml;
}

window.toggleEpaRaces = function() {
  epaRacesExpanded = !epaRacesExpanded;
  rr(currentRaceFilter);
};

window.toggleSocialFloat = function(event) {
  event?.stopPropagation();
  const social = document.getElementById('socialFloat');
  const toggle = social?.querySelector('.social-toggle');
  if (!social || !toggle) return;
  const isOpen = social.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(isOpen));
};

document.addEventListener('click', (event) => {
  const social = document.getElementById('socialFloat');
  if (!social || social.contains(event.target)) return;
  social.classList.remove('open');
  social.querySelector('.social-toggle')?.setAttribute('aria-expanded', 'false');
});

window.uploadEpaRacePhoto = async function(key, event) {
  if (!window.isAdmin()) return;
  const file = event?.target?.files?.[0];
  if (!file) return;
  const race = findEpaRaceByKey(key);
  if (!race) {
    toast('Race photo save failed - event not found.', 'error');
    event.target.value = '';
    return;
  }
  toast('Uploading race photo...', 'info');
  const prepared = await compressImageForUpload(file, { maxDimension: 1400, quality: 0.76 });
  const safeName = prepared.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  let publicUrl;
  try {
    publicUrl = await uploadFileToR2(prepared.file, `epa-races/${key}`, safeName);
  } catch (error) {
    toast(`Upload failed: ${error.message}`, 'error');
    event.target.value = '';
    return;
  }
  let { data: album } = await supabase
    .from('albums')
    .select('id')
    .eq('name', epaRaceAlbumName(race))
    .single();
  if (!album) {
    const { data: created, error: albumErr } = await supabase
      .from('albums')
      .insert({ name: epaRaceAlbumName(race) })
      .select('id')
      .single();
    if (albumErr) {
      toast(`Photo uploaded but album save failed: ${albumErr.message}`, 'error');
      event.target.value = '';
      return;
    }
    album = created;
  }
  const { error: saveErr } = await supabase
    .from('images')
    .insert({ album_id: album.id, image_url: publicUrl });
  event.target.value = '';
  if (saveErr) {
    toast(`Photo uploaded but could not be saved: ${saveErr.message}`, 'error');
    return;
  }
  epaRacePhotos[key] = publicUrl;
  scrapedRaces = getActiveEPRaces();
  rr(currentRaceFilter);
  toast('Race photo updated.', 'success');
};

window.fr = function(type, btn) {
  epaRacesExpanded = false;
  document.querySelectorAll('.flt').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  rr(type);
};

function encodeTrainingAlbumName(run) {
  return `${TRAINING_ALBUM_PREFIX}${JSON.stringify(run)}`;
}

function decodeTrainingAlbumName(name) {
  const raw = String(name || '').replace(TRAINING_ALBUM_PREFIX, '');
  try {
    return JSON.parse(raw);
  } catch {
    return { title: raw || 'Training Run', date: '', time: '', location: '', notes: '' };
  }
}

function formatDisplayDate(value) {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDisplayTime(value) {
  if (!value) return '';
  const [hours, minutes] = String(value).split(':');
  if (!hours || !minutes) return value;
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

window.handleTrainingPhotoPick = function(event) {
  trainingPhotoFile = event?.target?.files?.[0] || null;
  const label = document.getElementById('trainingPhotoName');
  if (label) label.textContent = trainingPhotoFile ? trainingPhotoFile.name : 'No photo selected';
};

window.renderTrainingRuns = async function() {
  const grid = document.getElementById('trainingGrid');
  if (!grid) return;
  const { data: albums, error } = await supabase
    .from('albums')
    .select('id, name, created_at')
    .like('name', `${TRAINING_ALBUM_PREFIX}%`)
    .order('created_at', { ascending: false });
  if (error) {
    grid.innerHTML = `<div class="news-empty">Training runs could not load.</div>`;
    return;
  }
  if (!albums?.length) {
    grid.innerHTML = `<div class="news-empty">No training runs posted yet.</div>`;
    return;
  }
  const albumIds = albums.map(album => album.id);
  const { data: photos } = await supabase
    .from('images')
    .select('id, album_id, image_url, created_at')
    .in('album_id', albumIds)
    .order('created_at', { ascending: false });
  const firstPhotoByAlbum = new Map();
  (photos || []).forEach(photo => {
    if (!firstPhotoByAlbum.has(photo.album_id)) firstPhotoByAlbum.set(photo.album_id, photo);
  });
  const admin = window.isAdmin();
  grid.innerHTML = albums.map(album => {
    const run = decodeTrainingAlbumName(album.name);
    const photo = firstPhotoByAlbum.get(album.id);
    const img = photo?.image_url || 'logo.JPG';
    const removeBtn = admin
      ? `<button type="button" class="training-remove" onclick="window.deleteTrainingRun('${album.id}', '${photo?.image_url || ''}')">Remove</button>`
      : '';
    return `<article class="training-card">
      <button type="button" class="training-photo-btn" data-src="${window.es(img)}" data-title="${window.es(run.title || 'Training run')}" onclick="window.openTrainingPhotoFromButton(this)" aria-label="Open ${window.es(run.title || 'training run')} photo">
        <img src="${img}" alt="${window.es(run.title || 'Training run')}"${imageLoadAttr()}>
      </button>
      <div class="training-card-body">
        <div class="training-date">${window.es([formatDisplayDate(run.date), formatDisplayTime(run.time)].filter(Boolean).join(' - '))}</div>
        <h3>${window.es(run.title || 'Training Run')}</h3>
        ${run.location ? `<div class="training-location">${window.es(run.location)}</div>` : ''}
        ${run.notes ? `<p>${window.es(run.notes)}</p>` : ''}
        ${removeBtn}
      </div>
    </article>`;
  }).join('');
};

window.openTrainingPhoto = function(imageUrl, title = 'Training run') {
  openViewer(0, [{ image_url: imageUrl, title }]);
};

window.openTrainingPhotoFromButton = function(button) {
  window.openTrainingPhoto(button?.dataset?.src || 'logo.JPG', button?.dataset?.title || 'Training run');
};

window.uploadTrainingRun = async function() {
  if (!window.isAdmin()) return;
  if (trainingUploadInFlight) return;
  const title = document.getElementById('trainingTitle')?.value.trim();
  const date = document.getElementById('trainingDate')?.value;
  const time = document.getElementById('trainingTime')?.value;
  const location = document.getElementById('trainingLocation')?.value.trim();
  const notes = document.getElementById('trainingNotes')?.value.trim();
  if (!title || !date || !trainingPhotoFile) {
    toast('Add a title, date, and photo for the training run.', 'error');
    return;
  }
  trainingUploadInFlight = true;
  const postBtn = document.querySelector('.training-post-btn');
  if (postBtn) {
    postBtn.disabled = true;
    postBtn.textContent = 'Posting...';
  }
  toast('Uploading training run...', 'info');
  try {
    const run = { title, date, time, location, notes };
    const { data: album, error: albumErr } = await supabase
      .from('albums')
      .insert({ name: encodeTrainingAlbumName(run) })
      .select('id')
      .single();
    if (albumErr) {
      toast(`Training run save failed: ${albumErr.message}`, 'error');
      return;
    }
    const prepared = await compressImageForUpload(trainingPhotoFile, { maxDimension: 1400, quality: 0.76 });
    const safeName = prepared.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    let publicUrl;
    try {
      publicUrl = await uploadFileToR2(prepared.file, `training-runs/${album.id}`, safeName);
    } catch (error) {
      await supabase.from('albums').delete().eq('id', album.id);
      toast(`Training photo upload failed: ${error.message}`, 'error');
      return;
    }
    const { error: imageErr } = await supabase
      .from('images')
      .insert({ album_id: album.id, image_url: publicUrl });
    if (imageErr) {
      await deleteStoredImage(publicUrl);
      await supabase.from('albums').delete().eq('id', album.id);
      toast(`Photo uploaded but database save failed: ${imageErr.message}`, 'error');
      return;
    }
    ['trainingTitle', 'trainingDate', 'trainingTime', 'trainingLocation', 'trainingNotes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const photoInput = document.getElementById('trainingPhotoInput');
    if (photoInput) photoInput.value = '';
    trainingPhotoFile = null;
    const label = document.getElementById('trainingPhotoName');
    if (label) label.textContent = 'No photo selected';
    await window.renderTrainingRuns();
    toast('Training run posted.', 'success');
  } finally {
    trainingUploadInFlight = false;
    if (postBtn) {
      postBtn.disabled = false;
      postBtn.textContent = 'Post Training Run';
    }
  }
};

window.deleteTrainingRun = async function(albumId, imageUrl) {
  if (!window.isAdmin()) return;
  if (!confirm('Remove this training run?')) return;
  await deleteStoredImage(imageUrl);
  await supabase.from('images').delete().eq('album_id', albumId);
  await supabase.from('albums').delete().eq('id', albumId);
  await window.renderTrainingRuns();
  toast('Training run removed.', 'info');
};
//  GALLERY

let currentAlbumId = null;
let viewerPhotos   = [];
let viewerIndex    = 0;

function storagePathFromUrl(url) {
  try {
    if (!url) return null;
    const parts = url.split('/album-images/');
    return parts.length > 1 ? parts[1] : null;
  } catch { return null; }
}

window.renderAlbums = async function() {
  const grid = document.getElementById('albumsGrid');
  if (!grid) return;

  const { data: albums, error } = await supabase
    .from('albums').select('*').order('created_at', { ascending: false });
  if (error) { toast('Failed to load albums.', 'error'); return; }

  const q    = document.getElementById('albumSearch')?.value.toLowerCase() || '';
  const sort = document.getElementById('sortSelect')?.value || 'newest';
  const galleryAlbums = albums.filter(a =>
    !String(a.name || '').startsWith(EPA_RACE_ALBUM_PREFIX) &&
    !String(a.name || '').startsWith(TRAINING_ALBUM_PREFIX) &&
    String(a.name || '') !== CAROUSEL_ALBUM_NAME
  );
  let filtered = q ? galleryAlbums.filter(a => a.name.toLowerCase().includes(q)) : [...galleryAlbums];
  if (sort === 'name')   filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'oldest') filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const badge = document.getElementById('albumBadge');
  if (badge) badge.textContent = `${galleryAlbums.length} album${galleryAlbums.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-albums">
      <div class="empty-icon">Photo</div>
      <div class="empty-title">${q ? 'No Matching Albums' : 'No Albums Yet'}</div>
      <p class="empty-sub">${q ? 'Try a different search term.' : 'Albums will appear here once created.'}</p>
    </div>`;
    return;
  }

  const albumIds = filtered.map(album => album.id);
  const { data: allPhotos } = await supabase
    .from('images')
    .select('id, album_id, image_url, created_at')
    .in('album_id', albumIds)
    .order('created_at', { ascending: true });
  const photosByAlbum = new Map();
  (allPhotos || []).forEach(photo => {
    if (!photosByAlbum.has(photo.album_id)) photosByAlbum.set(photo.album_id, []);
    photosByAlbum.get(photo.album_id).push(photo);
  });
  const albumsWithPhotos = filtered.map(album => ({ ...album, photos: photosByAlbum.get(album.id) || [] }));

  const admin = window.isAdmin();
  grid.innerHTML = '';
  albumsWithPhotos.forEach(album => {
    const photos = album.photos;
    const card = document.createElement('div');
    card.className = 'album-card';

    let thumbHtml;
    if (photos.length > 0) {
      thumbHtml = `<div class="album-thumb">
        <img src="${photos[0].image_url}" alt=""${imageLoadAttr()}>
        ${photos.length > 1 ? `<div class="mosaic-more">+${photos.length - 1}</div>` : ''}
        <div class="album-thumb-overlay"></div>
        <div class="album-open-label">Open Album</div>
      </div>`;
    } else {
      thumbHtml = `<div class="album-thumb">
        <div class="album-thumb-empty">Photo</div>
        <div class="album-thumb-overlay"></div>
        <div class="album-open-label">Open Album</div>
      </div>`;
    }

    const delBtn = admin
      ? `<button class="album-del" title="Delete album" onclick="event.stopPropagation();window.deleteAlbum('${album.id}')">Remove</button>`
      : '';

    card.innerHTML = `
      ${thumbHtml}
      <div class="album-body">
        <div class="album-name">${window.es(album.name)}</div>
        <div class="album-meta">
          <span class="album-count">${photos.length} photo${photos.length !== 1 ? 's' : ''}</span>
          ${delBtn}
        </div>
      </div>`;
    card.onclick = () => window.openLightbox(album.id);
    grid.appendChild(card);
  });
};

window.openModal = function() {
  if (!window.isAdmin()) return;
  const mbg = document.getElementById('modalBg');
  if (mbg) mbg.classList.add('open');
  setTimeout(() => document.getElementById('albumNameInput')?.focus(), 80);
};
window.closeModal = function() {
  const mbg = document.getElementById('modalBg');
  if (mbg) mbg.classList.remove('open');
  const input = document.getElementById('albumNameInput');
  if (input) input.value = '';
};
window.createAlbum = async function() {
  if (!window.isAdmin()) return;
  const input = document.getElementById('albumNameInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { toast('Album name cannot be empty', 'error'); return; }
  const { data, error } = await supabase.from('albums').insert({ name }).select();
  if (error) { toast(`Error: ${error.message}`, 'error'); return; }
  if (data && data.length > 0) {
    window.closeModal();
    await window.renderAlbums();
    window.openLightbox(data[0].id);
  } else { toast('Failed to create album.', 'error'); }
};
window.deleteAlbum = async function(id) {
  if (!window.isAdmin()) return;
  const { data: album } = await supabase.from('albums').select('name').eq('id', id).single();
  if (!confirm(`Delete album "${album?.name || 'this album'}" and all its photos?`)) return;
  const { data: photos } = await supabase.from('images').select('image_url').eq('album_id', id);
  if (photos?.length) {
    await Promise.all(photos.map(photo => deleteStoredImage(photo.image_url)));
    await supabase.from('images').delete().eq('album_id', id);
  }
  const { error: albumDelErr } = await supabase.from('albums').delete().eq('id', id);
  if (albumDelErr) { toast('Failed to delete album', 'error'); return; }
  toast('Album removed', 'success');
  window.renderAlbums();
};
window.openLightbox = async function(id) {
  currentAlbumId = id;
  const { data: album } = await supabase.from('albums').select('name').eq('id', id).single();
  const nameEl = document.getElementById('lbName');
  if (nameEl) nameEl.textContent = (album?.name || 'Album').toUpperCase();
  document.body.style.overflow = 'hidden';
  await renderPhotos();
  document.getElementById('lightbox')?.classList.add('open');
};
window.closeLightbox = function() {
  document.getElementById('lightbox')?.classList.remove('open');
  document.body.style.overflow = '';
  currentAlbumId = null;
  window.renderAlbums();
};
async function renderPhotos() {
  if (!currentAlbumId) return;
  const { data: photos, error } = await supabase
    .from('images').select('*').eq('album_id', currentAlbumId).order('created_at', { ascending: true });
  if (error) return;
  const grid  = document.getElementById('photosGrid');
  const empty = document.getElementById('lbEmpty');
  const count = document.getElementById('lbCount');
  if (count) count.textContent = `${photos.length} photo${photos.length !== 1 ? 's' : ''}`;
  if (!photos.length) {
    if (grid) grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  const admin = window.isAdmin();
  if (grid) {
    grid.innerHTML = '';
    photos.forEach((photo, i) => {
      const urlParts = photo.image_url.split('/');
      const fileName = decodeURIComponent(urlParts[urlParts.length - 1].replace(/^\d+_/, ''));
      const item = document.createElement('div');
      item.className = 'photo-item';
      const adminActions = admin
        ? `<button class="photo-btn dl"  onclick="event.stopPropagation();window.downloadPhoto('${photo.image_url}','${window.es(fileName)}')">Download</button>
           <button class="photo-btn del" onclick="event.stopPropagation();window.deletePhoto('${photo.id}','${photo.image_url}')">Remove</button>`
        : `<button class="photo-btn dl"  onclick="event.stopPropagation();window.downloadPhoto('${photo.image_url}','${window.es(fileName)}')">Download</button>`;
      item.innerHTML = `<img src="${photo.image_url}" alt="${window.es(fileName)}"${imageLoadAttr()}><div class="photo-actions">${adminActions}</div>`;
      item.querySelector('img').onclick = () => openViewer(i, photos);
      grid.appendChild(item);
    });
  }
}
window.addPhotos = async function(e) {
  if (!window.isAdmin()) return;
  const files = Array.from(e.target.files);
  if (!files.length || !currentAlbumId) return;
  const albumId = currentAlbumId;
  toast(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}...`, 'info');
  const uploads = await Promise.all(files.map(async (file, index) => {
    const prepared = await compressImageForUpload(file, { maxDimension: 1400, quality: 0.76 });
    const safeName = prepared.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    try {
      const publicUrl = await uploadFileToR2(prepared.file, `albums/${albumId}`, `${index}_${safeName}`);
      return { album_id: albumId, image_url: publicUrl };
    } catch (error) {
      return { error: error.message };
    }
  }));
  const rows = uploads.filter(item => !item.error);
  const failures = uploads.length - rows.length;
  if (rows.length) {
    const { error } = await supabase.from('images').insert(rows);
    if (error) { toast(`Upload saved to storage but database failed: ${error.message}`, 'error'); return; }
  }
  e.target.value = '';
  await renderPhotos();
  window.renderAlbums();
  toast(failures ? `${rows.length} uploaded, ${failures} failed` : `${rows.length} photo${rows.length === 1 ? '' : 's'} uploaded`, failures ? 'error' : 'success');
};
window.deletePhoto = async function(id, imageUrl) {
  if (!window.isAdmin()) return;
  if (!confirm('Remove this photo?')) return;
  await deleteStoredImage(imageUrl);
  await supabase.from('images').delete().eq('id', id);
  await renderPhotos();
  window.renderAlbums();
};
function isMobileDownloadTarget() {
  const ua = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || touchMac;
}
function openDownloadUrl(url) {
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) window.location.href = url;
}
window.downloadPhoto = async function(url, name) {
  const fileName = name || 'photo.jpg';
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!res.ok) throw new Error('Download request failed');
    const blob = await res.blob();
    const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
    if (isMobileDownloadTarget()) {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
        return;
      }
      const mobileUrl = URL.createObjectURL(blob);
      openDownloadUrl(mobileUrl);
      setTimeout(() => URL.revokeObjectURL(mobileUrl), 60000);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    openDownloadUrl(url);
  }
};
function openViewer(i, photos) {
  viewerPhotos = photos;
  viewerIndex  = i;
  showViewerPhoto();
  const viewer = document.getElementById('viewer');
  if (viewer) {
    viewer.classList.toggle('single-photo', viewerPhotos.length <= 1);
    viewer.classList.add('open');
  }
}
function showViewerPhoto() {
  const photo = viewerPhotos[viewerIndex];
  const img   = document.getElementById('viewerImg');
  const cnt   = document.getElementById('viewerCounter');
  if (img) {
    img.dataset.fallbackApplied = 'false';
    img.src = photo.image_url;
  }
  if (cnt) cnt.textContent = `${viewerIndex + 1} / ${viewerPhotos.length}`;
}
window.closeViewer  = function() {
  const viewer = document.getElementById('viewer');
  viewer?.classList.remove('open', 'single-photo');
};
window.viewerNav    = function(dir) {
  if (!viewerPhotos.length) return;
  viewerIndex = (viewerIndex + dir + viewerPhotos.length) % viewerPhotos.length;
  showViewerPhoto();
};
window.downloadCurrent = function() {
  const photo = viewerPhotos[viewerIndex];
  if (!photo) return;
  const parts = photo.image_url.split('/');
  window.downloadPhoto(photo.image_url, decodeURIComponent(parts[parts.length - 1].replace(/^\d+_/, '')));
};


//  RESULTS ENGINE


let activeEvent = null;
let activeDist  = null;

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 3200);
}

function setProgress(show, text = 'Processing PDF...') {
  const o = document.getElementById('progressOverlay');
  if (!o) return;
  if (show) { o.classList.add('show'); document.getElementById('progressText').textContent = text; }
  else o.classList.remove('show');
}

function timeToSeconds(raw) {
  const parts = String(raw || '').replace(/[h.]/gi, ':').split(':').map(n => parseInt(n, 10));
  if (parts.some(Number.isNaN)) return Number.MAX_SAFE_INTEGER;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function cleanAthleteName(name) {
  return String(name || '')
    .replace(/\b\d{2}\s*[-–]\s*\d{2}\s*[A-Z]?\b/gi, '')
    .replace(/\b(?:U\d{2}|SUB23|OPEN|SENIOR|JUNIOR|VETERAN|MASTERS)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const CLUB_SUFFIXES = new Set([
  'ACH', 'BESTMED', 'CHARLO', 'IKHAMVA', 'MUIRITE', 'NEDBANK',
  'TUKKIES', 'EMERIS', 'VULO', 'VWAC', 'KOWIE', 'PEAAC', 'PEA',
  'MADIBA', 'XCEL', 'WALMER', 'TEMP', 'ELITEAC', 'MOTHERWELL',
  'RUN4CHRIST', 'RUN4C', 'CRUSADERS', 'CSEP', 'DESPATCH',
  '32GI', 'ABSAEP', 'ALBANY', 'ATLANTIC', 'BATHURST', 'CHEETAHS',
  'CHILLIEP', 'CRUSADE', 'HOLLY', 'HOLLYWOO', 'MADIBAZ', 'MBIZANA',
  'MOTHER', 'NEDBOR', 'NEDRCAGN', 'NEDWPA', 'NOCLUB', 'OLDSELB',
  'ORMAMBA', 'OUTENH', 'PAR', 'POWER', 'REALGIJ', 'SANDFEP', 'SAPPE',
  'SAPSTR', 'SCHOOL', 'SIBALEKA', 'STEL', 'TRANSNET', 'TUT', 'VITALITY',
  'VOLO', 'VUKANI', 'WATER', 'YOUTH', 'UNKNOWN', 'KHULANI', 'ENTSIA',
  'ENTSIKA', 'KENYA', 'MALABAR'
]);

function splitClubFromName(athlete) {
  const name = cleanAthleteName(athlete.name);
  const currentClub = String(athlete.club || '').trim();
  if (currentClub && currentClub.toLowerCase() !== 'unattached') return { ...athlete, name };

  const parts = name.split(/\s+/);
  if (parts.length < 3) return { ...athlete, name, club: currentClub || 'Unattached' };

  const suffix = parts[parts.length - 1].toUpperCase();
  if (!CLUB_SUFFIXES.has(suffix)) return { ...athlete, name, club: currentClub || 'Unattached' };

  return {
    ...athlete,
    name: parts.slice(0, -1).join(' '),
    club: ['NOCLUB', 'UNKNOWN'].includes(suffix) ? 'Unattached' : suffix
  };
}

function normalizeAthletesForDisplay(athletes = []) {
  return athletes
    .map(splitClubFromName)
    .sort((a, b) => timeToSeconds(a.time) - timeToSeconds(b.time))
    .map((a, i) => ({ ...a, pos: i + 1 }));
}

async function saveResultsToSupabase(raceName, distance, athletes) {
  await supabase.from('race_results').delete().match({ race_name: raceName, distance });
  const { error } = await supabase.from('race_results').insert({ race_name: raceName, distance, athletes });
  if (error) throw error;
}

async function reloadResultsCache() {
  const { data, error } = await supabase
    .from('race_results').select('*').order('created_at', { ascending: true });
  if (error) { console.error('reloadResultsCache:', error); return; }
  raceResults = data.map(row => ({
    id:       row.id,
    raceName: row.race_name,
    distance: row.distance,
    athletes: normalizeAthletesForDisplay(typeof row.athletes === 'string' ? JSON.parse(row.athletes) : row.athletes)
  }));
}

function getResultsEvents() {
  const map = new Map();
  raceResults.forEach(r => {
    if (!map.has(r.raceName)) map.set(r.raceName, []);
    map.get(r.raceName).push(r);
  });
  const events = [];
  map.forEach((races, name) => events.push({ name, races }));
  return events;
}

function renderResultsSidebar() {
  const list = document.getElementById('eventList');
  if (!list) return;
  const events = getResultsEvents();
  const count  = document.getElementById('eventCount');
  if (count) count.textContent = `${events.length} event${events.length !== 1 ? 's' : ''} uploaded`;
  if (!events.length) {
    list.innerHTML = `<div class="no-events"><div class="no-events-icon">Flag</div><p>No events yet.</p></div>`;
    return;
  }
  const admin = window.isAdmin();
  list.innerHTML = '';
  events.forEach(ev => {
    const isActive      = ev.name === activeEvent;
    const totalAthletes = ev.races.reduce((s, r) => s + (r.athletes?.length || 0), 0);
    const card = document.createElement('div');
    card.className = 'event-card' + (isActive ? ' active' : '');
    const delBtn = admin
      ? `<button class="event-del" title="Delete event" onclick="event.stopPropagation();window.deleteEvent('${window.es(ev.name)}')">Remove</button>`
      : '';
    card.innerHTML = `
      <div class="event-card-head">
        <div class="event-card-name">${window.es(ev.name)}</div>
        ${delBtn}
      </div>
      <div class="event-card-dists">
        ${ev.races.map(r => `<span class="dist-pill">${r.distance}</span>`).join('')}
      </div>
      <div class="event-card-meta">${totalAthletes} athletes - ${ev.races.length} distance${ev.races.length !== 1 ? 's' : ''}</div>`;
    card.onclick = () => openResultsEvent(ev.name);
    list.appendChild(card);
  });
}

function openResultsEvent(name) {
  activeEvent = name;
  const ev = getResultsEvents().find(e => e.name === name);
  if (!ev) return;
  const distNames = ev.races.map(r => r.distance);
  if (!distNames.includes(activeDist)) activeDist = distNames[0];
  renderResultsSidebar();
  renderResultsPanel(ev);
}

function renderResultsPanel(ev) {
  const panel = document.getElementById('resultsPanel');
  if (!panel) return;
  document.getElementById('emptyState')?.remove();
  let viewContainer = panel.querySelector('.event-results-view');
  if (!viewContainer) {
    panel.innerHTML = `<div class="event-results-view"></div>`;
    viewContainer = panel.querySelector('.event-results-view');
  }
  viewContainer.style.display = 'block';
  const totalAthletes = ev.races.reduce((s, r) => s + (r.athletes?.length || 0), 0);
  const admin = window.isAdmin();
  const removeDistBtnHtml = admin
    ? `<button class="del-race-btn" onclick="window.deleteDistFromEvent('${window.es(ev.name)}','${activeDist}')">Remove ${activeDist}</button>`
    : '';
  viewContainer.innerHTML = `
    <div class="event-header">
      <div class="event-header-left">
        <div class="event-header-lbl">Eastern Province Athletics</div>
        <div class="event-header-name">${window.es(ev.name)}</div>
        <div class="event-header-total">${totalAthletes} total athletes across ${ev.races.length} distance${ev.races.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
    <div class="dist-tabs" id="distTabs">
      ${ev.races.map(r => `
        <div class="dist-tab${r.distance === activeDist ? ' active' : ''}" onclick="window.selectResultsDist('${r.distance}')">
          ${r.distance.toUpperCase().includes('KM') ? r.distance.toUpperCase() : r.distance + 'KM'}
          <span class="dist-tab-count">${r.athletes?.length || 0}</span>
        </div>`).join('')}
    </div>
    <div class="controls">
      <div class="search-wrap">
        <span class="search-ic"></span>
        <input type="text" id="searchInput" placeholder="Search athlete by name...">
        <button class="search-clear" id="searchClear" style="display:none" onclick="window.clearResultsSearch()">Clear</button>
      </div>
      <div class="results-count" id="resultsCount"></div>
      ${removeDistBtnHtml}
    </div>
    <div id="tableWrap"></div>`;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.addEventListener('input', window.doResultsSearch);
  renderResultsTable();
}

window.selectResultsDist = function(dist) {
  activeDist = dist;
  const ev = getResultsEvents().find(e => e.name === activeEvent);
  if (ev) renderResultsPanel(ev);
};

function renderResultsTable() {
  const wrap = document.getElementById('tableWrap');
  if (!wrap) return;
  const ev   = getResultsEvents().find(e => e.name === activeEvent);
  if (!ev) return;
  const race = ev.races.find(r => r.distance === activeDist);
  if (!race || !race.athletes) { wrap.innerHTML = ''; return; }
  const q        = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const orderedAthletes = [...race.athletes]
    .sort((a, b) => (parseInt(a.pos) || 999999) - (parseInt(b.pos) || 999999))
    .map((a, i) => ({ ...a, displayPos: parseInt(a.pos) || i + 1 }));
  const filtered = orderedAthletes.filter(a => [a.name, a.club, a.cat, a.time].some(v => String(v || '').toLowerCase().includes(q)));
  const countEl  = document.getElementById('resultsCount');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${race.athletes.length}`;
  const posClass = pos => {
    const p = parseInt(pos);
    if (p === 1) return 'pos-1'; if (p === 2) return 'pos-2'; if (p === 3) return 'pos-3';
    return '';
  };
  const hlName = (name, query) => {
    if (!query) return window.es(name);
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return window.es(name).replace(re, '<mark style="background:rgba(255,220,0,0.4);border-radius:2px;padding:0 1px">$1</mark>');
  };
  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="rtbl">
        <thead>
          <tr><th>Pos</th><th>Athlete</th><th>Club</th><th>Cat</th><th>Time</th></tr>
        </thead>
        <tbody>
          ${filtered.length ? filtered.map(a => `
            <tr>
              <td><span class="pos-cell ${posClass(a.displayPos)}">${window.es(String(a.displayPos))}</span></td>
              <td class="name-cell">${hlName(a.name, q)}</td>
              <td class="club-cell">${window.es(a.club)}</td>
              <td>${window.es(a.cat)}</td>
              <td class="time-cell">${window.es(a.time)}</td>
            </tr>`).join('') : `
            <tr><td colspan="5" style="text-align:center;padding:40px;color:var(--mu);font-style:italic;">
              ${q ? `No athletes matching "${window.es(q)}"` : 'No results in this distance'}
            </td></tr>`}
        </tbody>
      </table>
    </div>`;
}

window.doResultsSearch = function() {
  const q = document.getElementById('searchInput')?.value || '';
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
  renderResultsTable();
};
window.clearResultsSearch = function() {
  const inp = document.getElementById('searchInput');
  if (inp) inp.value = '';
  window.doResultsSearch();
};

window.deleteEvent = async function(name) {
  if (!window.isAdmin()) return;
  if (!confirm(`Delete ALL results for "${name}"? This cannot be undone.`)) return;
  const { error } = await supabase.from('race_results').delete().eq('race_name', name);
  if (error) { toast('Error deleting event', 'error'); return; }
  raceResults = raceResults.filter(r => r.raceName !== name);
  if (activeEvent === name) { activeEvent = null; activeDist = null; }
  const events = getResultsEvents();
  if (events.length && !activeEvent) {
    activeEvent = events[0].name;
    activeDist  = events[0].races[0]?.distance || null;
  }
  renderResultsSidebar();
  if (activeEvent) {
    const ev = getResultsEvents().find(e => e.name === activeEvent);
    if (ev) renderResultsPanel(ev);
  } else {
    const panel = document.getElementById('resultsPanel');
    if (panel) panel.innerHTML = `<div class="empty-state" id="emptyState"><div class="empty-icon">Flag</div><div class="empty-title">No Results Yet</div><p class="empty-sub">Upload a PDF results file above.</p></div>`;
  }
  toast('Event deleted', 'info');
};

window.deleteDistFromEvent = async function(name, dist) {
  if (!window.isAdmin()) return;
  if (!confirm(`Remove ${dist} from "${name}"?`)) return;
  const { error } = await supabase.from('race_results').delete().match({ race_name: name, distance: dist });
  if (error) { toast('Error removing distance', 'error'); return; }
  raceResults = raceResults.filter(r => !(r.raceName === name && r.distance === dist));
  const ev = getResultsEvents().find(e => e.name === name);
  if (!ev) {
    activeEvent = null; activeDist = null;
    renderResultsSidebar();
    const panel = document.getElementById('resultsPanel');
    if (panel) panel.innerHTML = `<div class="empty-state" id="emptyState"><div class="empty-icon">Flag</div><div class="empty-title">No Results Yet</div></div>`;
    return;
  }
  activeDist = ev.races[0]?.distance || null;
  renderResultsSidebar();
  renderResultsPanel(ev);
  toast(`${dist} removed`, 'info');
};


//  PDF UPLOAD CONTROLS (Admin only)


window.onFileChange = function(input) {
  if (!window.isAdmin()) return;
  const lbl = document.getElementById('upFileLbl');
  if (!lbl) return;
  if (input.files?.[0]) {
    const n = input.files[0].name;
    lbl.textContent = 'PDF ' + (n.length > 22 ? n.slice(0, 19) + '...' : n);
  } else {
    lbl.textContent = 'Choose PDF';
  }
};

window.eraseAll = async function() {
  if (!window.isAdmin()) return;
  if (!confirm('Wipe ALL race results? This cannot be undone.')) return;
  const { error } = await supabase.from('race_results').delete().not('id', 'is', null);
  if (error) { toast('Error clearing results', 'error'); return; }
  raceResults = [];
  activeEvent = null; activeDist = null;
  renderResultsSidebar();
  const panel = document.getElementById('resultsPanel');
  if (panel) panel.innerHTML = `<div class="empty-state" id="emptyState"><div class="empty-icon">Flag</div><div class="empty-title">No Results Yet</div></div>`;
  toast('All results cleared', 'info');
};

window.doUpload = async function() {
  if (!window.isAdmin()) { toast('Admin access required to upload results.', 'error'); return; }
  const raceNameInput = document.getElementById('upRaceName');
  const distSelect    = document.getElementById('upDist');
  const fileInput     = document.getElementById('upFile');
  if (!raceNameInput || !distSelect || !fileInput) return;
  const raceName = raceNameInput.value.trim();
  const distance = distSelect.value.trim();
  const file     = fileInput.files[0];
  if (!raceName) { toast('Enter an event name first', 'error'); return; }
  if (!file)     { toast('Select a PDF file first',   'error'); return; }
  const existing = raceResults.find(r => r.raceName === raceName && r.distance === distance);
  if (existing && !confirm(`"${raceName}" already has ${distance} results. Replace them?`)) return;
  setProgress(true, 'Reading PDF...');
  const reader = new FileReader();
  reader.onload = async function() {
    try {
      const typedarray = new Uint8Array(this.result);
      const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
      setProgress(true, `Scanning ${pdf.numPages} page${pdf.numPages !== 1 ? 's' : ''}...`);
      let rawText = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const page    = await pdf.getPage(p);
        const content = await page.getTextContent();
        const items = content.items
          .map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5] }))
          .filter(item => item.text && item.text.trim())
          .sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x);
        let lastY = null, pageText = '';
        items.forEach(item => {
          if (lastY !== null && Math.abs(item.y - lastY) > 3) pageText += '\n';
          pageText += item.text + ' ';
          lastY = item.y;
        });
        rawText += pageText + '\n';
      }
      setProgress(true, 'Parsing results...');
      const athletes = parseResultsPDF(rawText, distance);
      setProgress(false);
      if (!athletes.length) {
        toast('Parsing failed - no runner sequences detected in this PDF layout.', 'error');
        return;
      }
      await saveResultsToSupabase(raceName, distance, athletes);
      raceResults = raceResults.filter(r => !(r.raceName === raceName && r.distance === distance));
      raceResults.push({ id: 'r' + Date.now(), raceName, distance, athletes });
      raceNameInput.value = '';
      fileInput.value = '';
      document.getElementById('upFileLbl').textContent = 'Choose PDF';
      activeEvent = raceName;
      activeDist  = distance;
      renderResultsSidebar();
      const ev = getResultsEvents().find(e => e.name === raceName);
      if (ev) renderResultsPanel(ev);
      toast(`Import complete - ${raceName} - ${distance} - ${athletes.length} athletes`, 'success');
    } catch (err) {
      setProgress(false);
      toast('Error: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
};


//  PDF RESULTS PARSER  FULL EP CLUB DICTIONARY

function parseResultsPDF(rawText, distance) {

  // COMPLETE EP CLUB DICTIONARY
  // Ordered longest-first so multi-word names match before sub-strings.
  const CLUBS = [
 // Multi-word / full names first
    'PEA AC', 'NEDBANK RC', 'ELITEAC', 'ELITE AC',
    'RUN4COMMUNITY', 'RUN 4 COMMUNITY', 'RUN 4 CHRIST', 'RUN4CHRIST',
    'TEAM VITALITY', 'TEAMVITALITY',
    'BLUE BAY', 'MADIBA AC', 'XCEL AC', 'KOWIE AC',
    'CHILLI PEPPER', 'CHILLIE PEPPER',
    'REAL GIJIMANI', 'REALGIJ',
    'SANDFLEP', 'SANDFEP', 'SAPSTR',
    'ACT AC', 'UCT AC', 'CAPE AC',
    'NEW BRIGHTON', 'ST FRANCIS',
    'OLD MUTUAL', 'STANDARD BANK',
 // Abbreviations & short codes  alphabetical within group
    '32GI',
    'ABSA', 'ABSAEP',
    'ACH', 'ACT', 'ADVEN', 'ALBANY', 'ASICS', 'ASPEN', 'ATLANTIC',
    'BALEKANI', 'BATHURST', 'BESTMED', 'BLUEBAY', 'BODYCON', 'BRACKEN',
    'CHARLO', 'CHEETAHS', 'CHILLIEP', 'CLICKS', 'CSCG', 'CSEP', 'CRUSADE', 'CRUSADERS',
    'DEAT', 'DESPATCH', 'DISCHEM',
    'ELITEAC', 'EMERIS', 'ENDURO', 'ENDUROCAD', 'ENTSIKA',
    'FNB',
    'GELVAN', 'GRIQUAS',
    'HARRIERS', 'HEATAC', 'HELDERBERG', 'HOLLYWOO', 'HOLLY',
    'IDC', 'IKHAMVA', 'INFINITY', 'ITHEKO',
    'JBAY', 'JUBILEE', 'JUSTICE',
    'KAPOK', 'KENYA', 'KHULANI', 'KOMANIR', 'KOWIE', 'KWAZAKHELE',
    'MADIBA', 'MADIBAZ', 'MALABAR', 'MBIZANA', 'MIWAY', 'MOMENTUM', 'MOTHERWELL', 'MOTHER', 'MPOX', 'MTHATHA', 'MUIRITE',
    'NEDBANK', 'NEDBOR', 'NEDRCAGN', 'NEDWPA', 'NOCLUB', 'NYANDEN',
    'OLDSELB', 'ORMAMBA', 'OUTENH',
    'PAR', 'PEAAC', 'PHUMLANI', 'PINELANDS', 'POWER',
    'RAC', 'RAF', 'REALGIJ', 'RUN4C',
    'SABC', 'SANLAM', 'SANLAMC', 'SANDF', 'SAPPE', 'SAPS', 'SAPSTR', 'SCHOOL', 'SIBALEKA', 'STEL', 'STRIDERS', 'STUT',
    'TEMP', 'TEMPO', 'TINARHA', 'TRANSNET', 'TUKKIES', 'TUT', 'TV',
    'UBUNYE', 'UNITY', 'UNKNOWN',
    'VITALITY', 'VODACOM', 'VOLO', 'VUKANI', 'VULO', 'VWAC',
    'WALMER', 'WATER',
    'XCEL',
    'YOUTH', 'ZWIDE',
    'ATH', 'AC',
    'UNATTACHED',
  ];

  // CATEGORY TOKENS
  const CAT_SET = new Set([
    'SM','SF','JM','JF','OM','OF','VM','VF','M','F',
    'OPEN','MEN','WOMEN','SENIOR','JUNIOR','VETERAN','MASTERS',
    'SUB23','U23','U20','U18','U16','U14',
    'MS','WS','MJ','WJ','MV','WV','MOV','WOV',
    'M40','M45','M50','M55','M60','M65','M70',
    'W40','W45','W50','W55','W60','W65','W70',
    'V40','V45','V50','V55','V60','V65','V70',
  ]);

  //  REGEX PATTERNS
  const TIME_RX = /\b(\d{1,2})[:.h](\d{2})(?:[:.m](\d{2}))?\b/;
  const POS_RX  = /^([HhWwMm]?)(\d{1,4})\.?$/;
  const LIC_RX  = /^\d{5,}$/;
  const AGE_CAT_RX = /^\d{2}\s*[-–]\s*\d{2}\s*[MF]?$/i;
  const SKIP_WORDS = new Set([
    'ATHLETE','ATHLETES','SURNAME','NAME','FIRSTNAME','LIC','LICENSE','LICENCE',
    'NO','BIB','POS','POSITION','CAT','CATEGORY','CLUB','TIME','FINISH',
    'GUN','NET','CHIP','RACE','RESULTS','PAGE','OF','THE','AND','FOR',
    'HMS','PTS','PRES','SEX','AGE','RNO','LICNO',
    'GALAXY','BINGO','SPONSORED','BY','RUN','WALK','HELPERS',
  ]);

  function normaliseTime(raw) {
    return raw.replace(/\./g, ':').replace(/h/gi, ':');
  }

  //  MAIN PARSE
  const lines    = rawText.split('\n');
  const athletes = [];

  // Detect if PDF uses explicit position column
  let explicitPosCount = 0;
  lines.forEach(line => {
    const first = line.trim().split(/\s+/)[0] || '';
    if (POS_RX.test(first) && !LIC_RX.test(first)) explicitPosCount++;
  });
  const useExplicitPos = explicitPosCount > 5;

  let sequentialPos = 1;

  lines.forEach(line => {
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.length < 5) return;

    const upperLine = cleanLine.toUpperCase();
    if (SKIP_WORDS.has(upperLine.split(/\s+/)[0])) return;
    if (upperLine.includes('GALAXY BINGO') || upperLine.match(/^PAGE\s+\d/)) return;

 // Must contain a time
    const timeMatch = cleanLine.match(TIME_RX);
    if (!timeMatch) return;
    const finishTime = normaliseTime(timeMatch[0]);

    const withoutTime = cleanLine.slice(0, timeMatch.index) + cleanLine.slice(timeMatch.index + timeMatch[0].length);
    const tokens = withoutTime.split(/\s+/).filter(t => t.length > 0);

    let explicitPos  = null;
    let category     = 'Open';
    let clubName     = 'Unattached';
    let nameTokens   = [];

 // Step 1 position from first token
    if (tokens.length > 0) {
      const posM = tokens[0].match(POS_RX);
      if (posM && !LIC_RX.test(tokens[0])) {
        explicitPos = parseInt(posM[2], 10);
        tokens.shift();
      }
    }

 // Step 2 remove licence/bib numbers
    const cleaned = tokens.filter(t => !LIC_RX.test(t));

 // Step 3  detect club (multi-word aware, longest first)
    const joinedUpper = cleaned.map(t => t.toUpperCase()).join(' ');
    let clubMatch = null;
    for (const club of CLUBS) {
      if (joinedUpper.includes(club)) { clubMatch = club; break; }
    }
    if (clubMatch) clubName = clubMatch;

 // Step 4 detect category token
    let catFound = '';
    const afterClubRemoval = cleaned.filter(t => {
      const u = t.toUpperCase();
      if (clubMatch) {
        const clubParts = clubMatch.split(' ');
        if (clubParts.some(cp => u === cp)) return false;
      }
      if (AGE_CAT_RX.test(u)) { catFound = u; return false; }
      if (CAT_SET.has(u)) { catFound = u; return false; }
      return true;
    });
    if (catFound) category = catFound;

 // Step 5  remaining tokens are the name
    nameTokens = afterClubRemoval.filter(t => {
      const u = t.toUpperCase();
      if (SKIP_WORDS.has(u)) return false;
      if (LIC_RX.test(t)) return false;
      if (AGE_CAT_RX.test(u)) return false;
      if (/^\d+$/.test(t)) return false;
      if (t.includes('+') || t.includes('=')) return false;
      if (/^[^A-Za-z]$/.test(t)) return false;
      return true;
    });

    const athleteName = nameTokens.join(' ').trim();
    if (!athleteName || nameTokens.length < 1 || nameTokens.length > 6) return;
    if (!/[A-Za-z]{2,}/.test(athleteName)) return;

    const finalPos = (useExplicitPos && explicitPos) ? explicitPos : sequentialPos;
    athletes.push({
      pos:  finalPos,
      name: athleteName,
      club: clubName,
      cat:  category,
      time: finishTime,
      dist: distance
    });
    sequentialPos = finalPos + 1;
  });

  // Deduplicate by name+time
  const seen = new Set();
  const deduped = athletes.filter(a => {
    const key = `${a.name.toLowerCase()}|${a.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return normalizeAthletesForDisplay(deduped);
}

//  RESULTS INIT

async function initResults() {
  await reloadResultsCache();
  renderResultsSidebar();
  const events = getResultsEvents();
  if (events.length) {
    activeEvent = events[0].name;
    activeDist  = events[0].races[0]?.distance || null;
    renderResultsPanel(events[0]);
  }
}


//  KEYBOARD SHORTCUTS


document.addEventListener('keydown', e => {
  const viewer  = document.getElementById('viewer');
  const lb      = document.getElementById('lightbox');
  const adminBg = document.getElementById('adminModalBg');

  if (viewer?.classList.contains('open')) {
    if (e.key === 'ArrowLeft')  window.viewerNav(-1);
    if (e.key === 'ArrowRight') window.viewerNav(1);
    if (e.key === 'Escape')     window.closeViewer();
  }
  if (lb?.classList.contains('open') && e.key === 'Escape') window.closeLightbox();
  if (adminBg?.classList.contains('open')) {
    if (e.key === 'Enter')  window.submitAdminLogin();
    if (e.key === 'Escape') window.closeAdminModal();
  }
});


//  DOM CONTENT LOADED  INIT EVERYTHING


document.addEventListener('DOMContentLoaded', () => {

  // Inject mobile styles immediately
  injectMobileStyles();

  // Restore admin state from sessionStorage
  applyAdminState();

  // Kick off page-specific renders
  if (document.getElementById('b3g'))        renderBig3();
  if (document.getElementById('rg'))         fetchLiveEPRaces();
  if (document.getElementById('trainingGrid')) window.renderTrainingRuns();
  if (document.getElementById('albumsGrid')) window.renderAlbums();
  if (document.getElementById('eventList'))  initResults();

  // Album modal keyboard support
  const albumInput = document.getElementById('albumNameInput');
  if (albumInput) {
    albumInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  window.createAlbum();
      if (e.key === 'Escape') window.closeModal();
    });
  }
});
