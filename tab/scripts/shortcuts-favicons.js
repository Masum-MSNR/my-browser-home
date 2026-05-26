renderShortcuts().then(refreshShortcutFavicons);

window.addEventListener("syncdataloaded", async function (event) {
  var detail = event && event.detail ? event.detail : null;
  if (detail && Array.isArray(detail.structuralKeys) && detail.structuralKeys.indexOf("shortcuts") === -1) {
    return;
  }

  await renderShortcuts();
  refreshShortcutFavicons();
});

// === Live favicon refresh for shortcuts ===
// Persists the resolved favicon URL into the shortcut data so it syncs
// across devices and survives chrome.storage.local cache loss.
async function persistShortcutFavicon(shortcutId, realUrl) {
  var all = await getShortcuts();
  if (!Array.isArray(all)) return;
  var changed = false;
  for (var i = 0; i < all.length; i++) {
    if (all[i] && all[i].id === shortcutId && all[i].favicon !== realUrl) {
      all[i].favicon = realUrl;
      all[i].updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) await setShortcuts(all);
}

function refreshShortcutFavicons() {
  var items = shortcutList.querySelectorAll(".shortcut-item a");
  for (var i = 0; i < items.length; i++) {
    var img = items[i].querySelector(".shortcut-icon");
    var href = items[i].getAttribute("href");
    if (img && href) {
      refreshFaviconFromCache(img, href);
    }
  }
}

async function refreshRenderedShortcutIcons() {
  var shortcuts = await getShortcuts();
  if (!Array.isArray(shortcuts)) return;

  var localLinks = await getShortcutLocalLinks();
  var byId = {};
  for (var i = 0; i < shortcuts.length; i++) {
    if (shortcuts[i] && shortcuts[i].id) byId[shortcuts[i].id] = shortcuts[i];
  }

  var items = shortcutList.querySelectorAll(".shortcut-item a");
  for (var j = 0; j < items.length; j++) {
    var shortcutId = items[j].dataset.shortcutId || "";
    var shortcut = byId[shortcutId];
    if (!shortcut) continue;

    var img = items[j].querySelector(".shortcut-icon");
    if (!img) continue;

    var effectiveUrl = typeof getResolvedItemUrl === "function"
      ? getResolvedItemUrl(shortcut, localLinks)
      : shortcut.url;
    setFaviconWithFallback(img, effectiveUrl || shortcut.url, shortcut.favicon);
  }
}

window.addEventListener("syncitemmetaupdated", async function (event) {
  var detail = event && event.detail ? event.detail : null;
  if (detail && Array.isArray(detail.metadataOnlyKeys) && detail.metadataOnlyKeys.indexOf("shortcuts") === -1) {
    return;
  }

  await refreshRenderedShortcutIcons();
  refreshShortcutFavicons();
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "local") return;
  if (typeof SHORTCUT_LOCAL_LINKS_STORAGE_KEY !== "undefined" && changes[SHORTCUT_LOCAL_LINKS_STORAGE_KEY]) {
    renderShortcuts().then(refreshShortcutFavicons);
    return;
  }
  var updatedKey = null;
  for (var key in changes) {
    if (!changes.hasOwnProperty(key)) continue;
    if (typeof isFaviconCacheStorageKey === "function" && !isFaviconCacheStorageKey(key)) continue;
    if (changes[key].newValue && (changes[key].newValue.favicon || changes[key].newValue.faviconDataUrl)) {
      updatedKey = key;
      break;
    }
  }
  if (!updatedKey) return;
  var items = shortcutList.querySelectorAll(".shortcut-item a");
  for (var i = 0; i < items.length; i++) {
    var href = items[i].getAttribute("href");
    if (href && typeof getFaviconCacheKey === "function" && getFaviconCacheKey(href) === updatedKey) {
      var img = items[i].querySelector(".shortcut-icon");
      var shortcutId = items[i].dataset.shortcutId || "";
      if (img) {
        (function (im, hr, id) {
          refreshFaviconFromCache(im, hr, function (realUrl) {
            persistShortcutFavicon(id, realUrl);
          });
        })(img, href, shortcutId);
      }
    }
  }
});
