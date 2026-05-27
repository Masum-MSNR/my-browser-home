var bookmarkBarItems = document.getElementById("bookmark-bar-items");
var bookmarkBtn = document.getElementById("bookmark-btn");
var bookmarkDropdown = document.getElementById("bookmark-dropdown");
var bookmarkDropdownContent = document.getElementById("bookmark-dropdown-content");

var editingBookmarkId = null;
var currentFolderId = null;
var folderPath = [];
var showAddForms = false;
var activeSubmenu = null;
var barFolderOpenId = null;

// === Storage ===
async function getBookmarks() {
    if (typeof waitForSyncReady === "function") await waitForSyncReady();
    return (await syncGet("bookmarks")) || [];
}
async function getBookmarksCached() {
    return (await syncGet("bookmarks")) || [];
}
async function setBookmarks(val) {
    await syncSet({ bookmarks: val });
    if (typeof logSyncEvent === "function" && typeof summarizeSyncItems === "function") {
        logSyncEvent("local", "bookmarks-updated", {
            bookmarks: summarizeSyncItems(val, function (item) { return item && item.folderId; }, function (item) { return !!(item && item.url); })
        });
    }
    if (typeof markSyncDirty === "function") markSyncDirty("bookmarks");
    if (typeof autoSync === "function") autoSync();
}

async function getBookmarkLocalLinks() {
    return typeof readLocalLinkMap === "function" ? await readLocalLinkMap("bookmarks") : {};
}

async function setBookmarkLocalLink(bookmarkId, url) {
    if (!bookmarkId || typeof updateLocalLinkValue !== "function") return;
    await updateLocalLinkValue("bookmarks", bookmarkId, url);
}

async function clearBookmarkLocalLink(bookmarkId) {
    if (!bookmarkId || typeof updateLocalLinkValue !== "function") return;
    await updateLocalLinkValue("bookmarks", bookmarkId, "");
}
async function getFolders() {
    if (typeof waitForSyncReady === "function") await waitForSyncReady();
    return (await syncGet("bookmarkFolders")) || [];
}
async function getFoldersCached() {
    return (await syncGet("bookmarkFolders")) || [];
}
async function setFolders(val) {
    await syncSet({ bookmarkFolders: val });
    if (typeof logSyncEvent === "function" && typeof summarizeSyncItems === "function") {
        logSyncEvent("local", "bookmark-folders-updated", {
            bookmarkFolders: summarizeSyncItems(val, function (item) { return item && item.parentId; }, function (item) { return !!(item && item.name); })
        });
    }
    if (typeof markSyncDirty === "function") markSyncDirty("bookmarkFolders");
    if (typeof autoSync === "function") autoSync();
}

function addDeletedTombstones(collectionKey, ids, timestamp) {
    if (typeof addDeletedSyncTombstones !== "function") return;
    addDeletedSyncTombstones(collectionKey, ids, timestamp);
}

function getBookmarkScopeKey(value) {
    return value === undefined || value === null ? "__root__" : String(value);
}

function compareBookmarkSyncItems(a, b) {
    return typeof compareSyncItems === "function" ? compareSyncItems(a, b) : 0;
}

function normalizeScopedItems(items, scopeField, scopeValues, updatedAt) {
    if (!Array.isArray(items)) return items;
    if (typeof assignScopedSyncPositions === "function") {
        assignScopedSyncPositions(items, scopeField, scopeValues);
        return items;
    }
    return items;
}

function getNextScopedOrderKey(items, scopeField, scopeValue) {
    if (typeof getNextScopedSyncOrderKey === "function") {
        return getNextScopedSyncOrderKey(items, scopeField, scopeValue);
    }
    return formatSyncOrderKey(SYNC_ORDER_KEY_GAP);
}

function reorderScopedItems(items, scopeField, scopeValue, fromIdx, toIdx, mode) {
    if (!Array.isArray(items)) return false;
    var siblings = [];
    var targetScope = getBookmarkScopeKey(scopeValue);
    for (var i = 0; i < items.length; i++) {
        if (!items[i]) continue;
        if (getBookmarkScopeKey(items[i][scopeField]) === targetScope) siblings.push(items[i]);
    }
    siblings.sort(compareBookmarkSyncItems);
    if (mode === "swap") {
        return typeof swapSyncOrderItems === "function" ? swapSyncOrderItems(siblings, fromIdx, toIdx) : false;
    }
    var insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
    return typeof moveSyncOrderItem === "function" ? moveSyncOrderItem(siblings, fromIdx, insertAt) : false;
}

function collectFolderSubtreeIds(folderId, folders) {
    var queue = [folderId];
    var seen = {};
    var ids = [];
    while (queue.length > 0) {
        var currentId = queue.shift();
        if (!currentId || seen[currentId]) continue;
        seen[currentId] = true;
        ids.push(currentId);
        for (var i = 0; i < folders.length; i++) {
            if (folders[i] && folders[i].parentId === currentId) {
                queue.push(folders[i].id);
            }
        }
    }
    return ids;
}

async function deleteBookmarkById(bookmarkId) {
    var all = await getBookmarks();
    if (!Array.isArray(all)) all = [];

    var deleted = null;
    for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].id === bookmarkId) {
            deleted = all.splice(i, 1)[0];
            break;
        }
    }
    if (!deleted) return false;

    var now = Date.now();
    addDeletedTombstones("bookmarks", [deleted.id], now);
    normalizeScopedItems(all, "folderId", deleted.folderId || null, now);
    await clearBookmarkLocalLink(deleted.id);
    await setBookmarks(all);
    return true;
}

async function deleteFolderById(folderId) {
    var allFolders = await getFolders();
    if (!Array.isArray(allFolders)) allFolders = [];

    var targetFolder = null;
    for (var i = 0; i < allFolders.length; i++) {
        if (allFolders[i] && allFolders[i].id === folderId) {
            targetFolder = allFolders[i];
            break;
        }
    }
    if (!targetFolder) return false;

    var parentId = targetFolder.parentId || null;
    var subtreeIds = collectFolderSubtreeIds(folderId, allFolders);
    var subtreeSet = {};
    for (var j = 0; j < subtreeIds.length; j++) subtreeSet[subtreeIds[j]] = true;

    var remainingFolders = [];
    for (var k = 0; k < allFolders.length; k++) {
        if (!allFolders[k] || !subtreeSet[allFolders[k].id]) remainingFolders.push(allFolders[k]);
    }

    var allBookmarks = await getBookmarks();
    if (!Array.isArray(allBookmarks)) allBookmarks = [];
    var movedBookmarks = [];
    for (var m = 0; m < allBookmarks.length; m++) {
        if (allBookmarks[m] && allBookmarks[m].folderId && subtreeSet[allBookmarks[m].folderId]) {
            movedBookmarks.push(allBookmarks[m]);
        }
    }

    var now = Date.now();
    movedBookmarks.sort(compareBookmarkSyncItems);
    var nextOrderValue = getSyncOrderValue(getNextScopedOrderKey(allBookmarks, "folderId", parentId));
    for (var n = 0; n < movedBookmarks.length; n++) {
        movedBookmarks[n].folderId = parentId;
        movedBookmarks[n].orderKey = formatSyncOrderKey(nextOrderValue);
        nextOrderValue += SYNC_ORDER_KEY_GAP;
        movedBookmarks[n].updatedAt = now;
    }

    normalizeScopedItems(remainingFolders, "parentId", parentId, now);
    if (movedBookmarks.length > 0) {
        normalizeScopedItems(allBookmarks, "folderId", parentId, now);
    }

    addDeletedTombstones("bookmarkFolders", subtreeIds, now);

    if (currentFolderId && subtreeSet[currentFolderId]) {
        currentFolderId = parentId;
    }
    if (folderPath.length > 0) {
        var nextPath = [];
        for (var p = 0; p < folderPath.length; p++) {
            if (!subtreeSet[folderPath[p].id]) nextPath.push(folderPath[p]);
        }
        folderPath = nextPath;
    }

    await setFolders(remainingFolders);
    if (movedBookmarks.length > 0) await setBookmarks(allBookmarks);
    return true;
}

async function repairBookmarkHierarchy() {
    var folders = await getFolders();
    if (!Array.isArray(folders)) folders = [];
    var bookmarks = await getBookmarks();
    if (!Array.isArray(bookmarks)) bookmarks = [];

    var knownFolderIds = {};
    for (var i = 0; i < folders.length; i++) {
        if (folders[i] && folders[i].id) knownFolderIds[folders[i].id] = true;
    }

    var changedFolders = false;
    var changedBookmarks = false;
    var now = Date.now();

    for (var j = 0; j < folders.length; j++) {
        if (folders[j] && folders[j].parentId && !knownFolderIds[folders[j].parentId]) {
            folders[j].parentId = null;
            folders[j].updatedAt = now;
            changedFolders = true;
        }
    }

    for (var k = 0; k < bookmarks.length; k++) {
        if (bookmarks[k] && bookmarks[k].folderId && !knownFolderIds[bookmarks[k].folderId]) {
            bookmarks[k].folderId = null;
            bookmarks[k].updatedAt = now;
            changedBookmarks = true;
        }
    }

    if (changedFolders) {
        normalizeScopedItems(folders, "parentId", null, now);
        await setFolders(folders);
    }
    if (changedBookmarks) {
        normalizeScopedItems(bookmarks, "folderId", null, now);
        await setBookmarks(bookmarks);
    }
    return changedFolders || changedBookmarks;
}

// === Favicon ===
// === Collect all bookmarks in a folder (recursive) ===
async function getAllBookmarksInFolder(folderId) {
    var all = await getBookmarks();
    var folders = await getFolders();
    var result = [];
    var childFolderIds = [folderId];
    while (childFolderIds.length > 0) {
        var fid = childFolderIds.shift();
        for (var i = 0; i < all.length; i++) {
            if ((all[i].folderId || null) === fid) result.push(all[i]);
        }
        for (var j = 0; j < folders.length; j++) {
            if ((folders[j].parentId || null) === fid) childFolderIds.push(folders[j].id);
        }
    }
    return result;
}

// === Bar rendering ===
// Persist a resolved favicon URL onto a bookmark, so it syncs across devices
// and survives chrome.storage.local cache loss.
async function persistBookmarkFavicon(bookmarkId, realUrl) {
    var all = await getBookmarks();
    if (!Array.isArray(all)) return;
    var changed = false;
    for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].id === bookmarkId && all[i].favicon !== realUrl) {
            all[i].favicon = realUrl;
            all[i].updatedAt = Date.now();
            changed = true;
        }
    }
    if (changed) await setBookmarks(all);
}

async function backfillBookmarkFaviconsFromCache(targetCacheKey) {
    if (typeof collectCachedFaviconBackfillUpdates !== "function" || typeof applyCachedFaviconBackfillUpdates !== "function") {
        return false;
    }

    var all = await getBookmarks();
    if (!Array.isArray(all) || all.length === 0) return false;

    var localLinks = await getBookmarkLocalLinks();
    var updates = await collectCachedFaviconBackfillUpdates(all, localLinks, targetCacheKey);
    if (!updates.length) return false;

    if (!applyCachedFaviconBackfillUpdates(all, updates)) return false;
    await setBookmarks(all);
    return true;
}

async function fetchBookmarkFaviconOnSave(bookmarkId) {
    if (!bookmarkId || typeof requestFaviconCacheRefresh !== "function") return;

    var all = await getBookmarks();
    if (!Array.isArray(all)) return;
    var localLinks = await getBookmarkLocalLinks();

    var bookmark = null;
    for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].id === bookmarkId) {
            bookmark = all[i];
            break;
        }
    }
    if (!bookmark) return;

    var effectiveUrl = typeof getResolvedItemUrl === "function"
        ? getResolvedItemUrl(bookmark, localLinks)
        : bookmark.url;
    if (!effectiveUrl) return;

    var result = await requestFaviconCacheRefresh(effectiveUrl, bookmark.favicon || null);
    if (!result) return;

    var nextFavicon = result.realUrl || DEFAULT_FAVICON;
    if (!nextFavicon || bookmark.favicon === nextFavicon) return;

    bookmark.favicon = nextFavicon;
    bookmark.updatedAt = Date.now();
    await setBookmarks(all);
}

function bmFaviconCb(bookmarkId) {
    return function (realUrl) { persistBookmarkFavicon(bookmarkId, realUrl); };
}
