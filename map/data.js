function initializeGpxLayer() {
  return new L.GPX(GPX_URL, {
    async: true,
    marker_options: {
      startIconUrl: null,
      endIconUrl: null,
      shadowUrl: null
    }
  }).on("loaded", function (e) {
    const bounds = e.target.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.1));
      firstFitDone = true;
    }

    const layers = e.target.getLayers();
    let cumulativeDist = 0;
    let lastPt = null;

    layers.forEach((layer) => {
      if (layer instanceof L.Polyline) {
        const latlngs = layer.getLatLngs();
        const flatten = (arr) => {
          if (arr.length > 0 && Array.isArray(arr[0])) {
            arr.forEach(flatten);
          } else if (arr.length > 0) {
            arr.forEach((ll) => {
              if (lastPt) {
                cumulativeDist += getDistanceFromLatLonInMeters(lastPt.lat, lastPt.lng, ll.lat, ll.lng);
              }
              gpxPoints.push({ lat: ll.lat, lon: ll.lng, km: cumulativeDist / 1000 });
              lastPt = ll;
            });
          }
        };
        flatten(latlngs);
      }
    });

    if (markers.length > 0) {
      loadData();
    }
  }).addTo(map);
}

function isRenderablePoint(point) {
  return point &&
    point.lat !== null &&
    point.lon !== null &&
    point.lat !== "" &&
    point.lon !== "" &&
    !Number.isNaN(Number(point.lat)) &&
    !Number.isNaN(Number(point.lon));
}

// ── Track body deduplication (zobraz pouze nejnovější v okruhu 50m) ────────────
const TRACK_DEDUP_METERS = 50;

/**
 * Z pole track bodů vrátí pouze ty, které jsou nejnovější ve svém okolí.
 * Pokud existují dva track body do TRACK_DEDUP_METERS od sebe, zobrazí se jen novější.
 * Ostatní typy záznamů (text, audio, photo) tato funkce neovlivňuje.
 */
function deduplicateTrackPoints(trackPoints) {
  // Seřadit sestupně dle času — nejnovější první
  const sorted = [...trackPoints].sort((a, b) => {
    const ta = String(a.time || "");
    const tb = String(b.time || "");
    return tb > ta ? 1 : tb < ta ? -1 : 0;
  });

  const kept = [];
  for (const point of sorted) {
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    const tooClose = kept.some((other) => {
      return getDistanceFromLatLonInMeters(lat, lon, Number(other.lat), Number(other.lon)) <= TRACK_DEDUP_METERS;
    });
    if (!tooClose) {
      kept.push(point);
    }
  }
  return kept;
}

const MULTI_PIN_TOLERANCE_METERS = 15;

function buildPopupDetails(point, lat, lon) {
  const metaParts = [];
  if (getEntryType(point) === ENTRY_TYPE_AUDIO && point.audio_duration_sec != null) {
    metaParts.push(`🎙 ${formatAudioDuration(point.audio_duration_sec)}`);
  }
  if (point.battery != null) metaParts.push(`🔋 ${point.battery}%`);
  if (point.speed != null) metaParts.push(`⚡ ${point.speed} km/h`);
  if (point.altitude != null) metaParts.push(`▲ ${point.altitude} m`);

  const routeKm = findRouteKm(lat, lon);
  if (routeKm != null) metaParts.push(`📍 km ${routeKm}`);

  let weatherLine = "";
  if (point.weather_code != null) {
    const emoji = getWeatherEmoji(point.weather_code);
    const temp = point.weather_temp != null ? ` ${Math.round(point.weather_temp)}°C` : "";
    weatherLine = `${emoji}${temp}`;
  }

  return { metaParts, weatherLine };
}

function buildPointPopup(point) {
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  const { metaParts, weatherLine } = buildPopupDetails(point, lat, lon);
  return buildPopupContent(point, weatherLine, metaParts);
}

function clearTrack() {
  if (notesPolyline) {
    map.removeLayer(notesPolyline);
    notesPolyline = null;
  }
  arrowMarkers.forEach((marker) => map.removeLayer(marker));
  arrowMarkers = [];
}

function clearRenderedMarkers(options = {}) {
  collapseExpandedMultiPin({ keepActive: options.keepActive === true });
  markers.forEach((marker) => map.removeLayer(marker));
  markers = [];
  markerByPointKey = new Map();
  multiPinGroups = new Map();
}

function renderTrack(validPoints) {
  clearTrack();

  if (validPoints.length < 2) {
    return;
  }

  const latlngs = validPoints.map((point) => [Number(point.lat), Number(point.lon)]);
  notesPolyline = L.polyline(latlngs, {
    color: "#22d3ee",
    weight: 2,
    opacity: 0.5,
    dashArray: "6, 6",
  }).addTo(map);
  addArrowsForSegments(latlngs, 0);
}

function buildMarkerGroups(validPoints) {
  const groups = [];

  validPoints.forEach((point, index) => {
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    let targetGroup = null;

    for (const group of groups) {
      const distanceToCenter = getDistanceFromLatLonInMeters(lat, lon, group.centerLat, group.centerLon);
      if (distanceToCenter <= MULTI_PIN_TOLERANCE_METERS) {
        targetGroup = group;
        break;
      }
    }

    if (!targetGroup) {
      targetGroup = {
        locationKey: `cluster-${groups.length}`,
        centerLat: lat,
        centerLon: lon,
        sumLat: 0,
        sumLon: 0,
        entries: [],
      };
      groups.push(targetGroup);
    }

    targetGroup.entries.push({
      point,
      pointKey: getPointKey(point),
      lat,
      lon,
      isLast: index === validPoints.length - 1,
    });

    targetGroup.sumLat += lat;
    targetGroup.sumLon += lon;
    targetGroup.centerLat = targetGroup.sumLat / targetGroup.entries.length;
    targetGroup.centerLon = targetGroup.sumLon / targetGroup.entries.length;
  });

  return groups;
}

function renderMarkers(validPoints) {
  clearRenderedMarkers({ keepActive: true });

  // Rozdělit body na track body a ostatní (text/audio/photo)
  const trackPoints = validPoints.filter((p) => getEntryType(p) === ENTRY_TYPE_TRACK);
  const notePoints = validPoints.filter((p) => getEntryType(p) !== ENTRY_TYPE_TRACK);

  // Track body: deduplikovat (50m zona) a vykreslit jako malé modré kruhy
  const dedupedTrackPoints = deduplicateTrackPoints(trackPoints);
  dedupedTrackPoints.forEach((point) => {
    markers.push(createTrackMarker(point));
  });

  // Ostatní záznamy: standardní multi-pin logika beze změny
  const groups = buildMarkerGroups(notePoints);
  groups.forEach((group) => {
    const entries = group.entries;
    if (entries.length === 1) {
      markers.push(createMarker(entries[0].point, entries[0].isLast));
      return;
    }

    markers.push(createMultiMarker(entries, group.locationKey));
  });

  if (!activePointKey) {
    return;
  }

  const activeMarker = markerByPointKey.get(activePointKey);
  if (activeMarker && typeof activeMarker.openPopup === "function") {
    activeMarker.openPopup();
    return;
  }

  activePointKey = null;
  syncActiveNoteUI();
}

function createMarker(point, isLast) {
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  const pointKey = getPointKey(point);
  const marker = L.marker([lat, lon], isLast ? { icon: redIcon } : {}).addTo(map);

  marker.bindPopup(buildPointPopup(point));
  markerByPointKey.set(pointKey, marker);

  marker.on("click", () => {
    collapseExpandedMultiPin({ keepActive: true });
    activePointKey = pointKey;
    syncActiveNoteUI();
  });

  marker.on("popupopen", () => {
    activePointKey = pointKey;
    syncActiveNoteUI();
  });

  marker.on("popupclose", () => {
    if (!isRefreshingMarkers && !suppressActivePointReset && activePointKey === pointKey) {
      activePointKey = null;
      syncActiveNoteUI();
    }
  });

  return marker;
}

// ── Track marker (auto-tracking body) ────────────────────────────────────────

function buildTrackPopup(point) {
  const wrapper = document.createElement("div");

  // Čas
  const timeEl = document.createElement("div");
  timeEl.className = "track-popup-time";
  timeEl.textContent = formatTime(point.time);
  wrapper.appendChild(timeEl);

  // Data řádek: baterie, rychlost, nadmořská výška
  const row1 = document.createElement("div");
  row1.className = "track-popup-row";
  const parts1 = [];
  if (point.battery != null) parts1.push(`🔋 ${point.battery}%`);
  if (point.speed != null)   parts1.push(`${point.speed} km/h`);
  if (point.altitude != null) parts1.push(`▲ ${point.altitude} m`);
  row1.textContent = parts1.join("  ");
  wrapper.appendChild(row1);

  // Data řádek: teplota, GPS přesnost
  const row2Parts = [];
  if (point.weather_temp != null) {
    const emoji = getWeatherEmoji(point.weather_code);
    row2Parts.push(`${emoji} ${Math.round(point.weather_temp)}°C`);
  }
  if (point.gps_accuracy != null) row2Parts.push(`±${point.gps_accuracy} m`);

  if (row2Parts.length > 0) {
    const row2 = document.createElement("div");
    row2.className = "track-popup-row";
    row2.textContent = row2Parts.join("  ");
    wrapper.appendChild(row2);
  }

  return wrapper;
}

function createTrackMarker(point) {
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  const pointKey = getPointKey(point);
  const marker = L.marker([lat, lon], {
    icon: trackIcon,
    zIndexOffset: 100,
  }).addTo(map);

  marker.bindPopup(buildTrackPopup(point), {
    className: "track-popup",
    maxWidth: 200,
  });

  markerByPointKey.set(pointKey, marker);

  marker.on("click", () => {
    collapseExpandedMultiPin({ keepActive: true });
    activePointKey = pointKey;
    syncActiveNoteUI();
  });

  marker.on("popupopen", () => {
    activePointKey = pointKey;
    syncActiveNoteUI();
  });

  marker.on("popupclose", () => {
    if (!isRefreshingMarkers && !suppressActivePointReset && activePointKey === pointKey) {
      activePointKey = null;
      syncActiveNoteUI();
    }
  });

  return marker;
}

function createMultiMarker(entries, locationKey) {
  const lat = entries[0].lat;
  const lon = entries[0].lon;
  const containsLast = entries.some((entry) => entry.isLast);
  const marker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: "multi-pin-wrapper",
      html: `<div class="multi-pin-marker${containsLast ? " is-last" : ""}" aria-label="${entries.length} poznámek na jednom místě"><span>${entries.length}</span></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    }),
    zIndexOffset: containsLast ? 450 : 250,
  }).addTo(map);

  const group = {
    locationKey,
    entries,
    marker,
    orbitMarkers: [],
    orbitLinks: [],
    orbitMarkerByPointKey: new Map(),
    activeOrbitPointKey: null,
    isExpanded: false,
  };

  multiPinGroups.set(locationKey, group);

  marker.on("click", () => {
    if (expandedMultiPin && expandedMultiPin.locationKey === locationKey) {
      collapseExpandedMultiPin();
      return;
    }

    expandMultiPin(locationKey, { openPopup: false });
  });

  entries.forEach((entry) => {
    markerByPointKey.set(entry.pointKey, {
      openPopup() {
        activePointKey = entry.pointKey;
        syncActiveNoteUI();
        expandMultiPin(locationKey, { focusPointKey: entry.pointKey, openPopup: true });
      }
    });
  });

  return marker;
}

function setMultiPinActiveOrbit(group, pointKey = null) {
  group.activeOrbitPointKey = pointKey;
  group.orbitMarkers.forEach((marker) => {
    const markerElement = marker.getElement();
    if (!markerElement) {
      return;
    }
    markerElement.classList.toggle("is-selected", marker._pointKey === pointKey);
  });
}

function getOrbitRadius(count) {
  return Math.max(54, Math.min(112, 34 + count * 14));
}

function getOrbitLatLng(centerLatLng, angle, radiusPx) {
  const zoom = map.getZoom();
  const centerPoint = map.project(centerLatLng, zoom);
  const orbitPoint = L.point(
    centerPoint.x + Math.cos(angle) * radiusPx,
    centerPoint.y + Math.sin(angle) * radiusPx,
  );
  return map.unproject(orbitPoint, zoom);
}

function getOrbitEntries(entries, focusPointKey) {
  const ordered = [...entries].reverse();
  if (!focusPointKey) {
    return ordered;
  }

  const focusIndex = ordered.findIndex((entry) => entry.pointKey === focusPointKey);
  if (focusIndex <= 0) {
    return ordered;
  }

  const [focusEntry] = ordered.splice(focusIndex, 1);
  ordered.unshift(focusEntry);
  return ordered;
}

function expandMultiPin(locationKey, options = {}) {
  const group = multiPinGroups.get(locationKey);
  if (!group) {
    return;
  }

  const focusPointKey = options.focusPointKey || null;
  const openPopup = options.openPopup === true;

  if (expandedMultiPin && expandedMultiPin.locationKey !== locationKey) {
    collapseExpandedMultiPin({ keepActive: true });
  }

  if (group.isExpanded) {
    const focusMarker = focusPointKey ? group.orbitMarkerByPointKey.get(focusPointKey) : null;
    if (openPopup && focusMarker) {
      focusMarker.openPopup();
      activePointKey = focusPointKey;
      syncActiveNoteUI();
      setMultiPinActiveOrbit(group, focusPointKey);
    } else if (!openPopup) {
      activePointKey = null;
      syncActiveNoteUI();
      setMultiPinActiveOrbit(group, null);
    }
    return;
  }

  const displayEntries = getOrbitEntries(group.entries, focusPointKey);
  const effectiveFocusPointKey = focusPointKey || (displayEntries[0] && displayEntries[0].pointKey) || null;
  const centerLatLng = group.marker.getLatLng();
  const radiusPx = getOrbitRadius(displayEntries.length);

  if (group.marker.getElement()) {
    group.marker.getElement().classList.add("is-expanded");
  }

  displayEntries.forEach((entry, index) => {
    const angle = -Math.PI / 2 + ((Math.PI * 2) / displayEntries.length) * index;
    const orbitLatLng = getOrbitLatLng(centerLatLng, angle, radiusPx);
    const orbitMarker = L.marker(orbitLatLng, {
      icon: L.divIcon({
        className: "orbit-pin-wrapper",
        html: `<div class="orbit-pin-marker${entry.isLast ? " is-last" : ""}" aria-label="Poznámka ${index + 1}"><span class="orbit-pin-number">${index + 1}</span></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
      zIndexOffset: entry.pointKey === effectiveFocusPointKey ? 700 : 550,
    }).addTo(map);
    orbitMarker._pointKey = entry.pointKey;

    const link = L.polyline([centerLatLng, orbitLatLng], {
      color: "#67e8f9",
      weight: 2,
      opacity: 0.55,
      dashArray: "4, 4",
      interactive: false,
    }).addTo(map);

    orbitMarker.bindPopup(buildPointPopup(entry.point), {
      autoClose: true,
      closeOnClick: false,
      closeButton: false,
      autoPan: false,
      offset: [0, -12],
      className: "multi-pin-popup",
    });

    orbitMarker.on("click", () => {
      activePointKey = entry.pointKey;
      syncActiveNoteUI();
      setMultiPinActiveOrbit(group, entry.pointKey);
    });

    orbitMarker.on("popupopen", () => {
      activePointKey = entry.pointKey;
      syncActiveNoteUI();
      setMultiPinActiveOrbit(group, entry.pointKey);
    });

    orbitMarker.on("popupclose", () => {
      if (group.activeOrbitPointKey === entry.pointKey) {
        setMultiPinActiveOrbit(group, null);
      }
      if (!isRefreshingMarkers && !suppressActivePointReset && expandedMultiPin !== group && activePointKey === entry.pointKey) {
        activePointKey = null;
        syncActiveNoteUI();
      }
    });

    group.orbitMarkers.push(orbitMarker);
    group.orbitLinks.push(link);
    group.orbitMarkerByPointKey.set(entry.pointKey, orbitMarker);
  });

  group.isExpanded = true;
  expandedMultiPin = group;
  activePointKey = openPopup ? effectiveFocusPointKey : null;
  syncActiveNoteUI();
  setMultiPinActiveOrbit(group, openPopup ? effectiveFocusPointKey : null);

  if (openPopup) {
    const focusMarker = effectiveFocusPointKey
      ? group.orbitMarkerByPointKey.get(effectiveFocusPointKey)
      : group.orbitMarkers[0];

    if (focusMarker) {
      focusMarker.openPopup();
    }
  }
}

function collapseExpandedMultiPin(options = {}) {
  if (!expandedMultiPin) {
    return;
  }

  const keepActive = options.keepActive === true;
  const group = expandedMultiPin;
  suppressActivePointReset = keepActive;

  group.orbitMarkers.forEach((marker) => {
    marker.closePopup();
    if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });
  group.orbitLinks.forEach((link) => {
    if (map.hasLayer(link)) {
      map.removeLayer(link);
    }
  });

  group.orbitMarkers = [];
  group.orbitLinks = [];
  group.orbitMarkerByPointKey = new Map();
  group.activeOrbitPointKey = null;
  group.isExpanded = false;

  if (group.marker.getElement()) {
    group.marker.getElement().classList.remove("is-expanded");
  }

  expandedMultiPin = null;
  suppressActivePointReset = false;

  if (!keepActive && activePointKey && group.entries.some((entry) => entry.pointKey === activePointKey)) {
    activePointKey = null;
    syncActiveNoteUI();
  }
}

// ── Pomocná funkce: přidá šipky směru pro nové segmenty polyline ──────────────
function addArrowsForSegments(latlngs, fromIndex) {
  for (let i = fromIndex; i < latlngs.length - 1; i++) {
    const a = latlngs[i];
    const b = latlngs[i + 1];
    const midLat = (a[0] + b[0]) / 2;
    const midLon = (a[1] + b[1]) / 2;
    const angle = bearing(a, b);
    const arrow = L.marker([midLat, midLon], {
      icon: L.divIcon({
        className: "",
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"
                    style="transform:rotate(${angle}deg);display:block;">
                 <polygon points="7,0 13,13 7,9 1,13"
                          fill="#22d3ee" opacity="0.7"/>
               </svg>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
    arrowMarkers.push(arrow);
  }
}

function setLatestActivePoint(validPoints) {
  if (hasShownInitialLatestPopup || validPoints.length === 0) {
    return;
  }

  activePointKey = getPointKey(validPoints[validPoints.length - 1]);
  hasShownInitialLatestPopup = true;
}

function updateTimestamp(data) {
  const timestamps = data.map((point) => String(point && point.time || "")).filter(Boolean);
  if (timestamps.length === 0) {
    return;
  }

  const maxTimestamp = timestamps.reduce((left, right) => (left > right ? left : right));
  if (maxTimestamp > (lastTimestamp || "")) {
    lastTimestamp = maxTimestamp;
  }
}

// ── Full load: stáhne celý dataset, resetuje mapu ─────────────────────────────
async function loadFull() {
  isRefreshingMarkers = true;
  try {
    const dataUrl = getSheetDataUrl();
    if (!dataUrl) {
      setNotesStatus("Chybí přístupový token. Otevři mapu s #token=... v URL.");
      return;
    }

    const res = await fetch(dataUrl, { cache: "no-store" });
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(data && data.error ? data.error : "Neplatná odpověď serveru.");
    }

    const validPoints = data.filter(isRenderablePoint);

    clearRenderedMarkers({ keepActive: true });
    clearTrack();

    allPoints = validPoints;
    allRecords = data.filter((point) => point != null);
    lastTimestamp = null;
    updateTimestamp(data);
    setLatestActivePoint(validPoints);

    renderTrack(validPoints);
    renderMarkers(validPoints);

    if (validPoints.length > 0 && !firstFitDone) {
      const bounds = L.latLngBounds(validPoints.map((point) => [Number(point.lat), Number(point.lon)]));
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.2));
        firstFitDone = true;
      }
    }

    renderNotesList(allRecords);
  } catch (error) {
    console.error("Načtení mapových dat selhalo:", error);
    setNotesStatus("Nepodařilo se načíst poznámky. Zkontroluj přístupový token.");
  } finally {
    isRefreshingMarkers = false;
  }
}

// ── Inkrementální load: stáhne jen nové záznamy, přidá na mapu ───────────────
async function loadIncremental() {
  const isAudioPlaying = Array.from(document.querySelectorAll("audio")).some((audio) => !audio.paused && !audio.ended);
  if (isAudioPlaying) return;

  isRefreshingMarkers = true;
  try {
    const dataUrl = getSheetDataUrl(lastTimestamp);
    if (!dataUrl) return;

    const res = await fetch(dataUrl, { cache: "no-store" });
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(data && data.error ? data.error : "Neplatná odpověď serveru.");
    }

    if (data.length === 0) {
      return;
    }

    const newValidPoints = data.filter(isRenderablePoint);
    if (newValidPoints.length > 0) {
      allPoints = allPoints.concat(newValidPoints);
      renderTrack(allPoints);
      renderMarkers(allPoints);
    }

    allRecords = allRecords.concat(data.filter((point) => point != null));
    updateTimestamp(data);
    renderNotesList(allRecords);
  } catch (error) {
    console.error("Inkrementální načtení selhalo, zkusím full load:", error);
    lastTimestamp = null;
    await loadFull();
  } finally {
    isRefreshingMarkers = false;
  }
}

// ── Vstupní bod ───────────────────────────────────────────────────────────────
async function loadData() {
  const isAudioPlaying = Array.from(document.querySelectorAll("audio")).some((audio) => !audio.paused && !audio.ended);
  if (isAudioPlaying) return;

  if (lastTimestamp === null) {
    await loadFull();
  } else {
    await loadIncremental();
  }
}

map.on("click", () => {
  collapseExpandedMultiPin();
});

map.on("zoomstart", () => {
  collapseExpandedMultiPin({ keepActive: true });
});

map.on("dragstart", () => {
  collapseExpandedMultiPin({ keepActive: true });
});

initializeGpxLayer();
loadData();
setInterval(loadData, 10000);
