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

function resolveTrackedItemFaviconUrl(item, localLinks) {
  if (!item) return "";
  if (typeof getResolvedItemUrl === "function") {
    return getResolvedItemUrl(item, localLinks) || item.url || "";
  }
  return item.url || "";
}

async function collectCachedFaviconBackfillUpdates(items, localLinks, targetCacheKey) {
  var updates = [];
  if (!Array.isArray(items)) return updates;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || !item.id) continue;

    var effectiveUrl = resolveTrackedItemFaviconUrl(item, localLinks);
    if (!effectiveUrl) continue;

    if (targetCacheKey && typeof getFaviconCacheKey === "function" && getFaviconCacheKey(effectiveUrl) !== targetCacheKey) {
      continue;
    }

    var entry = await getStoredFaviconEntry(effectiveUrl);
    var realUrl = getStoredRealFaviconUrl(entry);
    if (!realUrl || item.favicon === realUrl) continue;

    updates.push({
      id: item.id,
      favicon: realUrl
    });
  }

  return updates;
}

function applyCachedFaviconBackfillUpdates(items, updates) {
  if (!Array.isArray(items) || !Array.isArray(updates) || updates.length === 0) return false;

  var updatesById = {};
  for (var i = 0; i < updates.length; i++) {
    if (!updates[i] || !updates[i].id || !updates[i].favicon) continue;
    updatesById[updates[i].id] = updates[i].favicon;
  }

  var changed = false;
  for (var j = 0; j < items.length; j++) {
    var item = items[j];
    if (!item || !item.id || !updatesById[item.id] || item.favicon === updatesById[item.id]) continue;
    item.favicon = updatesById[item.id];
    changed = true;
  }

  return changed;
}

function shouldRepairStoredFaviconEntry(url, entry) {
  if (!url || !entry || hasFaviconFailure(url)) return false;

  var realUrl = getStoredRealFaviconUrl(entry);
  if (realUrl) {
    return !entry.faviconDataUrl || entry.faviconDataUrl === DEFAULT_FAVICON || entry.faviconDataUrlSource !== realUrl;
  }

  return false;
}

function sanitizeStoredFaviconEntry(url, entry) {
  if (!entry || typeof entry !== "object") return null;

  var next = Object.assign({}, entry);
  var realUrl = getStoredRealFaviconUrl(next);
  if (next.faviconDataUrl && !isCachedFaviconDataUrl(next.faviconDataUrl)) {
    reportHandledIssue("favicon-cache-sanitize", "Dropped stale favicon cache entry", {
      url: url || next.url || "",
      sourceUrl: next.faviconDataUrl
    });
    next.faviconDataUrl = DEFAULT_FAVICON;
  }

  if (!realUrl && next.faviconDataUrl && next.faviconDataUrl !== DEFAULT_FAVICON && next.faviconDataUrlSource && isFallbackFaviconUrl(next.faviconDataUrlSource)) {
    reportHandledIssue("favicon-cache-sanitize", "Dropped speculative favicon cache entry", {
      url: url || next.url || "",
      sourceUrl: next.faviconDataUrlSource
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
