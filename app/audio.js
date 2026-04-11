function stopAudioStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

function clearAudioRecordingTimer() {
  if (audioStopTimer) {
    clearTimeout(audioStopTimer);
    audioStopTimer = null;
  }
  if (audioDurationInterval) {
    clearInterval(audioDurationInterval);
    audioDurationInterval = null;
  }
}

async function finalizeAudioRecording() {
  clearAudioRecordingTimer();

  const blob = new Blob(mediaChunks, { type: mediaMimeType || "audio/webm" });
  mediaChunks = [];
  stopAudioStream();
  mediaRecorder = null;

  if (!blob.size) {
    pendingAudioNote = null;
    showError("Hlasová poznámka je prázdná. Zkus nahrávání znovu.");
    finishRecording();
    return;
  }

  if (blob.size > MAX_AUDIO_SIZE_BYTES) {
    pendingAudioNote = null;
    showError("Hlasová poznámka je příliš velká. Zkus kratší záznam.");
    finishRecording();
    return;
  }

  const durationSec = Math.max(
    1,
    Math.round((Date.now() - audioRecordingStartedAt) / 1000),
  );

  showAudioPreview({
    blob,
    durationSec,
    mimeType: blob.type || mediaMimeType || "audio/webm",
    fileName: `hlasova-poznamka-${Date.now()}.${getAudioFileExtension(blob.type || mediaMimeType)}`,
  });
  showSuccess("Hlasová poznámka připravena k odeslání.");
  finishRecording();
}

async function startAudioRecording() {
  if (!supportsMediaRecording()) {
    showError("Nahrávání zvuku není v tomto zařízení podporováno.");
    return;
  }

  discardNote({ keepMessages: true });
  document.getElementById("transcript").readOnly = true;
  document.getElementById("transcript").classList.add("hidden");
  document.getElementById("section-error").classList.add("hidden");

  try {
    const permissionGranted = await ensureMicrophonePermission();
    if (!permissionGranted) {
      showError("Přístup k mikrofonu byl zamítnut. Povol oprávnění v nastavení aplikace.");
      document.getElementById("transcript").readOnly = false;
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaMimeType = pickSupportedAudioMimeType();
    mediaChunks = [];
    audioRecordingStartedAt = Date.now();

    mediaRecorder = mediaMimeType
      ? new MediaRecorder(mediaStream, { mimeType: mediaMimeType })
      : new MediaRecorder(mediaStream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        mediaChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      finalizeAudioRecording().catch((error) => {
        console.error("Finalizace audio záznamu selhala:", error);
        showError("Nepodařilo se dokončit hlasovou poznámku.");
        finishRecording();
      });
    }, { once: true });

    isRecording = true;
    activeCaptureMode = "audio";
    userStoppedRecording = false;
    setRecordingUI(true);
    vibrate("medium");
    keepScreenOn();
    beep("start");

    mediaRecorder.start();
    audioDurationInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - audioRecordingStartedAt) / 1000);
      const label = document.getElementById("recording-label");
      if (label) {
        label.textContent = `Nahrávám hlasovou poznámku (${formatAudioDuration(elapsedSec)})`;
      }
    }, 1000);

    audioStopTimer = setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, MAX_AUDIO_DURATION_MS);
  } catch (error) {
    stopAudioStream();
    mediaRecorder = null;
    mediaChunks = [];
    activeCaptureMode = null;
    isRecording = false;
    setRecordingUI(false);
    allowScreenOff();
    if (error && /permission/i.test(error.message || "")) {
      showError("Přístup k mikrofonu byl zamítnut. Povol oprávnění v nastavení aplikace.");
    } else {
      showError("Nelze spustit nahrávání zvuku: " + (error.message || error));
    }
  }
}

async function stopAudioRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    finishRecording();
    return;
  }

  isRecording = false;
  userStoppedRecording = true;
  clearAudioRecordingTimer();
  beep("stop");
  mediaRecorder.stop();
}
