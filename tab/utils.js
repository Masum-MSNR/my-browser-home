function getRootDomain(url) {
  try {
    const knownMultiLevelTLDs = [
      'co.uk', 'ac.uk', 'gov.uk', 'co.in', 'com.au', 'com.br', 'co.jp', 'co.kr', 'co.za', 'com.cn'
    ];

    const hostname = new URL(url).hostname.toLowerCase();

    const cleaned = hostname.replace(/^(www[0-9]?|mail|ftp|app)\./, '');

    const parts = cleaned.split('.');
    const len = parts.length;

    if (len < 2) return cleaned;

    const lastTwo = parts.slice(-2).join('.');
    const lastThree = parts.slice(-3).join('.');

    if (knownMultiLevelTLDs.includes(lastTwo)) {
      return len >= 3 ? parts.slice(-3).join('.') : lastTwo;
    }

    return lastTwo;
  } catch (e) {
    return '';
  }
}

function getFullDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function getFaviconUrl(url) {
  return Promise.resolve(getFaviconUrlSync(url));
}

var FAVICON_DATA_CACHE_KEY = "_faviconDataCache";
var faviconDataCache = {};
var pendingFaviconCacheRequests = {};

(function loadFaviconDataCache() {
  if (typeof localStorage === "undefined") return;
  try {
    var raw = localStorage.getItem(FAVICON_DATA_CACHE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") faviconDataCache = parsed;
  } catch (e) {}
})();

function getFaviconCacheDomain(url) {
  return getFullDomain(url);
}

function persistFaviconDataCache() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FAVICON_DATA_CACHE_KEY, JSON.stringify(faviconDataCache));
  } catch (e) {}
}

function rememberFaviconCacheEntry(domain, entry) {
  if (!domain || !entry || typeof entry !== "object") return null;
  var current = faviconDataCache[domain];
  var merged = current && typeof current === "object"
    ? Object.assign({}, current, entry)
    : Object.assign({}, entry);
  faviconDataCache[domain] = merged;
  persistFaviconDataCache();
  return merged;
}

function mergeStoredFaviconEntry(url, entry) {
  var domain = getFaviconCacheDomain(url);
  if (!domain || !entry || typeof entry !== "object") return;

  rememberFaviconCacheEntry(domain, entry);

  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(domain, function (result) {
    var current = result && result[domain] && typeof result[domain] === "object" ? result[domain] : {};
    var next = Object.assign({}, current, entry);
    chrome.storage.local.set({ [domain]: next });
  });
}

function getCachedFaviconEntrySync(url) {
  var domain = getFaviconCacheDomain(url);
  if (!domain) return null;
  return faviconDataCache[domain] || null;
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var chunkSize = 32768;
  var binary = "";
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function fetchFaviconDataUrl(sourceUrl) {
  var response = await fetch(sourceUrl, { cache: "force-cache" });
  if (!response.ok) throw new Error("Failed to fetch favicon");
  var contentType = response.headers.get("content-type") || "image/png";
  var buffer = await response.arrayBuffer();
  return "data:" + contentType + ";base64," + arrayBufferToBase64(buffer);
}

function primeFaviconCache(url, sourceUrl, realUrl) {
  var domain = getFaviconCacheDomain(url);
  if (!domain || !sourceUrl || sourceUrl === DEFAULT_FAVICON) return Promise.resolve(null);

  var existing = getCachedFaviconEntrySync(url);
  if (existing && existing.faviconDataUrl) {
    if (realUrl && existing.favicon !== realUrl) mergeStoredFaviconEntry(url, { favicon: realUrl });
    return Promise.resolve(existing.faviconDataUrl);
  }

  if (String(sourceUrl).indexOf("data:") === 0) {
    mergeStoredFaviconEntry(url, realUrl
      ? { favicon: realUrl, faviconDataUrl: sourceUrl }
      : { faviconDataUrl: sourceUrl });
    return Promise.resolve(sourceUrl);
  }

  if (pendingFaviconCacheRequests[domain]) return pendingFaviconCacheRequests[domain];

  pendingFaviconCacheRequests[domain] = fetchFaviconDataUrl(sourceUrl)
    .then(function (dataUrl) {
      mergeStoredFaviconEntry(url, realUrl
        ? { favicon: realUrl, faviconDataUrl: dataUrl }
        : { faviconDataUrl: dataUrl });
      return dataUrl;
    })
    .catch(function () {
      return null;
    })
    .then(function (result) {
      delete pendingFaviconCacheRequests[domain];
      return result;
    }, function (error) {
      delete pendingFaviconCacheRequests[domain];
      throw error;
    });

  return pendingFaviconCacheRequests[domain];
}

// Quick sync fallback
function getFaviconUrlSync(url) {
  try {
    var domain = new URL(url).hostname;
    return "https://www.google.com/s2/favicons?sz=32&domain=" + domain;
  } catch (e) {
    return "";
  }
}

// Built-in globe favicon (data URI) — always available, no network needed
var DEFAULT_FAVICON = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5">' +
  '<circle cx="12" cy="12" r="10"/>' +
  '<ellipse cx="12" cy="12" rx="4" ry="10"/>' +
  '<path d="M2 12h20"/><path d="M12 2v20"/></svg>'
);

// Set favicon: prefer stored favicon (from item.favicon), fall back to S2.
// `storedFavicon` is the favicon URL saved in the item data (synced across
// devices). If absent, use Google's S2 service. If both fail, use a built-in
// globe SVG.
function setFaviconWithFallback(img, url, storedFavicon) {
  var cachedEntry = getCachedFaviconEntrySync(url);
  var cachedDataUrl = cachedEntry && cachedEntry.faviconDataUrl ? cachedEntry.faviconDataUrl : "";
  var s2 = getFaviconUrlSync(url);
  var primary = cachedDataUrl || storedFavicon || s2;
  img.src = primary;
  if (!cachedDataUrl && primary) {
    primeFaviconCache(url, primary, storedFavicon || null);
  }
  img.onerror = function () {
    if (img.src !== s2 && primary !== s2) {
      img.src = s2;
      primeFaviconCache(url, s2, null);
      img.onerror = function () {
        img.src = DEFAULT_FAVICON;
        img.onerror = null;
      };
    } else {
      img.src = DEFAULT_FAVICON;
      img.onerror = null;
    }
  };
}

// Resolve a favicon URL from chrome.storage.local cache (populated by the
// background worker when the user visits a site). Calls back with the real
// URL only after a test-load succeeds. CORP-blocked URLs silently fail.
function resolveCachedFaviconEntry(url, cb) {
  try {
    var cached = getCachedFaviconEntrySync(url);
    if (cached && (cached.faviconDataUrl || cached.favicon)) {
      cb(cached);
      if (!cached.faviconDataUrl && cached.favicon) primeFaviconCache(url, cached.favicon, cached.favicon);
      return;
    }

    var domain = getFaviconCacheDomain(url);
    if (!domain) return;
    chrome.storage.local.get(domain, function (result) {
      if (!result || !result[domain] || typeof result[domain] !== "object") return;
      var entry = result[domain];
      rememberFaviconCacheEntry(domain, entry);
      cb(entry);
      if (!entry.faviconDataUrl && entry.favicon) primeFaviconCache(url, entry.favicon, entry.favicon);
    });
  } catch (e) {}
}

// Try to upgrade favicon from cached real URL. If `onResolved` is provided,
// it is called with the real URL after a successful test-load — callers may
// use this to persist the resolved favicon back into the item data so it
// syncs across devices.
function refreshFaviconFromCache(img, url, onResolved) {
  resolveCachedFaviconEntry(url, function (entry) {
    if (!entry) return;
    var renderUrl = entry.faviconDataUrl || entry.favicon;
    if (!renderUrl) return;
    img.src = renderUrl;
    img.onerror = null;
    if (typeof onResolved === "function" && entry.favicon) onResolved(entry.favicon);
  });
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged && typeof localStorage !== "undefined") {
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "local") return;
    for (var key in changes) {
      if (!changes.hasOwnProperty(key)) continue;
      var next = changes[key].newValue;
      if (!next || typeof next !== "object") continue;
      if (!next.favicon && !next.faviconDataUrl) continue;
      rememberFaviconCacheEntry(key, next);
    }
  });
}
