const timelineShell = document.getElementById("timeline-shell");
const timelineSlider = document.getElementById("timeline-slider");
const timelinePlayButton = document.getElementById("timeline-play");
const timelineLiveButton = document.getElementById("timeline-live");
const timelineModeLabel = document.getElementById("timeline-mode");
const timelineCurrentLabel = document.getElementById("timeline-current");
const timelineRangeLabel = document.getElementById("timeline-range");

function stopTimelinePlayback() {
  if (playbackTimer) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
}

function hasPlaybackHistory() {
  return playbackPoints.length >= 2;
}

function clampPlaybackIndex(index) {
  if (playbackPoints.length === 0) return null;
  return Math.max(0, Math.min(playbackPoints.length - 1, index));
}

function getPlaybackCutoffTime() {
  if (playbackMode !== "history" || playbackIndex == null || playbackPoints.length === 0) {
    return null;
  }

  return playbackPoints[playbackIndex].time || null;
}

function getPlaybackVisibleRecords(records) {
  const cutoffTime = getPlaybackCutoffTime();
  if (!cutoffTime) return records;

  return records.filter((record) => compareRecordTimes(record && record.time, cutoffTime) <= 0);
}

function getPlaybackVisibleGpsPoints(points) {
  if (playbackMode !== "history" || playbackIndex == null || playbackPoints.length === 0) {
    return points;
  }

  const cutoffTime = getPlaybackCutoffTime();
  return points.filter((point) => compareRecordTimes(point && point.time, cutoffTime) <= 0);
}

function syncTimelineControls() {
  const maxIndex = Math.max(0, playbackPoints.length - 1);
  const hasPoints = playbackPoints.length > 0;
  const selectedIndex = playbackMode === "live" || playbackIndex == null
    ? maxIndex
    : clampPlaybackIndex(playbackIndex);

  timelineSlider.max = String(maxIndex);
  timelineSlider.value = String(selectedIndex == null ? 0 : selectedIndex);
  timelineSlider.disabled = !hasPlaybackHistory();
  timelinePlayButton.disabled = !hasPlaybackHistory();
  timelineLiveButton.disabled = !hasPoints;
  timelineLiveButton.classList.toggle("active", playbackMode === "live");
  timelinePlayButton.classList.toggle("active", !!playbackTimer);

  const currentPoint = hasPoints && selectedIndex != null ? playbackPoints[selectedIndex] : null;
  const currentText = currentPoint ? (formatTime(currentPoint.time) || "Bez času") : "Čekám na data…";

  timelineModeLabel.textContent = playbackMode === "live"
    ? "Živě"
    : (playbackTimer ? "Přehrávání" : "Historie");
  timelineCurrentLabel.textContent = currentText;
  timelineRangeLabel.textContent = hasPoints
    ? `${Math.min(selectedIndex + 1, playbackPoints.length)} / ${playbackPoints.length} bodů`
    : "0 / 0 bodů";
  timelinePlayButton.textContent = playbackTimer ? "Pozastavit" : "Přehrát";
  timelineShell.classList.toggle("timeline-history", playbackMode === "history");
}

function syncPlaybackDataset(points) {
  const previousLatestKey = playbackPoints.length > 0
    ? getPointKey(playbackPoints[playbackPoints.length - 1])
    : null;

  playbackPoints = points.filter(hasValidCoordinates);
  if (playbackPoints.length === 0) {
    playbackMode = "live";
    playbackIndex = null;
    stopTimelinePlayback();
    syncTimelineControls();
    return;
  }

  if (playbackMode === "live") {
    playbackIndex = playbackPoints.length - 1;
    const nextLatestKey = getPointKey(playbackPoints[playbackIndex]);
    if (!activePointKey || activePointKey === previousLatestKey) {
      activePointKey = nextLatestKey;
    }
  } else {
    playbackIndex = clampPlaybackIndex(playbackIndex == null ? playbackPoints.length - 1 : playbackIndex);
    if (playbackIndex != null) {
      activePointKey = getPointKey(playbackPoints[playbackIndex]);
    }
  }

  syncTimelineControls();
}

function requestTimelineRender(options = {}) {
  if (typeof renderPlaybackState === "function") {
    renderPlaybackState(options);
  }
}

function setPlaybackIndex(nextIndex, options = {}) {
  const clampedIndex = clampPlaybackIndex(nextIndex);
  if (clampedIndex == null) return;

  if (options.pausePlayback !== false) {
    stopTimelinePlayback();
  }

  playbackMode = "history";
  playbackIndex = clampedIndex;
  activePointKey = getPointKey(playbackPoints[clampedIndex]);
  syncTimelineControls();
  requestTimelineRender({
    centerSelected: options.centerSelected !== false,
    preserveOpenPopup: options.preserveOpenPopup !== false
  });
}

function setPlaybackLive(options = {}) {
  stopTimelinePlayback();
  playbackMode = "live";
  playbackIndex = playbackPoints.length > 0 ? playbackPoints.length - 1 : null;
  if (playbackIndex != null) {
    activePointKey = getPointKey(playbackPoints[playbackIndex]);
  }
  syncTimelineControls();
  requestTimelineRender({
    centerLatest: options.centerLatest !== false,
    preserveOpenPopup: options.preserveOpenPopup !== false
  });
}

function advancePlaybackFrame() {
  if (playbackPoints.length === 0) {
    stopTimelinePlayback();
    syncTimelineControls();
    return;
  }

  if (playbackIndex == null || playbackIndex >= playbackPoints.length - 1) {
    stopTimelinePlayback();
    syncTimelineControls();
    return;
  }

  setPlaybackIndex(playbackIndex + 1, {
    pausePlayback: false,
    centerSelected: true,
    preserveOpenPopup: true
  });
}

function togglePlaybackAnimation() {
  if (!hasPlaybackHistory()) return;

  if (playbackTimer) {
    stopTimelinePlayback();
    syncTimelineControls();
    return;
  }

  if (playbackMode === "live" || playbackIndex == null || playbackIndex >= playbackPoints.length - 1) {
    playbackMode = "history";
    playbackIndex = 0;
    activePointKey = getPointKey(playbackPoints[playbackIndex]);
    requestTimelineRender({ centerSelected: true, preserveOpenPopup: true });
  }

  playbackTimer = window.setInterval(advancePlaybackFrame, 900);
  syncTimelineControls();
}

timelineSlider.addEventListener("input", (event) => {
  const nextIndex = Number(event.target.value);
  if (Number.isNaN(nextIndex)) return;
  setPlaybackIndex(nextIndex, { centerSelected: true, preserveOpenPopup: true });
});

timelinePlayButton.addEventListener("click", togglePlaybackAnimation);
timelineLiveButton.addEventListener("click", () => {
  setPlaybackLive({ centerLatest: true, preserveOpenPopup: true });
});

syncTimelineControls();
