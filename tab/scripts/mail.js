const mailDropdownBtn = document.getElementById("mail-dropdown-btn");
const mailDropdown = document.getElementById("mail-dropdown");
const mailDropdownList = document.getElementById("mail-dropdown-list");
const mailDropdownHeader = document.querySelector(".mail-dropdown-header");

function closeDropdown() {
    mailDropdown.classList.remove("open");
    mailDropdownBtn.classList.remove("active");
}

mailDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = mailDropdown.classList.toggle("open");
    mailDropdownBtn.classList.toggle("active", isOpen);
});

document.addEventListener("click", (e) => {
    if (!mailDropdown.contains(e.target) && !mailDropdownBtn.contains(e.target)) {
        closeDropdown();
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mailDropdown.classList.contains("open")) {
        closeDropdown();
    }
});

function saveMailShortcuts(data) {
    localStorage.setItem("mailShortcuts", JSON.stringify(data));
}

function loadMailShortcuts() {
    const mails = JSON.parse(localStorage.getItem("mailShortcuts")) || [];
    mailDropdownList.innerHTML = "";
    mails.forEach(addMailItem);
    addAddMailButton();
}

function createServiceLink(href, title, iconUrl) {
    const link = document.createElement("a");
    link.className = "service-link";
    link.href = href;
    link.title = title;
    link.target = "_blank";

    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = title;
    img.width = 20;
    img.height = 20;

    const label = document.createElement("span");
    label.textContent = title;

    link.appendChild(img);
    link.appendChild(label);
    return link;
}

function addMailItem({ email, name, image }) {
    const li = document.createElement("li");
    li.className = "mail-account-card";

    const avatar = document.createElement("img");
    avatar.className = "account-avatar";
    avatar.src = image;
    avatar.alt = name;

    const info = document.createElement("div");
    info.className = "account-info";

    const nameEl = document.createElement("div");
    nameEl.className = "account-name";
    nameEl.textContent = name;

    const emailEl = document.createElement("div");
    emailEl.className = "account-email";
    emailEl.textContent = email;

    const services = document.createElement("div");
    services.className = "account-services";

    const prefix = `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=`;

    services.appendChild(createServiceLink(prefix + "https://mail.google.com", "Gmail", "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico"));
    services.appendChild(createServiceLink(prefix + "https://drive.google.com/drive/my-drive", "Drive", "https://ssl.gstatic.com/docs/doclist/images/drive_icon_32.png"));
    services.appendChild(createServiceLink(prefix + "https://meet.google.com", "Meet", "https://www.gstatic.com/images/branding/product/2x/hh_meet_48dp.png"));
    services.appendChild(createServiceLink(prefix + "https://docs.google.com/document/u/0/", "Docs", "https://ssl.gstatic.com/docs/doclist/images/icon_10_document_list.png"));
    services.appendChild(createServiceLink(prefix + "https://docs.google.com/spreadsheets/u/0/", "Sheets", "https://ssl.gstatic.com/docs/doclist/images/icon_10_spreadsheet_list.png"));

    const cloudLink = document.createElement("a");
    cloudLink.className = "service-link";
    cloudLink.href = prefix + "https://console.cloud.google.com/";
    cloudLink.title = "Cloud";
    cloudLink.target = "_blank";

    const cloudIcon = document.createElement("i");
    cloudIcon.className = "fas fa-cloud";

    const cloudLabel = document.createElement("span");
    cloudLabel.textContent = "Cloud";

    cloudLink.appendChild(cloudIcon);
    cloudLink.appendChild(cloudLabel);
    services.appendChild(cloudLink);

    info.appendChild(nameEl);
    info.appendChild(emailEl);
    info.appendChild(services);

    li.appendChild(avatar);
    li.appendChild(info);
    mailDropdownList.appendChild(li);
}

function addAddMailButton() {
    const li = document.createElement("li");
    li.className = "mail-add-account";

    const icon = document.createElement("span");
    icon.className = "add-account-icon";
    icon.innerHTML = '<i class="fas fa-plus"></i>';

    const text = document.createElement("span");
    text.textContent = "Add another account";

    li.appendChild(icon);
    li.appendChild(text);

    li.addEventListener("click", () => {
        window.open(
            "https://accounts.google.com/v3/signin/identifier?continue=https://www.google.com?hl=en-US&ec=GAlA8wE&hl=en&flowName=GlifWebSignIn&flowEntry=AddSession",
            "_blank"
        );
    });

    mailDropdownList.appendChild(li);
}

async function scanAccountChooserPageAndSave() {
    try {
        const response = await fetch("https://accounts.google.com/AccountChooser?continue=https://mail.google.com");
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        const elements = doc.querySelectorAll('.VV3oRb.YZVTmd.SmR8');

        const result = Array.from(elements).map(el => {
            const nameEl = el.querySelector('.pGzURd');
            const emailEl = el.querySelector('.yAlK0b');
            const imgEl = el.querySelector('img');

            if (nameEl && emailEl && imgEl) {
                return {
                    name: nameEl.textContent.trim(),
                    email: emailEl.getAttribute('data-email') || emailEl.textContent.trim(),
                    image: imgEl.getAttribute('src')
                };
            }
            return null;
        }).filter(Boolean);

        if (result.length > 0) {
            saveMailShortcuts(result);
            loadMailShortcuts();
        } else {
            console.log("No Gmail accounts found.");
        }
    } catch (err) {
        console.error("Failed to fetch account chooser page:", err);
    }
}

if (mailDropdownHeader) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "mail-dropdown-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", closeDropdown);
    mailDropdownHeader.appendChild(closeBtn);
}

loadMailShortcuts();
scanAccountChooserPageAndSave();
