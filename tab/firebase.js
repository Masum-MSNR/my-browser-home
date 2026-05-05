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

    readyPromise = new Promise((resolve) => {
        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                userDoc = db.collection("users").doc(user.uid).collection("data").doc("main");
                const snap = await userDoc.get();
                if (!snap.exists || (snap.data().shortcuts || []).length === 0) {
                    await migrateFromLocalStorage();
                }
                resolve();
            } else {
                try {
                    const provider = new firebase.auth.GoogleAuthProvider();
                    await firebase.auth().signInWithPopup(provider);
                } catch (err) {
                    console.warn("Firebase sign-in skipped:", err.message);
                    resolve();
                }
            }
        });
    });

    return readyPromise;
}

async function migrateFromLocalStorage() {
    if (!userDoc) return;
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
    if (!userDoc) return JSON.parse(localStorage.getItem("shortcuts") || "[]");
    const snap = await userDoc.get();
    return snap.exists ? (snap.data().shortcuts || []) : [];
}

async function saveShortcuts(shortcuts) {
    await initFirebase();
    if (userDoc) await userDoc.update({ shortcuts });
}

async function loadMailShortcuts() {
    await initFirebase();
    if (!userDoc) return JSON.parse(localStorage.getItem("mailShortcuts") || "[]");
    const snap = await userDoc.get();
    return snap.exists ? (snap.data().mailShortcuts || []) : [];
}

async function saveMailShortcuts(mailShortcuts) {
    await initFirebase();
    if (userDoc) await userDoc.update({ mailShortcuts });
}

async function loadTheme() {
    await initFirebase();
    if (!userDoc) return localStorage.getItem("customBg") || null;
    const snap = await userDoc.get();
    if (snap.exists && snap.data().theme) return snap.data().theme;
    return localStorage.getItem("customBg") || null;
}

async function saveTheme(theme) {
    await initFirebase();
    if (userDoc) await userDoc.update({ theme });
}
