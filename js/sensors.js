/* Speed and acceleration sources: phone/tablet GPS + accelerometer, simulated driver, or an NMEA GPS over Web Serial. */
(function (T) {
  const G = T.G;
  const S = T.sensors = {
    source: 'device',
    // GPS
    speed: null, speedAt: 0, lat: null, lon: null, acc: null, fix: false, gpsTimes: [], gpsErr: '', gpsOn: false,
    // motion
    motion: 'off', longG: null, horizG: null, zeroed: false, fwdWeight: 0, motionTimes: [],
    _g0: null, _gLP: null, _h: [0, 0, 0], _fwd: [0, 0, 0], _hist: [], _watch: null,
    // sim
    _simV: 0, _simA: 0, simWant: null,
    port: null
  };
  try { const s = localStorage.getItem('tpr.source'); if (s) S.source = s; } catch (e) {}

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const norm = a => Math.hypot(a[0], a[1], a[2]);

  S.setSource = src => {
    S.source = src;
    try { localStorage.setItem('tpr.source', src); } catch (e) {}
    S.speed = null; S.fix = false; S.longG = null; S.horizG = null; S._hist = [];
    if (src === 'sim') { S._simV = 0; S.speed = 0; S.fix = true; S.speedAt = performance.now(); S.motion = 'sim'; }
    else if (S.motion === 'sim') S.motion = 'off';
  };

  function pushSpeed(ms, now) {
    S.speed = ms < 0.25 ? 0 : ms; S.speedAt = now; S.fix = true;
    S.gpsTimes.push(now); while (S.gpsTimes.length && now - S.gpsTimes[0] > 3000) S.gpsTimes.shift();
    S._hist.push([now, S.speed]); while (S._hist.length && now - S._hist[0][0] > 2500) S._hist.shift();
  }
  S.gpsHz = () => S.gpsTimes.length / 3;
  S.motionHz = () => S.motionTimes.length / 2;
  S.fresh = () => S.source === 'sim' || (S.fix && performance.now() - S.speedAt < 2500);
  S.currentSpeed = () => S.fresh() ? S.speed : null;

  // dv/dt from the last ~1.2 s of speed samples, m/s²
  S.gpsAccel = () => {
    const h = S._hist; if (h.length < 2) return null;
    const last = h[h.length - 1]; let first = h[0];
    for (const p of h) if (last[0] - p[0] <= 1300) { first = p; break; }
    const dt = (last[0] - first[0]) / 1000; return dt > 0.5 ? (last[1] - first[1]) / dt : null;
  };

  // ---------- phone / tablet GPS ----------
  let prevFix = null;
  function onPos(p) {
    const now = performance.now(), c = p.coords;
    S.lat = c.latitude; S.lon = c.longitude; S.acc = c.accuracy; S.gpsErr = '';
    let v = (c.speed != null && c.speed >= 0 && !isNaN(c.speed)) ? c.speed : null;
    if (v == null && prevFix) {
      const dt = (p.timestamp - prevFix.ts) / 1000;
      if (dt > 0.3) { const d = haversine(prevFix.lat, prevFix.lon, c.latitude, c.longitude); v = d / dt; }
    }
    prevFix = { lat: c.latitude, lon: c.longitude, ts: p.timestamp };
    if (v != null) pushSpeed(v, now);
  }
  function onPosErr(e) {
    S.gpsErr = e.code === 1 ? 'Location permission denied. Allow it in the browser or system settings, then reload.'
      : e.code === 2 ? 'No GPS position yet. Go outside with a clear view of the sky.'
      : 'GPS timed out waiting for a fix.';
    if (e.code === 1) S.gpsOn = false;
  }
  function haversine(a1, o1, a2, o2) {
    const R = 6371000, r = Math.PI / 180, da = (a2 - a1) * r, dO = (o2 - o1) * r;
    const x = Math.sin(da / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  S.startGps = () => {
    if (!('geolocation' in navigator)) { S.gpsErr = 'This browser has no location access.'; return; }
    if (!window.isSecureContext) { S.gpsErr = 'Location needs the https web address, not a local file.'; return; }
    if (S._watch != null) return;
    S._watch = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    S.gpsOn = true;
  };

  // ---------- accelerometer ----------
  let lastMotion = 0;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
    const now = performance.now(), dt = lastMotion ? Math.min(0.2, (now - lastMotion) / 1000) : 0.016; lastMotion = now;
    S.motionTimes.push(now); while (S.motionTimes.length && now - S.motionTimes[0] > 2000) S.motionTimes.shift();
    const v = [a.x, a.y, a.z];
    S._gLP = S._gLP ? S._gLP.map((g, i) => g + (v[i] - g) * (1 - Math.exp(-dt / 2.5))) : v.slice();
    if (zeroing) { zeroing.sum = zeroing.sum.map((s, i) => s + v[i]); zeroing.n++; }
    const g = S._g0 || S._gLP; const gn = norm(g); if (gn < 5) return;
    const gh = scale(g, 1 / gn);
    const lin = sub(v, g);
    const h = sub(lin, scale(gh, dot(lin, gh)));
    S._h = S._h.map((x, i) => x + (h[i] - x) * (1 - Math.exp(-dt / 0.25)));
    S.horizG = norm(S._h) / G;
    const fn = norm(S._fwd);
    S.longG = S.fwdWeight > 6 && fn > 0 ? dot(S._h, S._fwd) / fn / G : null;
    S.motion = 'on';
  }
  // Learn which way is "forward" in the phone's frame from moments when GPS says the car is clearly speeding up or slowing down.
  S.learnForward = () => {
    if (S.source === 'sim') return;
    const ga = S.gpsAccel(), v = S.currentSpeed();
    if (ga == null || v == null || v < 3 || Math.abs(ga) < 1.0 || norm(S._h) < 0.6) return;
    const k = Math.sign(ga) / norm(S._h);
    S._fwd = S._fwd.map((f, i) => f * 0.995 + S._h[i] * k);
    S.fwdWeight = Math.min(200, S.fwdWeight + 1);
  };
  S.startMotion = async () => {
    if (!('DeviceMotionEvent' in window)) { S.motion = 'unavailable'; return; }
    if (S.motion === 'on' || S.motion === 'waiting' || S._motionBound) return;
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') { S.motion = 'denied'; return; }
      }
      window.addEventListener('devicemotion', onMotion); S._motionBound = true;
      S.motion = 'waiting';
      setTimeout(() => { if (S.motion === 'waiting') S.motion = 'unavailable'; }, 3000);
    } catch (e) { S.motion = 'denied'; }
  };
  let zeroing = null;
  S.zero = () => new Promise(res => {
    if (S.motion !== 'on') { res(false); return; }
    zeroing = { sum: [0, 0, 0], n: 0 };
    setTimeout(() => {
      const z = zeroing; zeroing = null;
      if (z.n < 10) { res(false); return; }
      S._g0 = z.sum.map(s => s / z.n); S.zeroed = true; S._fwd = [0, 0, 0]; S.fwdWeight = 0;
      try { localStorage.setItem('tpr.g0', JSON.stringify(S._g0)); } catch (e) {}
      res(true);
    }, 1500);
  });
  try { const g = JSON.parse(localStorage.getItem('tpr.g0') || 'null'); if (g) { S._g0 = g; S.zeroed = true; } } catch (e) {}

  // Positive braking deceleration in g, from the accelerometer when it knows forward, else GPS.
  S.decelG = () => {
    if (S.source === 'sim') return -S.longG;
    if (S.longG != null) return -S.longG;
    const ga = S.gpsAccel(); return ga == null ? null : -ga / G;
  };
  S.decelSource = () => S.source === 'sim' ? 'sim' : S.longG != null ? 'accel' : 'gps';

  // ---------- simulated driver ----------
  // Steps set S.simWant = { v: m/s, accel: m/s² limit, decel: m/s² limit }.
  S.tick = dt => {
    if (S.source !== 'sim') { S.learnForward(); return; }
    const w = S.simWant || { v: 0, accel: 2, decel: 3 };
    const err = w.v - S._simV;
    let a = err / 0.7;
    a = Math.max(-(w.decel || 3), Math.min(w.accel || 2, a));
    S._simA += (a - S._simA) * (1 - Math.exp(-dt / 0.3));
    S._simV = Math.max(0, S._simV + S._simA * dt);
    if (S._simV < 0.05 && w.v < 0.1) { S._simV = 0; S._simA = 0; }
    const now = performance.now();
    pushSpeed(S._simV + (S._simV > 0.5 ? (Math.random() - 0.5) * 0.08 : 0), now);
    S.longG = S._simA / G + (Math.random() - 0.5) * 0.01;
    S.horizG = Math.abs(S.longG);
  };

  // ---------- NMEA GPS over Web Serial (laptop Chrome/Edge, Bluetooth GPS apps) ----------
  S.serialSupported = 'serial' in navigator;
  S.connectSerial = async baud => {
    if (!S.serialSupported) throw new Error('This browser cannot open serial ports. Use Chrome or Edge on a laptop or Android.');
    S.port = await navigator.serial.requestPort();
    await S.port.open({ baudRate: baud });
    const dec = new TextDecoderStream(); S.port.readable.pipeTo(dec.writable).catch(() => {});
    const reader = dec.readable.getReader(); let buf = '';
    (async () => {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break; buf += value; let i;
        while ((i = buf.indexOf('\n')) >= 0) { nmea(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
      }
    })().catch(() => {});
  };
  function nmeaLat(v, h) { if (!v) return null; const d = parseFloat(v.slice(0, 2)), m = parseFloat(v.slice(2)); const x = d + m / 60; return h === 'S' ? -x : x; }
  function nmeaLon(v, h) { if (!v) return null; const d = parseFloat(v.slice(0, 3)), m = parseFloat(v.slice(3)); const x = d + m / 60; return h === 'W' ? -x : x; }
  function nmea(line) {
    if (!line.startsWith('$')) return; const f = line.split('*')[0].split(','), id = f[0].slice(3);
    if (id === 'RMC') {
      if (f[2] !== 'A') { S.fix = false; return; }
      S.lat = nmeaLat(f[3], f[4]); S.lon = nmeaLon(f[5], f[6]);
      const kn = parseFloat(f[7]); if (!isNaN(kn)) pushSpeed(kn * 0.514444, performance.now());
    } else if (id === 'GGA') { const hd = parseFloat(f[8]); if (!isNaN(hd)) S.acc = hd * 5; }
  }

  S.summary = () => {
    if (S.source === 'sim') return { gps: ['SIMULATED', 'warn'], motion: null };
    const fresh = S.fresh();
    const gps = S.source === 'serial'
      ? (fresh ? ['GPS ' + S.gpsHz().toFixed(0) + ' Hz', 'on'] : [S.port ? 'GPS NO FIX' : 'GPS OFF', S.port ? 'bad' : ''])
      : (!S.gpsOn ? ['GPS OFF', ''] : fresh ? ['GPS ' + (S.acc != null ? '±' + Math.round(S.acc) + ' m' : 'OK'), S.acc != null && S.acc > 15 ? 'warn' : 'on'] : ['GPS NO FIX', 'bad']);
    const m = S.motion === 'on' ? [S.longG != null ? 'ACCEL OK' : 'ACCEL LEARNING', S.longG != null ? 'on' : 'warn']
      : S.motion === 'denied' ? ['ACCEL DENIED', 'bad'] : S.motion === 'unavailable' ? ['NO ACCEL', ''] : ['ACCEL OFF', ''];
    return { gps, motion: m };
  };
})(window.TPR);
