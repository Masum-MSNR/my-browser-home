const fs = require('fs');
const vm = require('vm');

function assert(label, condition) {
    if (!condition) throw new Error(label);
    console.log('PASS ' + label);
}

const opened = [];
const localLinks = {
    b2: 'http://localhost:3000/local-sheet'
};

const context = {
    console,
    Promise,
    Array,
    Object,
    String,
    getResolvedItemUrl(item, links) {
        return (links && links[item.id]) || item.url || '';
    },
    getAllBookmarksInFolder: async function (folderId) {
        if (folderId !== 'f1') return [];
        return [
            { id: 'b1', url: 'https://example.com' },
            { id: 'b2', url: 'https://docs.google.com/spreadsheets/d/demo/edit' },
            { id: 'b3', url: '' }
        ];
    },
    getBookmarkLocalLinks: async function () {
        return localLinks;
    },
    window: {
        open(url, target) {
            opened.push({ url, target });
        }
    },
    document: {}
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('tab/scripts/bookmarks-bar-interactions.js', 'utf8'), context);

(async function run() {
    assert('single bookmark middle-open uses blank target', context.openBookmarkInNewTab({ id: 'b1', url: 'https://example.com' }, {}) === true);
    assert('single bookmark middle-open records expected URL', opened[0] && opened[0].url === 'https://example.com' && opened[0].target === '_blank');

    var snapshotBookmarks = context.collectBookmarksInFolderSnapshot('f1', [
        { id: 'f1-child', parentId: 'f1' }
    ], [
        { id: 'b1', folderId: 'f1', url: 'https://example.com' },
        { id: 'b2', folderId: 'f1-child', url: 'https://docs.google.com/spreadsheets/d/demo/edit' },
        { id: 'b3', folderId: null, url: 'https://ignored.example.com' }
    ]);
    assert('folder snapshot collection includes nested folder bookmarks', snapshotBookmarks.length === 2);

    opened.length = 0;
    var snapshotOpened = context.openFolderBookmarksSnapshotInNewTabs('f1', [
        { id: 'f1-child', parentId: 'f1' }
    ], [
        { id: 'b1', folderId: 'f1', url: 'https://example.com' },
        { id: 'b2', folderId: 'f1-child', url: 'https://docs.google.com/spreadsheets/d/demo/edit' }
    ], localLinks);
    assert('folder snapshot middle-open opens nested bookmarks without async lookup', snapshotOpened === 2 && opened.length === 2);

    opened.length = 0;
    var openedCount = await context.openFolderBookmarksInNewTabs('f1');
    assert('folder middle-open opens only bookmarks with resolved URLs', openedCount === 2 && opened.length === 2);
    assert('folder middle-open preserves remote URL when no local override exists', opened[0].url === 'https://example.com');
    assert('folder middle-open prefers local override URLs', opened[1].url === 'http://localhost:3000/local-sheet');
})();