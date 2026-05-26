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
