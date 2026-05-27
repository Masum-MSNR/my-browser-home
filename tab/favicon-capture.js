var pendingSavedItemFaviconCaptures = {};

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

async function fetchFaviconSourceAsDataUrl(sourceUrl, options) {
  if (!sourceUrl) return "";
  var forceRefresh = !!(options && options.forceRefresh);

  try {
    var response = await fetch(sourceUrl, { cache: forceRefresh ? "no-store" : "force-cache" });
    if (!response.ok) return "";
    var contentType = response.headers.get("content-type") || "image/png";
    var buffer = await response.arrayBuffer();
    if (!buffer || !buffer.byteLength) return "";
    return "data:" + contentType + ";base64," + arrayBufferToBase64(buffer);
  } catch (error) {
    return "";
  }
}

function getBrowserFaviconProbeUrl(pageUrl, size) {
  var normalizedUrl = normalizeFaviconUrl(pageUrl);
  if (!normalizedUrl) return "";

  var path = "_favicon/?pageUrl=" + encodeURIComponent(normalizedUrl) + "&size=" + encodeURIComponent(String(size || 32));
  if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getURL === "function") {
    return chrome.runtime.getURL(path);
  }
  return "/" + path;
}

function buildSavedItemFaviconSources(ref, options) {
  var sources = [];
  var seen = {};

  function pushSource(url, mode) {
    if (!url || seen[url]) return;
    seen[url] = true;
    sources.push({ url: url, mode: mode });
  }

  var preferredSourceUrl = options && options.preferredSourceUrl ? String(options.preferredSourceUrl) : "";
  if (isRenderableFaviconSource(preferredSourceUrl)) pushSource(preferredSourceUrl, "observed");

  var probeTargetUrl = options && options.finalVisitedUrl ? options.finalVisitedUrl : ref.effectiveUrl;
  var probeUrl = getBrowserFaviconProbeUrl(probeTargetUrl, 32);
  if (probeUrl) pushSource(probeUrl, "probe");

  return sources;
}

function buildSavedItemFaviconPatch(ref, options) {
  return {
    itemId: ref.itemId,
    kind: ref.kind,
    effectiveUrlSnapshot: ref.effectiveUrl,
    finalVisitedUrl: normalizeFaviconUrl(options && options.finalVisitedUrl ? options.finalVisitedUrl : ref.effectiveUrl),
    sourceType: options && options.sourceType ? String(options.sourceType) : "",
    updatedAt: Date.now()
  };
}

async function captureSavedItemFaviconInternal(ref, options) {
  if (!ref || !ref.itemId || !ref.effectiveUrl) return null;

  var basePatch = buildSavedItemFaviconPatch(ref, options);
  var sources = buildSavedItemFaviconSources(ref, options);
  var forceRefresh = !options || options.forceRefresh !== false;

  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];
    var dataUrl = await fetchFaviconSourceAsDataUrl(source.url, { forceRefresh: forceRefresh });
    if (dataUrl) {
      return setSavedItemFaviconRecord(Object.assign({}, basePatch, {
        iconSourceUrl: source.url,
        iconDataUrl: dataUrl,
        sourceType: source.mode === "observed" ? (basePatch.sourceType || "tab-visit") : (basePatch.sourceType || "save-probe"),
        status: "ready",
        updatedAt: Date.now()
      }));
    }
    if (source.mode === "observed" && isRenderableFaviconSource(source.url)) {
      return setSavedItemFaviconRecord(Object.assign({}, basePatch, {
        iconSourceUrl: source.url,
        sourceType: basePatch.sourceType || "tab-visit",
        status: "ready",
        updatedAt: Date.now()
      }));
    }
  }

  return setSavedItemFaviconRecord(Object.assign({}, basePatch, {
    status: "missing",
    updatedAt: Date.now()
  }));
}

function captureSavedItemFavicon(ref, options) {
  if (!ref || !ref.itemId) return Promise.resolve(null);
  if (pendingSavedItemFaviconCaptures[ref.itemId]) return pendingSavedItemFaviconCaptures[ref.itemId];

  pendingSavedItemFaviconCaptures[ref.itemId] = captureSavedItemFaviconInternal(ref, options).then(function (result) {
    delete pendingSavedItemFaviconCaptures[ref.itemId];
    return result;
  }, function (error) {
    delete pendingSavedItemFaviconCaptures[ref.itemId];
    throw error;
  });

  return pendingSavedItemFaviconCaptures[ref.itemId];
}

async function captureMissingSavedItemFavicons(kind) {
  var refs = await getSavedItemRefsFromStorage();
  var store = await loadStoredItemFaviconStore();
  var missing = collectMissingSavedItemRefs(refs, store, kind);

  for (var i = 0; i < missing.length; i++) {
    await captureSavedItemFavicon(missing[i], {
      sourceType: "sync-backfill",
      forceRefresh: true
    });
  }

  return missing.length;
}