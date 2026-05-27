async function backfillShortcutFaviconsFromCache() {
  if (typeof captureMissingSavedItemFavicons !== "function") return false;
  return (await captureMissingSavedItemFavicons("shortcut")) > 0;
}

function refreshShortcutFavicons() {
  var items = shortcutList.querySelectorAll(".shortcut-item a");
  for (var i = 0; i < items.length; i++) {
    var img = items[i].querySelector(".shortcut-icon");
    var href = items[i].getAttribute("href");
    if (img && href) refreshFaviconFromCache(img, href);
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
    setFaviconWithFallback(img, effectiveUrl || shortcut.url);
  }
}

renderShortcuts().then(async function () {
  refreshShortcutFavicons();
  await backfillShortcutFaviconsFromCache();
});

window.addEventListener("syncdataloaded", async function (event) {
  var detail = event && event.detail ? event.detail : null;
  if (detail && Array.isArray(detail.structuralKeys) && detail.structuralKeys.indexOf("shortcuts") === -1) {
    return;
  }

  await renderShortcuts();
  refreshShortcutFavicons();
  await backfillShortcutFaviconsFromCache();
});

window.addEventListener("syncitemmetaupdated", async function (event) {
  var detail = event && event.detail ? event.detail : null;
  if (detail && Array.isArray(detail.metadataOnlyKeys) && detail.metadataOnlyKeys.indexOf("shortcuts") === -1) {
    return;
  }

  await refreshRenderedShortcutIcons();
  await backfillShortcutFaviconsFromCache();
});

window.addEventListener(ITEM_FAVICON_CHANGED_EVENT, function () {
  refreshShortcutFavicons();
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "local") return;
  if (typeof SHORTCUT_LOCAL_LINKS_STORAGE_KEY !== "undefined" && changes[SHORTCUT_LOCAL_LINKS_STORAGE_KEY]) {
    renderShortcuts().then(async function () {
      refreshShortcutFavicons();
      await backfillShortcutFaviconsFromCache();
    });
  }
});
