const shortcutList = document.getElementById("shortcut-grid");
const shortcutDialog = document.getElementById("shortcut-dialog");
const shortcutForm = document.getElementById("shortcut-form");
const shortcutNameInput = document.getElementById("shortcut-name");
const shortcutUrlInput = document.getElementById("shortcut-url");
const shortcutTitle = document.getElementById("shortcut-dialog-title");
const closeShortcutDialog = document.getElementById("close-shortcut-dialog");
const syncNameBtn = document.getElementById("sync-name-btn");

let editingShortcut = null;

async function getFaviconUrl(link) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(link);
      const rootDomain = getFullDomain(urlObj.href);

      if (!rootDomain) {
        return resolve(`https://www.google.com/s2/favicons?sz=64&domain=${urlObj.hostname}`);
      }

      chrome.storage.local.get(rootDomain, (result) => {
        if (result && result[rootDomain] && result[rootDomain].favicon) {
          resolve(result[rootDomain].favicon);
        } else {
          resolve(`https://www.google.com/s2/favicons?sz=64&domain=${rootDomain}`);
        }
      });
    } catch {
      resolve(`https://www.google.com/s2/favicons?sz=64&domain=${link}`);
    }
  });
}

async function renderShortcuts() {
  shortcutList.innerHTML = "";
  const shortcuts = await loadShortcuts();

  for (const [index, shortcut] of shortcuts.entries()) {
    const div = document.createElement("div");
    div.className = "shortcut-item";
    div.draggable = true;

    const link = document.createElement("a");
    link.href = shortcut.url;
    const favicon = await getFaviconUrl(shortcut.url);

    link.innerHTML = `
      <div class="shortcut-icon-wrapper">
        <img src="${favicon}" class="shortcut-icon" alt="" />
      </div>
      <div class="shortcut-label">${shortcut.name}</div>
    `;

    const menuBtn = document.createElement("button");
    menuBtn.className = "shortcut-menu-btn";
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
      shortcutTitle.textContent = "Edit Shortcut";
      editingShortcut = index;
      shortcutDialog.style.display = "flex";
      menu.style.display = "none";
      syncNameBtn.style.display = "inline";
    };

    menu.querySelector(".delete-btn").onclick = async () => {
      const all = await loadShortcuts();
      all.splice(index, 1);
      await saveShortcuts(all);
      renderShortcuts();
    };

    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", index);
      div.classList.add("dragging");
    });

    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");
      document.querySelectorAll(".shortcut-item").forEach(item => {
        item.classList.remove("drag-over");
      });
    });

    div.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    div.addEventListener("dragenter", (e) => {
      e.preventDefault();
      if (!div.classList.contains("add-shortcut-btn")) {
        div.classList.add("drag-over");
      }
    });

    div.addEventListener("dragleave", () => {
      div.classList.remove("drag-over");
    });

    div.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      div.classList.remove("drag-over");
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (isNaN(fromIndex) || fromIndex === index) return;

      const all = await loadShortcuts();
      const [moved] = all.splice(fromIndex, 1);
      all.splice(index, 0, moved);
      await saveShortcuts(all);
      renderShortcuts();
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
    addShortcutButton.classList.add("drag-over");
  });

  addShortcutButton.addEventListener("dragleave", () => {
    addShortcutButton.classList.remove("drag-over");
  });

  addShortcutButton.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    addShortcutButton.classList.remove("drag-over");
    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(fromIndex)) return;

    const all = await loadShortcuts();
    if (fromIndex >= 0 && fromIndex < all.length) {
      const [moved] = all.splice(fromIndex, 1);
      all.push(moved);
      await saveShortcuts(all);
      renderShortcuts();
    }
  });

  addShortcutButton.addEventListener("click", () => {
    editingShortcut = null;
    shortcutForm.reset();
    shortcutTitle.textContent = "Add Shortcut";
    shortcutDialog.style.display = "flex";
    shortcutNameInput.dataset.manualEdit = "";
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
  if (!name || !url) return;

  const shortcuts = await loadShortcuts();

  if (editingShortcut !== null) {
    shortcuts[editingShortcut] = { name, url };
  } else {
    shortcuts.push({ name, url });
  }

  await saveShortcuts(shortcuts);
  renderShortcuts();
  shortcutForm.reset();
  shortcutDialog.style.display = "none";
  editingShortcut = null;
  syncNameBtn.style.display = "none";
};

closeShortcutDialog.onclick = () => {
  shortcutDialog.style.display = "none";
};

shortcutUrlInput.addEventListener("input", () => {
  if (editingShortcut !== null) return;

  const url = shortcutUrlInput.value.trim();
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    if (!shortcutNameInput.dataset.manualEdit) {
      shortcutNameInput.value = domain.split('.')[0];
    }
  } catch { }
});

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

renderShortcuts();
