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

    let infoBubble = document.getElementById("sync-info-bubble");
    if (!infoBubble) {
        infoBubble = document.createElement("div");
        infoBubble.id = "sync-info-bubble";
        infoBubble.className = "sync-info-bubble";
        document.body.appendChild(infoBubble);
    }

    function showInfo(text, status) {
        infoBubble.innerHTML = text;
        infoBubble.className = "sync-info-bubble " + status;
        infoBubble.style.display = "block";
        clearTimeout(infoBubble._timer);
    }

    function hideInfo() {
        infoBubble._timer = setTimeout(() => {
            infoBubble.style.display = "none";
        }, 5000);
    }

    btn.addEventListener("click", async () => {
        btn.classList.add("syncing");
        btn.classList.remove("synced");

        try {
            await fbSaveAll();
            btn.classList.add("synced");
            showInfo(
                `Synced to Firebase &#10003;<br><small>ID: ${fbSyncId.slice(0,8)}&hellip; <button class="sync-copy-btn" onclick="navigator.clipboard.writeText('${fbSyncId}')" title="Copy full ID">&#128203;</button><br>Use same ID on other devices to link</small>`,
                "synced"
            );
            hideInfo();
        } catch (err) {
            btn.classList.remove("synced");
            showInfo("Sync failed: " + err.message, "error");
            hideInfo();
        }

        btn.classList.remove("syncing");
    });

    btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const newId = prompt("Enter sync ID from another device:", fbSyncId);
        if (newId && newId.length >= 8) {
            localStorage.setItem("syncId", newId.trim());
            showInfo("Sync ID set. Click sync to pull data.", "synced");
            hideInfo();
        }
    });
})();
