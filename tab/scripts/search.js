document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");

  if (form && searchInput) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (query) {
        window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
    });
  }
});

function performSearch() {
  const query = document.getElementById('searchInput').value;
  if (query.trim()) {
    window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }
}

document.getElementById('searchInput').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') {
    performSearch();
  }
});
