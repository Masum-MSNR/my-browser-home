const mailDropdownBtn = document.getElementById("mail-dropdown-btn");
const mailDropdown = document.getElementById("mail-dropdown");
const mailDropdownList = document.getElementById("mail-dropdown-list");
const mailDropdownHeader = document.querySelector(".mail-dropdown-header");
const MAIL_STORAGE_KEY = "mailShortcuts";

function closeDropdown() {
    mailDropdown.classList.remove("open");
    mailDropdownBtn.classList.remove("active");
}

mailDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeSyncDropdown();
    if (typeof closeBookmarkDropdown === "function") closeBookmarkDropdown();
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

async function getMailShortcuts() {
    return await new Promise(function (resolve) {
        chrome.storage.local.get(MAIL_STORAGE_KEY, function (result) {
            if (result && result[MAIL_STORAGE_KEY] !== undefined) {
                resolve(result[MAIL_STORAGE_KEY]);
                return;
            }
            try {
                var raw = localStorage.getItem(MAIL_STORAGE_KEY);
                resolve(raw ? JSON.parse(raw) : []);
            } catch (e) {
                resolve([]);
            }
        });
    }) || [];
}

async function setMailShortcuts(val) {
    await new Promise(function (resolve) {
        var next = {};
        next[MAIL_STORAGE_KEY] = val;
        chrome.storage.local.set(next, function () {
            try { localStorage.setItem(MAIL_STORAGE_KEY, JSON.stringify(val)); } catch (e) {}
            resolve();
        });
    });
}

async function renderMailList() {
    const mails = await getMailShortcuts();
    mailDropdownList.innerHTML = "";
    mails.forEach(function (m, idx) { addMailItem(m, idx); });
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

    link.appendChild(img);
    return link;
}

function addMailItem({ email, name, image }, idx) {
    const li = document.createElement("li");
    li.className = "mail-account-card";
    li.draggable = true;
    li.dataset.email = email;
    li.dataset.idx = idx;

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

    cloudLink.appendChild(cloudIcon);
    services.appendChild(cloudLink);

    info.appendChild(nameEl);
    info.appendChild(emailEl);

    li.appendChild(avatar);
    li.appendChild(info);
    li.appendChild(services);
    wireMailDragReorder(li, idx);
    mailDropdownList.appendChild(li);
}

// === Drag-reorder for mail list ===
function wireMailDragReorder(li, idx) {
    li.addEventListener("dragstart", function (e) {
        // Don't initiate drag from interactive children (links, buttons)
        if (e.target && e.target.closest && e.target.closest("a,button")) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "mail:" + idx);
        li.classList.add("dragging");
    });
    li.addEventListener("dragend", function () {
        li.classList.remove("dragging");
        var all = mailDropdownList.querySelectorAll(".mail-account-card");
        for (var i = 0; i < all.length; i++) {
            all[i].classList.remove("drag-over-top", "drag-over-bottom");
        }
    });
    li.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (li.classList.contains("dragging")) return;
        var rect = li.getBoundingClientRect();
        var midY = rect.top + rect.height / 2;
        li.classList.toggle("drag-over-top", e.clientY < midY);
        li.classList.toggle("drag-over-bottom", e.clientY >= midY);
    });
    li.addEventListener("dragleave", function () {
        li.classList.remove("drag-over-top", "drag-over-bottom");
    });
    li.addEventListener("drop", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        var data = e.dataTransfer.getData("text/plain") || "";
        if (data.indexOf("mail:") !== 0) return;
        var fromIdx = parseInt(data.split(":")[1], 10);
        if (isNaN(fromIdx) || fromIdx === idx) {
            li.classList.remove("drag-over-top", "drag-over-bottom");
            return;
        }
        var rect = li.getBoundingClientRect();
        var dropAfter = e.clientY >= rect.top + rect.height / 2;
        var toIdx = dropAfter ? idx + 1 : idx;
        if (fromIdx < toIdx) toIdx--;

        var mails = await getMailShortcuts();
        if (!Array.isArray(mails) || fromIdx < 0 || fromIdx >= mails.length) return;
        var moved = mails.splice(fromIdx, 1)[0];
        mails.splice(toIdx, 0, moved);
        await setMailShortcuts(mails);
        await renderMailList();
    });
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
            // Preserve user-reordered list: existing accounts keep their order,
            // newly discovered ones append at the end.
            var existing = await getMailShortcuts();
            if (!Array.isArray(existing)) existing = [];
            var byEmail = {};
            for (var ri = 0; ri < result.length; ri++) byEmail[result[ri].email] = result[ri];
            var merged = [];
            var seen = {};
            for (var ei = 0; ei < existing.length; ei++) {
                var em = existing[ei] && existing[ei].email;
                if (em && byEmail[em]) {
                    // Refresh name/image from latest scan but keep position
                    merged.push(byEmail[em]);
                    seen[em] = true;
                }
            }
            for (var ri2 = 0; ri2 < result.length; ri2++) {
                if (!seen[result[ri2].email]) merged.push(result[ri2]);
            }
            await setMailShortcuts(merged);
            await renderMailList();
        }
    } catch (err) {}
}

if (mailDropdownHeader) {
    var refreshBtn = document.createElement("button");
    refreshBtn.className = "mail-add-account";
    refreshBtn.title = "Scan for accounts";
    refreshBtn.innerHTML = '<span class="add-account-icon"><i class="fas fa-sync-alt"></i></span>';
    refreshBtn.addEventListener("click", function () {
        scanAccountChooserPageAndSave();
    });
    mailDropdownHeader.appendChild(refreshBtn);

    var addBtn = document.createElement("button");
    addBtn.className = "mail-add-account";
    addBtn.innerHTML = '<span class="add-account-icon"><i class="fas fa-plus"></i></span>';
    addBtn.addEventListener("click", function () {
        window.open(
            "https://accounts.google.com/v3/signin/identifier?continue=https://www.google.com?hl=en-US&ec=GAlA8wE&hl=en&flowName=GlifWebSignIn&flowEntry=AddSession",
            "_blank"
        );
    });
    mailDropdownHeader.appendChild(addBtn);
}

renderMailList();

// Auto-scan once per browser session (sessionStorage resets on browser close)
if (!sessionStorage.getItem("_mail_scanned")) {
    sessionStorage.setItem("_mail_scanned", "1");
    scanAccountChooserPageAndSave();
}
