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
            allFolders.push({
                id: crypto.randomUUID(), name: name,
                parentId: parentId,
                orderKey: getNextScopedOrderKey(allFolders, "parentId", parentId),
                position: 0,
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
                existing.orderKey = getNextScopedOrderKey(all, "folderId", parentId);
                normalizeScopedItems(all, "folderId", [oldParentId, parentId], now);
            }
        } else {
            var createdBookmark = {
                id: crypto.randomUUID(), name: name, url: url,
                folderId: parentId,
                orderKey: getNextScopedOrderKey(all, "folderId", parentId),
                position: 0,
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
    levelFolders.sort(compareBookmarkSyncItems);

    var levelBookmarks = [];
    for (var j = 0; j < all.length; j++) {
        if ((all[j].folderId || null) === parentId) levelBookmarks.push(all[j]);
    }
    levelBookmarks.sort(compareBookmarkSyncItems);

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
