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
var SYNC_COLLECTION_KEYS = ["shortcuts", "bookmarks", "bookmarkFolders"];
var SYNC_DIRTY_STORAGE_KEY = "_syncDirtyState";
var SYNC_TOMBSTONE_STORAGE_KEY = "_syncDeletedState";

function getPersistedSyncDirtyMap() {
    try {
        var raw = localStorage.getItem(SYNC_DIRTY_STORAGE_KEY);
        var parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        return {};
    }
}

function setPersistedSyncDirtyMap(map) {
    localStorage.setItem(SYNC_DIRTY_STORAGE_KEY, JSON.stringify(map || {}));
}

function createEmptySyncTombstoneState() {
    return {
        shortcuts: {},
        bookmarks: {},
        bookmarkFolders: {}
    };
}

function normalizeSyncTombstoneState(state) {
    var normalized = createEmptySyncTombstoneState();
    if (!state || typeof state !== "object") return normalized;
    for (var i = 0; i < SYNC_COLLECTION_KEYS.length; i++) {
        var collectionKey = SYNC_COLLECTION_KEYS[i];
        var source = state[collectionKey];
        if (!source || typeof source !== "object") continue;
        for (var key in source) {
            if (!source.hasOwnProperty(key)) continue;
            normalized[collectionKey][key] = source[key];
        }
    }
    return normalized;
}

function getDeletedSyncTombstoneState() {
    try {
        var parsed = JSON.parse(localStorage.getItem(SYNC_TOMBSTONE_STORAGE_KEY) || "null");
        if (parsed && typeof parsed === "object") {
            return normalizeSyncTombstoneState(parsed);
        }
    } catch (e) {}

    try {
        var legacyParsed = JSON.parse(localStorage.getItem("_deleted") || "{}");
        if (legacyParsed && typeof legacyParsed === "object") {
            return {
                shortcuts: cloneSyncValue(legacyParsed),
                bookmarks: cloneSyncValue(legacyParsed),
                bookmarkFolders: cloneSyncValue(legacyParsed)
            };
        }
    } catch (e) {
        return createEmptySyncTombstoneState();
    }
    return createEmptySyncTombstoneState();
}

function getDeletedSyncTombstones(collectionKey) {
    var state = getDeletedSyncTombstoneState();
    if (collectionKey) return state[collectionKey] || {};
    return getMergedDeleteMap(getMergedDeleteMap(state.shortcuts, state.bookmarks), state.bookmarkFolders);
}

function setDeletedSyncTombstones(collectionKeyOrState, tombstones) {
    var nextState = getDeletedSyncTombstoneState();
    if (typeof collectionKeyOrState === "string") {
        nextState[collectionKeyOrState] = tombstones || {};
    } else {
        nextState = normalizeSyncTombstoneState(collectionKeyOrState);
    }
    localStorage.setItem(SYNC_TOMBSTONE_STORAGE_KEY, JSON.stringify(nextState));
    localStorage.setItem("_deleted", JSON.stringify(getDeletedSyncTombstones()));
}

function addDeletedSyncTombstones(collectionKey, ids, timestamp) {
    if (!collectionKey || !Array.isArray(ids) || ids.length === 0) return;
    var nextState = getDeletedSyncTombstoneState();
    if (!nextState[collectionKey]) nextState[collectionKey] = {};
    var now = timestamp || Date.now();
    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (!id) continue;
        if (!nextState[collectionKey][id] || nextState[collectionKey][id] < now) {
            nextState[collectionKey][id] = now;
        }
    }
    setDeletedSyncTombstones(nextState);
}

function getDirtySyncKeys() {
    var keys = [];
    var seen = {};
    for (var key in syncDirty) {
        if (syncDirty.hasOwnProperty(key) && !seen[key]) {
            keys.push(key);
            seen[key] = true;
        }
    }
    var persisted = getPersistedSyncDirtyMap();
    for (var persistedKey in persisted) {
        if (persisted.hasOwnProperty(persistedKey) && !seen[persistedKey]) {
            keys.push(persistedKey);
            seen[persistedKey] = true;
        }
    }
    keys.sort();
    return keys;
}

function markSyncDirty(key) {
    if (key) {
        var now = Date.now();
        syncDirty[key] = now;
        var persisted = getPersistedSyncDirtyMap();
        persisted[key] = now;
        setPersistedSyncDirtyMap(persisted);
    }
    if (key && typeof logSyncEvent === "function") {
        logSyncEvent("local", "dirty-marked", { key: key });
    }
}

function isSyncDirty(key) {
    if (syncDirty[key]) return true;
    return !!getPersistedSyncDirtyMap()[key];
}

function clearSyncDirty(keys) {
    if (!Array.isArray(keys)) return;
    var persisted = getPersistedSyncDirtyMap();
    for (var i = 0; i < keys.length; i++) {
        delete syncDirty[keys[i]];
        delete persisted[keys[i]];
    }
    setPersistedSyncDirtyMap(persisted);
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

    var localDeleted = getDeletedSyncTombstones();
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
    var uiRefresh = buildSyncUiRefreshDetail({
        shortcuts: local,
        bookmarks: localBookmarks,
        bookmarkFolders: localFolders,
        customBg: localBg
    }, {
        shortcuts: merged,
        bookmarks: mergedBookmarks,
        bookmarkFolders: mergedFolders,
        customBg: mergedBg
    });
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
    setDeletedSyncTombstones({
        shortcuts: mergedDeleted,
        bookmarks: mergedDeleted,
        bookmarkFolders: mergedDeleted
    });
    logSyncEvent(source, "applied", { docPath: docPath, merged: mergedSummary, deleted: Object.keys(mergedDeleted).sort() });
    clearSyncDirty(["shortcuts", "bookmarks", "bookmarkFolders", "customBg"]);
    setSyncIcon("synced");
    dispatchSyncUiRefresh(uiRefresh);
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
