/* ============================
   ⏰ CLOCK / DATE DISPLAY
============================ */
function updateTime() {
  const now = new Date();

  const timeString = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const dateString = now.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).toUpperCase().replace(/,/g, ' •');

  const timeWithColon = timeString.replace(':', '<span class="colon">:</span>');

  document.getElementById('time').innerHTML = timeWithColon;
  document.getElementById('date').textContent = dateString;
}

updateTime();
setInterval(updateTime, 1000);

/* ============================
   🔍 SEARCH FUNCTIONALITY
============================ */
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");

  if (form && searchInput) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (query) {
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        window.open(googleUrl, "_blank");
      }
    });
  }
});

function performSearch() {
  const query = document.getElementById('searchInput').value;
  if (query.trim()) {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
  }
}

document.getElementById('searchInput').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') {
    performSearch();
  }
});

/* ============================
   ✅ TO-DO LIST FUNCTIONALITY
============================ */
const todoInput = document.getElementById("todo-input");
const todoList = document.getElementById("todo-list");
const dialog = document.getElementById("todo-dialog");
const openBtn = document.getElementById("open-dialog");

function loadTodos() {
  const todos = JSON.parse(localStorage.getItem("todos")) || [];
  todos.forEach(text => addTodoItem(text));
}

function saveTodos() {
  const todos = Array.from(todoList.children).map(li => li.firstChild.textContent.trim());
  localStorage.setItem("todos", JSON.stringify(todos));
}

function addTodoItem(text) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.textContent = text;

  const delBtn = document.createElement("button");
  delBtn.innerHTML = "&times;";
  delBtn.onclick = () => {
    li.remove();
    saveTodos();
  };

  li.appendChild(span);
  li.appendChild(delBtn);
  todoList.appendChild(li);
}

const todoForm = document.getElementById("todo-form");
todoForm.addEventListener("submit", function (e) {
  e.preventDefault();
  const value = todoInput.value.trim();
  if (value) {
    addTodoItem(value);
    saveTodos();
    todoInput.value = "";
    dialog.style.display = "none";
  }
});

openBtn.addEventListener("click", () => {
  dialog.style.display = "flex";
  setTimeout(() => todoInput.focus(), 50);
});

document.getElementById("close-todo-dialog").addEventListener("click", () => {
  dialog.style.display = "none";
});

loadTodos();

/* ============================
   📧 MAIL SHORTCUT FUNCTIONALITY
============================ */
const mailList = document.getElementById("mail-list");
const mailDialog = document.getElementById("mail-dialog");
const openMailBtn = document.getElementById("open-mail-dialog");
const mailForm = document.getElementById("mail-form");
const mailIdInput = document.getElementById("mail-id");
const mailEmailInput = document.getElementById("mail-email");

function loadMailShortcuts() {
  const mails = JSON.parse(localStorage.getItem("mailShortcuts")) || [];
  mails.forEach(({ id, email }) => addMailItem(id, email));
}

function saveMailShortcuts() {
  const mails = Array.from(mailList.children).map(li => {
    const id = li.querySelector(".id").textContent;
    const email = li.querySelector(".email").textContent;
    return { id, email };
  });
  localStorage.setItem("mailShortcuts", JSON.stringify(mails));
}

function getInitials(text) {
  return text.trim().split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase();
}

function addMailItem(id, email) {
  const li = document.createElement("li");

  const info = document.createElement("div");
  info.className = "mail-info";

  const avatar = document.createElement("div");
  avatar.className = "mail-avatar";
  avatar.textContent = getInitials(id);

  const text = document.createElement("div");
  text.className = "mail-text";
  text.innerHTML = `<span class="id">${id}</span><span class="email">${email}</span>`;

  info.appendChild(avatar);
  info.appendChild(text);

  const delBtn = document.createElement("button");
  delBtn.innerHTML = "&times;";
  delBtn.onclick = () => {
    li.remove();
    saveMailShortcuts();
  };

  li.appendChild(info);
  li.appendChild(delBtn);
  mailList.appendChild(li);
}

mailForm.addEventListener("submit", function (e) {
  e.preventDefault();
  const id = mailIdInput.value.trim();
  const email = mailEmailInput.value.trim();
  if (id && email) {
    addMailItem(id, email);
    saveMailShortcuts();
    mailIdInput.value = "";
    mailEmailInput.value = "";
    mailDialog.style.display = "none";
  }
});

openMailBtn.addEventListener("click", () => {
  mailDialog.style.display = "flex";
  setTimeout(() => mailIdInput.focus(), 50);
});

document.getElementById("close-mail-dialog").addEventListener("click", () => {
  mailDialog.style.display = "none";
});

loadMailShortcuts();

/* ============================
   🌐 SHORTCUTS w/ Edit/Delete + Auto-Fill Name + Manual Sync
============================ */
const shortcutList = document.getElementById("shortcut-grid");
const shortcutDialog = document.getElementById("shortcut-dialog");
const openShortcutBtn = document.getElementById("open-shortcut-dialog");
const shortcutForm = document.getElementById("shortcut-form");
const shortcutNameInput = document.getElementById("shortcut-name");
const shortcutUrlInput = document.getElementById("shortcut-url");
const shortcutTitle = document.getElementById("shortcut-dialog-title");
const closeShortcutDialog = document.getElementById("close-shortcut-dialog");
const syncNameBtn = document.getElementById("sync-name-btn"); // sync button element

let editingShortcut = null;

/* Get favicon from domain */
function getFaviconUrl(link) {
  try {
    const url = new URL(link);
    return `https://www.google.com/s2/favicons?sz=64&domain=${url.hostname}`;
  } catch {
    return "";
  }
}

/* Render all shortcuts from localStorage */
function renderShortcuts() {
  shortcutList.innerHTML = "";
  const shortcuts = JSON.parse(localStorage.getItem("shortcuts")) || [];
  shortcuts.forEach((shortcut, index) => {
    const div = document.createElement("div");
    div.className = "shortcut-item";

    const link = document.createElement("a");
    link.href = shortcut.url;
    link.target = "_blank";
    link.innerHTML = `
      <img src="${getFaviconUrl(shortcut.url)}" class="shortcut-icon" alt="" />
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
      syncNameBtn.style.display = "inline"; // Show sync button in edit mode
    };

    menu.querySelector(".delete-btn").onclick = () => {
      shortcuts.splice(index, 1);
      localStorage.setItem("shortcuts", JSON.stringify(shortcuts));
      renderShortcuts();
    };

    div.appendChild(link);
    div.appendChild(menuBtn);
    div.appendChild(menu);
    shortcutList.appendChild(div);
  });
}

/* Close all open shortcut menus */
function closeAllMenus() {
  document.querySelectorAll(".shortcut-menu").forEach(menu => {
    menu.style.display = "none";
  });
}

/* Submit handler for add/edit */
shortcutForm.onsubmit = (e) => {
  e.preventDefault();
  const name = shortcutNameInput.value.trim();
  const url = shortcutUrlInput.value.trim();
  if (!name || !url) return;

  const shortcuts = JSON.parse(localStorage.getItem("shortcuts")) || [];

  if (editingShortcut !== null) {
    shortcuts[editingShortcut] = { name, url };
  } else {
    shortcuts.push({ name, url });
  }

  localStorage.setItem("shortcuts", JSON.stringify(shortcuts));
  renderShortcuts();
  shortcutForm.reset();
  shortcutDialog.style.display = "none";
  editingShortcut = null;
  syncNameBtn.style.display = "none"; // Hide sync button after save
};

/* Open Add Shortcut Dialog */
openShortcutBtn.onclick = () => {
  editingShortcut = null;
  shortcutForm.reset();
  shortcutTitle.textContent = "Add Shortcut";
  shortcutDialog.style.display = "flex";
  shortcutNameInput.dataset.manualEdit = "";
  syncNameBtn.style.display = "none"; // Hide sync in add mode
};

/* Close Shortcut Dialog */
closeShortcutDialog.onclick = () => {
  shortcutDialog.style.display = "none";
};

/* Auto-fill name from URL (only when adding) */
shortcutUrlInput.addEventListener("input", () => {
  if (editingShortcut !== null) return; // Skip during editing

  const url = shortcutUrlInput.value.trim();
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    if (!shortcutNameInput.dataset.manualEdit) {
      shortcutNameInput.value = domain.split('.')[0];
    }
  } catch {
    // Invalid URL; do nothing
  }
});

/* Mark name as manually edited */
shortcutNameInput.addEventListener("input", () => {
  shortcutNameInput.dataset.manualEdit = "true";
});

/* Sync name manually from URL */
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

/* Close menus on outside click */
document.addEventListener("click", () => {
  closeAllMenus();
});

/* Initial load */
renderShortcuts();
