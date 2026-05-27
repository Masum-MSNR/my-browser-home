function getSavedItemFaviconRefFromElement(img, expectedUrl) {
  if (!img) return null;

  var itemId = "";
  var kind = "";
  if (img.dataset) {
    itemId = img.dataset.shortcutId || img.dataset.bmId || img.dataset.itemId || "";
    kind = normalizeSavedItemKind(img.dataset.faviconKind || (img.dataset.shortcutId ? "shortcut" : (img.dataset.bmId ? "bookmark" : "")));
  }

  if ((!itemId || !kind) && typeof img.closest === "function") {
    var shortcutAnchor = img.closest("[data-shortcut-id]");
    var bookmarkNode = img.closest("[data-bm-id]");
    if (shortcutAnchor) {
      itemId = shortcutAnchor.dataset.shortcutId || itemId;
      kind = kind || "shortcut";
    } else if (bookmarkNode) {
      itemId = bookmarkNode.dataset.bmId || itemId;
      kind = kind || "bookmark";
    }
  }

  var normalizedExpectedUrl = normalizeFaviconUrl(expectedUrl || "");
  if (!itemId || !kind || !normalizedExpectedUrl) return null;
  return {
    itemId: itemId,
    kind: kind,
    effectiveUrl: normalizedExpectedUrl
  };
}

function setFaviconWithFallback(img, url) {
  if (!img) return;

  var ref = getSavedItemFaviconRefFromElement(img, url);
  var record = ref ? getSavedItemFaviconRecordSync(ref.itemId) : null;
  var nextSrc = ref ? getRenderableSavedItemFavicon(record, ref.effectiveUrl) : "";

  img.src = nextSrc || DEFAULT_FAVICON;
  img.onerror = function () {
    if (img.src === DEFAULT_FAVICON) return;
    img.src = DEFAULT_FAVICON;
    img.onerror = null;
  };
}

function refreshFaviconFromCache(img, url) {
  setFaviconWithFallback(img, url);
}

function sendSavedItemFaviconMessage(payload) {
  return new Promise(function (resolve) {
    if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      resolve({ ok: false });
      return;
    }
    chrome.runtime.sendMessage(payload, function (response) {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false });
    });
  });
}

function openSavedItemInCurrentTab(kind, itemId, url) {
  if (!itemId || !url) return Promise.resolve(false);
  var fallbackUrl = normalizeFaviconUrl(url);
  return sendSavedItemFaviconMessage({
    type: ITEM_FAVICON_OPEN_CURRENT_TAB_MESSAGE,
    kind: normalizeSavedItemKind(kind),
    itemId: String(itemId),
    url: fallbackUrl
  }).then(function (response) {
    if (response && response.ok) return true;
    if (typeof window !== "undefined" && window.location && fallbackUrl) {
      window.location.href = fallbackUrl;
      return true;
    }
    return false;
  });
}

function openSavedItemInNewTab(kind, itemId, url) {
  if (!itemId || !url) return Promise.resolve(false);
  var fallbackUrl = normalizeFaviconUrl(url);
  return sendSavedItemFaviconMessage({
    type: ITEM_FAVICON_OPEN_NEW_TAB_MESSAGE,
    kind: normalizeSavedItemKind(kind),
    itemId: String(itemId),
    url: fallbackUrl
  }).then(function (response) {
    if (response && response.ok) return true;
    if (typeof window !== "undefined" && typeof window.open === "function" && fallbackUrl) {
      window.open(fallbackUrl, "_blank");
      return true;
    }
    return false;
  });
}