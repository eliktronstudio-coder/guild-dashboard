(function(){
  "use strict";

  function el(tag, attrs, children){
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs){
      if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (children||[]).forEach(function(c){
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    });
    return e;
  }

  function fmtDate(iso){
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric'});
  }

  function loadUsers(){
    fetch('/api/users').then(function(r){ return r.json(); }).then(function(d){
      var body = document.getElementById('usersBody');
      body.innerHTML = '';
      (d.users || []).forEach(function(u){
        var statusBadge = el('span', {class:'badge ' + (u.active ? 'good' : 'critical')}, [el('span',{class:'dot'}), u.active ? 'Активен' : 'Отключён']);
        var roleSelect = el('select');
        ['member','officer'].forEach(function(r){
          var opt = document.createElement('option');
          opt.value = r; opt.textContent = r === 'officer' ? 'Офицер' : 'Участник';
          if (r === u.role) opt.selected = true;
          roleSelect.appendChild(opt);
        });
        roleSelect.addEventListener('change', function(){
          patchUser(u.id, {role: roleSelect.value});
        });

        var toggleBtn = el('button', {class:'btn'}, [u.active ? 'Отключить' : 'Включить']);
        toggleBtn.addEventListener('click', function(){
          patchUser(u.id, {active: !u.active});
        });

        var resetBtn = el('button', {class:'btn', style:'margin-left:6px;'}, ['Сбросить пароль']);
        resetBtn.addEventListener('click', function(){
          var pw = prompt('Новый временный пароль для ' + u.username + ' (мин. 6 символов):');
          if (!pw) return;
          patchUser(u.id, {password: pw});
        });

        var actionsCell = el('td', null, [toggleBtn, resetBtn]);
        var tr = el('tr', null, [
          el('td', null, [u.username]),
          el('td', null, [roleSelect]),
          el('td', null, [statusBadge]),
          el('td', null, [fmtDate(u.created_at)]),
          actionsCell,
        ]);
        body.appendChild(tr);
      });
    });
  }

  function patchUser(id, payload){
    fetch('/api/users/' + id, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    }).then(function(r){
      if (!r.ok) throw new Error('failed');
      loadUsers();
    }).catch(function(){ alert('Не удалось сохранить изменения.'); });
  }

  document.getElementById('addForm').addEventListener('submit', function(e){
    e.preventDefault();
    var err = document.getElementById('addErr');
    err.classList.remove('show');
    fetch('/api/users', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        username: document.getElementById('newUsername').value,
        password: document.getElementById('newPassword').value,
        role: document.getElementById('newRole').value,
      }),
    }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
      .then(function(res){
        if (!res.ok){
          err.textContent = res.d.message || 'Не удалось добавить участника.';
          err.classList.add('show');
          return;
        }
        document.getElementById('addForm').reset();
        loadUsers();
      });
  });

  loadUsers();
})();
