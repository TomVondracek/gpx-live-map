// ── Lightbox ─────────────────────────────────────────────────────────────────
(function () {
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lightbox-img");
  const lbCapt = document.getElementById("lightbox-caption");
  const lbClose = document.getElementById("lightbox-close");

  function open(point) {
    const fullSrc = `https://drive.google.com/thumbnail?id=${point.photo_file_id}&sz=w1600`;
    lbImg.src = "";
    lbImg.style.opacity = "0.4";
    lbImg.onload = () => { lbImg.style.opacity = "1"; };
    lbImg.src = fullSrc;

    lbCapt.textContent = point.time ? formatTime(point.time) : "";

    lb.classList.add("open");
    document.addEventListener("keydown", onKey);
  }

  function close() {
    lb.classList.remove("open");
    lbImg.src = "";
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  lb.addEventListener("click", (e) => {
    if (e.target === lb || e.target === lbCapt) close();
  });
  lbClose.addEventListener("click", close);

  window.openLightbox = open;
  window.closeLightbox = close;
})();
