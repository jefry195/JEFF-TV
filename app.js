/**
 * JeffTV — app.js v3.1
 * HTML + Vanilla JS dipilih karena:
 *  - Tidak perlu build step (buka langsung di browser)
 *  - Lebih ringan & cepat untuk kasus ini
 *  - React lebih cocok untuk app kompleks dengan banyak shared state
 * Fitur:
 *  - Online/Offline detection via CORS proxy (cek M3U8 manifest nyata)
 *  - Auto-check saluran visible setelah load
 *  - Category/Country playlists dari PLAYLISTS.md
 *  - VLC-like HLS.js config
 */

'use strict';

// ════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════
const CFG = {
  // iptv-org playlist base URLs (from PLAYLISTS.md)
  PLAYLIST_BASE:    'https://iptv-org.github.io/iptv',
  // API endpoints
  CHANNELS_API:     'https://iptv-org.github.io/api/channels.json',
  STREAMS_API:      'https://iptv-org.github.io/api/streams.json',

  // CORS proxies (tried in order)
  PROXIES: [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://cors-anywhere.herokuapp.com/',
  ],

  // Pagination
  PAGE_SIZE: 48,

  // Stream check config
  CHECK_BATCH:    6,    // parallel checks per batch
  CHECK_TIMEOUT:  8000, // ms per stream check
  CHECK_DELAY:    300,  // ms between batches
  AUTO_CHECK_N:   30,   // auto-check this many visible channels on startup

  // All official categories from PLAYLISTS.md
  CATEGORIES: [
    'animation','auto','business','classic','comedy','cooking','culture',
    'documentary','education','entertainment','family','general',
    'kids','legislative','lifestyle','movies','music','news','outdoor',
    'public','relax','religious','science','series','shop','sports','travel','weather',
  ],

  // Category display names (Indonesian)
  CAT_LABELS: {
    animation:'Animasi', auto:'Otomotif', business:'Bisnis', classic:'Klasik',
    comedy:'Komedi', cooking:'Kuliner', culture:'Budaya', documentary:'Dokumenter',
    education:'Edukasi', entertainment:'Hiburan', family:'Keluarga', general:'Umum',
    kids:'Anak-Anak', legislative:'Legislatif', lifestyle:'Gaya Hidup',
    movies:'Film', music:'Musik', news:'Berita', outdoor:'Outdoor',
    public:'Publik', relax:'Relaksasi', religious:'Religi', science:'Sains',
    series:'Series', shop:'Belanja', sports:'Olahraga', travel:'Travel', weather:'Cuaca',
  },
};

// ════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════
const S = {
  all: [],           // all channels
  filtered: [],      // after filters
  page: 1,
  mode: 'api',       // 'api' | 'category' | 'country' | 'custom'
  country: '',
  category: '',
  categoryM3U: '',   // selected M3U category slug
  query: '',
  statusFilter: 'all', // 'all' | 'online' | 'offline'
  viewMode: 'grid',
  currentCh: null,
  hlsInst: null,
  retryN: 0,
  streamErrors: 0,
  nextIdx: 0,        // for "Next channel" button
  // Stream status cache: url -> 'online'|'offline'|'checking'|'unknown'
  streamStatus: JSON.parse(sessionStorage.getItem('jftv_status') || '{}'),
  favorites: [],
  history: [],
  aspectRatio: 'default',
  customPlaylistLoaded: false,
  checking: false,
  checkAbort: false,
};
try { S.favorites = JSON.parse(localStorage.getItem('jftv_favs') || '[]'); } catch(e) {}
try { S.history = JSON.parse(localStorage.getItem('jftv_history') || '[]'); } catch(e) {}

// ════════════════════════════════════════════
// DOM
// ════════════════════════════════════════════
let D = {};
function initDOM() {
  const q = id => document.getElementById(id);
  D = {
    splash:         q('splash-screen'),
    splashStatus:   q('splash-status'),
    app:            q('app'),
    sidebar:        q('sidebar'),
    sbOverlay:      q('sb-overlay'),
    sbToggle:       q('sidebar-toggle'),
    menuBtn:        q('menu-toggle'),
    searchInput:    q('search-input'),
    searchClear:    q('search-clear'),
    playlistTabs:   q('playlist-tabs'),
    countrySec:     q('country-sec'),
    countrySelect:  q('country-select'),
    catSec:         q('cat-sec'),
    catList:        q('category-list'),
    sfAll:          q('sf-all'),
    sfOnline:       q('sf-online'),
    sfOffline:      q('sf-offline'),
    checkBtn:       q('check-streams-btn'),
    checkWrap:      q('check-progress-wrap'),
    checkBar:       q('check-progress-bar'),
    checkTxt:       q('check-progress-text'),
    favList:        q('fav-list'),
    favCount:       q('fav-count'),
    totalChs:       q('total-channels'),
    totalCts:       q('total-countries'),
    statOnline:     q('stat-online'),
    // Main
    pageTitle:      q('page-title'),
    chCount:        q('ch-count'),
    onlineSummary:  q('online-summary'),
    onlineCount:    q('online-count'),
    offlineCount:   q('offline-count'),
    viewGrid:       q('view-grid'),
    viewList:       q('view-list'),
    // Hero
    hero:           q('hero'),
    // Player
    playerSec:      q('player-sec'),
    video:          q('video'),
    pLoading:       q('p-loading'),
    pLoadTxt:       q('p-loading-txt'),
    pError:         q('p-error'),
    pErrMsg:        q('p-error-msg'),
    qualBadge:      q('quality-badge'),
    piLogo:         q('pi-logo'),
    piName:         q('pi-name'),
    piTags:         q('pi-tags'),
    favBtn:         q('fav-btn'),
    pipBtn:         q('pip-btn'),
    fsBtn:          q('fs-btn'),
    closePlayer:    q('close-player'),
    retryBtn:       q('retry-btn'),
    nextBtn:        q('next-btn'),           // error overlay: next
    prevErrBtn:     q('prev-err-btn'),       // error overlay: prev
    prevChBtn:      q('prev-ch-btn'),        // info bar: prev
    nextChBtn:      q('next-ch-btn'),        // info bar: next
    chPosition:     q('ch-position'),        // "5 / 120" indicator
    // Custom Playlist
    customPlaylistSec:      q('custom-playlist-sec'),
    m3uUrlInput:            q('m3u-url-input'),
    loadM3uUrlBtn:          q('load-m3u-url-btn'),
    m3uFileInput:           q('m3u-file-input'),
    customPlaylistInfo:     q('custom-playlist-info'),
    customChCount:          q('custom-ch-count'),
    clearCustomPlaylistBtn: q('clear-custom-playlist-btn'),
    // History
    clearHistoryBtn:        q('clear-history-btn'),
    historyList:            q('history-list'),
    // Aspect Ratio
    aspectBtn:              q('aspect-btn'),
    aspectLbl:              q('aspect-lbl'),
    // Channels
    skeleton:       q('skeleton'),
    empty:          q('empty'),
    grid:           q('ch-grid'),
    loadmoreWrap:   q('loadmore-wrap'),
    loadmoreBtn:    q('loadmore-btn'),
    loadmoreTxt:    q('loadmore-txt'),
  };
}

// ════════════════════════════════════════════
// FETCH HELPERS (with CORS proxy fallback)
// ════════════════════════════════════════════
async function fetchText(url, timeout = 30000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, mode: 'cors', cache: 'no-store' });
    clearTimeout(id);
    if (r.ok) return await r.text();
  } catch(e) { clearTimeout(id); }

  for (const px of CFG.PROXIES) {
    const ctrl2 = new AbortController();
    const id2 = setTimeout(() => ctrl2.abort(), timeout);
    try {
      const r = await fetch(px + encodeURIComponent(url), { signal: ctrl2.signal });
      clearTimeout(id2);
      if (r.ok) {
        const t = await r.text();
        if (t && t.length > 50) return t;
      }
    } catch(e) { clearTimeout(id2); }
  }
  throw new Error('fetch failed: ' + url);
}

async function fetchJSON(url, timeout = 30000) {
  const t = await fetchText(url, timeout);
  return JSON.parse(t);
}

// ════════════════════════════════════════════
// M3U PARSER
// ════════════════════════════════════════════
function parseM3U(txt) {
  const chs = [];
  const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln.startsWith('#EXTINF:')) continue;
    let url = '';
    for (let j = i+1; j < Math.min(i+5, lines.length); j++) {
      const nx = lines[j].trim();
      if (nx && !nx.startsWith('#')) { url = nx; i = j-1; break; }
    }
    if (!url) continue;
    const ch = parseExtInf(ln, url);
    if (ch) chs.push(ch);
  }
  return chs;
}

function parseExtInf(ln, url) {
  const nm = ln.match(/,([^,\r\n]+)$/);
  const name = nm ? nm[1].trim() : '';
  if (!name) return null;

  const attrs = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(ln)) !== null) attrs[m[1].toLowerCase()] = m[2];

  let country = (attrs['tvg-country'] || '').split(',')[0].toUpperCase().trim().replace(/^C\//,'');
  if (country.length > 3) country = '';

  const grpRaw = (attrs['group-title'] || '').trim();
  // Filter adult
  if (/xxx|adult|18\+|porn|erotic/i.test(grpRaw + name)) return null;

  return {
    id:       attrs['tvg-id'] || '',
    name,
    logo:     attrs['tvg-logo'] || '',
    group:    grpRaw || 'General',
    groupSlug: grpRaw.toLowerCase(),
    country,
    language: attrs['tvg-language'] || '',
    url,
  };
}

// ════════════════════════════════════════════
// DATA LOADERS
// ════════════════════════════════════════════

/* Load via API (channels.json + streams.json) */
async function loadAPI() {
  setSplashStatus('Memuat data saluran TV...');
  const [chData, stData] = await Promise.all([
    fetchJSON(CFG.CHANNELS_API),
    fetchJSON(CFG.STREAMS_API),
  ]);
  setSplashStatus(`Memproses ${stData.length.toLocaleString()} stream...`);

  const chMap = {};
  chData.forEach(c => { chMap[c.id] = c; });

  const seen = new Set();
  const result = [];
  for (const st of stData) {
    if (!st.url || !st.channel) continue;
    if (seen.has(st.url)) continue;
    seen.add(st.url);

    const meta = chMap[st.channel] || {};
    if (meta.is_nsfw) continue;

    let country = '';
    if (meta.broadcast_area?.length) {
      const a = meta.broadcast_area[0];
      if (a.startsWith('c/')) country = a.slice(2).toUpperCase();
    }
    if (!country && meta.country) country = meta.country.toUpperCase();

    const cats = meta.categories || [];
    const groupSlug = cats[0] || 'general';
    const group = CFG.CAT_LABELS[groupSlug] || groupSlug;

    result.push({
      id: st.channel,
      name: meta.name || st.channel,
      logo: meta.logo || '',
      group,
      groupSlug,
      country,
      language: (meta.languages || [])[0] || '',
      url: st.url,
    });
    if (result.length >= 12000) break;
  }
  return result;
}

/* Load by country M3U */
async function loadCountryM3U(code) {
  const url = `${CFG.PLAYLIST_BASE}/countries/${code.toLowerCase()}.m3u`;
  setSplashStatus(`Memuat playlist ${code}...`);
  const txt = await fetchText(url);
  if (!txt.includes('#EXTINF')) throw new Error('Invalid M3U');
  const chs = parseM3U(txt);
  // Fix missing country
  return chs.map(c => ({ ...c, country: c.country || code.toUpperCase() }));
}

/* Load by category M3U */
async function loadCategoryM3U(slug) {
  const url = `${CFG.PLAYLIST_BASE}/categories/${slug}.m3u`;
  setSplashStatus(`Memuat kategori ${slug}...`);
  const txt = await fetchText(url);
  if (!txt.includes('#EXTINF')) throw new Error('Invalid M3U');
  return parseM3U(txt);
}

/* Deduplicate & sort */
function processChannels(chs) {
  const seen = new Set();
  const out = [];
  for (const c of chs) {
    if (!c.url || !c.name) continue;
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push({
      ...c,
      name: c.name.trim(),
      country: (c.country||'').toUpperCase().trim(),
      statusKey: S.streamStatus[c.url] || 'unknown',
    });
  }
  // Sort: Indonesia → other by name
  out.sort((a, b) => {
    if (a.country==='ID' && b.country!=='ID') return -1;
    if (b.country==='ID' && a.country!=='ID') return 1;
    return a.name.localeCompare(b.name, 'id');
  });
  return out;
}

/* Fallback channels when everything fails */
function fallbackChannels() {
  return [
    {id:'tvri', name:'TVRI', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/TVRI_2019_logo.svg/200px-TVRI_2019_logo.svg.png', group:'Berita', groupSlug:'news', country:'ID', url:'https://d2jqqhyy3swgs1.cloudfront.net/out/v1/7d4b8fe08b664abb8d80ff5deb1f8bb8/index.m3u8'},
    {id:'rcti', name:'RCTI', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/RCTI_logo.svg/200px-RCTI_logo.svg.png', group:'Hiburan', groupSlug:'entertainment', country:'ID', url:'https://streaming.rctiplus.com/4/master.m3u8'},
    {id:'mnctv', name:'MNCTV', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/New_MNCTV_logo.svg/200px-New_MNCTV_logo.svg.png', group:'Hiburan', groupSlug:'entertainment', country:'ID', url:'https://streaming.rctiplus.com/6/master.m3u8'},
    {id:'gtv', name:'GTV', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/GTV_2019.svg/200px-GTV_2019.svg.png', group:'Hiburan', groupSlug:'entertainment', country:'ID', url:'https://streaming.rctiplus.com/1/master.m3u8'},
    {id:'metro', name:'Metro TV', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Metro_TV_logo.svg/200px-Metro_TV_logo.svg.png', group:'Berita', groupSlug:'news', country:'ID', url:'https://streaming4.metro.tv/live/smil:metrotv.smil/chunklist.m3u8'},
    {id:'cnnidn', name:'CNN Indonesia', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/CNN_Indonesia.svg/200px-CNN_Indonesia.svg.png', group:'Berita', groupSlug:'news', country:'ID', url:'https://cnidn-livedai.akamaized.net/hls/live/2038028/cnn_id/master.m3u8'},
    {id:'tvone', name:'tvOne', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Tvone_2017.svg/200px-Tvone_2017.svg.png', group:'Berita', groupSlug:'news', country:'ID', url:'https://live.tvone.co.id/stream/live.m3u8'},
    {id:'trans7', name:'Trans 7', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Trans7.svg/200px-Trans7.svg.png', group:'Hiburan', groupSlug:'entertainment', country:'ID', url:'https://streaming2.transtv.co.id:1936/trans7/trans7/playlist.m3u8'},
    {id:'transtv', name:'Trans TV', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Trans_TV.svg/200px-Trans_TV.svg.png', group:'Hiburan', groupSlug:'entertainment', country:'ID', url:'https://streaming2.transtv.co.id:1936/transtv/transtv/playlist.m3u8'},
    {id:'indosiar', name:'Indosiar', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Indosiar.svg/200px-Indosiar.svg.png', group:'Hiburan', groupSlug:'entertainment', country:'ID', url:'https://5d7b87b22f85a.streamlock.net:443/indosiar/indosiar/playlist.m3u8'},
    {id:'bbc', name:'BBC World', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/BBC_World_News_2022.svg/200px-BBC_World_News_2022.svg.png', group:'Berita', groupSlug:'news', country:'GB', url:'https://vs-hls-push-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_world_service/pc_hd.m3u8'},
    {id:'aljazeera', name:'Al Jazeera', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Al_Jazeera_Logo.svg/200px-Al_Jazeera_Logo.svg.png', group:'Berita', groupSlug:'news', country:'QA', url:'https://live-hls-web-aje.getaj.net/AJE/index.m3u8'},
  ];
}

// ════════════════════════════════════════════
// STREAM STATUS CHECKER
// ════════════════════════════════════════════

/* Check single stream (try HEAD then GET range) */
/**
 * Cek status stream yang BENAR:
 * - Untuk HLS (.m3u8): fetch manifest via CORS proxy, validasi isinya
 * - Untuk non-HLS: coba direct fetch dengan timeout
 * Tidak menggunakan mode:'no-cors' karena selalu berhasil (tidak akurat)
 */
async function checkStreamURL(url) {
  const timeout = CFG.CHECK_TIMEOUT;
  const isHLS = /\.m3u8/i.test(url);

  if (isHLS) {
    // Cara paling akurat: fetch manifest via CORS proxy lalu cek isinya
    for (const proxy of CFG.PROXIES) {
      try {
        const ctrl = new AbortController();
        const id = setTimeout(() => ctrl.abort(), timeout);
        const r = await fetch(proxy + encodeURIComponent(url), {
          signal: ctrl.signal,
          headers: { 'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, */*' },
        });
        clearTimeout(id);
        if (r.ok) {
          const txt = await r.text();
          // Valid M3U8 harus mengandung tag ini
          if (txt.includes('#EXTM3U') || txt.includes('#EXT-X-') || txt.includes('EXTINF')) {
            return 'online';
          }
          // Response ada tapi bukan M3U8 valid
          return 'offline';
        }
        // HTTP error (403, 404, 500, dll) = offline
        if (r.status === 403 || r.status === 404 || r.status >= 500) return 'offline';
      } catch(e) {
        if (e.name === 'AbortError') return 'offline'; // Timeout = offline
        // Proxy error, coba proxy berikutnya
        continue;
      }
    }
    // Semua proxy gagal - mungkin blocked tapi bukan berarti offline
    // Coba direct dengan no-cors sebagai last resort
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 3000);
      await fetch(url, { method: 'HEAD', signal: ctrl.signal, mode: 'no-cors' });
      clearTimeout(id);
      return 'online'; // server merespons (opaque = tidak bisa baca isi)
    } catch(e) {
      return e.name === 'AbortError' ? 'offline' : 'offline';
    }
  } else {
    // Non-HLS: direct HEAD request
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), timeout);
      const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(id);
      return r.ok ? 'online' : 'offline';
    } catch(e) {
      // CORS block ≠ offline untuk direct streams
      if (e.name === 'AbortError') return 'offline';
      return 'online'; // CORS block tapi server ada
    }
  }
}

/* Background batch checker */
async function checkAllStreams(channels) {
  if (S.checking) return;
  S.checking = true;
  S.checkAbort = false;

  const total = channels.length;
  let done = 0;
  let online = 0;
  let offline = 0;

  D.checkWrap.classList.remove('hidden');
  D.checkBtn.disabled = true;
  D.checkBtn.textContent = '⏹ Hentikan';
  D.checkBtn.onclick = () => { S.checkAbort = true; };

  // Process in batches
  for (let i = 0; i < channels.length; i += CFG.CHECK_BATCH) {
    if (S.checkAbort) break;
    const batch = channels.slice(i, i + CFG.CHECK_BATCH);

    await Promise.all(batch.map(async ch => {
      // Update card to "checking"
      setCardStatus(ch.url, 'checking');
      const st = await checkStreamURL(ch.url);
      S.streamStatus[ch.url] = st;
      ch.statusKey = st;
      if (st === 'online') online++;
      else offline++;
      done++;
      setCardStatus(ch.url, st);

      // Update progress
      const pct = Math.round((done / total) * 100);
      D.checkBar.style.width = pct + '%';
      D.checkTxt.textContent = `${done}/${total} diperiksa • ${online} online • ${offline} offline`;
    }));

    await sleep(CFG.CHECK_DELAY);
  }

  // Save to session
  try { sessionStorage.setItem('jftv_status', JSON.stringify(S.streamStatus)); } catch(e) {}

  S.checking = false;
  D.checkBtn.disabled = false;
  D.checkBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
    Cek Ulang (${S.filtered.length > 200 ? '200' : S.filtered.length} saluran)
  `;
  D.checkBtn.onclick = () => startCheck();

  // Update stats
  updateOnlineSummary();
  D.statOnline.textContent = online;

  showToast(`✅ ${online} online, ❌ ${offline} offline dari ${done} saluran`);

  // If status filter active, re-render
  if (S.statusFilter !== 'all') applyFilters();
}

function setCardStatus(url, status) {
  const cards = document.querySelectorAll(`.ch-card[data-url="${CSS.escape(url)}"]`);
  cards.forEach(card => {
    const badge = card.querySelector('.card-status');
    if (!badge) return;
    badge.className = `card-status ${status}`;
    const dot = badge.querySelector('.status-dot');
    if (dot) {
      dot.className = `status-dot ${status}`;
    }
    const lbl = badge.querySelector('.status-lbl');
    if (lbl) {
      const lblMap = { online:'Online', offline:'Offline', checking:'Cek...', unknown:'' };
      lbl.textContent = lblMap[status] || '';
    }
    badge.style.display = status === 'unknown' ? 'none' : '';
  });
}

function updateOnlineSummary() {
  const vals = Object.values(S.streamStatus);
  const onN = vals.filter(v => v === 'online').length;
  const offN = vals.filter(v => v === 'offline').length;
  if (onN + offN > 0) {
    D.onlineSummary.classList.remove('hidden');
    D.onlineCount.textContent = onN;
    D.offlineCount.textContent = offN;
    D.statOnline.textContent = onN;
  }
}

// ════════════════════════════════════════════
// FILTER BUILDERS
// ════════════════════════════════════════════
function buildCountryFilter() {
  const cnt = {};
  S.all.forEach(c => {
    if (c.country?.length >= 2) cnt[c.country] = (cnt[c.country]||0)+1;
  });
  const sorted = Object.entries(cnt).sort((a,b) => {
    if (a[0]==='ID') return -1;
    if (b[0]==='ID') return 1;
    return b[1]-a[1];
  });
  D.countrySelect.innerHTML = '<option value="">🌍 Semua Negara</option>';
  sorted.forEach(([code, count]) => {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = `${flag(code)} ${CNAMES[code]||code} (${count})`;
    D.countrySelect.appendChild(o);
  });
  // Auto-select Indonesia
  if (cnt['ID']) {
    D.countrySelect.value = 'ID';
    S.country = 'ID';
  }
}

function buildCategoryFilter() {
  const cnt = {};
  S.all.forEach(c => { if (c.group) cnt[c.group] = (cnt[c.group]||0)+1; });
  const sorted = Object.entries(cnt).sort((a,b) => b[1]-a[1]).filter(([,n]) => n>=2);

  D.catList.innerHTML = '';
  const all = pill('Semua', true, () => {
    S.category=''; S.categoryM3U='';
    document.querySelectorAll('.cat-pill').forEach(p=>p.classList.remove('active'));
    all.classList.add('active');
    applyFilters();
  });
  D.catList.appendChild(all);

  sorted.forEach(([grp]) => {
    const p = pill(grp, false, () => {
      S.category = grp; S.categoryM3U = '';
      document.querySelectorAll('.cat-pill').forEach(x=>x.classList.remove('active'));
      p.classList.add('active');
      applyFilters();
    });
    D.catList.appendChild(p);
  });
}

function buildM3UCategoryFilter() {
  // When in category M3U mode, show official categories
  D.catList.innerHTML = '';
  const all = pill('Semua', true, async () => {
    document.querySelectorAll('.cat-pill').forEach(p=>p.classList.remove('active'));
    all.classList.add('active');
    S.category=''; S.categoryM3U='';
    await reloadMode();
  });
  D.catList.appendChild(all);

  CFG.CATEGORIES.forEach(slug => {
    const label = CFG.CAT_LABELS[slug] || slug;
    const p = pill(label, false, async () => {
      document.querySelectorAll('.cat-pill').forEach(x=>x.classList.remove('active'));
      p.classList.add('active');
      S.categoryM3U = slug;
      S.category = '';
      await loadCategoryMode(slug);
    });
    D.catList.appendChild(p);
  });
}

function pill(label, active, onClick) {
  const b = document.createElement('button');
  b.className = 'cat-pill' + (active?' active':'');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ════════════════════════════════════════════
// APPLY FILTERS & RENDER
// ════════════════════════════════════════════
function applyFilters() {
  const q = S.query.toLowerCase();
  S.filtered = S.all.filter(ch => {
    if (S.country && ch.country !== S.country) return false;
    if (S.category && ch.group !== S.category) return false;
    if (S.statusFilter === 'online' && S.streamStatus[ch.url] !== 'online') return false;
    if (S.statusFilter === 'offline' && S.streamStatus[ch.url] !== 'offline') return false;
    if (q && !ch.name.toLowerCase().includes(q) && !(ch.group || '').toLowerCase().includes(q)) return false;
    return true;
  });
  // Sync next index for current channel
  if (S.currentCh) {
    S.nextIdx = S.filtered.findIndex(c => c.url === S.currentCh.url);
    if (S.nextIdx < 0) S.nextIdx = 0;
  }
  S.page = 1;
  updateTitle();
  renderChannels();
  updateChannelPosition();
}

function updateTitle() {
  let t = 'Semua Saluran';
  if (S.country) t = `${flag(S.country)} ${CNAMES[S.country]||S.country}`;
  if (S.category) t = S.category;
  if (S.categoryM3U) t = CFG.CAT_LABELS[S.categoryM3U]||S.categoryM3U;
  if (S.query) t = `🔍 "${S.query}"`;
  D.pageTitle.textContent = t;
  D.chCount.textContent = `${S.filtered.length.toLocaleString()} saluran`;
}

function updateStats() {
  const countries = new Set(S.all.map(c=>c.country).filter(Boolean));
  D.totalChs.textContent = S.all.length.toLocaleString();
  D.totalCts.textContent = countries.size;
  updateOnlineSummary();
}

// ════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════
function renderChannels() {
  D.skeleton.classList.add('hidden');

  if (S.filtered.length === 0) {
    D.grid.classList.add('hidden');
    D.loadmoreWrap.classList.add('hidden');

    // Pesan khusus saat filter Online/Offline tapi belum ada data
    const checkedCount = Object.keys(S.streamStatus).length;
    if (S.statusFilter === 'online' && checkedCount === 0) {
      D.empty.innerHTML = `
        <div class="empty-icon">🔍</div>
        <h3>Belum Ada Data Online</h3>
        <p>Filter "Online" membutuhkan pengecekan stream terlebih dahulu.<br/>
        Klik tombol di bawah untuk mulai memeriksa saluran.</p>
        <button onclick="startCheck()" class="btn-primary" style="margin-top:4px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
          Cek Status Stream Sekarang
        </button>
        <button onclick="document.getElementById('sf-all').click()" class="btn-ghost" style="margin-top:4px">
          Tampilkan Semua Saluran
        </button>
      `;
    } else if (S.statusFilter === 'offline' && checkedCount === 0) {
      D.empty.innerHTML = `
        <div class="empty-icon">📡</div>
        <h3>Belum Ada Data Offline</h3>
        <p>Belum ada saluran yang diperiksa statusnya.</p>
        <button onclick="startCheck()" class="btn-primary" style="margin-top:4px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
          Cek Status Stream
        </button>
        <button onclick="document.getElementById('sf-all').click()" class="btn-ghost" style="margin-top:4px">
          Tampilkan Semua Saluran
        </button>
      `;
    } else {
      D.empty.innerHTML = `
        <div class="empty-icon">📭</div>
        <h3>Tidak Ada Saluran</h3>
        <p>Coba ubah filter atau kata kunci pencarian.</p>
        <button onclick="clearFilters()" class="btn-primary">Reset Filter</button>
      `;
    }

    D.empty.classList.remove('hidden');
    return;
  }

  D.empty.classList.add('hidden');
  D.grid.classList.remove('hidden');

  const end = S.page * CFG.PAGE_SIZE;
  const slice = S.filtered.slice(0, end);

  D.grid.innerHTML = '';
  slice.forEach((ch, i) => D.grid.appendChild(makeCard(ch, i)));

  // Load more
  if (end < S.filtered.length) {
    D.loadmoreWrap.classList.remove('hidden');
    const rem = S.filtered.length - end;
    D.loadmoreTxt.textContent = `Tampilkan Lebih (${rem.toLocaleString()} lagi)`;
  } else {
    D.loadmoreWrap.classList.add('hidden');
  }
}


function makeCard(ch, idx) {
  const isFav = S.favorites.some(f => f.url === ch.url);
  const isActive = S.currentCh?.url === ch.url;
  const status = S.streamStatus[ch.url] || 'unknown';
  const countryName = CNAMES[ch.country] || ch.country || 'INT';
  const fl = ch.country ? flag(ch.country) : '🌐';

  const statusLabels = { online:'Online', offline:'Offline', checking:'Cek...', unknown:'' };
  const statusDisplay = status !== 'unknown' ? '' : 'none';

  const card = document.createElement('div');
  card.className = 'ch-card' + (isActive?' active':'');
  card.dataset.url = ch.url;
  card.style.setProperty('--card-delay', `${Math.min(idx*.014,.45)}s`);
  card.setAttribute('role','button');
  card.setAttribute('tabindex','0');
  card.setAttribute('aria-label',`Tonton ${esc(ch.name)}`);

  const logoHtml = ch.logo
    ? `<img class="card-logo" src="${esc(ch.logo)}" alt="${esc(ch.name)}" loading="lazy" onerror="this.remove();this.parentElement?.querySelector('.card-logo-ph')?.style.setProperty('display','flex')">`
    : '';

  card.innerHTML = `
    <div class="card-thumb">
      ${logoHtml}
      <div class="card-logo-ph" style="${ch.logo?'display:none':''}">📺</div>
      <div class="card-play-ov">
        <div class="card-play-circle">
          <svg viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
        </div>
      </div>
      <span class="card-live-tag">LIVE</span>
      <div class="card-status ${status}" style="display:${statusDisplay}">
        <span class="status-dot ${status}"></span>
        <span class="status-lbl">${statusLabels[status]||''}</span>
      </div>
      <button class="card-fav ${isFav?'is-fav':''}" aria-label="Favorit">
        <svg viewBox="0 0 24 24" ${isFav?'fill="currentColor"':'fill="none"'} stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
    </div>
    <div class="card-info">
      <div class="card-name" title="${esc(ch.name)}">${esc(ch.name)}</div>
      <div class="card-meta">
        <span class="card-country">${fl} ${esc(countryName.length>14?ch.country:countryName)}</span>
        ${ch.group?`<span class="card-cat-badge">${esc(ch.group)}</span>`:''}
      </div>
    </div>
  `;

  card.addEventListener('click', e => {
    if (e.target.closest('.card-fav')) { toggleFav(ch, e.target.closest('.card-fav')); return; }
    playChannel(ch);
  });
  card.addEventListener('keydown', e => {
    if (e.key==='Enter'||e.key===' ') { e.preventDefault(); playChannel(ch); }
  });
  return card;
}

// ════════════════════════════════════════════
// VLC-LIKE HLS PLAYER
// ════════════════════════════════════════════

/*
 * VLC stability principles applied to HLS.js:
 * 1. Large buffer to ride out network hiccups
 * 2. Aggressive fragment retry
 * 3. Adaptive bitrate fallback
 * 4. Auto-reconnect on stall
 * 5. Progressive loading with smooth seeking
 */
const HLS_CONFIG = {
  // Buffer tuning (VLC-like: preload lots)
  maxBufferLength:          60,    // 60s forward buffer
  maxMaxBufferLength:       120,   // allow up to 120s buffer
  maxBufferSize:            60*1000*1000, // 60MB buffer
  backBufferLength:         30,    // keep 30s behind for seeking
  maxBufferHole:            0.5,   // tolerate 0.5s holes

  // Fragment/segment retry (like VLC retry)
  manifestLoadingMaxRetry:     6,
  manifestLoadingRetryDelay:   1000,
  manifestLoadingMaxRetryTimeout: 64000,
  levelLoadingMaxRetry:        6,
  levelLoadingRetryDelay:      1000,
  fragLoadingMaxRetry:         8,
  fragLoadingRetryDelay:       1000,
  fragLoadingMaxRetryTimeout:  64000,

  // Stall recovery (VLC keeps trying)
  nudgeMaxRetry:               20,
  nudgeOffset:                 0.2,

  // Performance
  enableWorker:                true,
  lowLatencyMode:              false,  // disable for stability (VLC prioritizes stability)
  progressive:                 true,
  testBandwidth:               true,
  startLevel:                  -1,    // auto-select quality

  // Live specific
  liveBackBufferLength:        30,
  liveDurationInfinity:        true,
  levelControllerDefaultLevel: -1,

  // XHR config
  xhrSetup(xhr) {
    xhr.timeout = 20000;
  },
};

let _streamTimer;

function playChannel(ch) {
  S.currentCh = ch;
  S.retryN = 0;
  S.streamErrors = 0;

  // Update active card
  document.querySelectorAll('.ch-card').forEach(c => {
    c.classList.toggle('active', c.dataset.url === ch.url);
  });

  // Track next index
  S.nextIdx = S.filtered.findIndex(c => c.url === ch.url);
  updateChannelPosition();

  // Show player
  D.hero.classList.add('hidden');
  D.playerSec.classList.remove('hidden');

  // Update info
  D.piName.textContent = ch.name;

  // Tags
  const status = S.streamStatus[ch.url];
  const statusTag = status === 'online'
    ? '<span class="tag tag-online">🟢 Online</span>'
    : status === 'offline'
    ? '<span class="tag tag-offline">🔴 Offline</span>'
    : '<span class="tag tag-live">🔴 LIVE</span>';

  D.piTags.innerHTML = [
    ch.country ? `<span class="tag tag-country">${flag(ch.country)} ${CNAMES[ch.country]||ch.country}</span>` : '',
    ch.group   ? `<span class="tag tag-cat">${esc(ch.group)}</span>` : '',
    statusTag,
  ].join('');

  // Logo
  D.piLogo.innerHTML = ch.logo
    ? `<img src="${esc(ch.logo)}" alt="${esc(ch.name)}" onerror="this.parentElement.textContent='📺'">`
    : '📺';

  updateFavBtn();

  // Reset player UI
  D.pLoading.classList.remove('hidden');
  D.pLoadTxt.textContent = 'Menghubungkan stream...';
  D.pError.classList.add('hidden');
  D.qualBadge.classList.add('hidden');

  D.playerSec.scrollIntoView({ behavior:'smooth', block:'nearest' });
  document.title = `▶ ${ch.name} — JeffTV`;

  startHLS(ch.url);
}

function startHLS(url) {
  clearTimeout(_streamTimer);

  // Destroy old instance
  if (S.hlsInst) { S.hlsInst.destroy(); S.hlsInst = null; }

  const vid = D.video;
  vid.pause();
  vid.removeAttribute('src');
  vid.load();

  const isHLS = /\.m3u8/i.test(url) || url.includes('m3u8');

  if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls(HLS_CONFIG);
    S.hlsInst = hls;
    S.streamErrors = 0;

    hls.loadSource(url);
    hls.attachMedia(vid);

    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      const levels = data.levels || [];
      D.pLoading.classList.add('hidden');
      // Show quality badge
      if (levels.length) {
        const maxH = Math.max(...levels.map(l => l.height||0));
        if (maxH >= 720) {
          D.qualBadge.textContent = maxH >= 1080 ? 'FHD' : 'HD';
          D.qualBadge.classList.remove('hidden');
        }
      }
      vid.play().catch(() => {});
    });

    hls.on(Hls.Events.FRAG_LOADED, () => {
      // Fragment loaded = definitely online
      if (S.currentCh && S.streamStatus[S.currentCh.url] !== 'online') {
        S.streamStatus[S.currentCh.url] = 'online';
        S.currentCh.statusKey = 'online';
        setCardStatus(S.currentCh.url, 'online');
        updatePlayerStatusTag('online');
      }
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      console.warn('[HLS]', data.type, data.details, data.fatal);

      if (!data.fatal) {
        // Non-fatal: HLS.js auto-recovers
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          D.pLoadTxt.textContent = 'Buffering...';
          D.pLoading.classList.remove('hidden');
        }
        return;
      }

      // Fatal errors
      S.streamErrors++;

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (S.retryN < 5) {
          S.retryN++;
          const delay = Math.min(1000 * S.retryN, 8000);
          D.pLoadTxt.textContent = `Reconnect (${S.retryN}/5)... ${Math.round(delay/1000)}s`;
          D.pLoading.classList.remove('hidden');
          setTimeout(() => {
            try { hls.startLoad(-1); } catch(e) {}
            vid.play().catch(() => {});
          }, delay);
        } else {
          markOfflineAndError();
        }
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (S.retryN < 3) {
          S.retryN++;
          D.pLoadTxt.textContent = 'Memperbaiki media...';
          setTimeout(() => {
            hls.recoverMediaError();
            vid.play().catch(() => {});
          }, 1500);
        } else {
          markOfflineAndError();
        }
      } else {
        markOfflineAndError();
      }
    });

    // Stall watchdog (VLC keeps trying even when stalled)
    setupStallWatchdog(vid);

  } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari native HLS
    vid.src = url;
    vid.addEventListener('loadedmetadata', () => {
      D.pLoading.classList.add('hidden');
      vid.play().catch(() => {});
    }, { once: true });
    vid.addEventListener('error', () => {
      if (S.retryN < 3) {
        S.retryN++;
        setTimeout(() => startHLS(url), 2000);
      } else markOfflineAndError();
    }, { once: true });
    setupStallWatchdog(vid);
  } else {
    // Direct URL
    vid.src = url;
    vid.addEventListener('canplay', () => {
      D.pLoading.classList.add('hidden');
      vid.play().catch(() => {});
    }, { once: true });
    vid.addEventListener('error', () => markOfflineAndError(), { once: true });
  }

  // 30s timeout
  _streamTimer = setTimeout(() => {
    if (!D.pLoading.classList.contains('hidden')) markOfflineAndError();
  }, 30000);
}

/* Stall watchdog - reconnects like VLC */
let _lastTime = 0;
let _stallTimer;
function setupStallWatchdog(vid) {
  clearInterval(_stallTimer);
  _lastTime = 0;
  _stallTimer = setInterval(() => {
    if (vid.paused || vid.ended || !S.currentCh) return;
    if (vid.currentTime === _lastTime && vid.readyState < 3) {
      // Stalled!
      console.warn('[JeffTV] Stream stalled, attempting recovery...');
      D.pLoadTxt.textContent = 'Reconnect otomatis...';
      D.pLoading.classList.remove('hidden');
      if (S.hlsInst) {
        try {
          S.hlsInst.stopLoad();
          setTimeout(() => { S.hlsInst?.startLoad(-1); vid.play().catch(()=>{}); }, 2000);
        } catch(e) {}
      } else {
        const t = vid.currentTime;
        vid.load();
        vid.currentTime = t;
        vid.play().catch(() => {});
      }
    }
    _lastTime = vid.currentTime;
  }, 8000);
}

function markOfflineAndError() {
  clearTimeout(_streamTimer);
  clearInterval(_stallTimer);
  D.pLoading.classList.add('hidden');
  D.pError.classList.remove('hidden');
  D.pErrMsg.textContent = 'Stream tidak tersedia atau sedang offline.';

  if (S.currentCh) {
    S.streamStatus[S.currentCh.url] = 'offline';
    S.currentCh.statusKey = 'offline';
    setCardStatus(S.currentCh.url, 'offline');
    updatePlayerStatusTag('offline');
    try { sessionStorage.setItem('jftv_status', JSON.stringify(S.streamStatus)); } catch(e) {}
  }
}

function updatePlayerStatusTag(status) {
  if (!D.piTags) return;
  const existing = D.piTags.querySelector('.tag-online,.tag-offline,.tag-live');
  if (existing) {
    if (status === 'online') {
      existing.className = 'tag tag-online';
      existing.textContent = '🟢 Online';
    } else if (status === 'offline') {
      existing.className = 'tag tag-offline';
      existing.textContent = '🔴 Offline';
    }
  }
}

function closePlayer() {
  clearTimeout(_streamTimer);
  clearInterval(_stallTimer);
  if (S.hlsInst) { S.hlsInst.destroy(); S.hlsInst = null; }
  const vid = D.video;
  vid.pause();
  vid.removeAttribute('src');
  vid.load();
  D.playerSec.classList.add('hidden');
  D.hero.classList.remove('hidden');
  S.currentCh = null;
  document.querySelectorAll('.ch-card.active').forEach(c => c.classList.remove('active'));
  document.title = 'JeffTV — Nonton TV Online Gratis';
}

/* Play next channel */
function playNext() {
  if (S.filtered.length === 0) return;
  S.nextIdx = (S.nextIdx + 1) % S.filtered.length;
  playChannel(S.filtered[S.nextIdx]);
}

/* Play previous channel */
function playPrev() {
  if (S.filtered.length === 0) return;
  S.nextIdx = (S.nextIdx - 1 + S.filtered.length) % S.filtered.length;
  playChannel(S.filtered[S.nextIdx]);
}

function updateChannelPosition() {
  if (!S.currentCh || S.filtered.length === 0) {
    if (D.chPosition) D.chPosition.textContent = '—';
    return;
  }
  const idx = S.filtered.findIndex(c => c.url === S.currentCh.url);
  if (D.chPosition) {
    D.chPosition.textContent = idx >= 0 ? `${idx + 1} / ${S.filtered.length}` : '—';
  }
}

// ════════════════════════════════════════════
// PLAYLIST MODE SWITCHING
// ════════════════════════════════════════════
async function reloadMode() {
  D.skeleton.classList.remove('hidden');
  D.grid.classList.add('hidden');
  D.empty.classList.add('hidden');

  try {
    let chs = [];
    if (S.mode === 'api') {
      chs = await loadAPI();
    } else if (S.mode === 'country' && S.country) {
      chs = await loadCountryM3U(S.country);
    } else if (S.mode === 'category' && S.categoryM3U) {
      chs = await loadCategoryM3U(S.categoryM3U);
    } else {
      chs = await loadAPI();
    }
    S.all = processChannels(chs);
  } catch(e) {
    console.error('Load failed:', e);
    showToast('⚠️ Gagal memuat data. Coba lagi.');
    if (S.all.length === 0) {
      S.all = processChannels(fallbackChannels());
    }
  }

  if (S.mode === 'api') {
    buildCountryFilter();
    buildCategoryFilter();
  } else if (S.mode === 'category') {
    buildM3UCategoryFilter();
  }
  updateStats();
  applyFilters();
}

async function loadCategoryMode(slug) {
  D.skeleton.classList.remove('hidden');
  D.grid.classList.add('hidden');
  try {
    const chs = await loadCategoryM3U(slug);
    S.all = processChannels(chs);
    updateStats();
    applyFilters();
    showToast(`✅ Kategori ${CFG.CAT_LABELS[slug]||slug}: ${S.all.length} saluran`);
  } catch(e) {
    showToast('⚠️ Gagal memuat kategori ini.');
    D.skeleton.classList.add('hidden');
    D.grid.classList.remove('hidden');
  }
}

// ════════════════════════════════════════════
// CUSTOM PLAYLIST LOADERS
// ════════════════════════════════════════════
async function loadCustomM3UUrl(url) {
  if (!url) return;
  D.skeleton.classList.remove('hidden');
  D.grid.classList.add('hidden');
  D.empty.classList.add('hidden');
  showToast('🌐 Mengunduh playlist M3U kustom...');

  try {
    const txt = await fetchText(url);
    if (!txt.includes('#EXTINF')) throw new Error('Format M3U tidak valid');
    const chs = parseM3U(txt);
    if (chs.length === 0) throw new Error('Tidak ada saluran ditemukan');

    S.all = processChannels(chs);
    S.customPlaylistLoaded = true;
    try { localStorage.setItem('jftv_custom_url', url); } catch(e) {}

    // Show info
    D.customPlaylistInfo.classList.remove('hidden');
    D.customChCount.textContent = chs.length;

    updateStats();
    applyFilters();
    showToast(`✅ Berhasil memuat ${chs.length} saluran kustom!`);
  } catch(e) {
    console.error('Failed to load custom M3U:', e);
    showToast('⚠️ Gagal memuat M3U: CORS atau URL tidak valid.');
    D.skeleton.classList.add('hidden');
    D.grid.classList.remove('hidden');
  }
}

function loadCustomM3UFile(file) {
  if (!file) return;
  const reader = new FileReader();
  D.skeleton.classList.remove('hidden');
  D.grid.classList.add('hidden');
  D.empty.classList.add('hidden');
  showToast('📄 Membaca file M3U...');

  reader.onload = function(e) {
    try {
      const txt = e.target.result;
      if (!txt.includes('#EXTINF')) throw new Error('Format M3U tidak valid');
      const chs = parseM3U(txt);
      if (chs.length === 0) throw new Error('Tidak ada saluran ditemukan');

      S.all = processChannels(chs);
      S.customPlaylistLoaded = true;

      // Clear cached URL since file uploaded
      try { localStorage.removeItem('jftv_custom_url'); } catch(ex) {}
      D.m3uUrlInput.value = '';

      D.customPlaylistInfo.classList.remove('hidden');
      D.customChCount.textContent = chs.length;

      updateStats();
      applyFilters();
      showToast(`✅ Berhasil memuat ${chs.length} saluran dari file!`);
    } catch(err) {
      console.error(err);
      showToast('⚠️ Gagal membaca M3U: ' + err.message);
      D.skeleton.classList.add('hidden');
      D.grid.classList.remove('hidden');
    }
  };
  reader.readAsText(file);
}

async function clearCustomPlaylist() {
  S.customPlaylistLoaded = false;
  try { localStorage.removeItem('jftv_custom_url'); } catch(e) {}
  D.m3uUrlInput.value = '';
  D.m3uFileInput.value = '';
  D.customPlaylistInfo.classList.add('hidden');
  showToast('🧹 Playlist kustom dihapus');
  
  // Reload default mode
  S.mode = 'api';
  D.playlistTabs?.querySelectorAll('.ptab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === 'api');
  });
  D.countrySec.style.display='';
  D.catSec.style.display='';
  await reloadMode();
}

// ════════════════════════════════════════════
// FAVORITES
// ════════════════════════════════════════════
function toggleFav(ch, btn) {
  const i = S.favorites.findIndex(f => f.url === ch.url);
  if (i >= 0) {
    S.favorites.splice(i, 1);
    btn?.classList.remove('is-fav');
    btn?.querySelector('svg')?.setAttribute('fill','none');
    showToast(`💔 Dihapus dari favorit`);
  } else {
    S.favorites.push({ name:ch.name, url:ch.url, logo:ch.logo, country:ch.country, group:ch.group, groupSlug:ch.groupSlug });
    btn?.classList.add('is-fav');
    btn?.querySelector('svg')?.setAttribute('fill','currentColor');
    showToast(`❤️ ${ch.name} → Favorit`);
  }
  try { localStorage.setItem('jftv_favs', JSON.stringify(S.favorites)); } catch(e) {}
  D.favCount.textContent = S.favorites.length;
  renderFavs();
  updateFavBtn();
}

function updateFavBtn() {
  if (!S.currentCh) return;
  const is = S.favorites.some(f => f.url === S.currentCh.url);
  D.favBtn.classList.toggle('active', is);
  D.favBtn.querySelector('svg')?.setAttribute('fill', is ? 'currentColor' : 'none');
}

function renderFavs() {
  D.favCount.textContent = S.favorites.length;
  if (!S.favorites.length) {
    D.favList.innerHTML = '<p class="empty-sm">Belum ada favorit</p>';
    return;
  }
  D.favList.innerHTML = S.favorites.map(f => `
    <div class="fav-item" data-url="${esc(f.url)}" role="button" tabindex="0">
      <div class="fav-dot"></div>
      <span class="fav-name">${esc(f.name)}</span>
    </div>
  `).join('');
  D.favList.querySelectorAll('.fav-item').forEach(el => {
    const ch = S.favorites.find(f => f.url === el.dataset.url);
    if (ch) el.addEventListener('click', () => playChannel(ch));
  });
}

// ════════════════════════════════════════════
// WATCH HISTORY
// ════════════════════════════════════════════
function addToHistory(ch) {
  if (!ch) return;
  const idx = S.history.findIndex(h => h.url === ch.url);
  if (idx >= 0) S.history.splice(idx, 1);
  
  S.history.unshift({ name: ch.name, url: ch.url, logo: ch.logo, country: ch.country, group: ch.group });
  if (S.history.length > 24) S.history.pop();

  try { localStorage.setItem('jftv_history', JSON.stringify(S.history)); } catch(e) {}
  renderHistory();
}

function renderHistory() {
  if (!D.historyList) return;
  const hasHistory = S.history.length > 0;
  D.clearHistoryBtn?.classList.toggle('hidden', !hasHistory);

  if (!hasHistory) {
    D.historyList.innerHTML = '<p class="empty-sm">Belum ada riwayat</p>';
    return;
  }

  D.historyList.innerHTML = S.history.map(h => `
    <div class="fav-item" data-url="${esc(h.url)}" role="button" tabindex="0">
      <div class="fav-dot history" style="background:var(--accent2)"></div>
      <span class="fav-name">${esc(h.name)}</span>
    </div>
  `).join('');

  D.historyList.querySelectorAll('.fav-item').forEach(el => {
    const ch = S.history.find(h => h.url === el.dataset.url);
    if (ch) el.addEventListener('click', () => playChannel(ch));
  });
}

function clearHistory() {
  S.history = [];
  try { localStorage.removeItem('jftv_history'); } catch(e) {}
  renderHistory();
  showToast('🧹 Riwayat tontonan dikosongkan');
}

// ════════════════════════════════════════════
// ASPECT RATIO TOGGLER
// ════════════════════════════════════════════
const AR_MODES = ['default', '16-9', '4-3', 'stretch'];
const AR_LABELS = { 'default': 'AR: Def', '16-9': 'AR: 16:9', '4-3': 'AR: 4:3', 'stretch': 'AR: Fill' };

function toggleAspectRatio() {
  const curIdx = AR_MODES.indexOf(S.aspectRatio);
  const nextIdx = (curIdx + 1) % AR_MODES.length;
  const nextMode = AR_MODES[nextIdx];
  
  S.aspectRatio = nextMode;
  
  const vid = D.video;
  if (vid) {
    AR_MODES.forEach(mode => vid.classList.remove(`ar-${mode}`));
    vid.classList.add(`ar-${nextMode}`);
  }
  
  if (D.aspectLbl) {
    D.aspectLbl.textContent = AR_LABELS[nextMode];
  }
  
  showToast(`📺 Aspek Rasio: ${nextMode.toUpperCase().replace('-', ':')}`);
}

// ════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════
let _toastT;
function showToast(msg) {
  let el = document.getElementById('jf-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'jf-toast';
    Object.assign(el.style, {
      position:'fixed', bottom:'24px', left:'50%',
      transform:'translateX(-50%) translateY(80px)',
      background:'rgba(16,16,24,0.97)',
      border:'1px solid rgba(255,255,255,0.12)',
      color:'#f0f0f5', padding:'11px 20px',
      borderRadius:'12px', fontSize:'13.5px',
      fontFamily:"'Outfit',sans-serif",
      zIndex:'9999', backdropFilter:'blur(20px)',
      boxShadow:'0 8px 32px rgba(0,0,0,0.5)',
      transition:'transform .35s cubic-bezier(0.34,1.56,0.64,1),opacity .3s ease',
      opacity:'0', whiteSpace:'nowrap', pointerEvents:'none', maxWidth:'90vw',
    });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => { el.style.transform='translateX(-50%) translateY(0)'; el.style.opacity='1'; });
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { el.style.transform='translateX(-50%) translateY(80px)'; el.style.opacity='0'; }, 3200);
}

// ════════════════════════════════════════════
// SPLASH
// ════════════════════════════════════════════
function setSplashStatus(msg) {
  if (D.splashStatus) D.splashStatus.textContent = msg;
}
function hideSplash() {
  D.splash.classList.add('out');
  D.app.classList.remove('hidden');
  setTimeout(() => { D.splash.style.display = 'none'; }, 700);
}

// ════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════
function flag(code) {
  if (!code||code.length!==2) return '🌐';
  try {
    return String.fromCodePoint(
      code.toUpperCase().charCodeAt(0)-65+0x1F1E6,
      code.toUpperCase().charCodeAt(1)-65+0x1F1E6
    );
  } catch(e) { return '🌐'; }
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clearFilters() {
  S.query=''; S.country=''; S.category=''; S.categoryM3U='';
  D.searchInput.value='';
  D.countrySelect.value='';
  document.querySelectorAll('.cat-pill').forEach((p,i) => p.classList.toggle('active',i===0));
  applyFilters();
}
window.clearFilters = clearFilters;

// ════════════════════════════════════════════
// COUNTRY NAMES
// ════════════════════════════════════════════
const CNAMES = {
  'ID':'Indonesia','US':'Amerika Serikat','GB':'Inggris','FR':'Prancis',
  'DE':'Jerman','JP':'Jepang','CN':'China','IN':'India','BR':'Brasil',
  'RU':'Rusia','CA':'Kanada','AU':'Australia','MX':'Meksiko','KR':'Korea Selatan',
  'IT':'Italia','ES':'Spanyol','AR':'Argentina','TR':'Turki','PK':'Pakistan',
  'MY':'Malaysia','PH':'Filipina','TH':'Thailand','SG':'Singapura','VN':'Vietnam',
  'SA':'Arab Saudi','EG':'Mesir','NG':'Nigeria','ZA':'Afrika Selatan','UA':'Ukraina',
  'PL':'Polandia','NL':'Belanda','SE':'Swedia','NO':'Norwegia','PT':'Portugal',
  'GR':'Yunani','RO':'Rumania','HU':'Hungaria','CZ':'Ceko','AT':'Austria',
  'CH':'Swiss','BE':'Belgia','DK':'Denmark','FI':'Finlandia','IL':'Israel',
  'AE':'UEA','IQ':'Irak','IR':'Iran','AF':'Afghanistan','BD':'Bangladesh',
  'ET':'Ethiopia','KE':'Kenya','TZ':'Tanzania','GH':'Ghana','CO':'Kolombia',
  'VE':'Venezuela','PE':'Peru','CL':'Chile','UZ':'Uzbekistan','KZ':'Kazakhstan',
  'RS':'Serbia','BG':'Bulgaria','HR':'Kroasia','SK':'Slovakia','LT':'Lithuania',
  'LV':'Latvia','EE':'Estonia','MD':'Moldova','BY':'Belarusia','MK':'Makedonia',
  'BA':'Bosnia','SI':'Slovenia','AL':'Albania','ME':'Montenegro','QA':'Qatar',
  'KW':'Kuwait','BH':'Bahrain','OM':'Oman','JO':'Yordania','LB':'Lebanon',
  'SY':'Suriah','YE':'Yaman','LY':'Libya','TN':'Tunisia','DZ':'Aljazair',
  'MA':'Maroko','SD':'Sudan','SO':'Somalia','NP':'Nepal','LK':'Sri Lanka',
  'MM':'Myanmar','KH':'Kamboja','LA':'Laos','TW':'Taiwan','HK':'Hong Kong',
  'MO':'Makau','MN':'Mongolia','TJ':'Tajikistan','TM':'Turkmenistan',
  'KG':'Kirgizstan','AZ':'Azerbaijan','AM':'Armenia','GE':'Georgia',
  'IS':'Islandia','IE':'Irlandia','LU':'Luksemburg','MT':'Malta','CY':'Siprus',
  'NZ':'Selandia Baru','FJ':'Fiji','PG':'Papua Nugini','MW':'Malawi',
  'MZ':'Mozambik','ZW':'Zimbabwe','ZM':'Zambia','UG':'Uganda','RW':'Rwanda',
  'CM':'Kamerun','CI':'Pantai Gading','SN':'Senegal','ML':'Mali','GN':'Guinea',
  'INT':'Internasional','XK':'Kosovo',
};

// ════════════════════════════════════════════
// EVENT SETUP
// ════════════════════════════════════════════
function setupEvents() {
  // Sidebar mobile
  const openSb = () => {
    D.sidebar.classList.add('open');
    D.sbOverlay.classList.remove('hidden');
  };
  const closeSb = () => {
    D.sidebar.classList.remove('open');
    D.sbOverlay.classList.add('hidden');
  };
  D.menuBtn?.addEventListener('click', openSb);
  D.sbToggle?.addEventListener('click', closeSb);
  D.sbOverlay?.addEventListener('click', closeSb);

  // Playlist tabs
  D.playlistTabs?.querySelectorAll('.ptab').forEach(tab => {
    tab.addEventListener('click', async () => {
      D.playlistTabs.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      S.mode = tab.dataset.mode;
      S.category=''; S.categoryM3U='';

      // Clear search query when changing tabs
      D.searchInput.value=''; S.query='';
      D.searchClear.classList.add('hidden');

      // Show/hide sections based on mode
      D.customPlaylistSec.classList.add('hidden');
      if (S.mode === 'api') {
        D.countrySec.style.display='';
        D.catSec.style.display='';
        // Restore country filter
        S.country = D.countrySelect.value || 'ID';
        if (!D.countrySelect.value) {
          D.countrySelect.value = 'ID';
          S.country = 'ID';
        }
      } else if (S.mode === 'country') {
        D.countrySec.style.display='';
        D.catSec.style.display='none';
        if (!D.countrySelect.value) {
          D.countrySelect.value = 'ID'; // Default to ID
        }
        S.country = D.countrySelect.value;
      } else if (S.mode === 'category') {
        D.countrySec.style.display='none';
        D.catSec.style.display='';
        S.country = ''; // Show all countries in category mode
        buildM3UCategoryFilter();
      } else if (S.mode === 'custom') {
        D.countrySec.style.display='none';
        D.catSec.style.display='none';
        D.customPlaylistSec.classList.remove('hidden');
        
        // Auto-load custom playlist if URL exists
        const customUrl = localStorage.getItem('jftv_custom_url');
        if (customUrl) {
          D.m3uUrlInput.value = customUrl;
          await loadCustomM3UUrl(customUrl);
        } else if (S.customPlaylistLoaded) {
          applyFilters();
        } else {
          D.skeleton.classList.add('hidden');
          D.grid.classList.add('hidden');
          D.empty.innerHTML = `
            <div class="empty-icon">➕</div>
            <h3>Playlist Kustom Kosong</h3>
            <p>Silakan masukkan link M3U atau pilih file .m3u di menu samping untuk memutar siaran Anda.</p>
          `;
          D.empty.classList.remove('hidden');
          D.loadmoreWrap.classList.add('hidden');
        }
        return;
      }
      await reloadMode();
    });
  });

  // Search
  const doSearch = debounce(() => {
    S.query = D.searchInput.value.trim();
    D.searchClear.classList.toggle('hidden', !S.query);
    applyFilters();
  }, 280);
  D.searchInput?.addEventListener('input', doSearch);
  D.searchClear?.addEventListener('click', () => {
    D.searchInput.value=''; S.query='';
    D.searchClear.classList.add('hidden');
    applyFilters(); D.searchInput.focus();
  });

  // Country
  D.countrySelect?.addEventListener('change', async () => {
    S.country = D.countrySelect.value;
    if (S.mode === 'country') {
      if (S.country) {
        await reloadMode();
      } else {
        // Switch to API mode (Semua)
        S.mode = 'api';
        D.playlistTabs?.querySelectorAll('.ptab').forEach(t => {
          t.classList.toggle('active', t.dataset.mode === 'api');
        });
        D.catSec.style.display='';
        // Restore country to select value, here it is empty
        await reloadMode();
      }
    } else {
      applyFilters();
    }
  });

  // Status filter
  [D.sfAll, D.sfOnline, D.sfOffline].forEach(btn => {
    btn?.addEventListener('click', () => {
      [D.sfAll, D.sfOnline, D.sfOffline].forEach(b => b?.classList.remove('active'));
      btn.classList.add('active');
      S.statusFilter = btn.dataset.status;
      applyFilters();
    });
  });

  // Check streams
  D.checkBtn?.addEventListener('click', () => {
    if (S.checking) { S.checkAbort = true; return; }
    checkAllStreams(S.filtered.slice(0, 200)); // check up to 200
  });

  // Load more
  D.loadmoreBtn?.addEventListener('click', () => {
    S.page++;
    renderChannels();
    setTimeout(() => {
      const cards = D.grid.querySelectorAll('.ch-card');
      const si = (S.page-1)*CFG.PAGE_SIZE;
      cards[si]?.scrollIntoView({ behavior:'smooth', block:'center' });
    }, 100);
  });

  // View toggle
  D.viewGrid?.addEventListener('click', () => {
    D.grid.classList.remove('list-view');
    D.viewGrid.classList.add('active'); D.viewList.classList.remove('active');
  });
  D.viewList?.addEventListener('click', () => {
    D.grid.classList.add('list-view');
    D.viewList.classList.add('active'); D.viewGrid.classList.remove('active');
  });

  // Player controls
  D.closePlayer?.addEventListener('click', closePlayer);
  D.retryBtn?.addEventListener('click', () => {
    if (!S.currentCh) return;
    S.retryN=0; S.streamErrors=0;
    D.pError.classList.add('hidden');
    D.pLoading.classList.remove('hidden');
    D.pLoadTxt.textContent = 'Mencoba kembali...';
    startHLS(S.currentCh.url);
  });
  D.nextBtn?.addEventListener('click', playNext);
  D.prevErrBtn?.addEventListener('click', playPrev);
  D.prevChBtn?.addEventListener('click', playPrev);
  D.nextChBtn?.addEventListener('click', playNext);
  D.favBtn?.addEventListener('click', () => { if (S.currentCh) toggleFav(S.currentCh, null); });

  D.pipBtn?.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await D.video.requestPictureInPicture?.();
    } catch(e) { showToast('⚠️ PiP tidak didukung'); }
  });

  D.fsBtn?.addEventListener('click', () => {
    const el = D.video.closest('.player-box');
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // Video events
  D.video?.addEventListener('playing', () => {
    D.pLoading.classList.add('hidden');
    if (S.currentCh) {
      S.streamStatus[S.currentCh.url] = 'online';
      setCardStatus(S.currentCh.url, 'online');
      updatePlayerStatusTag('online');
      addToHistory(S.currentCh); // Save to history
    }
  });
  D.video?.addEventListener('waiting', () => {
    if (!D.pError.classList.contains('hidden')) return;
    D.pLoadTxt.textContent = 'Buffering...';
    D.pLoading.classList.remove('hidden');
  });
  D.video?.addEventListener('stalled', () => {
    D.pLoadTxt.textContent = 'Reconnect...';
    D.pLoading.classList.remove('hidden');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA') return;
    if (e.key==='Escape') { closePlayer(); closeSb(); }
    if (e.key==='f'||e.key==='F') D.fsBtn?.click();
    if (e.key==='n'||e.key==='N') playNext();
    if (e.key==='p'||e.key==='P') playPrev();
    if (e.key==='/'||e.key==='s') { e.preventDefault(); D.searchInput?.focus(); }
    if (e.key==='ArrowRight'&&S.currentCh) playNext();
    if (e.key==='ArrowLeft'&&S.currentCh) playPrev();
  });

  // Custom Playlist events
  D.loadM3uUrlBtn?.addEventListener('click', () => loadCustomM3UUrl(D.m3uUrlInput.value.trim()));
  D.m3uUrlInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadCustomM3UUrl(D.m3uUrlInput.value.trim());
  });
  D.m3uFileInput?.addEventListener('change', e => {
    if (e.target.files.length) loadCustomM3UFile(e.target.files[0]);
  });
  D.clearCustomPlaylistBtn?.addEventListener('click', clearCustomPlaylist);

  // History events
  D.clearHistoryBtn?.addEventListener('click', clearHistory);

  // Aspect Ratio events
  D.aspectBtn?.addEventListener('click', toggleAspectRatio);
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
async function init() {
  setSplashStatus('Menghubungkan ke server IPTV...');

  try {
    const chs = await loadAPI();
    S.all = processChannels(chs);
    setSplashStatus(`✅ ${S.all.length.toLocaleString()} saluran ditemukan!`);
  } catch(e) {
    console.error('Primary load failed:', e);
    setSplashStatus('Menggunakan data cadangan...');
    S.all = processChannels(fallbackChannels());
  }

  buildCountryFilter();
  buildCategoryFilter();
  updateStats();
  renderFavs();
  renderHistory();
  applyFilters();

  await sleep(400);
  hideSplash();

  const total = S.all.length;
  showToast(`📺 ${total.toLocaleString()} saluran siap ditonton!`);

  // Restore cached statuses
  if (Object.keys(S.streamStatus).length > 0) {
    updateOnlineSummary();
    // Re-apply status badges ke card yang sudah ter-render
    Object.entries(S.streamStatus).forEach(([url, st]) => setCardStatus(url, st));
  }

  // Auto-check saluran visible pertama secara background
  // Ini yang membuat filter "Online" bisa langsung dipakai
  setTimeout(() => autoCheckVisible(), 1500);
}

/**
 * Auto-check saluran yang sedang tampil (halaman pertama)
 * Dijalankan background setelah UI ready
 */
async function autoCheckVisible() {
  const toCheck = S.filtered
    .slice(0, CFG.AUTO_CHECK_N)
    .filter(ch => !S.streamStatus[ch.url]); // skip yang sudah dicek

  if (toCheck.length === 0) return;

  // Tampilkan info kecil
  showToast(`🔍 Memeriksa ${toCheck.length} saluran pertama...`);

  // Jalankan di background tanpa blokir UI
  const batches = [];
  for (let i = 0; i < toCheck.length; i += CFG.CHECK_BATCH) {
    batches.push(toCheck.slice(i, i + CFG.CHECK_BATCH));
  }

  let onlineCount = 0;
  let offlineCount = 0;

  for (const batch of batches) {
    if (S.checkAbort) break;
    await Promise.all(batch.map(async ch => {
      setCardStatus(ch.url, 'checking');
      const st = await checkStreamURL(ch.url);
      S.streamStatus[ch.url] = st;
      ch.statusKey = st;
      if (st === 'online') onlineCount++;
      else offlineCount++;
      setCardStatus(ch.url, st);
    }));
    await sleep(CFG.CHECK_DELAY);
  }

  try { sessionStorage.setItem('jftv_status', JSON.stringify(S.streamStatus)); } catch(e) {}

  updateOnlineSummary();
  if (D.statOnline) D.statOnline.textContent = Object.values(S.streamStatus).filter(v=>v==='online').length;

  showToast(`✅ Auto-check: ${onlineCount} online, ❌ ${offlineCount} offline`);

  // Update filter jika sedang di status filter
  if (S.statusFilter !== 'all') applyFilters();
}

// Helper untuk mulai check dari tombol sidebar & onclick di empty state
function startCheck() {
  const toCheck = S.filtered.slice(0, 200);
  checkAllStreams(toCheck);
}
window.startCheck = startCheck; // expose untuk onclick di HTML


// ════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  setupEvents();

  // Update check button text
  if (D.checkBtn) {
    D.checkBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
      Cek Status (${CFG.AUTO_CHECK_N} pertama)
    `;
    D.checkBtn.onclick = startCheck;
  }

  init().catch(e => {
    console.error(e);
    hideSplash();
    S.all = processChannels(fallbackChannels());
    buildCountryFilter(); buildCategoryFilter();
    updateStats(); renderFavs(); applyFilters();
    showToast('⚠️ Mode offline aktif');
    setTimeout(() => autoCheckVisible(), 2000);
  });
});
