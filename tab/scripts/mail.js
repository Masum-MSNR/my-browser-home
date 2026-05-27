const mailDropdownBtn = document.getElementById("mail-dropdown-btn");
const mailDropdown = document.getElementById("mail-dropdown");
const mailDropdownList = document.getElementById("mail-dropdown-list");
const mailDropdownHeader = document.querySelector(".mail-dropdown-header");
const MAIL_STORAGE_KEY = "mailShortcuts";
const pendingMailImageRequests = {};

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
    const normalized = await normalizeMailShortcuts(await getMailShortcuts());
    const mails = normalized.items;
    if (normalized.changed) {
        await setMailShortcuts(mails);
    }
    mailDropdownList.innerHTML = "";
    mails.forEach(function (m, idx) { addMailItem(m, idx); });
}

function buildMailServiceIconSrc(url) {
    return "/_favicon/?pageUrl=" + encodeURIComponent(url) + "&size=32";
}

function createServiceLink(serviceKey, href, title, targetUrl) {
    const link = document.createElement("a");
    link.className = "service-link service-link-" + serviceKey;
    link.href = href;
    link.title = title;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.setAttribute("aria-label", title);

    const img = document.createElement("img");
    img.className = "service-icon-image service-icon-" + serviceKey;
    img.src = buildMailServiceIconSrc(targetUrl);
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    link.appendChild(img);

    return link;
}

function getMailServiceDefinitions(prefix) {
    return [
        { key: "gmail", title: "Gmail", targetUrl: "https://mail.google.com" },
        { key: "drive", title: "Drive", targetUrl: "https://drive.google.com/drive/my-drive" },
        { key: "meet", title: "Meet", targetUrl: "https://meet.google.com" },
        { key: "docs", title: "Docs", targetUrl: "https://docs.google.com/document/u/0/" },
        { key: "sheets", title: "Sheets", targetUrl: "https://docs.google.com/spreadsheets/u/0/" },
        { key: "gemini", title: "Gemini", targetUrl: "https://gemini.google.com/app" },
        { key: "cloud", title: "Cloud", targetUrl: "https://console.cloud.google.com/" }
    ].map(function (service) {
        return {
            key: service.key,
            title: service.title,
            targetUrl: service.targetUrl,
            href: prefix + service.targetUrl
        };
    });
}

function isRenderableMailImageUrl(image) {
    if (!image) return false;

    if (
        image.indexOf("data:") === 0 ||
        image.indexOf("blob:") === 0 ||
        image.indexOf("chrome-extension://") === 0 ||
        image.indexOf("/") === 0
    ) {
        return true;
    }

    return false;
}

function isRemoteMailImageUrl(image) {
    if (!image) return false;

    try {
        var parsed = new URL(image);
        return parsed.protocol === "https:" && /(^|\.)googleusercontent\.com$/i.test(parsed.hostname);
    } catch (e) {
        return false;
    }
}

function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onloadend = function () {
            resolve(typeof reader.result === "string" ? reader.result : "");
        };
        reader.onerror = function () {
            reject(new Error("Failed to read mail image blob"));
        };
        reader.readAsDataURL(blob);
    });
}

function fetchMailImageDataUrl(image) {
    if (!isRemoteMailImageUrl(image)) return Promise.resolve("");
    if (pendingMailImageRequests[image]) return pendingMailImageRequests[image];

    pendingMailImageRequests[image] = fetch(image, { cache: "force-cache" })
        .then(function (response) {
            if (!response.ok) throw new Error("Failed to fetch mail image");
            return response.blob();
        })
        .then(blobToDataUrl)
        .catch(function () {
            return "";
        })
        .then(function (result) {
            delete pendingMailImageRequests[image];
            return result;
        }, function (error) {
            delete pendingMailImageRequests[image];
            throw error;
        });

    return pendingMailImageRequests[image];
}

async function normalizeMailShortcut(mail) {
    if (!mail || typeof mail !== "object") return mail;

    var next = Object.assign({}, mail);
    var image = typeof next.image === "string" ? next.image.trim() : "";

    if (!image || isRenderableMailImageUrl(image)) {
        next.image = image;
        return { item: next, changed: image !== (mail.image || "") };
    }

    if (!isRemoteMailImageUrl(image)) {
        next.image = "";
        return { item: next, changed: true };
    }

    var dataUrl = await fetchMailImageDataUrl(image);
    next.image = dataUrl || "";
    return { item: next, changed: next.image !== image };
}

async function normalizeMailShortcuts(mails) {
    var items = Array.isArray(mails) ? mails : [];
    var changed = false;
    var normalized = [];

    for (var i = 0; i < items.length; i++) {
        var result = await normalizeMailShortcut(items[i]);
        normalized.push(result.item);
        if (result.changed) changed = true;
    }

    return { items: normalized, changed: changed };
}

function createAccountAvatar(name, email, image) {
    var trimmedImage = typeof image === "string" ? image.trim() : "";
    if (isRenderableMailImageUrl(trimmedImage)) {
        const avatar = document.createElement("img");
        avatar.className = "account-avatar account-avatar-image";
        avatar.src = trimmedImage;
        avatar.alt = name;
        return avatar;
    }

    const fallback = document.createElement("div");
    fallback.className = "account-avatar account-avatar-fallback";
    var source = (name || email || "?").trim();
    var parts = source.split(/\s+/).filter(Boolean);
    var initials = parts.length > 1
        ? (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
        : source.slice(0, 2).toUpperCase();
    fallback.textContent = initials || "?";
    fallback.setAttribute("aria-label", name || email || "Mail account");
    return fallback;
}

function addMailItem({ email, name, image }, idx) {
    const li = document.createElement("li");
    li.className = "mail-account-card";
    li.draggable = true;
    li.dataset.email = email;
    li.dataset.idx = idx;

    const avatar = createAccountAvatar(name, email, image);

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
    const serviceLinks = getMailServiceDefinitions(prefix);
    serviceLinks.forEach(function (service) {
        services.appendChild(createServiceLink(service.key, service.href, service.title, service.targetUrl));
    });

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
            var normalized = await normalizeMailShortcuts(merged);
            await setMailShortcuts(normalized.items);
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
