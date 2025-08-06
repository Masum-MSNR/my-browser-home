const todoInput = document.getElementById("todo-input");
const todoList = document.getElementById("todo-list");
const dialog = document.getElementById("todo-dialog");

let todoItemsWrapper = document.getElementById("todo-items-wrapper");
if (!todoItemsWrapper) {
  todoItemsWrapper = document.createElement("div");
  todoItemsWrapper.id = "todo-items-wrapper";
  todoList.appendChild(todoItemsWrapper);
}

const addTaskButton = document.createElement("li");
addTaskButton.id = "add-task-button";
addTaskButton.className = "add-task-item";
addTaskButton.style.cursor = "pointer";
addTaskButton.style.userSelect = "none";

const label = document.createElement("span");
label.textContent = "+ Add Task";

const invisibleBtn = document.createElement("button");
invisibleBtn.innerHTML = "&times;";
invisibleBtn.style.visibility = "hidden";
invisibleBtn.disabled = true;

addTaskButton.appendChild(label);
addTaskButton.appendChild(invisibleBtn);

addTaskButton.onclick = () => {
  dialog.style.display = "flex";
  setTimeout(() => todoInput.focus(), 50);
};

todoList.appendChild(addTaskButton);

function loadTodos() {
  todoItemsWrapper.innerHTML = "";
  const todos = JSON.parse(localStorage.getItem("todos")) || [];
  todos.forEach(({ text, checked }) => addTodoItem(text, checked));
  updateTodoScrollIndicator();
}

function saveTodos() {
  const todos = Array.from(todoItemsWrapper.children).map(li => ({
    text: li.querySelector(".todo-text").textContent.trim(),
    checked: li.querySelector("input[type='checkbox']").checked
  }));
  localStorage.setItem("todos", JSON.stringify(todos));
  updateTodoScrollIndicator();
}

function addTodoItem(text, checked = false) {
  const li = document.createElement("li");

  const label = document.createElement("label");
  label.className = "todo-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.addEventListener("change", saveTodos);

  const checkmark = document.createElement("span");
  checkmark.className = "checkmark";

  const span = document.createElement("span");
  span.className = "todo-text";
  span.textContent = text;

  label.appendChild(checkbox);
  label.appendChild(checkmark);
  label.appendChild(span);

  const delBtn = document.createElement("button");
  delBtn.title = "Delete";
  delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
  delBtn.onclick = () => {
    li.remove();
    saveTodos();
  };

  li.appendChild(label);
  li.appendChild(delBtn);
  todoItemsWrapper.appendChild(li);
}

const todoForm = document.getElementById("todo-form");
todoForm.addEventListener("submit", e => {
  e.preventDefault();
  const value = todoInput.value.trim();
  if (value) {
    addTodoItem(value);
    saveTodos();
    todoInput.value = "";
    dialog.style.display = "none";
  }
});

document.getElementById("close-todo-dialog").addEventListener("click", () => {
  dialog.style.display = "none";
});

function scheduleDailyReset() {
  const now = new Date();
  const nextReset = new Date();
  nextReset.setHours(24, 0, 0, 0);
  const msUntilReset = nextReset.getTime() - now.getTime();
  setTimeout(() => {
    resetCheckboxes();
    scheduleDailyReset();
  }, msUntilReset);
}

function resetCheckboxes() {
  const todos = JSON.parse(localStorage.getItem("todos")) || [];
  const resetTodos = todos.map(t => ({ ...t, checked: false }));
  localStorage.setItem("todos", JSON.stringify(resetTodos));
  loadTodos();
}

function updateTodoScrollIndicator() {
  const list = document.getElementById("todo-list");
  const indicator = document.getElementById("todo-scroll-indicator");
  const addTaskBtn = document.getElementById("add-task-button");

  if (!list || !indicator || !addTaskBtn) return;

  const isScrollable = list.scrollHeight > list.clientHeight;
  const isAtBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;

  indicator.style.display = (isScrollable && !isAtBottom) ? "flex" : "none";
}

document.getElementById("todo-list").addEventListener("scroll", updateTodoScrollIndicator);
window.addEventListener("resize", updateTodoScrollIndicator);
setTimeout(updateTodoScrollIndicator, 100);

loadTodos();
scheduleDailyReset();
