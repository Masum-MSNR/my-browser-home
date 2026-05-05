const FB_KEY = "AIzaSyDmSkO5QLovaA54Oa24tSUVxJ9fUy-QJTw";
const FB_PROJECT = "cipher-vault-app";
const FB_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

function getSyncId() {
    return new Promise((resolve) => {
        chrome.identity.getProfileUserInfo({}, (user) => {
            if (user.email) {
                resolve(btoa(user.email).replace(/[/+=]/g, '').slice(0, 20));
            } else {
                let id = localStorage.getItem("syncId");
                if (!id) { id = crypto.randomUUID(); localStorage.setItem("syncId", id); }
                resolve(id);
            }
        });
    });
}

async function fbToken() {
    const cached = JSON.parse(localStorage.getItem("_fbt") || "null");
    if (cached && cached.exp > Date.now()) return cached.tok;
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: '{"returnSecureToken":true}'
    });
    const d = await r.json();
    if (!d.idToken) throw new Error(d.error?.message || "Auth failed");
    const tok = { tok: d.idToken, exp: Date.now() + +d.expiresIn * 1000 - 60000 };
    localStorage.setItem("_fbt", JSON.stringify(tok));
    return tok.tok;
}

async function fbGet(path) {
    const r = await fetch(`${FB_BASE}/${path}`, { headers: { Authorization: `Bearer ${await fbToken()}` } });
    if (r.status === 404) return null;
    const d = await r.json();
    return d.fields ? unmap(d) : null;
}

async function fbSet(path, obj) {
    const r = await fetch(`${FB_BASE}/${path}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${await fbToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: map(obj) })
    });
    if (!r.ok) throw new Error((await r.json()).error?.message || "Write failed");
}

function map(o) {
    const f = {};
    for (const [k, v] of Object.entries(o)) {
        if (Array.isArray(v)) f[k] = { arrayValue: { values: v.map(m) } };
        else f[k] = m(v);
    }
    return f;
}
function m(v) { return v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { doubleValue: v } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'object' && !Array.isArray(v) ? { mapValue: { fields: map(v) } } : { nullValue: null }; }
function unmap(d) { const o = {}; if (d.fields) for (const k of Object.keys(d.fields)) o[k] = um(d.fields[k]); return o; }
function um(v) { return v.stringValue ?? v.doubleValue ?? (v.integerValue && +v.integerValue) ?? v.booleanValue ?? v.nullValue ?? (v.arrayValue?.values?.map(um)) ?? (v.mapValue?.fields && unmap(v)) ?? null; }

let syncId = null;
let docPath = null;

async function initSync() {
    syncId = await getSyncId();
    docPath = `users/${syncId}/data/main`;
    try { await fbLoadAll(); } catch {}
}

async function fbSaveAll() {
    if (!docPath) await initSync();
    const shortcuts = JSON.parse(localStorage.getItem("shortcuts") || "[]");
    const mailShortcuts = JSON.parse(localStorage.getItem("mailShortcuts") || "[]");
    const customBg = localStorage.getItem("customBg") || null;
    await fbSet(docPath, { shortcuts, mailShortcuts, customBg });
}

async function fbLoadAll() {
    if (!docPath) await initSync();
    const d = await fbGet(docPath);
    if (d) {
        if (d.shortcuts) localStorage.setItem("shortcuts", JSON.stringify(d.shortcuts));
        if (d.mailShortcuts) localStorage.setItem("mailShortcuts", JSON.stringify(d.mailShortcuts));
        if (d.customBg) localStorage.setItem("customBg", d.customBg);
    }
}
