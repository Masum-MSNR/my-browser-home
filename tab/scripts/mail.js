const mailDropdownBtn = document.getElementById("mail-dropdown-btn");
const mailDropdown = document.getElementById("mail-dropdown");
const mailDropdownList = document.getElementById("mail-dropdown-list");

mailDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    mailDropdown.classList.toggle("open");
});

document.addEventListener("click", (e) => {
    if (!mailDropdown.contains(e.target) && !mailDropdownBtn.contains(e.target)) {
        mailDropdown.classList.remove("open");
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

function createIconLink(href, title, iconUrl) {
    const link = document.createElement("a");
    link.href = href;
    link.title = title;
    link.target = "_blank";

    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = title;
    img.width = 18;
    img.height = 18;
    img.style.borderRadius = "4px";
    img.style.objectFit = "contain";

    link.appendChild(img);
    return link;
}

function addMailItem({ email, name, image }) {
    const li = document.createElement("li");
    li.className = "mail-dropdown-item";

    const leftContent = document.createElement("div");
    leftContent.className = "mail-left";

    const imageEl = document.createElement("img");
    imageEl.src = image;
    imageEl.alt = name;

    const nameDiv = document.createElement("div");
    nameDiv.className = "name";
    nameDiv.textContent = name;

    const emailSpan = document.createElement("div");
    emailSpan.className = "email";
    emailSpan.textContent = email;

    const accountPrefix = `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=`;

    const links = document.createElement("div");
    links.className = "mail-links";

    links.appendChild(createIconLink(`${accountPrefix}https://mail.google.com`, "Gmail", "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico"));
    links.appendChild(createIconLink(`${accountPrefix}https://drive.google.com/drive/my-drive`, "Drive", "https://ssl.gstatic.com/docs/doclist/images/drive_icon_32.png"));
    links.appendChild(createIconLink(`${accountPrefix}https://meet.google.com`, "Meet", "https://www.gstatic.com/images/branding/product/2x/hh_meet_48dp.png"));
    links.appendChild(createIconLink(`${accountPrefix}https://docs.google.com/document/u/0/`, "Docs", "https://ssl.gstatic.com/docs/doclist/images/icon_10_document_list.png"));
    links.appendChild(createIconLink(`${accountPrefix}https://docs.google.com/spreadsheets/u/0/`, "Sheets", "https://ssl.gstatic.com/docs/doclist/images/icon_10_spreadsheet_list.png"));

    const infoWrapper = document.createElement("div");
    infoWrapper.className = "mail-info";
    infoWrapper.appendChild(nameDiv);
    infoWrapper.appendChild(emailSpan);
    infoWrapper.appendChild(links);

    leftContent.appendChild(imageEl);
    leftContent.appendChild(infoWrapper);
    li.appendChild(leftContent);
    mailDropdownList.appendChild(li);
}

function addAddMailButton() {
    const li = document.createElement("li");
    li.className = "mail-dropdown-item add-mail-button";
    li.textContent = "+ Add Gmail";

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

loadMailShortcuts();
scanAccountChooserPageAndSave();
