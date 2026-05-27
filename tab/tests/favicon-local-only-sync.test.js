const fs = require('fs');
const vm = require('vm');

function assert(label, condition) {
    if (!condition) throw new Error(label);
    console.log('PASS ' + label);
}

const context = {
    console,
    Date,
    JSON,
    String,
    Error,
    Array,
    Object,
    Promise,
    crypto: {
        randomUUID() {
            return 'uuid-fixed';
        }
    },
    cloneSyncValue(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('tab/sync-auth.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('tab/sync-merge.js', 'utf8'), context);

(function run() {
    const shortcutDoc = context.buildActiveSyncItemDocument('shortcuts', {
        id: 's1',
        url: 'https://excel.officeapps.live.com/x/demo',
        name: 'Excel',
        favicon: 'https://old-local-icon.test/icon.png',
        updatedAt: 1000,
        position: 0
    });
    assert('active shortcut sync doc strips local-only favicon', !Object.prototype.hasOwnProperty.call(shortcutDoc, 'favicon'));

    const bookmarkDoc = context.buildActiveSyncItemDocument('bookmarks', {
        id: 'b1',
        url: 'https://docs.google.com/spreadsheets/d/demo/edit',
        name: 'Sheet',
        folderId: null,
        favicon: 'https://old-local-icon.test/sheet.png',
        updatedAt: 1000,
        position: 0
    });
    assert('active bookmark sync doc strips local-only favicon', !Object.prototype.hasOwnProperty.call(bookmarkDoc, 'favicon'));

    const localBookmarks = [{
        id: 'b1',
        url: 'https://docs.google.com/spreadsheets/d/demo/edit',
        name: 'Sheet local',
        folderId: null,
        favicon: 'https://local-icon.test/sheet.png',
        updatedAt: 1000,
        position: 0,
        orderKey: '1024'
    }];
    const remoteBookmarkDocs = [{
        id: 'b1',
        url: 'https://docs.google.com/spreadsheets/d/demo/edit',
        name: 'Sheet remote renamed',
        folderId: null,
        favicon: 'https://remote-icon.test/sheet.png',
        updatedAt: 2000,
        position: 0,
        orderKey: '1024',
        deletedAt: null
    }];
    const mergeResult = context.mergeRemoteSyncCollection('bookmarks', localBookmarks, remoteBookmarkDocs, {});
    assert('remote bookmark merge still applies newer synced fields', mergeResult.mergedItems[0].name === 'Sheet remote renamed');
    assert('remote bookmark merge preserves local-only favicon instead of remote favicon', mergeResult.mergedItems[0].favicon === 'https://local-icon.test/sheet.png');
})();