firebase.initializeApp({
    apiKey: "AIzaSyDmSkO5QLovaA54Oa24tSUVxJ9fUy-QJTw",
    authDomain: "cipher-vault-app.firebaseapp.com",
    projectId: "cipher-vault-app",
    storageBucket: "cipher-vault-app.firebasestorage.app",
    appId: "1:84808619865:web:a01d710fd2398119451e48"
});

const auth = firebase.auth();
const db = firebase.firestore();
let userDoc = null;

auth.onAuthStateChanged(async (user) => {
    const badge = document.getElementById("sync-user");
    if (user) {
        userDoc = db.collection("users").doc(user.uid).collection("data").doc("main");
        if (badge) {
            badge.textContent = user.email || user.displayName || "Signed in";
            badge.style.display = "inline";
        }
        document.getElementById("sync-btn")?.classList.add("synced");
    } else {
        userDoc = null;
        if (badge) badge.style.display = "none";
        document.getElementById("sync-btn")?.classList.remove("synced");
    }
});

async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithRedirect(provider);
}

function signOut() {
    auth.signOut();
}

async function loadUserData() {
    if (!userDoc) return null;
    const snap = await userDoc.get();
    return snap.exists ? snap.data() : null;
}

async function saveUserData(data) {
    if (!userDoc) return;
    await userDoc.set(data, { merge: true });
}
