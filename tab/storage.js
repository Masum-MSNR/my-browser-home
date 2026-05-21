// Reads/writes use chrome.storage.local because chrome.storage.sync is
// auto-replicated by Chrome behind our back, which previously caused two
// devices to roll each other's writes back. localStorage is mirrored for
// fast synchronous fallbacks elsewhere in the code.
var SYNC_DATA_KEYS = ["shortcuts", "bookmarks", "bookmarkFolders", "customBg"];
var LOCAL_SYNC_WRITE_TTL_MS = 3000;
var pendingLocalSyncWrites = {};

function isAppSyncDataKey(key) {
    return SYNC_DATA_KEYS.indexOf(key) !== -1;
}

function serializeLocalSyncWriteValue(value) {
    try {
        return JSON.stringify(value);
    } catch (e) {
        return "";
    }
}

function rememberLocalSyncWrite(obj) {
    if (!obj || typeof obj !== "object") return;
    var expiresAt = Date.now() + LOCAL_SYNC_WRITE_TTL_MS;
    for (var key in obj) {
        if (!obj.hasOwnProperty(key) || !isAppSyncDataKey(key)) continue;
        if (!Array.isArray(pendingLocalSyncWrites[key])) pendingLocalSyncWrites[key] = [];
        pendingLocalSyncWrites[key].push({
            valueHash: serializeLocalSyncWriteValue(obj[key]),
            expiresAt: expiresAt
        });
    }
}

function wasPendingLocalSyncWrite(key, value) {
    var entries = pendingLocalSyncWrites[key];
    if (!Array.isArray(entries) || entries.length === 0) return false;

    var now = Date.now();
    var valueHash = serializeLocalSyncWriteValue(value);
    var nextEntries = [];
    var matched = false;

    for (var i = 0; i < entries.length; i++) {
        if (!entries[i] || entries[i].expiresAt < now) continue;
        if (!matched && entries[i].valueHash === valueHash) {
            matched = true;
            continue;
        }
        nextEntries.push(entries[i]);
    }

    if (nextEntries.length > 0) pendingLocalSyncWrites[key] = nextEntries;
    else delete pendingLocalSyncWrites[key];

    return matched;
}

function syncGet(key) {
    return new Promise(function (resolve) {
        chrome.storage.local.get(key, function (result) {
            if (result[key] !== undefined) {
                resolve(result[key]);
                return;
            }
            if (isAppSyncDataKey(key)) {
                var localRaw = localStorage.getItem(key);
                try { resolve(localRaw ? JSON.parse(localRaw) : localRaw); } catch (e) { resolve(localRaw); }
                return;
            }
            // One-time migration: legacy data may still live in
            // chrome.storage.sync. Copy it into local on first access.
            chrome.storage.sync.get(key, function (syncResult) {
                if (syncResult && syncResult[key] !== undefined) {
                    var copy = {};
                    copy[key] = syncResult[key];
                    chrome.storage.local.set(copy);
                    resolve(syncResult[key]);
                    return;
                }
                var raw = localStorage.getItem(key);
                try { resolve(raw ? JSON.parse(raw) : raw); } catch (e) { resolve(raw); }
            });
        });
    });
}

function syncSet(obj) {
    return new Promise(function (resolve) {
        rememberLocalSyncWrite(obj);
        chrome.storage.local.set(obj, function () {
            for (var k in obj) {
                if (obj.hasOwnProperty(k)) {
                    try { localStorage.setItem(k, JSON.stringify(obj[k])); } catch (e) {}
                }
            }
            resolve();
        });
    });
}

function updateSyncUI(user) {
    var btn = document.getElementById("sync-btn");
    if (!btn) return;
    if (user) {
        setSyncIcon("synced");
        btn.title = "Signed in as " + user.email;
    } else {
        btn.classList.remove("synced", "error");
        btn.title = "Sign in with Google to sync";
    }
    renderSyncDropdown(user);
}

function showSyncBubble(text, cls) {
    var bubble = document.getElementById("sync-info-bubble");
    if (!bubble) {
        bubble = document.createElement("div");
        bubble.id = "sync-info-bubble";
        bubble.className = "sync-info-bubble";
        document.body.appendChild(bubble);
    }
    bubble.innerHTML = text;
    bubble.className = "sync-info-bubble " + (cls || "");
    bubble.style.display = "block";
    clearTimeout(bubble._timer);
    bubble._timer = setTimeout(function () { bubble.style.display = "none"; }, 4000);
}

function renderSyncDropdown(user) {
    var content = document.getElementById("sync-dropdown-content");
    if (!content) return;

    var statusId = "sync-status-msg";

    if (user) {
        var initial = user.email.charAt(0).toUpperCase();
        content.innerHTML =
            '<div class="sync-dropdown-inner">' +
            '  <div class="sync-dropdown-user">' +
            '    <div class="sync-dropdown-avatar">' + initial + '</div>' +
            '    <div class="sync-dropdown-email">' + user.email + '</div>' +
            '  </div>' +
            '  <div id="' + statusId + '" class="sync-status-msg" style="display:none"></div>' +
            '  <div class="sync-dropdown-actions">' +
            '    <button id="sync-now-btn" class="sync-dropdown-btn primary">Sync now</button>' +
            '    <button id="switch-account-btn" class="sync-dropdown-btn ghost">Switch account</button>' +
            '    <button id="signout-btn" class="sync-dropdown-btn danger">Sign out</button>' +
            '  </div>' +
            '</div>';

        var statusEl = document.getElementById(statusId);

        document.getElementById("sync-now-btn").onclick = async function () {
            statusEl.style.display = "block";
            statusEl.className = "sync-status-msg";
            statusEl.textContent = "Syncing...";
            try {
                await fbSaveAll();
                statusEl.className = "sync-status-msg success";
                statusEl.textContent = "Synced as " + user.email;
            } catch (err) {
                statusEl.className = "sync-status-msg error";
                statusEl.textContent = err.message || "Sync failed";
            }
        };

        document.getElementById("switch-account-btn").onclick = async function () {
            await signOut();
            await signIn();
        };

        document.getElementById("signout-btn").onclick = function () {
            closeSyncDropdown();
            signOut();
        };
    } else {
        content.innerHTML =
            '<div class="sync-dropdown-inner">' +
            '  <p class="sync-dropdown-info">Sync your shortcuts and themes across all your devices</p>' +
            '  <div id="' + statusId + '" class="sync-status-msg error" style="display:none"></div>' +
            '  <button id="signin-dropdown-btn" class="sync-dropdown-btn signin">' +
            '    <i class="fab fa-google"></i> Sign in with Google' +
            '  </button>' +
            '</div>';

        var statusEl = document.getElementById(statusId);

        document.getElementById("signin-dropdown-btn").onclick = async function () {
            try {
                await signIn();
                closeSyncDropdown();
            } catch (err) {
                statusEl.style.display = "block";
                statusEl.className = "sync-status-msg error";
                statusEl.textContent = err.message || "Sign-in failed";
            }
        };
    }
}

function closeSyncDropdown() {
    var dropdown = document.getElementById("sync-dropdown");
    if (dropdown) dropdown.classList.remove("open");
}

(function initSyncButton() {
    var btn = document.getElementById("sync-btn");
    var dropdown = document.getElementById("sync-dropdown");
    if (!btn || !dropdown) return;

    btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof closeDropdown === "function") closeDropdown();
        if (typeof closeBookmarkDropdown === "function") closeBookmarkDropdown();
        var isOpen = dropdown.classList.toggle("open");
        if (isOpen) renderSyncDropdown(getCurrentUser());
    });

    document.addEventListener("click", function (e) {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            closeSyncDropdown();
        }
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeSyncDropdown();
    });

    updateSyncUI(getCurrentUser());
})();

if (typeof initSync === "function") {
    initSync();
}
