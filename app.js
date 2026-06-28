/**
 * JeffTV — app.js v3.2
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
  // App/Cache version for cache busting
  CACHE_VERSION:    'v4.0',
  // iptv-org playlist base URLs (from PLAYLISTS.md)
  PLAYLIST_BASE:    'https://iptv-org.github.io/iptv',
  // API endpoints
  CHANNELS_API:     'https://iptv-org.github.io/api/channels.json',
  STREAMS_API:      'https://iptv-org.github.io/api/streams.json',
  LOGOS_API:        'https://iptv-org.github.io/api/logos.json',

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
  countriesList: [],  // searchable country list source
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
    logoLink:       q('logo-link'),
    sidebar:        q('sidebar'),
    sbOverlay:      q('sb-overlay'),
    sbToggle:       q('sidebar-toggle'),
    menuBtn:        q('menu-toggle'),
    searchInput:    q('search-input'),
    searchClear:    q('search-clear'),
    playlistTabs:   q('playlist-tabs'),
    countrySec:     q('country-sec'),
    countryCustomSelect:    q('country-custom-select'),
    countrySelectTrigger:   q('country-select-trigger'),
    countrySelectOptions:   q('country-select-options'),
    countryOptionsList:     q('country-options-list'),
    selectedCountryFlag:    q('selected-country-flag'),
    selectedCountryEmoji:   q('selected-country-emoji'),
    selectedCountryName:    q('selected-country-name'),
    countrySearch:          q('country-search'),
    catSec:         q('cat-sec'),
    catList:        q('category-list'),
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
    m3uPresetSelect:        q('m3u-preset-select'),
    m3uFileInput:           q('m3u-file-input'),
    customPlaylistInfo:     q('custom-playlist-info'),
    customChCount:          q('custom-ch-count'),
    clearCustomPlaylistBtn: q('clear-custom-playlist-btn'),
    addPresetToggle:        q('add-preset-toggle'),
    deletePresetBtn:        q('delete-preset-btn'),
    addPresetFormWrap:      q('add-preset-form-wrap'),
    newPresetName:          q('new-preset-name'),
    newPresetUrl:           q('new-preset-url'),
    saveNewPresetBtn:       q('save-new-preset-btn'),
    cancelNewPresetBtn:     q('cancel-new-preset-btn'),
    // History
    clearHistoryBtn:        q('clear-history-btn'),
    historyList:            q('history-list'),
    // Aspect Ratio
    aspectBtn:              q('aspect-btn'),
    aspectLbl:              q('aspect-lbl'),
    // PWA Install
    pwaInstallSec:          q('pwa-install-sec'),
    pwaInstallBtn:          q('pwa-install-btn'),
    topPwaInstallBtn:       q('top-pwa-install-btn'),
    refreshCacheBtn:        q('refresh-cache-btn'),
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

/* Load via API (channels.json + streams.json + logos.json) with client-side caching */
async function loadAPI(forceRefresh = false) {
  const CACHE_KEY = 'jftv_channels_cache_' + CFG.CACHE_VERSION;
  const CACHE_TIME_KEY = 'jftv_channels_cache_time_' + CFG.CACHE_VERSION;
  const ONE_DAY = 24 * 60 * 60 * 1000; // 24 hours

  // Try loading from localStorage first if not forced
  if (!forceRefresh) {
    try {
      // Clean up old caches from previous versions to free up storage space
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('jftv_channels_cache') && !key.includes(CFG.CACHE_VERSION)) {
          localStorage.removeItem(key);
        }
      }

      const cached = localStorage.getItem(CACHE_KEY);
      const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
      const now = Date.now();

      if (cached && cachedTime && (now - parseInt(cachedTime, 10) < ONE_DAY)) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 500) {
          console.log('[JeffTV] Loaded channels from localStorage cache (' + CFG.CACHE_VERSION + ')');
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[JeffTV] LocalStorage cache read/cleanup failed:', e);
    }
  }

  setSplashStatus('Memuat data saluran TV...');
  const [chData, stData, logoData, idTxt] = await Promise.all([
    fetchJSON(CFG.CHANNELS_API),
    fetchJSON(CFG.STREAMS_API),
    fetchJSON(CFG.LOGOS_API),
    fetchText('https://furymazu.github.io/iptv-channel-indonesia/indonesiaiptv.m3u').catch(e => {
      console.warn('[JeffTV] Failed to fetch furymazu playlist, using global only:', e);
      return '';
    })
  ]);
  setSplashStatus(`Memproses ${stData.length.toLocaleString()} stream...`);

  const chMap = {};
  chData.forEach(c => { chMap[c.id] = c; });

  const logoMap = {};
  logoData.forEach(l => {
    if (l.in_use) {
      logoMap[l.channel] = l.url;
    }
  });

  const seen = new Set();
  const result = [];

  // Merge working Indonesian channels from furymazu first
  if (idTxt && idTxt.includes('#EXTINF')) {
    try {
      const idChs = parseM3U(idTxt);
      idChs.forEach(c => {
        if (!c.url) return;
        if (seen.has(c.url)) return;
        seen.add(c.url);
        
        const grp = CFG.CAT_LABELS[c.groupSlug] || c.group;
        result.push({
          id: c.id || c.name,
          name: c.name,
          logo: c.logo || '',
          group: grp,
          groupSlug: c.groupSlug,
          country: 'ID',
          language: c.language || 'ind',
          url: c.url,
        });
      });
      console.log(`[JeffTV] Merged ${result.length} working Indonesian channels from furymazu`);
    } catch(err) {
      console.warn('[JeffTV] Failed to parse furymazu playlist:', err);
    }
  }
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

    const logo = logoMap[st.channel] || '';

    result.push({
      id: st.channel,
      name: meta.name || st.channel,
      logo: logo,
      group,
      groupSlug,
      country,
      language: (meta.languages || [])[0] || '',
      url: st.url,
    });
    if (result.length >= 25000) break;
  }

  // Save to localStorage cache
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
    console.log('[JeffTV] Saved channels to localStorage cache');
  } catch (e) {
    console.warn('[JeffTV] LocalStorage cache write failed:', e);
  }

  return result;
}

async function loadCountryM3U(code) {
  if (code.toUpperCase() === 'ID') {
    // Coba memuat dari repositori komunitas Indonesia yang aktif
    try {
      setSplashStatus('Memuat playlist Indonesia (furymazu)...');
      const txt = await fetchText('https://furymazu.github.io/iptv-channel-indonesia/indonesiaiptv.m3u');
      if (txt.includes('#EXTINF')) {
        const chs = parseM3U(txt);
        if (chs.length > 0) {
          console.log('[JeffTV] Loaded country ID from furymazu');
          return chs.map(c => ({ ...c, country: 'ID' }));
        }
      }
    } catch(e) {
      console.warn('[JeffTV] Failed to load furymazu, trying mgi24:', e);
    }

    try {
      setSplashStatus('Memuat playlist Indonesia (mgi24)...');
      const txt = await fetchText('https://mgi24.github.io/tvdigital/idwork.m3u');
      if (txt.includes('#EXTINF')) {
        const chs = parseM3U(txt);
        if (chs.length > 0) {
          console.log('[JeffTV] Loaded country ID from mgi24');
          return chs.map(c => ({ ...c, country: 'ID' }));
        }
      }
    } catch(e) {
      console.warn('[JeffTV] Failed to load mgi24, trying global backup:', e);
    }
  }

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
    {id:'TVRI.id@HD', name:'TVRI Nasional', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/TVRILogo2019.svg/200px-TVRILogo2019.svg.png', group:'Umum', groupSlug:'general', country:'ID', url:'http://ott.tvri.co.id/Content/HLS/Live/Channel(TVRINasional)/index.m3u8'},
    {id:'TransTV.id@SD', name:'Trans TV', logo:'https://upload.wikimedia.org/wikipedia/en/thumb/6/62/Trans_TV_2013.svg/200px-Trans_TV_2013.svg.png', group:'Umum', groupSlug:'general', country:'ID', url:'http://210.210.155.35/qwr9ew/s/s01/index.m3u8'},
    {id:'Trans7.id@SD', name:'Trans 7', logo:'https://i.imgur.com/fAbGImS.png', group:'Umum', groupSlug:'general', country:'ID', url:'http://210.210.155.35/qwr9ew/s/s02/index.m3u8'},
    {id:'tvOne.id@SD', name:'tvOne', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/TvOne_2023.svg/200px-TvOne_2023.svg.png', group:'Berita', groupSlug:'news', country:'ID', url:'http://202.80.222.20/cdn/iptv/Tvod/001/channel2000018/1024.m3u8'},
    {id:'MetroTV.id@SD', name:'Metro TV', logo:'https://i.imgur.com/QnU70NI.png', group:'Berita', groupSlug:'news', country:'ID', url:'http://edge.metrotvnews.com:1935/live-edge/smil:metro.smil/chunklist_w2006790992_b1492000_sleng.m3u8'},
    {id:'CNBCIndonesia.id@SD', name:'CNBC Indonesia', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/CNBC_Indonesia_2025.svg/200px-CNBC_Indonesia_2025.svg.png', group:'Bisnis', groupSlug:'business', country:'ID', url:'https://live.cnbcindonesia.com/livecnbc/smil:cnbctv.smil/master.m3u8'},
    {id:'NusantaraTV.id@SD', name:'Nusantara TV', logo:'https://i.imgur.com/viun5hj.png', group:'Umum', groupSlug:'general', country:'ID', url:'https://nusantaratv.siar.us/nusantaratv/live/playlist.m3u8'},
    {id:'GarudaTV.id@SD', name:'Garuda TV', logo:'https://i.imgur.com/sXsAcZ3.png', group:'Umum', groupSlug:'general', country:'ID', url:'https://hgmtv.com:19360/garudatvlivestreaming/garudatvlivestreaming.m3u8'},
    {id:'RRINet.id@SD', name:'RRI Net', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/RRI_NET_2023.svg/200px-RRI_NET_2023.svg.png', group:'Umum', groupSlug:'general', country:'ID', url:'https://private-streaming.rri.go.id/memfs/6f77c7b5-feb2-4935-9f89-e7e9fca0a54a_output_0.m3u8'},
    {id:'DAAITV.id@SD', name:'DAAI TV', logo:'https://i.imgur.com/YC7JCHo.png', group:'Religi', groupSlug:'religious', country:'ID', url:'https://pull.daaiplus.com/live-DAAIPLUS/live-DAAIPLUS_HD.m3u8'},
    {id:'BBCNews.uk', name:'BBC News', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/BBC_World_News_2022.svg/200px-BBC_World_News_2022.svg.png', group:'Berita', groupSlug:'news', country:'GB', url:'https://vs-hls-push-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_news_channel_hd/mobile_wifi_main_hd_abr_v2.m3u8'},
    {id:'AlJazeera.qa', name:'Al Jazeera', logo:'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Al_Jazeera_Logo.svg/200px-Al_Jazeera_Logo.svg.png', group:'Berita', groupSlug:'news', country:'QA', url:'https://live-hls-web-ajm.getaj.net/AJM/index.m3u8'},
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
  const isHLS = /\.m3u8/i.test(url) || url.includes('m3u8');

  if (isHLS) {
    // 1. Coba memuat manifest via CORS proxy (paling akurat jika berhasil)
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
          // Manifest HLS harus memiliki tag identifikasi ini
          if (txt.includes('#EXTM3U') || txt.includes('#EXT-X-') || txt.includes('EXTINF')) {
            return 'online';
          }
        }
        // Jika status error (seperti 403 atau 500 dari proxy), jangan langsung offline, coba proxy berikutnya
      } catch(e) {
        if (e.name === 'AbortError') return 'offline'; // Timeout global = offline
        // Coba proxy berikutnya jika network error pada proxy
        continue;
      }
    }
  }

  // 2. Fallback: Coba direct connection tanpa proxy dengan no-cors.
  // Ini sangat berguna jika saluran memblokir IP proxy luar negeri (geoblock) tetapi bisa diakses IP lokal Indonesia.
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 4000);
    // Coba HEAD request langsung terlebih dahulu (cepat dan hemat kuota)
    await fetch(url, { method: 'HEAD', signal: ctrl.signal, mode: 'no-cors' });
    clearTimeout(id);
    return 'online'; // Server merespons (opaque response)
  } catch(e) {
    if (e.name === 'AbortError') return 'offline';
    
    // Beberapa server menolak HEAD request, coba GET request dengan no-cors sebagai last resort
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 4000);
      await fetch(url, { method: 'GET', signal: ctrl.signal, mode: 'no-cors' });
      clearTimeout(id);
      return 'online';
    } catch(e2) {
      return 'offline';
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
function getLogoPlaceholderHtml(name, hasLogo) {
  const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  let initials = '';
  if (words.length >= 2) {
    initials = (words[0][0] + words[1][0]).toUpperCase();
  } else if (clean.length > 0) {
    initials = clean.slice(0, 2).toUpperCase();
  } else {
    initials = 'TV';
  }
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 45) % 360;
  
  const grad = `linear-gradient(135deg, hsl(${h1}, 75%, 45%), hsl(${h2}, 85%, 35%))`;
  
  return `<div class="card-logo-ph-custom" style="background:${grad}; display:${hasLogo?'none':'flex'}"><span>${initials}</span></div>`;
}

function updateCountryTriggerUI(code, name) {
  if (code) {
    if (D.selectedCountryFlag) {
      D.selectedCountryFlag.src = `https://flagcdn.com/w40/${code.toLowerCase()}.png`;
      D.selectedCountryFlag.style.display = 'inline-block';
    }
    if (D.selectedCountryEmoji) D.selectedCountryEmoji.style.display = 'none';
  } else {
    if (D.selectedCountryFlag) D.selectedCountryFlag.style.display = 'none';
    if (D.selectedCountryEmoji) {
      D.selectedCountryEmoji.style.display = 'inline-block';
      D.selectedCountryEmoji.textContent = '🌍';
    }
  }
  if (D.selectedCountryName) D.selectedCountryName.textContent = name;
}

async function selectCountry(code, name) {
  S.country = code;
  updateCountryTriggerUI(code, name);
  
  D.countrySelectOptions?.classList.add('hidden');
  D.countryCustomSelect?.classList.remove('open');
  
  if (S.mode === 'country') {
    if (S.country) {
      await reloadMode();
    } else {
      S.mode = 'api';
      D.playlistTabs?.querySelectorAll('.ptab').forEach(t => {
        t.classList.toggle('active', t.dataset.mode === 'api');
      });
      D.catSec.style.display='';
      if (D.countrySearch) {
        D.countrySearch.value = '';
        renderCountryOptions('');
      }
      await reloadMode();
    }
  } else {
    applyFilters();
  }
}

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
  
  S.countriesList = sorted.map(([code, count]) => ({
    code,
    count,
    name: CNAMES[code] || code
  }));

  if (D.countrySearch) D.countrySearch.value = '';
  
  // Set default trigger state
  if (cnt['ID']) {
    S.country = 'ID';
    updateCountryTriggerUI('ID', 'Indonesia');
  } else {
    S.country = '';
    updateCountryTriggerUI('', 'Semua Negara');
  }

  renderCountryOptions('');
}

function renderCountryOptions(q) {
  const container = D.countryOptionsList;
  if (!container) return;

  container.innerHTML = '';
  
  // Semua negara item
  const allItem = document.createElement('div');
  allItem.className = 'option-item' + (!S.country ? ' active' : '');
  allItem.innerHTML = `<span>🌍</span> <span>Semua Negara</span>`;
  allItem.addEventListener('click', () => selectCountry('', 'Semua Negara'));
  container.appendChild(allItem);

  const query = q.toLowerCase().trim();
  const filtered = S.countriesList.filter(c => {
    if (!query) return true;
    return c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query);
  });

  filtered.forEach(c => {
    const item = document.createElement('div');
    item.className = 'option-item' + (S.country === c.code ? ' active' : '');
    const flagUrl = `https://flagcdn.com/w40/${c.code.toLowerCase()}.png`;
    item.innerHTML = `
      <img class="flag-icon-img" src="${flagUrl}" alt="${c.code}" onerror="this.style.display='none'" />
      <span>${c.name} (${c.count})</span>
    `;
    item.addEventListener('click', () => selectCountry(c.code, c.name));
    container.appendChild(item);
  });
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
        <button onclick="clearFilters()" class="btn-ghost" style="margin-top:4px">
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
        <button onclick="clearFilters()" class="btn-ghost" style="margin-top:4px">
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
    ? `<img class="card-logo" src="${esc(ch.logo)}" alt="${esc(ch.name)}" loading="lazy" onerror="this.remove();this.parentElement?.querySelector('.card-logo-ph-custom')?.style.setProperty('display','flex')">`
    : '';

  const fallbackLogoHtml = getLogoPlaceholderHtml(ch.name, !!ch.logo);

  card.innerHTML = `
    <div class="card-thumb">
      ${logoHtml}
      ${fallbackLogoHtml}
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
let _autoSkipTimer;

function updateMediaSession(ch) {
  if ('mediaSession' in navigator && ch) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: ch.name,
        artist: ch.group || 'JeffTV',
        album: 'IPTV Indonesia',
        artwork: [
          { src: ch.logo || 'https://raw.githubusercontent.com/jefry195/JEFF-TV/main/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });

      const actions = {
        'play': () => { D.video?.play().catch(() => {}); },
        'pause': () => { D.video?.pause(); },
        'previoustrack': () => { playPrev(); },
        'nexttrack': () => { playNext(); }
      };

      for (const [action, handler] of Object.entries(actions)) {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch(err) {
          // ignore if action is unsupported in browser
        }
      }
    } catch(e) {
      console.warn('[JeffTV] Media Session error', e);
    }
  }
}

function playChannel(ch) {
  clearTimeout(_autoSkipTimer);
  if (!S.isAutoSkipping) {
    S.autoSkipCount = 0;
    S.autoSkipStartCh = ch;
  }

  S.currentCh = ch;
  updateMediaSession(ch);
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

  if (S.currentCh) {
    S.streamStatus[S.currentCh.url] = 'offline';
    S.currentCh.statusKey = 'offline';
    setCardStatus(S.currentCh.url, 'offline');
    updatePlayerStatusTag('offline');
    try { sessionStorage.setItem('jftv_status', JSON.stringify(S.streamStatus)); } catch(e) {}
  }

  // Auto-skip logic
  if (S.filtered && S.filtered.length > 1) {
    if (!S.autoSkipStartCh) {
      S.autoSkipStartCh = S.currentCh;
    }
    S.autoSkipCount = (S.autoSkipCount || 0) + 1;

    // Berhenti jika sudah mencoba seluruh daftar saluran untuk menghindari loop tak terbatas
    if (S.autoSkipCount < S.filtered.length) {
      showToast('⚠️ Saluran offline, memutar saluran berikutnya dalam 1.5 detik...');
      S.isAutoSkipping = true;
      _autoSkipTimer = setTimeout(() => {
        S.isAutoSkipping = false;
        playNext();
      }, 1500);
      return;
    }
  }

  // Reset auto-skip jika terpaksa berhenti atau selesai loop
  S.isAutoSkipping = false;
  S.autoSkipCount = 0;
  S.autoSkipStartCh = null;

  D.pError.classList.remove('hidden');
  D.pErrMsg.textContent = 'Stream tidak tersedia atau sedang offline.';
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
  clearTimeout(_autoSkipTimer);
  S.isAutoSkipping = false;
  S.autoSkipCount = 0;
  S.autoSkipStartCh = null;

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
async function reloadMode(forceRefresh = false) {
  D.skeleton.classList.remove('hidden');
  D.grid.classList.add('hidden');
  D.empty.classList.add('hidden');

  try {
    let chs = [];
    if (S.mode === 'api') {
      chs = await loadAPI(forceRefresh);
    } else if (S.mode === 'country' && S.country) {
      chs = await loadCountryM3U(S.country);
    } else if (S.mode === 'category' && S.categoryM3U) {
      chs = await loadCategoryM3U(S.categoryM3U);
    } else {
      chs = await loadAPI(forceRefresh);
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
  
  let targetUrl = url.trim();
  
  // Deteksi dan konversi otomatis jika user menyalin link viewer file GitHub (blob)
  if (targetUrl.includes('github.com') && targetUrl.includes('/blob/')) {
    targetUrl = targetUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    showToast('🔄 Mengonversi link GitHub ke versi Raw...');
  } else if (targetUrl.includes('github.com') && !targetUrl.includes('raw.githubusercontent.com') && !targetUrl.endsWith('.m3u') && !targetUrl.endsWith('.m3u8')) {
    showToast('⚠️ Masukkan link file .m3u spesifik (bukan halaman depan repo). Klik file M3U di Github, klik "Raw", lalu salin linknya.');
  }

  S.country = '';
  S.category = '';
  D.skeleton.classList.remove('hidden');
  D.grid.classList.add('hidden');
  D.empty.classList.add('hidden');
  showToast('🌐 Mengunduh playlist M3U kustom...');

  try {
    const txt = await fetchText(targetUrl);
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
  S.country = '';
  S.category = '';
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
  if (D.m3uPresetSelect) D.m3uPresetSelect.value = '';
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
// CUSTOM PRESETS MANAGEMENT
// ════════════════════════════════════════════
function loadCustomPresets() {
  if (!D.m3uPresetSelect) return;
  
  // Hapus opsi kustom sebelumnya
  Array.from(D.m3uPresetSelect.querySelectorAll('option[data-custom="true"]')).forEach(opt => opt.remove());

  let presets = [];
  try {
    const data = localStorage.getItem('jftv_custom_presets');
    if (data) presets = JSON.parse(data);
  } catch(e) {
    console.error('Gagal memuat preset kustom:', e);
  }

  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.url;
    opt.textContent = `👤 ${p.name}`;
    opt.setAttribute('data-custom', 'true');
    D.m3uPresetSelect.appendChild(opt);
  });
}

function saveNewPreset() {
  const name = D.newPresetName.value.trim();
  let url = D.newPresetUrl.value.trim();

  if (!name || !url) {
    showToast('⚠️ Nama dan URL preset wajib diisi!');
    return;
  }

  // Konversi otomatis jika user memasukkan link viewer file GitHub (blob)
  if (url.includes('github.com') && url.includes('/blob/')) {
    url = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showToast('⚠️ URL preset harus valid (dimulai dengan http:// atau https://)!');
    return;
  }

  let presets = [];
  try {
    const data = localStorage.getItem('jftv_custom_presets');
    if (data) presets = JSON.parse(data);
  } catch(e) {}

  // Cek duplikasi URL
  if (presets.some(p => p.url.toLowerCase() === url.toLowerCase())) {
    showToast('⚠️ URL preset ini sudah ada!');
    return;
  }

  presets.push({ name, url });

  try {
    localStorage.setItem('jftv_custom_presets', JSON.stringify(presets));
  } catch(e) {
    showToast('⚠️ Gagal menyimpan ke penyimpanan lokal.');
    return;
  }

  loadCustomPresets();
  
  // Reset form
  D.newPresetName.value = '';
  D.newPresetUrl.value = '';
  D.addPresetFormWrap.classList.add('hidden');

  showToast(`✅ Preset "${name}" berhasil ditambahkan!`);
}

function deleteSelectedPreset() {
  if (!D.m3uPresetSelect) return;
  const url = D.m3uPresetSelect.value;
  if (!url) return;

  // Temukan elemen option untuk opsi terpilih
  const selectedOpt = D.m3uPresetSelect.options[D.m3uPresetSelect.selectedIndex];
  if (!selectedOpt || selectedOpt.getAttribute('data-custom') !== 'true') return;

  let presets = [];
  try {
    const data = localStorage.getItem('jftv_custom_presets');
    if (data) presets = JSON.parse(data);
  } catch(e) {}

  presets = presets.filter(p => p.url !== url);

  try {
    localStorage.setItem('jftv_custom_presets', JSON.stringify(presets));
  } catch(e) {}

  loadCustomPresets();
  D.m3uPresetSelect.value = '';
  D.deletePresetBtn.classList.add('hidden');

  showToast('🧹 Preset kustom berhasil dihapus.');
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

  // Logo home link
  D.logoLink?.addEventListener('click', e => {
    e.preventDefault();
    closePlayer();
    clearFilters();
    if (S.mode !== 'api') {
      const apiTab = D.playlistTabs?.querySelector('[data-mode="api"]');
      apiTab?.click();
    }
  });

  // Playlist tabs
  D.playlistTabs?.querySelectorAll('.ptab').forEach(tab => {
    tab.addEventListener('click', async () => {
      D.playlistTabs.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      S.mode = tab.dataset.mode;
      S.category=''; S.categoryM3U='';

      // Clear search query & country search when changing tabs
      D.searchInput.value=''; S.query='';
      D.searchClear.classList.add('hidden');
      if (D.countrySearch) {
        D.countrySearch.value = '';
        renderCountryOptions('');
      }

      // Show/hide sections based on mode
      D.customPlaylistSec.classList.add('hidden');
      if (S.mode === 'api') {
        D.countrySec.style.display='';
        D.catSec.style.display='';
        S.country = S.country || 'ID';
        updateCountryTriggerUI(S.country, S.country === 'ID' ? 'Indonesia' : (CNAMES[S.country] || S.country));
      } else if (S.mode === 'country') {
        D.countrySec.style.display='';
        D.catSec.style.display='none';
        S.country = S.country || 'ID';
        updateCountryTriggerUI(S.country, S.country === 'ID' ? 'Indonesia' : (CNAMES[S.country] || S.country));
      } else if (S.mode === 'category') {
        D.countrySec.style.display='none';
        D.catSec.style.display='';
        S.country = ''; // Show all countries in category mode
        buildM3UCategoryFilter();
      } else if (S.mode === 'custom') {
        D.countrySec.style.display='none';
        D.catSec.style.display='none';
        S.country = ''; // Reset country filter for custom playlists
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

  // Custom Country Select events
  D.countrySelectTrigger?.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !D.countrySelectOptions.classList.contains('hidden');
    D.countrySelectOptions.classList.toggle('hidden', isOpen);
    D.countryCustomSelect.classList.toggle('open', !isOpen);
    if (!isOpen) {
      D.countrySearch?.focus();
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#country-custom-select')) {
      D.countrySelectOptions?.classList.add('hidden');
      D.countryCustomSelect?.classList.remove('open');
    }
  });

  D.countrySearch?.addEventListener('input', e => {
    renderCountryOptions(e.target.value);
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

  // PiP helpers
  function updatePipBtnIcon(inPip) {
    if (!D.pipBtn) return;
    if (inPip) {
      D.pipBtn.title = 'Keluar Picture in Picture';
      D.pipBtn.style.color = 'var(--accent)';
      D.pipBtn.querySelector('span').textContent = 'Exit PiP';
    } else {
      D.pipBtn.title = 'Picture in Picture';
      D.pipBtn.style.color = '';
      D.pipBtn.querySelector('span').textContent = 'PiP';
    }
  }

  async function togglePip() {
    if (!document.pictureInPictureEnabled) { showToast('⚠️ PiP tidak didukung browser ini'); return; }
    
    // Cegah PiP jika saluran offline/tidak ada sinyal
    if (S.currentCh && S.streamStatus[S.currentCh.url] === 'offline') {
      showToast('⚠️ Saluran sedang offline, tidak dapat menggunakan mode PiP');
      return;
    }

    // Cegah PiP jika saluran radio (audio saja)
    const isRadio = S.currentCh && (
      (S.currentCh.group || '').toLowerCase().includes('radio') ||
      (S.currentCh.category || '').toLowerCase().includes('radio')
    );
    // Hanya anggap audio-only jika media sudah ter-decode (readyState >= 3) dan videoWidth masih 0
    if (isRadio || (D.video.readyState >= 3 && D.video.videoWidth === 0)) {
      showToast('📻 Saluran radio (hanya suara) tidak memiliki video untuk ditampilkan di PiP');
      return;
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (!D.video.paused && D.video.readyState >= 2) {
        await D.video.requestPictureInPicture();
      } else {
        showToast('⏳ Memuat saluran... Tunggu sampai video muncul untuk mengaktifkan PiP');
      }
    } catch(e) {
      if (e.message && e.message.toLowerCase().includes('metadata')) {
        showToast('⏳ Menghubungkan video... Silakan coba PiP kembali saat siaran sudah muncul');
      } else {
        showToast('⚠️ PiP tidak dapat diaktifkan pada saluran ini');
      }
    }
  }

  D.pipBtn?.addEventListener('click', togglePip);

  // Update PiP button icon when PiP state changes
  D.video?.addEventListener('enterpictureinpicture', () => {
    updatePipBtnIcon(true);
    showToast('📺 PiP aktif — video tetap berjalan di latar belakang');
  });
  D.video?.addEventListener('leavepictureinpicture', () => {
    updatePipBtnIcon(false);
  });

  // Auto PiP: enter PiP when user leaves the tab/app while video is playing
  document.addEventListener('visibilitychange', async () => {
    if (!document.pictureInPictureEnabled) return;
    if (document.hidden) {
      // User left the tab — auto enter PiP if video is playing and no PiP active
      if (!D.video.paused && D.video.readyState >= 2 && !document.pictureInPictureElement) {
        try { await D.video.requestPictureInPicture(); } catch(e) { /* silently fail */ }
      }
    } else {
      // User came back to the tab — exit PiP if active
      if (document.pictureInPictureElement) {
        try { await document.exitPictureInPicture(); } catch(e) { /* silently fail */ }
      }
    }
  });

  D.fsBtn?.addEventListener('click', () => {
    const el = D.video.closest('.player-box');
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.().then(() => {
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      }).catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    }
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

  // Sync Media Session playbackState
  if ('mediaSession' in navigator) {
    D.video?.addEventListener('play', () => {
      navigator.mediaSession.playbackState = 'playing';
    });
    D.video?.addEventListener('pause', () => {
      navigator.mediaSession.playbackState = 'paused';
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA') return;
    if (e.key==='Escape') { closePlayer(); closeSb(); }
    if (e.key==='f'||e.key==='F') D.fsBtn?.click();
    if (e.key==='i'||e.key==='I') togglePip?.();
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
  D.m3uPresetSelect?.addEventListener('change', e => {
    const val = e.target.value;
    if (val) {
      D.m3uUrlInput.value = val;
      loadCustomM3UUrl(val);
    }
    const selectedOpt = D.m3uPresetSelect.options[D.m3uPresetSelect.selectedIndex];
    const isCustom = selectedOpt && selectedOpt.getAttribute('data-custom') === 'true';
    D.deletePresetBtn?.classList.toggle('hidden', !isCustom);
  });
  D.m3uFileInput?.addEventListener('change', e => {
    if (e.target.files.length) loadCustomM3UFile(e.target.files[0]);
  });
  D.clearCustomPlaylistBtn?.addEventListener('click', clearCustomPlaylist);

  D.addPresetToggle?.addEventListener('click', () => {
    D.addPresetFormWrap.classList.toggle('hidden');
    if (!D.addPresetFormWrap.classList.contains('hidden')) {
      D.newPresetName.focus();
    }
  });
  D.cancelNewPresetBtn?.addEventListener('click', () => {
    D.newPresetName.value = '';
    D.newPresetUrl.value = '';
    D.addPresetFormWrap.classList.add('hidden');
  });
  D.saveNewPresetBtn?.addEventListener('click', saveNewPreset);
  D.deletePresetBtn?.addEventListener('click', deleteSelectedPreset);

  // History events
  D.clearHistoryBtn?.addEventListener('click', clearHistory);

  // Aspect Ratio events
  D.aspectBtn?.addEventListener('click', toggleAspectRatio);

  // PWA Install events
  D.pwaInstallBtn?.addEventListener('click', handlePwaInstall);
  D.topPwaInstallBtn?.addEventListener('click', handlePwaInstall);

  // Cache Refresh events
  D.refreshCacheBtn?.addEventListener('click', async () => {
    D.refreshCacheBtn.disabled = true;
    const oldHtml = D.refreshCacheBtn.innerHTML;
    D.refreshCacheBtn.innerHTML = '⏳ Menyegarkan...';
    try {
      showToast('🔄 Memperbarui daftar saluran dari server...');
      await reloadMode(true);
      showToast('✅ Berhasil menyegarkan saluran!');
    } catch(e) {
      showToast('⚠️ Gagal menyegarkan saluran');
    } finally {
      D.refreshCacheBtn.innerHTML = oldHtml;
      D.refreshCacheBtn.disabled = false;
    }
  });
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

// PWA Custom Install Handler
function handlePwaInstall() {
  const promptEvent = window._deferredPrompt;
  if (!promptEvent) return;
  promptEvent.prompt();
  promptEvent.userChoice.then(choice => {
    if (choice.outcome === 'accepted') {
      console.log('[JeffTV] PWA installation accepted');
    }
    D.pwaInstallSec?.classList.add('hidden');
    D.topPwaInstallBtn?.classList.add('hidden');
    window._deferredPrompt = null;
  });
}


// ════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  setupEvents();
  loadCustomPresets();

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('[JeffTV] SW Registered'))
      .catch(err => console.warn('[JeffTV] SW Fail', err));
  }

  // Handle PWA installation prompts
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    window._deferredPrompt = e;
    if (D.pwaInstallSec) D.pwaInstallSec.classList.remove('hidden');
    if (D.topPwaInstallBtn) D.topPwaInstallBtn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    D.pwaInstallSec?.classList.add('hidden');
    D.topPwaInstallBtn?.classList.add('hidden');
    window._deferredPrompt = null;
    showToast('🎉 Aplikasi JeffTV berhasil dipasang!');
  });



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
