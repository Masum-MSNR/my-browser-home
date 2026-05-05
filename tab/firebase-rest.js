const FB_API_KEY = "AIzaSyDmSkO5QLovaA54Oa24tSUVxJ9fUy-QJTw";
const FB_PROJECT = "cipher-vault-app";
const FB_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

function getSyncId() {
    let id = localStorage.getItem("syncId");
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("syncId", id);
    }
    return id;
}

async function fbAuth() {
    const cached = JSON.parse(localStorage.getItem("fbToken") || "null");
    if (cached && cached.expires > Date.now()) {
        return cached.idToken;
    }

    const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"returnSecureToken":true}' }
    );
    const data = await resp.json();
    if (!data.idToken) throw new Error(data.error?.message || "Auth failed");

    localStorage.setItem("fbToken", JSON.stringify({
        idToken: data.idToken,
        expires: Date.now() + parseInt(data.expiresIn) * 1000 - 60000
    }));
    return data.idToken;
}

async function fbGet(docPath) {
    const token = await fbAuth();
    const resp = await fetch(`${FB_BASE}/${docPath}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (resp.status === 404) return null;
    const data = await resp.json();
    return data.fields ? unmarshalDoc(data) : null;
}

async function fbSet(docPath, obj) {
    const token = await fbAuth();
    const body = { fields: marshalDoc(obj) };
    const resp = await fetch(`${FB_BASE}/${docPath}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error?.message || "Write failed");
    }
}

function marshalDoc(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) {
            fields[k] = { arrayValue: { values: v.map(marshalValue) } };
        } else {
            fields[k] = marshalValue(v);
        }
    }
    return fields;
}

function marshalValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "number") return { doubleValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(marshalValue) } };
    if (typeof v === "object") {
        const fields = {};
        for (const [k2, v2] of Object.entries(v)) fields[k2] = marshalValue(v2);
        return { mapValue: { fields } };
    }
    return { nullValue: null };
}

function unmarshalDoc(data) {
    const obj = {};
    if (!data.fields) return obj;
    for (const [k, v] of Object.entries(data.fields)) {
        obj[k] = unmarshalValue(v);
    }
    return obj;
}

function unmarshalValue(v) {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.integerValue !== undefined) return parseInt(v.integerValue);
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.arrayValue?.values) return v.arrayValue.values.map(unmarshalValue);
    if (v.mapValue?.fields) {
        const obj = {};
        for (const [k2, v2] of Object.entries(v.mapValue.fields)) obj[k2] = unmarshalValue(v2);
        return obj;
    }
    return null;
}

const fbSyncId = getSyncId();
const docPath = `users/${fbSyncId}/data/main`;

async function fbSaveAll() {
    const shortcuts = JSON.parse(localStorage.getItem("shortcuts") || "[]");
    const mailShortcuts = JSON.parse(localStorage.getItem("mailShortcuts") || "[]");
    const customBg = localStorage.getItem("customBg") || null;
    await fbSet(docPath, { shortcuts, mailShortcuts, customBg });
}

async function fbLoadAll() {
    const data = await fbGet(docPath);
    if (data) {
        if (data.shortcuts) localStorage.setItem("shortcuts", JSON.stringify(data.shortcuts));
        if (data.mailShortcuts) localStorage.setItem("mailShortcuts", JSON.stringify(data.mailShortcuts));
        if (data.customBg) localStorage.setItem("customBg", data.customBg);
        return true;
    }
    return false;
}

fbLoadAll().catch(() => {});
