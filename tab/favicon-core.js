var DEFAULT_FAVICON = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
  '<circle cx="12" cy="12" r="10" fill="rgba(15,23,42,0.38)" stroke="rgba(255,255,255,0.92)" stroke-width="1.8"/>' +
  '<ellipse cx="12" cy="12" rx="4.2" ry="8.2" stroke="rgba(255,255,255,0.92)" stroke-width="1.4"/>' +
  '<path d="M4 12h16" stroke="rgba(255,255,255,0.92)" stroke-width="1.4" stroke-linecap="round"/>' +
  '<path d="M12 4v16" stroke="rgba(255,255,255,0.92)" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>'
);

var ITEM_FAVICON_STORE_STORAGE_KEY = "_itemFaviconStoreV2";
var ITEM_FAVICON_STORE_VERSION = 2;
var ITEM_FAVICON_OPEN_CURRENT_TAB_MESSAGE = "ITEM_FAVICON_OPEN_CURRENT_TAB";
var ITEM_FAVICON_OPEN_NEW_TAB_MESSAGE = "ITEM_FAVICON_OPEN_NEW_TAB";
var ITEM_FAVICON_CHANGED_EVENT = "saveditemfaviconchange";

var itemFaviconStoreCache = createEmptyItemFaviconStore();

function createEmptyItemFaviconStore() {
  return {
    version: ITEM_FAVICON_STORE_VERSION,
    items: {}
  };
}

function cloneItemFaviconValue(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeFaviconUrl(url) {
  try {
    var parsed = new URL(String(url));
    parsed.hash = "";
    return parsed.href;
  } catch (e) {
    return "";
  }
}

function getFaviconUrlOrigin(url) {
  try {
    return new URL(String(url)).origin;
  } catch (e) {
    return "";
  }
}

function normalizeSavedItemKind(kind) {
  if (kind === "shortcut" || kind === "shortcuts") return "shortcut";
  if (kind === "bookmark" || kind === "bookmarks") return "bookmark";
  return "";
}

function isRenderableFaviconSource(source) {
  if (!source || typeof source !== "string") return false;
  return source.indexOf("data:") === 0 ||
    source.indexOf("http://") === 0 ||
    source.indexOf("https://") === 0 ||
    source.indexOf("chrome://favicon2/") === 0 ||
    source.indexOf("chrome-extension://") === 0 ||
    source.indexOf("/_favicon/?") === 0;
}

function sanitizeItemFaviconRecord(record) {
  if (!record || typeof record !== "object") return null;

  var itemId = record.itemId ? String(record.itemId) : "";
  var kind = normalizeSavedItemKind(record.kind);
  if (!itemId || !kind) return null;

  var next = {
    itemId: itemId,
    kind: kind,
    effectiveUrlSnapshot: normalizeFaviconUrl(record.effectiveUrlSnapshot || ""),
    finalVisitedUrl: normalizeFaviconUrl(record.finalVisitedUrl || ""),
    iconSourceUrl: isRenderableFaviconSource(record.iconSourceUrl) ? String(record.iconSourceUrl) : "",
    iconDataUrl: typeof record.iconDataUrl === "string" && record.iconDataUrl.indexOf("data:") === 0 ? record.iconDataUrl : "",
    sourceType: record.sourceType ? String(record.sourceType) : "",
    updatedAt: typeof record.updatedAt === "number" && record.updatedAt > 0 ? record.updatedAt : Date.now(),
    status: record.status === "missing" ? "missing" : "ready"
  };

  if (!next.iconDataUrl && !next.iconSourceUrl) {
    next.status = "missing";
  }
  if (!next.effectiveUrlSnapshot) {
    next.status = "missing";
  }

  return next;
}

function sanitizeItemFaviconStore(store) {
  var next = createEmptyItemFaviconStore();
  if (!store || typeof store !== "object") return next;

  var items = store.items && typeof store.items === "object" ? store.items : {};
  for (var itemId in items) {
    if (!Object.prototype.hasOwnProperty.call(items, itemId)) continue;
    var record = sanitizeItemFaviconRecord(items[itemId]);
    if (!record) continue;
    next.items[record.itemId] = record;
  }

  return next;
}

function persistItemFaviconStoreMirror() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ITEM_FAVICON_STORE_STORAGE_KEY, JSON.stringify(itemFaviconStoreCache));
  } catch (e) {}
}

function rememberItemFaviconStore(store) {
  itemFaviconStoreCache = sanitizeItemFaviconStore(store);
  persistItemFaviconStoreMirror();
  return itemFaviconStoreCache;
}

function getItemFaviconStoreSync() {
  return itemFaviconStoreCache;
}

function getSavedItemFaviconRecordSync(itemId) {
  if (!itemId) return null;
  var record = itemFaviconStoreCache.items[String(itemId)] || null;
  return sanitizeItemFaviconRecord(record);
}

function getRenderableSavedItemFavicon(record, expectedUrl) {
  var normalizedExpectedUrl = normalizeFaviconUrl(expectedUrl || "");
  var next = sanitizeItemFaviconRecord(record);
  if (!next || next.status !== "ready") return "";
  if (!normalizedExpectedUrl || next.effectiveUrlSnapshot !== normalizedExpectedUrl) return "";
  return next.iconDataUrl || next.iconSourceUrl || "";
}

function hasRenderableSavedItemFavicon(itemId, expectedUrl) {
  return !!getRenderableSavedItemFavicon(getSavedItemFaviconRecordSync(itemId), expectedUrl);
}

function dispatchSavedItemFaviconChange() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function" || typeof CustomEvent === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(ITEM_FAVICON_CHANGED_EVENT));
}

function loadStoredItemFaviconStore() {
  return new Promise(function (resolve) {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve(getItemFaviconStoreSync());
      return;
    }

    chrome.storage.local.get(ITEM_FAVICON_STORE_STORAGE_KEY, function (result) {
      var store = sanitizeItemFaviconStore(result && result[ITEM_FAVICON_STORE_STORAGE_KEY]);
      rememberItemFaviconStore(store);
      resolve(store);
    });
  });
}

function getStoredSavedItemFaviconRecord(itemId) {
  return loadStoredItemFaviconStore().then(function (store) {
    return store.items[String(itemId)] || null;
  });
}

function mergeSavedItemFaviconRecord(currentRecord, patch) {
  var current = sanitizeItemFaviconRecord(currentRecord);
  var next = sanitizeItemFaviconRecord(Object.assign({}, current || {}, patch || {}));
  if (!next) return current;
  if (!current) return next;

  if ((current.updatedAt || 0) > (next.updatedAt || 0)) return current;
  if (next.status !== "ready" && current.status === "ready") return current;
  return next;
}

function setSavedItemFaviconRecord(patch) {
  return loadStoredItemFaviconStore().then(function (store) {
    var itemId = patch && patch.itemId ? String(patch.itemId) : "";
    if (!itemId) return null;

    var current = store.items[itemId] || null;
    var next = mergeSavedItemFaviconRecord(current, patch);
    if (!next) return current;

    store.items[itemId] = next;
    rememberItemFaviconStore(store);
    dispatchSavedItemFaviconChange();

    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve(next);
        return;
      }
      chrome.storage.local.set({ [ITEM_FAVICON_STORE_STORAGE_KEY]: store }, function () {
        resolve(next);
      });
    });
  });
}

function removeSavedItemFaviconRecord(itemId) {
  return loadStoredItemFaviconStore().then(function (store) {
    var key = itemId ? String(itemId) : "";
    if (!key || !Object.prototype.hasOwnProperty.call(store.items, key)) return false;

    delete store.items[key];
    rememberItemFaviconStore(store);
    dispatchSavedItemFaviconChange();

    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve(true);
        return;
      }
      chrome.storage.local.set({ [ITEM_FAVICON_STORE_STORAGE_KEY]: store }, function () {
        resolve(true);
      });
    });
  });
}

function buildSavedItemFaviconRef(kind, item, localLinks) {
  if (!item || !item.id) return null;

  var normalizedKind = normalizeSavedItemKind(kind);
  if (!normalizedKind) return null;

  var effectiveUrl = typeof getResolvedItemUrl === "function"
    ? getResolvedItemUrl(item, localLinks)
    : item.url;
  var normalizedUrl = normalizeFaviconUrl(effectiveUrl || item.url || "");
  if (!normalizedUrl) return null;

  return {
    itemId: String(item.id),
    kind: normalizedKind,
    effectiveUrl: normalizedUrl,
    name: item.name || ""
  };
}

function collectSavedItemRefsFromStorageResult(result) {
  var refs = [];
  var shortcuts = result && Array.isArray(result.shortcuts) ? result.shortcuts : [];
  var bookmarks = result && Array.isArray(result.bookmarks) ? result.bookmarks : [];
  var shortcutLocalLinks = typeof normalizeLocalLinkMap === "function"
    ? normalizeLocalLinkMap(result && result[SHORTCUT_LOCAL_LINKS_STORAGE_KEY])
    : {};
  var bookmarkLocalLinks = typeof normalizeLocalLinkMap === "function"
    ? normalizeLocalLinkMap(result && result[BOOKMARK_LOCAL_LINKS_STORAGE_KEY])
    : {};

  var i;
  for (i = 0; i < shortcuts.length; i++) {
    var shortcutRef = buildSavedItemFaviconRef("shortcut", shortcuts[i], shortcutLocalLinks);
    if (shortcutRef) refs.push(shortcutRef);
  }
  for (i = 0; i < bookmarks.length; i++) {
    var bookmarkRef = buildSavedItemFaviconRef("bookmark", bookmarks[i], bookmarkLocalLinks);
    if (bookmarkRef) refs.push(bookmarkRef);
  }

  return refs;
}

function getSavedItemRefsFromStorage() {
  return new Promise(function (resolve) {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      resolve([]);
      return;
    }

    chrome.storage.local.get([
      "shortcuts",
      "bookmarks",
      SHORTCUT_LOCAL_LINKS_STORAGE_KEY,
      BOOKMARK_LOCAL_LINKS_STORAGE_KEY
    ], function (result) {
      resolve(collectSavedItemRefsFromStorageResult(result));
    });
  });
}

function findSavedItemRefById(refs, kind, itemId) {
  if (!Array.isArray(refs) || !itemId) return null;
  var normalizedKind = normalizeSavedItemKind(kind);
  var targetId = String(itemId);
  for (var i = 0; i < refs.length; i++) {
    if (!refs[i]) continue;
    if (refs[i].itemId === targetId && refs[i].kind === normalizedKind) return refs[i];
  }
  return null;
}

function findSavedItemRefsByExactUrl(url, refs) {
  var normalizedUrl = normalizeFaviconUrl(url);
  if (!normalizedUrl || !Array.isArray(refs)) return [];

  var matches = [];
  for (var i = 0; i < refs.length; i++) {
    if (!refs[i] || refs[i].effectiveUrl !== normalizedUrl) continue;
    matches.push(refs[i]);
  }
  return matches;
}

function collectMissingSavedItemRefs(refs, store, kind) {
  var normalizedKind = kind ? normalizeSavedItemKind(kind) : "";
  var snapshot = sanitizeItemFaviconStore(store || getItemFaviconStoreSync());
  var missing = [];

  if (!Array.isArray(refs)) return missing;

  for (var i = 0; i < refs.length; i++) {
    var ref = refs[i];
    if (!ref) continue;
    if (normalizedKind && ref.kind !== normalizedKind) continue;
    if (getRenderableSavedItemFavicon(snapshot.items[ref.itemId], ref.effectiveUrl)) continue;
    missing.push(ref);
  }

  return missing;
}

(function hydrateItemFaviconStore() {
  if (typeof localStorage !== "undefined") {
    try {
      var raw = localStorage.getItem(ITEM_FAVICON_STORE_STORAGE_KEY);
      if (raw) rememberItemFaviconStore(JSON.parse(raw));
    } catch (e) {}
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(ITEM_FAVICON_STORE_STORAGE_KEY, function (result) {
      if (!result || !result[ITEM_FAVICON_STORE_STORAGE_KEY]) return;
      rememberItemFaviconStore(result[ITEM_FAVICON_STORE_STORAGE_KEY]);
      dispatchSavedItemFaviconChange();
    });
  }
})();

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "local" || !changes[ITEM_FAVICON_STORE_STORAGE_KEY]) return;
    rememberItemFaviconStore(changes[ITEM_FAVICON_STORE_STORAGE_KEY].newValue);
    dispatchSavedItemFaviconChange();
  });
}