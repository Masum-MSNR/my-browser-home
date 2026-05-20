const themes = [
  { name: "Theme 1",  url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 2",  url: "https://images.unsplash.com/photo-1519125323398-675f0ddb6308?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 3",  url: "https://images.unsplash.com/photo-1526045478516-99145907023c?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 4",  url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 5",  url: "https://images.unsplash.com/photo-1506765515384-028b60a970df?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 6",  url: "https://images.unsplash.com/photo-1531297484001-80022131f5a1?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 7",  url: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 8",  url: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 9",  url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 10", url: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 11", url: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 12", url: "https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 13", url: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 14", url: "https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 15", url: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 16", url: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 17", url: "https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 18", url: "https://images.unsplash.com/photo-1482192505345-5655af888cc4?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 19", url: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1920&q=80" },
  { name: "Theme 20", url: "https://images.unsplash.com/photo-1495567720989-cebdbdd97913?auto=format&fit=crop&w=1920&q=80" },
];

var THEME_CACHE_KEY = "themeCache";
var cachedTheme = null;
var activeThemeUrl = null;

function getThemeByUrl(url) {
  for (var i = 0; i < themes.length; i++) {
    if (themes[i] && themes[i].url === url) return themes[i];
  }
  return null;
}

function createThemePlaceholder(theme) {
  var label = theme && theme.name ? theme.name : "Theme";
  var seed = 0;
  for (var i = 0; i < label.length; i++) {
    seed = (seed * 31 + label.charCodeAt(i)) % 360;
  }
  var hueA = seed;
  var hueB = (seed + 64) % 360;
  var svg = '' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">' +
    '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">' +
    '<stop offset="0%" stop-color="hsl(' + hueA + ', 65%, 44%)"/>' +
    '<stop offset="100%" stop-color="hsl(' + hueB + ', 70%, 22%)"/>' +
    '</linearGradient></defs>' +
    '<rect width="640" height="360" fill="url(#g)"/>' +
    '<circle cx="510" cy="88" r="88" fill="rgba(255,255,255,0.14)"/>' +
    '<circle cx="122" cy="298" r="108" fill="rgba(255,255,255,0.08)"/>' +
    '<text x="32" y="316" fill="rgba(255,255,255,0.92)" font-size="34" font-family="system-ui, sans-serif" font-weight="700">' + label + '</text>' +
    '</svg>';
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function getThemePreviewUrl(url) {
  if (cachedTheme && cachedTheme.url === url && cachedTheme.dataUrl) {
    return cachedTheme.dataUrl;
  }
  return createThemePlaceholder(getThemeByUrl(url));
}

function reportThemeIssue(url, message) {
  if (typeof reportHandledIssue === "function") {
    reportHandledIssue("theme-image", message, { url: url });
  }
}

function blobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(new Error("Failed to read theme blob")); };
    reader.readAsDataURL(blob);
  });
}

function loadImageFromUrl(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error("Failed to load theme image")); };
    img.src = url;
  });
}

async function preloadCache() {
  var result = await chrome.storage.local.get(THEME_CACHE_KEY);
  cachedTheme = result[THEME_CACHE_KEY] || null;
}

function setBodyBackground(url) {
  document.body.style.backgroundImage = "url('" + url + "')";
  document.body.style.backgroundRepeat = 'no-repeat';
  document.body.style.backgroundPosition = 'center center';
  document.body.style.backgroundAttachment = 'fixed';
  document.body.style.backgroundSize = 'cover';
}

function applyBrightnessClass(brightness) {
  if (brightness < 128) {
    document.body.classList.add("light-text");
    document.body.classList.remove("dark-text");
  } else {
    document.body.classList.add("dark-text");
    document.body.classList.remove("light-text");
  }
}

function analyzeImage(img) {
  var canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  var ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  var total = 0;
  var step = 10;

  for (var i = 0; i < data.length; i += 4 * step) {
    total += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }

  return { brightness: total / (data.length / 4 / step), canvas: canvas };
}

async function downloadAndCache(url) {
  var response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error("Failed to download theme image");

  var blob = await response.blob();
  var objectUrl = URL.createObjectURL(blob);
  try {
    var img = await loadImageFromUrl(objectUrl);
    var result = analyzeImage(img);
    var dataUrl = await blobToDataUrl(blob);
    cachedTheme = { url: url, dataUrl: dataUrl, brightness: result.brightness };
    chrome.storage.local.set({
      [THEME_CACHE_KEY]: cachedTheme
    }).catch(function () {});
    return { dataUrl: dataUrl, brightness: result.brightness };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function applyTheme(url, options) {
  if (!url) return;
  options = options || {};
  var persist = options.persist === true;

  if (activeThemeUrl === url && !persist) {
    return;
  }

  // Check preloaded cache first — no network if already cached
  if (cachedTheme && cachedTheme.url === url && cachedTheme.dataUrl) {
    setBodyBackground(cachedTheme.dataUrl);
    applyBrightnessClass(cachedTheme.brightness);
  } else {
    setBodyBackground(getThemePreviewUrl(url));

    try {
      var result = await downloadAndCache(url);
      setBodyBackground(result.dataUrl);
      applyBrightnessClass(result.brightness);
      renderThemeOptions();
    } catch (e) {
      reportThemeIssue(url, "Theme image unavailable");
      document.body.classList.add("dark-text");
      document.body.classList.remove("light-text");
    }
  }

  activeThemeUrl = url;

  if (!persist) return;

  var saved = await syncGet("customBg");
  if (saved === url) return;

  await syncSet({ customBg: url });
  if (typeof markSyncDirty === "function") markSyncDirty("customBg");
  if (typeof autoSync === "function") autoSync();
}

function renderThemeOptions() {
  var container = document.getElementById("theme-options");
  container.innerHTML = '';
  themes.forEach(function (theme) {
    var img = document.createElement("img");
    img.src = getThemePreviewUrl(theme.url);
    img.alt = theme.name;
    img.className = "theme-thumb";
    img.title = theme.name;
    img.onclick = function () { applyTheme(theme.url, { persist: true }); };
    container.appendChild(img);
  });
}

document.addEventListener("DOMContentLoaded", async function () {
  await preloadCache();
  var saved = await syncGet("customBg");
  if (saved) {
    await applyTheme(saved);
  } else {
    document.body.classList.add("dark-text");
  }
  renderThemeOptions();

  document.getElementById("open-theme-panel").addEventListener("click", function () {
    document.getElementById("theme-panel").classList.add("open");
  });

  document.querySelector(".close-theme-panel").addEventListener("click", function () {
    document.getElementById("theme-panel").classList.remove("open");
  });
});

window.addEventListener("syncdataloaded", async function () {
  var saved = await syncGet("customBg");
  if (saved) await applyTheme(saved);
});
