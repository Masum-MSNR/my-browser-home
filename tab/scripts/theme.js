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

async function applyTheme(url) {
  document.body.style.backgroundImage = `url('${url}')`;
  document.body.style.backgroundRepeat = 'no-repeat';
  document.body.style.backgroundPosition = 'center center';
  document.body.style.backgroundAttachment = 'fixed';
  document.body.style.backgroundSize = 'cover';

  await saveTheme(url);

  analyzeImageBrightness(url, (brightness) => {
    if (brightness < 128) {
      document.body.classList.add("light-text");
      document.body.classList.remove("dark-text");
    } else {
      document.body.classList.add("dark-text");
      document.body.classList.remove("light-text");
    }
  });
}

function analyzeImageBrightness(url, callback) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;

  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    const step = 10;

    for (let i = 0; i < data.length; i += 4 * step) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = (r * 299 + g * 587 + b * 114) / 1000;
      total += luminance;
    }

    const avgBrightness = total / (data.length / 4 / step);
    callback(avgBrightness);
  };
}

function renderThemeOptions() {
  const container = document.getElementById("theme-options");
  container.innerHTML = '';
  themes.forEach(theme => {
    const img = document.createElement("img");
    img.src = theme.url;
    img.alt = theme.name;
    img.className = "theme-thumb";
    img.title = theme.name;
    img.onclick = () => applyTheme(theme.url);
    container.appendChild(img);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await loadTheme();
  if (saved) {
    applyTheme(saved);
  } else {
    document.body.classList.add("dark-text");
  }
  renderThemeOptions();

  document.getElementById("open-theme-panel").addEventListener("click", () => {
    document.getElementById("theme-panel").classList.add("open");
  });

  document.querySelector(".close-theme-panel").addEventListener("click", () => {
    document.getElementById("theme-panel").classList.remove("open");
  });
});
