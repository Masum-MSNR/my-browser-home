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
        ensureSyncItem(items[i], clean.length);
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
            ensureSyncItem(group[j], j);
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

var SYNC_SCHEMA_VERSION = 2;
var SYNC_COLLECTION_KEYS = ["shortcuts", "bookmarks", "bookmarkFolders"];

function getSyncCollectionConfig(collectionKey) {
    if (collectionKey === "shortcuts") {
        return {
            isValidItem: isUrlSyncItem,
            scopeKeyFn: null
        };
    }
    if (collectionKey === "bookmarks") {
        return {
            isValidItem: isUrlSyncItem,
            scopeKeyFn: function (item) {
                return item && item.folderId;
            }
        };
    }
    if (collectionKey === "bookmarkFolders") {
        return {
            isValidItem: isFolderSyncItem,
            scopeKeyFn: function (item) {
                return item && item.parentId;
            }
        };
    }
    throw new Error("Unknown sync collection: " + collectionKey);
}

function getSyncUserRoot(uid) {
    return "users/" + uid;
}

function getLegacySyncDocPath(uid) {
    return getSyncUserRoot(uid) + "/data/main";
}

function getSyncCollectionPath(uid, collectionKey) {
    return getSyncUserRoot(uid) + "/" + collectionKey;
}

function getSyncItemDocPath(uid, collectionKey, itemId) {
    return getSyncCollectionPath(uid, collectionKey) + "/" + itemId;
}

function getSyncSettingsDocPath(uid) {
    return getSyncUserRoot(uid) + "/settings/main";
}

function getSyncMetaDocPath(uid) {
    return getSyncUserRoot(uid) + "/meta/sync";
}

function stableStringifySyncValue(value) {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
        var items = [];
        for (var i = 0; i < value.length; i++) items.push(stableStringifySyncValue(value[i]));
        return "[" + items.join(",") + "]";
    }
    var keys = Object.keys(value).sort();
    var parts = [];
    for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        if (value[key] === undefined) continue;
        parts.push(JSON.stringify(key) + ":" + stableStringifySyncValue(value[key]));
    }
    return "{" + parts.join(",") + "}";
}

function cloneSyncDocForCollection(collectionKey, item) {
    var copy = cloneSyncValue(item) || {};
    if (!copy.id) copy.id = crypto.randomUUID();
    ensureSyncItemOrderKey(copy);
    if (collectionKey === "shortcuts" || collectionKey === "bookmarks") {
        if (copy.position === undefined) copy.position = 0;
        if (!copy.updatedAt) copy.updatedAt = Date.now();
    }
    if (collectionKey === "bookmarkFolders") {
        if (copy.position === undefined) copy.position = 0;
        if (!copy.updatedAt) copy.updatedAt = Date.now();
    }
    return copy;
}

function buildActiveSyncItemDocument(collectionKey, item) {
    var doc = cloneSyncDocForCollection(collectionKey, item);
    delete doc.position;
    doc.deletedAt = null;
    doc.rev = doc.updatedAt || Date.now();
    return doc;
}

function buildDeletedSyncItemDocument(itemId, deletedAt) {
    return {
        id: itemId,
        deletedAt: deletedAt,
        rev: deletedAt
    };
}

function buildSyncSettingsDocument(customBg, updatedAt) {
    var revision = updatedAt || Date.now();
    return {
        customBg: customBg === undefined ? null : customBg,
        updatedAt: revision,
        rev: revision
    };
}

function projectSyncDocLike(source, template) {
    var projected = {};
    for (var key in template) {
        if (!template.hasOwnProperty(key)) continue;
        if (source && Object.prototype.hasOwnProperty.call(source, key)) {
            projected[key] = cloneSyncValue(source[key]);
        } else {
            projected[key] = template[key];
        }
    }
    return projected;
}

function syncDocMatches(source, expected) {
    if (!source) return false;
    return stableStringifySyncValue(projectSyncDocLike(source, expected)) === stableStringifySyncValue(expected);
}

async function fbListCollection(path, retry, pageToken) {
    if (retry === undefined) retry = true;
    var suffix = "?pageSize=500";
    if (pageToken) suffix += "&pageToken=" + encodeURIComponent(pageToken);
    try {
        var r = await fetch(FB_BASE + "/" + path + suffix, {
            headers: { Authorization: "Bearer " + (await fbToken()) }
        });
        if (r.status === 404) {
            return {
                documents: [],
                nextPageToken: null
            };
        }
        if ((r.status === 401 || r.status === 403) && retry) {
            await refreshToken();
            return fbListCollection(path, false, pageToken);
        }
        if (!r.ok) throw new Error(((await r.json()).error || {}).message || "Read failed");
        var payload = await r.json();
        var documents = [];
        if (Array.isArray(payload.documents)) {
            for (var i = 0; i < payload.documents.length; i++) {
                var doc = payload.documents[i];
                var value = doc && doc.fields ? unmap(doc) : {};
                if (!value.id && doc && doc.name) value.id = String(doc.name).split("/").pop();
                documents.push(value);
            }
        }
        return {
            documents: documents,
            nextPageToken: payload.nextPageToken || null
        };
    } catch (e) {
        if (retry) return fbListCollection(path, false, pageToken);
        throw e;
    }
}

async function fbListCollectionAll(path) {
    var documents = [];
    var pageToken = null;
    do {
        var page = await fbListCollection(path, true, pageToken);
        if (Array.isArray(page.documents)) documents = documents.concat(page.documents);
        pageToken = page.nextPageToken || null;
    } while (pageToken);
    return documents;
}

async function ensureSyncSchemaMigrated(uid) {
    var metaPath = getSyncMetaDocPath(uid);
    var meta = null;
    try {
        meta = await fbGet(metaPath);
    } catch (e) {}
    if (meta && meta.schemaVersion >= SYNC_SCHEMA_VERSION) return meta;

    var legacyDoc = null;
    try {
        legacyDoc = await fbGet(getLegacySyncDocPath(uid));
    } catch (e) {}

    var now = Date.now();
    var writes = [];
    if (legacyDoc) {
        for (var i = 0; i < SYNC_COLLECTION_KEYS.length; i++) {
            var collectionKey = SYNC_COLLECTION_KEYS[i];
            var config = getSyncCollectionConfig(collectionKey);
            var items = Array.isArray(legacyDoc[collectionKey]) ? legacyDoc[collectionKey] : [];
            for (var j = 0; j < items.length; j++) {
                var item = cloneSyncDocForCollection(collectionKey, items[j]);
                if (!config.isValidItem(item)) continue;
                writes.push(fbSet(getSyncItemDocPath(uid, collectionKey, item.id), buildActiveSyncItemDocument(collectionKey, item)));
            }
        }
        if (Object.prototype.hasOwnProperty.call(legacyDoc, "customBg")) {
            var legacyRevision = legacyDoc && legacyDoc._syncMeta && legacyDoc._syncMeta.rev ? legacyDoc._syncMeta.rev : now;
            writes.push(fbSet(getSyncSettingsDocPath(uid), buildSyncSettingsDocument(legacyDoc.customBg, legacyRevision)));
        }
    }

    writes.push(fbSet(metaPath, {
        schemaVersion: SYNC_SCHEMA_VERSION,
        migratedFromLegacyAt: legacyDoc ? now : null
    }));
    await Promise.all(writes);
    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        migratedFromLegacyAt: legacyDoc ? now : null
    };
}

async function loadRemoteSyncSnapshot(uid) {
    await ensureSyncSchemaMigrated(uid);
    var results = await Promise.all([
        fbListCollectionAll(getSyncCollectionPath(uid, "shortcuts")),
        fbListCollectionAll(getSyncCollectionPath(uid, "bookmarks")),
        fbListCollectionAll(getSyncCollectionPath(uid, "bookmarkFolders")),
        fbGet(getSyncSettingsDocPath(uid)).catch(function () { return null; }),
        fbGet(getSyncMetaDocPath(uid)).catch(function () { return null; })
    ]);
    return {
        shortcuts: results[0] || [],
        bookmarks: results[1] || [],
        bookmarkFolders: results[2] || [],
        settings: results[3] || null,
        meta: results[4] || null
    };
}

function getRemoteVisibleSyncItems(remoteDocs, collectionKey) {
    var config = getSyncCollectionConfig(collectionKey);
    var items = [];
    if (!Array.isArray(remoteDocs)) return items;
    for (var i = 0; i < remoteDocs.length; i++) {
        var doc = cloneSyncValue(remoteDocs[i]);
        if (!doc || !doc.id || doc.deletedAt) continue;
        var normalized = cloneSyncDocForCollection(collectionKey, doc);
        if (!config.isValidItem(normalized)) continue;
        items.push(normalized);
    }
    return items;
}

function getRemoteDeletedSyncItems(remoteDocs) {
    var deleted = {};
    if (!Array.isArray(remoteDocs)) return deleted;
    for (var i = 0; i < remoteDocs.length; i++) {
        var doc = remoteDocs[i];
        if (!doc || !doc.id || !doc.deletedAt) continue;
        deleted[doc.id] = doc.deletedAt;
    }
    return deleted;
}

function mergeRemoteSyncCollection(collectionKey, localItems, remoteDocs, localDeleted) {
    var config = getSyncCollectionConfig(collectionKey);
    var remoteItems = getRemoteVisibleSyncItems(remoteDocs, collectionKey);
    var remoteDeleted = getRemoteDeletedSyncItems(remoteDocs);
    var mergedItems = config.scopeKeyFn
        ? mergeScopedItems(localItems, remoteItems, localDeleted, remoteDeleted, config.isValidItem, config.scopeKeyFn)
        : mergeFlatItems(localItems, remoteItems, localDeleted, remoteDeleted, config.isValidItem);
    return {
        remoteItems: remoteItems,
        remoteDeleted: remoteDeleted,
        mergedItems: mergedItems,
        mergedDeleted: getMergedTombstones(localDeleted, remoteDeleted)
    };
}

function getCollectionRemoteWrites(collectionKey, mergedItems, mergedDeleted, remoteDocs) {
    var remoteById = {};
    var writes = {
        upserts: [],
        tombstones: []
    };

    if (Array.isArray(remoteDocs)) {
        for (var i = 0; i < remoteDocs.length; i++) {
            if (remoteDocs[i] && remoteDocs[i].id) remoteById[remoteDocs[i].id] = cloneSyncValue(remoteDocs[i]);
        }
    }

    var mergedById = {};
    if (Array.isArray(mergedItems)) {
        for (var j = 0; j < mergedItems.length; j++) {
            var activeDoc = buildActiveSyncItemDocument(collectionKey, mergedItems[j]);
            mergedById[activeDoc.id] = true;
            if (!syncDocMatches(remoteById[activeDoc.id], activeDoc)) writes.upserts.push(activeDoc);
        }
    }

    for (var id in mergedDeleted) {
        if (!mergedDeleted.hasOwnProperty(id) || mergedById[id]) continue;
        var deletedDoc = buildDeletedSyncItemDocument(id, mergedDeleted[id]);
        if (!syncDocMatches(remoteById[id], deletedDoc)) writes.tombstones.push(deletedDoc);
    }

    return writes;
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
