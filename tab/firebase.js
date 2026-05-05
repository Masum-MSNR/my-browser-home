const firebaseConfig = {
    apiKey: "AIzaSyDmSkO5QLovaA54Oa24tSUVxJ9fUy-QJTw",
    authDomain: "cipher-vault-app.firebaseapp.com",
    projectId: "cipher-vault-app",
    storageBucket: "cipher-vault-app.firebasestorage.app",
    appId: "1:84808619865:web:a01d710fd2398119451e48"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
let userDoc = null;
let readyPromise = null;

function initFirebase() {
    if (readyPromise) return readyPromise;

    readyPromise = new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, async (token) => {
            if (chrome.runtime.lastError || !token) {
                console.error("Auth token failed:", chrome.runtime.lastError);
                reject(chrome.runtime.lastError || new Error("No token"));
                return;
            }

            try {
                const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
                const result = await firebase.auth().signInWithCredential(credential);
                const uid = result.user.uid;
                userDoc = db.collection("users").doc(uid).collection("data").doc("main");

                const snap = await userDoc.get();
                if (!snap.exists || !snap.data().shortcuts || snap.data().shortcuts.length === 0) {
                    await migrateFromLocalStorage();
                } else {
                    await userDoc.set({
                        shortcuts: snap.data().shortcuts || [],
                        mailShortcuts: snap.data().mailShortcuts || [],
                        theme: snap.data().theme || null
                    }, { merge: true });
                }

                resolve();
            } catch (err) {
                console.error("Firebase init failed:", err);
                reject(err);
            }
        });
    });

    return readyPromise;
}

async function migrateFromLocalStorage() {
    const shortcuts = JSON.parse(localStorage.getItem("shortcuts") || "[]");
    const mailShortcuts = JSON.parse(localStorage.getItem("mailShortcuts") || "[]");
    const theme = localStorage.getItem("customBg") || null;

    await userDoc.set({
        shortcuts,
        mailShortcuts,
        theme
    });

    localStorage.removeItem("shortcuts");
    localStorage.removeItem("mailShortcuts");
    localStorage.removeItem("customBg");
    localStorage.removeItem("todos");
}

async function loadShortcuts() {
    await initFirebase();
    const snap = await userDoc.get();
    return snap.exists ? (snap.data().shortcuts || []) : [];
}

async function saveShortcuts(shortcuts) {
    await initFirebase();
    await userDoc.update({ shortcuts });
}

async function loadMailShortcuts() {
    await initFirebase();
    const snap = await userDoc.get();
    return snap.exists ? (snap.data().mailShortcuts || []) : [];
}

async function saveMailShortcuts(mailShortcuts) {
    await initFirebase();
    await userDoc.update({ mailShortcuts });
}

async function loadTheme() {
    await initFirebase();
    const snap = await userDoc.get();
    if (snap.exists && snap.data().theme) {
        return snap.data().theme;
    }
    return localStorage.getItem("customBg") || null;
}

async function saveTheme(theme) {
    await initFirebase();
    await userDoc.update({ theme });
}
