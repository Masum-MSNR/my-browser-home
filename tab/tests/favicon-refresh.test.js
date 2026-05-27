const fs = require('fs');
const vm = require('vm');

function assert(label, condition) {
    if (!condition) throw new Error(label);
    console.log('PASS ' + label);
}

function createContext() {
    const storageLocal = {};
    const fetchCalls = [];
    let nextResponseBase64 = 'b2xk';

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
        Buffer,
        DEFAULT_FAVICON: 'data:default',
        pendingFaviconCacheRequests: {},
        document: {},
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
                            cb({ [key]: storageLocal[key] });
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
        btoa(value) {
            return Buffer.from(value, 'binary').toString('base64');
        },
        fetch: async function (url, options) {
            fetchCalls.push({ url, options: options || {} });
            return {
                ok: true,
                headers: {
                    get(name) {
                        return name === 'content-type' ? 'image/png' : null;
                    }
                },
                arrayBuffer: async function () {
                    return Buffer.from(nextResponseBase64, 'base64');
                }
            };
        }
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync('tab/utils-favicon-cache.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('tab/utils-favicon-fetch.js', 'utf8'), context);

    return {
        context,
        fetchCalls,
        setResponseBase64(value) {
            nextResponseBase64 = value;
        }
    };
}

(async function run() {
    const test = createContext();
    const url = 'https://docs.google.com/spreadsheets/d/demo/edit';
    const faviconUrl = 'https://ssl.gstatic.com/docs/doclist/images/mediatype/icon_1_spreadsheet_x16.png';

    test.setResponseBase64('b2xk');
    await test.context.primeFaviconCache(url, faviconUrl, faviconUrl, { forceRefresh: false });
    let cached = test.context.getCachedFaviconEntrySync(url);
    assert('initial favicon fetch stores data url', !!(cached && cached.faviconDataUrl && cached.faviconDataUrl !== 'data:default'));
    assert('non-forced favicon fetch uses browser cache', test.fetchCalls[0] && test.fetchCalls[0].options.cache === 'force-cache');

    test.setResponseBase64('bmV3');
    await test.context.primeFaviconCache(url, faviconUrl, faviconUrl, { forceRefresh: true });
    cached = test.context.getCachedFaviconEntrySync(url);

    assert('forced favicon refresh bypasses browser cache', test.fetchCalls[1] && test.fetchCalls[1].options.cache === 'no-store');
    assert('forced favicon refresh replaces stale cached data url', cached && /bmV3$/.test(cached.faviconDataUrl));

    const noRealUrlTest = createContext();
    const fallbackOnlyResult = await noRealUrlTest.context.requestFaviconCacheRefresh('https://1drv.ms/x/c/demo-share-link', null);
    assert('save-time favicon refresh does not fetch speculative fallback icons when no real favicon has been observed', noRealUrlTest.fetchCalls.length === 0);
    assert('save-time favicon refresh falls back to default when no real favicon has been observed', fallbackOnlyResult && fallbackOnlyResult.realUrl === 'data:default');
})();