async function initSync() {
    if (initialSyncPromise) return initialSyncPromise;
    initialSyncPromise = (async function () {
    var cached = JSON.parse(localStorage.getItem("_fbu") || "null");
    if (cached && cached.token) {
        currentUser = cached;
        syncId = currentUser.uid;
        docPath = "users/" + syncId + "/data/main";
    }
    syncInitialized = true;
    if (typeof updateSyncUI === "function") updateSyncUI(currentUser);
    })();
    return initialSyncPromise;
}

async function buildSyncMergeState(remoteSnapshot, source) {
    source = source || "sync";
    var localShortcuts = (await syncGet("shortcuts")) || [];
    var localBookmarks = (await syncGet("bookmarks")) || [];
    var localFolders = (await syncGet("bookmarkFolders")) || [];
    var localBg = await syncGet("customBg");
    if (localBg === undefined) localBg = null;
    var localDeletedState = getDeletedSyncTombstoneState();

    var shortcutState = mergeRemoteSyncCollection("shortcuts", localShortcuts, remoteSnapshot.shortcuts || [], localDeletedState.shortcuts || {});
    var bookmarkState = mergeRemoteSyncCollection("bookmarks", localBookmarks, remoteSnapshot.bookmarks || [], localDeletedState.bookmarks || {});
    var folderState = mergeRemoteSyncCollection("bookmarkFolders", localFolders, remoteSnapshot.bookmarkFolders || [], localDeletedState.bookmarkFolders || {});

    var mergedDeletedState = {
        shortcuts: shortcutState.mergedDeleted,
        bookmarks: bookmarkState.mergedDeleted,
        bookmarkFolders: folderState.mergedDeleted
    };
    var remoteBg = remoteSnapshot.settings && Object.prototype.hasOwnProperty.call(remoteSnapshot.settings, "customBg") ? remoteSnapshot.settings.customBg : null;
    var dirtyBgStamp = isSyncDirty("customBg") ? Date.now() : null;
    var remoteBgUpdatedAt = remoteSnapshot.settings && remoteSnapshot.settings.updatedAt ? remoteSnapshot.settings.updatedAt : null;
    var mergedBg = localBg;
    if (localBg !== remoteBg && !dirtyBgStamp && remoteBgUpdatedAt !== null) {
        mergedBg = remoteBg;
    } else if (localBg === remoteBg) {
        mergedBg = localBg;
    } else if (!dirtyBgStamp && remoteBgUpdatedAt === null) {
        mergedBg = localBg;
    }

    logSyncEvent(source, "start", {
        local: summarizeSyncState(localShortcuts, localBookmarks, localFolders, null, localBg),
        remote: summarizeSyncState(shortcutState.remoteItems, bookmarkState.remoteItems, folderState.remoteItems, null, remoteBg)
    });

    return {
        localShortcuts: localShortcuts,
        localBookmarks: localBookmarks,
        localFolders: localFolders,
        localBg: localBg,
        localDeletedState: localDeletedState,
        mergedShortcuts: shortcutState.mergedItems,
        mergedBookmarks: bookmarkState.mergedItems,
        mergedFolders: folderState.mergedItems,
        mergedBg: mergedBg,
        mergedDeletedState: mergedDeletedState,
        shortcutState: shortcutState,
        bookmarkState: bookmarkState,
        folderState: folderState,
        remoteBg: remoteBg
    };
}

async function applyMergedSyncState(mergeState, source) {
    source = source || "sync";
    var uiRefresh = buildSyncUiRefreshDetail({
        shortcuts: mergeState.localShortcuts,
        bookmarks: mergeState.localBookmarks,
        bookmarkFolders: mergeState.localFolders,
        customBg: mergeState.localBg
    }, {
        shortcuts: mergeState.mergedShortcuts,
        bookmarks: mergeState.mergedBookmarks,
        bookmarkFolders: mergeState.mergedFolders,
        customBg: mergeState.mergedBg
    });
    var mergedSummary = summarizeSyncState(
        mergeState.mergedShortcuts,
        mergeState.mergedBookmarks,
        mergeState.mergedFolders,
        null,
        mergeState.mergedBg
    );
    var localBefore = JSON.stringify({
        s: mergeState.localShortcuts,
        b: mergeState.localBookmarks,
        f: mergeState.localFolders,
        bg: mergeState.localBg,
        d: mergeState.localDeletedState
    });
    var mergedAfter = JSON.stringify({
        s: mergeState.mergedShortcuts,
        b: mergeState.mergedBookmarks,
        f: mergeState.mergedFolders,
        bg: mergeState.mergedBg,
        d: mergeState.mergedDeletedState
    });

    if (localBefore === mergedAfter) {
        logSyncEvent(source, "noop", { merged: mergedSummary, reason: "already-current" });
        return {
            changed: false,
            summary: mergedSummary,
            uiRefresh: uiRefresh
        };
    }

    await syncSet({
        shortcuts: mergeState.mergedShortcuts,
        bookmarks: mergeState.mergedBookmarks,
        bookmarkFolders: mergeState.mergedFolders,
        customBg: mergeState.mergedBg
    });
    setDeletedSyncTombstones(mergeState.mergedDeletedState);
    logSyncEvent(source, "applied", {
        merged: mergedSummary,
        deleted: {
            shortcuts: Object.keys(mergeState.mergedDeletedState.shortcuts || {}).sort(),
            bookmarks: Object.keys(mergeState.mergedDeletedState.bookmarks || {}).sort(),
            bookmarkFolders: Object.keys(mergeState.mergedDeletedState.bookmarkFolders || {}).sort()
        }
    });
    dispatchSyncUiRefresh(uiRefresh);
    return {
        changed: true,
        summary: mergedSummary,
        uiRefresh: uiRefresh
    };
}

async function fbSaveAll() {
    if (!getSyncId()) return;
    syncId = getSyncId();
    docPath = getLegacySyncDocPath(syncId);

    var remoteSnapshot = await loadRemoteSyncSnapshot(syncId);
    var mergeState = await buildSyncMergeState(remoteSnapshot, "push");
    var applied = await applyMergedSyncState(mergeState, "push");
    var shortcutWrites = getCollectionRemoteWrites("shortcuts", mergeState.mergedShortcuts, mergeState.shortcutState.mergedDeleted, remoteSnapshot.shortcuts || []);
    var bookmarkWrites = getCollectionRemoteWrites("bookmarks", mergeState.mergedBookmarks, mergeState.bookmarkState.mergedDeleted, remoteSnapshot.bookmarks || []);
    var folderWrites = getCollectionRemoteWrites("bookmarkFolders", mergeState.mergedFolders, mergeState.folderState.mergedDeleted, remoteSnapshot.bookmarkFolders || []);
    var settingsUpdatedAt = mergeState.mergedBg === mergeState.remoteBg && remoteSnapshot.settings && remoteSnapshot.settings.updatedAt
        ? remoteSnapshot.settings.updatedAt
        : (isSyncDirty("customBg") ? Date.now() : (remoteSnapshot.settings && remoteSnapshot.settings.updatedAt ? remoteSnapshot.settings.updatedAt : Date.now()));
    var expectedSettings = buildSyncSettingsDocument(mergeState.mergedBg, settingsUpdatedAt);
    var writeOps = [];
    var collectionWrites = {
        shortcuts: shortcutWrites,
        bookmarks: bookmarkWrites,
        bookmarkFolders: folderWrites
    };

    for (var collectionKey in collectionWrites) {
        if (!collectionWrites.hasOwnProperty(collectionKey)) continue;
        var collectionWrite = collectionWrites[collectionKey];
        for (var i = 0; i < collectionWrite.upserts.length; i++) {
            writeOps.push(fbSet(getSyncItemDocPath(syncId, collectionKey, collectionWrite.upserts[i].id), collectionWrite.upserts[i]));
        }
        for (var j = 0; j < collectionWrite.tombstones.length; j++) {
            writeOps.push(fbSet(getSyncItemDocPath(syncId, collectionKey, collectionWrite.tombstones[j].id), collectionWrite.tombstones[j]));
        }
    }

    if (!syncDocMatches(remoteSnapshot.settings, expectedSettings)) {
        writeOps.push(fbSet(getSyncSettingsDocPath(syncId), expectedSettings));
    }

    if (writeOps.length === 0 && !applied.changed) {
        logSyncEvent("push", "noop", { reason: "no-item-writes" });
        clearSyncDirty(["shortcuts", "bookmarks", "bookmarkFolders", "customBg"]);
        setSyncIcon("synced");
        return;
    }

    try {
        await Promise.all(writeOps);
        lastWrittenHash = JSON.stringify({
            shortcuts: mergeState.mergedShortcuts,
            bookmarks: mergeState.mergedBookmarks,
            bookmarkFolders: mergeState.mergedFolders,
            customBg: mergeState.mergedBg,
            deleted: mergeState.mergedDeletedState
        });
        lastSeenRemoteRevision = settingsUpdatedAt;
        logSyncEvent("push", "success", {
            writes: writeOps.length,
            shortcuts: shortcutWrites.upserts.length + shortcutWrites.tombstones.length,
            bookmarks: bookmarkWrites.upserts.length + bookmarkWrites.tombstones.length,
            bookmarkFolders: folderWrites.upserts.length + folderWrites.tombstones.length
        });
        clearSyncDirty(["shortcuts", "bookmarks", "bookmarkFolders", "customBg"]);
        setSyncIcon("synced");
    } catch (e) {
        logSyncEvent("push", "error", {
            message: e && e.message ? e.message : String(e)
        });
        setSyncIcon("error");
        return;
    }
}

async function fbLoadAll() {
    if (!getSyncId()) return;
    syncId = getSyncId();
    docPath = getLegacySyncDocPath(syncId);
    if (hasDirtySyncState()) {
        logSyncEvent("pull", "skip", { reason: "local-dirty" });
        return;
    }
    try {
        var remoteSnapshot = await loadRemoteSyncSnapshot(syncId);
        var mergeState = await buildSyncMergeState(remoteSnapshot, "pull");
        await applyMergedSyncState(mergeState, "pull");
        clearSyncDirty(["shortcuts", "bookmarks", "bookmarkFolders", "customBg"]);
        setSyncIcon("synced");
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
    return;
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
    if (hasDirtySyncState()) {
        logSyncEvent("pull", "skip", { reason: "local-dirty" });
        return;
    }
    syncBusy = true;
    try {
        await fbLoadAll();
    } catch (e) {
        logSyncEvent("pull", "error", { message: e && e.message ? e.message : String(e) });
    }
    syncBusy = false;
}

// Manual sync only: automatic focus and periodic remote pulls are disabled.

// Cross-tab / cross-instance refresh: when chrome.storage.local changes
// (e.g. another tab in the same browser saved a shortcut, or the
// extension's background script updated something), let listeners
// rerender. Debounced so a burst of writes triggers one render.
var _onChangedTimer = null;
var _pendingOnChangedRefresh = createSyncUiRefreshDetail();
var _SYNCED_KEYS = ["shortcuts", "bookmarks", "bookmarkFolders", "customBg"];
if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== "local") return;
        var refreshDetail = buildStorageSyncUiRefreshDetail(changes);
        if (!hasSyncUiRefresh(refreshDetail)) return;
        _pendingOnChangedRefresh = mergeSyncUiRefreshDetail(_pendingOnChangedRefresh, refreshDetail);
        clearTimeout(_onChangedTimer);
        _onChangedTimer = setTimeout(function () {
            var nextRefresh = _pendingOnChangedRefresh;
            _pendingOnChangedRefresh = createSyncUiRefreshDetail();
            dispatchSyncUiRefresh(nextRefresh);
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
