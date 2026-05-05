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
