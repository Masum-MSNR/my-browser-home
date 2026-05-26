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
        _deleted: '{}',
        _syncDeletedState: JSON.stringify({ shortcuts: {}, bookmarks: {}, bookmarkFolders: {} })
    };
    const remoteLegacyDoc = {
        shortcuts: [{ id: 'remote-shortcut', url: 'https://remote-shortcut.test', name: 'remote shortcut', position: 0, updatedAt: 5000 }],
        bookmarks: [{ id: 'remote-bookmark', url: 'https://remote-bookmark.test', name: 'remote bookmark', folderId: null, position: 0, updatedAt: 5000 }],
        bookmarkFolders: [{ id: 'remote-folder', name: 'remote folder', parentId: null, position: 0, updatedAt: 5000 }],
        customBg: 'remote-bg',
        _deleted: {},
        _syncMeta: { rev: 5000 }
    };
    const remoteCollections = {
        shortcuts: [],
        bookmarks: [],
        bookmarkFolders: []
    };
    let remoteSettings = null;
    let remoteMeta = null;
    const remoteWrites = [];
    let releaseInitialGet = null;
    let initialGetPromise = null;
    const timeoutQueue = [];
    let nextTimeoutId = 1;
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
        setTimeout: function (fn, delay) {
            var entry = {
                id: nextTimeoutId++,
                fn: fn,
                delay: delay,
                cleared: false
            };
            timeoutQueue.push(entry);
            return entry.id;
        },
        clearTimeout: function (id) {
            for (var i = 0; i < timeoutQueue.length; i++) {
                if (timeoutQueue[i].id === id) timeoutQueue[i].cleared = true;
            }
        },
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
    [
        'tab/sync.js',
        'tab/sync-auth.js',
        'tab/sync-merge.js',
        'tab/sync-runtime.js'
    ].forEach(function (filePath) {
        vm.runInContext(fs.readFileSync(filePath, 'utf8'), context);
    });
    context.fbGet = async function (path) {
        if (initialGetPromise) await initialGetPromise;
        if (path === 'users/u1/data/main') return JSON.parse(JSON.stringify(remoteLegacyDoc));
        if (path === 'users/u1/settings/main') return remoteSettings ? JSON.parse(JSON.stringify(remoteSettings)) : null;
        if (path === 'users/u1/meta/sync') return remoteMeta ? JSON.parse(JSON.stringify(remoteMeta)) : null;
        return null;
    };
    context.fbSet = async function (path, obj) {
        remoteWrites.push({ path, obj: JSON.parse(JSON.stringify(obj)) });
        if (path === 'users/u1/settings/main') {
            remoteSettings = JSON.parse(JSON.stringify(obj));
            return;
        }
        if (path === 'users/u1/meta/sync') {
            remoteMeta = JSON.parse(JSON.stringify(obj));
            return;
        }
        if (path.indexOf('users/u1/shortcuts/') === 0) {
            remoteCollections.shortcuts = remoteCollections.shortcuts.filter(function (item) { return item.id !== obj.id; });
            remoteCollections.shortcuts.push(JSON.parse(JSON.stringify(obj)));
            return;
        }
        if (path.indexOf('users/u1/bookmarks/') === 0) {
            remoteCollections.bookmarks = remoteCollections.bookmarks.filter(function (item) { return item.id !== obj.id; });
            remoteCollections.bookmarks.push(JSON.parse(JSON.stringify(obj)));
            return;
        }
        if (path.indexOf('users/u1/bookmarkFolders/') === 0) {
            remoteCollections.bookmarkFolders = remoteCollections.bookmarkFolders.filter(function (item) { return item.id !== obj.id; });
            remoteCollections.bookmarkFolders.push(JSON.parse(JSON.stringify(obj)));
        }
    };
    context.fbListCollectionAll = async function (path) {
        if (path === 'users/u1/shortcuts') return JSON.parse(JSON.stringify(remoteCollections.shortcuts));
        if (path === 'users/u1/bookmarks') return JSON.parse(JSON.stringify(remoteCollections.bookmarks));
        if (path === 'users/u1/bookmarkFolders') return JSON.parse(JSON.stringify(remoteCollections.bookmarkFolders));
        return [];
    };
    context.fbToken = async function () { return 'token'; };
    return {
        context,
        storage,
        remoteCollections,
        remoteLegacyDoc,
        remoteWrites,
        localStorageData,
        getActiveTimeoutDelays: function () {
            var delays = [];
            for (var i = 0; i < timeoutQueue.length; i++) {
                if (!timeoutQueue[i].cleared) delays.push(timeoutQueue[i].delay);
            }
            return delays;
        },
        runTimeout: async function (delay) {
            for (var i = 0; i < timeoutQueue.length; i++) {
                if (!timeoutQueue[i].cleared && timeoutQueue[i].delay === delay) {
                    var entry = timeoutQueue.splice(i, 1)[0];
                    await entry.fn();
                    return true;
                }
            }
            return false;
        },
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
        var ao = Number(a && a.orderKey);
        var bo = Number(b && b.orderKey);
        if (!Number.isNaN(ao) && !Number.isNaN(bo) && ao !== bo) return ao - bo;
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
    await delayedInit;
    await waiter;
    assert('waitForSyncReady resolves without a startup remote pull', waitResolved === true);
    assert('initSync keeps local bookmarks before manual sync', ids(delayed.storage.bookmarks) === 'local-bookmark');
    assert('initSync keeps local folders before manual sync', ids(delayed.storage.bookmarkFolders) === 'local-folder');
    assert('initSync keeps local shortcuts before manual sync', ids(delayed.storage.shortcuts) === 'local-shortcut');

    const test = createSyncContext();

    test.context.markSyncDirty('bookmarks');
    await test.context.initSync();

    assert('pre-initial dirty bookmark mark is preserved', !!test.context.isSyncDirty('bookmarks'));
    assert('startup preserves local bookmarks until manual sync', ids(test.storage.bookmarks) === 'local-bookmark');
    assert('startup preserves local folders until manual sync', ids(test.storage.bookmarkFolders) === 'local-folder');
    assert('startup preserves local shortcuts until manual sync', ids(test.storage.shortcuts) === 'local-shortcut');

    test.storage.bookmarks.push({ id: 'local-added-bookmark', url: 'https://added.test', name: 'added', folderId: null, position: 1, updatedAt: 7000 });
    test.context.markSyncDirty('bookmarks');
    await test.context.fbSaveAll();

    const bookmarkWritePaths = test.remoteWrites.map(function (write) { return write.path; });
    assert('legacy sync doc is not rewritten during manual sync', bookmarkWritePaths.indexOf('users/u1/data/main') === -1);
    assert('manual sync migrates remote bookmark item docs', bookmarkWritePaths.indexOf('users/u1/bookmarks/remote-bookmark') !== -1);
    assert('manual sync writes local changed bookmark item doc', bookmarkWritePaths.indexOf('users/u1/bookmarks/local-added-bookmark') !== -1);
    assert('manual sync writes settings doc instead of legacy blob', bookmarkWritePaths.indexOf('users/u1/settings/main') !== -1);

    const autoSave = createSyncContext();
    autoSave.context.currentUser = { uid: 'u1', email: 'u@test.local', token: 'token' };
    autoSave.context.syncInitialized = true;
    autoSave.storage.bookmarks.push({ id: 'auto-bookmark', url: 'https://auto.test', name: 'auto', folderId: null, position: 1, updatedAt: 7000 });
    autoSave.context.markSyncDirty('bookmarks');
    autoSave.context.autoSync();
    assert('autoSync waits for 10s debounce before background sync work', autoSave.remoteWrites.length === 0 && autoSave.getActiveTimeoutDelays().indexOf(10000) !== -1);
    await autoSave.runTimeout(10000);
    assert('autoSync pushes dirty bookmarks after debounce', autoSave.remoteWrites.some(function (write) {
        return write.path === 'users/u1/bookmarks/auto-bookmark';
    }));

    const resumePending = createSyncContext();
    resumePending.localStorageData._syncDirtyState = JSON.stringify({ bookmarkFolders: Date.now(), customBg: Date.now() });
    resumePending.storage.bookmarkFolders.push({ id: 'resume-folder', name: 'resume', parentId: null, position: 1, updatedAt: 7000 });
    resumePending.storage.customBg = 'resume-bg';
    await resumePending.context.initSync();
    assert('initSync schedules autosync for persisted dirty state', resumePending.getActiveTimeoutDelays().indexOf(10000) !== -1);
    await resumePending.runTimeout(10000);
    assert('next open resumes pending bookmark folder sync', resumePending.remoteWrites.some(function (write) {
        return write.path === 'users/u1/bookmarkFolders/resume-folder';
    }));
    assert('next open resumes pending background sync', resumePending.remoteWrites.some(function (write) {
        return write.path === 'users/u1/settings/main' && write.obj.customBg === 'resume-bg';
    }));

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
    assert('dirty bookmark reorder remote write preserves local position order', idsByPosition(reorderSave.remoteCollections.bookmarks) === 'b,a');

    const orderKeyReorder = createSyncContext();
    Object.assign(orderKeyReorder.storage, {
        shortcuts: [],
        bookmarks: [
            { id: 'a', url: 'https://a.test', name: 'A', folderId: null, orderKey: '1024', position: 1, updatedAt: 1000 },
            { id: 'b', url: 'https://b.test', name: 'B', folderId: null, orderKey: '512', position: 0, updatedAt: 2000 }
        ],
        bookmarkFolders: [],
        customBg: null
    });
    orderKeyReorder.remoteCollections.bookmarks = [
        { id: 'a', url: 'https://a.test', name: 'A', folderId: null, orderKey: '1024', updatedAt: 1000, rev: 1000, deletedAt: null },
        { id: 'b', url: 'https://b.test', name: 'B', folderId: null, orderKey: '2048', updatedAt: 1000, rev: 1000, deletedAt: null }
    ];
    orderKeyReorder.context.currentUser = { uid: 'u1', email: 'u@test.local', token: 'token' };
    orderKeyReorder.context.syncInitialized = true;
    orderKeyReorder.context.fbGet = async function (path) {
        if (path === 'users/u1/meta/sync') return { schemaVersion: 2 };
        if (path === 'users/u1/settings/main') return null;
        if (path === 'users/u1/data/main') return null;
        return null;
    };
    orderKeyReorder.context.markSyncDirty('bookmarks');
    await orderKeyReorder.context.fbSaveAll();
    const orderKeyBookmarkWrites = orderKeyReorder.remoteWrites.filter(function (write) {
        return write.path.indexOf('users/u1/bookmarks/') === 0;
    });
    assert('orderKey reorder writes only changed bookmark item doc', orderKeyBookmarkWrites.length === 1 && orderKeyBookmarkWrites[0].path === 'users/u1/bookmarks/b');

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
    staleQueue.remoteCollections.bookmarks = [
        { id: 'a', url: 'https://a.test', name: 'A', folderId: null, position: 0, updatedAt: 1000, rev: 1000, deletedAt: null },
        { id: 'b', url: 'https://b.test', name: 'B', folderId: null, position: 1, updatedAt: 1000, rev: 1000, deletedAt: null }
    ];
    staleQueue.context.currentUser = { uid: 'u1', email: 'u@test.local', token: 'token' };
    staleQueue.context.syncInitialized = true;
    staleQueue.context.lastSeenRemoteRevision = 10;
    staleQueue.context.fbGet = async function (path) {
        if (path === 'users/u1/meta/sync') return { schemaVersion: 2 };
        if (path === 'users/u1/settings/main') return null;
        if (path === 'users/u1/data/main') return null;
        return null;
    };
    staleQueue.context.markSyncDirty('bookmarks');
    await staleQueue.context.fbSaveAll();
    assert('stale queued listener snapshot does not reset saved bookmark reorder', idsByPosition(staleQueue.storage.bookmarks) === 'b,a');

    const migration = createSyncContext();
    migration.context.currentUser = { uid: 'u1', email: 'u@test.local', token: 'token' };
    migration.context.syncInitialized = true;
    await migration.context.fbSaveAll();
    assert('legacy remote shortcut is migrated to per-item doc', ids(migration.remoteCollections.shortcuts).indexOf('remote-shortcut') !== -1);
    assert('legacy remote folder is migrated to per-item doc', ids(migration.remoteCollections.bookmarkFolders).indexOf('remote-folder') !== -1);

    const typedDeletes = createSyncContext();
    Object.assign(typedDeletes.storage, {
        shortcuts: [],
        bookmarks: [
            { id: 'shared-id', url: 'https://bookmark.test', name: 'bookmark', folderId: null, orderKey: '1024', position: 0, updatedAt: 1000 }
        ],
        bookmarkFolders: [],
        customBg: null
    });
    typedDeletes.remoteCollections.bookmarks = [
        { id: 'shared-id', url: 'https://bookmark.test', name: 'bookmark', folderId: null, orderKey: '1024', updatedAt: 1000, rev: 1000, deletedAt: null }
    ];
    typedDeletes.context.currentUser = { uid: 'u1', email: 'u@test.local', token: 'token' };
    typedDeletes.context.syncInitialized = true;
    typedDeletes.context.fbGet = async function (path) {
        if (path === 'users/u1/meta/sync') return { schemaVersion: 2 };
        if (path === 'users/u1/settings/main') return null;
        if (path === 'users/u1/data/main') return null;
        return null;
    };
    var typedDeleteTimestamp = Date.now();
    typedDeletes.context.addDeletedSyncTombstones('shortcuts', ['shared-id'], typedDeleteTimestamp);
    typedDeletes.context.markSyncDirty('shortcuts');
    await typedDeletes.context.fbSaveAll();
    assert('typed shortcut tombstone does not delete bookmark doc with same id', typedDeletes.remoteWrites.some(function (write) {
        return write.path === 'users/u1/shortcuts/shared-id' && write.obj.deletedAt === typedDeleteTimestamp;
    }) && !typedDeletes.remoteWrites.some(function (write) {
        return write.path === 'users/u1/bookmarks/shared-id' && write.obj.deletedAt === typedDeleteTimestamp;
    }));
})().catch(function (err) {
    console.error('FAIL ' + err.message);
    process.exit(1);
});