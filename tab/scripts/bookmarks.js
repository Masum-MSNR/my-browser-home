var bookmarkBarItems = document.getElementById("bookmark-bar-items");
var bookmarkBtn = document.getElementById("bookmark-btn");
var bookmarkDropdown = document.getElementById("bookmark-dropdown");
var bookmarkDropdownContent = document.getElementById("bookmark-dropdown-content");

var editingBookmarkIndex = null;
var currentFolderId = null;
var folderPath = [];
var showAddForms = false;
var activeSubmenu = null;
var barFolderOpenId = null;

// === Storage ===
async function getBookmarks() {
    return (await syncGet("bookmarks")) || [];
}
async function setBookmarks(val) {
    await syncSet({ bookmarks: val });
    if (typeof autoSync === "function") autoSync();
}
async function getFolders() {
    return (await syncGet("bookmarkFolders")) || [];
}
async function setFolders(val) {
    await syncSet({ bookmarkFolders: val });
    if (typeof autoSync === "function") autoSync();
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
async function renderBookmarkBar() {
    var bookmarks = await getBookmarks();
    if (!Array.isArray(bookmarks)) bookmarks = [];
    var folders = await getFolders();
    if (!Array.isArray(folders)) folders = [];

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
        createBarBookmarkItem(rootBookmarks[b], b);
    }
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

function createBarBookmarkItem(bm, idx) {
    var item = document.createElement("div");
    item.className = "bookmark-bar-item bm-bar-bookmark";
    item.draggable = true;
    item.dataset.bmIdx = idx;
    item.title = bm.name;

    var favicon = document.createElement("img");
    favicon.className = "bm-favicon";
    favicon.draggable = false;
    favicon.alt = "";
    favicon.src = getFaviconUrl(bm.url);

    var name = document.createElement("span");
    name.className = "bm-title";
    name.textContent = bm.name;

    item.appendChild(favicon);
    item.appendChild(name);

    // Click: open in same tab
    item.addEventListener("click", function (e) {
        if (item.classList.contains("dragging")) return;
        window.location.href = bm.url;
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
                window.open(allBm[a].url, "_blank");
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
            var cbItem = createSubmenuBookmarkItem(childBookmarks[cb]);
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

function createSubmenuBookmarkItem(bm) {
    var item = document.createElement("a");
    item.className = "bm-submenu-item bm-submenu-bookmark";
    item.href = bm.url;
    var favicon = document.createElement("img");
    favicon.alt = "";
    favicon.style.width = "14px";
    favicon.style.height = "14px";
    favicon.src = getFaviconUrl(bm.url);
    item.appendChild(favicon);
    item.appendChild(document.createTextNode(" " + bm.name));
    return item;
}

async function renderNestedSubmenu(folder, anchor) {
    var bookmarks = await getBookmarks();
    var folders = await getFolders();
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
        list.appendChild(createSubmenuBookmarkItem(childBookmarks[cb]));
    }
    sub.appendChild(list);
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
        for (var a = 0; a < allBm.length; a++) {
            window.open(allBm[a].url, "_blank");
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
        editingBookmarkIndex = -1;
        var all = await getBookmarks();
        for (var a = 0; a < all.length; a++) {
            if (all[a].id === bm.id) { editingBookmarkIndex = a; break; }
        }
        showAddForms = true;
        removeContextMenu();
        renderBookmarkDropdown();
        bookmarkDropdown.classList.add("open");
    };

    menu.querySelector('[data-action="delete"]').onclick = async function () {
        var all = await getBookmarks();
        for (var a = 0; a < all.length; a++) {
            if (all[a].id === bm.id) { all.splice(a, 1); break; }
        }
        for (var j = 0; j < all.length; j++) all[j].position = j;
        await setBookmarks(all);
        removeContextMenu();
        renderBookmarkBar();
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
        rootFolders[fromIdx].updatedAt = Date.now();
        rootFolders[toIdx].updatedAt = Date.now();
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
        rootBookmarks[fromIdx].updatedAt = Date.now();
        rootBookmarks[toIdx].updatedAt = Date.now();
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
    renderBookmarkBar();
}

// === Dropdown ===
function closeBookmarkDropdown() {
    bookmarkDropdown.classList.remove("open");
    currentFolderId = null;
    folderPath = [];
    showAddForms = false;
    editingBookmarkIndex = null;
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
        '      <input type="url" id="bm-url-input" placeholder="https://example.com" required />' +
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
        editingBookmarkIndex = null;
        renderBookmarkDropdown();
    };

    if (showAddForms) wireAddForms();
    renderBookmarkList();
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
    var nameInput = document.getElementById("bm-name-input");
    var submitBtn = document.getElementById("bm-submit-btn");

    urlInput.addEventListener("input", function () {
        if (editingBookmarkIndex !== null) return;
        try {
            var domain = new URL(urlInput.value.trim()).hostname.replace(/^www\./, '');
            if (!nameInput.dataset.manualEdit) nameInput.value = domain.split('.')[0];
        } catch (e) {}
    });
    nameInput.addEventListener("input", function () {
        nameInput.dataset.manualEdit = "true";
    });

    if (editingBookmarkIndex !== null) {
        getBookmarks().then(function (all) {
            if (all[editingBookmarkIndex]) {
                urlInput.value = all[editingBookmarkIndex].url;
                nameInput.value = all[editingBookmarkIndex].name;
                nameInput.dataset.manualEdit = "true";
                submitBtn.textContent = "Save";
            }
        });
    }

    bmForm.onsubmit = async function (e) {
        e.preventDefault();
        var name = nameInput.value.trim();
        var url = urlInput.value.trim();
        if (!name || !url) return;
        var all = await getBookmarks();
        if (!Array.isArray(all)) all = [];
        if (editingBookmarkIndex !== null) {
            all[editingBookmarkIndex].name = name;
            all[editingBookmarkIndex].url = url;
            all[editingBookmarkIndex].folderId = getCurrentParentId();
            all[editingBookmarkIndex].updatedAt = Date.now();
        } else {
            var parentId = getCurrentParentId();
            var maxPos = -1;
            for (var s = 0; s < all.length; s++) {
                if ((all[s].folderId || null) === parentId) {
                    var p = all[s].position;
                    if (typeof p === "number" && p > maxPos) maxPos = p;
                }
            }
            all.push({
                id: crypto.randomUUID(), name: name, url: url,
                folderId: parentId,
                position: maxPos + 1,
                updatedAt: Date.now()
            });
        }
        for (var i = 0; i < all.length; i++) all[i].position = i;
        await setBookmarks(all);
        renderBookmarkBar();
        showAddForms = false;
        editingBookmarkIndex = null;
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
        list.appendChild(createBookmarkItem(levelBookmarks[b], b));
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
        var allFolders = await getFolders();
        for (var j = 0; j < allFolders.length; j++) {
            if (allFolders[j].id === folder.id || allFolders[j].parentId === folder.id) {
                allFolders.splice(j, 1); j--;
            }
        }
        var parentId = getCurrentParentId();
        var siblings = [];
        for (var k = 0; k < allFolders.length; k++) {
            if ((allFolders[k].parentId || null) === parentId) siblings.push(allFolders[k]);
        }
        for (var s = 0; s < siblings.length; s++) siblings[s].position = s;
        await setFolders(allFolders);
        var allBm = await getBookmarks();
        var changed = false;
        for (var k = 0; k < allBm.length; k++) {
            if (allBm[k].folderId === folder.id) {
                allBm[k].folderId = folder.parentId || null; changed = true;
            }
        }
        if (changed) await setBookmarks(allBm);
        renderBookmarkBar();
        renderBookmarkDropdown();
    };
    actions.appendChild(delBtn);
    item.appendChild(actions);

    item.addEventListener("click", function () { navigateTo(folder.id); });
    wireDropdownDragReorder(item, "folder", idx);
    return item;
}

function createBookmarkItem(bm, idx) {
    var item = document.createElement("div");
    item.className = "bookmark-dropdown-item";
    item.draggable = true;

    var favicon = document.createElement("img");
    favicon.className = "bm-dl-favicon";
    favicon.alt = "";
    favicon.src = getFaviconUrl(bm.url);

    var name = document.createElement("span");
    name.className = "bm-dl-name";
    name.textContent = bm.name;

    var actions = document.createElement("div");
    actions.className = "bm-dl-actions";

    // Click bookmark → close dialog, open in same tab
    item.addEventListener("click", function () {
        closeBookmarkDropdown();
        window.location.href = bm.url;
    });

    var editBtn = document.createElement("button");
    editBtn.className = "bm-icon-btn";
    editBtn.title = "Edit";
    editBtn.innerHTML = '<i class="fas fa-pen"></i>';
    editBtn.onclick = async function (e) {
        e.stopPropagation();
        editingBookmarkIndex = -1;
        var all = await getBookmarks();
        for (var a = 0; a < all.length; a++) {
            if (all[a].id === bm.id) { editingBookmarkIndex = a; break; }
        }
        if (editingBookmarkIndex === -1) return;
        showAddForms = true;
        renderBookmarkDropdown();
    };

    var delBtn = document.createElement("button");
    delBtn.className = "bm-icon-btn bm-del-btn";
    delBtn.title = "Delete";
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.onclick = async function (e) {
        e.stopPropagation();
        var all = await getBookmarks();
        for (var a = 0; a < all.length; a++) {
            if (all[a].id === bm.id) { all.splice(a, 1); break; }
        }
        for (var j = 0; j < all.length; j++) all[j].position = j;
        await setBookmarks(all);
        renderBookmarkBar();
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
    siblings[fromIdx].updatedAt = Date.now();
    siblings[toIdx].updatedAt = Date.now();
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
    siblings[fromIdx].updatedAt = Date.now();
    siblings[toIdx].updatedAt = Date.now();
    for (var k = 0; k < siblings.length; k++) {
        for (var m = 0; m < all.length; m++) {
            if (all[m].id === siblings[k].id) all[m].position = siblings[k].position;
        }
    }
    await setBookmarks(all);
    renderBookmarkBar();
}

// === Mouse wheel → horizontal scroll on bar ===
bookmarkBarItems.addEventListener("wheel", function (e) {
    if (e.deltaY !== 0) {
        e.preventDefault();
        bookmarkBarItems.scrollLeft += e.deltaY;
    }
}, { passive: false });

// === Init ===
document.body.classList.add("bookmark-bar-visible");
window.addEventListener("syncdataloaded", renderBookmarkBar);
renderBookmarkBar();
