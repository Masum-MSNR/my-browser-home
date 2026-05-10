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

    if (typeof updateSyncUI === "function") updateSyncUI(currentUser);
    return currentUser;
}

function signOut() {
    currentUser = null;
    syncId = null;
    docPath = null;
    localStorage.removeItem("_fbu");
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

function ensureSyncItem(item, pos) {
    if (!item) return null;
    if (!item.id) item.id = crypto.randomUUID();
    if (!item.updatedAt) item.updatedAt = Date.now();
    if (pos !== undefined) item.position = pos;
    if (item.position === undefined) item.position = 0;
    return item;
}

function isUrlSyncItem(item) {
    return !!(item && item.url);
}

function isFolderSyncItem(item) {
    return !!(item && item.name);
}

function compareSyncItems(a, b) {
    var ap = typeof a.position === "number" ? a.position : 0;
    var bp = typeof b.position === "number" ? b.position : 0;
    if (ap !== bp) return ap - bp;
    var au = a && a.updatedAt ? a.updatedAt : 0;
    var bu = b && b.updatedAt ? b.updatedAt : 0;
    if (au !== bu) return au - bu;
    var aid = a && a.id ? String(a.id) : "";
    var bid = b && b.id ? String(b.id) : "";
    if (aid < bid) return -1;
    if (aid > bid) return 1;
    return 0;
}

function getScopeKey(value) {
    return value === undefined || value === null ? "__root__" : String(value);
}

function getMergedDeleteMap(localDeleted, remoteDeleted) {
    var tombstones = {};
    if (localDeleted) {
        for (var k in localDeleted) {
            if (localDeleted.hasOwnProperty(k)) tombstones[k] = localDeleted[k];
        }
    }
    if (remoteDeleted) {
        for (var key in remoteDeleted) {
            if (remoteDeleted.hasOwnProperty(key)) {
                if (!tombstones[key] || remoteDeleted[key] > tombstones[key]) {
                    tombstones[key] = remoteDeleted[key];
                }
            }
        }
    }
    return tombstones;
}

function mergeLatestItems(local, remote, tombstones, isValidItem) {
    if (!Array.isArray(local)) local = [];
    if (!Array.isArray(remote)) remote = [];
    if (typeof isValidItem !== "function") isValidItem = isUrlSyncItem;

    var byId = {};
    for (var i = 0; i < local.length; i++) {
        var localItem = ensureSyncItem(local[i], i);
        if (!localItem || !isValidItem(localItem)) continue;
        if (tombstones[localItem.id] !== undefined) continue;
        byId[localItem.id] = localItem;
    }

    for (var j = 0; j < remote.length; j++) {
        var remoteItem = ensureSyncItem(remote[j]);
        if (!remoteItem || !isValidItem(remoteItem)) continue;
        if (tombstones[remoteItem.id] !== undefined) continue;
        var existing = byId[remoteItem.id];
        if (!existing || (remoteItem.updatedAt || 0) > (existing.updatedAt || 0)) {
            byId[remoteItem.id] = remoteItem;
        }
    }

    var merged = [];
    for (var id in byId) {
        if (byId.hasOwnProperty(id)) merged.push(byId[id]);
    }
    return merged;
}

function normalizeFlatPositions(items, isValidItem) {
    if (!Array.isArray(items)) items = [];
    if (typeof isValidItem !== "function") isValidItem = isUrlSyncItem;
    items.sort(compareSyncItems);
    var clean = [];
    for (var i = 0; i < items.length; i++) {
        if (!isValidItem(items[i])) continue;
        items[i].position = clean.length;
        clean.push(items[i]);
    }
    return clean;
}

function normalizeScopedPositions(items, scopeKeyFn, isValidItem) {
    if (!Array.isArray(items)) items = [];
    if (typeof isValidItem !== "function") isValidItem = isUrlSyncItem;
    if (typeof scopeKeyFn !== "function") scopeKeyFn = function () { return "__root__"; };

    var groups = {};
    var groupKeys = [];
    for (var i = 0; i < items.length; i++) {
        if (!isValidItem(items[i])) continue;
        var scopeKey = getScopeKey(scopeKeyFn(items[i]));
        if (!groups[scopeKey]) {
            groups[scopeKey] = [];
            groupKeys.push(scopeKey);
        }
        groups[scopeKey].push(items[i]);
    }

    groupKeys.sort(function (a, b) {
        if (a === b) return 0;
        if (a === "__root__") return -1;
        if (b === "__root__") return 1;
        return a < b ? -1 : 1;
    });

    var clean = [];
    for (var g = 0; g < groupKeys.length; g++) {
        var group = groups[groupKeys[g]];
        group.sort(compareSyncItems);
        for (var j = 0; j < group.length; j++) {
            group[j].position = j;
            clean.push(group[j]);
        }
    }
    return clean;
}

function mergeFlatItems(local, remote, localDeleted, remoteDeleted, isValidItem) {
    var tombstones = getMergedDeleteMap(localDeleted, remoteDeleted);
    return normalizeFlatPositions(mergeLatestItems(local, remote, tombstones, isValidItem), isValidItem);
}

function mergeScopedItems(local, remote, localDeleted, remoteDeleted, isValidItem, scopeKeyFn) {
    var tombstones = getMergedDeleteMap(localDeleted, remoteDeleted);
    return normalizeScopedPositions(mergeLatestItems(local, remote, tombstones, isValidItem), scopeKeyFn, isValidItem);
}

// Merge mail accounts. Mail items are keyed by email. Local order wins
// (so user reorder survives), with any new accounts from remote appended at
// the end (preserving their relative remote order).
function mergeMailList(local, remote) {
    if (!Array.isArray(local)) local = [];
    if (!Array.isArray(remote)) remote = [];
    var seen = {};
    var out = [];
    for (var i = 0; i < local.length; i++) {
        var li = local[i];
        if (li && li.email && !seen[li.email]) {
            seen[li.email] = true;
            out.push(li);
        }
    }
    for (var j = 0; j < remote.length; j++) {
        var rj = remote[j];
        if (rj && rj.email && !seen[rj.email]) {
            seen[rj.email] = true;
            out.push(rj);
        }
    }
    return out;
}

// Get merged tombstones (local + remote, keep latest, prune old)
var TOMBSTONE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getMergedTombstones(localDeleted, remoteDeleted) {
    var merged = {};
    var cutoff = Date.now() - TOMBSTONE_TTL;
    if (localDeleted) {
        for (var k in localDeleted) {
            if (localDeleted.hasOwnProperty(k) && localDeleted[k] > cutoff) {
                merged[k] = localDeleted[k];
            }
        }
    }
    if (remoteDeleted) {
        for (var k in remoteDeleted) {
            if (remoteDeleted.hasOwnProperty(k) && remoteDeleted[k] > cutoff) {
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
    var localMail = (await syncGet("mailShortcuts")) || [];
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
    var remoteMail = doc && doc.mailShortcuts ? doc.mailShortcuts : [];
    var remoteBg = doc && doc.customBg ? doc.customBg : null;

    var merged = mergeFlatItems(local, remote, localDeleted, remoteDeleted, isUrlSyncItem);
    var mergedBookmarks = mergeScopedItems(localBookmarks, remoteBookmarks, localDeleted, remoteDeleted, isUrlSyncItem, function (item) {
        return item && item.folderId;
    });
    var mergedFolders = mergeScopedItems(localFolders, remoteFolders, localDeleted, remoteDeleted, isFolderSyncItem, function (item) {
        return item && item.parentId;
    });
    var mergedMail = mergeMailList(localMail, remoteMail);
    var mergedDeleted = getMergedTombstones(localDeleted, remoteDeleted);
    var mergedBg = customBg || remoteBg;

    await syncSet({
        shortcuts: merged,
        bookmarks: mergedBookmarks,
        bookmarkFolders: mergedFolders,
        mailShortcuts: mergedMail
    });
    if (mergedBg) await syncSet({ customBg: mergedBg });
    localStorage.setItem("_deleted", JSON.stringify(mergedDeleted));

    // Skip Firestore write if nothing changed since last write
    var writeHash = JSON.stringify({ s: merged, b: mergedBookmarks, f: mergedFolders, m: mergedMail, bg: mergedBg, d: mergedDeleted });
    if (writeHash === lastWrittenHash) {
        setSyncIcon("synced");
        return;
    }

    try {
        await fbSet(docPath, {
            shortcuts: merged,
            bookmarks: mergedBookmarks,
            bookmarkFolders: mergedFolders,
            mailShortcuts: mergedMail,
            customBg: mergedBg,
            _deleted: mergedDeleted
        });
        lastWrittenHash = writeHash;
        setSyncIcon("synced");
    } catch (e) {
        setSyncIcon("error");
        return;
    }

    var localBefore = JSON.stringify({ s: local, b: localBookmarks, f: localFolders, m: localMail, d: localDeleted });
    var mergedAfter = JSON.stringify({ s: merged, b: mergedBookmarks, f: mergedFolders, m: mergedMail, d: mergedDeleted });
    var uiChanged = localBefore !== mergedAfter ||
        JSON.stringify({ s: remote, b: remoteBookmarks, f: remoteFolders, m: remoteMail }) !==
        JSON.stringify({ s: local, b: localBookmarks, f: localFolders, m: localMail });

    if (uiChanged) {
        window.dispatchEvent(new CustomEvent("syncdataloaded"));
    }
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
        var localMail = (await syncGet("mailShortcuts")) || [];
        var localDeleted = {};
        try { localDeleted = JSON.parse(localStorage.getItem("_deleted") || "{}"); } catch (e) {}
        var remoteDeleted = d._deleted || {};

        var merged = mergeFlatItems(local, d.shortcuts || [], localDeleted, remoteDeleted, isUrlSyncItem);
        var mergedBookmarks = mergeScopedItems(localBookmarks, d.bookmarks || [], localDeleted, remoteDeleted, isUrlSyncItem, function (item) {
            return item && item.folderId;
        });
        var mergedFolders = mergeScopedItems(localFolders, d.bookmarkFolders || [], localDeleted, remoteDeleted, isFolderSyncItem, function (item) {
            return item && item.parentId;
        });
        var mergedMail = mergeMailList(localMail, d.mailShortcuts || []);
        var mergedDeleted = getMergedTombstones(localDeleted, remoteDeleted);

        // Only update UI if data actually changed
        var localBefore = JSON.stringify({ s: local, b: localBookmarks, f: localFolders, m: localMail, d: localDeleted });
        var mergedAfter = JSON.stringify({ s: merged, b: mergedBookmarks, f: mergedFolders, m: mergedMail, d: mergedDeleted });
        if (localBefore === mergedAfter) return;

        await syncSet({
            shortcuts: merged,
            bookmarks: mergedBookmarks,
            bookmarkFolders: mergedFolders,
            mailShortcuts: mergedMail
        });
        localStorage.setItem("_deleted", JSON.stringify(mergedDeleted));
        if (d.customBg) await syncSet({ customBg: d.customBg });
        setSyncIcon("synced");
        window.dispatchEvent(new CustomEvent("syncdataloaded"));
    } catch (e) {
        setSyncIcon("error");
    }
}

// === Sync lock: prevent concurrent save/load ===
var syncBusy = false;
var lastWrittenHash = "";

// === Auto sync ===
var autoSyncTimer = null;
var autoSyncRetries = 0;
var AUTO_SAVE_DEBOUNCE_MS = 2000;   // push 2s after last change (was 5s)
var pendingChanges = false;

function autoSync() {
    if (!getSyncId()) return;
    pendingChanges = true;
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(function () {
        doAutoSave();
    }, AUTO_SAVE_DEBOUNCE_MS);
}

async function doAutoSave() {
    if (syncBusy) {
        // A pull is in flight; retry shortly so we don't drop the change.
        autoSyncTimer = setTimeout(function () { doAutoSave(); }, 500);
        return;
    }
    if (!pendingChanges) return;
    syncBusy = true;
    pendingChanges = false;
    try {
        await fbSaveAll();
        autoSyncRetries = 0;
    } catch (e) {
        autoSyncRetries++;
        if (autoSyncRetries <= 2) {
            setTimeout(function () {
                syncBusy = false;
                doAutoSave();
            }, autoSyncRetries * 3000);
            return;
        }
        autoSyncRetries = 0;
    }
    syncBusy = false;
}

// === Load remote changes on tab open ===
async function pullFromRemote() {
    if (!getSyncId() || syncBusy) return;
    syncBusy = true;
    try { await fbLoadAll(); } catch (e) {}
    syncBusy = false;
}

// Pull on focus (no throttling — visibility changes are user-driven and
// infrequent). A periodic pull handles the case where the tab stays open.
document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !getSyncId()) return;
    pullFromRemote();
});

// Periodic pull while tab is visible & signed in (every 30s).
var PERIODIC_PULL_MS = 30000;
setInterval(function () {
    if (document.visibilityState === "visible" && getSyncId()) {
        pullFromRemote();
    }
}, PERIODIC_PULL_MS);

// Cross-tab / cross-instance refresh: when chrome.storage.local changes
// (e.g. another tab in the same browser saved a shortcut, or the
// extension's background script updated something), let listeners
// rerender. Debounced so a burst of writes triggers one render.
var _onChangedTimer = null;
var _SYNCED_KEYS = ["shortcuts", "bookmarks", "bookmarkFolders", "mailShortcuts", "customBg"];
if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== "local") return;
        var relevant = false;
        for (var k in changes) {
            if (_SYNCED_KEYS.indexOf(k) !== -1) { relevant = true; break; }
        }
        if (!relevant) return;
        clearTimeout(_onChangedTimer);
        _onChangedTimer = setTimeout(function () {
            window.dispatchEvent(new CustomEvent("syncdataloaded"));
        }, 200);
    });
}

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
