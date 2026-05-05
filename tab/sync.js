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
    try { await fbLoadAll(); } catch (e) {}

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

function ensureShortcut(s, pos) {
    if (!s || !s.url) return null;
    if (!s.id) s.id = crypto.randomUUID();
    if (!s.updatedAt) s.updatedAt = Date.now();
    if (pos !== undefined) s.position = pos;
    if (s.position === undefined) s.position = 0;
    return s;
}

function mergeShortcuts(local, remote) {
    var byId = {};
    var tombstones = {};
    try { tombstones = JSON.parse(localStorage.getItem("_deleted") || "{}"); } catch (e) {}

    // Index local by id
    for (var i = 0; i < local.length; i++) {
        var s = ensureShortcut(local[i], i);
        if (!s) continue;
        byId[s.id] = s;
    }

    // Merge remote: keep latest by updatedAt
    for (var i = 0; i < remote.length; i++) {
        var s = ensureShortcut(remote[i]);
        if (!s) continue;

        // Check tombstone: local deletion newer than remote update
        var delTs = tombstones[s.id];
        if (delTs && delTs > s.updatedAt) continue;

        var existing = byId[s.id];
        if (!existing || s.updatedAt > existing.updatedAt) {
            byId[s.id] = s;
        }
    }

    // Convert to array sorted by position
    var result = [];
    for (var id in byId) {
        if (byId.hasOwnProperty(id)) result.push(byId[id]);
    }
    result.sort(function (a, b) { return a.position - b.position; });

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

var syncId = null;
var docPath = null;

async function fbGet(path, retry) {
    if (retry === undefined) retry = true;
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
}

async function fbSet(path, obj, retry) {
    if (retry === undefined) retry = true;
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
}

async function initSync() {
    var cached = JSON.parse(localStorage.getItem("_fbu") || "null");
    if (cached && cached.token) {
        currentUser = cached;
        syncId = currentUser.uid;
        docPath = "users/" + syncId + "/data/main";
        try { await fbLoadAll(); } catch (e) {}
    }
    if (typeof updateSyncUI === "function") updateSyncUI(currentUser);
}

async function fbSaveAll() {
    if (!getSyncId()) throw new Error("Sign in first");
    syncId = getSyncId();
    docPath = "users/" + syncId + "/data/main";
    var local = (await syncGet("shortcuts")) || [];
    var customBg = (await syncGet("customBg")) || null;

    var remote = [];
    try {
        var doc = await fbGet(docPath);
        if (doc && doc.shortcuts) remote = doc.shortcuts;
    } catch (e) {}

    var merged = mergeShortcuts(local, remote);
    await syncSet({ shortcuts: merged });
    await fbSet(docPath, { shortcuts: merged, customBg: customBg });
    window.dispatchEvent(new CustomEvent("syncdataloaded"));
}

async function fbLoadAll() {
    if (!getSyncId()) return;
    syncId = getSyncId();
    docPath = "users/" + syncId + "/data/main";
    var d = await fbGet(docPath);
    if (!d) return;

    var local = (await syncGet("shortcuts")) || [];
    var remote = d.shortcuts || [];
    var merged = mergeShortcuts(local, remote);

    await syncSet({ shortcuts: merged });
    if (d.customBg) await syncSet({ customBg: d.customBg });
    window.dispatchEvent(new CustomEvent("syncdataloaded"));
}

function getCurrentUser() {
    return currentUser;
}

initSync();
