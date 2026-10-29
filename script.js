'use strict';

/* ==========================================================================
   1. CONSTANTS & UTILITIES
   ========================================================================== */

const LS_KEY = 'ledger_app_state_v1';

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function trimNumber(n, maxDecimals) {
  if (!isFinite(n)) return '0';
  let s = n.toFixed(maxDecimals);
  if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function formatAmount(n) {
  n = Number(n) || 0;
  const s = trimNumber(n, 8);
  const neg = s.startsWith('-');
  const abs = neg ? s.slice(1) : s;
  const [intPart, decPart] = abs.split('.');
  const intFmt = Number(intPart).toLocaleString('en-US');
  return (neg ? '-' : '') + (decPart ? `${intFmt}.${decPart}` : intFmt);
}

const CURRENCY_SYMBOLS = { USD: '$', PHP: '\u20B1', EUR: '\u20AC' };
function currencySymbol(code) { return CURRENCY_SYMBOLS[code] || code + ' '; }

function formatPrice(n, currency) {
  currency = currency || 'USD';
  n = Number(n) || 0;
  const symbol = currencySymbol(currency);
  if (n === 0) return symbol + '0';
  const neg = n < 0; n = Math.abs(n);
  let out;
  if (n < 1) {
    out = trimNumber(n, 10);
  } else {
    out = n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
  }
  return (neg ? '-' : '') + symbol + out;
}

function formatMoney(n, currency) {
  currency = currency || 'USD';
  n = Number(n) || 0;
  const symbol = currencySymbol(currency);
  const neg = n < 0;
  const out = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return (neg ? '-' : '') + symbol + out;
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function convertFromUSD(usd) {
  const cur = state.settings.displayCurrency;
  if (cur === 'USD') return usd;
  const rate = state.settings.rates[cur];
  return usd * (rate || 1);
}

function displayMoney(usdValue) {
  return formatMoney(convertFromUSD(usdValue), state.settings.displayCurrency);
}
function displayPrice(usdValue) {
  return formatPrice(convertFromUSD(usdValue), state.settings.displayCurrency);
}

/* ==========================================================================
   2. BUILT-IN LOGOS (local, no network) — flat monogram marks
   ========================================================================== */

const BUILTIN_LOGOS = {
  BTC: { color: '#F7931A', label: 'BTC' },
  ETH: { color: '#627EEA', label: 'ETH' },
  XLM: { color: '#08B5E5', label: 'XLM' },
  LTC: { color: '#345D9D', label: 'LTC' },
  PEPE: { color: '#4CA82D', label: 'PEPE' },
  SHX: { color: '#0AA5A6', label: 'SHX' },
  SOL: { color: '#9945FF', label: 'SOL' },
  XRP: { color: '#33383D', label: 'XRP' },
  DOGE: { color: '#C2A633', label: 'DOGE' },
  USDT: { color: '#26A17B', label: 'USDT' },
  USDC: { color: '#2775CA', label: 'USDC' }
};

function hashColor(str) {
  str = String(str || '?');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 42% 40%)`;
}

function monogramSVG(symbol, color) {
  const label = String(symbol || '?').slice(0, 4).toUpperCase();
  const fontSize = label.length > 3 ? 12 : label.length === 3 ? 13.5 : 16;
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHTML(label)} logo">
    <circle cx="20" cy="20" r="20" fill="${color}"/>
    <text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="${fontSize}" fill="#ffffff" letter-spacing="0.3">${escapeHTML(label)}</text>
  </svg>`;
}

function builtinLogoSVG(key) {
  const def = BUILTIN_LOGOS[key];
  if (!def) return null;
  return monogramSVG(def.label, def.color);
}

function fallbackLogoSVG(symbol) {
  return monogramSVG(symbol, hashColor(symbol));
}

// In-memory cache of custom logo data URLs, keyed by asset id.
const customLogoCache = new Map();

function logoMarkupForAsset(asset) {
  if (asset.logoType === 'custom' && customLogoCache.has(asset.id)) {
    return `<img src="${customLogoCache.get(asset.id)}" alt="${escapeHTML(asset.symbol)} logo">`;
  }
  if (asset.logoType === 'builtin' && asset.logoBuiltinKey && BUILTIN_LOGOS[asset.logoBuiltinKey]) {
    return builtinLogoSVG(asset.logoBuiltinKey);
  }
  return fallbackLogoSVG(asset.symbol);
}

/* ==========================================================================
   3. INDEXEDDB — storage for custom uploaded logos
   ========================================================================== */

const IDB_NAME = 'ledger-app-db';
const IDB_STORE = 'logos';
let idbAvailable = !!window.indexedDB;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  if (!idbAvailable) return false;
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.error('idbSet failed', e); return false; }
}
async function idbGet(key) {
  if (!idbAvailable) return undefined;
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { console.error('idbGet failed', e); return undefined; }
}
async function idbDelete(key) {
  if (!idbAvailable) return false;
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.error('idbDelete failed', e); return false; }
}

async function preloadCustomLogos() {
  const jobs = state.assets.filter(a => a.logoType === 'custom').map(async a => {
    const val = await idbGet('logo-' + a.id);
    if (val) customLogoCache.set(a.id, val);
    else { a.logoType = 'none'; } // upload missing/corrupted — fall back gracefully
  });
  await Promise.all(jobs);
}

/* ==========================================================================
   4. STATE & PERSISTENCE
   ========================================================================== */

function defaultState() {
  return {
    version: 1,
    assets: [],
    scenarios: [],
    goals: [],
    selectedScenarioId: null,
    settings: {
      theme: 'system',
      displayCurrency: 'USD',
      rates: { PHP: 58, EUR: 0.92 },
      fullPrecisionDefault: false,
      coinGeckoApiKey: '',
      livePrices: {}
    }
  };
}

function migrateState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const s = Object.assign({}, base, raw);
  s.assets = Array.isArray(raw.assets) ? raw.assets : [];
  s.scenarios = Array.isArray(raw.scenarios) ? raw.scenarios : [];
  s.goals = Array.isArray(raw.goals) ? raw.goals : [];
  s.goals.forEach(g => {
    if (!g.id) g.id = uid();
    if (typeof g.name !== 'string') g.name = 'Untitled Goal';
    g.targetUSD = Math.max(0, Number(g.targetUSD) || 0);
    g.allocations = g.allocations && typeof g.allocations === 'object' ? g.allocations : {};
    Object.keys(g.allocations).forEach(id => { g.allocations[id] = clamp(Number(g.allocations[id]) || 0, 0, 100); });
    if (typeof g.note !== 'string') g.note = '';
  });
  // Repair older or manually edited backups so a coin is never over-reserved.
  const usedByAsset = {};
  s.goals.forEach(g => Object.keys(g.allocations).forEach(assetId => {
    const requested = Number(g.allocations[assetId]) || 0;
    const available = Math.max(0, 100 - (usedByAsset[assetId] || 0));
    g.allocations[assetId] = Math.min(requested, available);
    usedByAsset[assetId] = (usedByAsset[assetId] || 0) + g.allocations[assetId];
  }));
  s.settings = Object.assign({}, base.settings, raw.settings || {});
  s.settings.rates = Object.assign({}, base.settings.rates, (raw.settings && raw.settings.rates) || {});
  s.settings.livePrices = Object.assign({}, (raw.settings && raw.settings.livePrices) || {});
  s.settings.coinGeckoApiKey = typeof s.settings.coinGeckoApiKey === 'string' ? s.settings.coinGeckoApiKey : '';
  s.assets.forEach(a => {
    if (!a.id) a.id = uid();
    if (typeof a.amount !== 'number') a.amount = Number(a.amount) || 0;
    if (!a.logoType) a.logoType = 'none';
    a.sellPlan = Array.isArray(a.sellPlan) ? a.sellPlan : [];
    a.targetLadder = Array.isArray(a.targetLadder) ? a.targetLadder : [];
    if (typeof a.note !== 'string') a.note = '';
    if (a.referencePrice == null) a.referencePrice = null;
    if (typeof a.coinGeckoId !== 'string') a.coinGeckoId = '';
  });
  s.scenarios.forEach(sc => {
    if (!sc.id) sc.id = uid();
    sc.prices = sc.prices && typeof sc.prices === 'object' ? sc.prices : {};
    if (typeof sc.note !== 'string') sc.note = '';
  });
  if (!s.scenarios.some(sc => sc.id === s.selectedScenarioId)) {
    s.selectedScenarioId = s.scenarios[0] ? s.scenarios[0].id : null;
  }
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    return migrateState(JSON.parse(raw));
  } catch (e) {
    console.error('Failed to load state', e);
    return defaultState();
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save state', e);
      toast('Could not save — your browser storage may be full.');
    }
  }, 120);
}

let state = loadState();

/* ==========================================================================
   5. DERIVED DATA HELPERS
   ========================================================================== */

function getAsset(id) { return state.assets.find(a => a.id === id); }
function getScenario(id) { return state.scenarios.find(s => s.id === id); }
function selectedScenario() { return state.selectedScenarioId ? getScenario(state.selectedScenarioId) : null; }

function scenarioPriceFor(scenario, assetId) {
  if (!scenario) return null;
  const v = scenario.prices[assetId];
  return (v == null || v === '') ? null : Number(v);
}

function projectedValue(asset, scenario) {
  const p = scenarioPriceFor(scenario, asset.id);
  if (p == null) return 0;
  return asset.amount * p;
}

function totalProjected(scenario) {
  return state.assets.reduce((sum, a) => sum + projectedValue(a, scenario), 0);
}

/* ==========================================================================
   LIVE PRICES — one request on app open, or when the user taps Refresh.
   No polling, timers, or background requests.
   ========================================================================== */

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  XLM: 'stellar',
  LTC: 'litecoin',
  PEPE: 'pepe',
  SHX: 'stronghold-token',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  USDT: 'tether',
  USDC: 'usd-coin',
  AXS: 'axie-infinity',
  XNO: 'nano',
  WAX: 'wax'
};

let priceRefreshInProgress = false;

function coinGeckoIdForAsset(asset) {
  return String(asset.coinGeckoId || COINGECKO_IDS[String(asset.symbol || '').toUpperCase()] || '').trim().toLowerCase();
}

function livePriceForAsset(asset) {
  const entry = state.settings.livePrices && state.settings.livePrices[asset.id];
  return entry && Number.isFinite(Number(entry.usd)) ? Number(entry.usd) : null;
}

function totalLiveValueUSD() {
  return state.assets.reduce((sum, asset) => {
    const price = livePriceForAsset(asset);
    return sum + (price == null ? 0 : Number(asset.amount || 0) * price);
  }, 0);
}

function livePriceStatusText() {
  const priced = state.assets.filter(a => livePriceForAsset(a) != null).length;
  const updatedTimes = state.assets.map(a => state.settings.livePrices[a.id]?.updatedAt).filter(Boolean);
  if (!priced) return 'No live prices loaded yet.';
  const newest = updatedTimes.length ? Math.max(...updatedTimes.map(t => new Date(t).getTime()).filter(Number.isFinite)) : 0;
  const updatedText = newest ? 'Last updated ' + new Date(newest).toLocaleString() : 'Cached prices';
  return priced + ' of ' + state.assets.length + ' assets priced · ' + updatedText;
}

async function refreshLivePrices({ quiet = false } = {}) {
  if (priceRefreshInProgress) return;
  if (!state.assets.length) {
    if (!quiet) toast('Add an asset before refreshing prices.');
    return;
  }

  const idToAssets = new Map();
  state.assets.forEach(asset => {
    const coinId = coinGeckoIdForAsset(asset);
    if (!coinId) return;
    if (!idToAssets.has(coinId)) idToAssets.set(coinId, []);
    idToAssets.get(coinId).push(asset);
  });

  if (!idToAssets.size) {
    if (!quiet) toast('Add a CoinGecko ID to your assets to fetch prices.');
    return;
  }

  priceRefreshInProgress = true;
  const refreshButtons = document.querySelectorAll('[data-action="refresh-live-prices"]');
  refreshButtons.forEach(btn => { btn.disabled = true; btn.textContent = 'Refreshing…'; });

  try {
    const params = new URLSearchParams({
      ids: Array.from(idToAssets.keys()).join(','),
      vs_currencies: 'usd',
      include_last_updated_at: 'true'
    });
    const headers = { accept: 'application/json' };
    const apiKey = String(state.settings.coinGeckoApiKey || '').trim();
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?' + params.toString(), {
      method: 'GET',
      headers,
      cache: 'no-store'
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('CoinGecko rate limit reached. Wait a little before trying again.');
      if (response.status === 401 || response.status === 403) throw new Error('CoinGecko rejected the request. Check your API key in Settings.');
      throw new Error('Price service returned HTTP ' + response.status + '.');
    }

    const data = await response.json();
    const now = new Date().toISOString();
    let updated = 0;
    for (const [coinId, assets] of idToAssets.entries()) {
      const priceData = data[coinId];
      if (!priceData || !Number.isFinite(Number(priceData.usd))) continue;
      const price = Number(priceData.usd);
      assets.forEach(asset => {
        state.settings.livePrices[asset.id] = {
          usd: price,
          updatedAt: priceData.last_updated_at ? new Date(priceData.last_updated_at * 1000).toISOString() : now,
          coinId
        };
        updated++;
      });
    }

    saveState();
    render();
    if (!quiet) {
      if (updated) toast('Updated prices for ' + updated + ' asset' + (updated === 1 ? '' : 's') + '.');
      else toast('No prices returned. Check each asset’s CoinGecko ID.');
    }
  } catch (error) {
    console.error('Price refresh failed:', error);
    if (!quiet) toast(error.message || 'Could not refresh prices. Check your connection and CoinGecko settings.');
  } finally {
    priceRefreshInProgress = false;
    document.querySelectorAll('[data-action="refresh-live-prices"]').forEach(btn => {
      btn.disabled = false;
      btn.innerHTML = '<span class="nav-icon" data-icon="refresh"></span>Refresh Prices';
    });
  }
}

/* ==========================================================================
   6. TOASTS & CONFIRM DIALOG
   ========================================================================== */

function toast(msg) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, 2600);
}

function confirmDialog({ title, message, confirmLabel, danger, onConfirm }) {
  openModal({
    title: title || 'Are you sure?',
    small: true,
    bodyHTML: `<p style="font-size:14px;color:var(--ink-soft);line-height:1.5;">${escapeHTML(message || '')}</p>`,
    footerHTML: `
      <button class="btn" data-action="close-modal">Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok-btn">${escapeHTML(confirmLabel || 'Confirm')}</button>
    `,
    onMount: (root) => {
      root.querySelector('#confirm-ok-btn').addEventListener('click', () => {
        closeModal();
        onConfirm && onConfirm();
      });
    }
  });
}

/* ==========================================================================
   7. MODAL SYSTEM
   ========================================================================== */

let modalCleanup = null;

function openModal({ title, bodyHTML, footerHTML, onMount, small, wide }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal ${small ? 'modal-small' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title-text" style="${wide ? 'max-width:640px' : ''}">
        <div class="sheet-handle"></div>
        <div class="modal-header">
          <h3 class="modal-title" id="modal-title-text">${escapeHTML(title || '')}</h3>
          <button class="icon-btn" data-action="close-modal" aria-label="Close dialog"><span class="nav-icon" data-icon="close"></span></button>
        </div>
        <div class="modal-body">${bodyHTML || ''}</div>
        ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
      </div>
    </div>`;
  document.body.style.overflow = 'hidden';

  const overlay = document.getElementById('modal-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escHandler);
  modalCleanup = () => document.removeEventListener('keydown', escHandler);

  if (onMount) onMount(root);
  const first = root.querySelector('input, select, textarea, button');
  if (first) setTimeout(() => first.focus(), 30);
}

function closeModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  document.body.style.overflow = '';
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
  if (assetFormOrphanLogoId) {
    const orphan = assetFormOrphanLogoId;
    assetFormOrphanLogoId = null;
    if (!getAsset(orphan)) { customLogoCache.delete(orphan); idbDelete('logo-' + orphan); }
  }
}

/* ==========================================================================
   8. RENDER ROOT / NAVIGATION
   ========================================================================== */

let currentView = 'portfolio';
const VIEW_TITLES = { portfolio: 'Portfolio', scenarios: 'Scenarios', goals: 'Goals', calculator: 'Calculator', settings: 'Settings' };

function setView(view) {
  currentView = view;
  document.getElementById('topbar-title').textContent = VIEW_TITLES[view];
  document.querySelectorAll('.nav-btn, .bnav-btn').forEach(btn => {
    if (btn.dataset.view === view) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  const main = document.getElementById('main');
  main.scrollTop = 0;
  render();
  main.focus({ preventScroll: true });
}

function render() {
  const main = document.getElementById('main');
  if (currentView === 'portfolio') main.innerHTML = renderPortfolioView();
  else if (currentView === 'scenarios') main.innerHTML = renderScenariosView();
  else if (currentView === 'goals') main.innerHTML = renderGoalsView();
  else if (currentView === 'calculator') main.innerHTML = renderCalculatorView();
  else if (currentView === 'settings') main.innerHTML = renderSettingsView();
}

/* ==========================================================================
   9. PORTFOLIO VIEW
   ========================================================================== */

function renderPortfolioView() {
  const scenario = selectedScenario();
  const total = scenario ? totalProjected(scenario) : 0;

  if (state.assets.length === 0) {
    return `
      <div class="empty-state">
        <h3>No assets yet</h3>
        <p>Add your crypto holdings to start creating hypothetical price scenarios.</p>
        <button class="btn btn-primary" data-action="open-asset-form"><span class="nav-icon" data-icon="add"></span>Add Asset</button>
      </div>`;
  }

  const rows = state.assets.map(a => {
    const price = scenarioPriceFor(scenario, a.id);
    const value = price == null ? 0 : a.amount * price;
    const livePrice = livePriceForAsset(a);
    const liveValue = livePrice == null ? null : a.amount * livePrice;
    return `
      <button class="ledger-row" data-action="open-asset-detail" data-id="${a.id}">
        <span class="ledger-identity">
          <span class="ledger-logo">${logoMarkupForAsset(a)}</span>
          <span class="ledger-names">
            <span class="ledger-name">${escapeHTML(a.name)}</span><br>
            <span class="ledger-symbol">${escapeHTML(a.symbol)}</span>
          </span>
        </span>
        <span class="ledger-figures">
          <span class="ledger-holding mono">${formatAmount(a.amount)} ${escapeHTML(a.symbol)}</span><br>
          <span class="ledger-projected mono">${liveValue == null ? '—' : displayMoney(liveValue)}</span>
          <span class="ledger-target-line">${livePrice == null ? 'Current price unavailable' : 'Price ' + displayPrice(livePrice)}</span>
          <span class="ledger-scenario-line">${price == null ? 'No scenario target' : 'Scenario: ' + displayMoney(value)}</span>
        </span>
        <span class="icon-btn" data-action="open-asset-menu" data-id="${a.id}" role="button" aria-label="Asset actions" tabindex="-1"><span class="nav-icon" data-icon="more"></span></span>
      </button>`;
  }).join('');

  const allocHTML = scenario && total > 0 ? renderAllocationPanel(scenario, total) : '';

  return `
    <div class="view-header">
      <div>
        <h1 class="view-title">Portfolio</h1>
        <p class="view-sub">Current prices refresh on demand. No background polling.</p>
      </div>
      <div class="header-actions">
        <button class="btn" data-action="refresh-live-prices"><span class="nav-icon" data-icon="refresh"></span>Refresh Prices</button>
        <button class="btn btn-primary" data-action="open-asset-form"><span class="nav-icon" data-icon="add"></span>Add</button>
      </div>
    </div>

    <div class="totals-card live-totals-card">
      <div class="totals-eyebrow">Current Portfolio Value</div>
      <div class="totals-value mono">${state.assets.some(a => livePriceForAsset(a) != null) ? displayMoney(totalLiveValueUSD()) : '—'}</div>
      <div class="totals-meta">
        <span class="meta-chip" id="live-price-status">${escapeHTML(livePriceStatusText())}</span>
      </div>
    </div>

    <div class="totals-card">
      <div class="totals-eyebrow">Total Projected Value</div>
      <div class="totals-value mono">${scenario ? displayMoney(total) : '—'}</div>
      <div class="totals-meta">
        <button class="meta-chip scenario-select-btn" data-action="open-scenario-picker">${scenario ? escapeHTML(scenario.name) : 'Choose a scenario'}</button>
        <span class="meta-chip"><strong>${state.assets.length}</strong>&nbsp;Assets</span>
        <span class="meta-chip"><strong>${state.scenarios.length}</strong>&nbsp;Scenarios</span>
      </div>
    </div>

    <div class="ledger">${rows}</div>
    ${allocHTML}
  `;
}

function renderAllocationPanel(scenario, total) {
  const rows = state.assets.map(a => {
    const v = projectedValue(a, scenario);
    const pct = total > 0 ? (v / total) * 100 : 0;
    if (v <= 0) return '';
    return `
      <div class="alloc-row">
        <div class="alloc-top"><span class="alloc-symbol">${escapeHTML(a.symbol)}</span><span class="alloc-pct mono">${pct.toFixed(1)}%</span></div>
        <div class="alloc-track"><div class="alloc-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
  return `<div class="panel"><h3 class="panel-title">Allocation — ${escapeHTML(scenario.name)}</h3>${rows}</div>`;
}

/* ---- Scenario quick-picker action sheet ---- */
function openScenarioPicker() {
  if (state.scenarios.length === 0) {
    openModal({
      title: 'No scenarios yet',
      bodyHTML: `<p style="font-size:14px;color:var(--ink-soft);">Create a scenario with hypothetical prices to see projected values.</p>`,
      footerHTML: `<button class="btn btn-primary btn-full" data-action="close-and-new-scenario">New Scenario</button>`
    });
    return;
  }
  const items = state.scenarios.map(s => `
    <button data-action="select-scenario" data-id="${s.id}">
      <span class="scenario-radio ${state.selectedScenarioId === s.id ? 'checked' : ''}"></span>
      ${escapeHTML(s.name)}
    </button>`).join('');
  openModal({
    title: 'Choose a scenario',
    small: true,
    bodyHTML: `<div class="action-sheet-list">${items}</div>`,
  });
}

/* ==========================================================================
   10. ADD / EDIT ASSET FORM
   ========================================================================== */

let assetFormDraft = null; // { id, isNew, logoType, logoBuiltinKey, pendingLogoSaved }
let assetFormOrphanLogoId = null; // tracks an uploaded-but-unsaved custom logo to clean up if the form is dismissed

function openAssetForm(assetId) {
  const existing = assetId ? getAsset(assetId) : null;
  assetFormDraft = {
    id: existing ? existing.id : uid(),
    isNew: !existing,
    name: existing ? existing.name : '',
    symbol: existing ? existing.symbol : '',
    amount: existing ? existing.amount : '',
    coinGeckoId: existing ? (existing.coinGeckoId || '') : '',
    logoType: existing ? existing.logoType : 'none',
    logoBuiltinKey: existing ? existing.logoBuiltinKey : null,
    note: existing ? existing.note : '',
    userChoseLogo: !!existing && existing.logoType !== 'none'
  };
  if (assetFormDraft.logoType === 'custom' && customLogoCache.has(assetFormDraft.id)) {
    assetFormDraft._customPreview = customLogoCache.get(assetFormDraft.id);
  }

  openModal({
    title: existing ? 'Edit Asset' : 'Add Asset',
    bodyHTML: assetFormBodyHTML(),
    footerHTML: `
      <button class="btn" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="save-asset">${existing ? 'Save Changes' : 'Add Asset'}</button>
    `,
    onMount: bindAssetFormEvents
  });
}

function assetFormBodyHTML() {
  const d = assetFormDraft;
  const builtinGrid = Object.keys(BUILTIN_LOGOS).map(key => `
    <button type="button" class="builtin-logo-opt ${d.logoType === 'builtin' && d.logoBuiltinKey === key ? 'selected' : ''}" data-action="pick-builtin-logo" data-key="${key}" title="${key}">
      ${builtinLogoSVG(key)}
    </button>`).join('');

  let previewMarkup;
  if (d.logoType === 'custom' && d._customPreview) previewMarkup = `<img src="${d._customPreview}" alt="Custom logo preview">`;
  else if (d.logoType === 'builtin' && d.logoBuiltinKey) previewMarkup = builtinLogoSVG(d.logoBuiltinKey);
  else previewMarkup = fallbackLogoSVG(d.symbol || '?');

  return `
    <div class="field">
      <label for="af-name">Coin Name</label>
      <input class="input" id="af-name" type="text" placeholder="Bitcoin" value="${escapeHTML(d.name)}" maxlength="60">
      <span class="error-text hidden" id="af-name-err">Please enter the coin's name.</span>
    </div>
    <div class="input-group">
      <div class="field">
        <label for="af-symbol">Symbol</label>
        <input class="input" id="af-symbol" type="text" placeholder="BTC" value="${escapeHTML(d.symbol)}" maxlength="10" style="text-transform:uppercase">
        <span class="error-text hidden" id="af-symbol-err">Please enter a symbol.</span>
      </div>
      <div class="field">
        <label for="af-amount">Amount Held</label>
        <input class="input mono" id="af-amount" type="number" inputmode="decimal" step="any" min="0" placeholder="30" value="${d.amount}">
        <span class="error-text hidden" id="af-amount-err">Please enter the amount you hold.</span>
      </div>
    </div>

    <div class="field">
      <label for="af-coingecko-id">CoinGecko ID <span style="font-weight:400;color:var(--ink-soft);">(optional)</span></label>
      <input class="input mono" id="af-coingecko-id" type="text" placeholder="bitcoin, stellar, stronghold-token" value="${escapeHTML(d.coinGeckoId || '')}" maxlength="100">
      <span class="hint">Used to fetch the current price. Common coins are detected automatically. Find the ID in the coin’s CoinGecko URL if needed.</span>
    </div>

    <div class="field">
      <label>Logo</label>
      <div class="logo-picker">
        <div class="logo-preview" id="af-logo-preview">${previewMarkup}</div>
        <div class="logo-actions">
          <label class="btn btn-small" for="af-upload">Upload image</label>
          <input type="file" id="af-upload" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden">
          <button type="button" class="btn btn-small" data-action="remove-logo">Remove</button>
        </div>
      </div>
      <span class="hint">Choose a built-in mark below, or upload PNG / JPG / WebP / SVG. Otherwise a symbol icon is used automatically.</span>
      <div class="builtin-logo-grid">${builtinGrid}</div>
    </div>

    <div class="field">
      <label for="af-note">Note <span style="font-weight:400;color:var(--ink-soft);">(optional)</span></label>
      <textarea class="input" id="af-note" placeholder="Personal notes about this holding...">${escapeHTML(d.note)}</textarea>
    </div>
  `;
}

function refreshAssetFormLogoUI(root) {
  const d = assetFormDraft;
  root.querySelector('#af-logo-preview').innerHTML =
    d.logoType === 'custom' && d._customPreview ? `<img src="${d._customPreview}" alt="Custom logo preview">` :
    d.logoType === 'builtin' && d.logoBuiltinKey ? builtinLogoSVG(d.logoBuiltinKey) :
    fallbackLogoSVG(document.getElementById('af-symbol').value || '?');
  root.querySelectorAll('.builtin-logo-opt').forEach(btn => {
    btn.classList.toggle('selected', d.logoType === 'builtin' && d.logoBuiltinKey === btn.dataset.key);
  });
}

function bindAssetFormEvents(root) {
  const symbolInput = root.querySelector('#af-symbol');
  symbolInput.addEventListener('input', () => {
    symbolInput.value = symbolInput.value.toUpperCase();
    if (!assetFormDraft.userChoseLogo) {
      const match = BUILTIN_LOGOS[symbolInput.value.trim()];
      if (match) { assetFormDraft.logoType = 'builtin'; assetFormDraft.logoBuiltinKey = symbolInput.value.trim(); }
      else { assetFormDraft.logoType = 'none'; assetFormDraft.logoBuiltinKey = null; }
      refreshAssetFormLogoUI(root);
    }
  });

  root.querySelectorAll('[data-action="pick-builtin-logo"]').forEach(btn => {
    btn.addEventListener('click', () => {
      assetFormDraft.logoType = 'builtin';
      assetFormDraft.logoBuiltinKey = btn.dataset.key;
      assetFormDraft.userChoseLogo = true;
      refreshAssetFormLogoUI(root);
    });
  });

  root.querySelector('[data-action="remove-logo"]').addEventListener('click', () => {
    assetFormDraft.logoType = 'none';
    assetFormDraft.logoBuiltinKey = null;
    assetFormDraft._customPreview = null;
    assetFormDraft.userChoseLogo = true;
    refreshAssetFormLogoUI(root);
  });

  root.querySelector('#af-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast('That image is too large. Please choose a file under 3MB.'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const ok = await idbSet('logo-' + assetFormDraft.id, dataUrl);
      if (!ok) { toast('Could not store that image in this browser.'); return; }
      customLogoCache.set(assetFormDraft.id, dataUrl);
      assetFormDraft.logoType = 'custom';
      assetFormDraft._customPreview = dataUrl;
      assetFormDraft.userChoseLogo = true;
      assetFormDraft.pendingLogoSaved = true;
      assetFormOrphanLogoId = assetFormDraft.id;
      refreshAssetFormLogoUI(root);
    };
    reader.readAsDataURL(file);
  });
}

async function saveAssetFromForm() {
  const root = document.getElementById('modal-root');
  const name = root.querySelector('#af-name').value.trim();
  const symbol = root.querySelector('#af-symbol').value.trim().toUpperCase();
  const amountRaw = root.querySelector('#af-amount').value;
  const note = root.querySelector('#af-note').value.trim();
  const amount = Number(amountRaw);

  let valid = true;
  toggleFieldError('af-name-err', !name); if (!name) valid = false;
  toggleFieldError('af-symbol-err', !symbol); if (!symbol) valid = false;
  const amountInvalid = amountRaw === '' || isNaN(amount) || amount <= 0;
  toggleFieldError('af-amount-err', amountInvalid); if (amountInvalid) valid = false;
  if (!valid) return;

  const d = assetFormDraft;
  const existing = getAsset(d.id);
  const assetData = {
    id: d.id, name, symbol, amount,
    coinGeckoId: (root.querySelector('#af-coingecko-id').value.trim().toLowerCase() || COINGECKO_IDS[symbol] || ''),
    logoType: d.logoType, logoBuiltinKey: d.logoBuiltinKey,
    note,
    sellPlan: existing ? existing.sellPlan : [],
    targetLadder: existing ? existing.targetLadder : [],
    referencePrice: existing ? existing.referencePrice : null
  };

  if (d.logoType !== 'custom' && customLogoCache.has(d.id)) {
    // logo was removed/changed away from a previously-saved custom upload
    customLogoCache.delete(d.id);
    idbDelete('logo-' + d.id);
  }

  if (existing) Object.assign(existing, assetData);
  else state.assets.push(assetData);

  saveState();
  closeModal();
  render();
  toast(existing ? 'Asset updated.' : 'Asset added.');
}

function toggleFieldError(id, show) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !show);
  const inputId = id.replace('-err', '');
  const input = document.getElementById(inputId);
  if (input) input.classList.toggle('has-error', show);
}

function deleteAsset(id) {
  const asset = getAsset(id);
  if (!asset) return;
  confirmDialog({
    title: 'Delete this asset?',
    message: `"${asset.name}" and its sell plan and notes will be permanently removed from this browser.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      state.assets = state.assets.filter(a => a.id !== id);
      delete state.settings.livePrices[id];
      state.scenarios.forEach(s => { delete s.prices[id]; });
      if (customLogoCache.has(id)) { customLogoCache.delete(id); idbDelete('logo-' + id); }
      saveState();
      render();
      toast('Asset deleted.');
    }
  });
}

function openAssetMenu(id) {
  const asset = getAsset(id);
  if (!asset) return;
  openModal({
    title: asset.name,
    small: true,
    bodyHTML: `
      <div class="action-sheet-list">
        <button data-action="menu-view-detail" data-id="${id}">View details</button>
        <button data-action="menu-edit-asset" data-id="${id}">Edit</button>
        <button class="danger" data-action="menu-delete-asset" data-id="${id}">Delete</button>
      </div>`
  });
}

/* ==========================================================================
   11. ASSET DETAIL MODAL (target ladder, partial sell, sell plan, notes)
   ========================================================================== */

let detailUI = null; // transient UI-only state for the open asset detail modal

function openAssetDetail(assetId) {
  const asset = getAsset(assetId);
  if (!asset) return;
  detailUI = { assetId, sellPercent: null, sellCustomAmount: '', sellPrice: '', newLadderPrice: '', spAmount: '', spPrice: '' };
  const scenario = selectedScenario();
  if (scenario) {
    const p = scenarioPriceFor(scenario, assetId);
    if (p != null) detailUI.sellPrice = String(p);
  }
  openModal({
    title: asset.name,
    wide: true,
    bodyHTML: renderAssetDetailBody(),
    onMount: bindAssetDetailEvents
  });
}

function refreshAssetDetail() {
  const body = document.querySelector('.modal-body');
  if (!body) return;
  body.innerHTML = renderAssetDetailBody();
  bindAssetDetailEvents(document.getElementById('modal-root'));
}

function renderAssetDetailBody() {
  const asset = getAsset(detailUI.assetId);
  if (!asset) return '<p>This asset no longer exists.</p>';
  const scenario = selectedScenario();
  const price = scenarioPriceFor(scenario, asset.id);
  const value = price == null ? 0 : asset.amount * price;
  const total = scenario ? totalProjected(scenario) : 0;
  const pct = total > 0 ? (value / total) * 100 : 0;

  const ladderRows = (asset.targetLadder || []).map((p, i) => `
    <div class="ladder-row">
      <span class="mono" style="width:90px;color:var(--ink-soft);font-size:13px;">${displayPrice(p)}</span>
      <span class="ladder-arrow">&rarr;</span>
      <span class="mono" style="font-weight:600;">${displayMoney(asset.amount * p)}</span>
      <button class="icon-btn" data-action="remove-ladder-price" data-index="${i}" aria-label="Remove target price"><span class="nav-icon" data-icon="close"></span></button>
    </div>`).join('') || `<p style="font-size:13px;color:var(--ink-soft);">No target prices added yet.</p>`;

  const percents = [10, 25, 50, 75, 100];
  const percentBtns = percents.map(p => `<button data-action="sell-percent" data-p="${p}" class="${detailUI.sellPercent === p ? 'selected' : ''}">${p}%</button>`).join('')
    + `<button data-action="sell-percent" data-p="custom" class="${detailUI.sellPercent === 'custom' ? 'selected' : ''}">Custom</button>`;

  let sellAmount = 0;
  if (detailUI.sellPercent === 'custom') sellAmount = Number(detailUI.sellCustomAmount) || 0;
  else if (detailUI.sellPercent) sellAmount = asset.amount * (detailUI.sellPercent / 100);
  sellAmount = clamp(sellAmount, 0, asset.amount);
  const sellPriceNum = Number(detailUI.sellPrice) || 0;
  const proceeds = sellAmount * sellPriceNum;
  const remaining = asset.amount - sellAmount;

  const sellPlan = asset.sellPlan || [];
  const spTotalAmount = sellPlan.reduce((s, l) => s + l.amount, 0);
  const spTotalProceeds = sellPlan.reduce((s, l) => s + l.amount * l.price, 0);
  const spRemaining = asset.amount - spTotalAmount;
  const spOverflow = spTotalAmount > asset.amount + 1e-9;

  const sellPlanRows = sellPlan.map((lvl, i) => `
    <div class="sellplan-row">
      <span class="grip" aria-hidden="true">&#8942;&#8942;</span>
      <div class="sellplan-fields">
        <input class="input mono" type="number" step="any" min="0" data-action="sp-edit-amount" data-index="${i}" value="${lvl.amount}" aria-label="Amount to sell">
        <input class="input mono" type="number" step="any" min="0" data-action="sp-edit-price" data-index="${i}" value="${lvl.price}" aria-label="Sell price">
      </div>
      <button class="icon-btn" data-action="sp-move-up" data-index="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
      <button class="icon-btn" data-action="sp-move-down" data-index="${i}" aria-label="Move down" ${i === sellPlan.length - 1 ? 'disabled' : ''}>&darr;</button>
      <button class="icon-btn" data-action="sp-delete" data-index="${i}" aria-label="Delete level"><span class="nav-icon" data-icon="close"></span></button>
    </div>`).join('') || `<p style="font-size:13px;color:var(--ink-soft);">No exit plan levels yet.</p>`;

  return `
    <div class="ledger-identity" style="margin-bottom:14px;">
      <span class="ledger-logo" style="width:48px;height:48px;">${logoMarkupForAsset(asset)}</span>
      <span class="ledger-names">
        <span class="ledger-name" style="font-size:16px;">${escapeHTML(asset.name)}</span><br>
        <span class="ledger-symbol">${escapeHTML(asset.symbol)}</span>
      </span>
    </div>

    <div class="panel">
      <div class="leader-row"><span class="leader-label">Holding</span><span class="leader-fill"></span><span class="leader-value">${formatAmount(asset.amount)} ${escapeHTML(asset.symbol)}</span></div>
      <div class="leader-row"><span class="leader-label">Current Price</span><span class="leader-fill"></span><span class="leader-value">${livePriceForAsset(asset) == null ? '—' : displayPrice(livePriceForAsset(asset))}</span></div>
      <div class="leader-row"><span class="leader-label">Current Value</span><span class="leader-fill"></span><span class="leader-value">${livePriceForAsset(asset) == null ? '—' : displayMoney(asset.amount * livePriceForAsset(asset))}</span></div>
      <div class="leader-row"><span class="leader-label">Scenario</span><span class="leader-fill"></span><span class="leader-value">${scenario ? escapeHTML(scenario.name) : 'None selected'}</span></div>
      <div class="leader-row"><span class="leader-label">Target Price</span><span class="leader-fill"></span><span class="leader-value">${price == null ? '—' : displayPrice(price)}</span></div>
      <div class="leader-row"><span class="leader-label">Projected Value</span><span class="leader-fill"></span><span class="leader-value">${price == null ? '—' : displayMoney(value)}</span></div>
      <div class="leader-row"><span class="leader-label">Allocation</span><span class="leader-fill"></span><span class="leader-value">${total > 0 ? pct.toFixed(1) + '%' : '—'}</span></div>
    </div>

    <div class="panel">
      <h4 class="panel-title">Manual Reference Price</h4>
      <div class="field" style="margin-bottom:8px;">
        <div class="prefix-input"><span class="prefix">$</span>
          <input class="input" type="number" step="any" min="0" id="ad-reference-price" placeholder="e.g. current price you've noted" value="${asset.referencePrice != null ? asset.referencePrice : ''}">
        </div>
      </div>
      ${asset.referencePrice != null && price != null && price > 0 ? `
        <div class="leader-row"><span class="leader-label">Progress to target</span><span class="leader-fill"></span><span class="leader-value">${clamp((asset.referencePrice / price) * 100, 0, 999).toFixed(1)}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${clamp((asset.referencePrice / price) * 100, 0, 100)}%"></div></div>
      ` : ''}
      <p class="hint mt-8">This manual reference price is separate from the fetched current price above.</p>
    </div>

    <div class="panel">
      <div class="panel-title-row"><h4 class="panel-title">Target Price Ladder</h4></div>
      ${ladderRows}
      <div class="input-group mt-8">
        <div class="field" style="margin-bottom:0;">
          <div class="prefix-input"><span class="prefix">$</span>
            <input class="input" type="number" step="any" min="0" id="ad-new-target" placeholder="Add a price">
          </div>
        </div>
        <button class="btn" data-action="add-ladder-price" style="flex:0 0 auto;">Add</button>
      </div>
    </div>

    <div class="panel">
      <h4 class="panel-title">Partial Selling Calculator</h4>
      <div class="segmented">${percentBtns}</div>
      ${detailUI.sellPercent === 'custom' ? `
        <div class="field mt-8"><label for="ad-sell-custom">Amount to sell (${escapeHTML(asset.symbol)})</label>
          <input class="input mono" type="number" step="any" min="0" max="${asset.amount}" id="ad-sell-custom" value="${detailUI.sellCustomAmount}"></div>` : ''}
      <div class="field mt-8"><label for="ad-sell-price">Sell price</label>
        <div class="prefix-input"><span class="prefix">$</span>
          <input class="input" type="number" step="any" min="0" id="ad-sell-price" value="${detailUI.sellPrice}"></div>
      </div>
      <div class="leader-row"><span class="leader-label">${escapeHTML(asset.symbol)} Sold</span><span class="leader-fill"></span><span class="leader-value">${formatAmount(sellAmount)} ${escapeHTML(asset.symbol)}</span></div>
      <div class="leader-row"><span class="leader-label">Estimated Proceeds</span><span class="leader-fill"></span><span class="leader-value">${displayMoney(sellAmount * sellPriceNum)}</span></div>
      <div class="leader-row"><span class="leader-label">Remaining</span><span class="leader-fill"></span><span class="leader-value">${formatAmount(remaining)} ${escapeHTML(asset.symbol)}</span></div>
    </div>

    <div class="panel">
      <h4 class="panel-title">Sell Plan (Exit Plan)</h4>
      ${sellPlanRows}
      <div class="input-group mt-8">
        <div class="field" style="margin-bottom:0;"><input class="input mono" type="number" step="any" min="0" id="ad-sp-amount" placeholder="Amount" value="${detailUI.spAmount}"></div>
        <div class="field" style="margin-bottom:0;"><input class="input mono" type="number" step="any" min="0" id="ad-sp-price" placeholder="Price ($)" value="${detailUI.spPrice}"></div>
        <button class="btn" data-action="sp-add-level" style="flex:0 0 auto;">Add Level</button>
      </div>
      ${spOverflow ? `<p class="error-text" style="display:block;margin-top:8px;">The total amount sold cannot exceed your holding of ${formatAmount(asset.amount)} ${escapeHTML(asset.symbol)}.</p>` : ''}
      <hr class="divider">
      <div class="leader-row"><span class="leader-label">Total ${escapeHTML(asset.symbol)} Sold</span><span class="leader-fill"></span><span class="leader-value">${formatAmount(spTotalAmount)} ${escapeHTML(asset.symbol)}</span></div>
      <div class="leader-row"><span class="leader-label">Estimated Total Proceeds</span><span class="leader-fill"></span><span class="leader-value">${displayMoney(spTotalProceeds)}</span></div>
      <div class="leader-row"><span class="leader-label">Remaining</span><span class="leader-fill"></span><span class="leader-value ${spRemaining < 0 ? 'text-danger' : ''}">${formatAmount(spRemaining)} ${escapeHTML(asset.symbol)}</span></div>
    </div>

    <div class="panel">
      <h4 class="panel-title">Note</h4>
      <textarea class="input" id="ad-note" placeholder="Personal notes...">${escapeHTML(asset.note || '')}</textarea>
    </div>

    <div class="flex-row" style="margin-top:4px;">
      <button class="btn" data-action="menu-edit-asset" data-id="${asset.id}" style="flex:1;">Edit Asset</button>
      <button class="btn btn-danger" data-action="menu-delete-asset" data-id="${asset.id}" style="flex:1;">Delete Asset</button>
    </div>
  `;
}

function bindAssetDetailEvents(root) {
  const asset = getAsset(detailUI.assetId);
  if (!asset) return;

  const ref = root.querySelector('#ad-reference-price');
  if (ref) ref.addEventListener('change', () => {
    const v = ref.value === '' ? null : Number(ref.value);
    asset.referencePrice = (v == null || isNaN(v)) ? null : v;
    saveState(); refreshAssetDetail();
  });

  root.querySelectorAll('[data-action="sell-percent"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.p === 'custom' ? 'custom' : Number(btn.dataset.p);
      detailUI.sellPercent = p;
      refreshAssetDetail();
    });
  });
  const sellCustom = root.querySelector('#ad-sell-custom');
  if (sellCustom) sellCustom.addEventListener('input', () => { detailUI.sellCustomAmount = sellCustom.value; refreshAssetDetail(); });
  const sellPrice = root.querySelector('#ad-sell-price');
  if (sellPrice) sellPrice.addEventListener('input', () => { detailUI.sellPrice = sellPrice.value; refreshAssetDetail(); });

  const newTarget = root.querySelector('#ad-new-target');
  const addTargetBtn = root.querySelector('[data-action="add-ladder-price"]');
  if (addTargetBtn) addTargetBtn.addEventListener('click', () => {
    const v = Number(newTarget.value);
    if (!newTarget.value || isNaN(v) || v <= 0) { toast('Please enter a valid price.'); return; }
    asset.targetLadder = asset.targetLadder || [];
    asset.targetLadder.push(v);
    asset.targetLadder.sort((a, b) => a - b);
    saveState(); refreshAssetDetail();
  });
  root.querySelectorAll('[data-action="remove-ladder-price"]').forEach(btn => {
    btn.addEventListener('click', () => {
      asset.targetLadder.splice(Number(btn.dataset.index), 1);
      saveState(); refreshAssetDetail();
    });
  });

  const spAmount = root.querySelector('#ad-sp-amount');
  const spPrice = root.querySelector('#ad-sp-price');
  if (spAmount) spAmount.addEventListener('input', () => { detailUI.spAmount = spAmount.value; });
  if (spPrice) spPrice.addEventListener('input', () => { detailUI.spPrice = spPrice.value; });
  const spAddBtn = root.querySelector('[data-action="sp-add-level"]');
  if (spAddBtn) spAddBtn.addEventListener('click', () => {
    const amt = Number(detailUI.spAmount), pr = Number(detailUI.spPrice);
    if (!detailUI.spAmount || isNaN(amt) || amt <= 0) { toast('Please enter the amount you hold.'); return; }
    if (!detailUI.spPrice || isNaN(pr) || pr <= 0) { toast('Please enter a valid price.'); return; }
    const currentTotal = (asset.sellPlan || []).reduce((s, l) => s + l.amount, 0);
    if (currentTotal + amt > asset.amount + 1e-9) { toast('The amount to sell cannot exceed your holdings.'); return; }
    asset.sellPlan = asset.sellPlan || [];
    asset.sellPlan.push({ id: uid(), amount: amt, price: pr });
    detailUI.spAmount = ''; detailUI.spPrice = '';
    saveState(); refreshAssetDetail();
  });
  root.querySelectorAll('[data-action="sp-edit-amount"]').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.index);
      asset.sellPlan[i].amount = Number(inp.value) || 0;
      saveState(); refreshAssetDetail();
    });
  });
  root.querySelectorAll('[data-action="sp-edit-price"]').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.index);
      asset.sellPlan[i].price = Number(inp.value) || 0;
      saveState(); refreshAssetDetail();
    });
  });
  root.querySelectorAll('[data-action="sp-delete"]').forEach(btn => {
    btn.addEventListener('click', () => {
      asset.sellPlan.splice(Number(btn.dataset.index), 1);
      saveState(); refreshAssetDetail();
    });
  });
  root.querySelectorAll('[data-action="sp-move-up"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index);
      if (i > 0) { [asset.sellPlan[i - 1], asset.sellPlan[i]] = [asset.sellPlan[i], asset.sellPlan[i - 1]]; saveState(); refreshAssetDetail(); }
    });
  });
  root.querySelectorAll('[data-action="sp-move-down"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index);
      if (i < asset.sellPlan.length - 1) { [asset.sellPlan[i + 1], asset.sellPlan[i]] = [asset.sellPlan[i], asset.sellPlan[i + 1]]; saveState(); refreshAssetDetail(); }
    });
  });

  const noteEl = root.querySelector('#ad-note');
  if (noteEl) noteEl.addEventListener('change', () => { asset.note = noteEl.value; saveState(); });
}

/* ==========================================================================
   12. SCENARIOS VIEW
   ========================================================================== */

function renderScenariosView() {
  if (state.scenarios.length === 0) {
    return `
      <div class="view-header">
        <div><h1 class="view-title">Scenarios</h1><p class="view-sub">Hypothetical price sets you can switch between.</p></div>
      </div>
      <div class="empty-state">
        <h3>No scenarios yet</h3>
        <p>Create a scenario like "Bull Market" or "Conservative" with a hypothetical price for each asset.</p>
        <button class="btn btn-primary" data-action="open-scenario-form"><span class="nav-icon" data-icon="add"></span>New Scenario</button>
      </div>`;
  }

  const rows = state.scenarios.map(s => {
    const total = totalProjected(s);
    const selected = state.selectedScenarioId === s.id;
    return `
      <div class="scenario-list-item">
        <span class="scenario-list-main" data-action="select-scenario" data-id="${s.id}">
          <span class="scenario-radio ${selected ? 'checked' : ''}"></span>
          <span>
            <span class="scenario-name">${escapeHTML(s.name)}</span><br>
            <span class="scenario-total mono">${displayMoney(total)} total</span>
          </span>
        </span>
        <button class="icon-btn scenario-menu-btn" data-action="open-scenario-menu" data-id="${s.id}" aria-label="Scenario actions"><span class="nav-icon" data-icon="more"></span></button>
      </div>`;
  }).join('');

  return `
    <div class="view-header">
      <div><h1 class="view-title">Scenarios</h1><p class="view-sub">Tap a scenario to make it active on the Portfolio screen.</p></div>
      <button class="btn btn-primary" data-action="open-scenario-form"><span class="nav-icon" data-icon="add"></span>New</button>
    </div>
    <div class="panel" style="padding:4px 12px;">${rows}</div>
    <button class="btn btn-full" data-action="open-compare-modal" ${state.scenarios.length < 2 ? 'disabled' : ''}>Compare Scenarios</button>
  `;
}

function selectScenario(id) {
  state.selectedScenarioId = id;
  saveState();
  closeModal();
  render();
}

function openScenarioMenu(id) {
  const s = getScenario(id);
  if (!s) return;
  openModal({
    title: s.name,
    small: true,
    bodyHTML: `
      <div class="action-sheet-list">
        <button data-action="select-scenario" data-id="${id}">Select as active</button>
        <button data-action="menu-edit-scenario" data-id="${id}">Edit prices</button>
        <button data-action="menu-rename-scenario" data-id="${id}">Rename</button>
        <button data-action="menu-duplicate-scenario" data-id="${id}">Duplicate</button>
        <button class="danger" data-action="menu-delete-scenario" data-id="${id}">Delete</button>
      </div>`
  });
}

/* ---- scenario create / edit form ---- */
function openScenarioForm(scenarioId) {
  const existing = scenarioId ? getScenario(scenarioId) : null;
  if (state.assets.length === 0 && !existing) {
    toast('Add at least one asset before creating a scenario.');
    return;
  }
  const draftPrices = existing ? Object.assign({}, existing.prices) : {};
  const priceRows = state.assets.map(a => `
    <div class="field">
      <label for="sf-price-${a.id}">${escapeHTML(a.name)} <span class="mono" style="color:var(--ink-soft);font-weight:400;">${escapeHTML(a.symbol)}</span></label>
      <div class="prefix-input"><span class="prefix">$</span>
        <input class="input" type="number" step="any" min="0" id="sf-price-${a.id}" data-asset="${a.id}" placeholder="0.00" value="${draftPrices[a.id] != null ? draftPrices[a.id] : ''}">
      </div>
    </div>`).join('');

  openModal({
    title: existing ? 'Edit Scenario' : 'New Scenario',
    bodyHTML: `
      <div class="field">
        <label for="sf-name">Scenario Name</label>
        <input class="input" id="sf-name" type="text" placeholder="Bull Market" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="40">
        <span class="error-text hidden" id="sf-name-err">Please name this scenario.</span>
      </div>
      <hr class="divider">
      <p class="hint" style="margin-bottom:10px;">Set a hypothetical price for each asset. Leave blank to exclude it from this scenario's total.</p>
      ${priceRows}
      <div class="field">
        <label for="sf-note">Note <span style="font-weight:400;color:var(--ink-soft);">(optional)</span></label>
        <textarea class="input" id="sf-note" placeholder="What does this scenario represent?">${existing ? escapeHTML(existing.note) : ''}</textarea>
      </div>
    `,
    footerHTML: `
      <button class="btn" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="save-scenario" data-id="${existing ? existing.id : ''}">${existing ? 'Save Changes' : 'Create Scenario'}</button>
    `
  });
}

function saveScenarioFromForm(existingId) {
  const root = document.getElementById('modal-root');
  const name = root.querySelector('#sf-name').value.trim();
  toggleFieldError('sf-name-err', !name);
  if (!name) return;

  const prices = {};
  state.assets.forEach(a => {
    const input = root.querySelector(`#sf-price-${a.id}`);
    if (input && input.value !== '') {
      const v = Number(input.value);
      if (!isNaN(v) && v >= 0) prices[a.id] = v;
    }
  });
  const note = root.querySelector('#sf-note').value.trim();

  let scenario = existingId ? getScenario(existingId) : null;
  if (scenario) {
    scenario.name = name; scenario.prices = prices; scenario.note = note;
  } else {
    scenario = { id: uid(), name, prices, note };
    state.scenarios.push(scenario);
    if (!selectedScenario()) state.selectedScenarioId = scenario.id;
  }
  saveState();
  closeModal();
  render();
  toast(existingId ? 'Scenario updated.' : 'Scenario created.');
}

function renameScenario(id) {
  const s = getScenario(id);
  if (!s) return;
  openModal({
    title: 'Rename Scenario',
    small: true,
    bodyHTML: `<div class="field" style="margin-bottom:0;"><label for="rn-input">Scenario Name</label><input class="input" id="rn-input" value="${escapeHTML(s.name)}" maxlength="40"></div>`,
    footerHTML: `<button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" id="rn-save">Save</button>`,
    onMount: (root) => {
      root.querySelector('#rn-save').addEventListener('click', () => {
        const v = root.querySelector('#rn-input').value.trim();
        if (!v) { toast('Please enter a scenario name.'); return; }
        s.name = v; saveState(); closeModal(); render();
      });
    }
  });
}

function duplicateScenario(id) {
  const s = getScenario(id);
  if (!s) return;
  const clone = { id: uid(), name: s.name + ' Copy', prices: Object.assign({}, s.prices), note: s.note };
  state.scenarios.push(clone);
  saveState();
  render();
  toast(`Duplicated as "${clone.name}".`);
}

function deleteScenario(id) {
  const s = getScenario(id);
  if (!s) return;
  confirmDialog({
    title: 'Delete this scenario?',
    message: `"${s.name}" will be permanently removed.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      state.scenarios = state.scenarios.filter(sc => sc.id !== id);
      if (state.selectedScenarioId === id) state.selectedScenarioId = state.scenarios[0] ? state.scenarios[0].id : null;
      saveState();
      render();
      toast('Scenario deleted.');
    }
  });
}

/* ---- compare scenarios ---- */
let compareSelection = [];

function openCompareModal() {
  compareSelection = state.selectedScenarioId ? [state.selectedScenarioId] : [];
  openModal({
    title: 'Compare Scenarios',
    bodyHTML: renderCompareBody(),
    onMount: bindCompareEvents
  });
}

function renderCompareBody() {
  const checks = state.scenarios.map(s => `
    <label class="toggle-row" style="cursor:pointer;">
      <span>
        <span class="toggle-label">${escapeHTML(s.name)}</span><br>
        <span class="toggle-desc mono">${displayMoney(totalProjected(s))}</span>
      </span>
      <input type="checkbox" data-action="compare-check" data-id="${s.id}" ${compareSelection.includes(s.id) ? 'checked' : ''} style="width:20px;height:20px;">
    </label>`).join('');

  let tableHTML = '';
  if (compareSelection.length >= 2) {
    const selected = state.scenarios.filter(s => compareSelection.includes(s.id));
    const totals = selected.map(s => totalProjected(s));
    const max = Math.max(...totals, 1);
    tableHTML = `
      <hr class="divider">
      <table class="compare-table">
        <thead><tr><th>Scenario</th><th>Total Value</th><th class="compare-bar-cell"></th></tr></thead>
        <tbody>
          ${selected.map((s, i) => `
            <tr>
              <td>${escapeHTML(s.name)}</td>
              <td class="mono">${displayMoney(totals[i])}</td>
              <td class="compare-bar-cell"><div class="compare-bar-track"><div class="compare-bar-fill" style="width:${(totals[i] / max) * 100}%"></div></div></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } else {
    tableHTML = `<p class="hint mt-16">Select 2 to 4 scenarios to compare their totals.</p>`;
  }
  return `<div>${checks}</div>${tableHTML}`;
}

function bindCompareEvents(root) {
  root.querySelectorAll('[data-action="compare-check"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        if (compareSelection.length >= 4) { cb.checked = false; toast('You can compare up to 4 scenarios.'); return; }
        compareSelection.push(id);
      } else {
        compareSelection = compareSelection.filter(x => x !== id);
      }
      document.querySelector('.modal-body').innerHTML = renderCompareBody();
      bindCompareEvents(root);
    });
  });
}

/* ==========================================================================
   GOAL PLANNER — reservations are stored as coin percentages, never fiat values.
   ========================================================================== */

function getGoal(id) { return state.goals.find(g => g.id === id); }

function goalAllocationPercent(assetId, excludeGoalId) {
  return state.goals.reduce((sum, goal) => goal.id === excludeGoalId ? sum : sum + (Number(goal.allocations[assetId]) || 0), 0);
}

function goalPriceUSD(asset) {
  const live = livePriceForAsset(asset);
  if (live != null) return live;
  const scenario = selectedScenario();
  const scenarioPrice = scenarioPriceFor(scenario, asset.id);
  return scenarioPrice == null ? null : scenarioPrice;
}

function goalSummary(goal) {
  let valueUSD = 0;
  let hasAnyPrice = false;
  const holdings = state.assets.reduce((sum, asset) => {
    const pct = Number(goal.allocations[asset.id]) || 0;
    const amount = Number(asset.amount || 0) * pct / 100;
    if (amount > 0) {
      const price = goalPriceUSD(asset);
      if (price != null) { valueUSD += amount * price; hasAnyPrice = true; }
    }
    return sum + amount;
  }, 0);
  return { valueUSD, hasAnyPrice, holdings };
}

function renderGoalsView() {
  const totalByAsset = state.assets.map(asset => ({
    asset,
    used: goalAllocationPercent(asset.id),
    remaining: Math.max(0, 100 - goalAllocationPercent(asset.id))
  }));
  const overallReserved = totalByAsset.some(x => x.used > 0);
  const reservationRows = totalByAsset.filter(x => x.used > 0).map(({asset, used, remaining}) => `
    <div style="padding:10px 0;border-bottom:1px solid var(--line);">
      <div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;">
        <span><strong>${escapeHTML(asset.symbol)}</strong> · ${formatAmount(asset.amount * used / 100)} reserved</span>
        <span class="mono">${used.toFixed(2).replace(/\.00$/, '')}% used</span>
      </div>
      <div style="height:5px;background:var(--line);border-radius:99px;margin-top:7px;overflow:hidden;"><div style="height:100%;width:${Math.min(100, used)}%;background:var(--accent);border-radius:99px;"></div></div>
      <div class="hint" style="margin-top:4px;">${remaining.toFixed(2).replace(/\.00$/, '')}% still available</div>
    </div>`).join('');

  const goalCards = state.goals.map(goal => {
    const summary = goalSummary(goal);
    const progress = goal.targetUSD > 0 && summary.hasAnyPrice ? Math.min(100, summary.valueUSD / goal.targetUSD * 100) : null;
    const assets = state.assets.filter(a => (Number(goal.allocations[a.id]) || 0) > 0).map(a => {
      const pct = Number(goal.allocations[a.id]) || 0;
      return `<div class="leader-row"><span class="leader-label">${escapeHTML(a.symbol)} · ${formatAmount(a.amount * pct / 100)}</span><span class="leader-fill"></span><span class="leader-value">${pct.toFixed(2).replace(/\.00$/, '')}%</span></div>`;
    }).join('');
    return `<section class="panel">
      <div class="panel-title-row"><div><h2 class="panel-title" style="margin-bottom:3px;">${escapeHTML(goal.name)}</h2><p class="hint">Target: ${displayMoney(goal.targetUSD)}</p></div><button class="icon-btn" data-action="open-goal-menu" data-id="${goal.id}" aria-label="Goal actions"><span class="nav-icon" data-icon="more"></span></button></div>
      <div class="totals-value mono" style="font-size:25px;">${summary.hasAnyPrice ? displayMoney(summary.valueUSD) : '—'}</div>
      <p class="hint" style="margin:4px 0 10px;">${summary.hasAnyPrice ? 'Estimated value reserved for this goal' : 'Add live prices or scenario prices to estimate this goal'}</p>
      ${progress == null ? '' : `<div style="height:6px;background:var(--line);border-radius:99px;overflow:hidden;"><div style="height:100%;width:${progress}%;background:var(--accent);border-radius:99px;"></div></div><p class="hint" style="margin-top:5px;">${progress.toFixed(1)}% of target</p>`}
      ${assets || '<p class="hint">No coins allocated yet.</p>'}
      ${goal.note ? `<p class="hint" style="margin-top:10px;">${escapeHTML(goal.note)}</p>` : ''}
    </section>`;
  }).join('');

  return `<div class="view-header"><div><h1 class="view-title">Goal Planner</h1><p class="view-sub">Reserve parts of your holdings for different goals without assigning the same coins twice.</p></div><button class="btn btn-primary" data-action="open-goal-form"><span class="nav-icon" data-icon="add"></span>New</button></div>
    <section class="panel"><h2 class="panel-title">Coin reservations</h2><p class="hint" style="margin-bottom:8px;">Each coin can be allocated up to 100% across all goals. Reservations are based on coin amounts, so changing USD, PHP, or EUR only changes the display.</p>${reservationRows || '<p class="hint">No coins are reserved for goals yet.</p>'}</section>
    ${state.goals.length ? goalCards : `<div class="empty-state"><h3>No goals yet</h3><p>Create a goal, set a target, and choose what percentage of each coin to reserve for it.</p><button class="btn btn-primary" data-action="open-goal-form"><span class="nav-icon" data-icon="add"></span>Create Goal</button></div>`}`;
}

function openGoalForm(goalId) {
  const existing = goalId ? getGoal(goalId) : null;
  if (!state.assets.length) { toast('Add at least one asset before creating a goal.'); return; }
  const targetDisplay = existing ? convertFromUSD(existing.targetUSD) : '';
  const rows = state.assets.map(asset => {
    const current = existing ? Number(existing.allocations[asset.id]) || 0 : 0;
    const otherUsed = goalAllocationPercent(asset.id, existing ? existing.id : null);
    const max = Math.max(current, 100 - otherUsed);
    return `<div class="field"><label for="gf-alloc-${asset.id}">${escapeHTML(asset.name)} <span class="mono" style="color:var(--ink-soft);font-weight:400;">${escapeHTML(asset.symbol)}</span></label><div class="input-group"><input class="input" type="number" min="0" max="${max}" step="0.01" id="gf-alloc-${asset.id}" data-goal-asset="${asset.id}" value="${current || ''}" placeholder="0" style="max-width:130px;"><span class="hint" style="align-self:center;">% of ${formatAmount(asset.amount)} ${escapeHTML(asset.symbol)} · up to ${max.toFixed(2).replace(/\.00$/, '')}% available</span></div></div>`;
  }).join('');
  openModal({ title: existing ? 'Edit Goal' : 'New Goal', wide: true, bodyHTML: `
    <div class="field"><label for="gf-name">Goal Name</label><input class="input" id="gf-name" maxlength="50" placeholder="e.g. Emergency fund" value="${existing ? escapeHTML(existing.name) : ''}"><span class="error-text hidden" id="gf-name-err">Please enter a goal name.</span></div>
    <div class="field"><label for="gf-target">Target (${escapeHTML(state.settings.displayCurrency)})</label><input class="input" id="gf-target" type="number" min="0" step="any" value="${targetDisplay === '' ? '' : targetDisplay}" placeholder="1000"><span class="hint">Saved internally in USD. Switching display currency does not change your coin reservations.</span></div>
    <div class="field"><label for="gf-note">Note (optional)</label><textarea class="input" id="gf-note" placeholder="What are you saving for?">${existing ? escapeHTML(existing.note) : ''}</textarea></div>
    <hr class="divider"><h3 class="panel-title">Reserve your holdings</h3><p class="hint" style="margin-bottom:12px;">Enter the percentage of each coin assigned to this goal. The available amount excludes coins already reserved by other goals.</p>${rows}<p class="error-text hidden" id="gf-alloc-err">One or more allocations exceed the amount available. Reduce the percentage and try again.</p>`,
    footerHTML: `<button class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-goal" data-id="${existing ? existing.id : ''}">${existing ? 'Save Changes' : 'Create Goal'}</button>`
  });
}

function saveGoalFromForm(existingId) {
  const root = document.getElementById('modal-root');
  const name = root.querySelector('#gf-name').value.trim();
  const targetInput = root.querySelector('#gf-target').value;
  const targetDisplay = targetInput === '' ? 0 : Number(targetInput);
  toggleFieldError('gf-name-err', !name);
  if (!name || !Number.isFinite(targetDisplay) || targetDisplay < 0) return;
  const currency = state.settings.displayCurrency;
  const rate = currency === 'USD' ? 1 : Number(state.settings.rates[currency]) || 1;
  const targetUSD = targetDisplay / rate;
  const allocations = {};
  let invalid = false;
  state.assets.forEach(asset => {
    const input = root.querySelector(`#gf-alloc-${asset.id}`);
    const pct = input && input.value !== '' ? Number(input.value) : 0;
    const available = Math.max(0, 100 - goalAllocationPercent(asset.id, existingId || null));
    if (!Number.isFinite(pct) || pct < 0 || pct > available + 0.000001) invalid = true;
    allocations[asset.id] = clamp(Number.isFinite(pct) ? pct : 0, 0, 100);
  });
  const err = root.querySelector('#gf-alloc-err');
  if (err) err.classList.toggle('hidden', !invalid);
  if (invalid) return;
  const note = root.querySelector('#gf-note').value.trim();
  let goal = existingId ? getGoal(existingId) : null;
  if (goal) Object.assign(goal, { name, targetUSD, allocations, note });
  else state.goals.push({ id: uid(), name, targetUSD, allocations, note });
  saveState(); closeModal(); render(); toast(existingId ? 'Goal updated.' : 'Goal created.');
}

function openGoalMenu(id) {
  const goal = getGoal(id);
  if (!goal) return;
  openModal({ title: goal.name, small: true, bodyHTML: `<div class="action-sheet-list"><button data-action="menu-edit-goal" data-id="${id}">Edit goal</button><button class="danger" data-action="menu-delete-goal" data-id="${id}">Delete goal</button></div>` });
}

function deleteGoal(id) {
  const goal = getGoal(id);
  if (!goal) return;
  confirmDialog({ title: 'Delete this goal?', message: `“${goal.name}” will be removed and its coin reservations will become available to other goals.`, confirmLabel: 'Delete', danger: true, onConfirm: () => { state.goals = state.goals.filter(g => g.id !== id); saveState(); render(); toast('Goal deleted. Reservations released.'); } });
}

/* ==========================================================================
   13. QUICK CALCULATOR VIEW
   ========================================================================== */

let qcState = { amount: '', price: '' };

function renderCalculatorView() {
  const amount = Number(qcState.amount) || 0;
  const price = Number(qcState.price) || 0;
  const value = amount * price;
  return `
    <div class="view-header">
      <div><h1 class="view-title">Calculator</h1><p class="view-sub">A fast one-off calculation — nothing here is saved.</p></div>
    </div>
    <div class="panel">
      <div class="field">
        <label for="qc-amount">Amount</label>
        <input class="input mono" type="number" inputmode="decimal" step="any" min="0" id="qc-amount" placeholder="28,000,000" value="${qcState.amount}">
      </div>
      <div class="field" style="margin-bottom:0;">
        <label for="qc-price">Price</label>
        <div class="prefix-input"><span class="prefix">${currencySymbol(state.settings.displayCurrency)}</span>
          <input class="input" type="number" step="any" min="0" id="qc-price" placeholder="0.10" value="${qcState.price}"></div>
      </div>
    </div>
    <div class="qc-result">
      <div class="totals-eyebrow">Estimated Value</div>
      <div class="totals-value mono" id="qc-result-value">${formatMoney(value, state.settings.displayCurrency)}</div>
    </div>
    <button class="btn btn-full" data-action="copy-qc-result">Copy Result</button>
  `;
}

function bindCalculatorEvents() {
  const a = document.getElementById('qc-amount');
  const p = document.getElementById('qc-price');
  if (!a) return;
  a.addEventListener('input', () => { qcState.amount = a.value; updateQCResult(); });
  p.addEventListener('input', () => { qcState.price = p.value; updateQCResult(); });
}
function updateQCResult() {
  const amount = Number(qcState.amount) || 0;
  const price = Number(qcState.price) || 0;
  document.getElementById('qc-result-value').textContent = formatMoney(amount * price, state.settings.displayCurrency);
}

/* ==========================================================================
   14. SETTINGS VIEW
   ========================================================================== */

function renderSettingsView() {
  const s = state.settings;
  return `
    <div class="view-header">
      <div><h1 class="view-title">Settings</h1></div>
    </div>

    <div class="notice-box">Your holdings and settings stay in this browser. CoinGecko receives price lookup requests only when prices are refreshed.</div>

    <div class="settings-group">
      <div class="settings-group-title">Currency</div>
      <div class="panel">
        <div class="field">
          <label for="st-currency">Display Currency</label>
          <select class="input select-native" id="st-currency">
            <option value="USD" ${s.displayCurrency === 'USD' ? 'selected' : ''}>USD — US Dollar</option>
            <option value="PHP" ${s.displayCurrency === 'PHP' ? 'selected' : ''}>PHP — Philippine Peso</option>
            <option value="EUR" ${s.displayCurrency === 'EUR' ? 'selected' : ''}>EUR — Euro</option>
          </select>
        </div>
        <p class="hint" style="margin-bottom:8px;">All prices are entered in USD. Conversion rates below are set manually — there is no exchange-rate API.</p>
        <div class="rate-row"><span>1 USD =</span><input class="input mono" type="number" step="any" min="0" id="st-rate-php" value="${s.rates.PHP}" style="max-width:130px;height:38px;"><span>PHP</span></div>
        <div class="rate-row"><span>1 USD =</span><input class="input mono" type="number" step="any" min="0" id="st-rate-eur" value="${s.rates.EUR}" style="max-width:130px;height:38px;"><span>EUR</span></div>
        <span class="error-text hidden" id="st-rate-err">Please enter a valid conversion rate.</span>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Live Crypto Prices</div>
      <div class="panel">
        <div class="field">
          <label for="st-coingecko-key">CoinGecko Demo API Key <span style="font-weight:400;color:var(--ink-soft);">(optional)</span></label>
          <input class="input mono" id="st-coingecko-key" type="password" autocomplete="off" placeholder="Paste your free Demo API key" value="${escapeHTML(s.coinGeckoApiKey || '')}">
          <span class="hint">A free CoinGecko Demo key gives more reliable access. This key is stored only in this browser. Do not use it in a public/shared copy of the app.</span>
        </div>
        <p class="hint">Prices are fetched once when the app opens and only again when you press Refresh Prices. There is no five-minute timer or background polling.</p>
        <p class="hint mt-8">Add a CoinGecko ID to assets that are not recognized automatically. Prices are fetched in one request for all supported assets.</p>
        <button class="btn btn-full mt-8" data-action="refresh-live-prices"><span class="nav-icon" data-icon="refresh"></span>Refresh Prices</button>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Appearance</div>
      <div class="panel">
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px;">Theme</label>
        <div class="theme-choices">
          <button data-action="set-theme" data-theme="light" class="${s.theme === 'light' ? 'selected' : ''}">Light</button>
          <button data-action="set-theme" data-theme="dark" class="${s.theme === 'dark' ? 'selected' : ''}">Dark</button>
          <button data-action="set-theme" data-theme="system" class="${s.theme === 'system' ? 'selected' : ''}">System</button>
        </div>
        <div class="toggle-row" style="margin-top:6px;">
          <span><span class="toggle-label">Full precision by default</span><br><span class="toggle-desc">Show extra decimal places for very small prices without rounding.</span></span>
          <label class="switch"><input type="checkbox" id="st-precision" ${s.fullPrecisionDefault ? 'checked' : ''}><span class="switch-track"></span></label>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Backup</div>
      <div class="panel">
        <button class="btn btn-full mt-8" data-action="export-data" style="margin-top:0;">Export Data (.json)</button>
        <label class="btn btn-full mt-8" for="st-import-file">Import Data</label>
        <input type="file" id="st-import-file" accept="application/json" class="hidden">
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Danger Zone</div>
      <div class="panel">
        <button class="btn btn-danger btn-full" data-action="reset-data">Reset All Data</button>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">About</div>
      <div class="panel">
        <p style="font-size:13px;color:var(--ink-soft);line-height:1.6;">Ledger tracks crypto holdings, displays fetched current prices on demand, and lets you compare hypothetical price scenarios. Portfolio data and cached prices are stored in this browser.</p>
      </div>
    </div>
  `;
}

function bindSettingsEvents() {
  const currency = document.getElementById('st-currency');
  if (!currency) return;
  const apiKey = document.getElementById('st-coingecko-key');
  if (apiKey) apiKey.addEventListener('change', () => {
    state.settings.coinGeckoApiKey = apiKey.value.trim();
    saveState();
    toast('CoinGecko API key saved in this browser.');
  });
  currency.addEventListener('change', () => { state.settings.displayCurrency = currency.value; saveState(); render(); });

  const ratePhp = document.getElementById('st-rate-php');
  const rateEur = document.getElementById('st-rate-eur');
  [ratePhp, rateEur].forEach(inp => inp.addEventListener('change', () => {
    const php = Number(ratePhp.value), eur = Number(rateEur.value);
    const bad = isNaN(php) || php <= 0 || isNaN(eur) || eur <= 0;
    toggleFieldError('st-rate-err', bad);
    if (bad) return;
    state.settings.rates.PHP = php; state.settings.rates.EUR = eur;
    saveState(); render();
  }));

  document.querySelectorAll('[data-action="set-theme"]').forEach(btn => {
    btn.addEventListener('click', () => { state.settings.theme = btn.dataset.theme; applyTheme(); saveState(); render(); });
  });

  document.getElementById('st-precision').addEventListener('change', (e) => {
    state.settings.fullPrecisionDefault = e.target.checked; saveState();
  });

  document.getElementById('st-import-file').addEventListener('change', handleImportFile);
}

function applyTheme() {
  const t = state.settings.theme;
  let effective = t;
  if (t === 'system') effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', effective);
}

/* ---- export / import / reset ---- */
async function exportData() {
  const customLogos = {};
  for (const a of state.assets) {
    if (a.logoType === 'custom' && customLogoCache.has(a.id)) customLogos[a.id] = customLogoCache.get(a.id);
  }
  const payload = {
    ledgerExport: true,
    version: state.version,
    exportedAt: new Date().toISOString(),
    assets: state.assets,
    scenarios: state.scenarios,
    goals: state.goals,
    selectedScenarioId: state.selectedScenarioId,
    settings: state.settings,
    customLogos
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Backup exported.');
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (err) { toast('This file does not contain valid portfolio data.'); return; }
    if (!data || !Array.isArray(data.assets) || !Array.isArray(data.scenarios)) {
      toast('This file does not contain valid portfolio data.');
      return;
    }
    confirmDialog({
      title: 'Replace current data?',
      message: `This will replace your ${state.assets.length} asset(s) and ${state.scenarios.length} scenario(s) with the contents of this backup. This cannot be undone.`,
      confirmLabel: 'Import & Replace',
      danger: true,
      onConfirm: () => applyImportedData(data)
    });
  };
  reader.readAsText(file);
  e.target.value = '';
}

async function applyImportedData(data) {
  const migrated = migrateState({
    version: data.version || 1,
    assets: data.assets,
    scenarios: data.scenarios,
    goals: Array.isArray(data.goals) ? data.goals : [],
    selectedScenarioId: data.selectedScenarioId || null,
    settings: data.settings || {}
  });
  state = migrated;
  customLogoCache.clear();
  if (data.customLogos && typeof data.customLogos === 'object') {
    for (const [assetId, dataUrl] of Object.entries(data.customLogos)) {
      await idbSet('logo-' + assetId, dataUrl);
      customLogoCache.set(assetId, dataUrl);
    }
  }
  saveState();
  applyTheme();
  render();
  toast('Backup imported successfully.');
}

function resetAllData() {
  confirmDialog({
    title: 'Reset all data?',
    message: 'This permanently deletes every asset, scenario, sell plan, note, and custom logo stored in this browser. This cannot be undone.',
    confirmLabel: 'Reset Everything',
    danger: true,
    onConfirm: async () => {
      const ids = state.assets.map(a => a.id);
      for (const id of ids) await idbDelete('logo-' + id);
      customLogoCache.clear();
      state = defaultState();
      localStorage.removeItem(LS_KEY);
      saveState();
      applyTheme();
      render();
      toast('All data has been reset.');
    }
  });
}

/* ==========================================================================
   15. GLOBAL EVENT DELEGATION
   ========================================================================== */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    case 'close-modal': closeModal(); break;
    case 'close-and-new-scenario': closeModal(); openScenarioForm(); break;

    case 'refresh-live-prices': refreshLivePrices(); break;
    case 'open-asset-form': openAssetForm(); break;
    case 'save-asset': saveAssetFromForm(); break;
    case 'open-asset-detail': openAssetDetail(id); break;
    case 'open-asset-menu': e.stopPropagation(); openAssetMenu(id); break;
    case 'menu-view-detail': closeModal(); openAssetDetail(id); break;
    case 'menu-edit-asset': closeModal(); openAssetForm(id); break;
    case 'menu-delete-asset': closeModal(); deleteAsset(id); break;

    case 'open-goal-form': openGoalForm(); break;
    case 'save-goal': saveGoalFromForm(id || null); break;
    case 'open-goal-menu': openGoalMenu(id); break;
    case 'menu-edit-goal': closeModal(); openGoalForm(id); break;
    case 'menu-delete-goal': closeModal(); deleteGoal(id); break;

    case 'open-scenario-picker': openScenarioPicker(); break;
    case 'select-scenario': selectScenario(id); break;
    case 'open-scenario-form': openScenarioForm(); break;
    case 'save-scenario': saveScenarioFromForm(id || null); break;
    case 'open-scenario-menu': openScenarioMenu(id); break;
    case 'menu-edit-scenario': closeModal(); openScenarioForm(id); break;
    case 'menu-rename-scenario': closeModal(); renameScenario(id); break;
    case 'menu-duplicate-scenario': closeModal(); duplicateScenario(id); break;
    case 'menu-delete-scenario': closeModal(); deleteScenario(id); break;
    case 'open-compare-modal': openCompareModal(); break;

    case 'copy-qc-result': {
      const text = document.getElementById('qc-result-value').textContent;
      try { await navigator.clipboard.writeText(text); toast('Copied to clipboard.'); }
      catch { toast('Could not copy automatically — value: ' + text); }
      break;
    }

    case 'export-data': exportData(); break;
    case 'reset-data': resetAllData(); break;
  }
});

document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('.nav-btn, .bnav-btn, #mobile-settings-btn');
  if (navBtn && navBtn.dataset.view) setView(navBtn.dataset.view);
});

/* Re-bind view-specific listeners after each render since innerHTML wipes handlers */
const mainObserver = new MutationObserver(() => {
  if (currentView === 'calculator') bindCalculatorEvents();
  if (currentView === 'settings') bindSettingsEvents();
});
document.addEventListener('DOMContentLoaded', () => {
  const main = document.getElementById('main');
  mainObserver.observe(main, { childList: true });
});

/* ==========================================================================
   16. INIT
   ========================================================================== */

async function init() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.settings.theme === 'system') applyTheme(); });
  await preloadCustomLogos();
  setView('portfolio');
  if (state.assets.length) refreshLivePrices({ quiet: true });
}

init();
