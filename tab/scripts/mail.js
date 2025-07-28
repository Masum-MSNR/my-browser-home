const mailList = document.getElementById("mail-list");
const mailDialog = document.getElementById("mail-dialog");
const mailForm = document.getElementById("mail-form");
const mailIdInput = document.getElementById("mail-id");
const mailEmailInput = document.getElementById("mail-email");

let mailItemsWrapper = document.getElementById("mail-items-wrapper");
if (!mailItemsWrapper) {
  mailItemsWrapper = document.createElement("div");
  mailItemsWrapper.id = "mail-items-wrapper";
  mailList.appendChild(mailItemsWrapper);
}

const addMailButton = document.createElement("li");
addMailButton.id = "add-mail-button";
addMailButton.className = "add-mail-item";
addMailButton.style.cursor = "pointer";
addMailButton.style.userSelect = "none";

const mailLabel = document.createElement("span");
mailLabel.textContent = "+ Add Mail";

const mailInvisibleBtn = document.createElement("button");
mailInvisibleBtn.innerHTML = "&times;";
mailInvisibleBtn.style.visibility = "hidden";
mailInvisibleBtn.disabled = true;

addMailButton.appendChild(mailLabel);
addMailButton.appendChild(mailInvisibleBtn);

addMailButton.onclick = () => {
  mailDialog.style.display = "flex";
  setTimeout(() => mailIdInput.focus(), 50);
};

mailList.appendChild(mailItemsWrapper);
mailList.appendChild(addMailButton);

function loadMailShortcuts() {
  mailItemsWrapper.innerHTML = "";
  const mails = JSON.parse(localStorage.getItem("mailShortcuts")) || [];
  mails.forEach(({ id, email }) => addMailItem(id, email));
}

function saveMailShortcuts() {
  const mails = Array.from(mailItemsWrapper.children).map(li => {
    const id = li.dataset.id;
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
  li.className = "mail-item";
  li.dataset.id = id; // store id as attribute, not visible

  const leftContent = document.createElement("div");
  leftContent.className = "mail-left";

  const emailSpan = document.createElement("span");
  emailSpan.className = "email";
  emailSpan.textContent = email;

  const index = parseInt(id.trim(), 10);
  const links = document.createElement("div");
  links.className = "mail-links";

  if (!isNaN(index)) {
    const gmailLink = document.createElement("a");
    gmailLink.href = `https://mail.google.com/mail/u/${index}/#inbox`;
    gmailLink.textContent = "Gmail";
    gmailLink.target = "_blank";

    const driveLink = document.createElement("a");
    driveLink.href = `https://drive.google.com/drive/u/${index}/my-drive`;
    driveLink.textContent = "Drive";
    driveLink.target = "_blank";

    links.appendChild(gmailLink);
    links.appendChild(driveLink);
  }

  leftContent.appendChild(emailSpan);
  leftContent.appendChild(links);

  const delBtn = document.createElement("button");
  delBtn.className = "mail-delete-btn";
  delBtn.title = "Delete";
  delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
  delBtn.onclick = () => {
    li.remove();
    saveMailShortcuts();
  };

  li.appendChild(leftContent);
  li.appendChild(delBtn);
  mailItemsWrapper.appendChild(li);
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

document.getElementById("close-mail-dialog").addEventListener("click", () => {
  mailDialog.style.display = "none";
});

loadMailShortcuts();
