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

    function show(text, cls) {
        bubble.innerHTML = text;
        bubble.className = "sync-info-bubble " + cls;
        bubble.style.display = "block";
        clearTimeout(bubble._timer);
        bubble._timer = setTimeout(() => { bubble.style.display = "none"; }, 4000);
    }

    async function updateStatus() {
        chrome.identity.getProfileUserInfo({}, async (user) => {
            const badge = document.getElementById("sync-user");
            if (user.email) {
                if (badge) { badge.textContent = user.email; badge.style.display = "inline"; }
                btn.classList.add("synced");
                await initSync();
            } else {
                if (badge) badge.style.display = "none";
                await initSync();
            }
        });
    }

    btn.addEventListener("click", async () => {
        btn.classList.add("syncing");
        btn.classList.remove("synced");

        try {
            await fbSaveAll();
            btn.classList.add("synced");
            chrome.identity.getProfileUserInfo({}, (u) => {
                if (u.email) show(`Synced as ${u.email} &#10003;`, "synced");
                else show(`Synced &#10003;<br><small>ID: ${syncId?.slice(0,8)}&hellip; (use on other devices)</small>`, "synced");
            });
        } catch (err) {
            show(err.message, "error");
        }

        btn.classList.remove("syncing");
    });

    updateStatus();
})();
