function syncGet(key) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(key, (result) => {
            resolve(result[key]);
        });
    });
}

function syncSet(obj) {
    return new Promise((resolve) => {
        chrome.storage.sync.set(obj, resolve);
    });
}
