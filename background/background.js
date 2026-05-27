importScripts(
    '../tab/utils.js',
    '../tab/favicon-core.js',
    '../tab/favicon-capture.js'
);

var faviconTabBindingsByTabId = {};
var pendingTabFaviconCaptureTimersByTabId = {};

function rememberFaviconTabBinding(tabId, ref) {
    if (typeof tabId !== 'number' || !ref || !ref.itemId) return;
    faviconTabBindingsByTabId[tabId] = {
        itemId: String(ref.itemId),
        kind: normalizeSavedItemKind(ref.kind),
        effectiveUrl: normalizeFaviconUrl(ref.effectiveUrl),
        pendingNavigation: true,
        scopeOrigin: '',
        updatedAt: Date.now()
    };
}

function getFaviconTabBinding(tabId) {
    return typeof tabId === 'number' ? faviconTabBindingsByTabId[tabId] || null : null;
}

function clearPendingTabFaviconCapture(tabId) {
    if (typeof tabId !== 'number' || !pendingTabFaviconCaptureTimersByTabId[tabId]) return;
    clearTimeout(pendingTabFaviconCaptureTimersByTabId[tabId]);
    delete pendingTabFaviconCaptureTimersByTabId[tabId];
}

function clearFaviconTabBinding(tabId) {
    if (typeof tabId !== 'number') return;
    clearPendingTabFaviconCapture(tabId);
    delete faviconTabBindingsByTabId[tabId];
}

function finalizeFaviconTabBinding(binding, pageUrl) {
    if (!binding) return;
    var origin = getFaviconUrlOrigin(pageUrl);
    if (!origin) return;
    binding.pendingNavigation = false;
    binding.scopeOrigin = origin;
    binding.updatedAt = Date.now();
}

function isFaviconBindingAllowedForUrl(binding, pageUrl) {
    if (!binding) return false;
    var normalizedUrl = normalizeFaviconUrl(pageUrl);
    if (!normalizedUrl) return false;
    if (binding.pendingNavigation) return true;
    return !!binding.scopeOrigin && getFaviconUrlOrigin(normalizedUrl) === binding.scopeOrigin;
}

function resolveFaviconTargetsForTab(tabId, pageUrl) {
    return getSavedItemRefsFromStorage().then(function (refs) {
        var binding = getFaviconTabBinding(tabId);
        var targets = [];

        if (binding) {
            var boundRef = findSavedItemRefById(refs, binding.kind, binding.itemId);
            if (!boundRef) {
                clearFaviconTabBinding(tabId);
                binding = null;
            } else if (isFaviconBindingAllowedForUrl(binding, pageUrl)) {
                targets.push(boundRef);
            } else {
                clearFaviconTabBinding(tabId);
                binding = null;
            }
        }

        if (!targets.length) {
            targets = findSavedItemRefsByExactUrl(pageUrl, refs);
        }

        return {
            binding: binding,
            targets: targets
        };
    });
}

function captureLatestSavedItemFaviconForTab(tabId, tab, sourceType) {
    if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) return Promise.resolve([]);

    return resolveFaviconTargetsForTab(tabId, tab.url).then(function (resolved) {
        if (resolved.binding && resolved.binding.pendingNavigation) {
            finalizeFaviconTabBinding(resolved.binding, tab.url);
        }
        if (!Array.isArray(resolved.targets) || resolved.targets.length === 0) return [];

        var captureJobs = [];
        for (var i = 0; i < resolved.targets.length; i++) {
            captureJobs.push(captureSavedItemFavicon(resolved.targets[i], {
                finalVisitedUrl: tab.url,
                preferredSourceUrl: tab.favIconUrl || '',
                sourceType: sourceType || 'tab-visit',
                forceRefresh: true
            }));
        }
        return Promise.all(captureJobs);
    });
}

function scheduleTabFaviconCapture(tabId, tab, sourceType, delayMs) {
    if (typeof tabId !== 'number' || !tab || !tab.url) return;

    clearPendingTabFaviconCapture(tabId);
    var snapshot = {
        url: tab.url,
        favIconUrl: tab.favIconUrl || '',
        title: tab.title || ''
    };

    pendingTabFaviconCaptureTimersByTabId[tabId] = setTimeout(function () {
        delete pendingTabFaviconCaptureTimersByTabId[tabId];
        captureLatestSavedItemFaviconForTab(tabId, snapshot, sourceType);
    }, typeof delayMs === 'number' ? delayMs : 0);
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo && changeInfo.url) {
        var binding = getFaviconTabBinding(tabId);
        if (binding && !binding.pendingNavigation && !isFaviconBindingAllowedForUrl(binding, changeInfo.url)) {
            clearFaviconTabBinding(tabId);
        }
    }

    if (changeInfo && changeInfo.favIconUrl) {
        scheduleTabFaviconCapture(tabId, {
            url: tab && tab.url ? tab.url : changeInfo.url || '',
            favIconUrl: changeInfo.favIconUrl,
            title: tab && tab.title ? tab.title : ''
        }, 'tab-visit', 0);
    }

    if (changeInfo && changeInfo.status === 'complete' && tab && tab.url) {
        scheduleTabFaviconCapture(tabId, tab, 'tab-visit', 150);
    }
});

chrome.webNavigation.onCompleted.addListener(function (details) {
    if (details.frameId !== 0) return;
    chrome.tabs.get(details.tabId, function (tab) {
        if (chrome.runtime.lastError || !tab) return;
        scheduleTabFaviconCapture(details.tabId, tab, 'tab-visit', 0);
    });
});

chrome.tabs.onRemoved.addListener(function (tabId) {
    clearFaviconTabBinding(tabId);
});

var CLIENT_ID = "692720523871-cd6v5ba5ancrjj92iljqhhcr7vrbl8sn.apps.googleusercontent.com";

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === ITEM_FAVICON_OPEN_CURRENT_TAB_MESSAGE) {
        var currentUrl = normalizeFaviconUrl(request.url || '');
        var currentKind = normalizeSavedItemKind(request.kind);
        var currentTabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
        if (!currentTabId || !request.itemId || !currentKind || !currentUrl) {
            sendResponse({ ok: false });
            return true;
        }

        rememberFaviconTabBinding(currentTabId, {
            itemId: request.itemId,
            kind: currentKind,
            effectiveUrl: currentUrl
        });

        chrome.tabs.update(currentTabId, { url: currentUrl }, function () {
            if (chrome.runtime.lastError) {
                clearFaviconTabBinding(currentTabId);
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            sendResponse({ ok: true });
        });
        return true;
    }
    if (request.type === ITEM_FAVICON_OPEN_NEW_TAB_MESSAGE) {
        var nextUrl = normalizeFaviconUrl(request.url || '');
        var nextKind = normalizeSavedItemKind(request.kind);
        if (!request.itemId || !nextKind || !nextUrl) {
            sendResponse({ ok: false });
            return true;
        }

        chrome.tabs.create({ url: nextUrl }, function (tab) {
            if (chrome.runtime.lastError || !tab || typeof tab.id !== 'number') {
                sendResponse({ ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Unable to open tab' });
                return;
            }
            rememberFaviconTabBinding(tab.id, {
                itemId: request.itemId,
                kind: nextKind,
                effectiveUrl: nextUrl
            });
            sendResponse({ ok: true, tabId: tab.id });
        });
        return true;
    }
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
