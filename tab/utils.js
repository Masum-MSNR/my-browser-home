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
  return new Promise(function (resolve) {
    try {
      var urlObj = new URL(url);
      var domain = getFullDomain ? getFullDomain(urlObj.href) : urlObj.hostname;
      if (!domain) {
        resolve("https://www.google.com/s2/favicons?sz=32&domain=" + urlObj.hostname);
        return;
      }
      chrome.storage.local.get(domain, function (result) {
        if (result && result[domain] && result[domain].favicon) {
          resolve(result[domain].favicon);
        } else {
          resolve("https://www.google.com/s2/favicons?sz=32&domain=" + domain);
        }
      });
    } catch (e) {
      resolve("https://www.google.com/s2/favicons?sz=32&domain=" + url);
    }
  });
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

// Set favicon with fallback chain: S2 → direct /favicon.ico → hide
function setFaviconWithFallback(img, url) {
  var s2 = getFaviconUrlSync(url);
  img.src = s2;
  img.dataset.favTried = "s2";

  img.onerror = function () {
    if (img.dataset.favTried === "s2") {
      // Try direct favicon.ico
      try {
        var domain = new URL(url).hostname;
        img.src = "https://" + domain + "/favicon.ico";
        img.dataset.favTried = "direct";
      } catch (e) {
        img.style.display = "none";
      }
    } else {
      img.style.display = "none";
    }
  };
}
