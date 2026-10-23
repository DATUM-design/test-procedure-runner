/* Shared helpers. Everything hangs off window.TPR. */
window.TPR = window.TPR || {};
(function (T) {
  const G = 9.80665;
  T.G = G;
  T.units = {
    mph: { label: 'mph', fromMs: v => v * 2.2369363, toMs: v => v / 2.2369363 },
    kmh: { label: 'km/h', fromMs: v => v * 3.6, toMs: v => v / 3.6 }
  };
  T.$ = id => document.getElementById(id);
  T.el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  T.fmtClock = s => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0');
  };
  T.fmtDist = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
  T.lerp = (arr, t) => {
    if (t <= 0) return arr[0];
    const n = arr.length - 1; if (t >= n) return arr[n];
    const i = Math.floor(t), f = t - i; return arr[i] + (arr[i + 1] - arr[i]) * f;
  };
  T.css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  T.uid = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
  T.csvCell = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  T.csv = rows => rows.map(r => r.map(T.csvCell).join(',')).join('\n') + '\n';

  let toastTimer = 0;
  T.toast = (text, ms = 2600) => {
    const t = T.$('toast'); if (!t) return;
    t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  };

  // Short beeps for launch / brake cues. Audio starts only after a tap.
  let audio = null;
  T.unlockAudio = () => { if (!audio) try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} if (audio && audio.state === 'suspended') audio.resume(); };
  T.beep = (freq = 880, ms = 120) => {
    if (!audio) return;
    try {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.07;
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + ms / 1000);
    } catch (e) {}
  };

  let wake = null;
  T.holdWake = async () => { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) {} };
  T.releaseWake = () => { try { wake && wake.release(); } catch (e) {} wake = null; };
})(window.TPR);
