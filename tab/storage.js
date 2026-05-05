function syncGet(key) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(key, (result) => {
            resolve(result[key] || localStorage.getItem(key));
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

    let bubble = document.getElementById("sync-info-bubble");
    if (!bubble) {
        bubble = document.createElement("div");
        bubble.id = "sync-info-bubble";
        bubble.className = "sync-info-bubble";
        document.body.appendChild(bubble);
    }

    function showInfo(text, status) {
        bubble.innerHTML = text;
        bubble.className = "sync-info-bubble " + status;
        bubble.style.display = "block";
        clearTimeout(bubble._timer);
        bubble._timer = setTimeout(() => { bubble.style.display = "none"; }, 4000);
    }

    btn.addEventListener("click", async () => {
        if (!auth.currentUser) {
            showInfo("Signing in with Google...", "");
            await signIn();
            return;
        }

        btn.classList.add("syncing");

        try {
            const shortcuts = JSON.parse(localStorage.getItem("shortcuts") || "[]");
            const mailShortcuts = JSON.parse(localStorage.getItem("mailShortcuts") || "[]");
            const customBg = localStorage.getItem("customBg");

            await saveUserData({ shortcuts, mailShortcuts, customBg });
            await syncSet({ shortcuts, mailShortcuts, customBg });
            btn.classList.add("synced");
            showInfo("Synced &#10003;", "synced");
        } catch (err) {
            showInfo(err.message, "error");
        }

        btn.classList.remove("syncing");
    });
})();
