/* Step types. Each type turns a block of procedure JSON into a live screen.
   Instance contract:
     mount(stage)      build the step's DOM inside the stage element
     timed             true if the step needs the run clock (Start / Pause)
     tick(dt, ctx)     10 Hz logic while the clock is running
     frame(ctx)        UI refresh every animation frame
     done              true once the step's goal is met
     simWant(ctx)      what the simulated driver should do
     log()             { target, phase, n } added to each 10 Hz sample row
     result()          summary stored with the run
*/
(function (T) {
  const { el, fmtClock, fmtDist, lerp, G } = T;
  const types = T.stepTypes = {};

  // ---------- checklist ----------
  types.checklist = {
    describe: s => s.items.length + ' checks',
    create(step) {
      const checked = step.items.map(() => false);
      return {
        timed: false,
        get done() { return checked.every(Boolean); },
        mount(stage) {
          if (step.note) stage.append(el('p', { class: 'note', text: step.note }));
          step.items.forEach((it, i) => {
            const id = 'chk' + i;
            const box = el('input', { type: 'checkbox', id, onchange: e => { checked[i] = e.target.checked; } });
            stage.append(el('label', { class: 'check', for: id }, box, it));
          });
        },
        result: () => ({ checked: step.items.filter((_, i) => checked[i]) })
      };
    }
  };

  // ---------- record values ----------
  types.record = {
    describe: s => s.fields.length + ' values',
    create(step) {
      const vals = {};
      return {
        timed: false, done: true,
        mount(stage) {
          if (step.note) stage.append(el('p', { class: 'note', text: step.note }));
          step.fields.forEach(f => {
            const id = 'fld_' + f.key;
            const inp = f.type === 'text'
              ? el('textarea', { id, oninput: e => { vals[f.key] = e.target.value; } })
              : el('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', oninput: e => { vals[f.key] = e.target.value; } });
            stage.append(el('label', { class: 'field', for: id }, el('span', { text: f.label + (f.unit ? ' (' + f.unit + ')' : '') }), inp));
          });
        },
        result: () => ({ values: step.fields.map(f => ({ key: f.key, label: f.label, unit: f.unit || '', value: vals[f.key] || '' })) })
      };
    }
  };

  // ---------- timer / soak ----------
  types.timer = {
    describe: s => fmtClock(s.duration),
    create(step) {
      let t = 0, ui = {};
      return {
        timed: true,
        get done() { return t >= step.duration; },
        mount(stage) {
          if (step.note) stage.append(el('p', { class: 'note', text: step.note }));
          ui.time = el('div', { class: 'bigtime', text: fmtClock(step.duration) });
          ui.bar = el('div');
          stage.append(ui.time, el('div', { class: 'progress' }, ui.bar));
        },
        tick(dt) { t = Math.min(step.duration, t + dt); },
        frame() { ui.time.textContent = fmtClock(step.duration - t); ui.bar.style.width = (100 * t / step.duration) + '%'; },
        simWant: () => ({ v: 0, accel: 2, decel: 3 }),
        log: () => ({ target: '', phase: 'timer' }),
        result: () => ({ elapsed_s: Math.round(t) })
      };
    }
  };

  // ---------- hold a speed for a time or distance ----------
  types.hold = {
    describe: (s, U) => s.speed + ' ' + U.label + ' for ' + (s.distance ? fmtDist(s.distance) : fmtClock(s.duration)),
    create(step, P) {
      const U = P.U, tgt = U.toMs(step.speed), tol = U.toMs(step.tolerance ?? 5);
      let t = 0, d = 0, inBand = 0, measured = 0, ui = {};
      const goal = step.distance ? step.distance : step.duration;
      const prog = () => step.distance ? d : t;
      return {
        timed: true,
        get done() { return prog() >= goal; },
        mount(stage) {
          if (step.note) stage.append(el('p', { class: 'note', text: step.note }));
          ui.left = el('div', { class: 'bigtime' });
          ui.bar = el('div');
          ui.tgt = el('span', { class: 'big', text: step.speed });
          ui.act = el('span', { class: 'big', text: '--' });
          ui.sub = el('span', { class: 'sub' });
          ui.abox = el('div', { class: 'read actual state' }, el('span', { class: 'lbl', text: 'Actual' }), ui.act, el('span', { class: 'unit', text: U.label }), ui.sub);
          stage.append(
            el('div', { class: 'grid2' }, el('div', { class: 'read target' }, el('span', { class: 'lbl', text: 'Hold' }), ui.tgt, el('span', { class: 'unit', text: U.label }), el('span', { class: 'sub', text: '± ' + (step.tolerance ?? 5) + ' ' + U.label })), ui.abox),
            ui.left, el('div', { class: 'progress' }, ui.bar));
        },
        tick(dt, ctx) {
          if (ctx.speed == null) return;
          t += dt; d += ctx.speed * dt; measured += dt;
          if (Math.abs(ctx.speed - tgt) <= tol) inBand += dt;
        },
        frame(ctx) {
          const v = ctx.speed;
          ui.act.textContent = v == null ? '--' : U.fromMs(v).toFixed(0);
          const st = v == null ? '' : Math.abs(v - tgt) <= tol * 0.7 ? 'ok' : Math.abs(v - tgt) <= tol ? 'near' : 'out';
          ui.abox.className = 'read actual state ' + st;
          ui.sub.textContent = v == null ? 'No speed' : st === 'out' ? (v > tgt ? 'Too fast' : 'Too slow') : 'In band';
          ui.left.textContent = step.distance ? fmtDist(Math.max(0, goal - d)) : fmtClock(goal - t);
          ui.bar.style.width = Math.min(100, 100 * prog() / goal) + '%';
        },
        simWant: () => ({ v: tgt, accel: 1.8, decel: 1.5 }),
        log: () => ({ target: step.speed, phase: 'hold' }),
        result: () => ({ elapsed_s: Math.round(t), distance_m: Math.round(d), in_band_pct: measured ? Math.round(100 * inBand / measured) : null })
      };
    }
  };

  // ---------- follow a speed trace ----------
  types.trace = {
    describe: (s, U, P) => { const pr = buildTrace(s, P.cycles, U); return fmtClock(pr.T) + ' trace'; },
    create(step, P) {
      const U = P.U, pr = buildTrace(step, P.cycles, U);
      let t = 0, outSince = null, brief = 0, viol = 0, outTotal = 0, beeped = new Set(), hist = [], ui = {};
      const band = (tt, v) => {
        if (v == null) return { err: null, state: '' };
        const up = lerp(pr.up, tt), lo = lerp(pr.lo, tt);
        const err = v > up ? v - up : v < lo ? v - lo : 0;
        const margin = Math.min(up - v, lo > 0 ? v - lo : Infinity);
        return { err, state: err !== 0 ? 'out' : margin < 0.3 ? 'near' : 'ok' };
      };
      const segAt = tt => { let s = pr.meta[0]; for (const m of pr.meta) if (tt >= m.start) s = m; return s; };
      const show = ms => U.fromMs(ms).toFixed(0);
      function cue(tt) {
        const now = lerp(pr.v, tt);
        if (now < 0.15) {
          for (let d = 0; d <= 15; d += 0.25) if (lerp(pr.v, tt + d) > 0.25) {
            const s = Math.ceil(d), key = Math.floor(tt + d) + ':' + s;
            if (s >= 1 && s <= 3 && !beeped.has(key)) { beeped.add(key); T.beep(s === 1 ? 1320 : 880); }
            let mx = 0; for (let k = 0; k <= 12; k++) mx = Math.max(mx, lerp(pr.v, tt + d + k));
            return { cls: 'go', what: d < 0.6 ? 'GO' : 'Pull away in ' + s + ' s', sub: 'Then to ' + show(mx) + ' ' + U.label + ' over the next 12 s.' };
          }
          return { cls: '', what: 'Idle', sub: 'Engine running. Pull away only when cued.' };
        }
        for (let d = 0.25; d <= 10; d += 0.25) if (lerp(pr.v, tt + d) < 0.15) return { cls: 'stop', what: 'Stop in ' + Math.ceil(d) + ' s', sub: 'Brake smoothly to rest.' };
        const f5 = lerp(pr.v, tt + 5), dv = U.fromMs(f5) - U.fromMs(now);
        return { cls: '', what: (dv > 1.5 ? 'Accelerate to ' : dv < -1.5 ? 'Ease back to ' : 'Hold about ') + show(f5) + ' ' + U.label, sub: 'Target in 5 s.' };
      }
      function size() {
        const c = ui.cv; if (!c) return; const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); ui.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      function draw(tt, actual) {
        const c = ui.cv, ctx = ui.ctx, W = c.clientWidth, H = c.clientHeight; if (!W || !H) return;
        ctx.clearRect(0, 0, W, H);
        const past = 20, fut = 40, x0 = 36, x1 = W - 8, y0 = H - 20, y1 = 10;
        const vmaxU = U.label === 'mph' ? 60 : 100, step10 = U.label === 'mph' ? 10 : 20;
        const tx = s => x0 + (s - (tt - past)) / (past + fut) * (x1 - x0);
        const vy = ms => y0 - U.fromMs(ms) / vmaxU * (y0 - y1);
        const cLine = T.css('--line'), cMuted = T.css('--muted');
        ctx.font = '11px ' + T.css('--mono'); ctx.fillStyle = cMuted; ctx.strokeStyle = cLine; ctx.lineWidth = 1;
        for (let s = 0; s <= vmaxU; s += step10) { const y = y0 - s / vmaxU * (y0 - y1); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText(String(s), 4, y + 4); }
        for (let s = Math.ceil((tt - past) / 10) * 10; s <= tt + fut; s += 10) { if (s < 0 || s > pr.T) continue; const x = tx(s); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + 4); ctx.stroke(); if (s % 30 === 0) ctx.fillText(fmtClock(s), x - 15, H - 5); }
        pr.meta.forEach(m => { if (m.start > tt - past && m.start < tt + fut) { const x = tx(m.start); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y0); ctx.stroke(); ctx.setLineDash([]); ctx.fillText(m.name, x + 4, y1 + 12); } });
        const a = Math.max(0, Math.floor(tt - past)), b = Math.min(pr.T, Math.ceil(tt + fut));
        ctx.beginPath(); for (let s = a; s <= b; s++) ctx.lineTo(tx(s), vy(pr.up[s])); for (let s = b; s >= a; s--) ctx.lineTo(tx(s), vy(pr.lo[s])); ctx.closePath(); ctx.fillStyle = T.css('--band'); ctx.fill();
        ctx.beginPath(); for (let s = a; s <= b; s++) ctx.lineTo(tx(s), vy(pr.v[s])); ctx.strokeStyle = T.css('--target'); ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
        if (hist.length > 1) { ctx.beginPath(); let st = false; for (const h of hist) { if (h[0] < tt - past) continue; const x = tx(h[0]), y = vy(h[1]); st ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), st = true); } ctx.strokeStyle = T.css('--actual'); ctx.lineWidth = 2.5; ctx.stroke(); }
        const xn = tx(tt); ctx.strokeStyle = cMuted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xn, y1); ctx.lineTo(xn, y0); ctx.stroke();
        ctx.fillStyle = T.css('--target'); ctx.beginPath(); ctx.arc(xn, vy(lerp(pr.v, tt)), 6, 0, 7); ctx.fill();
        if (actual != null) { ctx.fillStyle = T.css('--actual'); ctx.beginPath(); ctx.arc(xn, vy(actual), 5, 0, 7); ctx.fill(); }
      }
      return {
        timed: true,
        get done() { return t >= pr.T; },
        mount(stage) {
          stage.classList.add('split');
          ui.cv = el('canvas', { 'aria-label': 'Target speed trace with tolerance band' }); ui.ctx = ui.cv.getContext('2d');
          ui.seg = el('span'); ui.left = el('span');
          const main = el('div', { style: 'display:flex;flex-direction:column;gap:6px;min-height:0;flex:1' }, el('div', { class: 'seginfo' }, ui.seg, ui.left), el('div', { class: 'trace' }, ui.cv));
          ui.tgt = el('span', { class: 'big', text: '0' });
          ui.act = el('span', { class: 'big', text: '--' }); ui.err = el('span', { class: 'sub' });
          ui.abox = el('div', { class: 'read actual state' }, el('span', { class: 'lbl', text: 'Actual' }), ui.act, el('span', { class: 'unit', text: U.label }), ui.err);
          ui.what = el('span', { class: 'what', text: 'Idle' }); ui.sub = el('span', { class: 'sub' }); ui.stats = el('span', { class: 'sub' });
          const side = el('div', { class: 'side' },
            el('div', { class: 'read target' }, el('span', { class: 'lbl', text: 'Target' }), ui.tgt, el('span', { class: 'unit', text: U.label })),
            ui.abox,
            el('div', { class: 'cue' }, el('span', { class: 'lbl', text: 'Next' }), ui.what, ui.sub, ui.stats));
          if (step.note) side.append(el('p', { class: 'note wide', text: step.note }));
          stage.append(main, side);
          new ResizeObserver(size).observe(ui.cv); size();
        },
        tick(dt, ctx) {
          t = Math.min(pr.T, t + dt);
          const b = band(t, ctx.speed);
          if (b.state === 'out') { if (outSince == null) outSince = t; }
          else if (outSince != null) { const d = t - outSince; outTotal += d; d >= 2 ? viol++ : brief++; outSince = null; }
          if (ctx.speed != null) { hist.push([t, ctx.speed]); if (hist.length > 1200) hist.splice(0, 300); }
        },
        frame(ctx) {
          const v = ctx.speed, b = band(t, v);
          ui.tgt.textContent = U.fromMs(lerp(pr.v, t)).toFixed(1);
          ui.act.textContent = v == null ? '--' : U.fromMs(v).toFixed(1);
          ui.abox.className = 'read actual state ' + b.state;
          ui.err.textContent = b.err == null ? 'No speed' : b.err === 0 ? 'In band' : (b.err > 0 ? 'Fast by ' : 'Slow by ') + U.fromMs(Math.abs(b.err)).toFixed(1) + ' ' + U.label;
          const c = this.done ? { cls: '', what: 'Trace complete', sub: 'Tap Next step.' } : cue(t);
          ui.what.textContent = c.what; ui.what.className = 'what ' + c.cls; ui.sub.textContent = c.sub;
          const cur = outSince != null ? t - outSince : 0;
          ui.stats.textContent = 'Out of band ' + (outTotal + cur).toFixed(1) + ' s · over 2 s: ' + (viol + (cur >= 2 ? 1 : 0));
          const s = segAt(t), i = pr.meta.indexOf(s);
          ui.seg.innerHTML = ''; ui.seg.append(el('b', { text: s.name }), ' ' + (i + 1) + ' of ' + pr.meta.length);
          ui.left.textContent = fmtClock(s.start + s.dur - t) + ' left · ' + fmtClock(pr.T - t) + ' total';
          draw(t, v);
        },
        simWant: () => ({ v: lerp(pr.v, t + 0.6), accel: 3.5, decel: 4 }),
        log: () => ({ target: U.fromMs(lerp(pr.v, t)).toFixed(2), phase: segAt(t).name }),
        result: () => { const cur = outSince != null ? t - outSince : 0; return { elapsed_s: Math.round(t), out_of_band_s: +(outTotal + cur).toFixed(1), brief_excursions: brief, excursions_over_2s: viol + (cur >= 2 ? 1 : 0) }; }
      };
    }
  };
  function buildTrace(step, cycles, U) {
    const v = [], meta = [];
    for (const seg of step.segments) {
      let d, name;
      if (seg.idle != null) { d = new Array(seg.idle + 1).fill(0); name = 'Idle'; }
      else { const c = cycles[seg.cycle]; if (!c) throw new Error('Missing cycle file: cycles/' + seg.cycle + '.json'); const cu = T.units[c.unit === 'kmh' ? 'kmh' : 'mph']; d = c.speed.map(cu.toMs); name = seg.label || c.name; }
      meta.push({ name, start: v.length, dur: d.length - 1 });
      for (let i = 0; i < d.length - 1; i++) v.push(d[i]);
    }
    v.push(0);
    const tolV = U.toMs(step.tolerance?.speed ?? 2), tolT = Math.round(step.tolerance?.time ?? 1);
    const n = v.length, up = new Float32Array(n), lo = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let mx = -Infinity, mn = Infinity;
      for (let k = -tolT; k <= tolT; k++) { const x = v[Math.min(n - 1, Math.max(0, i + k))]; mx = Math.max(mx, x); mn = Math.min(mn, x); }
      up[i] = mx + tolV; lo[i] = Math.max(0, mn - tolV);
    }
    return { v, up, lo, meta, T: n - 1 };
  }

  // ---------- repeated braking stops (brake bedding, fade, etc.) ----------
  types.stops = {
    describe: (s, U) => s.count + ' × ' + s.from + '→' + s.to + ' ' + U.label + ' @ ' + s.decel.target + ' g',
    create(step, P) {
      const U = P.U, from = U.toMs(step.from), to = U.toMs(step.to);
      const margin = U.toMs(U.label === 'mph' ? 1.5 : 2.5);
      const tgtG = step.decel.target, tolG = step.decel.tolerance ?? 0.05;
      const between = step.between || {};
      let t = 0, phase = 'accel', phaseT = 0, stops = [], counted = 0;
      let peak = [], brk = null, coolD = 0, coolT = 0, coolWarn = 0, ui = {}, lastResult = null;
      const setPhase = p => { phase = p; phaseT = 0; };
      const show = ms => U.fromMs(ms).toFixed(0);
      function finish(v, complete, reason) {
        const dur = t - brk.t0;
        const gpsG = dur > 0.3 ? (brk.v0 - v) / dur / G : null;
        const accG = brk.samples.length > 3 ? brk.samples.reduce((a, b) => a + b, 0) / brk.samples.length : null;
        const pk = brk.samples.length ? Math.max(...brk.samples) : null;
        const useG = brk.src !== 'gps' && accG != null ? accG : gpsG;
        let grade = !complete ? 'bad' : useG == null ? 'manual' : Math.abs(useG - tgtG) <= tolG ? 'ok' : useG < tgtG ? 'low' : 'high';
        const s = { n: complete ? counted + 1 : null, v0: U.fromMs(brk.v0), v1: U.fromMs(v), dur, gpsG, accG, peakG: pk, src: brk.src, grade, reason: reason || '', at: P.clock() };
        stops.push(s); lastResult = s;
        P.event('stop', s);
        if (complete) { counted++; T.beep(grade === 'ok' ? 1100 : 500, grade === 'ok' ? 90 : 260); }
        else T.beep(400, 300);
        brk = null; coolD = 0; coolT = 0; coolWarn = 0;
        setPhase(counted >= step.count ? 'done' : complete ? 'cool' : 'accel');
      }
      const inst = {
        timed: true,
        get done() { return phase === 'done'; },
        mount(stage) {
          if (step.note) stage.append(el('p', { class: 'note', text: step.note }));
          ui.n = el('div', { class: 'n' });
          ui.spec = el('div', { class: 'spec', text: step.from + ' → ' + step.to + ' ' + U.label + ' at ' + tgtG + ' ± ' + tolG + ' g' });
          ui.cool = el('div', { class: 'spec', text: 'Between stops: ' + (between.distance ? fmtDist(between.distance) : between.time ? fmtClock(between.time) : 'none') });
          ui.what = el('span', { class: 'what' }); ui.sub = el('span', { class: 'sub' });
          ui.spd = el('span', { class: 'big', text: '--' });
          ui.dec = el('span', { class: 'big', text: '--' }); ui.decSub = el('span', { class: 'sub' });
          ui.dbox = el('div', { class: 'read state' }, el('span', { class: 'lbl', text: 'Decel' }), ui.dec, el('span', { class: 'unit', text: 'g' }), ui.decSub);
          const gmax = Math.max(1, Math.ceil((tgtG + tolG) * 1.6 * 10) / 10);
          ui.gmax = gmax;
          ui.band = el('div', { class: 'band', style: 'left:' + (100 * (tgtG - tolG) / gmax) + '%;width:' + (100 * 2 * tolG / gmax) + '%' });
          ui.needle = el('div', { class: 'needle', style: 'left:0' });
          const ticks = el('div', { class: 'ticks' }); for (let g = 0; g <= gmax + 1e-9; g += gmax / 4) ticks.append(el('span', { text: g.toFixed(2) }));
          ui.last = el('div', { class: 'sub' });
          ui.tbody = el('tbody');
          stage.append(
            el('div', { class: 'counter' }, ui.n, ui.spec, ui.cool),
            el('div', { class: 'cue' }, el('span', { class: 'lbl', text: 'Now' }), ui.what, ui.sub),
            el('div', { class: 'grid2' }, el('div', { class: 'read actual' }, el('span', { class: 'lbl', text: 'Speed' }), ui.spd, el('span', { class: 'unit', text: U.label })), ui.dbox),
            el('div', { class: 'gauge', 'aria-label': 'Deceleration against target band' }, ui.band, ui.needle, ticks),
            el('div', { class: 'inline' },
              el('button', { type: 'button', onclick: () => inst.manualStop() }, 'Count stop manually'),
              el('button', { type: 'button', onclick: () => inst.undo() }, 'Undo last stop')),
            el('div', { style: 'overflow:auto' }, el('table', { class: 'stoptable' },
              el('thead', null, el('tr', null, ['#', 'From', 'To', 'Time s', 'Mean g', 'Peak g', 'Result'].map(h => el('th', { text: h })))), ui.tbody)));
        },
        manualStop() { if (phase === 'done') return; stops.push({ n: counted + 1, grade: 'manual', reason: 'counted by hand', at: P.clock() }); counted++; P.event('stop', stops[stops.length - 1]); brk = null; setPhase(counted >= step.count ? 'done' : 'cool'); coolD = 0; coolT = 0; T.toast('Stop ' + counted + ' counted by hand'); },
        undo() { for (let i = stops.length - 1; i >= 0; i--) if (stops[i].n != null) { const s = stops.splice(i, 1)[0]; counted--; P.event('undo', { n: s.n }); T.toast('Stop ' + s.n + ' removed'); setPhase('accel'); brk = null; return; } T.toast('No counted stops to undo'); },
        tick(dt, ctx) {
          t += dt; phaseT += dt;
          const v = ctx.speed; if (v == null) return;
          const dg = T.sensors.decelG();
          if (phase === 'accel') {
            if (v >= from - margin) { setPhase('armed'); T.beep(880, 80); }
          } else if (phase === 'armed') {
            peak.push([t, v]); while (peak.length && t - peak[0][0] > 2) peak.shift();
            let pv = -1, pt = t; for (const p of peak) if (p[1] >= pv) { pv = p[1]; pt = p[0]; }
            const decelOn = dg != null && dg > 0.08;
            this._decT = decelOn ? (this._decT || 0) + dt : 0;
            if ((this._decT >= 0.4 && v < pv - 0.3) || v < pv - U.toMs(4)) {
              brk = { t0: this._decT >= 0.4 ? t - this._decT : pt, v0: pv, samples: [], src: T.sensors.decelSource(), vmin: v }; peak = []; this._decT = 0; setPhase('braking');
            } else if (v < from - 4 * margin) { setPhase('accel'); T.toast('Speed fell below ' + show(from - margin) + ' ' + U.label + ' before braking. Accelerate again.'); }
          } else if (phase === 'braking') {
            if (dg != null) brk.samples.push(dg);
            brk.vmin = Math.min(brk.vmin, v);
            if (v <= to + margin * 0.5) finish(v, true);
            else if (v > brk.vmin + U.toMs(3)) finish(brk.vmin, false, 'released at ' + show(brk.vmin) + ' ' + U.label);
          } else if (phase === 'cool') {
            coolD += v * dt; coolT += dt;
            if (dg != null && dg > 0.15) { coolWarn += dt; if (coolWarn > 0.6 && coolWarn - dt <= 0.6) T.toast('Braking during the cool-down'); } else coolWarn = 0;
            const need = between.distance ? coolD >= between.distance : between.time ? coolT >= between.time : true;
            if (need) { setPhase('accel'); T.beep(660, 120); }
          }
        },
        frame(ctx) {
          const v = ctx.speed, dg = T.sensors.decelG();
          ui.n.innerHTML = ''; ui.n.append(String(counted), el('small', { text: ' / ' + step.count }));
          let what = '', sub = '', cls = '';
          if (phase === 'accel') { what = 'Accelerate to ' + step.from + ' ' + U.label; sub = counted ? 'Stop ' + (counted + 1) + ' next.' : 'First stop.'; }
          else if (phase === 'armed') { what = 'BRAKE to ' + step.to + ' ' + U.label; sub = 'Steady pedal for ' + tgtG + ' g. Release at ' + step.to + '.'; cls = 'brake'; }
          else if (phase === 'braking') { what = 'Braking… release at ' + step.to; sub = 'Hold ' + tgtG + ' g.'; cls = 'brake'; }
          else if (phase === 'cool') { what = 'Cool: no braking'; sub = between.distance ? fmtDist(Math.max(0, between.distance - coolD)) + ' to go' : fmtClock(Math.max(0, (between.time || 0) - coolT)) + ' to go'; cls = 'go'; }
          else { what = 'All ' + step.count + ' stops done'; sub = 'Tap Next step.'; }
          if (!this.running && phase !== 'done') sub = 'Tap Start when ready. ' + sub;
          ui.what.textContent = what; ui.what.className = 'what ' + cls; ui.sub.textContent = sub;
          ui.spd.textContent = v == null ? '--' : U.fromMs(v).toFixed(0);
          const shown = dg;
          ui.dec.textContent = shown == null ? '--' : Math.max(0, shown).toFixed(2);
          const st = shown == null || shown < 0.05 ? '' : Math.abs(shown - tgtG) <= tolG ? 'ok' : Math.abs(shown - tgtG) <= tolG * 1.8 ? 'near' : 'out';
          ui.dbox.className = 'read state ' + (phase === 'braking' ? st : '');
          ui.decSub.textContent = T.sensors.decelSource() === 'gps' ? 'from GPS (coarse)' : T.sensors.decelSource() === 'accel' ? 'accelerometer' : 'simulated';
          ui.needle.style.left = Math.min(100, Math.max(0, 100 * (shown || 0) / ui.gmax)) + '%';
          if (stops.length !== ui.rows) {
            ui.rows = stops.length; ui.tbody.innerHTML = '';
            stops.slice().reverse().slice(0, 8).forEach(s => {
              const g = s.src !== 'gps' && s.accG != null ? s.accG : s.gpsG;
              const label = { ok: 'In band', low: 'Low', high: 'High', bad: 'Not counted', manual: 'Manual' }[s.grade];
              ui.tbody.append(el('tr', null, el('td', { text: s.n ?? '–' }), el('td', { text: s.v0 != null ? s.v0.toFixed(0) : '' }), el('td', { text: s.v1 != null ? s.v1.toFixed(0) : '' }),
                el('td', { text: s.dur != null ? s.dur.toFixed(1) : '' }), el('td', { text: g != null ? g.toFixed(2) : '' }), el('td', { text: s.peakG != null ? s.peakG.toFixed(2) : '' }),
                el('td', null, el('span', { class: 'tag ' + s.grade, text: label, title: s.reason || '' }))));
            });
          }
        },
        simWant() {
          if (phase === 'accel') return { v: from + U.toMs(2), accel: 2.6, decel: 1 };
          if (phase === 'armed') return phaseT < 1 ? { v: from + U.toMs(2), accel: 1, decel: 0.3 } : { v: Math.max(0, to - U.toMs(4)), accel: 1, decel: (this._simG || (this._simG = tgtG * (0.85 + Math.random() * 0.3))) * G };
          if (phase === 'braking') return { v: Math.max(0, to - U.toMs(4)), accel: 1, decel: (this._simG || tgtG) * G };
          this._simG = 0;
          if (phase === 'cool') return { v: Math.max(to, from * 0.6), accel: 1.5, decel: 0.6 };
          return { v: 0, accel: 2, decel: 2 };
        },
        log: () => ({ target: phase === 'accel' || phase === 'armed' ? step.from : phase === 'braking' ? step.to : '', phase, n: counted }),
        result: () => {
          const c = stops.filter(s => s.n != null);
          return { counted: c.length, in_band: c.filter(s => s.grade === 'ok').length, low: c.filter(s => s.grade === 'low').length, high: c.filter(s => s.grade === 'high').length, manual: c.filter(s => s.grade === 'manual').length, not_counted: stops.length - c.length, stops };
        }
      };
      return inst;
    }
  };
})(window.TPR);
