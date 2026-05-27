const fs = require('fs');
const vm = require('vm');

function assert(label, condition) {
  if (!condition) throw new Error(label);
  console.log('PASS ' + label);
}

function createContext() {
  const storageLocal = {};
  const listeners = {
    storageChanged: [],
    runtimeMessage: []
  };
  const localMirror = {};

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
    setTimeout,
    clearTimeout,
    SHORTCUT_LOCAL_LINKS_STORAGE_KEY: '_shortcutLocalLinks',
    BOOKMARK_LOCAL_LINKS_STORAGE_KEY: '_bookmarkLocalLinks',
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(localMirror, key) ? localMirror[key] : null;
      },
      setItem(key, value) {
        localMirror[key] = String(value);
      },
      removeItem(key) {
        delete localMirror[key];
      }
    },
    btoa(value) {
      return Buffer.from(value, 'binary').toString('base64');
    },
    fetch: async function () {
      return {
        ok: true,
        headers: {
          get(name) {
            return name === 'content-type' ? 'image/png' : null;
          }
        },
        arrayBuffer: async function () {
          return Buffer.from('AQID', 'base64');
        }
      };
    },
    reportHandledIssue() {},
    chrome: {
      storage: {
        local: {
          get(keys, cb) {
            if (typeof keys === 'string') {
              cb(Object.prototype.hasOwnProperty.call(storageLocal, keys) ? { [keys]: storageLocal[keys] } : {});
              return;
            }

            const result = {};
            const requestKeys = Array.isArray(keys) ? keys : Object.keys(keys || {});
            for (const key of requestKeys) {
              if (Object.prototype.hasOwnProperty.call(storageLocal, key)) result[key] = storageLocal[key];
            }
            cb(result);
          },
          set(obj, cb) {
            Object.assign(storageLocal, obj || {});
            const changes = {};
            for (const key of Object.keys(obj || {})) {
              changes[key] = { newValue: obj[key] };
            }
            for (const listener of listeners.storageChanged) {
              listener(changes, 'local');
            }
            if (typeof cb === 'function') cb();
          }
        },
        onChanged: {
          addListener(listener) {
            listeners.storageChanged.push(listener);
          }
        }
      },
      tabs: {
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} },
        update(tabId, info, cb) {
          if (typeof cb === 'function') cb({ id: tabId, url: info.url });
        },
        create(info, cb) {
          if (typeof cb === 'function') cb({ id: 91, url: info.url });
        },
        get(tabId, cb) {
          if (typeof cb === 'function') cb({ id: tabId, url: 'https://almasum.dev/' });
        }
      },
      webNavigation: {
        onCompleted: { addListener() {} }
      },
      runtime: {
        lastError: null,
        getURL(path) {
          return 'chrome-extension://test/' + path;
        },
        onMessage: {
          addListener(listener) {
            listeners.runtimeMessage.push(listener);
          }
        }
      },
      identity: {}
    },
    importScripts(...paths) {
      for (const relativePath of paths) {
        const filePath = relativePath.replace(/^\.\.\/tab\//, 'tab/');
        vm.runInContext(fs.readFileSync(filePath, 'utf8'), context);
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('background/background.js', 'utf8'), context);

  return { context, storageLocal, listeners };
}

(async function run() {
  const test = createContext();

  test.storageLocal.shortcuts = [
    { id: 'shortcut-a', name: 'Almasum', url: 'https://almasum.dev/' },
    { id: 'shortcut-b', name: 'Cloudflare', url: 'https://cloudflare.com/' }
  ];
  test.storageLocal.bookmarks = [];
  test.storageLocal._shortcutLocalLinks = {};
  test.storageLocal._bookmarkLocalLinks = {};

  const refs = await test.context.getSavedItemRefsFromStorage();
  const exactMatches = test.context.findSavedItemRefsByExactUrl('https://almasum.dev/', refs);
  assert('exact URL matching updates only the saved item with the same URL', exactMatches.length === 1 && exactMatches[0].itemId === 'shortcut-a');

  await test.context.setSavedItemFaviconRecord({
    itemId: 'shortcut-a',
    kind: 'shortcut',
    effectiveUrlSnapshot: 'https://almasum.dev/',
    iconDataUrl: 'data:image/png;base64,AAAA',
    status: 'ready',
    updatedAt: 1
  });
  assert('render uses a saved icon only when the item URL snapshot still matches', test.context.getRenderableSavedItemFavicon(test.context.getSavedItemFaviconRecordSync('shortcut-a'), 'https://cloudflare.com/') === '');
  assert('render keeps the saved icon for the exact same item URL', test.context.getRenderableSavedItemFavicon(test.context.getSavedItemFaviconRecordSync('shortcut-a'), 'https://almasum.dev/') === 'data:image/png;base64,AAAA');

  await test.context.setSavedItemFaviconRecord({
    itemId: 'shortcut-a',
    kind: 'shortcut',
    effectiveUrlSnapshot: 'https://cloudflare.com/',
    status: 'missing',
    updatedAt: 2
  });
  const preservedRecord = test.context.getSavedItemFaviconRecordSync('shortcut-a');
  assert('a failed refresh does not downgrade an existing good icon', preservedRecord && preservedRecord.status === 'ready' && preservedRecord.effectiveUrlSnapshot === 'https://almasum.dev/');

  test.context.rememberFaviconTabBinding(7, {
    itemId: 'shortcut-a',
    kind: 'shortcut',
    effectiveUrl: 'https://almasum.dev/'
  });
  const binding = test.context.getFaviconTabBinding(7);
  assert('launch-time tab binding temporarily allows the initial redirect chain', test.context.isFaviconBindingAllowedForUrl(binding, 'https://cloudflare.com/cdn-cgi/') === true);
  test.context.finalizeFaviconTabBinding(binding, 'https://almasum.dev/');
  assert('after the first real load the tab binding stays scoped to that origin', test.context.isFaviconBindingAllowedForUrl(binding, 'https://almasum.dev/about') === true && test.context.isFaviconBindingAllowedForUrl(binding, 'https://cloudflare.com/') === false);

  await test.context.captureSavedItemFavicon({
    itemId: 'shortcut-b',
    kind: 'shortcut',
    effectiveUrl: 'https://cloudflare.com/'
  }, {
    sourceType: 'save-probe',
    forceRefresh: true
  });
  const cloudflareRecord = test.context.getSavedItemFaviconRecordSync('shortcut-b');
  assert('capture stores favicon data on the targeted item only', cloudflareRecord && cloudflareRecord.status === 'ready' && cloudflareRecord.effectiveUrlSnapshot === 'https://cloudflare.com/' && test.context.getSavedItemFaviconRecordSync('shortcut-a').effectiveUrlSnapshot === 'https://almasum.dev/');

  const openNewTabListener = test.listeners.runtimeMessage[0];
  const openResponse = await new Promise(function (resolve) {
    openNewTabListener({
      type: test.context.ITEM_FAVICON_OPEN_NEW_TAB_MESSAGE,
      itemId: 'shortcut-a',
      kind: 'shortcut',
      url: 'https://almasum.dev/'
    }, {}, resolve);
  });
  assert('opening a saved item in a new tab binds that specific tab to that item', openResponse && openResponse.ok === true && test.context.getFaviconTabBinding(91).itemId === 'shortcut-a');
})();