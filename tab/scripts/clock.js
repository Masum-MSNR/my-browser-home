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
