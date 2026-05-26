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
