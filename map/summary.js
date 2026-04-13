const summaryLocation = document.getElementById("summary-location");
const summaryLocationSub = document.getElementById("summary-location-sub");
const summaryBattery = document.getElementById("summary-battery");
const summaryBatterySub = document.getElementById("summary-battery-sub");
const summaryContact = document.getElementById("summary-contact");
const summaryContactSub = document.getElementById("summary-contact-sub");
const summaryPace = document.getElementById("summary-pace");
const summaryPaceSub = document.getElementById("summary-pace-sub");
const summaryRoute = document.getElementById("summary-route");
const summaryRouteSub = document.getElementById("summary-route-sub");

function findLatestRecordWith(records, predicate) {
  for (let index = records.length - 1; index >= 0; index--) {
    const candidate = records[index];
    if (predicate(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getLatestSummarySnapshot() {
  const latestRecord = allRecords.length > 0 ? allRecords[allRecords.length - 1] : null;
  const latestGpsPoint = allPoints.length > 0 ? allPoints[allPoints.length - 1] : null;
  const latestBatteryRecord = findLatestRecordWith(allRecords, (record) => record && record.battery != null);
  const latestSpeedRecord = findLatestRecordWith(allPoints, (record) => record && record.speed != null && Number(record.speed) > 0);

  return {
    latestRecord,
    latestGpsPoint,
    latestBatteryRecord,
    latestSpeedRecord
  };
}

function updateSummaryPanel() {
  const snapshot = getLatestSummarySnapshot();

  if (!snapshot.latestRecord) {
    summaryLocation.textContent = "Čekám na data…";
    summaryLocationSub.textContent = "—";
    summaryBattery.textContent = "—";
    summaryBatterySub.textContent = "Poslední známý stav";
    summaryContact.textContent = "—";
    summaryContactSub.textContent = "—";
    summaryPace.textContent = "—";
    summaryPaceSub.textContent = "—";
    summaryRoute.textContent = "—";
    summaryRouteSub.textContent = "Vzdálenost od startu";
    return;
  }

  if (snapshot.latestGpsPoint) {
    const routeKm = findRouteKm(Number(snapshot.latestGpsPoint.lat), Number(snapshot.latestGpsPoint.lon));
    summaryLocation.textContent = formatLatLon(snapshot.latestGpsPoint.lat, snapshot.latestGpsPoint.lon);
    summaryLocationSub.textContent = routeKm != null
      ? `Blízko km ${routeKm.toFixed(1)} na trase`
      : "Mimo známou GPX trasu";
    summaryRoute.textContent = formatRouteDistance(routeKm);
  } else {
    summaryLocation.textContent = "Bez GPS";
    summaryLocationSub.textContent = "Zatím bez validní polohy";
    summaryRoute.textContent = "—";
  }

  summaryRouteSub.textContent = "Vzdálenost od startu";

  if (snapshot.latestBatteryRecord && snapshot.latestBatteryRecord.battery != null) {
    summaryBattery.textContent = `${snapshot.latestBatteryRecord.battery}%`;
    summaryBatterySub.textContent = snapshot.latestBatteryRecord.time
      ? `Naposledy ${formatTimeShort(snapshot.latestBatteryRecord.time)}`
      : "Poslední známý stav";
  } else {
    summaryBattery.textContent = "—";
    summaryBatterySub.textContent = "Poslední známý stav";
  }

  summaryContact.textContent = formatRelativeTimeFromNow(snapshot.latestRecord.time);
  summaryContactSub.textContent = snapshot.latestRecord.time
    ? formatTime(snapshot.latestRecord.time)
    : "—";

  if (snapshot.latestSpeedRecord) {
    summaryPace.textContent = formatPaceFromSpeed(snapshot.latestSpeedRecord.speed);
    summaryPaceSub.textContent = formatSpeedText(snapshot.latestSpeedRecord.speed);
  } else {
    summaryPace.textContent = "—";
    summaryPaceSub.textContent = "Bez známé rychlosti";
  }
}

window.setInterval(updateSummaryPanel, 30000);
updateSummaryPanel();
