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
    var badge = document.getElementById("sync-user");
    if (!btn) return;
    if (user) {
        btn.classList.add("synced");
        btn.title = "Signed in as " + user.email + "\nClick to sync";
        if (badge) { badge.textContent = user.email; badge.style.display = "inline"; }
    } else {
        btn.classList.remove("synced");
        btn.title = "Sign in with Google to sync";
        if (badge) badge.style.display = "none";
    }
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

(function initSyncButton() {
    var btn = document.getElementById("sync-btn");
    if (!btn) return;

    btn.addEventListener("click", async function () {
        if (getCurrentUser()) {
            btn.classList.add("syncing");
            btn.classList.remove("synced");
            try {
                await fbSaveAll();
                btn.classList.add("synced");
                showSyncBubble("Synced as " + getCurrentUser().email + " &#10003;", "synced");
            } catch (err) {
                showSyncBubble(err.message || "Sync failed", "error");
            }
            btn.classList.remove("syncing");
        } else {
            btn.classList.add("syncing");
            try {
                await signIn();
                showSyncBubble("Signed in as " + getCurrentUser().email + " &#10003;", "synced");
            } catch (err) {
                showSyncBubble(err.message || "Sign-in failed", "error");
            }
            btn.classList.remove("syncing");
        }
    });

    updateSyncUI(getCurrentUser());
})();
