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
    rootFolders.sort(compareBookmarkSyncItems);
    rootBookmarks.sort(compareBookmarkSyncItems);

    if (rootFolders.length === 0 && rootBookmarks.length === 0) {
        var empty = document.createElement("span");
        empty.className = "bookmark-bar-empty";
        empty.textContent = "Click the bookmark icon to add items";
        bookmarkBarItems.appendChild(empty);
        return;
    }

    // Root folders
    for (var f = 0; f < rootFolders.length; f++) {
        createBarFolderItem(rootFolders[f], f, folders, bookmarks, localLinks);
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

function createBarFolderItem(folder, idx, allFolders, allBookmarks, localLinks) {
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

    item.addEventListener("mousedown", function (e) {
        if (e.button === 1) e.preventDefault();
    });

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

    item.addEventListener("auxclick", function (e) {
        if (e.button !== 1 || item.classList.contains("dragging")) return;
        e.preventDefault();
        e.stopPropagation();
        closeBarSubmenu();
        openFolderBookmarksSnapshotInNewTabs(folder.id, allFolders, allBookmarks, localLinks);
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
    favicon.dataset.bmId = bm.id;
    favicon.dataset.faviconKind = "bookmark";
    setFaviconWithFallback(favicon, effectiveUrl || bm.url, bm.favicon);

    var name = document.createElement("span");
    name.className = "bm-title";
    name.textContent = bm.name;

    item.appendChild(favicon);
    item.appendChild(name);

    item.addEventListener("mousedown", function (e) {
        if (e.button === 1) e.preventDefault();
    });

    // Click: open in same tab
    item.addEventListener("click", function (e) {
        if (item.classList.contains("dragging")) return;
        if (typeof openSavedItemInCurrentTab === "function") {
            openSavedItemInCurrentTab("bookmark", bm.id, effectiveUrl || bm.url);
        } else {
            window.location.href = effectiveUrl || bm.url;
        }
    });

    item.addEventListener("auxclick", function (e) {
        if (e.button !== 1 || item.classList.contains("dragging")) return;
        e.preventDefault();
        e.stopPropagation();
        openBookmarkInNewTab(bm, localLinks);
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
    childFolders.sort(compareBookmarkSyncItems);
    childBookmarks.sort(compareBookmarkSyncItems);

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
            await openFolderBookmarksInNewTabs(fid, localLinks);
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
            var cfItem = createSubmenuFolderItem(childFolders[cf], folders, bookmarks, localLinks);
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

function createSubmenuFolderItem(folder, allFolders, allBookmarks, localLinks) {
    var item = document.createElement("div");
    item.className = "bm-submenu-item bm-submenu-folder";
    item.innerHTML = '<i class="fas fa-folder bm-submenu-folder-icon"></i><span>' + folder.name + '</span>';
    item.addEventListener("mousedown", function (e) {
        if (e.button === 1) e.preventDefault();
    });
    item.onclick = function (e) {
        e.stopPropagation();
        // Navigate into sub-folder within the submenu
        renderNestedSubmenu(folder, item);
    };
    item.addEventListener("auxclick", function (e) {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        openFolderBookmarksSnapshotInNewTabs(folder.id, allFolders, allBookmarks, localLinks);
        closeBarSubmenu();
    });
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
    favicon.dataset.bmId = bm.id;
    favicon.dataset.faviconKind = "bookmark";
    setFaviconWithFallback(favicon, effectiveUrl || bm.url, bm.favicon);
    item.appendChild(favicon);
    item.appendChild(document.createTextNode(" " + bm.name));
    item.addEventListener("mousedown", function (e) {
        if (e.button === 1) e.preventDefault();
    });
    item.addEventListener("click", function (e) {
        e.preventDefault();
        if (typeof openSavedItemInCurrentTab === "function") {
            openSavedItemInCurrentTab("bookmark", bm.id, effectiveUrl || bm.url);
        } else {
            window.location.href = effectiveUrl || bm.url;
        }
    });
    item.addEventListener("auxclick", function (e) {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        openBookmarkInNewTab(bm, localLinks);
    });
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
        list.appendChild(createSubmenuFolderItem(childFolders[cf], folders, bookmarks, localLinks));
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
