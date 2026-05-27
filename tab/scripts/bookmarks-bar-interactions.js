function getBookmarkOpenUrl(bookmark, localLinks) {
    if (!bookmark) return "";
    return typeof getResolvedItemUrl === "function"
        ? (getResolvedItemUrl(bookmark, localLinks) || "")
        : (bookmark.url || "");
}

function collectBookmarksInFolderSnapshot(folderId, allFolders, allBookmarks) {
    if (!folderId || !Array.isArray(allFolders) || !Array.isArray(allBookmarks)) return [];

    var result = [];
    var pendingFolderIds = [folderId];
    while (pendingFolderIds.length > 0) {
        var currentFolderId = pendingFolderIds.shift();
        for (var i = 0; i < allBookmarks.length; i++) {
            if (allBookmarks[i] && (allBookmarks[i].folderId || null) === currentFolderId) {
                result.push(allBookmarks[i]);
            }
        }
        for (var j = 0; j < allFolders.length; j++) {
            if (allFolders[j] && (allFolders[j].parentId || null) === currentFolderId) {
                pendingFolderIds.push(allFolders[j].id);
            }
        }
    }

    return result;
}

function openBookmarksInNewTabs(bookmarks, localLinks) {
    if (!Array.isArray(bookmarks) || bookmarks.length === 0) return 0;

    var openedCount = 0;
    for (var i = 0; i < bookmarks.length; i++) {
        if (openBookmarkInNewTab(bookmarks[i], localLinks)) openedCount += 1;
    }
    return openedCount;
}

function openFolderBookmarksSnapshotInNewTabs(folderId, allFolders, allBookmarks, localLinks) {
    return openBookmarksInNewTabs(
        collectBookmarksInFolderSnapshot(folderId, allFolders, allBookmarks),
        localLinks
    );
}

function openBookmarkInNewTab(bookmark, localLinks) {
    var nextUrl = getBookmarkOpenUrl(bookmark, localLinks);
    if (!nextUrl) return false;
    window.open(nextUrl, "_blank");
    return true;
}

async function openFolderBookmarksInNewTabs(folderId, localLinks) {
    if (!folderId) return 0;
    var allBm = await getAllBookmarksInFolder(folderId);
    if (!Array.isArray(allBm) || allBm.length === 0) return 0;

    var resolvedLocalLinks = localLinks;
    if (!resolvedLocalLinks && typeof getBookmarkLocalLinks === "function") {
        resolvedLocalLinks = await getBookmarkLocalLinks();
    }

    return openBookmarksInNewTabs(allBm, resolvedLocalLinks);
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
        var localLinks = await getBookmarkLocalLinks();
        await openFolderBookmarksInNewTabs(folder.id, localLinks);
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
    if (typeof reorderScopedItems === "function") {
        reorderScopedItems(folders, "parentId", null, fromIdx, toIdx, mode);
        normalizeScopedItems(folders, "parentId", null);
    }
    await setFolders(folders);
}

async function reorderRootBookmarks(fromIdx, toIdx, mode) {
    var all = await getBookmarks();
    if (typeof reorderScopedItems === "function") {
        reorderScopedItems(all, "folderId", null, fromIdx, toIdx, mode);
        normalizeScopedItems(all, "folderId", null);
    }
    await setBookmarks(all);
}
