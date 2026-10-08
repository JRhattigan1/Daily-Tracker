(() => {
  'use strict';

  // Settings you might want to change
  const CFG = {
    taskRows: 8,      // minimum number of task rows shown
    sleepMin: 3,      // lowest hour on the sleep plot
    sleepMax: 11,     // highest hour on the sleep plot
    sleepTarget: 8,   // highlighted with a dashed line
    maxTarget: 6,     // most times per day a task can be set to
  };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const MOODS = ['Great', 'Good', 'Okay', 'Low', 'Rough']; // top to bottom, values 5 to 1

  const PLOTS = {
    sleep: { id: 'sleepSvg', top: CFG.sleepMax, bottom: CFG.sleepMin, step: 0.5 },
    mood: { id: 'moodSvg', top: 5, bottom: 1, step: 1 },
  };
  for (const p of Object.values(PLOTS)) p.levels = Math.round(p.top - p.bottom) + 1;

  const el = (id) => document.getElementById(id);

  let cur = nowYM();
  let data = null;
  let loadToken = 0;
  let saveTimer = null;
  let retryTimer = null;
  let flushing = false;
  let dragging = false;
  const queue = new Map(); // month key -> JSON body waiting to be saved
  let lastDate = new Date().toDateString();
  let lastNowKey = keyOf(cur);

  // ---------- dates ----------
  function nowYM() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }
  function keyOf(ym) { return `${ym.y}-${String(ym.m).padStart(2, '0')}`; }
  function daysIn(ym) { return new Date(ym.y, ym.m, 0).getDate(); }
  function weekdayOf(i) { return new Date(cur.y, cur.m - 1, i + 1).getDay(); }
  function isWeekend(i) { const w = weekdayOf(i); return w === 0 || w === 6; }
  function todayIndex() {
    const t = new Date();
    return t.getFullYear() === cur.y && t.getMonth() + 1 === cur.m ? t.getDate() - 1 : -1;
  }
  function lastCountedDay() {
    const ti = todayIndex();
    if (ti >= 0) return ti;
    const now = nowYM();
    const past = cur.y < now.y || (cur.y === now.y && cur.m < now.m);
    return past ? daysIn(cur) - 1 : -1;
  }

  // ---------- data ----------
  const fill = (n, v) => Array.from({ length: n }, () => v);

  // Each task has a target (times per day) and a count per day.
  // Older saves stored true/false per day: true becomes a full count.
  function cleanTarget(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(CFG.maxTarget, Math.max(1, n)) : 1;
  }

  function cleanCount(v, target) {
    if (v === true) return target;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(CFG.maxTarget, n) : 0;
  }

  function emptyTask(name, target) {
    return { name: name || '', target: cleanTarget(target), days: fill(31, 0) };
  }

  function normalise(d, templates) {
    const out = { tasks: [], sleep: fill(31, null), mood: fill(31, null), focus: '', notes: '' };
    if (d && typeof d === 'object') {
      if (Array.isArray(d.tasks)) {
        out.tasks = d.tasks
          .filter((t) => t && typeof t === 'object')
          .map((t) => {
            const target = cleanTarget(t.target);
            return {
              name: typeof t.name === 'string' ? t.name : '',
              target,
              days: fill(31, 0).map((_, i) => cleanCount(Array.isArray(t.days) ? t.days[i] : 0, target)),
            };
          });
      }
      for (const k of ['sleep', 'mood']) {
        if (Array.isArray(d[k])) out[k] = out[k].map((_, i) => (typeof d[k][i] === 'number' ? d[k][i] : null));
      }
      if (typeof d.focus === 'string') out.focus = d.focus;
      if (typeof d.notes === 'string') out.notes = d.notes;
    } else if (Array.isArray(templates)) {
      // A new month: carry over last month's task names and targets
      out.tasks = templates.map((t) => (typeof t === 'string' ? emptyTask(t, 1) : emptyTask(String((t && t.name) || ''), t && t.target)));
    }
    while (out.tasks.length < CFG.taskRows) out.tasks.push(emptyTask('', 1));
    return out;
  }

  const isDone = (t, i) => t.days[i] >= t.target;

  function countDone(t) {
    const n = daysIn(cur);
    let c = 0;
    for (let i = 0; i < n; i++) if (isDone(t, i)) c++;
    return c;
  }

  // ---------- loading and saving ----------
  async function load() {
    const key = keyOf(cur);
    const token = ++loadToken;
    try {
      const res = await fetch(`api/month/${key}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      if (token !== loadToken) return;
      if (queue.has(key)) data = normalise(JSON.parse(queue.get(key)));
      else data = body.exists ? normalise(body.data) : normalise(null, body.templates || body.tasks);
      if (!queue.size) setStatus('Saved');
    } catch (e) {
      if (token !== loadToken) return;
      let backup = null;
      try { backup = JSON.parse(localStorage.getItem('tracker:' + key)); } catch (_) { /* none */ }
      data = normalise(backup);
      setStatus('Offline, showing this tablet’s copy', true);
    }
    render();
  }

  function changed() {
    const key = keyOf(cur);
    const body = JSON.stringify(data);
    queue.set(key, body);
    try { localStorage.setItem('tracker:' + key, body); } catch (_) { /* storage full or blocked */ }
    setStatus('Saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  }

  async function flush() {
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    if (flushing) { saveTimer = setTimeout(flush, 300); return; }
    if (!queue.size) return;
    flushing = true;
    let failed = false;
    for (const [key, body] of [...queue]) {
      try {
        const res = await fetch(`api/month/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (!res.ok) throw new Error(String(res.status));
        if (queue.get(key) === body) queue.delete(key);
      } catch (e) {
        failed = true;
      }
    }
    flushing = false;
    if (failed) {
      setStatus('Not saved, retrying', true);
      retryTimer = setTimeout(flush, 5000);
    } else if (queue.size) {
      saveTimer = setTimeout(flush, 300);
    } else {
      setStatus('Saved');
    }
  }

  function setStatus(text, isErr) {
    const s = el('status');
    s.textContent = text;
    if (isErr) s.dataset.s = 'err'; else delete s.dataset.s;
  }

  // ---------- rendering ----------
  function render() {
    const n = daysIn(cur);
    const ti = todayIndex();

    el('month').textContent = MONTHS[cur.m - 1];
    el('year').textContent = String(cur.y);
    el('todayBtn').hidden = keyOf(cur) === keyOf(nowYM());
    if (document.activeElement !== el('focus')) el('focus').value = data.focus;
    if (document.activeElement !== el('notes')) el('notes').value = data.notes;

    // Day header
    let h = '<div class="lab">Task</div>';
    for (let i = 0; i < 31; i++) {
      if (i >= n) { h += `<div class="dh out"><span class="w">&nbsp;</span><span class="d">${i + 1}</span></div>`; continue; }
      const cls = ['dh'];
      if (i === ti) cls.push('today');
      h += `<div class="${cls.join(' ')}"><span class="w">${WD[weekdayOf(i)]}</span><span class="d">${i + 1}</span></div>`;
    }
    h += '<div class="lab r">Total</div>';
    el('dayhead').innerHTML = h;

    // Task rows
    const box = el('tasks');
    box.style.setProperty('--rows', String(data.tasks.length));
    box.innerHTML = data.tasks.map((t, r) => rowHtml(t, r, n, ti)).join('');
    box.querySelectorAll('.tname').forEach((inp) => { inp.value = data.tasks[Number(inp.dataset.r)].name; inp.title = inp.value; });

    // Axis labels
    let sa = '';
    for (let v = CFG.sleepMax; v >= CFG.sleepMin; v--) sa += `<span class="${v === CFG.sleepTarget ? 'tg' : ''}">${v}h</span>`;
    el('sleepAxis').innerHTML = sa;
    el('moodAxis').innerHTML = MOODS.map((m) => `<span>${m}</span>`).join('');

    // Day numbers under the plots
    let ax = '<span></span>';
    for (let i = 0; i < 31; i++) ax += `<span>${i < n ? i + 1 : ''}</span>`;
    ax += '<span></span>';
    el('dayaxis').innerHTML = ax;

    drawPlots();
    updateStats();
  }

  function targetLabel(t) { return `×${t.target}`; }

  function cellLabel(t, r, i) {
    const base = `Task ${r + 1}, ${i + 1} ${MONTHS[cur.m - 1]}`;
    return t.target > 1 ? `${base}, ${Math.min(t.days[i], t.target)} of ${t.target}` : base;
  }

  // Classes and fill level for one day's square
  function cellState(t, i) {
    const c = Math.min(t.days[i], t.target);
    return { done: c >= t.target, part: c > 0 && c < t.target, p: (c / t.target).toFixed(3) };
  }

  function paintCell(b, t, r, i) {
    const st = cellState(t, i);
    b.classList.toggle('done', st.done);
    b.classList.toggle('part', st.part);
    b.style.setProperty('--p', st.p);
    b.setAttribute('aria-pressed', st.done ? 'true' : st.part ? 'mixed' : 'false');
    b.setAttribute('aria-label', cellLabel(t, r, i));
  }

  function rowHtml(t, r, n, ti) {
    const num = String(r + 1).padStart(2, '0');
    let s = `<div class="trow"><div class="tlab"><span class="num">${num}</span>`;
    s += `<input class="tname" data-r="${r}" type="text" placeholder="Add a task" aria-label="Task ${r + 1} name" autocomplete="off" enterkeyhint="done">`;
    s += `<button type="button" class="tgt${t.target > 1 ? ' multi' : ''}" data-r="${r}" aria-label="Times per day for task ${r + 1}: ${t.target}. Tap to change.">${targetLabel(t)}</button></div>`;
    for (let i = 0; i < 31; i++) {
      if (i >= n) { s += '<span class="cell out" aria-hidden="true"></span>'; continue; }
      const st = cellState(t, i);
      const cls = ['cell'];
      if (isWeekend(i)) cls.push('we');
      if (i === ti) cls.push('today');
      if (st.done) cls.push('done');
      if (st.part) cls.push('part');
      const pressed = st.done ? 'true' : st.part ? 'mixed' : 'false';
      s += `<button type="button" class="${cls.join(' ')}" style="--p:${st.p}" data-r="${r}" data-d="${i}" aria-pressed="${pressed}" aria-label="${cellLabel(t, r, i)}"></button>`;
    }
    s += `<div class="tot"><b data-tot="${r}">${countDone(t)}</b>/${n}</div></div>`;
    return s;
  }

  function drawPlots() { drawPlot('sleep'); drawPlot('mood'); }

  function drawPlot(kind) {
    const P = PLOTS[kind];
    const svg = el(P.id);
    const w = svg.clientWidth;
    const h = svg.clientHeight;
    if (!w || !h || !data) return;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const n = daysIn(cur);
    const ti = todayIndex();
    const cw = w / 31;
    const band = h / P.levels;
    const x = (i) => ((i + 0.5) * cw).toFixed(1);
    const y = (v) => ((P.top - v + 0.5) * band).toFixed(1);

    let s = '';
    for (let i = 0; i < n; i++) {
      if (i === ti) s += `<rect class="today" x="${(i * cw).toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${h}"/>`;
      else if (isWeekend(i)) s += `<rect class="we" x="${(i * cw).toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${h}"/>`;
    }
    if (kind === 'sleep') {
      const ty = y(CFG.sleepTarget);
      s += `<line class="target" x1="0" x2="${(n * cw).toFixed(1)}" y1="${ty}" y2="${ty}"/>`;
    }
    for (let l = 0; l < P.levels; l++) {
      const cy = ((l + 0.5) * band).toFixed(1);
      for (let i = 0; i < n; i++) s += `<circle class="dot" cx="${x(i)}" cy="${cy}" r="2"/>`;
    }

    const vals = data[kind];
    const segs = [];
    let seg = [];
    for (let i = 0; i < n; i++) {
      if (vals[i] == null) { if (seg.length) segs.push(seg); seg = []; } else seg.push(`${x(i)},${y(vals[i])}`);
    }
    if (seg.length) segs.push(seg);
    for (const sg of segs) if (sg.length > 1) s += `<polyline class="line" points="${sg.join(' ')}"/>`;

    const r = Math.max(3, Math.min(5, cw * 0.2)).toFixed(1);
    for (let i = 0; i < n; i++) if (vals[i] != null) s += `<circle class="pt" cx="${x(i)}" cy="${y(vals[i])}" r="${r}"/>`;

    svg.innerHTML = s;
  }

  function updateStats() {
    const n = daysIn(cur);
    const last = lastCountedDay();
    const named = data.tasks.filter((t) => t.name.trim());
    let all = 0;
    let best = 0;
    let run = 0;
    if (named.length) {
      for (let i = 0; i <= last; i++) {
        if (named.every((t) => isDone(t, i))) { all++; run++; if (run > best) best = run; } else run = 0;
      }
    }
    el('statAll').textContent = String(all);
    el('statStreak').textContent = best === 1 ? '1 day' : `${best} days`;

    const sl = data.sleep.slice(0, n).filter((v) => v != null);
    el('statSleep').textContent = sl.length ? `${(sl.reduce((a, b) => a + b, 0) / sl.length).toFixed(1)}h` : '-';

    const md = data.mood.slice(0, n).filter((v) => v != null);
    if (md.length) {
      const avg = md.reduce((a, b) => a + b, 0) / md.length;
      el('statMood').textContent = `${MOODS[5 - Math.round(avg)]} (${avg.toFixed(1)})`;
    } else {
      el('statMood').textContent = '-';
    }
  }

  // ---------- interaction ----------
  function buzz(pattern) { if (navigator.vibrate) navigator.vibrate(pattern || 8); }

  el('tasks').addEventListener('click', (e) => {
    // Times-per-day button: cycles 1, 2, 3 ... up to the max, then back to 1
    const tb = e.target.closest('button.tgt');
    if (tb) {
      const r = Number(tb.dataset.r);
      const t = data.tasks[r];
      const prev = t.target;
      t.target = t.target >= CFG.maxTarget ? 1 : t.target + 1;
      // Days already complete stay complete; part-done days keep their count
      t.days = t.days.map((c) => (c >= prev ? t.target : Math.min(c, t.target)));
      tb.textContent = targetLabel(t);
      tb.classList.toggle('multi', t.target > 1);
      tb.setAttribute('aria-label', `Times per day for task ${r + 1}: ${t.target}. Tap to change.`);
      el('tasks').querySelectorAll(`button.cell[data-r="${r}"]`).forEach((b) => paintCell(b, t, r, Number(b.dataset.d)));
      el('tasks').querySelector(`[data-tot="${r}"]`).textContent = String(countDone(t));
      buzz();
      updateStats();
      changed();
      return;
    }

    // A day's square: each tap adds one; once it reaches the target the next tap clears it
    const b = e.target.closest('button.cell');
    if (!b) return;
    const r = Number(b.dataset.r);
    const d = Number(b.dataset.d);
    const t = data.tasks[r];
    t.days[d] = t.days[d] >= t.target ? 0 : t.days[d] + 1;
    paintCell(b, t, r, d);
    el('tasks').querySelector(`[data-tot="${r}"]`).textContent = String(countDone(t));
    buzz(t.days[d] === t.target && t.target > 1 ? [8, 60, 8] : 8);
    updateStats();
    changed();
  });

  el('tasks').addEventListener('input', (e) => {
    if (!e.target.classList.contains('tname')) return;
    data.tasks[Number(e.target.dataset.r)].name = e.target.value;
    e.target.title = e.target.value;
    updateStats();
    changed();
  });

  // Keep the name field focused when tapping its times-per-day pill, so the pill doesn't vanish mid-tap
  el('tasks').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button.tgt')) e.preventDefault();
  });

  el('tasks').addEventListener('focusout', (e) => {
    if (e.target.classList && e.target.classList.contains('tname')) e.target.scrollLeft = 0;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.target.blur();
  });

  el('focus').addEventListener('input', (e) => { data.focus = e.target.value; changed(); });
  el('notes').addEventListener('input', (e) => { data.notes = e.target.value; changed(); });

  function bindPlot(kind) {
    const P = PLOTS[kind];
    const svg = el(P.id);
    let drag = null;

    const at = (e) => {
      const rect = svg.getBoundingClientRect();
      const i = Math.floor(((e.clientX - rect.left) / rect.width) * 31);
      const band = rect.height / P.levels;
      let v = P.top - ((e.clientY - rect.top) / band - 0.5);
      v = Math.round(v / P.step) * P.step;
      v = Math.max(P.bottom, Math.min(P.top, v));
      return { i, v };
    };

    const set = (i, v) => {
      if (i < 0 || i >= daysIn(cur)) return false;
      if (data[kind][i] === v) return false;
      data[kind][i] = v;
      drawPlot(kind);
      updateStats();
      return true;
    };

    svg.addEventListener('pointerdown', (e) => {
      const { i, v } = at(e);
      if (i < 0 || i >= daysIn(cur)) return;
      e.preventDefault();
      try { svg.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
      drag = { id: e.pointerId, start: i, prev: data[kind][i], v, moved: false };
      dragging = true;
      set(i, v);
      buzz();
    });

    svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { i, v } = at(e);
      if (i !== drag.start) drag.moved = true;
      if (set(i, v) && i !== drag.lastBuzz) { drag.lastBuzz = i; buzz(); }
    });

    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      // A single tap on a point that was already there clears it
      if (!drag.moved && drag.prev === drag.v && data[kind][drag.start] === drag.v) {
        data[kind][drag.start] = null;
        drawPlot(kind);
        updateStats();
      }
      drag = null;
      dragging = false;
      changed();
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  bindPlot('sleep');
  bindPlot('mood');

  async function go(delta) {
    await flush();
    let m = cur.m + delta;
    let y = cur.y;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    cur = { y, m };
    load();
  }

  el('prev').addEventListener('click', () => go(-1));
  el('next').addEventListener('click', () => go(1));
  el('todayBtn').addEventListener('click', async () => { await flush(); cur = nowYM(); load(); });

  // Theme: auto follows the tablet, or force light or dark
  const THEMES = ['auto', 'light', 'dark'];
  function applyTheme(t) {
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    el('themeBtn').textContent = `Theme: ${t}`;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fdfcf9';
    if (data) drawPlots();
  }
  let theme = 'auto';
  try { theme = localStorage.getItem('tracker:theme') || 'auto'; } catch (_) { /* default */ }
  if (!THEMES.includes(theme)) theme = 'auto';
  applyTheme(theme);
  el('themeBtn').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem('tracker:theme', theme); } catch (_) { /* ignore */ }
    applyTheme(theme);
  });

  // Redraw plots when the screen size or orientation changes
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { if (data) drawPlots(); });
    ro.observe(el('sleepSvg'));
    ro.observe(el('moodSvg'));
  } else {
    window.addEventListener('resize', () => { if (data) drawPlots(); });
  }

  // Keep a wall tablet current: roll over at midnight, pick up edits made on other devices
  function idle() {
    const a = document.activeElement;
    return !queue.size && !dragging && !flushing && !(a && a.tagName === 'INPUT');
  }

  setInterval(() => {
    const d = new Date().toDateString();
    if (d !== lastDate) {
      lastDate = d;
      const nowKey = keyOf(nowYM());
      if (keyOf(cur) === lastNowKey && nowKey !== lastNowKey) { cur = nowYM(); lastNowKey = nowKey; load(); return; }
      lastNowKey = nowKey;
      if (data) render();
    }
  }, 60 * 1000);

  // Reload the page when the server has been updated to a new version
  let appVersion = null;
  async function checkVersion() {
    try {
      const res = await fetch('api/version', { cache: 'no-store' });
      if (!res.ok) return false;
      const { version } = await res.json();
      if (appVersion === null) { appVersion = version; return false; }
      if (version !== appVersion && idle()) { location.reload(); return true; }
    } catch (_) { /* server restarting, try again next time */ }
    return false;
  }

  setInterval(async () => {
    if (await checkVersion()) return;
    if (idle() && document.visibilityState === 'visible') load();
  }, 5 * 60 * 1000);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      if (await checkVersion()) return;
      if (idle()) load();
    } else {
      flush();
    }
  });

  window.addEventListener('pagehide', () => {
    // Best effort save if the page is closed mid-edit
    for (const [key, body] of queue) {
      try { fetch(`api/month/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }); } catch (_) { /* ignore */ }
    }
  });

  checkVersion();
  load();
})();
