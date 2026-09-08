/* ==========================================================================
   EasyWayPro — Filter Panel, reference implementation
   Source of truth: ent-drv-cab-01-documents-mockup-25.html (accepted version)

   HOW TO USE THIS FILE:
   This is NOT a plug-and-play <script src> include — copy the relevant
   functions below into your mockup and adjust FILTER_FIELD_META for your
   feature's actual fields. It depends on things every mockup defines
   differently (state shape, modalShell(), openModal(), el(), iconHTML(),
   safeSortable()), so a blind include would break on name collisions.

   What you MUST provide in your own mockup for this to work:
     - state.filters                 (object holding current filter values)
     - state.filterCustomizeMode     (boolean)
     - el(htmlString)                (helper: string -> DOM node)
     - iconHTML(name, size, style)   (helper: Material Symbol -> HTML string)
     - modalShell(title)             (your modal wrapper, returns {modal,...})
     - openModal(name)               (your re-render-and-show-modal function)
     - safeSortable(el, opts)        (SortableJS wrapper, forceFallback:true)
     - filterValueCount(key)         (counts active values for a multiselect key)
     - clearAllFilters()             (resets state.filters to defaults)

   Field types supported out of the box: 'multiselect' | 'toggle' | 'daterange' | 'expirationRange'
   ========================================================================== */

// ---- Date helpers (pure, no dependencies — safe to copy as-is) ----
function isoDate(d){ return d.toISOString().slice(0,10); }
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function addMonths(d, n){ const r = new Date(d); r.setMonth(r.getMonth()+n); return r; }
function sameDay(a, b){ return a && b && isoDate(a)===isoDate(b); }
function endOfWeek(d){ const r = new Date(d); const day = r.getDay(); const add = day===0 ? 0 : 7-day; r.setDate(r.getDate()+add); return r; }

// ---- EXAMPLE field config — replace with your feature's real fields ----
// This exact shape (label + type + options) is what renderFilterField() reads.
const FILTER_FIELD_META_EXAMPLE = {
  fileType: {label:'File Type', type:'multiselect', options:[['PDF','PDF'],['DOC','DOC'],['XLS','XLS'],['JPG','JPG']]},
  status: {label:'Status', type:'multiselect', options:[['missing','Not Uploaded'],['on_file','On File'],['valid','Valid'],['soon','Expiring Soon'],['expired','Expired']]},
  requiresSign: {label:'Requires Fill & Sign', type:'toggle'},
  expirationRange: {label:'Expiration Date', type:'expirationRange'}, // renders 4 quick presets + a date range
  uploadDate: {label:'Upload Date', type:'daterange'}, // plain range, no presets
  expiringOnly: {label:'Only show expiring soon or expired', type:'toggle'}, // pinned field, see modalFilters()
};
// Which fields show in Quick Filters vs collapsed More Filters, and in what order.
// This array is what Customize-mode drag & drop reorders.
let filterFieldOrder_EXAMPLE = { quick:['fileType','status','expirationRange'], more:['requiresSign','uploadDate'] };

// ---- Renders ONE filter field, dispatching on its type ----
function renderFilterField(container, key, draggable, FILTER_FIELD_META){
  const meta = FILTER_FIELD_META[key];
  const f = state.filters;
  const wrap = document.createElement('div');
  wrap.className = draggable ? 'filter-field-row' : '';
  if(draggable) wrap.appendChild(el(`<span class="drag-handle">${iconHTML('drag_indicator',16)}</span>`));
  const field = document.createElement('div'); field.className = 'filter-field';

  if(meta.type === 'toggle'){
    const row = el(`<div class="filter-toggle-row"><label>${meta.label}</label><div class="switch ${f[key]?'on':''}"><div class="knob"></div></div></div>`);
    row.querySelector('.switch').onclick = ()=>{ f[key] = !f[key]; openModal('filters'); };
    field.appendChild(row);

  } else if(meta.type === 'expirationRange'){
    // Quick-preset date range: 4 chips (This week / Next week / Next month / Next 3 months)
    // ABOVE a manual from-to date range. Chip becomes "active" when it matches current range.
    field.appendChild(el(`<label>${meta.label}</label>`));
    const presetRow = el('<div class="preset-row"></div>');
    const TODAY = new Date(); // use your mockup's fixed TODAY constant if you have one, for reproducible demos
    const presets = [
      {label:'This week', to: endOfWeek(TODAY)},
      {label:'Next week', to: addDays(TODAY,7)},
      {label:'Next month', to: addMonths(TODAY,1)},
      {label:'Next 3 months', to: addMonths(TODAY,3)},
    ];
    presets.forEach(p=>{
      const active = sameDay(f.expFrom, TODAY) && sameDay(f.expTo, p.to);
      const btn = el(`<button type="button" class="preset-chip${active?' active':''}">${p.label}</button>`);
      btn.onclick = ()=>{ f.expFrom = TODAY; f.expTo = p.to; openModal('filters'); };
      presetRow.appendChild(btn);
    });
    field.appendChild(presetRow);
    const row = el(`<div class="filter-range"><input type="date" value="${f.expFrom?isoDate(f.expFrom):''}"/><span style="color:var(--text400)">–</span><input type="date" value="${f.expTo?isoDate(f.expTo):''}"/></div>`);
    const [fromI, toI] = row.querySelectorAll('input');
    fromI.onchange = (e)=>{ f.expFrom = e.target.value ? new Date(e.target.value) : null; openModal('filters'); };
    toI.onchange = (e)=>{ f.expTo = e.target.value ? new Date(e.target.value) : null; openModal('filters'); };
    field.appendChild(row);

  } else if(meta.type === 'daterange'){
    // Plain from-to range, no quick presets — use this for dates without a natural "upcoming" framing
    field.appendChild(el(`<label>${meta.label}</label>`));
    const row = el(`<div class="filter-range"><input type="date" value="${f.uploadFrom||''}"/><span style="color:var(--text400)">–</span><input type="date" value="${f.uploadTo||''}"/></div>`);
    const [fromI, toI] = row.querySelectorAll('input');
    fromI.onchange = (e)=>{ f.uploadFrom = e.target.value || null; };
    toI.onchange = (e)=>{ f.uploadTo = e.target.value || null; };
    field.appendChild(row);

  } else { // multiselect
    field.appendChild(el(`<label>${meta.label}</label>`));
    const count = filterValueCount(key);
    const box = el(`<div class="filter-input-box"><span class="${count?'':'ph'}">${count? count+' selected' : 'All'}</span>${iconHTML('expand_more',16,'color:var(--text400)')}</div>`);
    const list = document.createElement('div'); list.className='filter-checklist'; list.style.display='none';
    meta.options.forEach(([val,lbl])=>{
      const optLabel = el(`<label><input type="checkbox" ${f[key].has(val)?'checked':''}/> ${lbl}</label>`);
      optLabel.querySelector('input').onchange = (e)=>{
        if(e.target.checked) f[key].add(val); else f[key].delete(val);
        openModal('filters');
      };
      list.appendChild(optLabel);
    });
    box.onclick = ()=>{ list.style.display = list.style.display==='none' ? 'block' : 'none'; };
    field.appendChild(box); field.appendChild(list);
  }
  wrap.appendChild(field);
  container.appendChild(wrap);
  return wrap;
}

// ---- Renders the whole panel: header, pinned toggle, Quick/More sections, drag & drop in Customize mode ----
function modalFilters(FILTER_FIELD_META, filterFieldOrder, pinnedToggleKey){
  const customizing = state.filterCustomizeMode;
  const wrap = modalShell('');
  const modal = wrap.querySelector('.modal');
  modal.classList.add('filter-panel');
  if(customizing) modal.classList.add('customize-mode');

  const header = el(`<div class="filter-header"><h2>Filters</h2></div>`);
  const clearBtn = el('<button class="btn">Clear all</button>');
  clearBtn.onclick = ()=>{ clearAllFilters(); openModal('filters'); };
  const customizeBtn = el(`<button class="btn ${customizing?'primary':''}">${customizing?'Done':'Customize'}</button>`);
  customizeBtn.onclick = ()=>{ state.filterCustomizeMode = !state.filterCustomizeMode; openModal('filters'); };
  header.appendChild(clearBtn); header.appendChild(customizeBtn);
  modal.appendChild(header);

  const quickWrap = el('<div id="quickWrap"></div>');
  const pinnedWrap = el('<div id="pinnedWrap"></div>');
  const moreSection = el('<div id="moreSection" style="display:none;"><div class="filter-divider"></div><div id="moreWrap"></div></div>');
  modal.appendChild(quickWrap); modal.appendChild(pinnedWrap); modal.appendChild(moreSection);
  const moreWrap = moreSection.querySelector('#moreWrap');

  // Pinned field (e.g. "Only show expiring soon or expired") — fixed, NEVER draggable.
  // Rule: any toggle with its own nested onclick conflicts with the drag engine if made draggable.
  if(pinnedToggleKey) renderFilterField(pinnedWrap, pinnedToggleKey, false, FILTER_FIELD_META);

  if(customizing){
    moreSection.style.display = 'block';
    quickWrap.appendChild(el('<div class="filter-section-label">QUICK FILTERS</div>'));
    moreSection.querySelector('.filter-divider').before(el('<div class="filter-section-label" style="margin-top:0">MORE FILTERS</div>'));
    filterFieldOrder.quick.forEach(key=> renderFilterField(quickWrap, key, true, FILTER_FIELD_META));
    filterFieldOrder.more.forEach(key=> renderFilterField(moreWrap, key, true, FILTER_FIELD_META));
    quickWrap.dataset.filterList = 'quick';
    moreWrap.dataset.filterList = 'more';
    const onMoved = (evt)=>{
      try{
        const fromList = evt.from.dataset.filterList, toList = evt.to.dataset.filterList;
        const [moved] = filterFieldOrder[fromList].splice(evt.oldIndex, 1);
        filterFieldOrder[toList].splice(evt.newIndex, 0, moved);
        openModal('filters');
      }catch(err){ console.error('Reorder failed:', err); openModal('filters'); }
    };
    safeSortable(quickWrap, { group:'docFilterFields', onEnd:onMoved });
    safeSortable(moreWrap, { group:'docFilterFields', onEnd:onMoved });
  } else {
    filterFieldOrder.quick.forEach(key=> renderFilterField(quickWrap, key, false, FILTER_FIELD_META));
    // "More filters" link/expand toggle for non-customize mode goes here in your mockup —
    // see the accepted Documents mockup for the exact collapsed/expanded link markup.
  }

  return wrap;
}
