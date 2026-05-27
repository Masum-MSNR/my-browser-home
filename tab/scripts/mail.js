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

var MAIL_ICON_NS = "http://www.w3.org/2000/svg";
var mailServiceIconSequence = 0;

function createMailSvgElement(tagName, attrs) {
    var node = document.createElementNS(MAIL_ICON_NS, tagName);
    if (attrs) {
        for (var key in attrs) {
            if (!attrs.hasOwnProperty(key) || attrs[key] === undefined || attrs[key] === null) continue;
            node.setAttribute(key, attrs[key]);
        }
    }
    return node;
}

function appendMailSvgElement(parent, tagName, attrs) {
    var node = createMailSvgElement(tagName, attrs);
    parent.appendChild(node);
    return node;
}

function createServiceIconGraphic(serviceKey) {
    var svg = createMailSvgElement("svg", {
        viewBox: "0 0 24 24",
        class: "service-icon-graphic service-icon-" + serviceKey,
        "aria-hidden": "true",
        focusable: "false"
    });

    if (serviceKey === "gmail") {
        appendMailSvgElement(svg, "path", { fill: "#34A853", d: "M4 7.3v10.2C4 18.9 5.1 20 6.5 20H8V10.7L4 7.3Z" });
        appendMailSvgElement(svg, "path", { fill: "#EA4335", d: "M4 7.3V6.5C4 5.1 5.1 4 6.5 4h.7L12 8.1 16.8 4h.7C18.9 4 20 5.1 20 6.5v.8L12 13.6 4 7.3Z" });
        appendMailSvgElement(svg, "path", { fill: "#FBBC04", d: "M16 20h1.5c1.4 0 2.5-1.1 2.5-2.5V7.3l-4 3.4V20Z" });
        appendMailSvgElement(svg, "path", { fill: "#4285F4", d: "M8 10.7v9.3h8v-9.3l-4 3.4-4-3.4Z" });
        return svg;
    }

    if (serviceKey === "drive") {
        appendMailSvgElement(svg, "path", { fill: "#0F9D58", d: "M9.2 3.5h5.6l4.5 7.8h-5.6L9.2 3.5Z" });
        appendMailSvgElement(svg, "path", { fill: "#4285F4", d: "M13.7 11.3h5.6l-4.5 7.8H9.2l4.5-7.8Z" });
        appendMailSvgElement(svg, "path", { fill: "#F4B400", d: "M9.2 3.5 4.7 11.3l4.5 7.8 4.5-7.8L9.2 3.5Z" });
        return svg;
    }

    if (serviceKey === "meet") {
        appendMailSvgElement(svg, "path", { fill: "#FBBC04", d: "M4.2 8.1 8.5 4.8V10L4.2 13.4V8.1Z" });
        appendMailSvgElement(svg, "path", { fill: "#34A853", d: "M8.5 4.8h6.8c1 0 1.8.8 1.8 1.8v10.8c0 1-.8 1.8-1.8 1.8H8.5V4.8Z" });
        appendMailSvgElement(svg, "path", { fill: "#4285F4", d: "M17.1 10.1 21 7.4v9.2l-3.9-2.7v-3.8Z" });
        return svg;
    }

    if (serviceKey === "docs") {
        appendMailSvgElement(svg, "path", { fill: "#1A73E8", d: "M7 2.8h7.2l4.8 4.8v13.6c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V4.8c0-1.1.9-2 2-2Z" });
        appendMailSvgElement(svg, "path", { fill: "#8AB4F8", d: "M14.2 2.8v4.8H19Z" });
        appendMailSvgElement(svg, "rect", { x: "8.2", y: "11", width: "7.6", height: "1.4", rx: ".7", fill: "#FFFFFF" });
        appendMailSvgElement(svg, "rect", { x: "8.2", y: "14.1", width: "7.6", height: "1.4", rx: ".7", fill: "#FFFFFF" });
        appendMailSvgElement(svg, "rect", { x: "8.2", y: "17.2", width: "5.4", height: "1.4", rx: ".7", fill: "#FFFFFF" });
        return svg;
    }

    if (serviceKey === "sheets") {
        appendMailSvgElement(svg, "path", { fill: "#188038", d: "M7 2.8h7.2l4.8 4.8v13.6c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V4.8c0-1.1.9-2 2-2Z" });
        appendMailSvgElement(svg, "path", { fill: "#81C995", d: "M14.2 2.8v4.8H19Z" });
        appendMailSvgElement(svg, "rect", { x: "8.3", y: "11", width: "7.4", height: "6.8", rx: ".8", fill: "none", stroke: "#FFFFFF", "stroke-width": "1.3" });
        appendMailSvgElement(svg, "path", { d: "M12 11v6.8M8.3 14.4h7.4", fill: "none", stroke: "#FFFFFF", "stroke-width": "1.3", "stroke-linecap": "round" });
        return svg;
    }

    if (serviceKey === "gemini") {
        mailServiceIconSequence += 1;
        var gradientId = "mail-gemini-gradient-" + mailServiceIconSequence;
        var defs = appendMailSvgElement(svg, "defs");
        var gradient = appendMailSvgElement(defs, "linearGradient", {
            id: gradientId,
            x1: "5",
            y1: "19",
            x2: "19",
            y2: "5",
            gradientUnits: "userSpaceOnUse"
        });
        appendMailSvgElement(gradient, "stop", { offset: "0%", "stop-color": "#1AA8FF" });
        appendMailSvgElement(gradient, "stop", { offset: "45%", "stop-color": "#6D5EFC" });
        appendMailSvgElement(gradient, "stop", { offset: "100%", "stop-color": "#B84DFF" });
        appendMailSvgElement(svg, "path", {
            fill: "url(#" + gradientId + ")",
            d: "M12 2.4c.71 3.16 1.9 6.13 3.55 8.75 2.62 1.65 5.59 2.84 8.75 3.55-3.16.71-6.13 1.9-8.75 3.55-1.65 2.62-2.84 5.59-3.55 8.75-.71-3.16-1.9-6.13-3.55-8.75-2.62-1.65-5.59-2.84-8.75-3.55 3.16-.71 6.13-1.9 8.75-3.55C10.1 8.53 11.29 5.56 12 2.4Z"
        });
        return svg;
    }

    if (serviceKey === "cloud") {
        appendMailSvgElement(svg, "path", { fill: "#EA4335", d: "M9 8.6c.93-1.62 2.67-2.7 4.66-2.7 1.97 0 3.69 1.06 4.63 2.65l-1.92 1.11a3.46 3.46 0 0 0-2.71-1.3c-1.08 0-2.07.49-2.73 1.29L9 8.6Z" });
        appendMailSvgElement(svg, "path", { fill: "#4285F4", d: "M18.3 8.55a4.73 4.73 0 0 1 4.2 4.7c0 1.14-.41 2.18-1.08 2.99l-1.72-1.4c.35-.43.56-.97.56-1.59 0-1.17-.73-2.18-1.76-2.58l.8-2.12Z" });
        appendMailSvgElement(svg, "path", { fill: "#34A853", d: "M8 18.2h10.1c.58 0 1.12-.12 1.61-.35l1.72 1.41a5.88 5.88 0 0 1-3.33 1.04H8a5 5 0 0 1-4.57-2.98l2.05-.92A2.78 2.78 0 0 0 8 18.2Z" });
        appendMailSvgElement(svg, "path", { fill: "#FBBC04", d: "M6.72 9.43A4.4 4.4 0 0 0 3.5 13.7c0 1.03.35 1.97.94 2.71l-1.96 1.04A6.64 6.64 0 0 1 1.3 13.7c0-2.54 1.43-4.75 3.52-5.86l1.9 1.59Z" });
        return svg;
    }

    return svg;
}

function createServiceLink(serviceKey, href, title) {
    const link = document.createElement("a");
    link.className = "service-link service-link-" + serviceKey;
    link.href = href;
    link.title = title;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.setAttribute("aria-label", title);
    link.appendChild(createServiceIconGraphic(serviceKey));
    return link;
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

    services.appendChild(createServiceLink("gmail", prefix + "https://mail.google.com", "Gmail"));
    services.appendChild(createServiceLink("drive", prefix + "https://drive.google.com/drive/my-drive", "Drive"));
    services.appendChild(createServiceLink("meet", prefix + "https://meet.google.com", "Meet"));
    services.appendChild(createServiceLink("docs", prefix + "https://docs.google.com/document/u/0/", "Docs"));
    services.appendChild(createServiceLink("sheets", prefix + "https://docs.google.com/spreadsheets/u/0/", "Sheets"));
    services.appendChild(createServiceLink("gemini", prefix + "https://gemini.google.com/app", "Gemini"));
    services.appendChild(createServiceLink("cloud", prefix + "https://console.cloud.google.com/", "Cloud"));

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
