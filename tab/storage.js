function syncGet(key) {
    return new Promise(function (resolve) {
        chrome.storage.sync.get(key, function (result) {
            resolve(result[key] || localStorage.getItem(key));
        });
    });
}

function syncSet(obj) {
    return new Promise(function (resolve) {
        chrome.storage.sync.set(obj, resolve);
    });
}

function updateSyncUI(user) {
    var btn = document.getElementById("sync-btn");
    if (!btn) return;
    if (user) {
        btn.classList.add("synced");
        btn.title = "Signed in as " + user.email;
    } else {
        btn.classList.remove("synced");
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

    if (user) {
        var initial = user.email.charAt(0).toUpperCase();
        content.innerHTML =
            '<div class="sync-dropdown-inner">' +
            '  <div class="sync-dropdown-user">' +
            '    <div class="sync-dropdown-avatar">' + initial + '</div>' +
            '    <div class="sync-dropdown-email">' + user.email + '</div>' +
            '  </div>' +
            '  <div class="sync-dropdown-actions">' +
            '    <button id="sync-now-btn" class="sync-dropdown-btn primary">Sync now</button>' +
            '    <button id="switch-account-btn" class="sync-dropdown-btn ghost">Switch account</button>' +
            '    <button id="signout-btn" class="sync-dropdown-btn danger">Sign out</button>' +
            '  </div>' +
            '</div>';

        document.getElementById("sync-now-btn").onclick = async function () {
            closeSyncDropdown();
            showSyncBubble("Syncing...", "");
            try {
                await fbSaveAll();
                showSyncBubble("Synced as " + user.email + " &#10003;", "synced");
            } catch (err) {
                showSyncBubble(err.message || "Sync failed", "error");
            }
        };

        document.getElementById("switch-account-btn").onclick = async function () {
            closeSyncDropdown();
            await signOut();
            await signIn();
        };

        document.getElementById("signout-btn").onclick = function () {
            closeSyncDropdown();
            signOut();
            showSyncBubble("Signed out", "");
        };
    } else {
        content.innerHTML =
            '<div class="sync-dropdown-inner">' +
            '  <p class="sync-dropdown-info">Sync your shortcuts and themes across all your devices</p>' +
            '  <button id="signin-dropdown-btn" class="sync-dropdown-btn signin">' +
            '    <i class="fas fa-google"></i> Sign in with Google' +
            '  </button>' +
            '</div>';

        document.getElementById("signin-dropdown-btn").onclick = async function () {
            closeSyncDropdown();
            try {
                await signIn();
            } catch (err) {
                showSyncBubble(err.message || "Sign-in failed", "error");
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
