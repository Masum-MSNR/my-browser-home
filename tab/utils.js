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
    console.warn("Invalid URL:", url);
    return '';
  }
}

function getFullDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch (e) {
    console.warn("Invalid URL:", url);
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

// Set favicon with fallback: S2 → built-in globe (always succeeds)
function setFaviconWithFallback(img, url) {
  var currentSrc = img.src;
  if (currentSrc && !currentSrc.startsWith("data:") && img.naturalWidth > 0) return;
  img.src = getFaviconUrlSync(url);
  img.onerror = function () {
    img.src = DEFAULT_FAVICON;
    img.onerror = null;
  };
}
