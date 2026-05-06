var FB_KEY = "AIzaSyD-qPlTDANCWj0pGvM5OhnGwJ15xvY233E";
var FB_PROJECT = "my-browser-tab";
var FB_BASE = "https://firestore.googleapis.com/v1/projects/" + FB_PROJECT + "/databases/(default)/documents";
var FB_IDTK = "https://identitytoolkit.googleapis.com/v1";

var currentUser = null;

function getSyncId() {
    return currentUser ? currentUser.uid : null;
}

async function fbToken() {
    if (currentUser && currentUser.token) return currentUser.token;
    var cached = JSON.parse(localStorage.getItem("_fbu") || "null");
    if (cached && cached.token) {
        currentUser = cached;
        return cached.token;
    }
    throw new Error("Not signed in. Click the sync button.");
}

async function refreshToken() {
    var cached = JSON.parse(localStorage.getItem("_fbu") || "null");
    if (!cached || !cached.refreshToken) throw new Error("Session expired. Please sign in again.");
    var r = await fetch("https://securetoken.googleapis.com/v1/token?key=" + FB_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: cached.refreshToken })
    });
    var d = await r.json();
    if (!d.id_token) throw new Error("Session expired. Please sign in again.");
    cached.token = d.id_token;
    cached.refreshToken = d.refresh_token || cached.refreshToken;
    currentUser = cached;
    localStorage.setItem("_fbu", JSON.stringify(currentUser));
    return cached.token;
}

function sendToServiceWorker(msg, retries) {
    if (retries === undefined) retries = 5;
    return new Promise(function (resolve, reject) {
        function trySend(left) {
            chrome.runtime.sendMessage(msg, function (response) {
                if (chrome.runtime.lastError) {
                    if (left > 1) {
                        setTimeout(function () { trySend(left - 1); }, 400);
                    } else {
                        reject(new Error(chrome.runtime.lastError.message));
                    }
                } else {
                    resolve(response);
                }
            });
        }
        trySend(retries);
    });
}

async function signIn() {
    var response = await sendToServiceWorker({ type: "GET_AUTH_TOKEN" });
    if (!response || response.error) {
        throw new Error(response ? response.error : "No token received");
    }

    var googleIdToken = response.idToken;
    var redirectUri = response.redirectUri;

    var r = await fetch(FB_IDTK + "/accounts:signInWithIdp?key=" + FB_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            postBody: "id_token=" + encodeURIComponent(googleIdToken) + "&providerId=google.com",
            requestUri: redirectUri,
            returnSecureToken: true,
            returnIdpCredential: true
        })
    });

    var d = await r.json();

    if (!d.idToken) {
        throw new Error((d.error && d.error.message) || "Authentication failed");
    }

    currentUser = {
        uid: d.localId,
        email: d.email,
        displayName: d.displayName || "",
        token: d.idToken,
        refreshToken: d.refreshToken || ""
    };

    localStorage.setItem("_fbu", JSON.stringify(currentUser));

    syncId = currentUser.uid;
    docPath = "users/" + syncId + "/data/main";
    try { await fbLoadAll(); } catch (e) { setSyncIcon("error"); }
    startPolling();

    if (typeof updateSyncUI === "function") updateSyncUI(currentUser);
    return currentUser;
}

function signOut() {
    currentUser = null;
    syncId = null;
    docPath = null;
    localStorage.removeItem("_fbu");
    stopPolling();
    chrome.runtime.sendMessage({ type: "CLEAR_AUTH_TOKEN" }, function () {});
    if (typeof updateSyncUI === "function") updateSyncUI(null);
}

function map(o) {
    var f = {};
    for (var k in o) {
        if (o.hasOwnProperty(k)) {
            if (Array.isArray(o[k])) f[k] = { arrayValue: { values: o[k].map(m) } };
            else f[k] = m(o[k]);
        }
    }
    return f;
}
function m(v) { return v === null ? { nullValue: null } : typeof v === "string" ? { stringValue: v } : typeof v === "number" ? { doubleValue: v } : typeof v === "boolean" ? { booleanValue: v } : typeof v === "object" && !Array.isArray(v) ? { mapValue: { fields: map(v) } } : { nullValue: null }; }
function unmap(d) { var o = {}; if (d.fields) for (var k in d.fields) o[k] = um(d.fields[k]); return o; }
function um(v) { return v.stringValue != null ? v.stringValue : v.doubleValue != null ? v.doubleValue : (v.integerValue != null ? +v.integerValue : v.booleanValue != null ? v.booleanValue : v.nullValue != null ? null : (v.arrayValue != null ? (v.arrayValue.values ? v.arrayValue.values.map(um) : []) : (v.mapValue && v.mapValue.fields ? unmap(v.mapValue) : null))); }

var syncId = null;
var docPath = null;

function ensureShortcut(s, pos) {
    if (!s || !s.url) return null;
    if (!s.id) s.id = crypto.randomUUID();
    if (!s.updatedAt) s.updatedAt = Date.now();
    if (pos !== undefined) s.position = pos;
    if (s.position === undefined) s.position = 0;
    return s;
}

function mergeItems(local, remote, localDeleted, remoteDeleted) {
    var byId = {};
    var tombstones = {};
    // Merge tombstones: remote deletions also count locally
    if (localDeleted) {
        for (var k in localDeleted) {
            if (localDeleted.hasOwnProperty(k)) tombstones[k] = localDeleted[k];
        }
    }
    if (remoteDeleted) {
        for (var k in remoteDeleted) {
            if (remoteDeleted.hasOwnProperty(k)) {
                if (!tombstones[k] || remoteDeleted[k] > tombstones[k]) {
                    tombstones[k] = remoteDeleted[k];
                }
            }
        }
    }

    // Index local by id
    for (var i = 0; i < local.length; i++) {
        var s = ensureShortcut(local[i], i);
        if (!s) continue;
        var delTs = tombstones[s.id];
        if (delTs && delTs >= (s.updatedAt || 0)) continue;
        byId[s.id] = s;
    }

    // Merge remote: keep latest by updatedAt
    for (var i = 0; i < remote.length; i++) {
        var s = ensureShortcut(remote[i]);
        if (!s) continue;
        var delTs = tombstones[s.id];
        if (delTs && delTs >= (s.updatedAt || 0)) continue;
        var existing = byId[s.id];
        if (!existing || (s.updatedAt || 0) > (existing.updatedAt || 0)) {
            byId[s.id] = s;
        }
    }

    // Convert to array sorted by position
    var result = [];
    for (var id in byId) {
        if (byId.hasOwnProperty(id)) result.push(byId[id]);
    }
    result.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

    // Normalize positions and filter nulls
    var clean = [];
    for (var i = 0; i < result.length; i++) {
        if (result[i] && result[i].url) {
            result[i].position = i;
            clean.push(result[i]);
        }
    }
    return clean;
}

// Get merged tombstones (local + remote, keep latest)
function getMergedTombstones(localDeleted, remoteDeleted) {
    var merged = {};
    if (localDeleted) {
        for (var k in localDeleted) {
            if (localDeleted.hasOwnProperty(k)) merged[k] = localDeleted[k];
        }
    }
    if (remoteDeleted) {
        for (var k in remoteDeleted) {
            if (remoteDeleted.hasOwnProperty(k)) {
                if (!merged[k] || remoteDeleted[k] > merged[k]) merged[k] = remoteDeleted[k];
            }
        }
    }
    return merged;
}

var syncId = null;
var docPath = null;

async function fbGet(path, retry) {
    if (retry === undefined) retry = true;
    try {
        var r = await fetch(FB_BASE + "/" + path, {
            headers: { Authorization: "Bearer " + (await fbToken()) }
        });
        if (r.status === 404) return null;
        if ((r.status === 401 || r.status === 403) && retry) {
            await refreshToken();
            return fbGet(path, false);
        }
        var d = await r.json();
        return d.fields ? unmap(d) : null;
    } catch (e) {
        if (retry) return fbGet(path, false);
        throw e;
    }
}

async function fbSet(path, obj, retry) {
    if (retry === undefined) retry = true;
    try {
        var r = await fetch(FB_BASE + "/" + path, {
            method: "PATCH",
            headers: { Authorization: "Bearer " + (await fbToken()), "Content-Type": "application/json" },
            body: JSON.stringify({ fields: map(obj) })
        });
        if ((r.status === 401 || r.status === 403) && retry) {
            await refreshToken();
            return fbSet(path, obj, false);
        }
        if (!r.ok) throw new Error(((await r.json()).error || {}).message || "Write failed");
    } catch (e) {
        if (retry) return fbSet(path, obj, false);
        throw e;
    }
}

async function initSync() {
    var cached = JSON.parse(localStorage.getItem("_fbu") || "null");
    if (cached && cached.token) {
        currentUser = cached;
        syncId = currentUser.uid;
        docPath = "users/" + syncId + "/data/main";
        try { await fbLoadAll(); } catch (e) { setSyncIcon("error"); }
        startPolling();
    }
    if (typeof updateSyncUI === "function") updateSyncUI(currentUser);
}

async function fbSaveAll() {
    if (!getSyncId()) return;
    syncId = getSyncId();
    docPath = "users/" + syncId + "/data/main";

    var local = (await syncGet("shortcuts")) || [];
    var localBookmarks = (await syncGet("bookmarks")) || [];
    var localFolders = (await syncGet("bookmarkFolders")) || [];
    var customBg = (await syncGet("customBg")) || null;
    var localDeleted = {};
    try { localDeleted = JSON.parse(localStorage.getItem("_deleted") || "{}"); } catch (e) {}

    var doc = null;
    var remoteDeleted = {};
    try { doc = await fbGet(docPath); } catch (e) {}
    if (doc && doc._deleted) remoteDeleted = doc._deleted;

    var remote = doc && doc.shortcuts ? doc.shortcuts : [];
    var remoteBookmarks = doc && doc.bookmarks ? doc.bookmarks : [];
    var remoteFolders = doc && doc.bookmarkFolders ? doc.bookmarkFolders : [];

    var merged = mergeItems(local, remote, localDeleted, remoteDeleted);
    var mergedBookmarks = mergeItems(localBookmarks, remoteBookmarks, localDeleted, remoteDeleted);
    var mergedFolders = mergeItems(localFolders, remoteFolders, localDeleted, remoteDeleted);
    var mergedDeleted = getMergedTombstones(localDeleted, remoteDeleted);

    await syncSet({ shortcuts: merged, bookmarks: mergedBookmarks, bookmarkFolders: mergedFolders });
    localStorage.setItem("_deleted", JSON.stringify(mergedDeleted));

    try {
        await fbSet(docPath, {
            shortcuts: merged,
            bookmarks: mergedBookmarks,
            bookmarkFolders: mergedFolders,
            customBg: customBg,
            _deleted: mergedDeleted
        });
        setSyncIcon("synced");
    } catch (e) {
        setSyncIcon("error");
        return;
    }

    window.dispatchEvent(new CustomEvent("syncdataloaded"));
}

async function fbLoadAll() {
    if (!getSyncId()) return;
    syncId = getSyncId();
    docPath = "users/" + syncId + "/data/main";
    try {
        var d = await fbGet(docPath);
        if (!d) return;

        var local = (await syncGet("shortcuts")) || [];
        var localBookmarks = (await syncGet("bookmarks")) || [];
        var localFolders = (await syncGet("bookmarkFolders")) || [];
        var localDeleted = {};
        try { localDeleted = JSON.parse(localStorage.getItem("_deleted") || "{}"); } catch (e) {}
        var remoteDeleted = d._deleted || {};

        var merged = mergeItems(local, d.shortcuts || [], localDeleted, remoteDeleted);
        var mergedBookmarks = mergeItems(localBookmarks, d.bookmarks || [], localDeleted, remoteDeleted);
        var mergedFolders = mergeItems(localFolders, d.bookmarkFolders || [], localDeleted, remoteDeleted);
        var mergedDeleted = getMergedTombstones(localDeleted, remoteDeleted);

        await syncSet({ shortcuts: merged, bookmarks: mergedBookmarks, bookmarkFolders: mergedFolders });
        localStorage.setItem("_deleted", JSON.stringify(mergedDeleted));
        if (d.customBg) await syncSet({ customBg: d.customBg });
        setSyncIcon("synced");
        window.dispatchEvent(new CustomEvent("syncdataloaded"));
    } catch (e) {
        setSyncIcon("error");
    }
}

// === Auto sync ===
var autoSyncTimer = null;
function autoSync() {
    if (!getSyncId()) return;
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(function () {
        fbSaveAll().catch(function () {});
    }, 800);
}

// === Polling for remote changes ===
var pollInterval = null;
function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(function () {
        if (getSyncId()) {
            fbLoadAll().catch(function () {});
        }
    }, 10000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

// Sync when tab becomes visible
document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && getSyncId()) {
        fbLoadAll().catch(function () {});
    }
});

// === Icon & user ===
function setSyncIcon(state) {
    var btn = document.getElementById("sync-btn");
    if (!btn) return;
    btn.classList.remove("synced", "error");
    if (state === "synced") btn.classList.add("synced");
    else if (state === "error") btn.classList.add("error");
}

function getCurrentUser() {
    return currentUser;
}

initSync();
