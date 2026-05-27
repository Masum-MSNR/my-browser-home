const fs = require('fs');
const vm = require('vm');

function assert(label, condition) {
    if (!condition) throw new Error(label);
    console.log('PASS ' + label);
}

function createCacheContext() {
    const storageLocal = {};
    const context = {
        console,
        Date,
        JSON,
        String,
        URL,
        Error,
        Array,
        Object,
        Promise,
        DEFAULT_FAVICON: 'data:default',
        localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        chrome: {
            storage: {
                local: {
                    get(key, cb) {
                        if (typeof key === 'string') {
                            cb(storageLocal[key] ? { [key]: storageLocal[key] } : {});
                            return;
                        }
                        cb({});
                    },
                    set(obj, cb) {
                        Object.assign(storageLocal, obj || {});
                        if (typeof cb === 'function') cb();
                    }
                },
                onChanged: { addListener() {} }
            }
        },
        reportHandledIssue() {},
        getResolvedItemUrl(item, localLinks) {
            return (localLinks && localLinks[item.id]) || item.url || '';
        }
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync('tab/utils-favicon-cache.js', 'utf8'), context);
    return { context, storageLocal };
}

function createBackgroundContext() {
    const context = {
        console,
        Date,
        JSON,
        String,
        URL,
        Error,
        Array,
        Object,
        Promise,
        importScripts() {},
        SHORTCUT_LOCAL_LINKS_STORAGE_KEY: '_shortcutLocalLinks',
        BOOKMARK_LOCAL_LINKS_STORAGE_KEY: '_bookmarkLocalLinks',
        normalizeFaviconUrl(url) {
            try {
                const parsed = new URL(url);
                parsed.hash = '';
                return parsed.href;
            } catch (error) {
                return '';
            }
        },
        normalizeLocalLinkMap(value) {
            return value && typeof value === 'object' ? value : {};
        },
        getResolvedItemUrl(item, localLinks) {
            return (localLinks && localLinks[item.id]) || item.url || '';
        },
        chrome: {
            storage: {
                local: {
                    get(_keys, cb) { cb({}); }
                },
                onChanged: { addListener() {} }
            },
            tabs: {
                onUpdated: { addListener() {} },
                onRemoved: { addListener() {} },
                get(_tabId, _cb) {}
            },
            webNavigation: {
                onCompleted: { addListener() {} }
            },
            runtime: {
                onMessage: { addListener() {} }
            },
            identity: {}
        }
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync('background/background.js', 'utf8'), context);
    return context;
}

(async function run() {
    const cacheTest = createCacheContext();
    const bookmarkUrl = 'https://docs.google.com/document/d/demo/edit?usp=sharing';
    const cacheKey = cacheTest.context.getFaviconCacheKey(bookmarkUrl);
    cacheTest.storageLocal[cacheKey] = {
        url: cacheTest.context.normalizeFaviconUrl(bookmarkUrl),
        favicon: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico',
        faviconDataUrl: 'data:image/png;base64,AAAA',
        updatedAt: Date.now()
    };

    const items = [{ id: 'b1', url: bookmarkUrl, favicon: 'data:default', updatedAt: 77 }];
    const updates = await cacheTest.context.collectCachedFaviconBackfillUpdates(items, {});
    assert('cache backfill collects recovered favicon updates', updates.length === 1 && updates[0].favicon === 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico');
    assert('cache backfill applies recovered favicon updates without mutating item revision', cacheTest.context.applyCachedFaviconBackfillUpdates(items, updates) && items[0].favicon === 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico' && items[0].updatedAt === 77);

    const backgroundTest = createBackgroundContext();
    const trackedUrls = [
        'https://example.com/article?from=sync',
        'https://docs.google.com/document/u/0/',
        'https://docs.google.com/spreadsheets/u/0/'
    ];

    const canonicalMatches = backgroundTest.matchTrackedFaviconUrls('https://example.com/article', trackedUrls);
    assert('background favicon recovery matches canonical URLs without query params', canonicalMatches.length === 1 && canonicalMatches[0] === 'https://example.com/article?from=sync');

    const scopedMatches = backgroundTest.matchTrackedFaviconUrls('https://docs.google.com/document/d/demo/edit?tab=t.0', trackedUrls);
    assert('background favicon recovery matches same app section on the same origin', scopedMatches.length === 1 && scopedMatches[0] === 'https://docs.google.com/document/u/0/');

    const mismatchedMatches = backgroundTest.matchTrackedFaviconUrls('https://docs.google.com/spreadsheets/d/demo/edit', ['https://docs.google.com/document/u/0/']);
    assert('background favicon recovery does not cross different app sections on the same origin', mismatchedMatches.length === 0);

    backgroundTest.rememberTrackedFaviconUrlsForTab(17, ['https://1drv.ms/x/c/demo-share-link']);
    const redirectedMatches = await new Promise(function (resolve) {
        backgroundTest.getTrackedFaviconUrlsForTab(17, 'https://excel.officeapps.live.com/x/_layouts/xlviewerinternal.aspx?id=demo', resolve);
    });
    assert('background favicon recovery preserves tracked source URLs across cross-origin redirects in the same tab', redirectedMatches.length === 1 && redirectedMatches[0] === 'https://1drv.ms/x/c/demo-share-link');

    backgroundTest.clearRememberedTrackedFaviconUrlsForTab(17);
    const clearedMatches = await new Promise(function (resolve) {
        backgroundTest.getTrackedFaviconUrlsForTab(17, 'https://excel.officeapps.live.com/x/_layouts/xlviewerinternal.aspx?id=demo', resolve);
    });
    assert('background favicon redirect memory clears after navigation completes', clearedMatches.length === 0);
})();