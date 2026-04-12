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

// ── Načítání dat ──────────────────────────────────────────────────────────────
async function loadData() {
  const isAudioPlaying = Array.from(document.querySelectorAll("audio")).some((audio) => !audio.paused && !audio.ended);
  if (isAudioPlaying) {
    return;
  }

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

    markers.forEach((m) => map.removeLayer(m));
    markers = [];
    markerByPointKey = new Map();
    if (notesPolyline) { map.removeLayer(notesPolyline); notesPolyline = null; }
    arrowMarkers.forEach((m) => map.removeLayer(m));
    arrowMarkers = [];

    const validPoints = data.filter((point) =>
      point &&
      point.lat !== null &&
      point.lon !== null &&
      point.lat !== "" &&
      point.lon !== "" &&
      !Number.isNaN(Number(point.lat)) &&
      !Number.isNaN(Number(point.lon))
    );

    if (validPoints.length >= 2) {
      const latlngs = validPoints.map((p) => [Number(p.lat), Number(p.lon)]);
      notesPolyline = L.polyline(latlngs, {
        color: "#22d3ee",
        weight: 2,
        opacity: 0.5,
        dashArray: "6, 6",
      }).addTo(map);

      for (let i = 0; i < latlngs.length - 1; i++) {
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

    validPoints.forEach((point, index) => {
      const isLast = index === validPoints.length - 1;
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

      markers.push(marker);
    });

    if (validPoints.length > 0 && !firstFitDone) {
      const bounds = L.latLngBounds(validPoints.map((p) => [Number(p.lat), Number(p.lon)]));
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.2));
        firstFitDone = true;
      }
    }

    if (!hasShownInitialLatestPopup && validPoints.length > 0) {
      activePointKey = getPointKey(validPoints[validPoints.length - 1]);
      hasShownInitialLatestPopup = true;
    }

    if (activePointKey) {
      const activeMarker = markerByPointKey.get(activePointKey);
      if (activeMarker) {
        activeMarker.openPopup();
      }
    }

    const allPoints = data.filter((p) => p != null);
    renderNotesList(allPoints);
  } catch (error) {
    console.error("Načtení mapových dat selhalo:", error);
    setNotesStatus("Nepodařilo se načíst poznámky. Zkontroluj přístupový token.");
  } finally {
    isRefreshingMarkers = false;
  }
}

initializeGpxLayer();
loadData();
setInterval(loadData, 10000);
