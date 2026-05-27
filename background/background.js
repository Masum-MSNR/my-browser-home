importScripts(
    '../tab/utils.js',
    '../tab/utils-favicon-cache.js',
    '../tab/utils-favicon-fetch.js',
    '../tab/utils-favicon-render.js'
);

var trackedFaviconUrlsByTabId = {};

function mergeTrackedFaviconUrlLists(left, right) {
    var merged = [];
    var seen = {};
    var lists = [left, right];

    for (var i = 0; i < lists.length; i++) {
        var list = Array.isArray(lists[i]) ? lists[i] : [];
        for (var j = 0; j < list.length; j++) {
            if (!list[j] || seen[list[j]]) continue;
            seen[list[j]] = true;
            merged.push(list[j]);
        }
    }

    return merged;
}

function rememberTrackedFaviconUrlsForTab(tabId, trackedUrls) {
    if (typeof tabId !== "number" || !Array.isArray(trackedUrls) || trackedUrls.length === 0) return;
    trackedFaviconUrlsByTabId[tabId] = mergeTrackedFaviconUrlLists(trackedFaviconUrlsByTabId[tabId], trackedUrls);
}

function getRememberedTrackedFaviconUrlsForTab(tabId) {
    if (typeof tabId !== "number") return [];
    return Array.isArray(trackedFaviconUrlsByTabId[tabId]) ? trackedFaviconUrlsByTabId[tabId].slice() : [];
}

function clearRememberedTrackedFaviconUrlsForTab(tabId) {
    if (typeof tabId !== "number") return;
    delete trackedFaviconUrlsByTabId[tabId];
}

function getTrackedFaviconMatchInfo(url) {
    var normalizedUrl = typeof normalizeFaviconUrl === "function" ? normalizeFaviconUrl(url) : "";
    if (!normalizedUrl) return null;

    try {
        var parsed = new URL(normalizedUrl);
        var pathname = parsed.pathname || "/";
        var segments = pathname.split("/").filter(Boolean);
        return {
            normalizedUrl: normalizedUrl,
            canonicalUrl: parsed.origin + pathname,
            origin: parsed.origin,
            firstPathSegment: segments.length > 0 ? segments[0] : ""
        };
    } catch (e) {
        return null;
    }
}

function matchTrackedFaviconUrls(url, trackedUrls) {
    var target = getTrackedFaviconMatchInfo(url);
    if (!target || !Array.isArray(trackedUrls) || trackedUrls.length === 0) return [];

    var exactMatches = [];
    var canonicalMatches = [];
    var scopedMatches = [];
    var seen = {};

    function addMatch(bucket, matchedUrl) {
        if (!matchedUrl || seen[matchedUrl]) return;
        bucket.push(matchedUrl);
        seen[matchedUrl] = true;
    }

    for (var i = 0; i < trackedUrls.length; i++) {
        var tracked = getTrackedFaviconMatchInfo(trackedUrls[i]);
        if (!tracked) continue;

        if (tracked.normalizedUrl === target.normalizedUrl) {
            addMatch(exactMatches, tracked.normalizedUrl);
            continue;
        }

        if (tracked.canonicalUrl === target.canonicalUrl) {
            addMatch(canonicalMatches, tracked.normalizedUrl);
            continue;
        }

        if (tracked.origin === target.origin && tracked.firstPathSegment && tracked.firstPathSegment === target.firstPathSegment) {
            addMatch(scopedMatches, tracked.normalizedUrl);
        }
    }

    if (exactMatches.length > 0) return exactMatches;
    if (canonicalMatches.length > 0) return canonicalMatches;
    return scopedMatches;
}

function getTrackedFaviconUrls(url, cb) {
    if (typeof cb !== "function") return;
    var normalizedUrl = typeof normalizeFaviconUrl === "function" ? normalizeFaviconUrl(url) : "";
    if (!normalizedUrl) {
        cb([]);
        return;
    }

    chrome.storage.local.get([
        "shortcuts",
        "bookmarks",
        SHORTCUT_LOCAL_LINKS_STORAGE_KEY,
        BOOKMARK_LOCAL_LINKS_STORAGE_KEY
    ], function (result) {
        var trackedUrls = [];
        var trackedUrlSet = {};
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
            if (!trackedUrl || trackedUrlSet[trackedUrl]) return;
            trackedUrlSet[trackedUrl] = true;
            trackedUrls.push(trackedUrl);
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
        cb(matchTrackedFaviconUrls(normalizedUrl, trackedUrls));
    });
}

function getTrackedFaviconUrlsForTab(tabId, url, cb) {
    if (typeof cb !== "function") return;
    var rememberedTrackedUrls = getRememberedTrackedFaviconUrlsForTab(tabId);
    getTrackedFaviconUrls(url, function (trackedUrls) {
        cb(mergeTrackedFaviconUrlLists(rememberedTrackedUrls, trackedUrls));
    });
}

function storeTabFaviconCache(tab, tabId) {
    if (!tab || !tab.url) return;
    // Only cache for real http(s) pages — skip chrome://, file://, etc.
    if (!/^https?:\/\//i.test(tab.url)) return;
    getTrackedFaviconUrlsForTab(tabId, tab.url, function (trackedUrls) {
        if (!Array.isArray(trackedUrls) || trackedUrls.length === 0) return;

        var observedFaviconUrl = tab.favIconUrl || "";
        var hasObservedFavicon = !!observedFaviconUrl;
        var hasRealFavicon = !!(tab.favIconUrl && (typeof isFallbackFaviconUrl !== "function" || !isFallbackFaviconUrl(tab.favIconUrl)));
        if (!hasObservedFavicon) {
            for (var i = 0; i < trackedUrls.length; i++) {
                (function (trackedUrl) {
                    if (typeof getStoredFaviconEntry === "function") {
                        getStoredFaviconEntry(trackedUrl).then(function (entry) {
                            if (!entry && typeof ensureDefaultFaviconEntry === "function") {
                                ensureDefaultFaviconEntry(trackedUrl);
                            }
                        });
                    } else if (typeof ensureDefaultFaviconEntry === "function") {
                        ensureDefaultFaviconEntry(trackedUrl);
                    }
                })(trackedUrls[i]);
            }
            return;
        }

        for (var j = 0; j < trackedUrls.length; j++) {
            var trackedUrl = trackedUrls[j];
            if (typeof mergeStoredFaviconEntry === "function") {
                var entryUpdate = {
                    title: tab.title || tab.url,
                    visitedUrl: trackedUrl,
                    observedFaviconUrl: observedFaviconUrl,
                    updatedAt: Date.now()
                };
                if (hasRealFavicon) entryUpdate.favicon = observedFaviconUrl;
                mergeStoredFaviconEntry(trackedUrl, entryUpdate);
            }

            if (hasRealFavicon && typeof primeFaviconCache === "function") {
                primeFaviconCache(trackedUrl, observedFaviconUrl, observedFaviconUrl, { forceRefresh: true });
            }
        }

        clearRememberedTrackedFaviconUrlsForTab(tabId);
    });
}

function maybeStoreUpdatedFavicon(tabId, changeInfo, tab) {
    if (!tab) return;
    if (changeInfo && changeInfo.favIconUrl) {
        storeTabFaviconCache({
            url: tab.url,
            favIconUrl: changeInfo.favIconUrl,
            title: tab.title || tab.url
        }, tabId);
        return;
    }
    if (changeInfo && changeInfo.status === "complete" && tab.favIconUrl) {
        storeTabFaviconCache(tab, tabId);
    }
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo && changeInfo.status === "loading") {
        clearRememberedTrackedFaviconUrlsForTab(tabId);
    }

    if (changeInfo && changeInfo.url) {
        getTrackedFaviconUrls(changeInfo.url, function (trackedUrls) {
            rememberTrackedFaviconUrlsForTab(tabId, trackedUrls);
        });
    }

    maybeStoreUpdatedFavicon(tabId, changeInfo, tab);
});

chrome.webNavigation.onCompleted.addListener(function (details) {
    if (details.frameId !== 0) return;
    var tabId = details.tabId;
    chrome.tabs.get(tabId, function (tab) {
        storeTabFaviconCache(tab, tabId);
    });
});

chrome.tabs.onRemoved.addListener(function (tabId) {
    clearRememberedTrackedFaviconUrlsForTab(tabId);
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
