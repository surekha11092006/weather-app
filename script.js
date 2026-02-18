/* =============================================
   WEATHER APP — script.js
   Uses: Open-Meteo (free, no API key needed) +
         Nominatim (geocoding, free, OSM)
   ============================================= */

/* ---- DOM refs ---- */
const searchInput  = document.getElementById('search-input');
const searchBtn    = document.getElementById('search-btn');
const locBtn       = document.getElementById('loc-btn');
const unitToggle   = document.getElementById('unit-toggle');
const loadingEl    = document.getElementById('loading-overlay');
const errorToast   = document.getElementById('error-toast');
const errorMsg     = document.getElementById('error-msg');
const emptyState   = document.getElementById('empty-state');
const weatherCard  = document.getElementById('weather-card');
const bgCanvas     = document.getElementById('bg-canvas');
const bgOverlay    = document.getElementById('bg-overlay');

/* ---- State ---- */
let isCelsius    = true;
let lastData     = null;
let timeInterval = null;
let particles    = [];
let animFrame    = null;

/* =============================================
   PARTICLES / BACKGROUND CANVAS
   ============================================= */
const ctx = bgCanvas.getContext('2d');

function resizeCanvas() {
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function initParticles(type = 'default') {
  particles = [];
  const count = type === 'rain' ? 120 : type === 'snow' ? 80 : 50;

  for (let i = 0; i < count; i++) {
    particles.push({
      x:       Math.random() * bgCanvas.width,
      y:       Math.random() * bgCanvas.height,
      size:    type === 'snow' ? Math.random() * 4 + 1 : Math.random() * 1.5 + 0.5,
      speedX:  type === 'rain' ? (Math.random() - 0.5) * 1 : (Math.random() - 0.5) * 0.3,
      speedY:  type === 'rain' ? Math.random() * 8 + 4
               : type === 'snow' ? Math.random() * 1.5 + 0.3
               : Math.random() * 0.4 + 0.1,
      opacity: Math.random() * 0.5 + 0.1,
      type,
      length:  type === 'rain' ? Math.random() * 15 + 8 : 0,
    });
  }
}

function drawParticles() {
  ctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.opacity;

    if (p.type === 'rain') {
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.6)';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.speedX * 2, p.y + p.length);
      ctx.stroke();
    } else if (p.type === 'snow') {
      ctx.fillStyle = 'rgba(221, 214, 254, 0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(192, 132, 252, 0.35)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    p.x += p.speedX;
    p.y += p.speedY;

    if (p.y > bgCanvas.height + 20) { p.y = -20; p.x = Math.random() * bgCanvas.width; }
    if (p.x < 0)                      p.x = bgCanvas.width;
    if (p.x > bgCanvas.width)         p.x = 0;
  });

  animFrame = requestAnimationFrame(drawParticles);
}

initParticles();
drawParticles();

/* =============================================
   SEARCH & LOCATION HANDLERS
   ============================================= */
searchBtn.addEventListener('click', handleSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });

locBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showError('Geolocation not supported by your browser.');
    return;
  }
  showLoading(true);
  navigator.geolocation.getCurrentPosition(
    pos  => fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
    ()   => { showLoading(false); showError('Location access denied. Please search manually.'); },
    { timeout: 10000 }
  );
});

unitToggle.addEventListener('click', () => {
  isCelsius = !isCelsius;
  unitToggle.textContent = isCelsius ? '°C' : '°F';
  if (lastData) renderWeather(lastData);
});

function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) { showError('Please enter a city name.'); return; }
  geocodeCity(query);
}

/* =============================================
   GEOCODING — Nominatim (OpenStreetMap)
   ============================================= */
async function geocodeCity(cityName) {
  showLoading(true);
  try {
    const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1&addressdetails=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();

    if (!data || data.length === 0) {
      showLoading(false);
      showError(`City "${cityName}" not found. Try a different name.`);
      return;
    }

    const place   = data[0];
    const lat     = parseFloat(place.lat);
    const lon     = parseFloat(place.lon);
    const city    = place.address?.city
                 || place.address?.town
                 || place.address?.village
                 || place.address?.county
                 || place.name;
    const country = place.address?.country || '';

    await fetchWeatherByCoords(lat, lon, city, country);
  } catch {
    showLoading(false);
    showError('Network error. Check your connection.');
  }
}

/* =============================================
   REVERSE GEOCODING
   ============================================= */
async function reverseGeocode(lat, lon) {
  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    const city = data.address?.city
              || data.address?.town
              || data.address?.village
              || data.address?.county
              || 'Unknown';
    const country = data.address?.country || '';
    return { city, country };
  } catch {
    return { city: 'Your Location', country: '' };
  }
}

/* =============================================
   FETCH WEATHER — Open-Meteo (FREE, no API key)
   ============================================= */
async function fetchWeatherByCoords(lat, lon, city = null, country = null) {
  try {
    if (!city) {
      const geo = await reverseGeocode(lat, lon);
      city      = geo.city;
      country   = geo.country;
    }

    const url = `https://api.open-meteo.com/v1/forecast?`
      + `latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,`
      + `weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,`
      + `cloud_cover,visibility,dew_point_2m`
      + `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset`
      + `&timezone=auto`
      + `&forecast_days=6`;

    const res  = await fetch(url);
    const data = await res.json();

    if (data.error) throw new Error(data.reason || 'API error');

    lastData = { ...data, city, country, lat, lon };
    renderWeather(lastData);
    showLoading(false);
  } catch {
    showLoading(false);
    showError('Failed to fetch weather data. Please try again.');
  }
}

/* =============================================
   RENDER WEATHER DATA TO DOM
   ============================================= */
function renderWeather(data) {
  const c = data.current;
  const d = data.daily;

  // Show card, hide empty state
  emptyState.style.display  = 'none';
  weatherCard.style.display = 'block';
  weatherCard.style.animation = 'none';
  void weatherCard.offsetWidth; // reflow
  weatherCard.style.animation = '';

  // Temperatures
  const tempC  = c.temperature_2m;
  const feelsC = c.apparent_temperature;
  const maxC   = d.temperature_2m_max[0];
  const minC   = d.temperature_2m_min[0];
  const dewC   = c.dew_point_2m;

  const temp  = isCelsius ? Math.round(tempC)  : toF(tempC);
  const feels = isCelsius ? Math.round(feelsC) : toF(feelsC);
  const tMax  = isCelsius ? Math.round(maxC)   : toF(maxC);
  const tMin  = isCelsius ? Math.round(minC)   : toF(minC);
  const dew   = isCelsius ? Math.round(dewC)   : toF(dewC);
  const unit  = isCelsius ? '°C' : '°F';

  // Fill in DOM
  document.getElementById('city-name').textContent    = data.city;
  document.getElementById('country-name').textContent = data.country;
  document.getElementById('temp-val').textContent     = temp;
  document.getElementById('temp-unit').textContent    = unit;
  document.getElementById('feels-like').textContent   = `${feels}${unit}`;
  document.getElementById('humidity').textContent     = `${c.relative_humidity_2m}%`;
  document.getElementById('wind-speed').textContent   = `${Math.round(c.wind_speed_10m)} km/h`;
  document.getElementById('visibility').textContent   = c.visibility >= 1000
    ? `${(c.visibility / 1000).toFixed(1)} km`
    : `${c.visibility} m`;
  document.getElementById('pressure').textContent     = `${Math.round(c.surface_pressure)} hPa`;
  document.getElementById('cloud-cover').textContent  = `${c.cloud_cover}%`;
  document.getElementById('wind-dir').textContent     = degToCompass(c.wind_direction_10m);
  document.getElementById('dew-point').textContent    = `${dew}${unit}`;
  document.getElementById('temp-min').textContent     = `${tMin}${unit}`;
  document.getElementById('temp-max').textContent     = `${tMax}${unit}`;

  // Sunrise / Sunset
  document.getElementById('sunrise').textContent = formatTime(d.sunrise[0]);
  document.getElementById('sunset').textContent  = formatTime(d.sunset[0]);

  // Temp range fill bar
  const range = maxC - minC;
  const pos   = range > 0 ? ((tempC - minC) / range) * 100 : 50;
  document.getElementById('temp-range-fill').style.width = `${Math.min(100, Math.max(10, pos))}%`;

  // Weather code → emoji + label + theme
  const { emoji, label, theme, particle } = interpretWeatherCode(c.weather_code, data.lat);
  document.getElementById('weather-emoji').textContent       = emoji;
  document.getElementById('condition-badge').textContent     = label;
  document.getElementById('condition-badge').style.display   = 'block';

  // Apply theme + particles
  applyTheme(theme);
  if (animFrame) cancelAnimationFrame(animFrame);
  initParticles(particle);
  drawParticles();

  // 5-day forecast
  renderForecast(d, unit);

  // Live clock
  startClock(data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Update search placeholder
  searchInput.placeholder = data.city;
}

/* =============================================
   5-DAY FORECAST RENDERER
   ============================================= */
function renderForecast(daily, unit) {
  const container = document.getElementById('forecast-row');
  container.innerHTML = '';

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayIdx = new Date().getDay();

  // Use days 1–5 (skip today index 0, show next 5)
  for (let i = 1; i <= 5; i++) {
    if (!daily.time[i]) continue;

    const dateStr = daily.time[i];                // "2025-02-20"
    const dayOfWeek = new Date(dateStr + 'T12:00:00').getDay();
    const hi = isCelsius ? Math.round(daily.temperature_2m_max[i]) : toF(daily.temperature_2m_max[i]);
    const lo = isCelsius ? Math.round(daily.temperature_2m_min[i]) : toF(daily.temperature_2m_min[i]);
    const { emoji } = interpretWeatherCode(daily.weather_code[i]);

    const isToday = i === 0;

    const card = document.createElement('div');
    card.className = `forecast-day${isToday ? ' today' : ''}`;
    card.innerHTML = `
      <span class="forecast-dow">${days[dayOfWeek]}</span>
      <span class="forecast-emoji">${emoji}</span>
      <span class="forecast-hi">${hi}${unit}</span>
      <span class="forecast-lo">${lo}${unit}</span>
    `;
    container.appendChild(card);
  }
}

/* =============================================
   WEATHER CODE INTERPRETER (WMO codes)
   ============================================= */
function interpretWeatherCode(code, lat) {
  const hour    = new Date().getHours();
  const isNight = hour < 6 || hour >= 20;

  if (code === 0)  return isNight
    ? { emoji: '🌙',  label: 'Clear Night',    theme: 'night',   particle: 'default' }
    : { emoji: '☀️',  label: 'Clear Sky',      theme: 'clear',   particle: 'default' };
  if (code === 1)  return { emoji: '🌤️',  label: 'Mostly Clear',   theme: 'clear',   particle: 'default' };
  if (code === 2)  return { emoji: '⛅',   label: 'Partly Cloudy',  theme: 'cloudy',  particle: 'default' };
  if (code === 3)  return { emoji: '☁️',  label: 'Overcast',        theme: 'cloudy',  particle: 'default' };
  if ([45,48].includes(code))          return { emoji: '🌫️',  label: 'Foggy',         theme: 'foggy',   particle: 'default' };
  if ([51,53,55].includes(code))       return { emoji: '🌦️',  label: 'Drizzle',        theme: 'rainy',   particle: 'rain' };
  if ([61,63,65].includes(code))       return { emoji: '🌧️',  label: 'Rain',           theme: 'rainy',   particle: 'rain' };
  if ([66,67].includes(code))          return { emoji: '🌨️',  label: 'Freezing Rain',  theme: 'snowy',   particle: 'snow' };
  if ([71,73,75,77].includes(code))    return { emoji: '❄️',  label: 'Snow',            theme: 'snowy',   particle: 'snow' };
  if ([80,81,82].includes(code))       return { emoji: '🌦️',  label: 'Rain Showers',   theme: 'rainy',   particle: 'rain' };
  if ([85,86].includes(code))          return { emoji: '🌨️',  label: 'Snow Showers',   theme: 'snowy',   particle: 'snow' };
  if ([95,96,99].includes(code))       return { emoji: '⛈️',  label: 'Thunderstorm',   theme: 'stormy',  particle: 'default' };
  return { emoji: '🌡️', label: 'Unknown', theme: 'clear', particle: 'default' };
}

/* =============================================
   THEME APPLICATION
   ============================================= */
function applyTheme(theme) {
  document.body.className = '';
  document.body.classList.add(`weather-${theme}`);

  const overlays = {
    clear:   'radial-gradient(ellipse 70% 55% at 75% 15%, rgba(192,132,252,0.18) 0%, transparent 65%)',
    cloudy:  'radial-gradient(ellipse 80% 55% at 50% 0%,  rgba(167,139,250,0.13) 0%, transparent 65%)',
    rainy:   'radial-gradient(ellipse 55% 75% at 25% 55%, rgba(129,140,248,0.15) 0%, transparent 65%)',
    stormy:  'radial-gradient(ellipse 75% 55% at 50% 25%, rgba(109,40,217,0.20) 0%, transparent 65%)',
    snowy:   'radial-gradient(ellipse 65% 55% at 50% 0%,  rgba(221,214,254,0.12) 0%, transparent 65%)',
    foggy:   'radial-gradient(ellipse 100% 75% at 50% 50%,rgba(196,181,253,0.09) 0%, transparent 65%)',
    hot:     'radial-gradient(ellipse 65% 50% at 80% 10%, rgba(244,114,182,0.20) 0%, transparent 65%)',
    night:   'radial-gradient(ellipse 55% 55% at 50% 0%,  rgba(109,40,217,0.18) 0%, transparent 65%)',
  };

  bgOverlay.style.background = overlays[theme] || overlays.clear;
}

/* =============================================
   LIVE CLOCK
   ============================================= */
function startClock(timezone) {
  clearInterval(timeInterval);
  updateClock(timezone);
  timeInterval = setInterval(() => updateClock(timezone), 1000);
}

function updateClock(timezone) {
  try {
    const time = new Date().toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    document.getElementById('local-time').textContent = time;
  } catch {
    document.getElementById('local-time').textContent = '';
  }
}

/* =============================================
   UTILITY FUNCTIONS
   ============================================= */
function toF(celsius) {
  return Math.round(celsius * 9 / 5 + 32);
}

function degToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

/* =============================================
   LOADING & ERROR HELPERS
   ============================================= */
function showLoading(show) {
  loadingEl.classList.toggle('show', show);
}

let errorTimer;
function showError(msg) {
  errorMsg.textContent = msg;
  errorToast.classList.add('show');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => errorToast.classList.remove('show'), 3500);
}

/* =============================================
   AUTO-LOAD on page start
   ============================================= */
window.addEventListener('load', () => {
  if (navigator.geolocation) {
    showLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
      ()  => {
        showLoading(false);
        geocodeCity('Chennai'); // Fallback
      },
      { timeout: 6000 }
    );
  } else {
    geocodeCity('Chennai');
  }
});
