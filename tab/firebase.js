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

    readyPromise = firebase.auth().signInAnonymously()
        .then((cred) => {
            const uid = cred.user.uid;
            userDoc = db.collection("users").doc(uid).collection("data").doc("main");
            return userDoc.get().then((snap) => {
                if (!snap.exists) {
                    return userDoc.set({
                        shortcuts: [],
                        mailShortcuts: [],
                        theme: null
                    });
                }
            });
        })
        .catch((err) => {
            console.error("Firebase init failed:", err);
            throw err;
        });

    return readyPromise;
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
    return snap.exists ? (snap.data().theme || null) : null;
}

async function saveTheme(theme) {
    await initFirebase();
    await userDoc.update({ theme });
}
