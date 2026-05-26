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
