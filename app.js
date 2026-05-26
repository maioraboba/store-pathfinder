const STORAGE_KEY = 'navigator-state-v1';
const API_KEY_STORAGE = 'navigator-api-key';

const DEFAULT_CENTER = [48.4814, 135.0719];
const DEFAULT_ZOOM = 11;

const state = {
  points: [],
  startId: null,
  endId: null,
};

let map = null;
let routeOrder = [];
const placemarks = new Map();

const $ = (id) => document.getElementById(id);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.points = Array.isArray(parsed.points) ? parsed.points : [];
    state.startId = parsed.startId ?? null;
    state.endId = parsed.endId ?? null;
  } catch (e) {
    console.warn('Не удалось загрузить состояние:', e);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getApiKey() {
  return window.YANDEX_API_KEY || localStorage.getItem(API_KEY_STORAGE) || '';
}

function setApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key);
}

function loadYmapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить Я.Карты'));
    document.head.appendChild(s);
  });
}

function showMapPlaceholder(message) {
  const mapEl = $('map');
  mapEl.innerHTML = `<div class="placeholder">${message}</div>`;
}

async function initApp() {
  loadState();
  bindStaticEvents();

  const apiKey = getApiKey();
  if (!apiKey) {
    showOnboarding();
    return;
  }

  try {
    await loadYmapsScript(apiKey);
    await new Promise((resolve) => ymaps.ready(resolve));
    initMap();
    renderSidebar();
  } catch (e) {
    console.error(e);
    showOnboarding('Не удалось загрузить карты с этим ключом. Проверь, что он скопирован полностью.');
  }
}

function showOnboarding(errorMessage) {
  const el = $('onboarding');
  el.classList.remove('hidden');
  const input = $('onboarding-key');
  input.value = getApiKey() || '';
  input.focus();
  if (errorMessage) {
    let err = el.querySelector('.onboarding-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'onboarding-error';
      el.querySelector('.onboarding-input').after(err);
    }
    err.textContent = errorMessage;
  }
}

function hideOnboarding() {
  $('onboarding').classList.add('hidden');
}

function initMap() {
  const center =
    state.points.length > 0
      ? [state.points[0].lat, state.points[0].lon]
      : DEFAULT_CENTER;

  map = new ymaps.Map(
    'map',
    {
      center,
      zoom: DEFAULT_ZOOM,
      controls: ['zoomControl', 'geolocationControl', 'typeSelector', 'fullscreenControl'],
    },
    { suppressMapOpenBlock: true }
  );

  map.events.add('click', async (e) => {
    const coords = e.get('coords');
    await addPointAt(coords[0], coords[1]);
  });

  renderMarkers();
  if (state.points.length > 1) {
    fitToPoints();
  }
}

function fitToPoints() {
  if (!map || state.points.length === 0) return;
  const bounds = state.points.reduce(
    (acc, p) => {
      acc[0][0] = Math.min(acc[0][0], p.lat);
      acc[0][1] = Math.min(acc[0][1], p.lon);
      acc[1][0] = Math.max(acc[1][0], p.lat);
      acc[1][1] = Math.max(acc[1][1], p.lon);
      return acc;
    },
    [
      [90, 180],
      [-90, -180],
    ]
  );
  map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 60 });
}

function colorForPoint(p) {
  if (p.id === state.startId) return '#16a34a';
  if (p.id === state.endId) return '#dc2626';
  if (p.selected) return '#2563eb';
  return '#9ca3af';
}

function getRouteIndex(pointId) {
  const idx = routeOrder.findIndex((p) => p.id === pointId);
  return idx >= 0 ? idx + 1 : null;
}

function buildIconHtml(label, color) {
  return `
    <div style="
      position: relative;
      width: 32px;
      height: 32px;
      transform: translate(-50%, -100%);
    ">
      <div style="
        width: 32px;
        height: 32px;
        background: ${color};
        border: 2px solid white;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      "></div>
      <div style="
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 700;
        font-size: 13px;
        font-family: -apple-system, sans-serif;
        padding-bottom: 4px;
      ">${label}</div>
    </div>
  `;
}

function renderMarkers() {
  if (!map) return;

  placemarks.forEach((pm) => map.geoObjects.remove(pm));
  placemarks.clear();

  state.points.forEach((p) => {
    const idx = getRouteIndex(p.id);
    const label = idx !== null ? String(idx) : '·';
    const color = colorForPoint(p);

    const IconLayout = ymaps.templateLayoutFactory.createClass(
      buildIconHtml(label, color)
    );

    const placemark = new ymaps.Placemark(
      [p.lat, p.lon],
      {
        balloonContentHeader: escapeHtml(p.name),
        balloonContentBody: `
          ${p.address ? `<div>${escapeHtml(p.address)}</div>` : ''}
          <div><b>Вес:</b> ${p.weight} кг</div>
          ${idx !== null ? `<div><b>В маршруте:</b> #${idx}</div>` : ''}
        `,
        hintContent: `${escapeHtml(p.name)} — ${p.weight} кг`,
      },
      {
        iconLayout: IconLayout,
        iconShape: {
          type: 'Circle',
          coordinates: [0, -16],
          radius: 16,
        },
      }
    );
    placemark.events.add('click', (e) => {
      e.stopPropagation();
      openPointDialog(p.id);
    });
    map.geoObjects.add(placemark);
    placemarks.set(p.id, placemark);
  });
}

async function addPointAt(lat, lon) {
  let address = '';
  let name = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  try {
    const result = await nominatimReverse(lat, lon);
    if (result) {
      address = result.address;
      name = result.name || address || name;
    }
  } catch (e) {
    console.warn('Reverse geocoding failed:', e);
    showHint('Не получилось определить адрес — заполни вручную.');
  }

  const point = {
    id: crypto.randomUUID(),
    name,
    address,
    lat,
    lon,
    weight: 0,
    selected: true,
  };
  state.points.push(point);
  if (!state.startId) state.startId = point.id;
  saveState();
  renderAll();
  flashPoint(point.id);
}

async function addPointByAddress(query) {
  try {
    const result = await nominatimSearch(query);
    if (!result) {
      alert('Адрес не найден. Попробуй уточнить (укажи город или район).');
      return;
    }
    const point = {
      id: crypto.randomUUID(),
      name: result.name || query,
      address: result.address,
      lat: result.lat,
      lon: result.lon,
      weight: 0,
      selected: true,
    };
    state.points.push(point);
    if (!state.startId) state.startId = point.id;
    saveState();
    renderAll();
    if (map) map.setCenter([result.lat, result.lon], 14);
    flashPoint(point.id);
  } catch (e) {
    console.error('Geocoder error:', e);
    alert('Не удалось найти адрес. Проверь интернет-соединение.');
  }
}

async function nominatimSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=ru&addressdetails=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;
  const it = data[0];
  return {
    lat: parseFloat(it.lat),
    lon: parseFloat(it.lon),
    address: it.display_name,
    name: shortNameFromNominatim(it),
  };
}

async function nominatimReverse(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ru&addressdetails=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const it = await res.json();
  if (!it || !it.display_name) return null;
  return {
    address: it.display_name,
    name: shortNameFromNominatim(it),
  };
}

function shortNameFromNominatim(it) {
  const a = it.address || {};
  if (a.shop || a.amenity) return it.name || a.shop || a.amenity;
  if (it.name) return it.name;
  const parts = [a.road, a.house_number].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return a.city || a.town || a.village || it.display_name;
}

function flashPoint(id) {
  const li = document.querySelector(`[data-point-id="${id}"]`);
  if (!li) return;
  li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 800);
  const weightInput = li.querySelector('.point-weight-input');
  if (weightInput) weightInput.focus();
}

function openPointDialog(id) {
  const point = state.points.find((p) => p.id === id);
  if (!point) return;
  const dialog = $('point-dialog');
  $('point-dialog-title').textContent = point.name;
  $('point-name').value = point.name;
  $('point-address').value = point.address || '';
  $('point-weight').value = point.weight;
  dialog.dataset.editingId = id;
  dialog.showModal();
}

function savePointFromDialog() {
  const dialog = $('point-dialog');
  const id = dialog.dataset.editingId;
  const point = state.points.find((p) => p.id === id);
  if (!point) return;
  point.name = $('point-name').value.trim() || 'Без названия';
  point.address = $('point-address').value.trim();
  point.weight = parseFloat($('point-weight').value) || 0;
  saveState();
  renderAll();
  dialog.close();
}

function deletePointFromDialog() {
  const dialog = $('point-dialog');
  const id = dialog.dataset.editingId;
  state.points = state.points.filter((p) => p.id !== id);
  if (state.startId === id) state.startId = state.points[0]?.id || null;
  if (state.endId === id) state.endId = null;
  saveState();
  renderAll();
  dialog.close();
}

function renderSidebar() {
  renderPointsList();
  renderEndpointSelects();
  renderTotals();
}

function renderAll() {
  renderSidebar();
  renderMarkers();
}

function renderPointsList() {
  const list = $('points-list');
  list.innerHTML = '';
  state.points.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'point-item' + (p.selected ? ' selected' : '');
    li.dataset.pointId = p.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = p.selected;
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      p.selected = checkbox.checked;
      saveState();
      renderAll();
    });

    const info = document.createElement('div');
    info.className = 'point-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'point-name';
    nameEl.textContent = p.name;
    if (p.id === state.startId) {
      const b = document.createElement('span');
      b.className = 'point-badge start';
      b.textContent = 'старт';
      nameEl.appendChild(b);
    }
    if (p.id === state.endId) {
      const b = document.createElement('span');
      b.className = 'point-badge end';
      b.textContent = 'финиш';
      nameEl.appendChild(b);
    }
    const metaEl = document.createElement('div');
    metaEl.className = 'point-meta';
    metaEl.textContent = p.address || '—';
    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const weightWrap = document.createElement('div');
    weightWrap.className = 'point-weight-wrap';
    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.min = '0';
    weightInput.step = '0.1';
    weightInput.value = p.weight;
    weightInput.className = 'point-weight-input';
    weightInput.addEventListener('click', (e) => e.stopPropagation());
    weightInput.addEventListener('focus', () => weightInput.select());
    weightInput.addEventListener('change', () => {
      p.weight = parseFloat(weightInput.value) || 0;
      saveState();
      renderTotals();
    });
    const weightUnit = document.createElement('span');
    weightUnit.className = 'point-weight-unit';
    weightUnit.textContent = 'кг';
    weightWrap.appendChild(weightInput);
    weightWrap.appendChild(weightUnit);

    li.appendChild(checkbox);
    li.appendChild(info);
    li.appendChild(weightWrap);

    info.addEventListener('click', () => openPointDialog(p.id));

    list.appendChild(li);
  });

  if (state.points.length === 0) {
    const empty = document.createElement('li');
    empty.style.color = 'var(--muted)';
    empty.style.fontSize = '13px';
    empty.style.padding = '12px 4px';
    empty.style.textAlign = 'center';
    empty.style.listStyle = 'none';
    empty.textContent = 'Нет точек. Кликни по карте или найди по адресу.';
    list.appendChild(empty);
  }
}

function renderEndpointSelects() {
  const startSel = $('start-select');
  const endSel = $('end-select');
  const prevStart = state.startId || '';
  const prevEnd = state.endId || '';

  startSel.innerHTML = '<option value="">— выбрать —</option>';
  endSel.innerHTML = '<option value="">— тот же, что старт —</option>';

  state.points.forEach((p) => {
    const o1 = document.createElement('option');
    o1.value = p.id;
    o1.textContent = p.name;
    startSel.appendChild(o1);

    const o2 = document.createElement('option');
    o2.value = p.id;
    o2.textContent = p.name;
    endSel.appendChild(o2);
  });

  startSel.value = prevStart;
  endSel.value = prevEnd;
}

function renderTotals() {
  const selected = state.points.filter((p) => p.selected);
  $('selected-count').textContent = selected.length;
  const total = selected.reduce((s, p) => s + (p.weight || 0), 0);
  $('total-weight').textContent = formatNumber(total);
}

function formatNumber(n) {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

function optimizeOrder(startPoint, middlePoints, endPoint) {
  const isRoundTrip = !endPoint || endPoint.id === startPoint.id;

  if (middlePoints.length === 0) {
    return isRoundTrip ? [startPoint] : [startPoint, endPoint];
  }

  let best = null;
  let bestDist = Infinity;

  for (let firstIdx = 0; firstIdx < middlePoints.length; firstIdx++) {
    const candidate = nearestNeighborRoute(
      startPoint, middlePoints, endPoint, isRoundTrip, firstIdx
    );
    twoOpt(candidate, isRoundTrip);
    const d = routeDistance(candidate, isRoundTrip);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

function nearestNeighborRoute(startPoint, middlePoints, endPoint, isRoundTrip, forcedFirstIdx) {
  const result = [startPoint];
  const remaining = [...middlePoints];
  let current = remaining[forcedFirstIdx];
  result.push(current);
  remaining.splice(forcedFirstIdx, 1);

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining[bestIdx];
    result.push(current);
    remaining.splice(bestIdx, 1);
  }

  if (!isRoundTrip) {
    result.push(endPoint);
  }
  return result;
}

function routeDistance(route, isRoundTrip) {
  let d = 0;
  for (let i = 0; i < route.length - 1; i++) {
    d += haversineKm(route[i], route[i + 1]);
  }
  if (isRoundTrip && route.length > 1) {
    d += haversineKm(route[route.length - 1], route[0]);
  }
  return d;
}

function twoOpt(route, isRoundTrip) {
  const n = route.length;
  if (n < 4) return route;
  const lastReversible = isRoundTrip ? n - 1 : n - 2;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i <= lastReversible - 1; i++) {
      for (let j = i + 1; j <= lastReversible; j++) {
        const a = route[i - 1];
        const b = route[i];
        const c = route[j];
        const d = j + 1 < n ? route[j + 1] : route[0];
        const before = haversineKm(a, b) + haversineKm(c, d);
        const after = haversineKm(a, c) + haversineKm(b, d);
        if (after + 1e-9 < before) {
          const seg = route.slice(i, j + 1).reverse();
          route.splice(i, j - i + 1, ...seg);
          improved = true;
        }
      }
    }
  }
  return route;
}

function buildRoute() {
  const startPoint = state.points.find((p) => p.id === state.startId);
  if (!startPoint) {
    alert('Выбери точку старта');
    return;
  }

  const middle = state.points.filter(
    (p) => p.selected && p.id !== state.startId && p.id !== state.endId
  );

  if (middle.length === 0 && !state.endId) {
    alert('Выбери хотя бы одну точку для развоза');
    return;
  }

  const endPoint = state.endId
    ? state.points.find((p) => p.id === state.endId)
    : startPoint;

  routeOrder = optimizeOrder(startPoint, middle, endPoint);
  renderMarkers();

  const isRoundTrip = !state.endId || state.endId === state.startId;
  const distanceKm = routeDistance(routeOrder, isRoundTrip);
  showRouteSummary(distanceKm, routeOrder);

  if (map && routeOrder.length > 1) {
    const bounds = routeOrder.reduce(
      (acc, p) => {
        acc[0][0] = Math.min(acc[0][0], p.lat);
        acc[0][1] = Math.min(acc[0][1], p.lon);
        acc[1][0] = Math.max(acc[1][0], p.lat);
        acc[1][1] = Math.max(acc[1][1], p.lon);
        return acc;
      },
      [[90, 180], [-90, -180]]
    );
    map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 80 });
  }
}


function showHint(text) {
  let hint = document.getElementById('floating-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'floating-hint';
    hint.className = 'floating-hint';
    document.body.appendChild(hint);
  }
  hint.textContent = text;
  hint.classList.add('visible');
  clearTimeout(hint._timer);
  hint._timer = setTimeout(() => hint.classList.remove('visible'), 5000);
}

function showRouteSummary(distanceKm, ordered) {
  const summary = $('route-summary');
  summary.classList.remove('hidden');
  $('route-distance').textContent = `~${formatNumber(distanceKm)} км (по прямой)`;
  const totalWeight = ordered.reduce((s, p) => s + (p.weight || 0), 0);
  $('route-duration').textContent = `${formatNumber(totalWeight)} кг`;
  const ol = $('route-order');
  ol.innerHTML = '';
  ordered.forEach((p) => {
    const li = document.createElement('li');
    const weight = p.weight ? ` — ${p.weight} кг` : '';
    li.textContent = p.name + weight;
    ol.appendChild(li);
  });
}

function clearRoute() {
  routeOrder = [];
  renderMarkers();
  $('route-summary').classList.add('hidden');
}

function openInYandexMaps() {
  const startPoint = state.points.find((p) => p.id === state.startId);
  if (!startPoint) {
    alert('Выбери точку старта');
    return;
  }
  const middle = state.points.filter(
    (p) => p.selected && p.id !== state.startId && p.id !== state.endId
  );
  const endPoint = state.endId
    ? state.points.find((p) => p.id === state.endId)
    : startPoint;

  const ordered = optimizeOrder(startPoint, middle, endPoint);
  const rtext = ordered.map((p) => `${p.lat},${p.lon}`).join('~');
  const url = `https://yandex.ru/maps/?rtext=${rtext}&rtt=auto`;
  window.open(url, '_blank', 'noopener');
}

function bindStaticEvents() {
  $('add-by-address-btn').addEventListener('click', () => {
    const input = $('address-input');
    const query = input.value.trim();
    if (!query) return;
    addPointByAddress(query).then(() => {
      input.value = '';
    });
  });

  $('address-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('add-by-address-btn').click();
    }
  });

  $('start-select').addEventListener('change', (e) => {
    state.startId = e.target.value || null;
    saveState();
    renderAll();
  });

  $('end-select').addEventListener('change', (e) => {
    state.endId = e.target.value || null;
    saveState();
    renderAll();
  });

  $('select-all-btn').addEventListener('click', () => {
    state.points.forEach((p) => (p.selected = true));
    saveState();
    renderAll();
  });

  $('clear-selection-btn').addEventListener('click', () => {
    state.points.forEach((p) => (p.selected = false));
    saveState();
    renderAll();
  });

  $('build-route-btn').addEventListener('click', buildRoute);
  $('clear-route-btn').addEventListener('click', clearRoute);
  $('open-in-yandex-btn').addEventListener('click', openInYandexMaps);

  $('point-save-btn').addEventListener('click', (e) => {
    e.preventDefault();
    savePointFromDialog();
  });
  $('point-delete-btn').addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm('Удалить точку?')) deletePointFromDialog();
  });
  $('point-cancel-btn').addEventListener('click', () => {
    $('point-dialog').close();
  });

  $('settings-btn').addEventListener('click', () => {
    $('api-key-input').value = getApiKey();
    $('settings-dialog').showModal();
  });
  $('settings-save-btn').addEventListener('click', (e) => {
    e.preventDefault();
    const key = $('api-key-input').value.trim();
    if (key) setApiKey(key);
    $('settings-dialog').close();
    location.reload();
  });
  $('settings-cancel-btn').addEventListener('click', () => {
    $('settings-dialog').close();
  });
  $('onboarding-save').addEventListener('click', () => {
    const key = $('onboarding-key').value.trim();
    if (!key) return;
    setApiKey(key);
    hideOnboarding();
    location.reload();
  });

  $('onboarding-key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('onboarding-save').click();
    }
  });

  $('reset-data-btn').addEventListener('click', () => {
    if (!confirm('Удалить все точки? Это действие нельзя отменить.')) return;
    localStorage.removeItem(STORAGE_KEY);
    state.points = [];
    state.startId = null;
    state.endId = null;
    renderAll();
    $('settings-dialog').close();
  });
}

initApp();
