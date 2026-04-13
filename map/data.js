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
      if (!(layer instanceof L.Polyline)) return;

      const flatten = (latlngGroups) => {
        if (latlngGroups.length > 0 && Array.isArray(latlngGroups[0])) {
          latlngGroups.forEach(flatten);
          return;
        }

        latlngGroups.forEach((ll) => {
          if (lastPt) {
            cumulativeDist += getDistanceFromLatLonInMeters(lastPt.lat, lastPt.lng, ll.lat, ll.lng);
          }
          gpxPoints.push({ lat: ll.lat, lon: ll.lng, km: cumulativeDist / 1000 });
          lastPt = ll;
        });
      };

      flatten(layer.getLatLngs());
    });

    if (allRecords.length > 0) {
      renderPlaybackState({ preserveOpenPopup: true });
    }
  }).addTo(map);
}

function createMarker(point, isLast) {
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  const pointKey = getPointKey(point);

  const marker = L.marker([lat, lon], isLast ? { icon: redIcon } : {}).addTo(map);

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

  marker.bindPopup(buildPopupContent(point, weatherLine, metaParts));
  marker._pointKey = pointKey;
  markerByPointKey.set(pointKey, marker);
  marker.on("popupopen", () => {
    activePointKey = pointKey;
    syncActiveNoteUI();
  });
  marker.on("popupclose", () => {
    if (!isRefreshingMarkers && activePointKey === pointKey) {
      activePointKey = null;
      syncActiveNoteUI();
    }
  });

  return marker;
}

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

function clearRenderedMapState() {
  markers.forEach((marker) => map.removeLayer(marker));
  markers = [];
  markerByPointKey = new Map();

  if (notesPolyline) {
    map.removeLayer(notesPolyline);
    notesPolyline = null;
  }

  arrowMarkers.forEach((marker) => map.removeLayer(marker));
  arrowMarkers = [];
}

function sortRecords(records) {
  return [...records].sort((left, right) => compareRecordTimes(left && left.time, right && right.time));
}

function mergeRecords(existingRecords, incomingRecords) {
  const merged = new Map();

  [...existingRecords, ...incomingRecords].forEach((record) => {
    if (!record) return;
    merged.set(getPointKey(record), record);
  });

  return sortRecords(Array.from(merged.values()));
}

function updateLastTimestampFromRecords(records) {
  const timestamps = records
    .map((record) => String(record && record.time || ""))
    .filter(Boolean)
    .sort((a, b) => compareRecordTimes(a, b));

  lastTimestamp = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
}

function applyFetchedRecords(records) {
  allRecords = sortRecords(records.filter((record) => record != null));
  allPoints = allRecords.filter(hasValidCoordinates);
  updateLastTimestampFromRecords(allRecords);

  if (!hasShownInitialLatestPopup && allPoints.length > 0) {
    activePointKey = getPointKey(allPoints[allPoints.length - 1]);
    hasShownInitialLatestPopup = true;
  }

  syncPlaybackDataset(allPoints);
  renderPlaybackState({ preserveOpenPopup: true });
}

function resolveVisibleActivePoint(visiblePoints) {
  if (visiblePoints.length === 0) {
    activePointKey = null;
    return null;
  }

  const activeVisiblePoint = visiblePoints.find((point) => getPointKey(point) === activePointKey);
  if (activeVisiblePoint) {
    return activeVisiblePoint;
  }

  if (playbackMode === "history" && playbackIndex != null && playbackPoints[playbackIndex]) {
    const selectedKey = getPointKey(playbackPoints[playbackIndex]);
    const selectedVisiblePoint = visiblePoints.find((point) => getPointKey(point) === selectedKey);
    if (selectedVisiblePoint) {
      activePointKey = selectedKey;
      return selectedVisiblePoint;
    }
  }

  const fallbackPoint = visiblePoints[visiblePoints.length - 1];
  activePointKey = getPointKey(fallbackPoint);
  return fallbackPoint;
}

function renderVisibleMapState(visiblePoints, options = {}) {
  clearRenderedMapState();

  if (visiblePoints.length >= 2) {
    const latlngs = visiblePoints.map((point) => [Number(point.lat), Number(point.lon)]);
    notesPolyline = L.polyline(latlngs, {
      color: "#22d3ee",
      weight: 2,
      opacity: 0.5,
      dashArray: "6, 6",
    }).addTo(map);
    addArrowsForSegments(latlngs, 0);
  }

  visiblePoints.forEach((point, index) => {
    const marker = createMarker(point, index === visiblePoints.length - 1);
    markers.push(marker);
  });

  if (visiblePoints.length > 0 && !firstFitDone) {
    const bounds = L.latLngBounds(visiblePoints.map((point) => [Number(point.lat), Number(point.lon)]));
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2));
      firstFitDone = true;
    }
  }

  const activeVisiblePoint = resolveVisibleActivePoint(visiblePoints);
  if (!activeVisiblePoint) return;

  const activeMarker = markerByPointKey.get(getPointKey(activeVisiblePoint));
  if (!activeMarker) return;

  if (options.centerSelected) {
    map.setView([Number(activeVisiblePoint.lat), Number(activeVisiblePoint.lon)], 15, { animate: true });
  } else if (options.centerLatest) {
    const lastPoint = visiblePoints[visiblePoints.length - 1];
    map.setView([Number(lastPoint.lat), Number(lastPoint.lon)], 15, { animate: true });
  }

  if (options.preserveOpenPopup !== false || playbackMode === "history") {
    activeMarker.openPopup();
  }
}

function renderPlaybackState(options = {}) {
  const visibleRecords = getPlaybackVisibleRecords(allRecords);
  const visiblePoints = getPlaybackVisibleGpsPoints(allPoints);

  isRefreshingMarkers = true;
  try {
    renderVisibleMapState(visiblePoints, options);
    renderNotesList(visibleRecords);
    syncTimelineControls();
  } finally {
    isRefreshingMarkers = false;
  }
}

function resetRenderedDataset() {
  allRecords = [];
  allPoints = [];
  lastTimestamp = null;
  clearRenderedMapState();
}

async function loadFull() {
  try {
    const dataUrl = getSheetDataUrl();
    if (!dataUrl) {
      resetRenderedDataset();
      setNotesStatus("Chybí přístupový token. Otevři mapu s #token=... v URL.");
      syncPlaybackDataset([]);
      return;
    }

    const response = await fetch(dataUrl, { cache: "no-store" });
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(data && data.error ? data.error : "Neplatná odpověď serveru.");
    }

    applyFetchedRecords(data);
  } catch (error) {
    console.error("Načtení mapových dat selhalo:", error);
    resetRenderedDataset();
    setNotesStatus("Nepodařilo se načíst poznámky. Zkontroluj přístupový token.");
    syncPlaybackDataset([]);
  }
}

async function loadIncremental() {
  const isAudioPlaying = Array.from(document.querySelectorAll("audio")).some((audio) => !audio.paused && !audio.ended);
  if (isAudioPlaying) return;

  try {
    const dataUrl = getSheetDataUrl(lastTimestamp);
    if (!dataUrl) return;

    const response = await fetch(dataUrl, { cache: "no-store" });
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(data && data.error ? data.error : "Neplatná odpověď serveru.");
    }

    if (data.length === 0) return;

    applyFetchedRecords(mergeRecords(allRecords, data));
  } catch (error) {
    console.error("Inkrementální načtení selhalo, zkusím full load:", error);
    lastTimestamp = null;
    await loadFull();
  }
}

async function loadData() {
  const isAudioPlaying = Array.from(document.querySelectorAll("audio")).some((audio) => !audio.paused && !audio.ended);
  if (isAudioPlaying) return;

  if (lastTimestamp === null) {
    await loadFull();
  } else {
    await loadIncremental();
  }
}

initializeGpxLayer();
loadData();
setInterval(loadData, 10000);
