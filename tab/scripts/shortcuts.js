const shortcutList = document.getElementById("shortcut-grid");
const shortcutDialog = document.getElementById("shortcut-dialog");
const shortcutForm = document.getElementById("shortcut-form");
const shortcutNameInput = document.getElementById("shortcut-name");
const shortcutUrlInput = document.getElementById("shortcut-url");
const shortcutLocalUrlInput = document.getElementById("shortcut-local-url");
const shortcutTitle = document.getElementById("shortcut-dialog-title");
const closeShortcutDialog = document.getElementById("close-shortcut-dialog");
const syncNameBtn = document.getElementById("sync-name-btn");

let editingShortcut = null;

async function getShortcuts() {
  return await syncGet("shortcuts") || [];
}

async function setShortcuts(val) {
  await syncSet({ shortcuts: val });
  if (typeof logSyncEvent === "function" && typeof summarizeSyncItems === "function") {
    logSyncEvent("local", "shortcuts-updated", {
      shortcuts: summarizeSyncItems(val, null, function (item) { return !!(item && item.url); })
    });
  }
  if (typeof markSyncDirty === "function") markSyncDirty("shortcuts");
  if (typeof autoSync === "function") autoSync();
}

async function getShortcutLocalLinks() {
  return typeof readLocalLinkMap === "function" ? await readLocalLinkMap("shortcuts") : {};
}

async function setShortcutLocalLink(shortcutId, url) {
  if (!shortcutId || typeof updateLocalLinkValue !== "function") return;
  await updateLocalLinkValue("shortcuts", shortcutId, url);
}

async function clearShortcutLocalLink(shortcutId) {
  if (!shortcutId || typeof updateLocalLinkValue !== "function") return;
  await updateLocalLinkValue("shortcuts", shortcutId, "");
}

async function fetchShortcutFaviconOnSave(shortcutId) {
  if (!shortcutId || typeof requestFaviconCacheRefresh !== "function") return;

  var all = await getShortcuts();
  if (!Array.isArray(all)) return;
  var localLinks = await getShortcutLocalLinks();

  var shortcut = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i] && all[i].id === shortcutId) {
      shortcut = all[i];
      break;
    }
  }
  if (!shortcut) return;

  var effectiveUrl = typeof getResolvedItemUrl === "function"
    ? getResolvedItemUrl(shortcut, localLinks)
    : shortcut.url;
  if (!effectiveUrl) return;

  var result = await requestFaviconCacheRefresh(effectiveUrl, shortcut.favicon || null);
  if (!result) return;

  var nextFavicon = result.realUrl || DEFAULT_FAVICON;
  if (!nextFavicon || shortcut.favicon === nextFavicon) return;

  shortcut.favicon = nextFavicon;
  shortcut.updatedAt = Date.now();
  await setShortcuts(all);
}

async function renderShortcuts() {
  shortcutList.innerHTML = "";
  var shortcuts = await getShortcuts();
  var localLinks = await getShortcutLocalLinks();
  if (!Array.isArray(shortcuts)) shortcuts = [];
  shortcuts = shortcuts.filter(function (s) { return s && s.url; });

  for (const [index, shortcut] of shortcuts.entries()) {
    const effectiveUrl = typeof getResolvedItemUrl === "function"
      ? getResolvedItemUrl(shortcut, localLinks)
      : shortcut.url;

    const div = document.createElement("div");
    div.className = "shortcut-item";
    div.draggable = true;

    const link = document.createElement("a");
    link.href = effectiveUrl || shortcut.url;
    link.dataset.shortcutId = shortcut.id;
    link.draggable = false;

    const iconWrap = document.createElement("div");
    iconWrap.className = "shortcut-icon-wrapper";

    const img = document.createElement("img");
    img.className = "shortcut-icon";
    img.alt = "";
    img.draggable = false;
    setFaviconWithFallback(img, effectiveUrl || shortcut.url, shortcut.favicon);
    iconWrap.appendChild(img);

    const label = document.createElement("div");
    label.className = "shortcut-label";
    label.textContent = shortcut.name;

    link.appendChild(iconWrap);
    link.appendChild(label);

    const menuBtn = document.createElement("button");
    menuBtn.className = "shortcut-menu-btn";
    menuBtn.draggable = false;
    menuBtn.innerHTML = "⋮";

    const menu = document.createElement("div");
    menu.className = "shortcut-menu";
    menu.innerHTML = `
      <button class="edit-btn">Edit</button>
      <button class="delete-btn">Delete</button>
    `;

    menuBtn.onclick = (e) => {
      e.stopPropagation();
      closeAllMenus();
      menu.style.display = "flex";
    };

    menu.querySelector(".edit-btn").onclick = () => {
      shortcutNameInput.value = shortcut.name;
      shortcutUrlInput.value = shortcut.url;
      if (shortcutLocalUrlInput && typeof primeLocalUrlInput === "function") {
        primeLocalUrlInput(
          shortcutLocalUrlInput,
          shortcut.url,
          typeof getLocalLinkValue === "function" ? getLocalLinkValue(localLinks, shortcut.id) : ""
        );
      }
      shortcutTitle.textContent = "Edit Shortcut";
      editingShortcut = shortcut.id;
      shortcutDialog.style.display = "flex";
      menu.style.display = "none";
      syncNameBtn.style.display = "inline";
    };

    menu.querySelector(".delete-btn").onclick = async () => {
      var all = await getShortcuts();
      if (!Array.isArray(all)) all = [];
      var deleted = null;
      for (var idx = 0; idx < all.length; idx++) {
        if (all[idx] && all[idx].id === shortcut.id) {
          deleted = all.splice(idx, 1)[0];
          break;
        }
      }
      // Track tombstone for sync conflict resolution
      if (deleted && deleted.id) {
        var tombstones = {};
        try { tombstones = JSON.parse(localStorage.getItem("_deleted") || "{}"); } catch (e) {}
        var now = Date.now();
        tombstones[deleted.id] = now;
        localStorage.setItem("_deleted", JSON.stringify(tombstones));
        for (var i = 0; i < all.length; i++) {
          all[i].position = i;
          all[i].updatedAt = now;
        }
      } else {
        return;
      }
      await setShortcuts(all);
      await clearShortcutLocalLink(deleted.id);
      renderShortcuts();
    };

    var dragCounter = 0;

    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      div.classList.add("dragging");
    });

    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");
      document.querySelectorAll(".shortcut-item").forEach(item => {
        item.classList.remove("drag-over", "drag-insert-before", "drag-insert-after");
        item._dragCounter = 0;
      });
    });

    function computeDropZone(e) {
      var rect = div.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      if (pct < 0.25) return "before";
      if (pct > 0.75) return "after";
      return "swap";
    }

    div.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (div.classList.contains("add-shortcut-btn") || div.classList.contains("dragging")) return;
      var zone = computeDropZone(e);
      div.classList.remove("drag-over", "drag-insert-before", "drag-insert-after");
      if (zone === "before") div.classList.add("drag-insert-before");
      else if (zone === "after") div.classList.add("drag-insert-after");
      else div.classList.add("drag-over");
    });

    div.addEventListener("dragenter", (e) => {
      e.preventDefault();
      div._dragCounter = (div._dragCounter || 0) + 1;
    });

    div.addEventListener("dragleave", () => {
      div._dragCounter = (div._dragCounter || 0) - 1;
      if (div._dragCounter <= 0) {
        div.classList.remove("drag-over", "drag-insert-before", "drag-insert-after");
      }
    });

    div.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      div._dragCounter = 0;
      div.classList.remove("drag-over", "drag-insert-before", "drag-insert-after");
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (isNaN(fromIndex) || fromIndex === index) return;

      var zone = computeDropZone(e);

      var all = await getShortcuts();
      if (!Array.isArray(all)) all = [];
      if (fromIndex < 0 || fromIndex >= all.length || index < 0 || index >= all.length) return;

      if (zone === "swap") {
        var tmp = all[fromIndex];
        all[fromIndex] = all[index];
        all[index] = tmp;
      } else {
        var moved = all.splice(fromIndex, 1)[0];
        var insertAt;
        if (zone === "before") {
          insertAt = fromIndex < index ? index - 1 : index;
        } else { // after
          insertAt = fromIndex < index ? index : index + 1;
        }
        all.splice(insertAt, 0, moved);
      }

      var now = Date.now();
      for (var i = 0; i < all.length; i++) {
        all[i].position = i;
        all[i].updatedAt = now;
      }
      await setShortcuts(all);
      // Re-render so indices captured in closures stay consistent with state
      await renderShortcuts();
      refreshShortcutFavicons();
    });

    div.appendChild(link);
    div.appendChild(menuBtn);
    div.appendChild(menu);
    shortcutList.appendChild(div);
  }

  addAddShortcutButton();
}

function addAddShortcutButton() {
  const addShortcutButton = document.createElement("div");
  addShortcutButton.classList.add("shortcut-item", "add-shortcut-btn");

  const iconDiv = document.createElement("div");
  iconDiv.className = "add-icon";
  iconDiv.textContent = "+";

  const textDiv = document.createElement("div");
  textDiv.className = "add-text";
  textDiv.textContent = "Add Shortcut";

  addShortcutButton.appendChild(iconDiv);
  addShortcutButton.appendChild(textDiv);

  addShortcutButton.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });

  addShortcutButton.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(fromIndex)) return;

    var all = await getShortcuts();
    if (!Array.isArray(all)) all = [];
    if (fromIndex >= 0 && fromIndex < all.length) {
      var moved = all.splice(fromIndex, 1)[0];
      all.push(moved);
      var now = Date.now();
      for (var i = 0; i < all.length; i++) { all[i].position = i; all[i].updatedAt = now; }
      await setShortcuts(all);
      await renderShortcuts();
      refreshShortcutFavicons();
    }
  });

  addShortcutButton.addEventListener("click", () => {
    editingShortcut = null;
    shortcutForm.reset();
    shortcutTitle.textContent = "Add Shortcut";
    shortcutDialog.style.display = "flex";
    shortcutNameInput.dataset.manualEdit = "";
    if (shortcutLocalUrlInput && typeof primeLocalUrlInput === "function") {
      primeLocalUrlInput(shortcutLocalUrlInput, shortcutUrlInput.value, "");
    }
    syncNameBtn.style.display = "none";
  });

  shortcutList.appendChild(addShortcutButton);
}

function closeAllMenus() {
  document.querySelectorAll(".shortcut-menu").forEach(menu => {
    menu.style.display = "none";
  });
}

shortcutForm.onsubmit = async (e) => {
  e.preventDefault();
  const name = shortcutNameInput.value.trim();
  const url = shortcutUrlInput.value.trim();
  const localUrl = typeof normalizeLocalOverrideUrl === "function"
    ? normalizeLocalOverrideUrl(shortcutLocalUrlInput ? shortcutLocalUrlInput.value : "", url)
    : (shortcutLocalUrlInput ? shortcutLocalUrlInput.value.trim() : "");
  if (!name || !url) return;

  var shortcuts = await getShortcuts();
  var localLinks = await getShortcutLocalLinks();
  if (!Array.isArray(shortcuts)) shortcuts = [];
  shortcuts = shortcuts.filter(function (s) { return s && s.url; });
  var savedShortcutId = null;
  var shouldFetchFavicon = false;

  if (editingShortcut !== null) {
    var existingShortcut = null;
    for (var index = 0; index < shortcuts.length; index++) {
      if (shortcuts[index] && shortcuts[index].id === editingShortcut) {
        existingShortcut = shortcuts[index];
        break;
      }
    }
    if (!existingShortcut) {
      editingShortcut = null;
      return;
    }
    var previousUrl = existingShortcut.url;
    var previousEffectiveUrl = (typeof getLocalLinkValue === "function" ? getLocalLinkValue(localLinks, existingShortcut.id) : "") || previousUrl;
    var nextEffectiveUrl = localUrl || url;
    existingShortcut.name = name;
    existingShortcut.url = url;
    if (previousUrl !== url) delete existingShortcut.favicon;
    existingShortcut.updatedAt = Date.now();
    savedShortcutId = existingShortcut.id;
    shouldFetchFavicon = previousEffectiveUrl !== nextEffectiveUrl || !existingShortcut.favicon;
  } else {
    var createdShortcut = {
      id: crypto.randomUUID(),
      name: name,
      url: url,
      position: shortcuts.length,
      updatedAt: Date.now()
    };
    savedShortcutId = createdShortcut.id;
    shouldFetchFavicon = true;
    shortcuts.push({
      id: createdShortcut.id,
      name: createdShortcut.name,
      url: createdShortcut.url,
      position: createdShortcut.position,
      updatedAt: createdShortcut.updatedAt
    });
  }

  // Update positions
  for (var i = 0; i < shortcuts.length; i++) {
    shortcuts[i].position = i;
  }

  await setShortcuts(shortcuts);
  if (savedShortcutId) await setShortcutLocalLink(savedShortcutId, localUrl);
  if (shouldFetchFavicon) await fetchShortcutFaviconOnSave(savedShortcutId);
  await renderShortcuts();
  shortcutForm.reset();
  if (shortcutLocalUrlInput && typeof primeLocalUrlInput === "function") {
    primeLocalUrlInput(shortcutLocalUrlInput, "", "");
  }
  shortcutDialog.style.display = "none";
  editingShortcut = null;
  syncNameBtn.style.display = "none";
};

closeShortcutDialog.onclick = () => {
  shortcutDialog.style.display = "none";
};

shortcutUrlInput.addEventListener("input", () => {
  const url = shortcutUrlInput.value.trim();
  if (editingShortcut === null) {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      if (!shortcutNameInput.dataset.manualEdit) {
        shortcutNameInput.value = domain.split('.')[0];
      }
    } catch { }
  }
  if (shortcutLocalUrlInput && typeof syncLocalUrlInputWithRemote === "function") {
    syncLocalUrlInputWithRemote(shortcutUrlInput, shortcutLocalUrlInput);
  }
});

if (shortcutLocalUrlInput) {
  shortcutLocalUrlInput.addEventListener("input", () => {
    if (typeof updateLocalUrlInputManualState === "function") {
      updateLocalUrlInputManualState(shortcutLocalUrlInput, shortcutUrlInput.value);
    }
  });
}

shortcutNameInput.addEventListener("input", () => {
  shortcutNameInput.dataset.manualEdit = "true";
});

syncNameBtn.addEventListener("click", () => {
  const url = shortcutUrlInput.value.trim();
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    shortcutNameInput.value = domain.split('.')[0];
    shortcutNameInput.dataset.manualEdit = "";
  } catch {
    alert("Invalid URL. Please enter a valid URL first.");
  }
});

document.addEventListener("click", () => {
  closeAllMenus();
});

renderShortcuts().then(refreshShortcutFavicons);

window.addEventListener("syncdataloaded", async function () {
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
      updatedKey = key; break;
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
