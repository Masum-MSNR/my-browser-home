var FB_KEY = "AIzaSyD-qPlTDANCWj0pGvM5OhnGwJ15xvY233E";
var FB_PROJECT = "my-browser-tab";
var FB_BASE = "https://firestore.googleapis.com/v1/projects/" + FB_PROJECT + "/databases/(default)/documents";
var FB_IDTK = "https://identitytoolkit.googleapis.com/v1";
var FB_WEB_CONFIG = {
    apiKey: FB_KEY,
    authDomain: FB_PROJECT + ".firebaseapp.com",
    projectId: FB_PROJECT
};

if (typeof window !== "undefined" && !window.__APP_DEBUG__ && typeof firebase !== "undefined" && firebase && firebase.firestore && typeof firebase.firestore.setLogLevel === "function") {
    try {
        firebase.firestore.setLogLevel("silent");
    } catch (e) {}
}

var currentUser = null;
var syncInitialized = false;
var initialSyncPromise = null;
var syncDirty = {};
var lastSeenRemoteRevision = null;
var realtimeAuth = null;
var realtimeDb = null;
var realtimeDocUnsubscribe = null;
var realtimeAuthObserver = null;
var realtimeListenerUid = null;
var pendingRemoteDoc = null;

function getDirtySyncKeys() {
    var keys = [];
    for (var key in syncDirty) {
        if (syncDirty.hasOwnProperty(key)) keys.push(key);
    }
    keys.sort();
    return keys;
}

function markSyncDirty(key) {
    if (!syncInitialized && localStorage.getItem("_fbu")) {
        if (key && typeof logSyncEvent === "function") {
            logSyncEvent("local", "dirty-skipped", { key: key, reason: "initial-sync-pending" });
        }
        return;
    }
    if (key) syncDirty[key] = Date.now();
    if (key && typeof logSyncEvent === "function") {
        logSyncEvent("local", "dirty-marked", { key: key });
    }
}

function isSyncDirty(key) {
    return !!syncDirty[key];
}

function clearSyncDirty(keys) {
    if (!Array.isArray(keys)) return;
    for (var i = 0; i < keys.length; i++) {
        delete syncDirty[keys[i]];
    }
}

async function waitForSyncReady() {
    if (initialSyncPromise && !syncInitialized) {
        try { await initialSyncPromise; } catch (e) {}
    }
    return syncInitialized;
}

function getSyncId() {
    return currentUser ? currentUser.uid : null;
}

function cloneSyncValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
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

function ensureRealtimeClient() {
    if (typeof firebase === "undefined" || !firebase || typeof firebase.initializeApp !== "function") return false;
    if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(FB_WEB_CONFIG);
    }
    realtimeAuth = firebase.auth();
    realtimeDb = firebase.firestore();
    return !!(realtimeAuth && realtimeDb);
}

function hasRealtimeListenerActive() {
    return !!realtimeDocUnsubscribe;
}

function clearPendingRemoteDoc() {
    pendingRemoteDoc = null;
}

function isSameOrOlderRevision(revision, referenceRevision) {
    if (revision === null || revision === undefined || referenceRevision === null || referenceRevision === undefined) return false;
    if (revision === referenceRevision) return true;

    var numericRevision = Number(revision);
    var numericReference = Number(referenceRevision);
    if (!Number.isNaN(numericRevision) && !Number.isNaN(numericReference)) {
        return numericRevision < numericReference;
    }

    if (typeof revision === "string" && typeof referenceRevision === "string") {
        return revision < referenceRevision;
    }

    return false;
}

function stopRealtimeDocumentListener() {
    if (realtimeDocUnsubscribe) {
        try { realtimeDocUnsubscribe(); } catch (e) {}
    }
    realtimeDocUnsubscribe = null;
    realtimeListenerUid = null;
    clearPendingRemoteDoc();
}

function queuePendingRemoteDoc(data, uid, revision, reason) {
    pendingRemoteDoc = {
        data: cloneSyncValue(data),
        uid: uid,
        revision: revision
    };
    logSyncEvent("listen", "queued", { uid: uid, revision: revision, reason: reason });
}

async function applyRemoteDocData(d, source) {
    source = source || "pull";
    if (!d) {
        lastSeenRemoteRevision = null;
        logSyncEvent(source, "empty", { docPath: docPath });
        return false;
    }

    lastSeenRemoteRevision = getRemoteRevisionFromDoc(d);

    var local = (await syncGet("shortcuts")) || [];
    var localBookmarks = (await syncGet("bookmarks")) || [];
    var localFolders = (await syncGet("bookmarkFolders")) || [];
    var localBg = await syncGet("customBg");
    if (localBg === undefined) localBg = null;

    var localDeleted = {};
    try { localDeleted = JSON.parse(localStorage.getItem("_deleted") || "{}"); } catch (e) {}
    var remoteDeleted = d._deleted || {};
    var remoteShortcuts = d.shortcuts || [];
    var remoteBookmarks = d.bookmarks || [];
    var remoteFolders = d.bookmarkFolders || [];
    var remoteBg = Object.prototype.hasOwnProperty.call(d, "customBg") ? d.customBg : null;

    var localForMerge = isSyncDirty("shortcuts") ? local : remoteShortcuts;
    var localBookmarksForMerge = isSyncDirty("bookmarks") ? localBookmarks : remoteBookmarks;
    var localFoldersForMerge = isSyncDirty("bookmarkFolders") ? localFolders : remoteFolders;
    var deletedForMerge = (isSyncDirty("shortcuts") || isSyncDirty("bookmarks") || isSyncDirty("bookmarkFolders")) ? localDeleted : {};

    logSyncEvent(source, "start", {
        docPath: docPath,
        local: summarizeSyncState(local, localBookmarks, localFolders, null, localBg),
        remote: summarizeSyncState(remoteShortcuts, remoteBookmarks, remoteFolders, null, remoteBg)
    });

    var merged = mergeFlatItems(localForMerge, remoteShortcuts, deletedForMerge, remoteDeleted, isUrlSyncItem);
    var mergedBookmarks = mergeScopedItems(localBookmarksForMerge, remoteBookmarks, deletedForMerge, remoteDeleted, isUrlSyncItem, function (item) {
        return item && item.folderId;
    });
    var mergedFolders = mergeScopedItems(localFoldersForMerge, remoteFolders, deletedForMerge, remoteDeleted, isFolderSyncItem, function (item) {
        return item && item.parentId;
    });
    var mergedDeleted = getMergedTombstones(localDeleted, remoteDeleted);
    var mergedBg = isSyncDirty("customBg") ? localBg : remoteBg;
    var mergedSummary = summarizeSyncState(merged, mergedBookmarks, mergedFolders, null, mergedBg);

    var localBefore = JSON.stringify({ s: local, b: localBookmarks, f: localFolders, bg: localBg, d: localDeleted });
    var mergedAfter = JSON.stringify({ s: merged, b: mergedBookmarks, f: mergedFolders, bg: mergedBg, d: mergedDeleted });
    if (localBefore === mergedAfter) {
        logSyncEvent(source, "noop", { docPath: docPath, merged: mergedSummary, reason: "already-current" });
        clearSyncDirty(["shortcuts", "bookmarks", "bookmarkFolders", "customBg"]);
        setSyncIcon("synced");
        return false;
    }

    await syncSet({
        shortcuts: merged,
        bookmarks: mergedBookmarks,
        bookmarkFolders: mergedFolders,
        customBg: mergedBg
    });
    localStorage.setItem("_deleted", JSON.stringify(mergedDeleted));
    logSyncEvent(source, "applied", { docPath: docPath, merged: mergedSummary, deleted: Object.keys(mergedDeleted).sort() });
    clearSyncDirty(["shortcuts", "bookmarks", "bookmarkFolders", "customBg"]);
    setSyncIcon("synced");
    window.dispatchEvent(new CustomEvent("syncdataloaded"));
    return true;
}

async function flushPendingRemoteDoc() {
    if (!pendingRemoteDoc || syncBusy || hasDirtySyncState()) return;
    var queued = pendingRemoteDoc;
    pendingRemoteDoc = null;
    if (isSameOrOlderRevision(queued.revision, lastSeenRemoteRevision)) {
        logSyncEvent("listen", "noop", { uid: queued.uid, revision: queued.revision, reason: "stale-queued-revision" });
        return;
    }

    syncBusy = true;
    try {
        await applyRemoteDocData(queued.data, "listen");
    } catch (e) {
        logSyncEvent("listen", "flush-error", {
            uid: queued.uid,
            message: e && e.message ? e.message : String(e)
        });
        setSyncIcon("error");
    }
    syncBusy = false;

    if (pendingRemoteDoc && !hasDirtySyncState()) {
        await flushPendingRemoteDoc();
    }
}

async function handleRealtimeSnapshot(snapshot, uid) {
    if (!currentUser || uid !== currentUser.uid) return;
    if (!snapshot || !snapshot.exists) {
        lastSeenRemoteRevision = null;
        logSyncEvent("listen", "empty", { uid: uid, docPath: "users/" + uid + "/data/main" });
        return;
    }

    var data = snapshot.data() || {};
    var revision = getRemoteRevisionFromDoc(data);
    var metadata = snapshot.metadata || {};

    logSyncEvent("listen", "snapshot", {
        uid: uid,
        revision: revision,
        fromCache: !!metadata.fromCache,
        pendingWrites: !!metadata.hasPendingWrites
    });

    if (revision !== null && revision === lastSeenRemoteRevision) {
        logSyncEvent("listen", "noop", { uid: uid, revision: revision, reason: "same-revision" });
        return;
    }
    if (syncBusy || hasDirtySyncState()) {
        queuePendingRemoteDoc(data, uid, revision, syncBusy ? "sync-busy" : "local-dirty");
        return;
    }

    syncBusy = true;
    try {
        await applyRemoteDocData(data, "listen");
    } catch (e) {
        logSyncEvent("listen", "error", { uid: uid, message: e && e.message ? e.message : String(e) });
        setSyncIcon("error");
    }
    syncBusy = false;
    await flushPendingRemoteDoc();
}

function attachRealtimeDocumentListener(uid) {
    if (!ensureRealtimeClient() || !currentUser || !uid || uid !== currentUser.uid) return false;
    if (realtimeListenerUid === uid && realtimeDocUnsubscribe) return true;

    stopRealtimeDocumentListener();
    realtimeListenerUid = uid;
    realtimeDocUnsubscribe = realtimeDb.doc("users/" + uid + "/data/main").onSnapshot(function (snapshot) {
        handleRealtimeSnapshot(snapshot, uid).catch(function (error) {
            logSyncEvent("listen", "error", { uid: uid, message: error && error.message ? error.message : String(error) });
            setSyncIcon("error");
        });
    }, function (error) {
        logSyncEvent("listen", "error", { uid: uid, message: error && error.message ? error.message : String(error) });
        stopRealtimeDocumentListener();
        setSyncIcon("error");
    });
    logSyncEvent("listen", "attached", { uid: uid });
    return true;
}

function setupRealtimeSync() {
    if (!ensureRealtimeClient()) return false;
    if (realtimeAuthObserver) return true;

    realtimeAuthObserver = realtimeAuth.onAuthStateChanged(function (user) {
        if (!currentUser || !user) {
            stopRealtimeDocumentListener();
            return;
        }
        if (user.uid !== currentUser.uid) {
            logSyncEvent("listen", "auth-mismatch", { expectedUid: currentUser.uid, actualUid: user.uid });
            stopRealtimeDocumentListener();
            return;
        }
        attachRealtimeDocumentListener(user.uid);
    });

    if (realtimeAuth.currentUser && currentUser && realtimeAuth.currentUser.uid === currentUser.uid) {
        attachRealtimeDocumentListener(realtimeAuth.currentUser.uid);
    }
    return true;
}

async function ensureRealtimeAuthSignedIn(googleIdToken, reason) {
    if (!currentUser || !googleIdToken || !ensureRealtimeClient()) return false;
    setupRealtimeSync();

    if (realtimeAuth.currentUser && realtimeAuth.currentUser.uid === currentUser.uid) {
        return true;
    }

    var credential = firebase.auth.GoogleAuthProvider.credential(googleIdToken);
    var result = await realtimeAuth.signInWithCredential(credential);
    var user = result && result.user ? result.user : realtimeAuth.currentUser;

    if (!user || user.uid !== currentUser.uid) {
        try { await realtimeAuth.signOut(); } catch (e) {}
        throw new Error("Realtime auth user mismatch");
    }

    logSyncEvent("listen", "auth-ready", { uid: user.uid, reason: reason || "sign-in" });
    return true;
}

async function tryRestoreRealtimeAuth() {
    if (!currentUser || !ensureRealtimeClient()) return false;
    setupRealtimeSync();

    if (realtimeAuth.currentUser && realtimeAuth.currentUser.uid === currentUser.uid) {
        return true;
    }

    try {
        var response = await sendToServiceWorker({ type: "GET_AUTH_TOKEN", interactive: false, prompt: "none" }, 1);
        if (!response || response.error || !response.idToken) {
            logSyncEvent("listen", "auth-restore-skip", {
                reason: response && response.error ? response.error : "no-token"
            });
            return false;
        }
        await ensureRealtimeAuthSignedIn(response.idToken, "restore");
        return true;
    } catch (e) {
        logSyncEvent("listen", "auth-restore-skip", { message: e && e.message ? e.message : String(e) });
        return false;
    }
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
    try { await ensureRealtimeAuthSignedIn(googleIdToken, "sign-in"); } catch (e) {
        logSyncEvent("listen", "auth-error", { message: e && e.message ? e.message : String(e) });
    }

    if (typeof updateSyncUI === "function") updateSyncUI(currentUser);
    return currentUser;
}

function signOut() {
    stopRealtimeDocumentListener();
    lastSeenRemoteRevision = null;
    currentUser = null;
    syncId = null;
    docPath = null;
    localStorage.removeItem("_fbu");
    chrome.runtime.sendMessage({ type: "CLEAR_AUTH_TOKEN" }, function () {});
    if (realtimeAuth && realtimeAuth.currentUser && typeof realtimeAuth.signOut === "function") {
        realtimeAuth.signOut().catch(function (e) {
            logSyncEvent("listen", "signout-error", { message: e && e.message ? e.message : String(e) });
        });
    }
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
    if (item.position === undefined) item.position = pos !== undefined ? pos : 0;
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

// logSyncEvent is intentionally a no-op since 1.3.0. The summary helpers
// below short-circuit to null so callers don't pay the cost of building
// payloads that nobody reads. Re-enable by replacing this stub with a
// real logger (and restoring the summarizers).
function summarizeSyncItems() { return null; }

function summarizeSyncState() { return null; }

function logSyncEvent() { return; }

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

// Get merged tombstones (local + remote, keep latest, prune old)
var TOMBSTONE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// NOTE: syncId/docPath are declared once above near ensureSyncItem; the
// duplicate `var` declarations that used to sit here were removed in 1.3.0.

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

async function fbGetMasked(path, fieldPaths, retry) {
    if (retry === undefined) retry = true;
    var suffix = "";
    if (Array.isArray(fieldPaths) && fieldPaths.length > 0) {
        var parts = [];
        for (var i = 0; i < fieldPaths.length; i++) {
            parts.push("mask.fieldPaths=" + encodeURIComponent(fieldPaths[i]));
        }
        suffix = "?" + parts.join("&");
    }
    try {
        var r = await fetch(FB_BASE + "/" + path + suffix, {
            headers: { Authorization: "Bearer " + (await fbToken()) }
        });
        if (r.status === 404) return null;
        if ((r.status === 401 || r.status === 403) && retry) {
            await refreshToken();
            return fbGetMasked(path, fieldPaths, false);
        }
        if (!r.ok) throw new Error(((await r.json()).error || {}).message || "Read failed");
        return await r.json();
    } catch (e) {
        if (retry) return fbGetMasked(path, fieldPaths, false);
        throw e;
    }
}

function getRemoteRevisionFromDoc(doc) {
    return doc && doc._syncMeta && doc._syncMeta.rev ? doc._syncMeta.rev : null;
}

function hasDirtySyncState() {
    return getDirtySyncKeys().length > 0;
}

async function probeRemoteRevision() {
    if (!getSyncId()) return { changed: false, revision: null, exists: false, reason: "signed-out" };
    syncId = getSyncId();
    docPath = "users/" + syncId + "/data/main";
    var rawDoc = await fbGetMasked(docPath, ["_syncMeta"]);
    if (!rawDoc) {
        return { changed: lastSeenRemoteRevision !== null, revision: null, exists: false, reason: "missing" };
    }
    var revision = rawDoc.fields && rawDoc.fields._syncMeta ? um(rawDoc.fields._syncMeta).rev : (rawDoc.updateTime || rawDoc.createTime || null);
    if (!revision) {
        return { changed: true, revision: null, exists: true, reason: "unknown-revision" };
    }
    return {
        changed: revision !== lastSeenRemoteRevision,
        revision: revision,
        exists: true,
        reason: revision !== lastSeenRemoteRevision ? "revision-changed" : "revision-unchanged"
    };
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
    if (initialSyncPromise) return initialSyncPromise;
    initialSyncPromise = (async function () {
    var cached = JSON.parse(localStorage.getItem("_fbu") || "null");
    if (cached && cached.token) {
        currentUser = cached;
        syncId = currentUser.uid;
        docPath = "users/" + syncId + "/data/main";
        try { await fbLoadAll(); } catch (e) { setSyncIcon("error"); }
    }
    syncInitialized = true;
    if (typeof updateSyncUI === "function") updateSyncUI(currentUser);
    if (currentUser) {
        setupRealtimeSync();
        tryRestoreRealtimeAuth();
    }
    })();
    return initialSyncPromise;
}

async function fbSaveAll() {
    if (!getSyncId()) return;
    syncId = getSyncId();
    docPath = "users/" + syncId + "/data/main";

    var local = (await syncGet("shortcuts")) || [];
    var localBookmarks = (await syncGet("bookmarks")) || [];
    var localFolders = (await syncGet("bookmarkFolders")) || [];
    var customBg = await syncGet("customBg");
    if (customBg === undefined) customBg = null;
    var localDeleted = {};
    try { localDeleted = JSON.parse(localStorage.getItem("_deleted") || "{}"); } catch (e) {}

    var doc = null;
    var remoteDeleted = {};
    try { doc = await fbGet(docPath); } catch (e) {}
    if (doc && doc._deleted) remoteDeleted = doc._deleted;

    var remote = doc && doc.shortcuts ? doc.shortcuts : [];
    var remoteBookmarks = doc && doc.bookmarks ? doc.bookmarks : [];
    var remoteFolders = doc && doc.bookmarkFolders ? doc.bookmarkFolders : [];
    var remoteBg = doc && Object.prototype.hasOwnProperty.call(doc, "customBg") ? doc.customBg : null;

    logSyncEvent("push", "start", {
        docPath: docPath,
        local: summarizeSyncState(local, localBookmarks, localFolders, null, customBg),
        remote: summarizeSyncState(remote, remoteBookmarks, remoteFolders, null, remoteBg)
    });

    var localForMerge = isSyncDirty("shortcuts") ? local : remote;
    var localBookmarksForMerge = isSyncDirty("bookmarks") ? localBookmarks : remoteBookmarks;
    var localFoldersForMerge = isSyncDirty("bookmarkFolders") ? localFolders : remoteFolders;
    var deletedForMerge = (isSyncDirty("shortcuts") || isSyncDirty("bookmarks") || isSyncDirty("bookmarkFolders")) ? localDeleted : {};

    var merged = mergeFlatItems(localForMerge, remote, deletedForMerge, remoteDeleted, isUrlSyncItem);
    var mergedBookmarks = mergeScopedItems(localBookmarksForMerge, remoteBookmarks, deletedForMerge, remoteDeleted, isUrlSyncItem, function (item) {
        return item && item.folderId;
    });
    var mergedFolders = mergeScopedItems(localFoldersForMerge, remoteFolders, deletedForMerge, remoteDeleted, isFolderSyncItem, function (item) {
        return item && item.parentId;
    });
    var mergedDeleted = getMergedTombstones(localDeleted, remoteDeleted);
    var mergedBg = isSyncDirty("customBg") ? customBg : remoteBg;
    var writeRevision = Date.now();
    var mergedSummary = summarizeSyncState(merged, mergedBookmarks, mergedFolders, null, mergedBg);

    await syncSet({
        shortcuts: merged,
        bookmarks: mergedBookmarks,
        bookmarkFolders: mergedFolders,
        customBg: mergedBg
    });
    localStorage.setItem("_deleted", JSON.stringify(mergedDeleted));

    // Skip Firestore write if nothing changed since last write
    var writeHash = JSON.stringify({ s: merged, b: mergedBookmarks, f: mergedFolders, bg: mergedBg, d: mergedDeleted });
    if (writeHash === lastWrittenHash) {
        logSyncEvent("push", "noop", { docPath: docPath, merged: mergedSummary, reason: "same-write-hash" });
        clearSyncDirty(["shortcuts", "bookmarks", "bookmarkFolders", "customBg"]);
        setSyncIcon("synced");
        return;
    }

    try {
        await fbSet(docPath, {
            shortcuts: merged,
            bookmarks: mergedBookmarks,
            bookmarkFolders: mergedFolders,
            customBg: mergedBg,
            _deleted: mergedDeleted,
            _syncMeta: {
                rev: writeRevision
            }
        });
        lastWrittenHash = writeHash;
        lastSeenRemoteRevision = writeRevision;
        logSyncEvent("push", "success", { docPath: docPath, merged: mergedSummary, deleted: Object.keys(mergedDeleted).sort() });
        clearSyncDirty(["shortcuts", "bookmarks", "bookmarkFolders", "customBg"]);
        setSyncIcon("synced");
    } catch (e) {
        logSyncEvent("push", "error", {
            docPath: docPath,
            message: e && e.message ? e.message : String(e),
            merged: mergedSummary
        });
        setSyncIcon("error");
        return;
    }

    var localBefore = JSON.stringify({ s: local, b: localBookmarks, f: localFolders, bg: customBg, d: localDeleted });
    var mergedAfter = JSON.stringify({ s: merged, b: mergedBookmarks, f: mergedFolders, bg: mergedBg, d: mergedDeleted });
    var uiChanged = localBefore !== mergedAfter ||
        JSON.stringify({ s: remote, b: remoteBookmarks, f: remoteFolders, bg: remoteBg }) !==
        JSON.stringify({ s: local, b: localBookmarks, f: localFolders, bg: customBg });

    if (uiChanged) {
        window.dispatchEvent(new CustomEvent("syncdataloaded"));
    }
}

async function fbLoadAll() {
    if (!getSyncId()) return;
    syncId = getSyncId();
    docPath = "users/" + syncId + "/data/main";
    try {
        await applyRemoteDocData(await fbGet(docPath), "pull");
    } catch (e) {
        logSyncEvent("pull", "error", { docPath: docPath, message: e && e.message ? e.message : String(e) });
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
    if (!syncInitialized) {
        if (initialSyncPromise) {
            try { await initialSyncPromise; } catch (e) {}
        }
        if (!syncInitialized) {
            autoSyncTimer = setTimeout(function () { doAutoSave(); }, 500);
            return;
        }
    }
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
            // Release the lock during back-off so the realtime listener can
            // still apply remote updates that arrive while we wait.
            syncBusy = false;
            setTimeout(function () {
                doAutoSave();
            }, autoSyncRetries * 3000);
            return;
        }
        autoSyncRetries = 0;
    }
    syncBusy = false;
    await flushPendingRemoteDoc();
}

// === Load remote changes on tab open ===
async function pullFromRemote() {
    if (!getSyncId() || syncBusy) return;
    if (hasRealtimeListenerActive()) {
        logSyncEvent("pull", "skip", { reason: "listener-active" });
        return;
    }
    if (hasDirtySyncState()) {
        logSyncEvent("pull", "skip", { reason: "local-dirty" });
        return;
    }
    syncBusy = true;
    try {
        var probe = await probeRemoteRevision();
        logSyncEvent("pull", "probe", probe);
        if (probe.changed) {
            await fbLoadAll();
            if (probe.revision) lastSeenRemoteRevision = probe.revision;
        }
    } catch (e) {
        logSyncEvent("pull", "probe-error", { message: e && e.message ? e.message : String(e) });
    }
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
var _SYNCED_KEYS = ["shortcuts", "bookmarks", "bookmarkFolders", "customBg"];
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
