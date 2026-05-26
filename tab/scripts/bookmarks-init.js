function wireDropdownDragReorder(item, type, idx) {
    var dragCounter = 0;
    item.addEventListener("dragstart", function (e) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "dl:" + type + ":" + idx);
        currentDragType = type;
        item.classList.add("dragging");
    });
    item.addEventListener("dragend", function () {
        item.classList.remove("dragging");
        currentDragType = null;
        var all = document.querySelectorAll("#bookmark-dropdown-list .bm-folder-item, #bookmark-dropdown-list .bookmark-dropdown-item");
        for (var i = 0; i < all.length; i++) {
            all[i].classList.remove("drag-over");
            all[i]._dragCounter = 0;
        }
    });
    item.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (currentDragType === type && !item.classList.contains("dragging")) {
            item.classList.add("drag-over");
        }
    });
    item.addEventListener("dragenter", function (e) {
        e.preventDefault();
        if (currentDragType !== type) return;
        item._dragCounter = (item._dragCounter || 0) + 1;
        if (!item.classList.contains("dragging")) item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", function () {
        item._dragCounter = (item._dragCounter || 0) - 1;
        if (item._dragCounter <= 0) item.classList.remove("drag-over");
    });
    item.addEventListener("drop", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        item._dragCounter = 0;
        item.classList.remove("drag-over");
        var data = e.dataTransfer.getData("text/plain").split(":");
        if (data[0] !== "dl") return;
        var fromType = data[1];
        var fromIdx = parseInt(data[2], 10);
        if (isNaN(fromIdx) || fromType !== type) return;

        if (type === "folder") {
            await reorderLevelFolders(fromIdx, idx);
        } else {
            await reorderLevelBookmarks(fromIdx, idx);
        }
        renderBookmarkBar();
        renderBookmarkList();
    });
}

async function reorderLevelFolders(fromIdx, toIdx) {
    var allFolders = await getFolders();
    var parentId = getCurrentParentId();
    if (typeof reorderScopedItems === "function") {
        reorderScopedItems(allFolders, "parentId", parentId, fromIdx, toIdx, "swap");
        normalizeScopedItems(allFolders, "parentId", parentId);
    }
    await setFolders(allFolders);
}

async function reorderLevelBookmarks(fromIdx, toIdx) {
    var all = await getBookmarks();
    var parentId = getCurrentParentId();
    if (typeof reorderScopedItems === "function") {
        reorderScopedItems(all, "folderId", parentId, fromIdx, toIdx, "swap");
        normalizeScopedItems(all, "folderId", parentId);
    }
    await setBookmarks(all);
}

// === Mouse wheel → horizontal scroll on bar ===
bookmarkBarItems.addEventListener("wheel", function (e) {
    if (e.deltaY !== 0) {
        e.preventDefault();
        bookmarkBarItems.scrollLeft += e.deltaY;
    }
}, { passive: false });

// === Live favicon refresh: try to upgrade icons from cached real favicons ===
function refreshAllFaviconsFromCache() {
    // Top bar
    var barItems = bookmarkBarItems.querySelectorAll(".bm-bar-bookmark");
    for (var i = 0; i < barItems.length; i++) {
        var url = barItems[i].dataset.bmUrl;
        var img = barItems[i].querySelector(".bm-favicon");
        var bookmarkId = barItems[i].dataset.bmId;
        if (url && img) refreshFaviconFromCache(img, url, bookmarkId ? bmFaviconCb(bookmarkId) : null);
    }
    // Dialog dropdown (if open)
    var dlItems = document.querySelectorAll("#bookmark-dropdown-list .bm-dl-favicon");
    for (var j = 0; j < dlItems.length; j++) {
        if (dlItems[j].dataset.bmUrl) {
            refreshFaviconFromCache(dlItems[j], dlItems[j].dataset.bmUrl, dlItems[j].dataset.bmId ? bmFaviconCb(dlItems[j].dataset.bmId) : null);
        }
    }
    // Submenu (if open)
    var subItems = document.querySelectorAll("#bm-bar-submenu .bm-submenu-bookmark");
    for (var k = 0; k < subItems.length; k++) {
        var subImg = subItems[k].querySelector("img");
        if (subImg && subItems[k].href) {
            refreshFaviconFromCache(subImg, subItems[k].href, subItems[k].dataset.bmId ? bmFaviconCb(subItems[k].dataset.bmId) : null);
        }
    }
}

async function refreshRenderedBookmarkIcons() {
    var bookmarks = await getBookmarksCached();
    if (!Array.isArray(bookmarks)) return;

    var localLinks = await getBookmarkLocalLinks();
    var byId = {};
    for (var i = 0; i < bookmarks.length; i++) {
        if (bookmarks[i] && bookmarks[i].id) byId[bookmarks[i].id] = bookmarks[i];
    }

    var barItems = bookmarkBarItems.querySelectorAll(".bm-bar-bookmark");
    for (var j = 0; j < barItems.length; j++) {
        var bookmarkId = barItems[j].dataset.bmId || "";
        var bookmark = byId[bookmarkId];
        if (!bookmark) continue;

        var url = typeof getResolvedItemUrl === "function"
            ? getResolvedItemUrl(bookmark, localLinks)
            : bookmark.url;
        var img = barItems[j].querySelector(".bm-favicon");
        if (!img || !url) continue;

        barItems[j].dataset.bmUrl = url;
        setFaviconWithFallback(img, url, bookmark.favicon);
    }

    var dropdownIcons = document.querySelectorAll("#bookmark-dropdown-list .bm-dl-favicon");
    for (var k = 0; k < dropdownIcons.length; k++) {
        var dropdownBookmark = byId[dropdownIcons[k].dataset.bmId || ""];
        if (!dropdownBookmark) continue;

        var dropdownUrl = typeof getResolvedItemUrl === "function"
            ? getResolvedItemUrl(dropdownBookmark, localLinks)
            : dropdownBookmark.url;
        if (!dropdownUrl) continue;

        dropdownIcons[k].dataset.bmUrl = dropdownUrl;
        setFaviconWithFallback(dropdownIcons[k], dropdownUrl, dropdownBookmark.favicon);
    }

    var submenuItems = document.querySelectorAll("#bm-bar-submenu .bm-submenu-bookmark");
    for (var m = 0; m < submenuItems.length; m++) {
        var submenuBookmark = byId[submenuItems[m].dataset.bmId || ""];
        if (!submenuBookmark) continue;

        var submenuUrl = typeof getResolvedItemUrl === "function"
            ? getResolvedItemUrl(submenuBookmark, localLinks)
            : submenuBookmark.url;
        var submenuImg = submenuItems[m].querySelector("img");
        if (!submenuImg || !submenuUrl) continue;

        setFaviconWithFallback(submenuImg, submenuUrl, submenuBookmark.favicon);
    }
}

window.addEventListener("syncitemmetaupdated", async function (event) {
    var detail = event && event.detail ? event.detail : null;
    if (detail && Array.isArray(detail.metadataOnlyKeys) && detail.metadataOnlyKeys.indexOf("bookmarks") === -1) {
        return;
    }

    await refreshRenderedBookmarkIcons();
    refreshAllFaviconsFromCache();
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "local") return;
    if (typeof BOOKMARK_LOCAL_LINKS_STORAGE_KEY !== "undefined" && changes[BOOKMARK_LOCAL_LINKS_STORAGE_KEY]) {
        (async function () {
            await renderBookmarkBar();
            if (bookmarkDropdown.classList.contains("open")) renderBookmarkDropdown();
            refreshAllFaviconsFromCache();
        })();
        return;
    }
    var updatedKey = null;
    for (var key in changes) {
        if (!changes.hasOwnProperty(key)) continue;
        if (typeof isFaviconCacheStorageKey === "function" && !isFaviconCacheStorageKey(key)) continue;
        if (changes[key].newValue && (changes[key].newValue.favicon || changes[key].newValue.faviconDataUrl)) {
            updatedKey = key; break;
        }
    }
    if (!updatedKey) return;
    // Refresh on top bar
    var barItems = bookmarkBarItems.querySelectorAll(".bm-bar-bookmark");
    for (var i = 0; i < barItems.length; i++) {
        var url = barItems[i].dataset.bmUrl;
        if (url && typeof getFaviconCacheKey === "function" && getFaviconCacheKey(url) === updatedKey) {
            var img = barItems[i].querySelector(".bm-favicon");
            if (img) refreshFaviconFromCache(img, url, barItems[i].dataset.bmId ? bmFaviconCb(barItems[i].dataset.bmId) : null);
        }
    }
    // Refresh in dialog dropdown (if open)
    var dlItems = document.querySelectorAll("#bookmark-dropdown-list .bookmark-dropdown-item");
    for (var j = 0; j < dlItems.length; j++) {
        var dlImg = dlItems[j].querySelector(".bm-dl-favicon");
        var dlUrl = dlImg ? (dlImg.dataset.bmUrl || "") : "";
        if (dlImg && dlUrl && typeof getFaviconCacheKey === "function" && getFaviconCacheKey(dlUrl) === updatedKey) {
            refreshFaviconFromCache(dlImg, dlUrl, dlImg.dataset.bmId ? bmFaviconCb(dlImg.dataset.bmId) : null);
        }
    }
    // Refresh in submenu (if open)
    var subItems = document.querySelectorAll("#bm-bar-submenu .bm-submenu-bookmark");
    for (var k = 0; k < subItems.length; k++) {
        var subImg = subItems[k].querySelector("img");
        if (subImg && typeof getFaviconCacheKey === "function" && getFaviconCacheKey(subItems[k].href) === updatedKey) {
            refreshFaviconFromCache(subImg, subItems[k].href, subItems[k].dataset.bmId ? bmFaviconCb(subItems[k].dataset.bmId) : null);
        }
    }
});

// === Init ===
document.body.classList.add("bookmark-bar-visible");
window.addEventListener("syncdataloaded", async function (event) {
    var detail = event && event.detail ? event.detail : null;
    if (detail && Array.isArray(detail.structuralKeys)) {
        var touchesBookmarks = detail.structuralKeys.indexOf("bookmarks") !== -1;
        var touchesFolders = detail.structuralKeys.indexOf("bookmarkFolders") !== -1;
        if (!touchesBookmarks && !touchesFolders) return;
    }

    await repairBookmarkHierarchy();
    await renderBookmarkBar();
    refreshAllFaviconsFromCache();
});

(async function initBookmarks() {
    await renderBookmarkBar({ useCachedData: true });
    refreshAllFaviconsFromCache();

    if (typeof waitForSyncReady === "function") await waitForSyncReady();
    await repairBookmarkHierarchy();
    await renderBookmarkBar();
    refreshAllFaviconsFromCache();
})();
