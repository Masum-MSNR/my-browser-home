const fs = require('fs');
const vm = require('vm');

function createSyncContext(options) {
    options = options || {};
    const storage = {
        shortcuts: [{ id: 'local-shortcut', url: 'https://old-shortcut.test', name: 'old shortcut', position: 0, updatedAt: 1000 }],
        bookmarks: [{ id: 'local-bookmark', url: 'https://old-bookmark.test', name: 'old bookmark', folderId: null, position: 0, updatedAt: 1000 }],
        bookmarkFolders: [{ id: 'local-folder', name: 'old folder', parentId: null, position: 0, updatedAt: 1000 }],
        customBg: 'local-bg'
    };
    const localStorageData = {
        _fbu: JSON.stringify({ uid: 'u1', email: 'u@test.local', token: 'token' }),
        _deleted: '{}'
    };
    const remoteDoc = {
        shortcuts: [{ id: 'remote-shortcut', url: 'https://remote-shortcut.test', name: 'remote shortcut', position: 0, updatedAt: 5000 }],
        bookmarks: [{ id: 'remote-bookmark', url: 'https://remote-bookmark.test', name: 'remote bookmark', folderId: null, position: 0, updatedAt: 5000 }],
        bookmarkFolders: [{ id: 'remote-folder', name: 'remote folder', parentId: null, position: 0, updatedAt: 5000 }],
        customBg: 'remote-bg',
        _deleted: {}
    };
    const remoteWrites = [];
    let releaseInitialGet = null;
    let initialGetPromise = null;
    if (options.deferInitialGet) {
        initialGetPromise = new Promise(function (resolve) {
            releaseInitialGet = resolve;
        });
    }
    const context = {
        console: console,
        Date: Date,
        JSON: JSON,
        String: String,
        Error: Error,
        Array: Array,
        Object: Object,
        Promise: Promise,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: function () { return 0; },
        fetch: async function () { return { ok: true, status: 200, json: async function () { return { fields: {} }; } }; },
        crypto: { randomUUID: function () { return 'uuid-' + Math.random().toString(16).slice(2); } },
        localStorage: {
            getItem: function (key) { return Object.prototype.hasOwnProperty.call(localStorageData, key) ? localStorageData[key] : null; },
            setItem: function (key, value) { localStorageData[key] = String(value); },
            removeItem: function (key) { delete localStorageData[key]; }
        },
        chrome: {
            storage: { onChanged: { addListener: function () {} } },
            runtime: { sendMessage: function () {} }
        },
        document: { visibilityState: 'visible', addEventListener: function () {}, getElementById: function () { return null; } },
        window: { dispatchEvent: function () {} },
        CustomEvent: function CustomEvent(type) { this.type = type; },
        syncGet: async function (key) { return storage[key]; },
        syncSet: async function (obj) { Object.assign(storage, JSON.parse(JSON.stringify(obj))); },
        updateSyncUI: function () {}
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('tab/sync.js', 'utf8'), context);
    context.fbGet = async function () {
        if (initialGetPromise) await initialGetPromise;
        return JSON.parse(JSON.stringify(remoteDoc));
    };
    context.fbSet = async function (path, obj) { remoteWrites.push(JSON.parse(JSON.stringify(obj))); };
    context.fbToken = async function () { return 'token'; };
    return {
        context,
        storage,
        remoteWrites,
        releaseInitialGet: function () {
            if (releaseInitialGet) releaseInitialGet();
        }
    };
}

function ids(items) {
    return (items || []).map(function (item) { return item.id; }).join(',');
}

function idsByPosition(items) {
    return (items || []).slice().sort(function (a, b) {
        return (a.position || 0) - (b.position || 0);
    }).map(function (item) { return item.id; }).join(',');
}

function assert(label, condition) {
    if (!condition) throw new Error(label);
    console.log('PASS ' + label);
}

(async function run() {
    const delayed = createSyncContext({ deferInitialGet: true });
    const delayedInit = delayed.context.initSync();
    let waitResolved = false;
    const waiter = delayed.context.waitForSyncReady().then(function () { waitResolved = true; });
    await Promise.resolve();
    assert('waitForSyncReady stays pending while initial sync is in flight', waitResolved === false);
    delayed.releaseInitialGet();
    await delayedInit;
    await waiter;
    assert('waitForSyncReady resolves after initial sync completes', waitResolved === true);

    const probeTest = createSyncContext();
    await probeTest.context.initSync();
    let fullLoadCount = 0;
    probeTest.context.fbLoadAll = async function () { fullLoadCount++; };
    probeTest.context.lastSeenRemoteRevision = 55;
    probeTest.context.fbGetMasked = async function () {
        return {
            fields: {
                _syncMeta: {
                    mapValue: {
                        fields: {
                            rev: { doubleValue: 55 }
                        }
                    }
                }
            }
        };
    };
    await probeTest.context.pullFromRemote();
    assert('unchanged remote revision skips full pull', fullLoadCount === 0);

    probeTest.context.fbGetMasked = async function () {
        return {
            fields: {
                _syncMeta: {
                    mapValue: {
                        fields: {
                            rev: { doubleValue: 56 }
                        }
                    }
                }
            }
        };
    };
    await probeTest.context.pullFromRemote();
    assert('changed remote revision triggers full pull once', fullLoadCount === 1);

    const test = createSyncContext();

    test.context.markSyncDirty('bookmarks');
    await test.context.initSync();

    assert('pre-initial dirty bookmark mark is ignored', !test.context.isSyncDirty('bookmarks'));
    assert('initial pull replaces stale local bookmarks with remote bookmarks', ids(test.storage.bookmarks) === 'remote-bookmark');
    assert('initial pull replaces stale local folders with remote folders', ids(test.storage.bookmarkFolders) === 'remote-folder');
    assert('initial pull replaces stale local shortcuts with remote shortcuts', ids(test.storage.shortcuts) === 'remote-shortcut');

    test.storage.bookmarks.push({ id: 'local-added-bookmark', url: 'https://added.test', name: 'added', folderId: null, position: 1, updatedAt: 7000 });
    test.context.markSyncDirty('bookmarks');
    await test.context.fbSaveAll();

    const write = test.remoteWrites[test.remoteWrites.length - 1];
    assert('post-initial dirty bookmark save preserves remote bookmark', ids(write.bookmarks).indexOf('remote-bookmark') !== -1);
    assert('post-initial dirty bookmark save includes local bookmark edit', ids(write.bookmarks).indexOf('local-added-bookmark') !== -1);
    assert('clean folders are not overwritten by stale local folder state', ids(write.bookmarkFolders) === 'remote-folder');

    const reorderSave = createSyncContext();
    Object.assign(reorderSave.storage, {
        shortcuts: [],
        bookmarks: [
            { id: 'a', url: 'https://a.test', name: 'A', folderId: null, position: 1, updatedAt: 2000 },
            { id: 'b', url: 'https://b.test', name: 'B', folderId: null, position: 0, updatedAt: 2000 }
        ],
        bookmarkFolders: [],
        customBg: null
    });
    reorderSave.context.currentUser = { uid: 'u1', email: 'u@test.local', token: 'token' };
    reorderSave.context.syncInitialized = true;
    reorderSave.context.fbGet = async function () {
        return {
            shortcuts: [],
            bookmarks: [
                { id: 'a', url: 'https://a.test', name: 'A', folderId: null, position: 0, updatedAt: 1000 },
                { id: 'b', url: 'https://b.test', name: 'B', folderId: null, position: 1, updatedAt: 1000 }
            ],
            bookmarkFolders: [],
            customBg: null,
            _deleted: {},
            _syncMeta: { rev: 10 }
        };
    };
    reorderSave.context.markSyncDirty('bookmarks');
    await reorderSave.context.fbSaveAll();
    const reorderWrite = reorderSave.remoteWrites[reorderSave.remoteWrites.length - 1];
    assert('dirty bookmark reorder remote write preserves local position order', idsByPosition(reorderWrite.bookmarks) === 'b,a');

    const staleQueue = createSyncContext();
    Object.assign(staleQueue.storage, {
        shortcuts: [],
        bookmarks: [
            { id: 'a', url: 'https://a.test', name: 'A', folderId: null, position: 1, updatedAt: 2000 },
            { id: 'b', url: 'https://b.test', name: 'B', folderId: null, position: 0, updatedAt: 2000 }
        ],
        bookmarkFolders: [],
        customBg: null
    });
    const staleRemoteDoc = {
        shortcuts: [],
        bookmarks: [
            { id: 'a', url: 'https://a.test', name: 'A', folderId: null, position: 0, updatedAt: 1000 },
            { id: 'b', url: 'https://b.test', name: 'B', folderId: null, position: 1, updatedAt: 1000 }
        ],
        bookmarkFolders: [],
        customBg: null,
        _deleted: {},
        _syncMeta: { rev: 10 }
    };
    staleQueue.context.currentUser = { uid: 'u1', email: 'u@test.local', token: 'token' };
    staleQueue.context.syncInitialized = true;
    staleQueue.context.lastSeenRemoteRevision = 10;
    staleQueue.context.fbGet = async function () { return JSON.parse(JSON.stringify(staleRemoteDoc)); };
    staleQueue.context.markSyncDirty('bookmarks');
    staleQueue.context.queuePendingRemoteDoc(staleRemoteDoc, 'u1', 10, 'local-dirty');
    await staleQueue.context.fbSaveAll();
    await staleQueue.context.flushPendingRemoteDoc();
    assert('stale queued listener snapshot does not reset saved bookmark reorder', idsByPosition(staleQueue.storage.bookmarks) === 'b,a');
})().catch(function (err) {
    console.error('FAIL ' + err.message);
    process.exit(1);
});