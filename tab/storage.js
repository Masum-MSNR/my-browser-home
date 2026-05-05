function syncGet(key) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(key, (result) => {
            resolve(result[key]);
        });
    });
}

function syncSet(obj) {
    return new Promise((resolve) => {
        chrome.storage.sync.set(obj, resolve);
    });
}

(function initSyncButton() {
    const btn = document.getElementById("sync-btn");
    if (!btn) return;

    let infoBubble = document.getElementById("sync-info-bubble");
    if (!infoBubble) {
        infoBubble = document.createElement("div");
        infoBubble.id = "sync-info-bubble";
        infoBubble.className = "sync-info-bubble";
        document.body.appendChild(infoBubble);
    }

    function showInfo(text, status) {
        infoBubble.textContent = text;
        infoBubble.className = "sync-info-bubble " + status;
        infoBubble.style.display = "block";
        clearTimeout(infoBubble._timer);
        infoBubble._timer = setTimeout(() => {
            infoBubble.style.display = "none";
        }, 3000);
    }

    chrome.storage.sync.getBytesInUse(null, (bytes) => {
        if (!chrome.runtime.lastError && bytes > 0) {
            btn.classList.add("synced");
        }
    });

    btn.addEventListener("click", async () => {
        btn.classList.add("syncing");
        btn.classList.remove("synced");

        try {
            const shortcuts = await syncGet("shortcuts") || JSON.parse(localStorage.getItem("shortcuts") || "[]");
            const mailShortcuts = await syncGet("mailShortcuts") || JSON.parse(localStorage.getItem("mailShortcuts") || "[]");
            const customBg = await syncGet("customBg") || localStorage.getItem("customBg");

            await syncSet({ shortcuts, mailShortcuts, customBg });
            btn.classList.add("synced");

            chrome.identity.getProfileUserInfo({}, (user) => {
                if (user.email) {
                    showInfo(user.email, "synced");
                } else {
                    showInfo("Synced (no account signed in)", "synced");
                }
            });
        } catch (err) {
            showInfo("Sync failed", "error");
            console.warn("Sync failed:", err.message);
        }

        btn.classList.remove("syncing");
    });
})();
