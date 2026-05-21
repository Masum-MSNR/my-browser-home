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

function reportHandledIssue(code, message, meta) {
  if (typeof window !== "undefined" && typeof window.__reportAppIssue === "function") {
    window.__reportAppIssue(code, message, meta || null);
  }
}

var SHORTCUT_LOCAL_LINKS_STORAGE_KEY = "_shortcutLocalLinks";
var BOOKMARK_LOCAL_LINKS_STORAGE_KEY = "_bookmarkLocalLinks";

function getLocalLinkStorageKey(kind) {
  if (kind === "shortcut" || kind === "shortcuts") return SHORTCUT_LOCAL_LINKS_STORAGE_KEY;
  if (kind === "bookmark" || kind === "bookmarks") return BOOKMARK_LOCAL_LINKS_STORAGE_KEY;
  return "";
}

function normalizeLocalLinkMap(value) {
  var next = {};
  if (!value || typeof value !== "object") return next;
  for (var key in value) {
    if (!value.hasOwnProperty(key)) continue;
    var linkValue = typeof value[key] === "string" ? value[key].trim() : "";
    if (key && linkValue) next[key] = linkValue;
  }
  return next;
}

function getLocalLinkValue(linkMap, itemId) {
  if (!itemId || !linkMap || typeof linkMap !== "object") return "";
  var value = linkMap[itemId];
  return typeof value === "string" ? value.trim() : "";
}

function getResolvedItemUrl(item, linkMap) {
  var localUrl = getLocalLinkValue(linkMap, item && item.id ? item.id : "");
  if (localUrl) return localUrl;
  return item && item.url ? item.url : "";
}

function normalizeLocalOverrideUrl(localUrl, syncedUrl) {
  var localValue = typeof localUrl === "string" ? localUrl.trim() : "";
  var syncedValue = typeof syncedUrl === "string" ? syncedUrl.trim() : "";
  if (!localValue || localValue === syncedValue) return "";
  return localValue;
}

function updateLocalUrlInputManualState(localInput, syncedUrl) {
  if (!localInput) return;
  localInput.dataset.manualEdit = normalizeLocalOverrideUrl(localInput.value, syncedUrl) ? "true" : "";
}

function primeLocalUrlInput(localInput, syncedUrl, storedLocalUrl) {
  if (!localInput) return;
  var syncedValue = typeof syncedUrl === "string" ? syncedUrl.trim() : "";
  var overrideValue = normalizeLocalOverrideUrl(storedLocalUrl, syncedValue);
  localInput.value = overrideValue || syncedValue;
  localInput.dataset.manualEdit = overrideValue ? "true" : "";
}

function syncLocalUrlInputWithRemote(remoteInput, localInput) {
  if (!remoteInput || !localInput) return;
  updateLocalUrlInputManualState(localInput, remoteInput.value);
  if (localInput.dataset.manualEdit) return;
  localInput.value = typeof remoteInput.value === "string" ? remoteInput.value.trim() : "";
}

function readLocalLinkMap(kind) {
  return new Promise(function (resolve) {
    var storageKey = getLocalLinkStorageKey(kind);
    if (!storageKey) {
      resolve({});
      return;
    }

    function resolveFromLocalStorage() {
      if (typeof localStorage === "undefined") {
        resolve({});
        return;
      }
      try {
        resolve(normalizeLocalLinkMap(JSON.parse(localStorage.getItem(storageKey) || "{}")));
      } catch (e) {
        resolve({});
      }
    }

    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolveFromLocalStorage();
      return;
    }

    chrome.storage.local.get(storageKey, function (result) {
      if (result && result[storageKey] && typeof result[storageKey] === "object") {
        resolve(normalizeLocalLinkMap(result[storageKey]));
        return;
      }
      resolveFromLocalStorage();
    });
  });
}

function writeLocalLinkMap(kind, linkMap) {
  return new Promise(function (resolve) {
    var storageKey = getLocalLinkStorageKey(kind);
    var next = normalizeLocalLinkMap(linkMap);
    if (!storageKey) {
      resolve(next);
      return;
    }

    function mirrorToLocalStorage() {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch (e) {}
    }

    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      mirrorToLocalStorage();
      resolve(next);
      return;
    }

    chrome.storage.local.set({ [storageKey]: next }, function () {
      mirrorToLocalStorage();
      resolve(next);
    });
  });
}

function updateLocalLinkValue(kind, itemId, url) {
  return readLocalLinkMap(kind).then(function (linkMap) {
    var next = normalizeLocalLinkMap(linkMap);
    var normalizedUrl = typeof url === "string" ? url.trim() : "";
    if (itemId) {
      if (normalizedUrl) next[itemId] = normalizedUrl;
      else delete next[itemId];
    }
    return writeLocalLinkMap(kind, next);
  });
}

function isFallbackFaviconUrl(url) {
  if (!url) return true;
  if (url === DEFAULT_FAVICON) return true;
  var value = String(url);
  return value.indexOf("https://www.google.com/s2/favicons") === 0 ||
    value.indexOf("https://t0.gstatic.com/faviconV2") === 0 ||
    value.indexOf("/_favicon/?") === 0 ||
    value.indexOf("chrome://favicon2/") === 0;
}

function isCachedFaviconDataUrl(url) {
  if (!url) return false;
  var value = String(url);
  return value === DEFAULT_FAVICON || value.indexOf("data:") === 0;
}

function shouldReuseCachedFaviconData(entry, realUrl) {
  if (!entry || !entry.faviconDataUrl) return false;
  if (entry.faviconDataUrl !== DEFAULT_FAVICON) return true;
  return !realUrl || isFallbackFaviconUrl(realUrl);
}

function getStoredRealFaviconUrl(entry) {
  return entry && entry.favicon && !isFallbackFaviconUrl(entry.favicon) ? entry.favicon : "";
}

function shouldRepairStoredFaviconEntry(url, entry) {
  if (!url || !entry || hasFaviconFailure(url)) return false;

  var realUrl = getStoredRealFaviconUrl(entry);
  if (realUrl) {
    return !entry.faviconDataUrl || entry.faviconDataUrl === DEFAULT_FAVICON || entry.faviconDataUrlSource !== realUrl;
  }

  return entry.faviconDataUrl === DEFAULT_FAVICON;
}

function sanitizeStoredFaviconEntry(url, entry) {
  if (!entry || typeof entry !== "object") return null;

  var next = Object.assign({}, entry);
  if (next.faviconDataUrl && !isCachedFaviconDataUrl(next.faviconDataUrl)) {
    reportHandledIssue("favicon-cache-sanitize", "Dropped stale favicon cache entry", {
      url: url || next.url || "",
      sourceUrl: next.faviconDataUrl
    });
    next.faviconDataUrl = DEFAULT_FAVICON;
  }

  if (next.faviconDataUrlSource && typeof next.faviconDataUrlSource !== "string") {
    delete next.faviconDataUrlSource;
  }

  if (!next.faviconDataUrl && (!next.favicon || isFallbackFaviconUrl(next.favicon))) {
    next.favicon = DEFAULT_FAVICON;
    next.faviconDataUrl = DEFAULT_FAVICON;
  }

  if (!next.faviconDataUrl || next.faviconDataUrl === DEFAULT_FAVICON) {
    delete next.faviconDataUrlSource;
  }

  return next;
}

function getExtensionFaviconUrl(url, size) {
  var normalizedUrl = normalizeFaviconUrl(url);
  var px = typeof size === "number" && size > 0 ? size : 32;
  if (!normalizedUrl) return "";
  return "/_favicon/?pageUrl=" + encodeURIComponent(normalizedUrl) + "&size=" + encodeURIComponent(String(px));
}

function getPageFaviconSourceUrl(url) {
  if (typeof document === "undefined") return "";
  return getExtensionFaviconUrl(url, 32);
}

function createDefaultFaviconEntry(url) {
  var normalizedUrl = normalizeFaviconUrl(url);
  return {
    url: normalizedUrl || url || "",
    favicon: DEFAULT_FAVICON,
    faviconDataUrl: DEFAULT_FAVICON,
    updatedAt: Date.now()
  };
}

function createRenderableFallbackEntry(url, storedFavicon) {
  if (storedFavicon && !isFallbackFaviconUrl(storedFavicon)) {
    return {
      url: normalizeFaviconUrl(url) || url || "",
      favicon: storedFavicon,
      faviconDataUrl: DEFAULT_FAVICON,
      updatedAt: Date.now()
    };
  }
  return createDefaultFaviconEntry(url);
}

function ensureDefaultFaviconEntry(url) {
  var entry = createDefaultFaviconEntry(url);
  mergeStoredFaviconEntry(url, entry);
  clearFaviconFailure(url);
  return entry;
}

function ensureRenderableFaviconEntry(url, storedFavicon) {
  var cacheKey = getFaviconCacheKey(url);
  if (!cacheKey) return createRenderableFallbackEntry(url, storedFavicon);

  var existing = getCachedFaviconEntrySync(url);
  if (existing && existing.faviconDataUrl) {
    schedulePageFaviconRepair(url, existing);
    return existing;
  }

  var entry = createRenderableFallbackEntry(url, storedFavicon);
  mergeStoredFaviconEntry(url, entry);
  return getCachedFaviconEntrySync(url) || entry;
}

var FAVICON_CACHE_KEY_PREFIX = "_favicon:";
var FAVICON_DATA_CACHE_KEY = "_faviconDataCache";
var FAVICON_FAILURE_CACHE_KEY = "_faviconFailureCache";
var faviconDataCache = {};
var faviconFailureCache = {};
var pendingFaviconCacheRequests = {};
var pendingFaviconRepairs = {};

(function loadFaviconDataCache() {
  if (typeof localStorage === "undefined") return;
  try {
    var raw = localStorage.getItem(FAVICON_DATA_CACHE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") faviconDataCache = parsed;
  } catch (e) {}
})();

(function loadFaviconFailureCache() {
  if (typeof localStorage === "undefined") return;
  try {
    var raw = localStorage.getItem(FAVICON_FAILURE_CACHE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") faviconFailureCache = parsed;
  } catch (e) {}
})();

function normalizeFaviconUrl(url) {
  try {
    var parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch (e) {
    return "";
  }
}

function getFaviconCacheKey(url) {
  var normalizedUrl = normalizeFaviconUrl(url);
  return normalizedUrl ? FAVICON_CACHE_KEY_PREFIX + normalizedUrl : "";
}

function isFaviconCacheStorageKey(key) {
  return typeof key === "string" && key.indexOf(FAVICON_CACHE_KEY_PREFIX) === 0;
}

function getFaviconUrlFromCacheKey(cacheKey) {
  if (!isFaviconCacheStorageKey(cacheKey)) return "";
  return cacheKey.slice(FAVICON_CACHE_KEY_PREFIX.length);
}

function persistFaviconDataCache() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FAVICON_DATA_CACHE_KEY, JSON.stringify(faviconDataCache));
  } catch (e) {}
}

function persistFaviconFailureCache() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FAVICON_FAILURE_CACHE_KEY, JSON.stringify(faviconFailureCache));
  } catch (e) {}
}

function clearFaviconFailureByKey(cacheKey) {
  if (!cacheKey || !Object.prototype.hasOwnProperty.call(faviconFailureCache, cacheKey)) return;
  delete faviconFailureCache[cacheKey];
  persistFaviconFailureCache();
}

function clearFaviconFailure(url) {
  clearFaviconFailureByKey(getFaviconCacheKey(url));
}

function markFaviconFailure(url) {
  var cacheKey = getFaviconCacheKey(url);
  if (!cacheKey) return;
  faviconFailureCache[cacheKey] = Date.now();
  persistFaviconFailureCache();
}

function hasFaviconFailure(url) {
  var cacheKey = getFaviconCacheKey(url);
  return !!(cacheKey && faviconFailureCache[cacheKey]);
}

function rememberFaviconCacheEntry(cacheKey, entry) {
  if (!cacheKey || !entry || typeof entry !== "object") return null;
  var entryUrl = entry.url || getFaviconUrlFromCacheKey(cacheKey);
  var normalizedEntry = sanitizeStoredFaviconEntry(entryUrl, entry);
  if (!normalizedEntry) return null;

  var current = faviconDataCache[cacheKey];
  var merged = current && typeof current === "object"
    ? Object.assign({}, current, normalizedEntry)
    : Object.assign({}, normalizedEntry);
  merged = sanitizeStoredFaviconEntry(entryUrl, merged);
  if (!merged) return null;
  faviconDataCache[cacheKey] = merged;
  if (merged.favicon || merged.faviconDataUrl) clearFaviconFailureByKey(cacheKey);
  persistFaviconDataCache();
  return merged;
}

function schedulePageFaviconRepair(url, entry) {
  if (typeof document === "undefined") return;
  if (!shouldRepairStoredFaviconEntry(url, entry)) return;

  var realUrl = getStoredRealFaviconUrl(entry);
  var sourceUrl = realUrl || getPageFaviconSourceUrl(url);
  var cacheKey = getFaviconCacheKey(url);

  if (!sourceUrl || !cacheKey || pendingFaviconRepairs[cacheKey]) return;

  var repairPromise = primeFaviconCache(url, sourceUrl, realUrl || null, { forceRefresh: true })
    .then(function (dataUrl) {
      if (!dataUrl) markFaviconFailure(url);
      return dataUrl;
    }, function (error) {
      markFaviconFailure(url);
      throw error;
    });
  pendingFaviconRepairs[cacheKey] = repairPromise;
  repairPromise.then(
    function () {
      delete pendingFaviconRepairs[cacheKey];
    },
    function () {
      delete pendingFaviconRepairs[cacheKey];
    }
  );
}

function mergeStoredFaviconEntry(url, entry) {
  var cacheKey = getFaviconCacheKey(url);
  if (!cacheKey || !entry || typeof entry !== "object") return;

  var normalizedUrl = normalizeFaviconUrl(url);
  var normalizedEntry = Object.assign({}, entry);
  if (normalizedUrl) normalizedEntry.url = normalizedUrl;
  if (!normalizedEntry.updatedAt) normalizedEntry.updatedAt = Date.now();

  rememberFaviconCacheEntry(cacheKey, normalizedEntry);

  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(cacheKey, function (result) {
    var current = result && result[cacheKey] && typeof result[cacheKey] === "object" ? result[cacheKey] : {};
    var next = sanitizeStoredFaviconEntry(url, Object.assign({}, current, normalizedEntry));
    if (!next) return;
    chrome.storage.local.set({ [cacheKey]: next });
  });
}

function getCachedFaviconEntrySync(url) {
  var cacheKey = getFaviconCacheKey(url);
  if (!cacheKey) return null;
  var entry = faviconDataCache[cacheKey] || null;
  if (!entry || typeof entry !== "object") return null;
  var sanitized = sanitizeStoredFaviconEntry(url, entry);
  if (!sanitized) return null;
  if (JSON.stringify(sanitized) !== JSON.stringify(entry)) {
    faviconDataCache[cacheKey] = sanitized;
    persistFaviconDataCache();
  }
  return sanitized;
}

function getStoredFaviconEntry(url) {
  return new Promise(function (resolve) {
    var cached = getCachedFaviconEntrySync(url);
    if (cached) {
      resolve(cached);
      return;
    }

    var cacheKey = getFaviconCacheKey(url);
    if (!cacheKey || typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve(null);
      return;
    }

    chrome.storage.local.get(cacheKey, function (result) {
      if (!result || !result[cacheKey] || typeof result[cacheKey] !== "object") {
        resolve(null);
        return;
      }
      var rawEntry = result[cacheKey];
      var entry = sanitizeStoredFaviconEntry(url, rawEntry);
      if (!entry) {
        resolve(null);
        return;
      }
      rememberFaviconCacheEntry(cacheKey, entry);
      if (JSON.stringify(entry) !== JSON.stringify(rawEntry)) {
        chrome.storage.local.set({ [cacheKey]: entry });
      }
      resolve(entry);
    });
  });
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

function loadFaviconImage(sourceUrl) {
  return new Promise(function (resolve, reject) {
    if (typeof Image === "undefined") {
      reject(new Error("Image loading unavailable"));
      return;
    }

    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error("Failed to load favicon image")); };
    img.src = sourceUrl;
  });
}

function imageToDataUrl(img) {
  if (typeof document === "undefined" || !document || typeof document.createElement !== "function") {
    throw new Error("Canvas unavailable");
  }

  var width = img && (img.naturalWidth || img.width) ? (img.naturalWidth || img.width) : 32;
  var height = img && (img.naturalHeight || img.height) ? (img.naturalHeight || img.height) : 32;
  var canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  var context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context unavailable");

  context.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

async function fetchFaviconDataUrl(sourceUrl) {
  var fetchError = null;

  try {
    var response = await fetch(sourceUrl, { cache: "force-cache" });
    if (!response.ok) throw new Error("Failed to fetch favicon");
    var contentType = response.headers.get("content-type") || "image/png";
    var buffer = await response.arrayBuffer();
    return "data:" + contentType + ";base64," + arrayBufferToBase64(buffer);
  } catch (error) {
    fetchError = error;
  }

  var img = await loadFaviconImage(sourceUrl).catch(function (imageError) {
    throw fetchError || imageError;
  });

  try {
    return imageToDataUrl(img);
  } catch (error) {
    throw fetchError || error;
  }
}

function primeFaviconCache(url, sourceUrl, realUrl, options) {
  var cacheKey = getFaviconCacheKey(url);
  var forceRefresh = !!(options && options.forceRefresh);
  if (!cacheKey || !sourceUrl || sourceUrl === DEFAULT_FAVICON) return Promise.resolve(null);

  var existing = getCachedFaviconEntrySync(url);
  var resolvedSource = realUrl && !isFallbackFaviconUrl(realUrl) ? realUrl : sourceUrl;
  var canUpgradeDefault = !!(
    existing &&
    existing.faviconDataUrl === DEFAULT_FAVICON &&
    sourceUrl &&
    sourceUrl !== DEFAULT_FAVICON
  );
  var hasMatchingSource = !resolvedSource || !!(existing && existing.faviconDataUrlSource === resolvedSource);

  if (existing && shouldReuseCachedFaviconData(existing, realUrl) && hasMatchingSource && !forceRefresh && !canUpgradeDefault) {
    if (realUrl && existing.favicon !== realUrl) {
      mergeStoredFaviconEntry(url, { favicon: realUrl, updatedAt: Date.now() });
    }
    return Promise.resolve(existing.faviconDataUrl);
  }

  if (String(sourceUrl).indexOf("data:") === 0) {
    mergeStoredFaviconEntry(url, realUrl
      ? { favicon: realUrl, faviconDataUrl: sourceUrl, faviconDataUrlSource: resolvedSource, updatedAt: Date.now() }
      : { faviconDataUrl: sourceUrl, faviconDataUrlSource: resolvedSource, updatedAt: Date.now() });
    return Promise.resolve(sourceUrl);
  }

  var pending = pendingFaviconCacheRequests[cacheKey];
  if (pending && pending.sourceUrl === sourceUrl) return pending.promise;

  var requestState = {
    sourceUrl: sourceUrl,
    promise: null
  };

  requestState.promise = fetchFaviconDataUrl(sourceUrl)
    .then(function (dataUrl) {
      if (pendingFaviconCacheRequests[cacheKey] !== requestState) return dataUrl;
      mergeStoredFaviconEntry(url, realUrl
        ? { favicon: realUrl, faviconDataUrl: dataUrl, faviconDataUrlSource: resolvedSource, updatedAt: Date.now() }
        : { faviconDataUrl: dataUrl, faviconDataUrlSource: resolvedSource, updatedAt: Date.now() });
      return dataUrl;
    })
    .catch(function () {
      reportHandledIssue("favicon-fetch", "Favicon unavailable", { url: url, sourceUrl: sourceUrl });
      return null;
    })
    .then(function (result) {
      if (pendingFaviconCacheRequests[cacheKey] === requestState) {
        delete pendingFaviconCacheRequests[cacheKey];
      }
      return result;
    }, function (error) {
      if (pendingFaviconCacheRequests[cacheKey] === requestState) {
        delete pendingFaviconCacheRequests[cacheKey];
      }
      throw error;
    });

  pendingFaviconCacheRequests[cacheKey] = requestState;
  return requestState.promise;
}

async function requestFaviconCacheRefresh(url, storedFavicon) {
  var entry = await getStoredFaviconEntry(url);
  var cachedRealUrl = entry && entry.favicon && !isFallbackFaviconUrl(entry.favicon) ? entry.favicon : null;
  var storedRealUrl = storedFavicon && !isFallbackFaviconUrl(storedFavicon) ? storedFavicon : null;
  var realUrl = cachedRealUrl || storedRealUrl;
  var hasRenderableCachedData = !!(entry && entry.faviconDataUrl && entry.faviconDataUrl !== DEFAULT_FAVICON);
  var hasRenderableRealData = !!(entry && realUrl && shouldReuseCachedFaviconData(entry, realUrl) && entry.faviconDataUrlSource === realUrl);

  if (entry && (hasRenderableRealData || (!realUrl && hasRenderableCachedData))) {
    clearFaviconFailure(url);
    return {
      entry: entry,
      realUrl: realUrl,
      source: cachedRealUrl ? "real" : "cache"
    };
  }

  var sourceUrl = realUrl || getPageFaviconSourceUrl(url);
  if (!sourceUrl) sourceUrl = realUrl;
  if (!sourceUrl && typeof getExtensionFaviconUrl === "function") {
    sourceUrl = getExtensionFaviconUrl(url, 32);
  }

  if (!sourceUrl) {
    var defaultEntry = ensureDefaultFaviconEntry(url);
    return {
      entry: defaultEntry,
      realUrl: DEFAULT_FAVICON,
      source: "default"
    };
  }

  var dataUrl = await primeFaviconCache(url, sourceUrl, realUrl || null);
  if (!dataUrl) {
    var fallbackEntry = ensureDefaultFaviconEntry(url);
    markFaviconFailure(url);
    reportHandledIssue("favicon-default", "Using default favicon", { url: url });
    return {
      entry: fallbackEntry,
      realUrl: DEFAULT_FAVICON,
      source: "default"
    };
  }

  clearFaviconFailure(url);
  var updatedEntry = await getStoredFaviconEntry(url);
  var resolvedRealUrl = updatedEntry && updatedEntry.favicon && !isFallbackFaviconUrl(updatedEntry.favicon)
    ? updatedEntry.favicon
    : realUrl;
  return {
    entry: updatedEntry || { favicon: realUrl || null, faviconDataUrl: dataUrl },
    realUrl: resolvedRealUrl || null,
    source: realUrl ? "real" : "extension"
  };
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
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
  '<circle cx="12" cy="12" r="10" fill="rgba(15,23,42,0.38)" stroke="rgba(255,255,255,0.92)" stroke-width="1.8"/>' +
  '<ellipse cx="12" cy="12" rx="4.2" ry="8.2" stroke="rgba(255,255,255,0.92)" stroke-width="1.4"/>' +
  '<path d="M4 12h16" stroke="rgba(255,255,255,0.92)" stroke-width="1.4" stroke-linecap="round"/>' +
  '<path d="M12 4v16" stroke="rgba(255,255,255,0.92)" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>'
);

// Render path is read-only: use cached data URLs only. If there is no cached
// data URL yet, fall back to a built-in icon instead of issuing a remote load.
function setFaviconWithFallback(img, url, storedFavicon) {
  var cachedEntry = ensureRenderableFaviconEntry(url, storedFavicon);
  var cachedDataUrl = cachedEntry && cachedEntry.faviconDataUrl ? cachedEntry.faviconDataUrl : "";
  var primary = cachedDataUrl;

  if (!primary) primary = DEFAULT_FAVICON;

  img.onload = function () {
    if (primary !== DEFAULT_FAVICON) clearFaviconFailure(url);
  };
  img.src = primary;
  img.onerror = function () {
    markFaviconFailure(url);
    reportHandledIssue("favicon-render", "Rendered default favicon", { url: url });
    img.src = DEFAULT_FAVICON;
    img.onerror = null;
  };
}

// Resolve a cached data URL from chrome.storage.local. Render paths do not use
// raw remote favicon URLs to avoid re-fetching on page load.
function resolveCachedFaviconEntry(url, cb) {
  try {
    var cached = getCachedFaviconEntrySync(url);
    if (cached && cached.faviconDataUrl) {
      schedulePageFaviconRepair(url, cached);
      cb(cached);
      return;
    }

    var cacheKey = getFaviconCacheKey(url);
    if (!cacheKey) return;
    chrome.storage.local.get(cacheKey, function (result) {
      if (!result || !result[cacheKey] || typeof result[cacheKey] !== "object") return;
      var entry = sanitizeStoredFaviconEntry(url, result[cacheKey]);
      if (!entry) return;
      if (!entry.faviconDataUrl) return;
      rememberFaviconCacheEntry(cacheKey, entry);
      schedulePageFaviconRepair(url, entry);
      if (JSON.stringify(entry) !== JSON.stringify(result[cacheKey])) {
        chrome.storage.local.set({ [cacheKey]: entry });
      }
      cb(entry);
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
    var renderUrl = entry.faviconDataUrl;
    if (!renderUrl) return;
    clearFaviconFailure(url);
    img.src = renderUrl;
    img.onerror = function () {
      markFaviconFailure(url);
      reportHandledIssue("favicon-cache", "Cached favicon failed, falling back to default", { url: url });
      img.src = DEFAULT_FAVICON;
      img.onerror = null;
    };
    if (typeof onResolved === "function" && entry.favicon && !isFallbackFaviconUrl(entry.favicon)) {
      onResolved(entry.favicon);
    }
  });
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged && typeof localStorage !== "undefined") {
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "local") return;
    for (var key in changes) {
      if (!changes.hasOwnProperty(key)) continue;
      if (!isFaviconCacheStorageKey(key)) continue;
      var next = changes[key].newValue;
      if (!next || typeof next !== "object") continue;
      if (!next.favicon && !next.faviconDataUrl) continue;
      rememberFaviconCacheEntry(key, next);

      var cacheUrl = next.url || getFaviconUrlFromCacheKey(key);
      schedulePageFaviconRepair(cacheUrl, next);
    }
  });
}
