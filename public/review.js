// Month review: the month's numbers, charts and achievements.
// Self-contained: it works from a month's saved data, so it can also look at last month.
(() => {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MOODS = ['Rough', 'Low', 'Okay', 'Good', 'Great']; // 1 to 5
  const CHAIN_MILESTONES = [3, 7, 14, 21, 30];
  const TICK_MILESTONES = [25, 50, 100, 150, 200, 300, 400, 500, 750, 1000];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x) => `${Math.round(x * 100)}%`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const fmt = (n) => n.toLocaleString('en-GB');
  const ICONS = {
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg>',
  };

  // ---------- numbers ----------

  // last = index of the last day to count (today for the current month, the final day for a
  // past month, -1 for a future month)
  function compute(data, y, m, last, opts) {
    const o = opts || {};
    const n = new Date(y, m, 0).getDate();
    const wd = (i) => new Date(y, m - 1, i + 1).getDay();
    const tasks = data.tasks.filter((t) => t.name.trim());
    const due = (t, i) => t.schedule[wd(i)];
    const done = (t, i) => t.days[i] >= t.target;
    const frac = (t, i) => Math.min(t.days[i], t.target) / t.target;

    let dueTotal = 0;
    let doneOnDue = 0;
    let ticks = 0;
    const cum = [];
    const days = [];
    for (let i = 0; i < n; i++) {
      const dueTasks = tasks.filter((t) => due(t, i));
      const doneCount = tasks.filter((t) => done(t, i)).length;
      const counted = i <= last;
      if (counted) {
        dueTotal += dueTasks.length;
        doneOnDue += dueTasks.filter((t) => done(t, i)).length;
        ticks += doneCount;
        cum.push(ticks);
      }
      days.push({
        i,
        wd: wd(i),
        counted,
        dueCount: dueTasks.length,
        doneCount: dueTasks.filter((t) => done(t, i)).length,
        f: dueTasks.length ? dueTasks.reduce((a, t) => a + frac(t, i), 0) / dueTasks.length : null,
        perfect: dueTasks.length > 0 && dueTasks.every((t) => done(t, i)),
      });
    }

    // Perfect days and the longest run of them (days with nothing due don't break a run)
    let perfectDays = 0;
    let perfectBest = 0;
    let perfectRun = 0;
    for (const d of days) {
      if (!d.counted || !d.dueCount) continue;
      if (d.perfect) { perfectDays++; perfectRun++; perfectBest = Math.max(perfectBest, perfectRun); } else perfectRun = 0;
    }

    // Per task: done out of due, best chain and the chain running now
    const perTask = tasks.map((t) => {
      let dueN = 0;
      let doneN = 0;
      let bonus = 0;
      let run = 0;
      let best = 0;
      const runAt = [];
      for (let i = 0; i < n; i++) {
        if (i <= last) {
          if (due(t, i)) { dueN++; if (done(t, i)) doneN++; } else if (done(t, i)) bonus++;
          if (done(t, i)) { run++; best = Math.max(best, run); } else if (due(t, i)) run = 0;
        }
        runAt.push(run);
      }
      let current = last >= 0 ? runAt[last] : 0;
      // If today is due but not done yet, the chain isn't broken until tomorrow
      if (o.isCurrentMonth && last >= 1 && due(t, last) && !done(t, last)) current = runAt[last - 1];
      return { name: t.name.trim(), target: t.target, dueN, doneN, bonus, best, current, every: t.schedule.every(Boolean), todayDue: last >= 0 && due(t, last), todayDone: last >= 0 && done(t, last) };
    });

    // Weeks run Monday to Sunday
    const weeks = [];
    for (const d of days) {
      if (!d.counted) break;
      const isMonday = d.wd === 1;
      if (!weeks.length || isMonday) weeks.push({ start: d.i, end: d.i, due: 0, done: 0, days: [] });
      const w = weeks[weeks.length - 1];
      w.end = d.i;
      w.due += d.dueCount;
      w.done += d.doneCount;
      w.days.push(d);
    }
    for (const w of weeks) {
      w.pct = w.due ? w.done / w.due : null;
      w.full = w.days.length === 7;
      w.perfect = w.full && w.days.some((d) => d.dueCount) && w.days.every((d) => !d.dueCount || d.perfect);
    }

    // Sleep, steps and mood
    const vals = (k) => (data[k] || []).slice(0, Math.max(0, last + 1)).filter((v) => typeof v === 'number');
    const sleep = vals('sleep');
    const steps = vals('steps');
    const sleepTarget = o.sleepTarget || 8;
    const stepsTarget = o.stepsTarget || 10000;
    const sleepHit = sleep.filter((v) => v >= sleepTarget).length;
    const stepsHit = steps.filter((v) => v >= stepsTarget).length;

    let moodInsight = null;
    const good = [];
    const short = [];
    for (let i = 0; i <= last && i < n; i++) {
      const s = data.sleep && data.sleep[i];
      const md = data.mood && data.mood[i];
      if (typeof s === 'number' && typeof md === 'number') (s >= sleepTarget ? good : short).push(md);
    }
    if (good.length >= 3 && short.length >= 3) {
      const avg = (a) => a.reduce((x, y2) => x + y2, 0) / a.length;
      moodInsight = { good: avg(good), short: avg(short), nGood: good.length, nShort: short.length };
    }

    return {
      y, m, n, last, tasks: perTask, days, weeks, cum,
      dueTotal, doneOnDue, completion: dueTotal ? doneOnDue / dueTotal : null,
      ticks, perfectDays, perfectBest,
      sleepAvg: sleep.length ? sleep.reduce((a, b) => a + b, 0) / sleep.length : null,
      stepsAvg: steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : null,
      sleepHit, stepsHit, sleepLogged: sleep.length, stepsLogged: steps.length,
      sleepTarget, stepsTarget, moodInsight,
    };
  }

  function achievements(r, prevPace, isCurrentMonth) {
    const out = [];
    const tickMs = TICK_MILESTONES.filter((x) => x <= r.ticks).pop();
    if (tickMs) out.push({ big: fmt(tickMs), text: `${fmt(tickMs)}+ things done` });
    const pw = r.weeks.filter((w) => w.perfect);
    for (const w of pw) out.push({ big: '7/7', text: `Perfect week, ${w.start + 1} to ${w.end + 1} ${MONTHS[r.m - 1].slice(0, 3)}` });
    if (r.perfectBest >= 2) out.push({ big: String(r.perfectBest), text: `perfect days in a row` });
    const chains = r.tasks.filter((t) => t.best >= 7).sort((a, b) => b.best - a.best).slice(0, 4);
    for (const t of chains) out.push({ big: String(t.best), text: `day chain: ${t.name}` });
    for (const t of r.tasks.filter((t2) => t2.dueN >= 7 && t2.doneN === t2.dueN)) out.push({ icon: 'check', text: `Never missed: ${t.name}` });
    if (r.sleepHit >= 5) out.push({ big: String(r.sleepHit), text: `nights of ${r.sleepTarget}h+ sleep` });
    if (r.stepsHit >= 5) out.push({ big: String(r.stepsHit), text: `days over ${fmt(r.stepsTarget)} steps` });
    if (prevPace && prevPace.completion != null && r.completion != null && r.completion > prevPace.completion + 0.005) {
      out.push({ icon: 'up', text: isCurrentMonth ? 'Ahead of last month at this point' : 'Better than the month before' });
    }
    return out;
  }

  function nextUp(r) {
    const out = [];
    const left = r.tasks.filter((t) => t.todayDue && !t.todayDone);
    const dueToday = r.tasks.filter((t) => t.todayDue);
    if (dueToday.length && left.length && left.length <= 3) {
      out.push({ done: dueToday.length - left.length, of: dueToday.length, text: `${plural(left.length, 'thing')} left for a perfect day: ${left.map((t) => t.name).join(', ')}` });
    }
    const chains = [];
    for (const t of r.tasks) {
      if (t.current < 1) continue;
      const next = CHAIN_MILESTONES.find((x) => x > t.current);
      if (!next) continue;
      chains.push({ gap: next - t.current, done: t.current, of: next, text: `${plural(next - t.current, 'more day')} for a ${next}-day chain: ${t.name}` });
    }
    chains.sort((a, b) => a.gap - b.gap);
    out.push(...chains.slice(0, 3));
    const nextTicks = TICK_MILESTONES.find((x) => x > r.ticks);
    if (nextTicks && nextTicks - r.ticks <= 25) out.push({ done: r.ticks, of: nextTicks, text: `${nextTicks - r.ticks} more to reach ${fmt(nextTicks)} things done` });
    return out.slice(0, 4);
  }

  // ---------- drawing ----------

  function niceMax(v) {
    if (v <= 5) return 5;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const s of [1, 2, 2.5, 5, 10]) if (s * p >= v) return s * p;
    return 10 * p;
  }

  function ring(fraction) {
    const r = 46;
    const c = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, fraction || 0));
    return `<svg class="rv-ring" viewBox="0 0 112 112" aria-hidden="true">
      <circle class="rv-ring-track" cx="56" cy="56" r="${r}"/>
      <circle class="rv-ring-fill" cx="56" cy="56" r="${r}" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 56 56)"/>
    </svg>`;
  }

  function delta(curVal, prevVal, unit, label) {
    if (curVal == null || prevVal == null) return '';
    const d = curVal - prevVal;
    const shown = unit === 'pts' ? Math.round(d * 100) : Math.round(d);
    if (shown === 0) return `<span class="rv-delta">Level with ${label}</span>`;
    const up = shown > 0;
    const arrow = up ? '<path d="M6 10V2M2 6l4-4 4 4"/>' : '<path d="M6 2v8M2 6l4 4 4-4"/>';
    return `<span class="rv-delta ${up ? 'up' : 'down'}"><svg viewBox="0 0 12 12" aria-hidden="true">${arrow}</svg>${up ? '+' : ''}${shown}${unit === 'pts' ? ' pts' : ''} vs ${label}</span>`;
  }

  function buildUp(r, prevFull, width) {
    const W = Math.max(280, width);
    const H = 260;
    const L = 40;
    const R = 52;
    const T = 14;
    const B = 26;
    const pw = W - L - R;
    const ph = H - T - B;
    const n = r.n;
    const prevCum = prevFull ? prevFull.cum : [];
    const maxV = niceMax(Math.max(5, ...r.cum, ...prevCum));
    const x = (i) => L + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
    const y = (v) => T + ph - (v / maxV) * ph;
    let s = `<svg class="rv-chart" data-chart="cum" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Things done building up over the month${r.cum.length ? `, ${r.ticks} so far` : ''}">`;
    for (let k = 0; k <= 4; k++) {
      const v = (maxV / 4) * k;
      s += `<line class="rv-gl" x1="${L}" x2="${L + pw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
      s += `<text class="rv-tick" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(Math.round(v))}</text>`;
    }
    for (const d of [0, 6, 13, 20, 27, n - 1]) {
      if (d >= n) continue;
      s += `<text class="rv-tick" x="${x(d).toFixed(1)}" y="${H - 6}" text-anchor="middle">${d + 1}</text>`;
    }
    if (prevCum.length > 1) {
      s += `<polyline class="rv-prev" points="${prevCum.map((v, i) => `${x(Math.min(i, n - 1)).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
    }
    if (r.cum.length) {
      const pts = r.cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      s += `<polygon class="rv-area" points="${x(0).toFixed(1)},${y(0).toFixed(1)} ${pts.join(' ')} ${x(r.cum.length - 1).toFixed(1)},${y(0).toFixed(1)}"/>`;
      if (r.cum.length > 1) s += `<polyline class="rv-line" points="${pts.join(' ')}"/>`;
      const li = r.cum.length - 1;
      s += `<circle class="rv-end" cx="${x(li).toFixed(1)}" cy="${y(r.cum[li]).toFixed(1)}" r="5"/>`;
      s += `<text class="rv-endlabel" x="${(x(li) + 9).toFixed(1)}" y="${(y(r.cum[li]) + 4).toFixed(1)}">${fmt(r.cum[li])}</text>`;
    }
    s += `<line class="rv-cross" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>`;
    s += `<rect class="rv-hit" x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent"/>`;
    s += '</svg>';
    return { svg: s, geom: { L, pw, n } };
  }

  function heatLevel(d) {
    if (!d.counted) return 'future';
    if (!d.dueCount) return 'rest';
    if (d.perfect) return 'l5';
    if (d.f <= 0) return 'l0';
    if (d.f < 0.34) return 'l1';
    if (d.f < 0.67) return 'l2';
    return 'l3';
  }

  function calendar(r) {
    const first = (r.days[0].wd + 6) % 7; // Monday first
    let s = '<div class="rv-cal" role="grid" aria-label="Days of the month, shaded by how much was done">';
    for (const h of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) s += `<span class="rv-cal-h" aria-hidden="true">${h}</span>`;
    for (let k = 0; k < first; k++) s += '<span class="rv-cal-blank"></span>';
    for (const d of r.days) {
      const lvl = heatLevel(d);
      const date = `${WD_SHORT[d.wd]} ${d.i + 1} ${MONTHS[r.m - 1].slice(0, 3)}`;
      let tip;
      if (lvl === 'future') tip = `${date}: still to come`;
      else if (lvl === 'rest') tip = `${date}: nothing due`;
      else tip = `${date}: ${d.doneCount} of ${d.dueCount} done${d.perfect ? ', perfect day' : ''}`;
      const mark = d.perfect ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.2 2.2L9.5 3.8"/></svg>' : '';
      s += `<span class="rv-cal-d ${lvl}" tabindex="0" role="gridcell" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><b>${d.i + 1}</b>${mark}</span>`;
    }
    s += '</div>';
    s += `<div class="rv-legend" aria-hidden="true"><span>Less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><span>More</span><i class="l5"></i><span>Perfect day</span></div>`;
    return s;
  }

  function taskBars(r) {
    if (!r.tasks.length) return '<p class="rv-empty">Name a task to see it here.</p>';
    let s = '<ul class="rv-tasks">';
    for (const t of r.tasks) {
      const f = t.dueN ? t.doneN / t.dueN : 0;
      const tip = `${t.name}: ${t.doneN} of ${t.dueN} due days${t.bonus ? `, plus ${t.bonus} bonus` : ''}. Best chain ${t.best}, current ${t.current}`;
      const meta = [`best chain ${t.best}`, t.current ? `${t.current} running` : null, t.bonus ? `+${t.bonus} bonus` : null].filter(Boolean).join(' · ');
      s += `<li tabindex="0" data-tip="${esc(tip)}"><span class="rv-tname">${esc(t.name)}</span>`;
      s += `<span class="rv-bar" aria-hidden="true"><i style="width:${(f * 100).toFixed(1)}%"></i></span>`;
      s += `<span class="rv-tval"><b>${t.doneN}</b>/${t.dueN}</span>`;
      s += `<span class="rv-tmeta">${esc(meta)}</span></li>`;
    }
    s += '</ul>';
    return s;
  }

  function weekBars(r) {
    const ws = r.weeks.filter((w) => w.pct != null);
    if (!ws.length) return '<p class="rv-empty">Nothing counted yet.</p>';
    const H = 120;
    let s = '<div class="rv-weeks">';
    for (const w of ws) {
      const label = w.start === w.end ? `${w.start + 1}` : `${w.start + 1}-${w.end + 1}`;
      const tip = `${label} ${MONTHS[r.m - 1].slice(0, 3)}: ${w.done} of ${w.due} done (${pct(w.pct)})${w.perfect ? ', perfect week' : ''}`;
      s += `<div class="rv-week${w.perfect ? ' perfect' : ''}" tabindex="0" data-tip="${esc(tip)}">`;
      s += `<span class="rv-wval">${pct(w.pct)}</span>`;
      s += `<span class="rv-wcol" style="height:${H}px" aria-hidden="true"><i style="height:${Math.max(2, w.pct * H).toFixed(1)}px"></i></span>`;
      s += `<span class="rv-wlab">${label}</span></div>`;
    }
    s += '</div>';
    return s;
  }

  // ---------- page ----------

  function render(container, ctx) {
    const r = compute(ctx.data, ctx.y, ctx.m, ctx.last, ctx);
    const prevFull = ctx.prev ? compute(ctx.prev.data, ctx.prev.y, ctx.prev.m, new Date(ctx.prev.y, ctx.prev.m, 0).getDate() - 1, ctx) : null;
    const prevPace = ctx.prev ? compute(ctx.prev.data, ctx.prev.y, ctx.prev.m, Math.min(ctx.last, new Date(ctx.prev.y, ctx.prev.m, 0).getDate() - 1), ctx) : null;
    const prevName = ctx.prev ? MONTHS[ctx.prev.m - 1] : '';
    const isCurrent = ctx.isCurrentMonth;
    const monthName = MONTHS[ctx.m - 1];

    if (r.last < 0) {
      container.innerHTML = `<p class="rv-empty rv-pad">${monthName} hasn't started yet. Come back once there's something to look at.</p>`;
      return;
    }
    if (!r.tasks.length && !r.sleepLogged && !r.stepsLogged) {
      container.innerHTML = '<p class="rv-empty rv-pad">Add a task or log some sleep, steps or mood, and your month will start to show up here.</p>';
      return;
    }

    const soFar = isCurrent ? 'so far this month' : `in ${monthName}`;
    const paceLabel = isCurrent ? `${prevName} at this point` : prevName;
    const bestTask = r.tasks.slice().sort((a, b) => b.best - a.best)[0];
    const ach = achievements(r, prevPace, isCurrent);
    const nxt = isCurrent ? nextUp(r) : [];

    let h = '<div class="rv-grid">';

    // Hero
    h += '<section class="rv-card rv-hero">';
    h += ring(r.completion);
    h += '<div class="rv-hero-text">';
    h += `<div class="rv-hero-num">${r.completion == null ? '-' : pct(r.completion)}</div>`;
    h += `<div class="rv-hero-sub">of due tasks done ${soFar}</div>`;
    if (prevPace) h += delta(r.completion, prevPace.completion, 'pts', paceLabel);
    h += '</div></section>';

    // Stat tiles
    h += '<section class="rv-tiles" aria-label="Headlines">';
    h += `<div class="rv-card rv-tile"><span class="rv-tlabel">Things done</span><span class="rv-tvalue">${fmt(r.ticks)}</span>${prevPace ? delta(r.ticks, prevPace.ticks, '', prevName.slice(0, 3)) : ''}</div>`;
    h += `<div class="rv-card rv-tile"><span class="rv-tlabel">Perfect days</span><span class="rv-tvalue">${r.perfectDays}</span><span class="rv-tnote">${r.perfectBest >= 2 ? `best run ${r.perfectBest} in a row` : 'every due task done'}</span></div>`;
    h += `<div class="rv-card rv-tile"><span class="rv-tlabel">Best chain</span><span class="rv-tvalue">${bestTask ? bestTask.best : 0}</span><span class="rv-tnote">${bestTask && bestTask.best ? esc(bestTask.name) : 'days in a row'}</span></div>`;
    h += `<div class="rv-card rv-tile"><span class="rv-tlabel">${r.sleepTarget}h+ nights</span><span class="rv-tvalue">${r.sleepHit}</span><span class="rv-tnote">${r.sleepLogged ? `of ${r.sleepLogged} logged, avg ${r.sleepAvg.toFixed(1)}h` : 'none logged'}</span></div>`;
    h += `<div class="rv-card rv-tile"><span class="rv-tlabel">${fmt(r.stepsTarget / 1000)}k+ step days</span><span class="rv-tvalue">${r.stepsHit}</span><span class="rv-tnote">${r.stepsLogged ? `of ${r.stepsLogged} logged, avg ${(r.stepsAvg / 1000).toFixed(1)}k` : 'none logged'}</span></div>`;
    h += '</section>';

    // Build up
    h += '<section class="rv-card rv-wide"><div class="rv-head"><h3>Building up</h3>';
    h += `<div class="rv-keys"><span><i class="k-this"></i>${esc(monthName)}</span>${prevFull ? `<span><i class="k-prev"></i>${esc(prevName)}</span>` : ''}</div></div>`;
    h += '<p class="rv-sub">Every tick adds up. The line climbs with each thing you complete.</p>';
    h += '<div class="rv-cumwrap" data-cum></div></section>';

    // Calendar
    h += `<section class="rv-card"><div class="rv-head"><h3>Your days</h3></div><p class="rv-sub">${plural(r.perfectDays, 'perfect day')} ${soFar}</p>${calendar(r)}</section>`;

    // Tasks
    h += `<section class="rv-card rv-wide"><div class="rv-head"><h3>Tasks</h3></div><p class="rv-sub">Due days done ${soFar}</p>${taskBars(r)}</section>`;

    // Weeks
    h += `<section class="rv-card"><div class="rv-head"><h3>Week by week</h3></div><p class="rv-sub">Share of due tasks done each week</p>${weekBars(r)}</section>`;

    // Achievements and next up
    h += '<section class="rv-card rv-wide"><div class="rv-head"><h3>Achievements</h3></div>';
    if (ach.length) {
      h += '<ul class="rv-ach">';
      for (const a of ach) h += `<li><span class="rv-medal" aria-hidden="true">${a.icon ? ICONS[a.icon] : esc(a.big)}</span><span>${esc(a.text)}</span></li>`;
      h += '</ul>';
    } else {
      h += '<p class="rv-empty">Your first ones are close: a 3-day chain, a perfect day, or 25 things done.</p>';
    }
    if (r.moodInsight && Math.abs(r.moodInsight.good - r.moodInsight.short) >= 0.3) {
      const mi = r.moodInsight;
      const word = (v) => MOODS[Math.max(0, Math.min(4, Math.round(v) - 1))];
      const lead = mi.good > mi.short ? 'Sleep pays off.' : 'Worth a look:';
      if (word(mi.good) !== word(mi.short)) {
        h += `<p class="rv-insight">${lead} After ${r.sleepTarget}h+ nights your mood averaged <b>${word(mi.good)}</b> (${mi.good.toFixed(1)}), and <b>${word(mi.short)}</b> (${mi.short.toFixed(1)}) after shorter ones.</p>`;
      } else {
        h += `<p class="rv-insight">${lead} Your mood averaged <b>${mi.good.toFixed(1)}</b> out of 5 after ${r.sleepTarget}h+ nights and <b>${mi.short.toFixed(1)}</b> after shorter ones.</p>`;
      }
    }
    h += '</section>';

    if (nxt.length) {
      h += '<section class="rv-card"><div class="rv-head"><h3>Next up</h3></div><ul class="rv-next">';
      for (const x of nxt) {
        h += `<li><span>${esc(x.text)}</span><span class="rv-bar" aria-hidden="true"><i style="width:${((x.done / x.of) * 100).toFixed(1)}%"></i></span></li>`;
      }
      h += '</ul></section>';
    }

    h += '</div>';
    container.innerHTML = h;

    // The build-up chart is drawn to the width it actually has
    const wrap = container.querySelector('[data-cum]');
    const drawCum = () => {
      const { svg, geom } = buildUp(r, prevFull, wrap.clientWidth);
      wrap.innerHTML = svg;
      wrap._geom = geom;
      wrap._r = r;
      wrap._prev = prevFull;
    };
    drawCum();
    if (container._ro) container._ro.disconnect();
    if ('ResizeObserver' in window) {
      let lastW = wrap.clientWidth;
      container._ro = new ResizeObserver(() => {
        if (Math.abs(wrap.clientWidth - lastW) > 4) { lastW = wrap.clientWidth; drawCum(); }
      });
      container._ro.observe(wrap);
    }
    bindTips(container);
  }

  // One tooltip for the whole review. Text is set with textContent.
  function bindTips(container) {
    if (container._tipsBound) return;
    container._tipsBound = true;
    let tip = document.getElementById('rvTip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'rvTip';
      tip.className = 'rv-tip';
      tip.setAttribute('role', 'tooltip');
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    const show = (lines, cx, cy) => {
      tip.textContent = '';
      lines.forEach((ln, k) => {
        const el = document.createElement(k === 0 ? 'b' : 'span');
        el.textContent = ln;
        tip.appendChild(el);
      });
      tip.hidden = false;
      const w = tip.offsetWidth;
      const hgt = tip.offsetHeight;
      let left = cx + 14;
      if (left + w > window.innerWidth - 8) left = cx - w - 14;
      let top = cy - hgt - 12;
      if (top < 8) top = cy + 18;
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${top}px`;
    };
    const hide = () => { tip.hidden = true; const c = container.querySelector('.rv-cross'); if (c) c.setAttribute('visibility', 'hidden'); };

    container.addEventListener('pointermove', (e) => {
      const svg = e.target.closest('svg[data-chart="cum"]');
      if (svg) {
        const wrap = svg.parentElement;
        const g = wrap._geom;
        const r = wrap._r;
        const prev = wrap._prev;
        const box = svg.getBoundingClientRect();
        const sx = ((e.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
        const i = Math.max(0, Math.min(g.n - 1, Math.round(((sx - g.L) / g.pw) * (g.n - 1))));
        const cross = svg.querySelector('.rv-cross');
        const cxp = g.L + (g.n > 1 ? (i / (g.n - 1)) * g.pw : 0);
        cross.setAttribute('x1', cxp.toFixed(1));
        cross.setAttribute('x2', cxp.toFixed(1));
        cross.setAttribute('visibility', 'visible');
        const lines = [`${i + 1} ${MONTHS[r.m - 1]}`];
        lines.push(i < r.cum.length ? `${fmt(r.cum[i])} done this month` : 'still to come');
        if (prev && i < prev.cum.length) lines.push(`${fmt(prev.cum[i])} by now last month`);
        show(lines, e.clientX, e.clientY);
        return;
      }
      const t = e.target.closest('[data-tip]');
      if (t && container.contains(t)) show([t.dataset.tip], e.clientX, e.clientY);
      else hide();
    });
    container.addEventListener('pointerleave', hide);
    container.addEventListener('focusin', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) return;
      const b = t.getBoundingClientRect();
      show([t.dataset.tip], b.left + b.width / 2, b.top);
    });
    container.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, { passive: true });
  }

  window.TrackerReview = { render, compute };
})();
