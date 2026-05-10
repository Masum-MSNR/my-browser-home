function getRootDomain(url) {
  try {
    const knownMultiLevelTLDs = [
      'co.uk', 'ac.uk', 'gov.uk', 'co.in', 'com.au', 'com.br', 'co.jp', 'co.kr', 'co.za', 'com.cn'
    ];

    const hostname = new URL(url).hostname.toLowerCase();

    const cleaned = hostname.replace(/^(www[0-9]?|mail|ftp|app)\./, '');

    const parts = cleaned.split('.');
    const len = parts.length;

    if (len < 2) return cleaned;

    const lastTwo = parts.slice(-2).join('.');
    const lastThree = parts.slice(-3).join('.');

    if (knownMultiLevelTLDs.includes(lastTwo)) {
      return len >= 3 ? parts.slice(-3).join('.') : lastTwo;
    }

    return lastTwo;
  } catch (e) {
    return '';
  }
}

function getFullDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function getFaviconUrl(url) {
  return Promise.resolve(getFaviconUrlSync(url));
}

// Quick sync fallback
function getFaviconUrlSync(url) {
  try {
    var domain = new URL(url).hostname;
    return "https://www.google.com/s2/favicons?sz=32&domain=" + domain;
  } catch (e) {
    return "";
  }
}

// Built-in globe favicon (data URI) — always available, no network needed
var DEFAULT_FAVICON = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5">' +
  '<circle cx="12" cy="12" r="10"/>' +
  '<ellipse cx="12" cy="12" rx="4" ry="10"/>' +
  '<path d="M2 12h20"/><path d="M12 2v20"/></svg>'
);

// Set favicon: prefer stored favicon (from item.favicon), fall back to S2.
// `storedFavicon` is the favicon URL saved in the item data (synced across
// devices). If absent, use Google's S2 service. If both fail, use a built-in
// globe SVG.
function setFaviconWithFallback(img, url, storedFavicon) {
  var s2 = getFaviconUrlSync(url);
  var primary = storedFavicon || s2;
  img.src = primary;
  img.onerror = function () {
    if (img.src !== s2 && primary !== s2) {
      img.src = s2;
      img.onerror = function () {
        img.src = DEFAULT_FAVICON;
        img.onerror = null;
      };
    } else {
      img.src = DEFAULT_FAVICON;
      img.onerror = null;
    }
  };
}

// Resolve a favicon URL from chrome.storage.local cache (populated by the
// background worker when the user visits a site). Calls back with the real
// URL only after a test-load succeeds. CORP-blocked URLs silently fail.
function resolveCachedFavicon(url, cb) {
  try {
    var domain = new URL(url).hostname.replace(/^www\./, '');
    chrome.storage.local.get(domain, function (result) {
      if (!result || !result[domain] || !result[domain].favicon) return;
      var realUrl = result[domain].favicon;
      var test = new Image();
      test.onload = function () { cb(realUrl); };
      test.onerror = function () {};
      test.src = realUrl;
    });
  } catch (e) {}
}

// Try to upgrade favicon from cached real URL. If `onResolved` is provided,
// it is called with the real URL after a successful test-load — callers may
// use this to persist the resolved favicon back into the item data so it
// syncs across devices.
function refreshFaviconFromCache(img, url, onResolved) {
  resolveCachedFavicon(url, function (realUrl) {
    img.src = realUrl;
    img.onerror = null;
    if (typeof onResolved === "function") onResolved(realUrl);
  });
}
