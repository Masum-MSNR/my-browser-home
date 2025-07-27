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

// ------- Search Functionality -------
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

// Enter key search
document.getElementById('searchInput').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') {
    performSearch();
  }
});

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

// Form handler
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

loadTodos();

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

// Handle form submission
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

loadMailShortcuts();

document.getElementById("close-todo-dialog").addEventListener("click", () => {
  dialog.style.display = "none";
});

document.getElementById("close-mail-dialog").addEventListener("click", () => {
  mailDialog.style.display = "none";
});
