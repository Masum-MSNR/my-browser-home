function updateTime() {
  const now = new Date();
  const timeString = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const dateString = now.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).toUpperCase().replace(/,/g, ' •');

  const timeWithColon = timeString.replace(':', '<span class="colon">:</span>');

  document.getElementById('time').innerHTML = timeWithColon;
  document.getElementById('date').textContent = dateString;
}
updateTime();
setInterval(updateTime, 1000);

// ------- Search Functionality -------
const form = document.getElementById("search-form");
form.addEventListener("submit", function (e) {
  e.preventDefault();
  const query = document.getElementById("search-input").value.trim();
  if (query) {
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    window.open(googleUrl, "_blank");
  }
});

function performSearch() {
  const query = document.getElementById('searchInput').value;
  if (query.trim()) {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
  }
}

// Enter key search
document.getElementById('searchInput').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') {
    performSearch();
  }
});

