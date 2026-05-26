function setupRealtimeSync() {
    return false;
}

async function ensureRealtimeAuthSignedIn(googleIdToken, reason) {
    return false;
}

async function tryRestoreRealtimeAuth() {
    return false;
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
    lastSeenRemoteRevision = null;

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
var SYNC_ORDER_KEY_GAP = 1024;

function getSyncOrderValue(orderKey, fallbackPosition) {
    var numeric = Number(orderKey);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
        return Math.round(numeric);
    }
    if (typeof fallbackPosition === "number" && Number.isFinite(fallbackPosition)) {
        return Math.round((fallbackPosition + 1) * SYNC_ORDER_KEY_GAP);
    }
    return SYNC_ORDER_KEY_GAP;
}

function formatSyncOrderKey(orderValue) {
    return String(Math.round(orderValue));
}

function ensureSyncItemOrderKey(item, pos) {
    if (!item) return null;
    if (item.orderKey === undefined || item.orderKey === null || item.orderKey === "") {
        item.orderKey = formatSyncOrderKey(getSyncOrderValue(item.orderKey, item.position !== undefined ? item.position : pos));
    }
    return item;
}

function assignSyncPositions(items) {
    if (!Array.isArray(items)) return items;
    items.sort(compareSyncItems);
    for (var i = 0; i < items.length; i++) {
        ensureSyncItem(items[i], i);
        items[i].position = i;
    }
    return items;
}

function assignScopedSyncPositions(items, scopeField, scopeValues) {
    if (!Array.isArray(items)) return items;

    var scopeSet = null;
    if (scopeValues !== undefined) {
        var list = Array.isArray(scopeValues) ? scopeValues : [scopeValues];
        scopeSet = {};
        for (var i = 0; i < list.length; i++) {
            scopeSet[getScopeKey(list[i])] = true;
        }
    }

    var groups = {};
    for (var j = 0; j < items.length; j++) {
        var item = items[j];
        if (!item) continue;
        var scopeKey = getScopeKey(item[scopeField]);
        if (scopeSet && !scopeSet[scopeKey]) continue;
        if (!groups[scopeKey]) groups[scopeKey] = [];
        groups[scopeKey].push(item);
    }

    for (var key in groups) {
        if (!groups.hasOwnProperty(key)) continue;
        assignSyncPositions(groups[key]);
    }
    return items;
}

function getNextSyncOrderKey(items) {
    var maxValue = 0;
    if (Array.isArray(items)) {
        for (var i = 0; i < items.length; i++) {
            if (!items[i]) continue;
            var nextValue = getSyncOrderValue(items[i].orderKey, items[i].position);
            if (nextValue > maxValue) maxValue = nextValue;
        }
    }
    return formatSyncOrderKey(maxValue + SYNC_ORDER_KEY_GAP);
}

function getNextScopedSyncOrderKey(items, scopeField, scopeValue) {
    var siblings = [];
    var targetScope = getScopeKey(scopeValue);
    if (Array.isArray(items)) {
        for (var i = 0; i < items.length; i++) {
            if (!items[i]) continue;
            if (getScopeKey(items[i][scopeField]) === targetScope) siblings.push(items[i]);
        }
    }
    return getNextSyncOrderKey(siblings);
}

function swapSyncOrderItems(items, fromIdx, toIdx) {
    if (!Array.isArray(items) || fromIdx === toIdx) return false;
    assignSyncPositions(items);
    if (fromIdx < 0 || fromIdx >= items.length || toIdx < 0 || toIdx >= items.length) return false;

    var left = items[fromIdx];
    var right = items[toIdx];
    if (!left || !right) return false;

    var now = Date.now();
    var tempOrderKey = left.orderKey;
    left.orderKey = right.orderKey;
    right.orderKey = tempOrderKey;
    left.updatedAt = now;
    right.updatedAt = now;
    assignSyncPositions(items);
    return true;
}

function moveSyncOrderItem(items, fromIdx, toIdx) {
    if (!Array.isArray(items) || items.length === 0) return false;
    assignSyncPositions(items);
    if (fromIdx < 0 || fromIdx >= items.length) return false;

    var moved = items.splice(fromIdx, 1)[0];
    if (!moved) return false;

    if (toIdx < 0) toIdx = 0;
    if (toIdx > items.length) toIdx = items.length;
    items.splice(toIdx, 0, moved);

    var previous = toIdx > 0 ? items[toIdx - 1] : null;
    var next = toIdx + 1 < items.length ? items[toIdx + 1] : null;
    var previousValue = previous ? getSyncOrderValue(previous.orderKey, previous.position) : 0;
    var nextValue = next ? getSyncOrderValue(next.orderKey, next.position) : null;
    var now = Date.now();

    if (nextValue !== null && (nextValue - previousValue) <= 1) {
        for (var i = 0; i < items.length; i++) {
            ensureSyncItem(items[i], i);
            items[i].orderKey = formatSyncOrderKey((i + 1) * SYNC_ORDER_KEY_GAP);
            items[i].position = i;
            items[i].updatedAt = now;
        }
        return true;
    }

    moved.orderKey = nextValue === null
        ? formatSyncOrderKey(previousValue + SYNC_ORDER_KEY_GAP)
        : formatSyncOrderKey(previousValue + Math.floor((nextValue - previousValue) / 2));
    moved.updatedAt = now;
    assignSyncPositions(items);
    return true;
}

function ensureSyncItem(item, pos) {
    if (!item) return null;
    if (!item.id) item.id = crypto.randomUUID();
    if (!item.updatedAt) item.updatedAt = Date.now();
    ensureSyncItemOrderKey(item, pos);
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
    var ao = getSyncOrderValue(a && a.orderKey, a && a.position);
    var bo = getSyncOrderValue(b && b.orderKey, b && b.position);
    if (ao !== bo) return ao - bo;
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

function serializeSyncUiValue(value) {
    if (value === undefined) return "__sync_ui_undefined__";
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
}

function pushUniqueSyncUiKey(keys, key) {
    if (keys.indexOf(key) === -1) keys.push(key);
}

function cloneSyncUiComparableItem(item, ignoreFavicon) {
    if (!item || typeof item !== "object") return item;

    var next = {};
    for (var key in item) {
        if (!item.hasOwnProperty(key)) continue;
        if (key === "updatedAt") continue;
        if (ignoreFavicon && key === "favicon") continue;
        next[key] = item[key];
    }
    return next;
}

function normalizeSyncUiComparableItems(items, ignoreFavicon) {
    if (!Array.isArray(items)) return [];

    var next = [];
    for (var i = 0; i < items.length; i++) {
        next.push(cloneSyncUiComparableItem(items[i], ignoreFavicon));
    }
    return next;
}

function areSyncUiComparableItemsEqual(left, right, ignoreFavicon) {
    return serializeSyncUiValue(normalizeSyncUiComparableItems(left, ignoreFavicon)) ===
        serializeSyncUiValue(normalizeSyncUiComparableItems(right, ignoreFavicon));
}

function isMetadataOnlyUrlItemChange(left, right) {
    return areSyncUiComparableItemsEqual(left, right, true) &&
        !areSyncUiComparableItemsEqual(left, right, false);
}

function createSyncUiRefreshDetail() {
    return {
        structuralKeys: [],
        metadataOnlyKeys: []
    };
}

function hasSyncUiRefresh(detail) {
    return !!(detail && (detail.structuralKeys.length > 0 || detail.metadataOnlyKeys.length > 0));
}

function mergeSyncUiRefreshDetail(target, next) {
    if (!next) return target;
    if (!target) target = createSyncUiRefreshDetail();

    for (var i = 0; i < next.structuralKeys.length; i++) {
        pushUniqueSyncUiKey(target.structuralKeys, next.structuralKeys[i]);
    }
    for (var j = 0; j < next.metadataOnlyKeys.length; j++) {
        if (target.structuralKeys.indexOf(next.metadataOnlyKeys[j]) !== -1) continue;
        pushUniqueSyncUiKey(target.metadataOnlyKeys, next.metadataOnlyKeys[j]);
    }
    return target;
}

function buildSyncUiRefreshDetail(beforeState, afterState) {
    var detail = createSyncUiRefreshDetail();

    if (!areSyncUiComparableItemsEqual(beforeState.shortcuts, afterState.shortcuts, false)) {
        if (isMetadataOnlyUrlItemChange(beforeState.shortcuts, afterState.shortcuts)) {
            pushUniqueSyncUiKey(detail.metadataOnlyKeys, "shortcuts");
        } else {
            pushUniqueSyncUiKey(detail.structuralKeys, "shortcuts");
        }
    }

    if (!areSyncUiComparableItemsEqual(beforeState.bookmarks, afterState.bookmarks, false)) {
        if (isMetadataOnlyUrlItemChange(beforeState.bookmarks, afterState.bookmarks)) {
            pushUniqueSyncUiKey(detail.metadataOnlyKeys, "bookmarks");
        } else {
            pushUniqueSyncUiKey(detail.structuralKeys, "bookmarks");
        }
    }

    if (serializeSyncUiValue(beforeState.bookmarkFolders) !== serializeSyncUiValue(afterState.bookmarkFolders)) {
        pushUniqueSyncUiKey(detail.structuralKeys, "bookmarkFolders");
    }

    if (serializeSyncUiValue(beforeState.customBg) !== serializeSyncUiValue(afterState.customBg)) {
        pushUniqueSyncUiKey(detail.structuralKeys, "customBg");
    }

    return detail;
}

function buildStorageSyncUiRefreshDetail(changes) {
    var detail = createSyncUiRefreshDetail();

    for (var key in changes) {
        if (!changes.hasOwnProperty(key) || _SYNCED_KEYS.indexOf(key) === -1) continue;

        var change = changes[key];
        if (!change) continue;
        if (typeof wasPendingLocalSyncWrite === "function" && wasPendingLocalSyncWrite(key, change.newValue)) {
            continue;
        }

        if (key === "shortcuts" || key === "bookmarks") {
            if (isMetadataOnlyUrlItemChange(change.oldValue, change.newValue)) {
                pushUniqueSyncUiKey(detail.metadataOnlyKeys, key);
                continue;
            }
        }

        if (serializeSyncUiValue(change.oldValue) !== serializeSyncUiValue(change.newValue)) {
            pushUniqueSyncUiKey(detail.structuralKeys, key);
        }
    }

    detail.metadataOnlyKeys = detail.metadataOnlyKeys.filter(function (key) {
        return detail.structuralKeys.indexOf(key) === -1;
    });
    return detail;
}

function dispatchSyncUiRefresh(detail) {
    if (!hasSyncUiRefresh(detail)) return;

    var eventName = detail.structuralKeys.length > 0 ? "syncdataloaded" : "syncitemmetaupdated";
    window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
}

// logSyncEvent is intentionally a no-op since 1.3.0. The summary helpers
// below short-circuit to null so callers don't pay the cost of building
// payloads that nobody reads. Re-enable by replacing this stub with a
// real logger (and restoring the summarizers).
function summarizeSyncItems() { return null; }

function summarizeSyncState() { return null; }

function logSyncEvent() { return; }
