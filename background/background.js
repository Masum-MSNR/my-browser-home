importScripts('../tab/utils.js');

function getTrackedFaviconUrl(url, cb) {
    if (typeof cb !== "function") return;
    var normalizedUrl = typeof normalizeFaviconUrl === "function" ? normalizeFaviconUrl(url) : "";
    if (!normalizedUrl) {
        cb(null);
        return;
    }

    chrome.storage.local.get([
        "shortcuts",
        "bookmarks",
        SHORTCUT_LOCAL_LINKS_STORAGE_KEY,
        BOOKMARK_LOCAL_LINKS_STORAGE_KEY
    ], function (result) {
        var trackedUrls = {};
        var shortcuts = result && Array.isArray(result.shortcuts) ? result.shortcuts : [];
        var bookmarks = result && Array.isArray(result.bookmarks) ? result.bookmarks : [];
        var shortcutLocalLinks = typeof normalizeLocalLinkMap === "function"
            ? normalizeLocalLinkMap(result && result[SHORTCUT_LOCAL_LINKS_STORAGE_KEY])
            : {};
        var bookmarkLocalLinks = typeof normalizeLocalLinkMap === "function"
            ? normalizeLocalLinkMap(result && result[BOOKMARK_LOCAL_LINKS_STORAGE_KEY])
            : {};

        function addTrackedUrl(value) {
            if (!value || typeof normalizeFaviconUrl !== "function") return;
            var trackedUrl = normalizeFaviconUrl(value);
            if (trackedUrl) trackedUrls[trackedUrl] = true;
        }

        function addTrackedUrls(items, localLinks) {
            for (var i = 0; i < items.length; i++) {
                if (!items[i]) continue;
                addTrackedUrl(items[i].url);
                if (typeof getResolvedItemUrl === "function") {
                    addTrackedUrl(getResolvedItemUrl(items[i], localLinks));
                }
            }
        }

        addTrackedUrls(shortcuts, shortcutLocalLinks);
        addTrackedUrls(bookmarks, bookmarkLocalLinks);
        cb(trackedUrls[normalizedUrl] ? normalizedUrl : null);
    });
}

function storeTabFaviconCache(tab) {
    if (!tab || !tab.url) return;
    // Only cache for real http(s) pages — skip chrome://, file://, etc.
    if (!/^https?:\/\//i.test(tab.url)) return;
    getTrackedFaviconUrl(tab.url, function (trackedUrl) {
        if (!trackedUrl) return;

        var hasRealFavicon = !!(tab.favIconUrl && (typeof isFallbackFaviconUrl !== "function" || !isFallbackFaviconUrl(tab.favIconUrl)));
        if (!hasRealFavicon) {
            if (typeof getStoredFaviconEntry === "function") {
                getStoredFaviconEntry(trackedUrl).then(function (entry) {
                    if (!entry && typeof ensureDefaultFaviconEntry === "function") {
                        ensureDefaultFaviconEntry(trackedUrl);
                    }
                });
            } else if (typeof ensureDefaultFaviconEntry === "function") {
                ensureDefaultFaviconEntry(trackedUrl);
            }
            return;
        }

        if (typeof mergeStoredFaviconEntry === "function") {
            mergeStoredFaviconEntry(trackedUrl, {
                favicon: tab.favIconUrl,
                title: tab.title || tab.url,
                visitedUrl: trackedUrl,
                updatedAt: Date.now()
            });
        }

        if (typeof primeFaviconCache === "function") {
            primeFaviconCache(trackedUrl, tab.favIconUrl, tab.favIconUrl, { forceRefresh: true });
        }
    });
}

function maybeStoreUpdatedFavicon(changeInfo, tab) {
    if (!tab) return;
    if (changeInfo && changeInfo.favIconUrl) {
        storeTabFaviconCache({
            url: tab.url,
            favIconUrl: changeInfo.favIconUrl,
            title: tab.title || tab.url
        });
        return;
    }
    if (changeInfo && changeInfo.status === "complete" && tab.favIconUrl) {
        storeTabFaviconCache(tab);
    }
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    maybeStoreUpdatedFavicon(changeInfo, tab);
});

chrome.webNavigation.onCompleted.addListener(function (details) {
    if (details.frameId !== 0) return;
    var tabId = details.tabId;
    chrome.tabs.get(tabId, function (tab) {
        storeTabFaviconCache(tab);
    });
});

var CLIENT_ID = "692720523871-cd6v5ba5ancrjj92iljqhhcr7vrbl8sn.apps.googleusercontent.com";

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === "GET_AUTH_TOKEN") {
        var interactive = request.interactive !== false;
        var prompt = request.prompt || (interactive ? "select_account" : "none");
        var redirectUri = "https://" + chrome.runtime.id + ".chromiumapp.org/";
        var nonce = Math.random().toString(36).substring(2, 15);
        var authUrl =
            "https://accounts.google.com/o/oauth2/v2/auth" +
            "?client_id=" + encodeURIComponent(CLIENT_ID) +
            "&response_type=id_token" +
            "&redirect_uri=" + encodeURIComponent(redirectUri) +
            "&scope=" + encodeURIComponent("openid email profile") +
            "&nonce=" + nonce +
            "&prompt=" + encodeURIComponent(prompt);

        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: interactive }, function (redirectUrl) {
            if (chrome.runtime.lastError || !redirectUrl) {
                sendResponse({ error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "No redirect" });
                return;
            }
            try {
                var hash = redirectUrl.split("#")[1] || "";
                var params = new URLSearchParams(hash);
                var idToken = params.get("id_token");
                if (idToken) {
                    sendResponse({ idToken: idToken, redirectUri: redirectUri });
                } else {
                    sendResponse({ error: "No id_token returned" });
                }
            } catch (e) {
                sendResponse({ error: e.message });
            }
        });
        return true;
    }
    if (request.type === "CLEAR_AUTH_TOKEN") {
        sendResponse({ done: true });
        return true;
    }
});
