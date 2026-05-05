chrome.webNavigation.onCompleted.addListener(async function (details) {
    var tabId = details.tabId;

    chrome.tabs.get(tabId, async function (tab) {
        if (!tab || !tab.url || !tab.favIconUrl) return;

        var rootDomain = getFullDomain(tab.url);
        if (!rootDomain) return;

        var pageData = {
            url: tab.url,
            favicon: tab.favIconUrl,
            title: tab.title || tab.url
        };

        chrome.storage.local.set({ [rootDomain]: pageData });
    });
});

function getFullDomain(url) {
    try {
        var hostname = new URL(url).hostname.toLowerCase();
        return hostname.replace(/^www\./, '');
    } catch (e) {
        console.warn("Invalid URL:", url);
        return '';
    }
}

var CLIENT_ID = "692720523871-cd6v5ba5ancrjj92iljqhhcr7vrbl8sn.apps.googleusercontent.com";

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === "GET_AUTH_TOKEN") {
        var redirectUri = "https://" + chrome.runtime.id + ".chromiumapp.org/";
        var nonce = Math.random().toString(36).substring(2, 15);
        var authUrl =
            "https://accounts.google.com/o/oauth2/v2/auth" +
            "?client_id=" + encodeURIComponent(CLIENT_ID) +
            "&response_type=id_token" +
            "&redirect_uri=" + encodeURIComponent(redirectUri) +
            "&scope=" + encodeURIComponent("openid email profile") +
            "&nonce=" + nonce +
            "&prompt=select_account";

        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, function (redirectUrl) {
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
