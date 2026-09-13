/* ============================================================================
   IMAGE EDITOR — CORE GEOMETRY
   Pure functions, no DOM, no side effects. Everything that can be wrong about
   a crop is decided here, so it can be tested without a browser.

   Coordinate spaces
   -----------------
   image space : pixels of the original uploaded image (natW x natH)
   frame space : pixels of the on-screen crop window (frame x frame)
   disp        : image->frame scale factor = baseScale * zoom
   offX/offY   : position of the image's top-left corner, in frame space
                 (always <= 0: the image covers the frame)

   Stored crop
   -----------
   Offsets are NEVER persisted in frame space. A stored crop is
   {zoom, cx, cy} where cx/cy are the crop centre in NORMALISED image
   coordinates (0..1). That makes the frame size a free display choice:
   the same stored crop reopens correctly in a 280px or a 200px frame.
   This is the one thing that must not be simplified back.
   ==========================================================================*/

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // Node (tests)
  root.ImageEditorCore = api;                                              // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;

  /* Scale at which the image exactly covers the frame.
     max(), not min(): min() fits the whole image inside and leaves empty
     bands on any non-square photo. */
  function baseScale(natW, natH, frame) {
    if (!(natW > 0) || !(natH > 0) || !(frame > 0)) throw new RangeError('baseScale: bad dimensions');
    return Math.max(frame / natW, frame / natH);
  }

  function clampZoom(z) {
    if (!isFinite(z)) return MIN_ZOOM;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  /* Keep the image covering the frame: its top-left can't go past 0, and its
     bottom-right can't come inside the frame. */
  function clampOffsets(offX, offY, natW, natH, frame, disp) {
    const dispW = natW * disp, dispH = natH * disp;
    return {
      offX: Math.min(0, Math.max(frame - dispW, offX)),
      offY: Math.min(0, Math.max(frame - dispH, offY))
    };
  }

  /* Zoom keeping whatever sits at the frame centre in place. Scaling the
     transform alone makes the picture slide away under the cursor. */
  function zoomAboutCentre(offX, offY, frame, oldDisp, newDisp) {
    const cx = frame / 2 - offX, cy = frame / 2 - offY;
    return {
      offX: frame / 2 - cx * (newDisp / oldDisp),
      offY: frame / 2 - cy * (newDisp / oldDisp)
    };
  }

  /* Centred starting position for a fresh upload. */
  function centredOffsets(natW, natH, frame, disp) {
    return { offX: (frame - natW * disp) / 2, offY: (frame - natH * disp) / 2 };
  }

  /* The square of the ORIGINAL image that the frame is showing.
     This is what gets drawn to the export canvas. */
  function cropRect(offX, offY, frame, disp) {
    return { sx: -offX / disp, sy: -offY / disp, size: frame / disp };
  }

  /* --- persistence: frame-space offsets  <->  normalised crop ------------ */

  function toStored(offX, offY, natW, natH, frame, zoom) {
    const disp = baseScale(natW, natH, frame) * zoom;
    const r = cropRect(offX, offY, frame, disp);
    return {
      zoom: zoom,
      cx: (r.sx + r.size / 2) / natW,
      cy: (r.sy + r.size / 2) / natH
    };
  }

  function fromStored(stored, natW, natH, frame) {
    const zoom = clampZoom(stored && stored.zoom);
    const disp = baseScale(natW, natH, frame) * zoom;
    const size = frame / disp;
    const sx = stored.cx * natW - size / 2;
    const sy = stored.cy * natH - size / 2;
    const c = clampOffsets(-sx * disp, -sy * disp, natW, natH, frame, disp);
    return { zoom: zoom, offX: c.offX, offY: c.offY };
  }

  /* --- upload validation ------------------------------------------------- */

  const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_BYTES = 12 * 1024 * 1024;   // phone photos are routinely 8-12MB
  const MIN_EDGE = 200;                 // below this, any crop is unusably soft

  function validateFile(file, maxBytes) {
    const limit = maxBytes || MAX_BYTES;
    if (!file) return { ok: false, reason: 'No file selected' };
    if (ACCEPTED.indexOf(file.type) === -1)
      return { ok: false, reason: 'Unsupported format — use JPG, PNG, WebP or GIF' };
    if (file.size > limit)
      return { ok: false, reason: 'Image is too large (' + (file.size / 1048576).toFixed(1) +
                                  'MB) — the limit is ' + Math.round(limit / 1048576) + 'MB' };
    return { ok: true };
  }

  function validateDimensions(natW, natH, minEdge) {
    const min = minEdge || MIN_EDGE;
    if (!(natW > 0) || !(natH > 0)) return { ok: false, reason: 'Image could not be read' };
    if (Math.min(natW, natH) < min)
      return { ok: false, reason: 'Image is too small (' + natW + '\u00d7' + natH +
                                  ') — it needs at least ' + min + 'px on the short side' };
    return { ok: true };
  }

  return {
    MIN_ZOOM, MAX_ZOOM, ACCEPTED, MAX_BYTES, MIN_EDGE,
    baseScale, clampZoom, clampOffsets, zoomAboutCentre, centredOffsets,
    cropRect, toStored, fromStored, validateFile, validateDimensions
  };
});
