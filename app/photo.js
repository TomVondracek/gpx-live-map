// ── Foto záznam ──────────────────────────────────────────────────────────────
async function takePhoto() {
  const Camera = getCapacitorPlugin("Camera");
  if (!Camera) {
    return showError("Fotoaparát není dostupný.");
  }

  try {
    const image = await Camera.getPhoto({
      quality: 60,
      allowEditing: false,
      resultType: "base64",
      saveToGallery: true,
      width: 1200,
      source: "CAMERA"
    });

    discardNote({ keepMessages: true });

    pendingPhoto = {
      base64: image.base64String,
      mimeType: `image/${image.format || "jpeg"}`
    };
    vibrate("medium");

    const container = document.getElementById("photo-preview");
    const img = document.getElementById("photo-preview-img");
    img.src = `data:${pendingPhoto.mimeType};base64,${pendingPhoto.base64}`;
    container.classList.remove("hidden");

    document.getElementById("transcript").classList.add("hidden");
    document.getElementById("audio-preview").classList.add("hidden");

    document.getElementById("section-confirm").classList.remove("hidden");
  } catch (error) {
    if (error.message && error.message.includes("User cancelled")) {
      return;
    }
    console.error("Chyba při focení:", error);
    showError("Nepodařilo se pořídit fotku.");
  }
}
