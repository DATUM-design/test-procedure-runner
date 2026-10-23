/* App shell: procedure list, run engine (clock, steps, 10 Hz logging), run history and CSV export. */
(function (T) {
  const { $, el, fmtClock, fmtDist, store } = T;
  const S = T.sensors;
  const COLS = ['t_run_s', 'utc', 'step', 'step_name', 'phase', 'target', 'speed', 'speed_unit', 'lat', 'lon', 'gps_acc_m', 'long_g', 'decel_g', 'decel_src', 'dist_m', 'stop_n', 'marker'];

  const state = { procs: [], cycles: {}, custom: [] };
  let R = null; // active run context

  // ---------- screens ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
    if (id === 'home') renderHome();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => show('home')));

  // ---------- procedures ----------
  async function fetchJson(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); }
  function loadCustom() { try { state.custom = JSON.parse(localStorage.getItem('tpr.custom') || '[]'); } catch (e) { state.custom = []; } }
  function saveCustom() { try { localStorage.setItem('tpr.custom', JSON.stringify(state.custom)); } catch (e) { T.toast('Could not save the procedure on this device'); } }
  function validate(p) {
    const known = Object.keys(T.stepTypes);
    if (!p || !p.id || !p.name || !Array.isArray(p.steps) || !p.steps.length) throw new Error('A procedure needs id, name and a list of steps.');
    if (!T.units[p.units]) throw new Error('units must be "mph" or "kmh".');
    p.steps.forEach((s, i) => { if (!known.includes(s.type)) throw new Error('Step ' + (i + 1) + ' has unknown type "' + s.type + '". Use one of: ' + known.join(', ') + '.'); });
    return p;
  }
  async function loadCycles(procs) {
    const need = new Set();
    procs.forEach(p => p.steps.forEach(s => (s.segments || []).forEach(g => g.cycle && need.add(g.cycle))));
    await Promise.all([...need].filter(n => !state.cycles[n]).map(async n => { try { state.cycles[n] = await fetchJson('cycles/' + n + '.json'); } catch (e) { console.warn(e); } }));
  }
  async function loadProcedures() {
    const out = [];
    try {
      const idx = await fetchJson('procedures/index.json');
      for (const f of idx.procedures) { try { out.push(validate(await fetchJson('procedures/' + f))); } catch (e) { out.push({ broken: true, name: f, error: e.message }); } }
    } catch (e) { T.toast('Could not load the procedure list'); }
    loadCustom();
    state.procs = out;
    await loadCycles([...out.filter(p => !p.broken), ...state.custom]);
  }
  const allProcs = () => [...state.procs.map(p => ({ p, custom: false })), ...state.custom.map(p => ({ p, custom: true }))];
  function estimate(p) {
    const U = T.units[p.units];
    return p.steps.map(s => { try { return T.stepTypes[s.type].describe(s, U, { cycles: state.cycles }); } catch (e) { return s.type; } });
  }

  // ---------- home ----------
  async function renderHome() {
    pills($('homeSensors'));
    const list = $('procList'); list.innerHTML = '';
    const groups = [];
    for (const it of allProcs()) { const g = (it.p.group || 'General'); let e = groups.find(x => x.name === g); if (!e) groups.push(e = { name: g, items: [] }); e.items.push(it); }
    for (const grp of groups) {
    if (groups.length > 1 || grp.name !== 'General') list.append(el('h3', { class: 'lbl group', text: grp.name }));
    for (const { p, custom } of grp.items) {
      if (p.broken) { list.append(el('div', { class: 'card' }, el('div', { class: 't', text: p.name }), el('div', { class: 'd', text: 'Could not load: ' + p.error }))); continue; }
      const card = el('button', { class: 'card', type: 'button', onclick: () => startRun(p) },
        el('div', { class: 't', text: p.name + (custom ? '  ·  on this device' : '') }),
        p.description ? el('div', { class: 'd', text: p.description }) : null,
        el('div', { class: 'm', text: (p.steps.length > 1 ? p.steps.length + ' steps · ' : '') + estimate(p).join(' · ') }));
      list.append(card);
      if (custom) list.append(el('button', { class: 'ghost', type: 'button', style: 'justify-self:start', onclick: () => { state.custom = state.custom.filter(x => x.id !== p.id); saveCustom(); renderHome(); } }, 'Remove "' + p.name + '"'));
    }
    }
    const fileIn = el('input', { type: 'file', accept: '.json,application/json', id: 'procFile', hidden: true, onchange: async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const p = validate(JSON.parse(await f.text())); state.custom = state.custom.filter(x => x.id !== p.id); state.custom.push(p); saveCustom(); await loadCycles([p]); T.toast('Added ' + p.name); renderHome(); }
      catch (err) { T.toast('Not a valid procedure: ' + err.message, 5000); }
    } });
    list.append(el('button', { type: 'button', onclick: () => fileIn.click() }, 'Add procedure from a file'), fileIn);

    const runs = $('runList'); runs.innerHTML = '';
    let all = [];
    try { all = await store.listRuns(); } catch (e) {}
    if (!all.length) runs.append(el('div', { class: 'empty', text: 'No runs yet. Pick a procedure above to start one.' }));
    for (const r of all.slice(0, 30)) {
      const when = new Date(r.started);
      runs.append(el('button', { class: 'card run', type: 'button', onclick: () => openDetail(r.id) },
        el('div', null, el('div', { class: 't', text: r.procName + (r.notes?.vehicle ? ' · ' + r.notes.vehicle : '') }), el('div', { class: 'm', text: when.toLocaleDateString() + ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + fmtClock(((r.ended || r.updated || r.started) - r.started) / 1000) + ' · ' + r.source })),
        el('span', { class: 'pill ' + (r.status === 'complete' ? 'on' : r.status === 'interrupted' ? 'bad' : 'warn'), text: r.status.toUpperCase() })));
    }
  }

  function pills(box) {
    const s = S.summary(); box.innerHTML = '';
    box.append(el('span', { class: 'pill ' + s.gps[1], text: s.gps[0] }));
    if (s.motion) box.append(el('span', { class: 'pill ' + s.motion[1], text: s.motion[0] }));
  }

  // ---------- sensors screen ----------
  $('btnSensors').onclick = () => { $('selSrc').value = S.source; srcChanged(); show('sensors'); };
  function srcChanged() { $('baudRow').hidden = $('selSrc').value !== 'serial'; $('btnEnable').textContent = $('selSrc').value === 'serial' ? 'Connect GPS' : 'Enable sensors'; }
  $('selSrc').onchange = () => { S.setSource($('selSrc').value); srcChanged(); };
  $('btnEnable').onclick = async () => {
    T.unlockAudio();
    if (S.source === 'sim') { T.toast('Simulated sensors need no setup'); return; }
    if (S.source === 'serial') { try { await S.connectSerial(+$('selBaud').value); T.toast('GPS connected'); } catch (e) { T.toast(e.message || 'Could not open the GPS port', 5000); } return; }
    enableDevice();
  };
  function enableDevice() { S.startMotion(); S.startGps(); }
  $('btnZero').onclick = async () => {
    if (S.motion !== 'on') { T.toast('Enable sensors first; the accelerometer is not running'); return; }
    T.toast('Hold still…', 1600);
    const ok = await S.zero(); T.toast(ok ? 'Accelerometer zeroed. Forward direction is learned on the first accelerations and stops.' : 'Zero failed: no motion data');
  };
  function sensorFrame() {
    if ($('sensors').hidden) return;
    const v = S.currentSpeed();
    $('sSpeed').textContent = v == null ? '--' : (v * 3.6).toFixed(1);
    $('sAcc').textContent = S.longG != null ? S.longG.toFixed(2) : S.horizG != null ? '±' + S.horizG.toFixed(2) : '--';
    const rows = [
      ['Source', { device: 'Phone / tablet', sim: 'Simulated', serial: 'NMEA GPS' }[S.source]],
      ['GPS', S.gpsErr || (S.fresh() ? 'Fix, ' + S.gpsHz().toFixed(1) + ' Hz' : S.gpsOn || S.port ? 'Waiting for fix' : 'Off')],
      ['Speed', v == null ? '--' : (v * 3.6).toFixed(1) + ' km/h · ' + (v * 2.2369363).toFixed(1) + ' mph'],
      ['Accuracy', S.acc != null ? '± ' + Math.round(S.acc) + ' m' : '--'],
      ['Position', S.lat != null ? S.lat.toFixed(5) + ', ' + S.lon.toFixed(5) : '--'],
      ['Accelerometer', { on: 'Running ' + S.motionHz().toFixed(0) + ' Hz', waiting: 'Waiting', denied: 'Permission denied', unavailable: 'Not available', off: 'Off', sim: 'Simulated' }[S.motion] || S.motion],
      ['Zeroed', S.zeroed ? 'Yes' : 'No'],
      ['Forward axis', S.source === 'sim' ? 'n/a' : S.longG != null ? 'Learned' : 'Learning: accelerate and brake firmly a few times'],
      ['Secure page', window.isSecureContext ? 'Yes' : 'No: open the https address']
    ];
    const dl = $('sDetail'); dl.innerHTML = '';
    rows.forEach(([k, v]) => dl.append(el('dt', { text: k }), el('dd', { text: v })));
  }

  // ---------- run engine ----------
  async function startRun(p) {
    T.unlockAudio();
    if (S.source === 'device') enableDevice();
    p = JSON.parse(JSON.stringify(p));
    const U = T.units[p.units];
    let last = {}; try { last = JSON.parse(localStorage.getItem('tpr.lastNotes') || '{}'); } catch (e) {}
    const run = { id: T.uid(), procId: p.id, procName: p.name, units: p.units, proc: p, started: Date.now(), updated: Date.now(), status: 'active', step: 0, results: {}, events: [], source: S.source, device: navigator.userAgent,
      notes: { vehicle: last.vehicle || '', driver: last.driver || '', text: '' } };
    R = { run, p, U, idx: -1, h: null, running: false, stepStarted: false, t: 0, dist: 0, rows: [], seq: 0, lastFlush: performance.now(), lastTick: performance.now(), pendingMark: '', markN: 0 };
    try { await store.putRun(run); } catch (e) { T.toast('Storage unavailable: this run will not be saved', 5000); }
    show('run');
    $('rProc').textContent = p.name;
    enterStep(0); updateNotesBtn();
    T.holdWake();
  }
  const clock = () => R ? (Date.now() - R.run.started) / 1000 : 0;
  function event(type, data) { if (!R) return; R.run.events.push({ t: +clock().toFixed(2), step: R.idx, type, ...data }); }
  function enterStep(i) {
    const p = R.p, step = p.steps[i];
    R.idx = i; R.run.step = i; R.running = false; R.stepStarted = false; T.sensors.simWant = null;
    const stage = $('stage'); stage.innerHTML = ''; stage.className = 'stage';
    R.h = T.stepTypes[step.type].create(step, { U: R.U, cycles: state.cycles, event, clock });
    R.h.mount(stage);
    $('rStep').textContent = (i + 1) + '/' + p.steps.length + '  ' + (step.name || step.type);
    const bar = $('rSteps'); bar.innerHTML = '';
    p.steps.forEach((s, k) => bar.append(el('span', { class: k < i ? 'done' : k === i ? 'cur' : '', title: s.name || s.type })));
    event('step_start', { name: step.name || step.type });
    updatePrimary();
  }
  function finishStep() {
    const step = R.p.steps[R.idx];
    R.run.results[R.idx] = { name: step.name || step.type, type: step.type, ...(R.h.result ? R.h.result() : {}) };
    event('step_end', { name: step.name || step.type });
  }
  async function next() {
    finishStep();
    if (R.idx + 1 >= R.p.steps.length) { await endRun('complete'); return; }
    enterStep(R.idx + 1); persist();
  }
  function updatePrimary() {
    const b = $('btnPrimary'), h = R.h, last = R.idx + 1 >= R.p.steps.length;
    b.disabled = false;
    if (!h.timed) { b.textContent = last ? 'Finish' : 'Continue'; b.disabled = !h.done; }
    else if (h.done) b.textContent = last ? 'Finish' : 'Next step';
    else b.textContent = R.running ? 'Pause' : R.stepStarted ? 'Resume' : 'Start';
    $('btnMark').disabled = false;
  }
  $('btnPrimary').onclick = () => {
    if (!R) return; T.unlockAudio(); const h = R.h;
    if (!h.timed || h.done) { next(); return; }
    R.running = !R.running;
    if (R.running) { R.stepStarted = true; event('start'); T.holdWake(); } else { event('pause'); T.toast('Paused. The step clock is stopped.'); }
    updatePrimary();
  };
  $('btnMark').onclick = () => { $('runMenu').hidden = true; if (!R) return; R.markN++; R.pendingMark = 'M' + R.markN; event('marker', { n: R.markN }); T.beep(600, 80); T.toast('Marker ' + R.markN); };
  // Notes: vehicle ID, driver and free text, editable any time without pausing.
  $('btnNotes').onclick = () => {
    if (!R) return; const n = R.run.notes;
    $('nVehicle').value = n.vehicle; $('nDriver').value = n.driver; $('nText').value = n.text;
    $('runMenu').hidden = true; $('notesSheet').hidden = false;
  };
  $('btnNotesDone').onclick = () => {
    $('notesSheet').hidden = true; if (!R) return;
    R.run.notes = { vehicle: $('nVehicle').value.trim(), driver: $('nDriver').value.trim(), text: $('nText').value.trim() };
    try { localStorage.setItem('tpr.lastNotes', JSON.stringify({ vehicle: R.run.notes.vehicle, driver: R.run.notes.driver })); } catch (e) {}
    updateNotesBtn(); persist(); T.toast('Notes saved');
  };
  function updateNotesBtn() { const n = R && R.run.notes; $('btnNotes').textContent = n && n.vehicle ? n.vehicle : 'Notes'; }
  $('btnMenu').onclick = () => { const m = $('runMenu'); m.hidden = !m.hidden; $('btnMenu').setAttribute('aria-expanded', String(!m.hidden)); };
  $('btnCloseMenu').onclick = () => { $('runMenu').hidden = true; };
  $('btnSkip').onclick = () => { $('runMenu').hidden = true; if (!R) return; event('skip'); next(); };
  $('btnBack').onclick = () => { $('runMenu').hidden = true; if (R && R.idx > 0) { event('back'); enterStep(R.idx - 1); } };
  let endArm = 0, endTimer = 0;
  $('btnEnd').onclick = () => {
    if (!R) return;
    if (Date.now() - endArm > 3000) { endArm = Date.now(); $('btnEnd').textContent = 'Tap to confirm'; clearTimeout(endTimer); endTimer = setTimeout(() => { $('btnEnd').textContent = 'End test'; }, 3000); return; }
    endArm = 0; $('btnEnd').textContent = 'End test'; $('runMenu').hidden = true; $('notesSheet').hidden = true;
    finishStep(); endRun(R.h.done && R.idx + 1 >= R.p.steps.length ? 'complete' : 'ended');
  };

  async function persist(ctx = R) {
    if (!ctx) return;
    ctx.run.updated = Date.now();
    const rows = ctx.rows; ctx.rows = [];
    try { if (rows.length) await store.putChunk(ctx.run.id, ctx.seq++, rows); await store.putRun(ctx.run); } catch (e) {}
  }
  async function endRun(status) {
    const ctx = R;
    ctx.running = false; ctx.run.status = status; ctx.run.ended = Date.now();
    event('end', { status });
    R = null; T.releaseWake(); T.sensors.simWant = null;
    await persist(ctx);
    openDetail(ctx.run.id);
  }

  // 10 Hz logic and logging
  setInterval(() => {
    const now = performance.now();
    const dt = R ? Math.min(0.5, (now - R.lastTick) / 1000) : 0.1;
    if (S.source === 'sim') S.simWant = R && R.h && R.running && R.h.simWant ? R.h.simWant() : { v: 0, accel: 2, decel: 3 };
    S.tick(dt);
    if (!R || !R.h) return;
    R.lastTick = now;
    const v = S.currentSpeed();
    if (v != null) R.dist += v * dt;
    const ctx = { speed: v, U: R.U };
    const h = R.h;
    if (h.timed && R.running && !h.done) {
      h.tick(dt, ctx);
      if (h.done) { R.running = false; T.beep(1320, 200); setTimeout(() => T.beep(1320, 200), 260); event('step_complete'); T.toast('Step complete'); updatePrimary(); persist(); }
    }
    const lg = h.log ? h.log() : {};
    const dg = S.decelG();
    R.rows.push([
      +clock().toFixed(2), new Date().toISOString(), R.idx + 1, R.p.steps[R.idx].name || R.p.steps[R.idx].type, lg.phase || (R.running ? 'running' : 'waiting'),
      lg.target ?? '', v == null ? '' : +R.U.fromMs(v).toFixed(2), R.U.label,
      S.lat != null ? +S.lat.toFixed(6) : '', S.lon != null ? +S.lon.toFixed(6) : '', S.acc != null ? Math.round(S.acc) : '',
      S.longG != null ? +S.longG.toFixed(3) : '', dg != null ? +dg.toFixed(3) : '', S.decelSource(), Math.round(R.dist), lg.n ?? '', R.pendingMark
    ]);
    R.pendingMark = '';
    if (now - R.lastFlush > 10000) { R.lastFlush = now; persist(); }
  }, 100);

  // Screen refresh
  function frame() {
    if (R && R.h && !$('run').hidden) {
      const ctx = { speed: S.currentSpeed(), U: R.U };
      R.h.running = R.running;
      $('stage').classList.toggle('is-running', R.running);
      if (R.h.frame) R.h.frame(ctx);
      $('rClock').textContent = fmtClock(clock());
      pills($('rPills'));
      if (!R.h.timed) { const want = !R.h.done; if ($('btnPrimary').disabled !== want) $('btnPrimary').disabled = want; }
    }
    sensorFrame();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R) T.holdWake(); if (document.visibilityState === 'hidden' && R) persist(); });
  window.addEventListener('pagehide', () => { if (R) persist(); });
  document.addEventListener('keydown', e => {
    if (!R || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); $('btnPrimary').click(); } else if (e.key === 'm' || e.key === 'M') $('btnMark').click();
  });

  // ---------- run detail + export ----------
  async function openDetail(id) {
    const r = await store.getRun(id); if (!r) { show('home'); return; }
    show('detail');
    $('dTitle').textContent = r.procName;
    const body = $('dBody'); body.innerHTML = '';
    const when = new Date(r.started);
    const kv = el('dl', { class: 'kv' });
    [['Started', when.toLocaleString()], ['Duration', fmtClock(((r.ended || r.updated) - r.started) / 1000)], ['Status', r.status], ['Speed source', r.source], ['Steps done', Object.keys(r.results).length + ' of ' + r.proc.steps.length]]
      .forEach(([k, v]) => kv.append(el('dt', { text: k }), el('dd', { text: v })));
    const n = r.notes || {};
    if (n.vehicle) kv.prepend(el('dt', { text: 'Vehicle' }), el('dd', { text: n.vehicle }));
    if (n.driver) kv.append(el('dt', { text: 'Driver' }), el('dd', { text: n.driver }));
    body.append(el('div', { class: 'panel' }, kv));
    if (n.text) body.append(el('div', { class: 'panel' }, el('div', { class: 'lbl', text: 'Notes' }), el('div', { text: n.text, style: 'white-space:pre-wrap' })));
    for (const [i, res] of Object.entries(r.results)) {
      const p = el('div', { class: 'panel' }, el('div', { class: 'lbl', text: 'Step ' + (+i + 1) + ' · ' + res.name }));
      if (res.values) res.values.forEach(v => p.append(el('div', { class: 'm', text: v.label + ': ' + (v.value || '–') + (v.value && v.unit ? ' ' + v.unit : '') })));
      else if (res.stops) p.append(el('div', { class: 'm', text: res.counted + (res.counted === 1 ? ' stop' : ' stops') + ' counted · ' + res.in_band + ' in band · ' + res.low + ' low · ' + res.high + ' high · ' + res.manual + ' manual · ' + res.not_counted + ' not counted' }));
      else if (res.checked) p.append(el('div', { class: 'm', text: res.checked.length + ' checks ticked' }));
      else p.append(el('div', { class: 'm', text: Object.entries(res).filter(([k]) => !['name', 'type'].includes(k)).map(([k, v]) => k.replace(/_/g, ' ') + ': ' + v).join(' · ') }));
      body.append(p);
    }
    const del = el('button', { class: 'danger', type: 'button', onclick: async e => {
      if (e.target.dataset.arm !== '1') { e.target.dataset.arm = '1'; e.target.textContent = 'Tap again to delete'; return; }
      await store.deleteRun(id); T.toast('Run deleted'); show('home');
    } }, 'Delete run');
    body.append(el('div', { class: 'btnrow' }, el('button', { class: 'primary', type: 'button', onclick: () => exportRun(id) }, 'Export CSV'), del));
    body.append(el('p', { class: 'fine', text: 'Export gives two files: the 10 Hz log, and a summary with recorded values, step results, every stop and all markers.' }));
  }

  async function exportRun(id) {
    const r = await store.getRun(id), rows = await store.samples(id);
    const base = r.procId + '_' + new Date(r.started).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const logCsv = T.csv([COLS, ...rows]);
    const sum = [['procedure', r.procName], ['started_utc', new Date(r.started).toISOString()], ['ended_utc', r.ended ? new Date(r.ended).toISOString() : ''], ['status', r.status], ['speed_source', r.source], ['units', r.units], ['device', r.device],
      ['vehicle', r.notes?.vehicle || ''], ['driver', r.notes?.driver || ''], ['notes', r.notes?.text || ''], []];
    for (const [i, res] of Object.entries(r.results)) {
      sum.push(['step ' + (+i + 1), res.name, res.type]);
      if (res.values) res.values.forEach(v => sum.push(['', v.label, v.value, v.unit]));
      else if (res.stops) {
        sum.push(['', 'counted', res.counted, 'in_band', res.in_band, 'low', res.low, 'high', res.high, 'manual', res.manual, 'not_counted', res.not_counted]);
        sum.push(['', 'stop_n', 'from', 'to', 'duration_s', 'mean_g_accel', 'mean_g_gps', 'peak_g', 'decel_src', 'result', 'note', 't_run_s']);
        res.stops.forEach(s => sum.push(['', s.n ?? '', s.v0?.toFixed(1) ?? '', s.v1?.toFixed(1) ?? '', s.dur?.toFixed(2) ?? '', s.accG?.toFixed(3) ?? '', s.gpsG?.toFixed(3) ?? '', s.peakG?.toFixed(3) ?? '', s.src ?? '', s.grade, s.reason || '', s.at?.toFixed(1) ?? '']));
      } else if (res.checked) res.checked.forEach(c => sum.push(['', 'checked', c]));
      else Object.entries(res).forEach(([k, v]) => { if (!['name', 'type'].includes(k)) sum.push(['', k, v]); });
    }
    sum.push([], ['events'], ['t_run_s', 'step', 'type', 'detail']);
    r.events.forEach(e => { const { t, step, type, ...rest } = e; sum.push([t, step + 1, type, Object.keys(rest).length ? JSON.stringify(rest) : '']); });
    const files = [new File([logCsv], base + '_log.csv', { type: 'text/csv' }), new File([T.csv(sum)], base + '_summary.csv', { type: 'text/csv' })];
    try {
      if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title: r.procName }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    files.forEach(f => { const a = el('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove(); });
    T.toast('Saved ' + files.length + ' files');
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const all = await store.listRuns();
      for (const r of all) if (r.status === 'active') { r.status = 'interrupted'; await store.putRun(r); }
    } catch (e) {}
    await loadProcedures();
    show('home');
    requestAnimationFrame(frame);
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!S.serialSupported) { const o = $('selSrc').querySelector('option[value=serial]'); if (o) o.remove(); if (S.source === 'serial') S.setSource('device'); }
    if (S.source === 'sim') S.setSource('sim');
  }
  T.app = { state, get run() { return R; } };
  boot();
})(window.TPR);
