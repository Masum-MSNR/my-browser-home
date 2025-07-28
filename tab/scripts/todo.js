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
  todos.forEach(text => addTodoItem(text));
}

function saveTodos() {
  const todos = Array.from(todoItemsWrapper.children).map(li => li.firstChild.textContent.trim());
  localStorage.setItem("todos", JSON.stringify(todos));
}

function addTodoItem(text) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.textContent = text;

  const delBtn = document.createElement("button");
  delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
  delBtn.onclick = () => {
    li.remove();
    saveTodos();
  };

  li.appendChild(span);
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

loadTodos();
