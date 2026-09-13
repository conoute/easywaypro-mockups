/* ============================================================================
   IMAGE EDITOR — UI LAYER
   Depends on image-editor-core.js (pure geometry) and on the design system's
   .modal / .btn / .modal-scrim classes.

   Use it wherever the product accepts a user-supplied image: driver and
   team-member avatars, carrier and customer logos, truck and trailer photos.

     const field = ImageEditor.createField({
       shape:   'circle',            // 'circle' | 'rounded' | 'square'
       size:    160,                 // rendered size in px
       output:  600,                 // exported square, px
       format:  'jpeg',              // 'jpeg' | 'png'  (png for logos)
       emptyIcon: 'person',
       label:   'Profile photo',
       value:   null,                // {baked, original, crop} or null
       onChange: (value, event) => { ... }   // event: 'upload'|'adjust'|'remove'
     });
     container.appendChild(field.el);
     field.getValue();               // persist this
     field.setValue(v);

   The stored value is:
     { baked: dataURL,   // square, what every surface renders
       original: dataURL,// raw upload, so the crop can be reopened
       crop: {zoom,cx,cy}} // normalised — independent of frame size
   ==========================================================================*/

(function (root, factory) {
  const api = factory(root.ImageEditorCore ||
              (typeof require === 'function' ? require('./image-editor-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ImageEditor = api;
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const FRAME = 280;   // editor crop window. Display-only: stored crops are
                       // normalised, so changing this cannot break saved data.

  /* ---------- small DOM helpers (self-contained on purpose) ------------- */
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function icon(name, size) {
    return '<span class="material-symbols-outlined" style="font-size:' +
           (size || 18) + 'px;line-height:1;">' + name + '</span>';
  }
  function toast(msg, kind) {
    const t = h('<div class="ie-toast' + (kind === 'error' ? ' error' : '') + '">' +
                icon(kind === 'error' ? 'error' : 'check_circle', 16) +
                '<span>' + msg + '</span></div>');
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function(){ t.remove(); }, 260); }, 2600);
  }

  /* ---------- decoding, with EXIF orientation honoured ------------------ */
  /* Phone photos carry a rotation flag. Browsers disagree on whether
     drawImage honours it, so a portrait shot can bake sideways. createImageBitmap
     with imageOrientation:'from-image' settles it; older browsers fall back to
     a plain <img>, which is the previous behaviour, not a regression. */
  function decode(dataUrl) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        if (typeof createImageBitmap !== 'function') return resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight });
        fetch(dataUrl).then(function (r) { return r.blob(); })
          .then(function (b) { return createImageBitmap(b, { imageOrientation: 'from-image' }); })
          .then(function (bmp) { resolve({ src: bmp, w: bmp.width, h: bmp.height }); })
          .catch(function () { resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight }); });
      };
      img.onerror = function () { reject(new Error('Image could not be read')); };
      img.src = dataUrl;
    });
  }

  /* ---------- the editor modal ----------------------------------------- */
  function openEditor(opts) {
    const dataUrl = opts.dataUrl, storedCrop = opts.crop;
    const output = opts.output || 600, format = opts.format || 'jpeg';

    const scrim = h('<div class="modal-scrim open ie-scrim"></div>');
    const modal = h(
      '<div class="modal ie-modal" role="dialog" aria-modal="true" aria-label="Adjust image">' +
        '<h2>Adjust image</h2>' +
        '<p class="mdesc">Drag to reposition, zoom to frame it right.</p>' +
        '<div class="ie-frame" tabindex="0" aria-label="Crop area — drag to reposition, arrow keys to nudge">' +
          '<canvas class="ie-canvas" width="' + FRAME + '" height="' + FRAME + '"></canvas>' +
          '<div class="ie-grid"></div>' +
        '</div>' +
        '<div class="ie-zoom-row">' + icon('zoom_out', 16) +
          '<input type="range" class="ie-zoom" min="1" max="4" step="0.01" value="1" aria-label="Zoom">' +
          icon('zoom_in', 16) +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn" data-a="cancel">Cancel</button>' +
          '<button class="btn primary" data-a="save">Save</button>' +
        '</div>' +
      '</div>');
    scrim.appendChild(modal);
    document.body.appendChild(scrim);

    const frame  = modal.querySelector('.ie-frame');
    const canvas = modal.querySelector('.ie-canvas');
    const ctx    = canvas.getContext('2d');
    const zoomEl = modal.querySelector('.ie-zoom');

    let src = null, natW = 0, natH = 0, bs = 1, zoom = 1, offX = 0, offY = 0;

    function paint() {
      const disp = bs * zoom;
      const c = Core.clampOffsets(offX, offY, natW, natH, FRAME, disp);
      offX = c.offX; offY = c.offY;
      ctx.clearRect(0, 0, FRAME, FRAME);
      ctx.drawImage(src, offX, offY, natW * disp, natH * disp);
    }

    decode(dataUrl).then(function (d) {
      const v = Core.validateDimensions(d.w, d.h);
      if (!v.ok) { toast(v.reason, 'error'); close(); return; }
      src = d.src; natW = d.w; natH = d.h;
      bs = Core.baseScale(natW, natH, FRAME);
      if (storedCrop) {
        const r = Core.fromStored(storedCrop, natW, natH, FRAME);
        zoom = r.zoom; offX = r.offX; offY = r.offY;
      } else {
        zoom = 1;
        const ctr = Core.centredOffsets(natW, natH, FRAME, bs);
        offX = ctr.offX; offY = ctr.offY;
      }
      zoomEl.value = zoom;
      paint();
      frame.focus();
    }).catch(function (e) { toast(e.message, 'error'); close(); });

    zoomEl.oninput = function () {
      const oldDisp = bs * zoom;
      zoom = Core.clampZoom(parseFloat(zoomEl.value));
      const m = Core.zoomAboutCentre(offX, offY, FRAME, oldDisp, bs * zoom);
      offX = m.offX; offY = m.offY;
      paint();
    };

    /* Pointer events cover mouse, touch and stylus in one path.
       setPointerCapture keeps the drag alive past the frame edge. */
    let dragging = false, sx = 0, sy = 0;
    frame.addEventListener('pointerdown', function (e) {
      if (!src) return;
      dragging = true; sx = e.clientX - offX; sy = e.clientY - offY;
      frame.setPointerCapture(e.pointerId); frame.style.cursor = 'grabbing';
    });
    frame.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      offX = e.clientX - sx; offY = e.clientY - sy; paint();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      frame.addEventListener(ev, function () { dragging = false; frame.style.cursor = 'grab'; });
    });

    /* Keyboard nudge — the editor is reachable by tab, so it must be usable
       without a pointer. */
    frame.addEventListener('keydown', function (e) {
      const step = e.shiftKey ? 20 : 4;
      const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (!map[e.key]) return;
      e.preventDefault();
      offX += map[e.key][0]; offY += map[e.key][1]; paint();
    });

    function close() { scrim.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('click', function (e) { if (e.target === scrim) close(); });
    modal.querySelector('[data-a="cancel"]').onclick = close;

    modal.querySelector('[data-a="save"]').onclick = function () {
      if (!src) return;
      const disp = bs * zoom;
      const r = Core.cropRect(offX, offY, FRAME, disp);
      const out = document.createElement('canvas');
      out.width = out.height = output;
      const octx = out.getContext('2d');
      if (format === 'jpeg') {                 // JPEG has no alpha; fill first
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, output, output);
      }
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(src, r.sx, r.sy, r.size, r.size, 0, 0, output, output);
      const baked = format === 'png' ? out.toDataURL('image/png')
                                     : out.toDataURL('image/jpeg', 0.92);
      close();
      opts.onSave({
        baked: baked,
        original: dataUrl,
        crop: Core.toStored(offX, offY, natW, natH, FRAME, zoom)
      });
    };
  }

  /* ---------- the field: image surface + three controls ---------------- */
  function createField(cfg) {
    const shape  = cfg.shape || 'circle';
    const size   = cfg.size || 160;
    const radius = shape === 'circle' ? '50%' : (shape === 'rounded' ? '16px' : '8px');
    let value = cfg.value || null;

    const el = h('<div class="ie-field"></div>');
    const surface = h('<div class="ie-surface" tabindex="0" role="button"></div>');
    surface.style.width = size + 'px';
    surface.style.height = size + 'px';
    surface.style.borderRadius = radius;
    surface.setAttribute('aria-label', (cfg.label || 'Image') + ' — click to upload');

    const input = h('<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">');

    function fire(ev) { if (cfg.onChange) cfg.onChange(value, ev); }

    function pick() { input.value = ''; input.click(); }

    input.onchange = function () {
      const file = input.files && input.files[0];
      const v = Core.validateFile(file, cfg.maxBytes);
      if (!v.ok) { toast(v.reason, 'error'); return; }
      const reader = new FileReader();
      reader.onload = function () {
        openEditor({
          dataUrl: reader.result, crop: null,
          output: cfg.output, format: cfg.format,
          onSave: function (val) { value = val; paint(); toast((cfg.label || 'Image') + ' updated'); fire('upload'); }
        });
      };
      reader.onerror = function () { toast('That file could not be read', 'error'); };
      reader.readAsDataURL(file);
    };

    function paint() {
      surface.innerHTML = '';
      if (value && value.baked) {
        const im = h('<img class="ie-img" alt="' + (cfg.label || 'Image') + '">');
        im.src = value.baked;
        im.style.borderRadius = radius;
        surface.appendChild(im);

        const adjust = h('<button class="ie-btn ie-adjust" title="Adjust crop" aria-label="Adjust crop">' + icon('crop', 14) + '</button>');
        adjust.onclick = function (e) {
          e.stopPropagation();
          openEditor({
            dataUrl: value.original || value.baked,   // reopen the ORIGINAL
            crop: value.crop,
            output: cfg.output, format: cfg.format,
            onSave: function (val) { value = val; paint(); toast('Crop updated'); fire('adjust'); }
          });
        };
        surface.appendChild(adjust);

        const remove = h('<button class="ie-btn ie-remove" title="Remove image" aria-label="Remove image">' + icon('close', 14) + '</button>');
        remove.onclick = function (e) {
          e.stopPropagation();
          value = null; paint(); toast((cfg.label || 'Image') + ' removed'); fire('remove');
        };
        surface.appendChild(remove);
      } else {
        surface.appendChild(h('<div class="ie-empty">' +
          icon(cfg.emptyIcon || 'person', Math.round(size * 0.34)) + '</div>'));
      }

      const upload = h('<button class="ie-btn ie-upload" title="' +
        (value ? 'Replace image' : 'Upload image') + '" aria-label="' +
        (value ? 'Replace image' : 'Upload image') + '">' + icon('photo_camera', 15) + '</button>');
      upload.onclick = function (e) { e.stopPropagation(); pick(); };
      surface.appendChild(upload);
    }

    surface.onclick = function () { if (!value) pick(); };
    surface.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };

    paint();
    el.appendChild(surface);
    el.appendChild(input);

    return {
      el: el,
      getValue: function () { return value; },
      setValue: function (v) { value = v || null; paint(); },
      openPicker: pick
    };
  }

  return { createField: createField, openEditor: openEditor, FRAME: FRAME, Core: Core };
});
