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

function getDeletedTombstones() {
    try {
        var tombstones = JSON.parse(localStorage.getItem("_deleted") || "{}");
        return tombstones && typeof tombstones === "object" ? tombstones : {};
    } catch (e) {
        return {};
    }
}

function setDeletedTombstones(tombstones) {
    localStorage.setItem("_deleted", JSON.stringify(tombstones || {}));
}

function addDeletedTombstones(ids, timestamp) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    var tombstones = getDeletedTombstones();
    var now = timestamp || Date.now();
    var changed = false;
    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (!id) continue;
        if (!tombstones[id] || tombstones[id] < now) {
            tombstones[id] = now;
            changed = true;
        }
    }
    if (changed) setDeletedTombstones(tombstones);
}

function getBookmarkScopeKey(value) {
    return value === undefined || value === null ? "__root__" : String(value);
}

function compareBookmarkSyncItems(a, b) {
    var ap = typeof a.position === "number" ? a.position : 0;
    var bp = typeof b.position === "number" ? b.position : 0;
    if (ap !== bp) return ap - bp;
    var au = a && a.updatedAt ? a.updatedAt : 0;
    var bu = b && b.updatedAt ? b.updatedAt : 0;
    if (au !== bu) return au - bu;
    var aid = a && a.id ? String(a.id) : "";
    var bid = b && b.id ? String(b.id) : "";
    if (aid < bid) return -1;
    if (aid > bid) return 1;
    return 0;
}

function normalizeScopedItems(items, scopeField, scopeValues, updatedAt) {
    if (!Array.isArray(items)) return items;

    var scopeSet = null;
    if (scopeValues !== undefined) {
        var list = Array.isArray(scopeValues) ? scopeValues : [scopeValues];
        scopeSet = {};
        for (var i = 0; i < list.length; i++) {
            scopeSet[getBookmarkScopeKey(list[i])] = true;
        }
    }

    var groups = {};
    for (var j = 0; j < items.length; j++) {
        var item = items[j];
        if (!item) continue;
        var scopeKey = getBookmarkScopeKey(item[scopeField]);
        if (scopeSet && !scopeSet[scopeKey]) continue;
        if (!groups[scopeKey]) groups[scopeKey] = [];
        groups[scopeKey].push(item);
    }

    for (var key in groups) {
        if (!groups.hasOwnProperty(key)) continue;
        groups[key].sort(compareBookmarkSyncItems);
        for (var index = 0; index < groups[key].length; index++) {
            groups[key][index].position = index;
            if (updatedAt) groups[key][index].updatedAt = updatedAt;
        }
    }
    return items;
}

function getNextScopedPosition(items, scopeField, scopeValue) {
    var maxPos = -1;
    var scopeKey = getBookmarkScopeKey(scopeValue);
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || getBookmarkScopeKey(item[scopeField]) !== scopeKey) continue;
        var pos = typeof item.position === "number" ? item.position : -1;
        if (pos > maxPos) maxPos = pos;
    }
    return maxPos + 1;
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
    addDeletedTombstones([deleted.id], now);
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
    var nextPosition = getNextScopedPosition(allBookmarks, "folderId", parentId);
    var movedBookmarks = [];
    for (var m = 0; m < allBookmarks.length; m++) {
        if (allBookmarks[m] && allBookmarks[m].folderId && subtreeSet[allBookmarks[m].folderId]) {
            movedBookmarks.push(allBookmarks[m]);
        }
    }

    var now = Date.now();
    movedBookmarks.sort(compareBookmarkSyncItems);
    for (var n = 0; n < movedBookmarks.length; n++) {
        movedBookmarks[n].folderId = parentId;
        movedBookmarks[n].position = nextPosition++;
        movedBookmarks[n].updatedAt = now;
    }

    normalizeScopedItems(remainingFolders, "parentId", parentId, now);
    if (movedBookmarks.length > 0) {
        normalizeScopedItems(allBookmarks, "folderId", parentId, now);
    }

    addDeletedTombstones(subtreeIds, now);

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

async function renderBookmarkBar(options) {
    options = options || {};
    var readBookmarks = options.useCachedData ? getBookmarksCached : getBookmarks;
    var readFolders = options.useCachedData ? getFoldersCached : getFolders;

    var bookmarks = await readBookmarks();
    if (!Array.isArray(bookmarks)) bookmarks = [];
    var folders = await readFolders();
    if (!Array.isArray(folders)) folders = [];
    var localLinks = await getBookmarkLocalLinks();

    bookmarkBarItems.innerHTML = "";

    // Root-level items
    var rootFolders = [];
    var rootBookmarks = [];
    for (var i = 0; i < folders.length; i++) {
        if ((folders[i].parentId || null) === null) rootFolders.push(folders[i]);
    }
    for (var j = 0; j < bookmarks.length; j++) {
        if ((bookmarks[j].folderId || null) === null) rootBookmarks.push(bookmarks[j]);
    }
    rootFolders.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    rootBookmarks.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

    if (rootFolders.length === 0 && rootBookmarks.length === 0) {
        var empty = document.createElement("span");
        empty.className = "bookmark-bar-empty";
        empty.textContent = "Click the bookmark icon to add items";
        bookmarkBarItems.appendChild(empty);
        return;
    }

    // Root folders
    for (var f = 0; f < rootFolders.length; f++) {
        createBarFolderItem(rootFolders[f], f);
    }

    // Separator between folders and bookmarks (if both exist)
    if (rootFolders.length > 0 && rootBookmarks.length > 0) {
        var sep = document.createElement("span");
        sep.className = "bm-bar-sep";
        bookmarkBarItems.appendChild(sep);
    }

    // Root bookmarks
    for (var b = 0; b < rootBookmarks.length; b++) {
        createBarBookmarkItem(rootBookmarks[b], b, localLinks);
    }

    // Upgrade bar favicons from cache (and persist for sync)
    setTimeout(function () {
        var imgs = bookmarkBarItems.querySelectorAll(".bm-favicon");
        for (var i = 0; i < imgs.length; i++) {
            var item = imgs[i].closest(".bm-bar-bookmark");
            var url = item ? item.dataset.bmUrl : null;
            var bookmarkId = item ? item.dataset.bmId : null;
            if (url) refreshFaviconFromCache(imgs[i], url, bookmarkId ? bmFaviconCb(bookmarkId) : null);
        }
    }, 100);
}

function createBarFolderItem(folder, idx) {
    var item = document.createElement("div");
    item.className = "bookmark-bar-item bm-bar-folder";
    item.draggable = true;
    item.dataset.folderId = folder.id;
    item.dataset.folderIdx = idx;
    item.title = folder.name;

    var icon = document.createElement("i");
    icon.className = "fas fa-folder bm-bar-folder-icon";

    var name = document.createElement("span");
    name.className = "bm-title";
    name.textContent = folder.name;

    item.appendChild(icon);
    item.appendChild(name);

    // Click: open folder submenu
    item.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (barFolderOpenId === folder.id) {
            closeBarSubmenu();
            return;
        }
        closeBarSubmenu();
        barFolderOpenId = folder.id;
        renderBarSubmenu(folder, item);
    });

    // Right-click context menu
    item.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showFolderContextMenu(e, folder);
    });

    // Drag reorder
    wireBarDragReorder(item, "folder", idx);

    bookmarkBarItems.appendChild(item);
}

function createBarBookmarkItem(bm, idx, localLinks) {
    var effectiveUrl = typeof getResolvedItemUrl === "function"
        ? getResolvedItemUrl(bm, localLinks)
        : bm.url;
    var item = document.createElement("div");
    item.className = "bookmark-bar-item bm-bar-bookmark";
    item.draggable = true;
    item.dataset.bmIdx = idx;
    item.dataset.bmId = bm.id;
    item.dataset.bmUrl = effectiveUrl || bm.url;
    item.title = bm.name;

    var favicon = document.createElement("img");
    favicon.className = "bm-favicon";
    favicon.draggable = false;
    favicon.alt = "";
    setFaviconWithFallback(favicon, effectiveUrl || bm.url, bm.favicon);

    var name = document.createElement("span");
    name.className = "bm-title";
    name.textContent = bm.name;

    item.appendChild(favicon);
    item.appendChild(name);

    // Click: open in same tab
    item.addEventListener("click", function (e) {
        if (item.classList.contains("dragging")) return;
        window.location.href = effectiveUrl || bm.url;
    });

    // Right-click context menu
    item.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showBookmarkContextMenu(e, bm);
    });

    // Drag reorder
    wireBarDragReorder(item, "bookmark", idx);

    bookmarkBarItems.appendChild(item);
}

// === Bar submenu (folder contents) ===
function closeBarSubmenu() {
    if (activeSubmenu) {
        activeSubmenu.remove();
        activeSubmenu = null;
    }
    barFolderOpenId = null;
}

async function renderBarSubmenu(folder, anchor) {
    closeBarSubmenu();

    var bookmarks = await getBookmarks();
    var folders = await getFolders();
    var localLinks = await getBookmarkLocalLinks();
    var fid = folder.id;

    var childFolders = [];
    var childBookmarks = [];
    for (var i = 0; i < folders.length; i++) {
        if ((folders[i].parentId || null) === fid) childFolders.push(folders[i]);
    }
    for (var j = 0; j < bookmarks.length; j++) {
        if ((bookmarks[j].folderId || null) === fid) childBookmarks.push(bookmarks[j]);
    }
    childFolders.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    childBookmarks.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

    var sub = document.createElement("div");
    sub.className = "bm-bar-submenu";
    sub.id = "bm-bar-submenu";

    // "Open all" button at top
    if (childBookmarks.length > 0 || childFolders.length > 0) {
        var openAll = document.createElement("div");
        openAll.className = "bm-submenu-open-all";
        openAll.textContent = "Open all (" + childBookmarks.length + ")";
        openAll.onclick = async function (e) {
            e.stopPropagation();
            var allBm = await getAllBookmarksInFolder(fid);
            for (var a = 0; a < allBm.length; a++) {
                var nextUrl = typeof getResolvedItemUrl === "function"
                    ? getResolvedItemUrl(allBm[a], localLinks)
                    : allBm[a].url;
                if (nextUrl) window.open(nextUrl, "_blank");
            }
            closeBarSubmenu();
        };
        sub.appendChild(openAll);
    }

    var list = document.createElement("div");
    list.className = "bm-submenu-list";

    if (childFolders.length === 0 && childBookmarks.length === 0) {
        var emptyEl = document.createElement("div");
        emptyEl.className = "bm-submenu-empty";
        emptyEl.textContent = "Empty folder";
        list.appendChild(emptyEl);
    } else {
        // Child folders
        for (var cf = 0; cf < childFolders.length; cf++) {
            var cfItem = createSubmenuFolderItem(childFolders[cf], folders, bookmarks, fid);
            list.appendChild(cfItem);
        }
        // Child bookmarks
        for (var cb = 0; cb < childBookmarks.length; cb++) {
            var cbItem = createSubmenuBookmarkItem(childBookmarks[cb], localLinks);
            list.appendChild(cbItem);
        }
    }

    sub.appendChild(list);
    document.body.appendChild(sub);

    // Position below the folder
    var rect = anchor.getBoundingClientRect();
    sub.style.position = "fixed";
    sub.style.top = (rect.bottom + 4) + "px";
    sub.style.left = Math.max(4, rect.left) + "px";

    // Close handlers
    setTimeout(function () {
        document.addEventListener("click", closeBarSubmenu, { once: true });
    }, 50);

    activeSubmenu = sub;
    // Refresh submenu favicons from cache
    setTimeout(function () {
        var subImgs = sub.querySelectorAll(".bm-submenu-bookmark img");
        for (var i = 0; i < subImgs.length; i++) {
            var a = subImgs[i].parentNode;
            if (a && a.href) refreshFaviconFromCache(subImgs[i], a.href, a.dataset.bmId ? bmFaviconCb(a.dataset.bmId) : null);
        }
    }, 100);
}

function createSubmenuFolderItem(folder, allFolders, allBookmarks, parentId) {
    var item = document.createElement("div");
    item.className = "bm-submenu-item bm-submenu-folder";
    item.innerHTML = '<i class="fas fa-folder bm-submenu-folder-icon"></i><span>' + folder.name + '</span>';
    item.onclick = function (e) {
        e.stopPropagation();
        // Navigate into sub-folder within the submenu
        renderNestedSubmenu(folder, item);
    };
    return item;
}

function createSubmenuBookmarkItem(bm, localLinks) {
    var effectiveUrl = typeof getResolvedItemUrl === "function"
        ? getResolvedItemUrl(bm, localLinks)
        : bm.url;
    var item = document.createElement("a");
    item.className = "bm-submenu-item bm-submenu-bookmark";
    item.href = effectiveUrl || bm.url;
    item.dataset.bmId = bm.id;
    var favicon = document.createElement("img");
    favicon.alt = "";
    favicon.style.width = "14px";
    favicon.style.height = "14px";
    setFaviconWithFallback(favicon, effectiveUrl || bm.url, bm.favicon);
    item.appendChild(favicon);
    item.appendChild(document.createTextNode(" " + bm.name));
    return item;
}

async function renderNestedSubmenu(folder, anchor) {
    var bookmarks = await getBookmarks();
    var folders = await getFolders();
    var localLinks = await getBookmarkLocalLinks();
    var fid = folder.id;

    var childFolders = [];
    var childBookmarks = [];
    for (var i = 0; i < folders.length; i++) {
        if ((folders[i].parentId || null) === fid) childFolders.push(folders[i]);
    }
    for (var j = 0; j < bookmarks.length; j++) {
        if ((bookmarks[j].folderId || null) === fid) childBookmarks.push(bookmarks[j]);
    }

    if (childFolders.length === 0 && childBookmarks.length === 0) return;

    // Replace the existing submenu's list
    var sub = document.getElementById("bm-bar-submenu");
    if (!sub) return;
    sub.innerHTML = "";

    var backBtn = document.createElement("div");
    backBtn.className = "bm-submenu-back";
    backBtn.textContent = "← " + folder.name;
    backBtn.onclick = function (e) {
        e.stopPropagation();
        // Go back to parent folder view
        var parentId = folder.parentId || null;
        var parentFolder = null;
        for (var p = 0; p < folders.length; p++) {
            if (folders[p].id === parentId) { parentFolder = folders[p]; break; }
        }
        if (parentFolder) {
            renderNestedSubmenu(parentFolder, anchor);
        } else {
            closeBarSubmenu();
            barFolderOpenId = parentId;
            // Re-open root submenu
            var barAnchor = document.querySelector('[data-folder-id="' + (folder.parentId || '') + '"]');
            if (barAnchor) {
                // This won't work cleanly - just close
            }
            closeBarSubmenu();
        }
    };
    sub.appendChild(backBtn);

    var list = document.createElement("div");
    list.className = "bm-submenu-list";
    for (var cf = 0; cf < childFolders.length; cf++) {
        list.appendChild(createSubmenuFolderItem(childFolders[cf], folders, bookmarks, fid));
    }
    for (var cb = 0; cb < childBookmarks.length; cb++) {
        list.appendChild(createSubmenuBookmarkItem(childBookmarks[cb], localLinks));
    }
    sub.appendChild(list);
    setTimeout(function () {
        var subImgs = sub.querySelectorAll(".bm-submenu-bookmark img");
        for (var i = 0; i < subImgs.length; i++) {
            var a = subImgs[i].parentNode;
            if (a && a.href) refreshFaviconFromCache(subImgs[i], a.href, a.dataset.bmId ? bmFaviconCb(a.dataset.bmId) : null);
        }
    }, 100);
}

// === Context menus ===
function showFolderContextMenu(e, folder) {
    removeContextMenu();
    var menu = document.createElement("div");
    menu.className = "bm-context-menu";
    menu.id = "bm-context-menu";
    menu.innerHTML = '<div class="bm-context-item" data-action="openall">Open all bookmarks</div>';

    menu.style.position = "fixed";
    menu.style.top = e.clientY + "px";
    menu.style.left = e.clientX + "px";
    document.body.appendChild(menu);

    menu.querySelector('[data-action="openall"]').onclick = async function () {
        var allBm = await getAllBookmarksInFolder(folder.id);
        var localLinks = await getBookmarkLocalLinks();
        for (var a = 0; a < allBm.length; a++) {
            var nextUrl = typeof getResolvedItemUrl === "function"
                ? getResolvedItemUrl(allBm[a], localLinks)
                : allBm[a].url;
            if (nextUrl) window.open(nextUrl, "_blank");
        }
        removeContextMenu();
    };

    setTimeout(function () {
        document.addEventListener("click", removeContextMenu, { once: true });
    }, 50);
}

function showBookmarkContextMenu(e, bm) {
    removeContextMenu();
    var menu = document.createElement("div");
    menu.className = "bm-context-menu";
    menu.id = "bm-context-menu";
    menu.innerHTML =
        '<div class="bm-context-item" data-action="edit">Edit</div>' +
        '<div class="bm-context-item" data-action="delete">Delete</div>';

    menu.style.position = "fixed";
    menu.style.top = e.clientY + "px";
    menu.style.left = e.clientX + "px";
    document.body.appendChild(menu);

    menu.querySelector('[data-action="edit"]').onclick = async function () {
        editingBookmarkId = bm.id;
        showAddForms = true;
        removeContextMenu();
        renderBookmarkDropdown();
        bookmarkDropdown.classList.add("open");
    };

    menu.querySelector('[data-action="delete"]').onclick = async function () {
        await deleteBookmarkById(bm.id);
        removeContextMenu();
        await renderBookmarkBar();
        if (bookmarkDropdown.classList.contains("open")) renderBookmarkDropdown();
    };

    setTimeout(function () {
        document.addEventListener("click", removeContextMenu, { once: true });
    }, 50);
}

function removeContextMenu() {
    var menu = document.getElementById("bm-context-menu");
    if (menu) menu.remove();
}

// === Bar drag reorder ===
var dragIndicator = null;
var currentDragType = null;

function getDragIndicator() {
    if (!dragIndicator) {
        dragIndicator = document.createElement("div");
        dragIndicator.className = "bm-drag-indicator";
        document.body.appendChild(dragIndicator);
    }
    return dragIndicator;
}

function hideDragIndicator() {
    if (dragIndicator) dragIndicator.style.display = "none";
}

function showDragIndicator(rect, atStart) {
    var ind = getDragIndicator();
    ind.style.display = "block";
    ind.style.position = "fixed";
    ind.style.top = rect.top + "px";
    ind.style.height = rect.height + "px";
    if (atStart) {
        ind.style.left = (rect.left - 2) + "px";
    } else {
        ind.style.left = (rect.right - 2) + "px";
    }
}

function wireBarDragReorder(item, type, idx) {
    var dragCounter = 0;

    item.addEventListener("dragstart", function (e) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", type + ":" + idx);
        currentDragType = type;
        item.classList.add("dragging");
    });

    item.addEventListener("dragend", function () {
        item.classList.remove("dragging");
        currentDragType = null;
        hideDragIndicator();
        var all = bookmarkBarItems.querySelectorAll(".bookmark-bar-item");
        for (var i = 0; i < all.length; i++) {
            all[i].classList.remove("drag-over", "drag-insert-before", "drag-insert-after");
            all[i]._dragCounter = 0;
        }
    });

    item.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (currentDragType !== type || item.classList.contains("dragging")) {
            hideDragIndicator();
            return;
        }

        var rect = item.getBoundingClientRect();
        var relX = e.clientX - rect.left;
        var pct = relX / rect.width;

        item.classList.remove("drag-over", "drag-insert-before", "drag-insert-after");

        if (pct < 0.25) {
            // Insert before
            item.classList.add("drag-insert-before");
            showDragIndicator(rect, true);
        } else if (pct > 0.75) {
            // Insert after
            item.classList.add("drag-insert-after");
            showDragIndicator(rect, false);
        } else {
            // Swap — highlight the item
            hideDragIndicator();
            item.classList.add("drag-over");
        }
    });

    item.addEventListener("dragenter", function (e) {
        e.preventDefault();
        if (currentDragType !== type) return;
        item._dragCounter = (item._dragCounter || 0) + 1;
    });

    item.addEventListener("dragleave", function () {
        item._dragCounter = (item._dragCounter || 0) - 1;
        if (item._dragCounter <= 0) {
            item.classList.remove("drag-over", "drag-insert-before", "drag-insert-after");
            hideDragIndicator();
        }
    });

    item.addEventListener("drop", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        item._dragCounter = 0;
        item.classList.remove("drag-over", "drag-insert-before", "drag-insert-after");
        hideDragIndicator();
        closeBarSubmenu();

        var data = e.dataTransfer.getData("text/plain").split(":");
        var fromType = data[0];
        var fromIdx = parseInt(data[1], 10);
        if (isNaN(fromIdx) || fromType !== type) return;

        var rect = item.getBoundingClientRect();
        var relX = e.clientX - rect.left;
        var pct = relX / rect.width;

        var selector = type === "folder" ? ".bm-bar-folder" : ".bm-bar-bookmark";
        var siblings = bookmarkBarItems.querySelectorAll(selector);
        var toIdx = 0;
        for (var si = 0; si < siblings.length; si++) {
            if (siblings[si] === item) { toIdx = si; break; }
        }

        var mode = "swap";
        if (pct < 0.25) {
            mode = "insert";
        } else if (pct > 0.75) {
            mode = "insert";
            toIdx = toIdx + 1;
        }

        if (fromIdx !== toIdx) {
            if (type === "folder") {
                await reorderRootFolders(fromIdx, toIdx, mode);
            } else {
                await reorderRootBookmarks(fromIdx, toIdx, mode);
            }
        }

        await renderBookmarkBar();
    });
}

async function reorderRootFolders(fromIdx, toIdx, mode) {
    var folders = await getFolders();
    var rootFolders = [];
    for (var i = 0; i < folders.length; i++) {
        if ((folders[i].parentId || null) === null) rootFolders.push(folders[i]);
    }
    rootFolders.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

    if (mode === "swap") {
        var tmp = rootFolders[fromIdx].position;
        rootFolders[fromIdx].position = rootFolders[toIdx].position;
        rootFolders[toIdx].position = tmp;
        var nowF = Date.now();
        for (var bx = 0; bx < rootFolders.length; bx++) rootFolders[bx].updatedAt = nowF;
    } else {
        var moved = rootFolders.splice(fromIdx, 1)[0];
        var insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
        rootFolders.splice(insertAt, 0, moved);
        for (var j = 0; j < rootFolders.length; j++) {
            rootFolders[j].position = j;
            rootFolders[j].updatedAt = Date.now();
        }
    }
    for (var k = 0; k < rootFolders.length; k++) {
        for (var m = 0; m < folders.length; m++) {
            if (folders[m].id === rootFolders[k].id) folders[m].position = rootFolders[k].position;
        }
    }
    await setFolders(folders);
}

async function reorderRootBookmarks(fromIdx, toIdx, mode) {
    var all = await getBookmarks();
    var rootBookmarks = [];
    for (var i = 0; i < all.length; i++) {
        if ((all[i].folderId || null) === null) rootBookmarks.push(all[i]);
    }
    rootBookmarks.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

    if (mode === "swap") {
        var tmp = rootBookmarks[fromIdx].position;
        rootBookmarks[fromIdx].position = rootBookmarks[toIdx].position;
        rootBookmarks[toIdx].position = tmp;
        var nowB = Date.now();
        for (var bx = 0; bx < rootBookmarks.length; bx++) rootBookmarks[bx].updatedAt = nowB;
    } else {
        var moved = rootBookmarks.splice(fromIdx, 1)[0];
        var insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
        rootBookmarks.splice(insertAt, 0, moved);
        for (var j = 0; j < rootBookmarks.length; j++) {
            rootBookmarks[j].position = j;
            rootBookmarks[j].updatedAt = Date.now();
        }
    }
    for (var k = 0; k < rootBookmarks.length; k++) {
        for (var m = 0; m < all.length; m++) {
            if (all[m].id === rootBookmarks[k].id) all[m].position = rootBookmarks[k].position;
        }
    }
    await setBookmarks(all);
}

// === Dropdown ===
function closeBookmarkDropdown() {
    bookmarkDropdown.classList.remove("open");
    currentFolderId = null;
    folderPath = [];
    showAddForms = false;
    editingBookmarkId = null;
}

bookmarkBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (typeof closeDropdown === "function") closeDropdown();
    if (typeof closeSyncDropdown === "function") closeSyncDropdown();
    closeBarSubmenu();
    var isOpen = bookmarkDropdown.classList.toggle("open");
    if (isOpen) renderBookmarkDropdown();
});

document.addEventListener("click", function (e) {
    if (!bookmarkDropdown.contains(e.target) && !bookmarkBtn.contains(e.target)) {
        closeBookmarkDropdown();
    }
});

document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeBookmarkDropdown(); closeBarSubmenu(); removeContextMenu(); }
});

// === Folder navigation (dropdown) ===
function getCurrentParentId() {
    return currentFolderId;
}

async function navigateTo(folderId) {
    if (folderId) {
        var folders = await getFolders();
        for (var i = 0; i < folders.length; i++) {
            if (folders[i].id === folderId) {
                currentFolderId = folderId;
                folderPath.push({ id: folderId, name: folders[i].name });
                break;
            }
        }
    }
    renderBookmarkDropdown();
}

function navigateBack() {
    folderPath.pop();
    currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
    renderBookmarkDropdown();
}

// === Dropdown content ===
async function renderBookmarkDropdown() {
    var folders = await getFolders();
    if (!Array.isArray(folders)) folders = [];
    var parentId = getCurrentParentId();
    var title = folderPath.length > 0 ? folderPath[folderPath.length - 1].name : "Bookmarks";

    var backBtnHtml = '';
    if (folderPath.length > 0) {
        backBtnHtml = '<span class="bm-nav-back" id="bm-breadcrumb-back">' +
            '<i class="fas fa-chevron-left"></i></span>';
    }

    var addFormsHtml = '';
    if (showAddForms) {
        addFormsHtml =
        '  <div class="bm-add-section">' +
        '    <form id="bm-folder-form" class="bm-folder-form">' +
        '      <input type="text" id="bm-folder-input" placeholder="New folder name..." maxlength="30" />' +
        '      <button type="submit" class="bm-folder-add-btn">Create</button>' +
        '    </form>' +
        '    <form id="bookmark-add-form" class="bookmark-add-form">' +
        '      <input type="url" id="bm-url-input" placeholder="Synced link (all devices)" required />' +
        '      <input type="url" id="bm-local-url-input" placeholder="Local link on this device only" />' +
        '      <input type="text" id="bm-name-input" placeholder="Name" required />' +
        '      <div class="bm-form-row">' +
        '        <button type="submit" class="bm-add-btn" id="bm-submit-btn">Add Bookmark</button>' +
        '      </div>' +
        '    </form>' +
        '  </div>';
    }

    bookmarkDropdownContent.innerHTML =
        '<div class="bookmark-dropdown-inner">' +
        '  <div class="bm-header-row">' +
        backBtnHtml +
        '    <h4>' + title + '</h4>' +
        '    <button id="bm-toggle-add-btn" class="bm-toggle-add-btn" title="Add">' +
        '      <i class="fas fa-' + (showAddForms ? 'times' : 'plus') + '"></i>' +
        '    </button>' +
        '  </div>' +
        addFormsHtml +
        '  <div id="bookmark-dropdown-list" class="bookmark-dropdown-list"></div>' +
        '</div>';

    var backBtn = document.getElementById("bm-breadcrumb-back");
    if (backBtn) backBtn.onclick = navigateBack;

    document.getElementById("bm-toggle-add-btn").onclick = function () {
        showAddForms = !showAddForms;
        editingBookmarkId = null;
        renderBookmarkDropdown();
    };

    if (showAddForms) wireAddForms();
    renderBookmarkList();
    // Refresh favicons from cache after dialog is fully rendered
    setTimeout(function () {
        var dlItems = document.querySelectorAll("#bookmark-dropdown-list .bm-dl-favicon");
        for (var i = 0; i < dlItems.length; i++) {
            if (dlItems[i].dataset.bmUrl) refreshFaviconFromCache(dlItems[i], dlItems[i].dataset.bmUrl);
        }
    }, 100);
}

function wireAddForms() {
    var folderForm = document.getElementById("bm-folder-form");
    if (folderForm) {
        folderForm.onsubmit = async function (e) {
            e.preventDefault();
            var input = document.getElementById("bm-folder-input");
            var name = input.value.trim();
            if (!name) return;
            var allFolders = await getFolders();
            var parentId = getCurrentParentId();
            // Find max position among siblings, new item goes at end
            var maxPos = -1;
            for (var i = 0; i < allFolders.length; i++) {
                if ((allFolders[i].parentId || null) === parentId) {
                    var p = allFolders[i].position;
                    if (typeof p === "number" && p > maxPos) maxPos = p;
                }
            }
            allFolders.push({
                id: crypto.randomUUID(), name: name,
                parentId: parentId,
                position: maxPos + 1,
                updatedAt: Date.now()
            });
            await setFolders(allFolders);
            showAddForms = false;
            renderBookmarkDropdown();
            await renderBookmarkBar();
        };
    }

    var bmForm = document.getElementById("bookmark-add-form");
    if (!bmForm) return;
    var urlInput = document.getElementById("bm-url-input");
    var localUrlInput = document.getElementById("bm-local-url-input");
    var nameInput = document.getElementById("bm-name-input");
    var submitBtn = document.getElementById("bm-submit-btn");

    urlInput.addEventListener("input", function () {
        if (editingBookmarkId === null) {
            try {
                var domain = new URL(urlInput.value.trim()).hostname.replace(/^www\./, '');
                if (!nameInput.dataset.manualEdit) nameInput.value = domain.split('.')[0];
            } catch (e) {}
        }
        if (localUrlInput && typeof syncLocalUrlInputWithRemote === "function") {
            syncLocalUrlInputWithRemote(urlInput, localUrlInput);
        }
    });
    nameInput.addEventListener("input", function () {
        nameInput.dataset.manualEdit = "true";
    });
    if (localUrlInput) {
        localUrlInput.addEventListener("input", function () {
            if (typeof updateLocalUrlInputManualState === "function") {
                updateLocalUrlInputManualState(localUrlInput, urlInput.value);
            }
        });
    }

    if (editingBookmarkId !== null) {
        Promise.all([getBookmarks(), getBookmarkLocalLinks()]).then(function (values) {
            var all = values[0];
            var localLinks = values[1];
            if (!Array.isArray(all)) return;
            for (var i = 0; i < all.length; i++) {
                if (all[i] && all[i].id === editingBookmarkId) {
                    urlInput.value = all[i].url;
                    if (localUrlInput && typeof primeLocalUrlInput === "function") {
                        primeLocalUrlInput(
                            localUrlInput,
                            all[i].url,
                            typeof getLocalLinkValue === "function" ? getLocalLinkValue(localLinks, all[i].id) : ""
                        );
                    }
                    nameInput.value = all[i].name;
                    nameInput.dataset.manualEdit = "true";
                    submitBtn.textContent = "Save";
                    break;
                }
            }
        });
    } else if (localUrlInput && typeof primeLocalUrlInput === "function") {
        primeLocalUrlInput(localUrlInput, urlInput.value, "");
    }

    bmForm.onsubmit = async function (e) {
        e.preventDefault();
        var name = nameInput.value.trim();
        var url = urlInput.value.trim();
        var localUrl = typeof normalizeLocalOverrideUrl === "function"
            ? normalizeLocalOverrideUrl(localUrlInput ? localUrlInput.value : "", url)
            : (localUrlInput ? localUrlInput.value.trim() : "");
        if (!name || !url) return;
        var all = await getBookmarks();
        var localLinks = await getBookmarkLocalLinks();
        if (!Array.isArray(all)) all = [];
        var parentId = getCurrentParentId();
        var now = Date.now();
        var savedBookmarkId = null;
        var shouldFetchFavicon = false;
        if (editingBookmarkId !== null) {
            var existing = null;
            for (var i = 0; i < all.length; i++) {
                if (all[i] && all[i].id === editingBookmarkId) {
                    existing = all[i];
                    break;
                }
            }
            if (!existing) {
                editingBookmarkId = null;
                return;
            }
            var oldParentId = existing.folderId || null;
            var previousUrl = existing.url;
            var previousEffectiveUrl = (typeof getLocalLinkValue === "function" ? getLocalLinkValue(localLinks, existing.id) : "") || previousUrl;
            var nextEffectiveUrl = localUrl || url;
            existing.name = name;
            existing.url = url;
            if (previousUrl !== url) delete existing.favicon;
            existing.updatedAt = now;
            savedBookmarkId = existing.id;
            shouldFetchFavicon = previousEffectiveUrl !== nextEffectiveUrl || !existing.favicon;
            if ((existing.folderId || null) !== parentId) {
                existing.folderId = parentId;
                existing.position = getNextScopedPosition(all, "folderId", parentId);
                normalizeScopedItems(all, "folderId", [oldParentId, parentId], now);
            }
        } else {
            var createdBookmark = {
                id: crypto.randomUUID(), name: name, url: url,
                folderId: parentId,
                position: getNextScopedPosition(all, "folderId", parentId),
                updatedAt: now
            };
            savedBookmarkId = createdBookmark.id;
            shouldFetchFavicon = true;
            all.push(createdBookmark);
        }
        await setBookmarks(all);
        if (savedBookmarkId) await setBookmarkLocalLink(savedBookmarkId, localUrl);
        if (shouldFetchFavicon) await fetchBookmarkFaviconOnSave(savedBookmarkId);
        await renderBookmarkBar();
        showAddForms = false;
        editingBookmarkId = null;
        renderBookmarkDropdown();
    };
}

async function renderBookmarkList() {
    var list = document.getElementById("bookmark-dropdown-list");
    if (!list) return;
    list.innerHTML = "";

    var folders = await getFolders();
    if (!Array.isArray(folders)) folders = [];
    var all = await getBookmarks();
    if (!Array.isArray(all)) all = [];
    var localLinks = await getBookmarkLocalLinks();
    var parentId = getCurrentParentId();

    var levelFolders = [];
    for (var i = 0; i < folders.length; i++) {
        if ((folders[i].parentId || null) === parentId) levelFolders.push(folders[i]);
    }
    levelFolders.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

    var levelBookmarks = [];
    for (var j = 0; j < all.length; j++) {
        if ((all[j].folderId || null) === parentId) levelBookmarks.push(all[j]);
    }
    levelBookmarks.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

    if (levelFolders.length === 0 && levelBookmarks.length === 0) {
        var emptyEl = document.createElement("div");
        emptyEl.className = "bm-empty-dir";
        emptyEl.textContent = "Empty";
        list.appendChild(emptyEl);
        return;
    }

    for (var f = 0; f < levelFolders.length; f++) {
        list.appendChild(createFolderItem(levelFolders[f], f));
    }
    if (levelFolders.length > 0 && levelBookmarks.length > 0) {
        var sep = document.createElement("div");
        sep.className = "bm-list-separator";
        list.appendChild(sep);
    }
    for (var b = 0; b < levelBookmarks.length; b++) {
        list.appendChild(createBookmarkItem(levelBookmarks[b], b, localLinks));
    }
}

function createFolderItem(folder, idx) {
    var item = document.createElement("div");
    item.className = "bm-folder-item";
    item.draggable = true;
    item.title = "Double-click to open";
    item.innerHTML = '<i class="fas fa-folder bm-folder-item-icon"></i>' +
        '<span class="bm-folder-item-name">' + folder.name + '</span>';

    var actions = document.createElement("div");
    actions.className = "bm-dl-actions";
    var delBtn = document.createElement("button");
    delBtn.className = "bm-icon-btn bm-del-btn";
    delBtn.title = "Delete folder";
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.onclick = async function (e) {
        e.stopPropagation();
        await deleteFolderById(folder.id);
        await renderBookmarkBar();
        renderBookmarkDropdown();
    };
    actions.appendChild(delBtn);
    item.appendChild(actions);

    item.addEventListener("click", function () { navigateTo(folder.id); });
    wireDropdownDragReorder(item, "folder", idx);
    return item;
}

function createBookmarkItem(bm, idx, localLinks) {
    var effectiveUrl = typeof getResolvedItemUrl === "function"
        ? getResolvedItemUrl(bm, localLinks)
        : bm.url;
    var item = document.createElement("div");
    item.className = "bookmark-dropdown-item";
    item.draggable = true;
    item.dataset.bmId = bm.id;

    var favicon = document.createElement("img");
    favicon.className = "bm-dl-favicon";
    favicon.alt = "";
    favicon.dataset.bmId = bm.id;
    favicon.dataset.bmUrl = effectiveUrl || bm.url;
    setFaviconWithFallback(favicon, effectiveUrl || bm.url, bm.favicon);

    var name = document.createElement("span");
    name.className = "bm-dl-name";
    name.textContent = bm.name;

    var actions = document.createElement("div");
    actions.className = "bm-dl-actions";

    // Click bookmark → close dialog, open in same tab
    item.addEventListener("click", function () {
        closeBookmarkDropdown();
        window.location.href = effectiveUrl || bm.url;
    });

    var editBtn = document.createElement("button");
    editBtn.className = "bm-icon-btn";
    editBtn.title = "Edit";
    editBtn.innerHTML = '<i class="fas fa-pen"></i>';
    editBtn.onclick = async function (e) {
        e.stopPropagation();
        editingBookmarkId = bm.id;
        showAddForms = true;
        renderBookmarkDropdown();
    };

    var delBtn = document.createElement("button");
    delBtn.className = "bm-icon-btn bm-del-btn";
    delBtn.title = "Delete";
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.onclick = async function (e) {
        e.stopPropagation();
        await deleteBookmarkById(bm.id);
        await renderBookmarkBar();
        renderBookmarkList();
    };

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    item.appendChild(favicon);
    item.appendChild(name);
    item.appendChild(actions);

    wireDropdownDragReorder(item, "bookmark", idx);
    return item;
}

// === Dropdown drag reorder ===
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
    var siblings = [];
    for (var i = 0; i < allFolders.length; i++) {
        if ((allFolders[i].parentId || null) === parentId) siblings.push(allFolders[i]);
    }
    siblings.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    var tmp = siblings[fromIdx].position;
    siblings[fromIdx].position = siblings[toIdx].position;
    siblings[toIdx].position = tmp;
    var nowF = Date.now();
    for (var sx = 0; sx < siblings.length; sx++) siblings[sx].updatedAt = nowF;
    for (var k = 0; k < siblings.length; k++) {
        for (var m = 0; m < allFolders.length; m++) {
            if (allFolders[m].id === siblings[k].id) allFolders[m].position = siblings[k].position;
        }
    }
    await setFolders(allFolders);
}

async function reorderLevelBookmarks(fromIdx, toIdx) {
    var all = await getBookmarks();
    var parentId = getCurrentParentId();
    var siblings = [];
    for (var i = 0; i < all.length; i++) {
        if ((all[i].folderId || null) === parentId) siblings.push(all[i]);
    }
    siblings.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    var tmp = siblings[fromIdx].position;
    siblings[fromIdx].position = siblings[toIdx].position;
    siblings[toIdx].position = tmp;
    var nowB = Date.now();
    for (var sx = 0; sx < siblings.length; sx++) siblings[sx].updatedAt = nowB;
    for (var k = 0; k < siblings.length; k++) {
        for (var m = 0; m < all.length; m++) {
            if (all[m].id === siblings[k].id) all[m].position = siblings[k].position;
        }
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
window.addEventListener("syncdataloaded", async function () {
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
