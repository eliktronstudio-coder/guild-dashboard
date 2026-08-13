(function(){
  "use strict";

  // ---------------------------------------------------------------------
  // Auth bootstrap
  // ---------------------------------------------------------------------
  var ME = null;

  function boot(){
    fetch('/api/me').then(function(r){
      if (r.status === 401){ location.href = '/login.html'; return null; }
      return r.json();
    }).then(function(me){
      if (!me) return;
      ME = me;
      document.getElementById('whoami').textContent = me.username;
      var badge = document.getElementById('roleBadge');
      badge.textContent = me.role === 'officer' ? 'Офицер' : 'Участник';
      if (me.role !== 'officer'){
        document.getElementById('navTreasury').style.display = 'none';
      } else {
        document.getElementById('adminLink').style.display = 'inline';
      }
      loadAll();
    }).catch(function(){ location.href = '/login.html'; });
  }

  document.getElementById('logoutLink').addEventListener('click', function(e){
    e.preventDefault();
    fetch('/api/logout', {method:'POST'}).then(function(){ location.href = '/login.html'; });
  });

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------
  function num(v){
    if (v === undefined || v === null) return 0;
    var n = parseFloat(String(v).replace(/[^\d.\-]/g,''));
    return isNaN(n) ? 0 : n;
  }
  function fmtGold(n){
    var sign = n < 0 ? '-' : '';
    n = Math.abs(Math.round(n));
    return sign + n.toLocaleString('ru-RU') + ' зол.';
  }
  function fmtCompact(n){
    var sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n >= 1000000) return sign + (n/1000000).toFixed(1).replace(/\.0$/,'') + 'M';
    if (n >= 1000) return sign + (n/1000).toFixed(1).replace(/\.0$/,'') + 'K';
    return sign + Math.round(n);
  }
  function parseDate(v){
    if (!v) return null;
    var s = String(v).trim().replace(' ', 'T');
    var d = new Date(s);
    if (isNaN(d.getTime())){
      var m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (m){ d = new Date(+m[3], +m[2]-1, +m[1]); }
    }
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(d){
    if (!d) return '—';
    return d.toLocaleDateString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function escapeText(el, text){ el.textContent = text; }
  function el(tag, attrs, children){
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs){
      if (k === 'class') e.className = attrs[k];
      else if (k === 'style') e.setAttribute('style', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (children||[]).forEach(function(c){
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    });
    return e;
  }

  // ---------------------------------------------------------------------
  // Theme toggle
  // ---------------------------------------------------------------------
  var themeBtn = document.getElementById('themeToggle');
  var root = document.documentElement;
  var currentTheme = null;
  themeBtn.addEventListener('click', function(){
    currentTheme = (currentTheme === 'dark') ? 'light' : 'dark';
    root.setAttribute('data-theme', currentTheme);
    renderAllCharts();
  });

  // ---------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------
  var titles = { overview:'Обзор', treasury:'Казна', members:'Участники', auction:'Аукцион', raids:'Калькулятор рейдов' };
  document.querySelectorAll('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      var v = btn.getAttribute('data-view');
      document.querySelectorAll('.view').forEach(function(s){ s.classList.remove('active'); });
      document.getElementById('view-'+v).classList.add('active');
      document.getElementById('viewTitle').textContent = titles[v];
      renderAllCharts();
    });
  });

  // ---------------------------------------------------------------------
  // Status banner
  // ---------------------------------------------------------------------
  var statusArea = document.getElementById('statusArea');
  function showLoading(){
    statusArea.innerHTML = '';
    statusArea.appendChild(el('div', {class:'status-banner loading'}, ['Загружаю данные из Google Таблицы…']));
  }
  function showError(message){
    statusArea.innerHTML = '';
    statusArea.appendChild(el('div', {class:'status-banner error'}, [message]));
  }
  function clearStatus(){ statusArea.innerHTML = ''; }

  // ---------------------------------------------------------------------
  // Data fetch (server-side proxy — no CORS/sandbox issues)
  // ---------------------------------------------------------------------
  var DATA = { Overview:[], Members:[], Treasury:[], Auction:[], Raids:[] };
  var IS_OFFICER = false;

  function loadAll(force){
    showLoading();
    return fetch('/api/data' + (force ? '?force=1' : '')).then(function(r){
      if (r.status === 401){ location.href = '/login.html'; return null; }
      return r.json().then(function(d){ return {ok:r.ok, d:d}; });
    }).then(function(res){
      if (!res) return;
      if (!res.ok){
        showError((res.d && res.d.message) || 'Не удалось загрузить данные из таблицы.');
        return;
      }
      DATA = res.d.data;
      IS_OFFICER = res.d.isOfficer;
      document.getElementById('sheetLink').href = 'https://docs.google.com/spreadsheets/d/' + res.d.sheetId + '/edit';
      clearStatus();
      document.getElementById('lastUpdated').textContent = 'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');
      render();
    }).catch(function(e){
      console.error(e);
      showError('Ошибка сети при загрузке данных.');
    });
  }

  document.getElementById('refreshBtn').addEventListener('click', function(){ loadAll(true); });

  // ---------------------------------------------------------------------
  // SVG chart helpers (line + bar)
  // ---------------------------------------------------------------------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs){
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function cssVar(name){
    return getComputedStyle(document.querySelector('.app')).getPropertyValue(name).trim();
  }

  var chartRegistry = {};

  function renderLineChart(containerId, points){
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!points.length){ container.appendChild(el('div',{class:'empty-state'},['Нет данных'])); return; }

    var W = container.clientWidth || 560, H = 220;
    var padL = 54, padR = 16, padT = 14, padB = 28;
    var innerW = W - padL - padR, innerH = H - padT - padB;

    var xs = points.map(function(p){ return p.x.getTime(); });
    var ys = points.map(function(p){ return p.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min(0, Math.min.apply(null, ys)), maxY = Math.max.apply(null, ys) * 1.15 || 1;
    if (maxX === minX) maxX = minX + 1;
    if (maxY === minY) maxY = minY + 1;

    function xPix(t){ return padL + (t - minX) / (maxX - minX) * innerW; }
    function yPix(v){ return padT + innerH - (v - minY) / (maxY - minY) * innerH; }

    var svg = svgEl('svg', {class:'chart', viewBox:'0 0 '+W+' '+H, width:'100%', height:H});

    var steps = 4;
    for (var s = 0; s <= steps; s++){
      var val = minY + (maxY - minY) * s / steps;
      var y = yPix(val);
      svg.appendChild(svgEl('line', {x1:padL, x2:W-padR, y1:y, y2:y, stroke:cssVar('--grid'), 'stroke-width':1}));
      var lbl = svgEl('text', {x:padL-8, y:y+4, 'text-anchor':'end', 'font-size':11, fill:cssVar('--text-muted')});
      lbl.textContent = fmtCompact(val);
      svg.appendChild(lbl);
    }
    svg.appendChild(svgEl('line', {x1:padL, x2:W-padR, y1:yPix(0), y2:yPix(0), stroke:cssVar('--baseline'), 'stroke-width':1}));

    var areaPts = points.map(function(p){ return xPix(p.x.getTime())+','+yPix(p.y); }).join(' ');
    var areaPath = 'M' + xPix(points[0].x.getTime()) + ',' + yPix(0) + ' L' + areaPts + ' L' + xPix(points[points.length-1].x.getTime()) + ',' + yPix(0) + ' Z';
    svg.appendChild(svgEl('path', {d:areaPath, fill:cssVar('--series-1-wash'), stroke:'none'}));

    var linePts = points.map(function(p){ return xPix(p.x.getTime())+','+yPix(p.y); }).join(' L');
    svg.appendChild(svgEl('path', {d:'M'+linePts, fill:'none', stroke:cssVar('--series-1'), 'stroke-width':2, 'stroke-linejoin':'round', 'stroke-linecap':'round'}));

    [0, Math.floor(points.length/2), points.length-1].forEach(function(idx){
      var p = points[idx];
      var t = svgEl('text', {x:xPix(p.x.getTime()), y:H-8, 'text-anchor':'middle', 'font-size':11, fill:cssVar('--text-muted')});
      t.textContent = fmtDate(p.x);
      svg.appendChild(t);
    });

    var last = points[points.length-1];
    var ring = svgEl('circle', {cx:xPix(last.x.getTime()), cy:yPix(last.y), r:5, fill:cssVar('--series-1'), stroke:cssVar('--surface-1'), 'stroke-width':2});
    svg.appendChild(ring);

    var crosshair = svgEl('line', {x1:0,x2:0,y1:padT,y2:H-padB, stroke:cssVar('--baseline'), 'stroke-width':1, opacity:0});
    svg.appendChild(crosshair);
    var hoverDot = svgEl('circle', {r:5, fill:cssVar('--series-1'), stroke:cssVar('--surface-1'), 'stroke-width':2, opacity:0});
    svg.appendChild(hoverDot);

    var wrap = el('div', {style:'position:relative;'});
    wrap.appendChild(svg);
    var tooltip = el('div', {class:'chart-tooltip'});
    wrap.appendChild(tooltip);
    container.appendChild(wrap);

    var hitRect = svgEl('rect', {x:padL, y:padT, width:innerW, height:innerH, fill:'transparent'});
    svg.appendChild(hitRect);

    function handleMove(evt){
      var rect = svg.getBoundingClientRect();
      var scale = W / rect.width;
      var mx = (evt.clientX - rect.left) * scale;
      var targetT = minX + (mx - padL) / innerW * (maxX - minX);
      var nearest = points[0], nearestDist = Infinity;
      points.forEach(function(p){
        var d = Math.abs(p.x.getTime() - targetT);
        if (d < nearestDist){ nearestDist = d; nearest = p; }
      });
      var px = xPix(nearest.x.getTime()), py = yPix(nearest.y);
      crosshair.setAttribute('x1', px); crosshair.setAttribute('x2', px); crosshair.setAttribute('opacity', 1);
      hoverDot.setAttribute('cx', px); hoverDot.setAttribute('cy', py); hoverDot.setAttribute('opacity', 1);
      tooltip.style.opacity = 1;
      tooltip.style.left = (px / W * 100) + '%';
      tooltip.style.top = (py / H * 100) + '%';
      tooltip.innerHTML = '';
      tooltip.appendChild(el('div', {class:'tt-value'}, [fmtGold(nearest.y)]));
      tooltip.appendChild(el('div', {class:'tt-label'}, [fmtDate(nearest.x)]));
    }
    hitRect.addEventListener('pointermove', handleMove);
    hitRect.addEventListener('pointerleave', function(){
      crosshair.setAttribute('opacity', 0); hoverDot.setAttribute('opacity', 0); tooltip.style.opacity = 0;
    });
  }

  function renderTreasuryTable(containerId, points){
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!points.length){ container.appendChild(el('div',{class:'empty-state'},['Нет данных'])); return; }
    var table = el('table');
    var thead = el('thead', null, [el('tr', null, [el('th',null,['Дата']), el('th',null,['Баланс'])])]);
    var tbody = el('tbody');
    points.forEach(function(p){
      tbody.appendChild(el('tr', null, [el('td',null,[fmtDate(p.x)]), el('td',null,[fmtGold(p.y)])]));
    });
    table.appendChild(thead); table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderBarChart(containerId, items, opts){
    opts = opts || {};
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!items.length){ container.appendChild(el('div',{class:'empty-state'},['Нет данных'])); return; }

    var W = container.clientWidth || 560;
    var rowH = 34, padTop = 8, padBottom = 8, padL = 8, padR = 54;
    var H = items.length * rowH + padTop + padBottom;
    var maxV = Math.max.apply(null, items.map(function(i){ return i.value; })) || 1;
    var labelW = 130;
    var barAreaX = padL + labelW;
    var barAreaW = W - barAreaX - padR;

    var svg = svgEl('svg', {class:'chart', viewBox:'0 0 '+W+' '+H, width:'100%', height:H});

    items.forEach(function(item, idx){
      var y = padTop + idx * rowH;
      var barH = 18;
      var barY = y + (rowH - barH)/2;
      var w = Math.max(2, item.value / maxV * barAreaW);

      var label = svgEl('text', {x:padL, y: y + rowH/2 + 4, 'font-size':12.5, fill:cssVar('--text-secondary')});
      label.textContent = item.label.length > 16 ? item.label.slice(0,15)+'…' : item.label;
      svg.appendChild(label);

      var track = svgEl('rect', {x:barAreaX, y:barY, width:barAreaW, height:barH, rx:4, fill:cssVar('--grid')});
      svg.appendChild(track);

      var bar = svgEl('rect', {class:'bar', x:barAreaX, y:barY, width:w, height:barH, rx:4, fill:cssVar('--series-1')});
      svg.appendChild(bar);

      var val = svgEl('text', {x:barAreaX + w + 8, y: y + rowH/2 + 4, 'font-size':12, fill:cssVar('--text-primary'), 'font-weight':600});
      val.textContent = opts.suffix ? (item.value + opts.suffix) : fmtCompact(item.value);
      svg.appendChild(val);

      var hit = svgEl('rect', {class:'bar-hit', x:0, y:y, width:W, height:rowH, fill:'transparent'});
      svg.appendChild(hit);

      var title = svgEl('title', {});
      title.textContent = item.label + ': ' + (opts.suffix ? (item.value+opts.suffix) : fmtGold(item.value));
      hit.appendChild(title);
    });

    container.appendChild(svg);
  }

  function renderBarTable(containerId, items, opts){
    opts = opts || {};
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!items.length){ container.appendChild(el('div',{class:'empty-state'},['Нет данных'])); return; }
    var table = el('table');
    var thead = el('thead', null, [el('tr', null, [el('th',null,['Участник']), el('th',null,['Значение'])])]);
    var tbody = el('tbody');
    items.forEach(function(i){
      tbody.appendChild(el('tr', null, [el('td',null,[i.label]), el('td',null,[opts.suffix ? (i.value+opts.suffix) : fmtGold(i.value)])]));
    });
    table.appendChild(thead); table.appendChild(tbody);
    container.appendChild(table);
  }

  document.querySelectorAll('.table-toggle').forEach(function(btn){
    btn.addEventListener('click', function(){
      var key = btn.getAttribute('data-chart');
      var reg = chartRegistry[key];
      if (!reg) return;
      reg.showTable = !reg.showTable;
      btn.textContent = reg.showTable ? 'График' : 'Таблица';
      reg.render();
    });
  });

  // ---------------------------------------------------------------------
  // Derived data builders
  // ---------------------------------------------------------------------
  function overviewMap(){
    var map = {};
    DATA.Overview.forEach(function(r){ map[r['Параметр']] = r['Значение']; });
    return map;
  }

  function treasuryPoints(){
    var rows = DATA.Treasury.slice().map(function(r){
      return { date: parseDate(r['Дата']), amount: num(r['Сумма (золото)']), raw:r };
    }).filter(function(r){ return r.date; });
    rows.sort(function(a,b){ return a.date - b.date; });
    var running = 0;
    return rows.map(function(r){ running += r.amount; return {x:r.date, y:running, amount:r.amount, raw:r.raw}; });
  }

  function activeMembers(){
    return DATA.Members.filter(function(m){ return (m['Статус']||'').toLowerCase().indexOf('актив') === 0; });
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  function renderOverview(){
    var pts = treasuryPoints();
    if (IS_OFFICER){
      var balance = pts.length ? pts[pts.length-1].y : 0;
      document.getElementById('stat-treasury').textContent = fmtGold(balance);
      if (pts.length >= 2){
        var prev = pts[pts.length-2].y;
        var diff = balance - prev;
        var dEl = document.getElementById('stat-treasury-delta');
        dEl.textContent = (diff >= 0 ? '+' : '') + fmtGold(diff) + ' с прошлой записи';
        dEl.className = 'delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral');
      }
    } else {
      document.getElementById('stat-treasury').textContent = '🔒';
      document.getElementById('stat-treasury-delta').textContent = 'видно офицерам';
    }

    var active = activeMembers();
    document.getElementById('stat-active-members').textContent = active.length;
    document.getElementById('stat-active-members-sub').textContent = 'из ' + DATA.Members.length + ' всего';

    var avgAtt = active.length ? active.reduce(function(s,m){ return s+num(m['Посещаемость 7д (%)']); },0) / active.length : 0;
    document.getElementById('stat-attendance').textContent = avgAtt.toFixed(0) + '%';

    var ov = overviewMap();
    var lastPayout = parseDate(ov['Дата последней выплаты']);
    var cycle = num(ov['Цикл выплат (дней)']) || 7;
    var payoutEl = document.getElementById('stat-payout');
    var payoutSub = document.getElementById('stat-payout-sub');
    if (lastPayout){
      var next = new Date(lastPayout.getTime() + cycle*86400000);
      var daysLeft = Math.ceil((next - new Date()) / 86400000);
      payoutEl.textContent = daysLeft > 0 ? (daysLeft + ' дн.') : 'Пора выплатить';
      payoutSub.textContent = 'выплата ' + fmtDate(next);
    } else {
      payoutEl.textContent = '—';
      payoutSub.textContent = 'заполните "Обзор" в таблице';
    }

    if (IS_OFFICER){
      chartRegistry['treasury-dynamics'] = { showTable:false, render: function(){
        if (this.showTable) renderTreasuryTable('chart-treasury-dynamics', pts);
        else renderLineChart('chart-treasury-dynamics', pts);
      }};
      chartRegistry['treasury-dynamics'].render();
    } else {
      var c = document.getElementById('chart-treasury-dynamics');
      c.innerHTML = '';
      c.appendChild(el('div', {class:'empty-state'}, ['🔒 Видно только офицерам']));
    }

    var topAtt = active.slice().sort(function(a,b){ return num(b['Посещаемость 7д (%)']) - num(a['Посещаемость 7д (%)']); })
      .slice(0,5).map(function(m){ return {label:m['Имя'], value:num(m['Посещаемость 7д (%)'])}; });
    chartRegistry['top-attendance'] = { showTable:false, render: function(){
      if (this.showTable) renderBarTable('chart-top-attendance', topAtt, {suffix:'%'});
      else renderBarChart('chart-top-attendance', topAtt, {suffix:'%'});
    }};
    chartRegistry['top-attendance'].render();

    var feedItems = [];
    if (IS_OFFICER){
      DATA.Treasury.forEach(function(r){
        var d = parseDate(r['Дата']);
        if (d) feedItems.push({date:d, text:(r['Категория']||r['Тип']||'Операция') + ' — ' + (r['Описание']||''), amount:num(r['Сумма (золото)'])});
      });
    }
    DATA.Raids.forEach(function(r){
      var d = parseDate(r['Дата']);
      if (d) feedItems.push({date:d, text:'Рейд «' + (r['Название рейда']||'') + '»', amount:null});
    });
    feedItems.sort(function(a,b){ return b.date - a.date; });
    var feed = document.getElementById('activityFeed');
    feed.innerHTML = '';
    if (!feedItems.length){ feed.appendChild(el('div',{class:'empty-state'},['Нет данных'])); }
    feedItems.slice(0,8).forEach(function(f){
      var row = el('div', {class:'feed-item'});
      row.appendChild(el('div', null, [el('div',{class:'who'},[f.text]), el('div',{class:'when'},[fmtDate(f.date)])]));
      if (f.amount !== null){
        row.appendChild(el('div', {class:'feed-amount ' + (f.amount>=0?'up':'down')}, [(f.amount>=0?'+':'') + fmtGold(f.amount)]));
      }
      feed.appendChild(row);
    });
  }

  function renderTreasury(){
    var locked = document.getElementById('treasuryLocked');
    var content = document.getElementById('treasuryContent');
    if (!IS_OFFICER){
      locked.style.display = 'flex';
      content.style.display = 'none';
      return;
    }
    locked.style.display = 'none';
    content.style.display = 'block';

    var pts = treasuryPoints();
    var balance = pts.length ? pts[pts.length-1].y : 0;
    var income = DATA.Treasury.reduce(function(s,r){ var n=num(r['Сумма (золото)']); return s + (n>0?n:0); },0);
    var expense = DATA.Treasury.reduce(function(s,r){ var n=num(r['Сумма (золото)']); return s + (n<0?n:0); },0);
    document.getElementById('tr-balance').textContent = fmtGold(balance);
    document.getElementById('tr-income').textContent = fmtGold(income);
    document.getElementById('tr-expense').textContent = fmtGold(expense);
    document.getElementById('tr-count').textContent = DATA.Treasury.length;

    chartRegistry['treasury-full'] = { showTable:false, render: function(){
      if (this.showTable) renderTreasuryTable('chart-treasury-full', pts);
      else renderLineChart('chart-treasury-full', pts);
    }};
    chartRegistry['treasury-full'].render();

    var body = document.getElementById('treasuryTableBody');
    body.innerHTML = '';
    DATA.Treasury.slice().sort(function(a,b){ return (parseDate(b['Дата'])||0) - (parseDate(a['Дата'])||0); }).forEach(function(r){
      var amt = num(r['Сумма (золото)']);
      var tr = el('tr', null, [
        el('td', null, [r['Дата']||'—']),
        el('td', null, [r['Тип']||'—']),
        el('td', null, [r['Категория']||'—']),
        el('td', {style: 'color:' + (amt>=0?'var(--good)':'var(--critical)') + ';font-weight:600;'}, [(amt>=0?'+':'')+fmtGold(amt)]),
        el('td', null, [r['Описание']||'—']),
      ]);
      body.appendChild(tr);
    });
  }

  function renderMembers(){
    var body = document.getElementById('membersTableBody');
    body.innerHTML = '';
    DATA.Members.forEach(function(m){
      var statusOk = (m['Статус']||'').toLowerCase().indexOf('актив') === 0;
      var badge = el('span', {class:'badge ' + (statusOk?'good':'critical')}, [el('span',{class:'dot'}), m['Статус']||'—']);
      var tr = el('tr', null, [
        el('td', null, [m['Имя']||'—']),
        el('td', null, [m['Класс']||'—']),
        el('td', null, [m['Роль']||'—']),
        el('td', null, [badge]),
        el('td', null, [(m['Посещаемость 7д (%)']||'0')+'%']),
        el('td', null, [(m['Посещаемость 30д (%)']||'0')+'%']),
        el('td', null, [m['Достижения']||'0']),
      ]);
      body.appendChild(tr);
    });

    var top30 = DATA.Members.slice().sort(function(a,b){ return num(b['Посещаемость 30д (%)']) - num(a['Посещаемость 30д (%)']); }).slice(0,5);
    var body30 = document.getElementById('topAttendance30Body');
    body30.innerHTML = '';
    top30.forEach(function(m, idx){
      body30.appendChild(el('tr', null, [el('td',null,[String(idx+1)]), el('td',null,[m['Имя']||'—']), el('td',null,[(m['Посещаемость 30д (%)']||'0')+'%'])]));
    });

    var topAch = DATA.Members.slice().sort(function(a,b){ return num(b['Достижения']) - num(a['Достижения']); }).slice(0,5);
    var bodyAch = document.getElementById('topAchievementsBody');
    bodyAch.innerHTML = '';
    topAch.forEach(function(m, idx){
      bodyAch.appendChild(el('tr', null, [el('td',null,[String(idx+1)]), el('td',null,[m['Имя']||'—']), el('td',null,[m['Достижения']||'0'])]));
    });
  }

  function renderAuction(){
    var active = [], other = [];
    DATA.Auction.forEach(function(a){
      ((a['Статус']||'').toLowerCase().indexOf('актив')===0 ? active : other).push(a);
    });
    function lotCard(a){
      var endDate = parseDate(a['Окончание']);
      var meta = 'Стартовая цена: ' + fmtGold(num(a['Стартовая цена']));
      if (endDate) meta += ' · до ' + a['Окончание'];
      var statusOk = (a['Статус']||'').toLowerCase().indexOf('актив')===0;
      var card = el('div', {class:'lot-card'}, [
        el('div', null, [
          el('div', {class:'lot-name'}, [a['Предмет']||'—']),
          el('div', {class:'lot-meta'}, [meta + (a['Лидер'] && a['Лидер'] !== '-' ? ' · лидер: ' + a['Лидер'] : '')]),
        ]),
        el('div', {class:'lot-price'}, [
          el('div', {class:'amount'}, [fmtGold(num(a['Текущая ставка']))]),
          el('div', {class:'label'}, ['текущая ставка']),
        ]),
        el('span', {class:'badge ' + (statusOk?'good':'critical'), style:'margin-left:8px;'}, [el('span',{class:'dot'}), a['Статус']||'—']),
      ]);
      return card;
    }
    var activeEl = document.getElementById('activeLots');
    activeEl.innerHTML = '';
    if (!active.length) activeEl.appendChild(el('div',{class:'empty-state'},['Нет активных лотов']));
    active.forEach(function(a){ activeEl.appendChild(lotCard(a)); });

    var otherEl = document.getElementById('otherLots');
    otherEl.innerHTML = '';
    if (!other.length) otherEl.appendChild(el('div',{class:'empty-state'},['Нет завершённых лотов']));
    other.forEach(function(a){ otherEl.appendChild(lotCard(a)); });
  }

  function renderRaids(){
    var select = document.getElementById('calcRaidSelect');
    select.innerHTML = '<option value="">— вручную —</option>';
    DATA.Raids.forEach(function(r, idx){
      var opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = (r['Название рейда']||('Рейд '+(idx+1))) + ' (' + (r['Дата']||'') + ')';
      select.appendChild(opt);
    });

    var body = document.getElementById('raidsTableBody');
    body.innerHTML = '';
    DATA.Raids.forEach(function(r){
      var loot = num(r['Общая ценность лута (золото)']);
      var participants = num(r['Участников']) || 1;
      var perPerson = loot / participants;
      body.appendChild(el('tr', null, [
        el('td', null, [r['Дата']||'—']),
        el('td', null, [r['Название рейда']||'—']),
        el('td', null, [fmtGold(loot)]),
        el('td', null, [String(participants)]),
        el('td', null, [fmtGold(perPerson)]),
      ]));
    });

    function recompute(){
      var loot = num(document.getElementById('calcLoot').value);
      var participants = Math.max(1, num(document.getElementById('calcParticipants').value));
      var cutPct = Math.min(100, Math.max(0, num(document.getElementById('calcGuildCut').value)));
      var guildShare = loot * cutPct / 100;
      var toDistribute = loot - guildShare;
      var perPerson = toDistribute / participants;
      document.getElementById('calcPerPerson').textContent = fmtGold(perPerson);
      document.getElementById('calcGuildShare').textContent = fmtGold(guildShare);
      document.getElementById('calcTotalOut').textContent = fmtGold(toDistribute);
    }
    select.onchange = function(){
      if (select.value === '') return;
      var r = DATA.Raids[+select.value];
      document.getElementById('calcLoot').value = num(r['Общая ценность лута (золото)']);
      document.getElementById('calcParticipants').value = num(r['Участников']) || 1;
      recompute();
    };
    ['calcLoot','calcParticipants','calcGuildCut'].forEach(function(id){
      document.getElementById(id).addEventListener('input', recompute);
    });
    if (DATA.Raids.length){ select.value = '0'; select.onchange(); } else { recompute(); }
  }

  function render(){
    var ov = overviewMap();
    escapeText(document.getElementById('guildName'), ov['Название гильдии'] || 'Гильдия');
    escapeText(document.getElementById('guildServer'), ov['Сервер'] ? ('Сервер: ' + ov['Сервер']) : '');
    renderOverview();
    renderTreasury();
    renderMembers();
    renderAuction();
    renderRaids();
  }

  function renderAllCharts(){
    Object.keys(chartRegistry).forEach(function(k){ chartRegistry[k].render(); });
  }

  window.addEventListener('resize', function(){
    clearTimeout(window.__rt);
    window.__rt = setTimeout(renderAllCharts, 150);
  });

  boot();
})();
