// =================================================================
// JUGADAS BOT IA (19-11-2026) — pestaña del panel de Hipismo para los grupos que tienen contratado el bot de Corredores.
//   · Planos: todas las carreras que tiene el bot, con alerta "FALTA PIZARRA", para poner la pizarra o reabrir una carrera ya calculada.
//   · Editar Jugadas: agregar, corregir o eliminar las jugadas del bot de una carrera (mientras esperan la pizarra).
// Habla con /api/hipismo/bot/* (routes/hipismoJugadasBot.js). La pestaña solo aparece si el grupo tiene el bot contratado.
// Usa las funciones del panel: apiHipismo(), mostrarVista(), REFRESCAR_AL_ENTRAR_VISTA, aplicarFuncionesGrupoHipismo().
// =================================================================
(function () {
  'use strict';
  const BOT = { habilitado: false, planos: null, desde: '', hasta: '', ed: { fecha: '', hipodromo: '', carrera: '', jugadas: null, calculada: false, pizarra: null, editando: null }, clientes: null, hipodromos: null, timer: null };
  window.BOT_IA_HABILITADO = false;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || ''); };
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const diaSemana = iso => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return isNaN(d) ? '' : DIAS[d.getUTCDay()]; };
  const hoyVE = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
  const ordinal = n => n + 'ª';
  const hace = min => (min >= 60 ? Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min' : min + ' min');
  const api = (p, o) => apiHipismo('/api/hipismo/bot' + p, o);

  // ---------------- estilo ----------------
  const css = document.createElement('style');
  css.textContent = `
  .bot-badge-menu { display:inline-block; min-width:18px; padding:0 6px; margin-left:6px; border-radius:999px; background:#d92d20; color:#fff; font-size:11px; font-weight:700; line-height:18px; text-align:center; }
  .bot-aviso { display:flex; gap:10px; align-items:center; padding:12px 14px; border-radius:12px; margin:12px 0; background:rgba(217,45,32,.10); border:1px solid rgba(217,45,32,.35); color:var(--text,#15321f); font-weight:600; }
  .bot-aviso.ok { background:rgba(22,163,74,.10); border-color:rgba(22,163,74,.30); }
  .bot-aviso.info { background:rgba(180,120,0,.10); border-color:rgba(180,120,0,.35); }
  .bot-dia { margin:18px 0 8px; font-weight:700; color:var(--text,#15321f); display:flex; gap:10px; align-items:baseline; }
  .bot-dia small { color:var(--text-dim,#587264); font-weight:500; }
  .bot-carrera { border:1px solid var(--card-border,rgba(15,60,35,.12)); border-radius:12px; padding:12px 14px; margin:8px 0; background:var(--card,#fff); display:grid; gap:10px; }
  .bot-carrera.falta { border-color:rgba(217,45,32,.55); box-shadow:0 0 0 3px rgba(217,45,32,.10); }
  .bot-fila { display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; justify-content:space-between; }
  .bot-titulo { font-weight:700; font-size:15px; }
  .bot-sub { color:var(--text-dim,#587264); font-size:13px; }
  .bot-estado { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:.2px; }
  .bot-estado.falta { background:#d92d20; color:#fff; animation:botPulso 1.6s ease-in-out infinite; }
  .bot-estado.abierta { background:rgba(180,120,0,.16); color:#8a5a00; }
  .bot-estado.calculado { background:rgba(22,163,74,.16); color:#15803d; }
  .bot-estado.anterior { background:rgba(88,114,100,.16); color:var(--text-dim,#587264); }
  @media (prefers-reduced-motion: reduce) { .bot-estado.falta { animation:none; } }
  @keyframes botPulso { 0%,100% { opacity:1; } 50% { opacity:.65; } }
  .bot-pizarra { display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; }
  .bot-pizarra label { display:block; font-size:12px; color:var(--text-dim,#587264); margin-bottom:2px; }
  .bot-pizarra input { width:150px; }
  .bot-pizarra input.corto { width:90px; }
  .bot-acc { display:flex; flex-wrap:wrap; gap:6px; }
  .bot-acc .btn, .bot-pizarra .btn, .bot-tabla .btn { padding:6px 12px; font-size:13px; width:auto; }
  .bot-llegada { display:inline-flex; gap:4px; vertical-align:middle; }
  .bot-llegada b { display:inline-flex; width:24px; height:24px; border-radius:50%; align-items:center; justify-content:center; background:var(--card-2,#f1f8f3); border:1px solid var(--border-light,rgba(15,60,35,.18)); font-size:12px; }
  .bot-llegada b:first-child { background:var(--accent,#16a34a); color:#fff; border-color:transparent; }
  .bot-tabla-wrap { overflow-x:auto; margin-top:10px; }
  .bot-tabla { width:100%; border-collapse:collapse; min-width:620px; }
  .bot-tabla th { text-align:left; font-size:12px; color:var(--text-dim,#587264); font-weight:600; padding:6px 8px; border-bottom:1px solid var(--card-border,rgba(15,60,35,.12)); }
  .bot-tabla td { padding:8px; border-bottom:1px solid var(--card-border,rgba(15,60,35,.12)); vertical-align:middle; }
  .bot-tabla td.num, .bot-tabla th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .bot-tabla tfoot td { font-weight:700; border-bottom:0; }
  .bot-tabla input { width:100%; min-width:80px; box-sizing:border-box; }
  .bot-tabla tr.edit td { background:rgba(22,163,74,.06); }
  .bot-tabla tr.nueva td { background:var(--card-2,#f1f8f3); }
  .bot-selector { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
  .bot-selector > div { min-width:130px; }
  .bot-resultado { white-space:pre-wrap; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px; background:var(--card-2,#f1f8f3); border:1px solid var(--card-border,rgba(15,60,35,.12)); border-radius:10px; padding:10px 12px; margin-top:8px; max-height:320px; overflow:auto; }
  `;
  document.head.appendChild(css);

  // ---------------- estado / menú ----------------
  function mostrarMenu(habilitado, faltan) {
    const cambio = BOT.habilitado !== !!habilitado || !BOT.menuListo;
    BOT.habilitado = !!habilitado; window.BOT_IA_HABILITADO = BOT.habilitado; BOT.menuListo = true;
    const padre = document.getElementById('navParentBotIA'), hijos = document.getElementById('grupoBotIA');
    if (padre) padre.style.display = BOT.habilitado ? '' : 'none';
    if (hijos && cambio) hijos.style.display = BOT.habilitado ? 'flex' : 'none'; // solo al cambiar: no se pisa lo que el usuario plegó a mano
    document.querySelectorAll('[data-vista="botPlanos"],[data-vista="botEditar"]').forEach(b => { b.style.display = BOT.habilitado ? '' : 'none'; });
    const ins = document.getElementById('badgeBotIA');
    if (ins) { ins.style.display = BOT.habilitado && faltan > 0 ? 'inline-block' : 'none'; ins.textContent = faltan > 0 ? String(faltan) : ''; ins.title = faltan + ' carrera(s) esperando pizarra'; }
  }
  async function refrescarEstado() {
    if (typeof TOKEN === 'undefined' || !TOKEN) return;
    try { const e = await api('/estado'); mostrarMenu(e.habilitado, e.faltanPizarra || 0); }
    catch (err) { /* sin conexión o sin permiso: la pestaña queda como estaba */ }
  }

  // ---------------- PLANOS ----------------
  function raizPlanos() { return document.getElementById('botPlanosRaiz'); }
  async function cargarPlanos() {
    const raiz = raizPlanos(); if (!raiz) return;
    if (!raiz.dataset.armado) {
      raiz.dataset.armado = '1';
      raiz.innerHTML = `
        <h2>🤖 Jugadas Bot IA · Planos</h2>
        <p class="desc">Todos los planos que arma el bot con las jugadas del chat. Mientras una carrera no tiene pizarra, sus jugadas están <b>en espera</b> (descuentan el saldo de los clientes por unos minutos). Pon la pizarra aquí y se calcula igual que en Cargar Planos.</p>
        <div class="bot-selector">
          <div><label for="botDesde">Desde</label><input type="date" id="botDesde"></div>
          <div><label for="botHasta">Hasta</label><input type="date" id="botHasta"></div>
          <div><button class="btn btn-secundario" type="button" data-acc="planos-recargar">↻ Actualizar</button></div>
        </div>
        <div id="botPlanosMsg"></div>
        <div id="botPlanosLista"><div class="resultado-vacio">Cargando…</div></div>`;
      raiz.addEventListener('click', clickPlanos);
      raiz.querySelector('#botDesde').addEventListener('change', cargarPlanos);
      raiz.querySelector('#botHasta').addEventListener('change', cargarPlanos);
    }
    const d = raiz.querySelector('#botDesde').value, h = raiz.querySelector('#botHasta').value;
    const lista = raiz.querySelector('#botPlanosLista');
    try {
      const data = await api('/planos' + (d && h ? '?desde=' + d + '&hasta=' + h : ''));
      BOT.planos = data.planos; raiz.querySelector('#botDesde').value = data.desde; raiz.querySelector('#botHasta').value = data.hasta;
      mostrarMenu(true, data.faltanPizarra || 0);
      pintarPlanos(data);
    } catch (e) { lista.innerHTML = '<div class="resultado-vacio">No se pudo cargar: ' + esc(e.message) + '</div>'; }
  }
  function mensajePlanos(html, tipo) { const m = document.getElementById('botPlanosMsg'); if (m) m.innerHTML = html ? '<div class="bot-aviso ' + (tipo || '') + '">' + html + '</div>' : ''; }
  function pintarPlanos(data) {
    const lista = document.getElementById('botPlanosLista');
    const planos = data.planos;
    if (!planos.length) { lista.innerHTML = '<div class="resultado-vacio">El bot no tiene jugadas en ese rango de fechas.</div>'; return; }
    let html = data.faltanPizarra > 0
      ? '<div class="bot-aviso">🚨 ' + (data.faltanPizarra === 1 ? 'Hay 1 carrera' : 'Hay ' + data.faltanPizarra + ' carreras') + ' del bot esperando la pizarra. Mientras no se cargue, sus jugadas quedan sin calcular.</div>' : '';
    const dias = []; planos.forEach(p => { if (!dias.includes(p.fecha)) dias.push(p.fecha); });
    dias.forEach(fecha => {
      const delDia = planos.filter(p => p.fecha === fecha);
      html += '<div class="bot-dia">📅 ' + esc(diaSemana(fecha)) + ' ' + dmy(fecha) + ' <small>' + delDia.length + ' carrera' + (delDia.length === 1 ? '' : 's') + '</small></div>';
      delDia.forEach(p => {
        const i = planos.indexOf(p);
        let estado = '';
        if (p.estado === 'falta_pizarra') estado = '<span class="bot-estado falta">🚨 FALTA PIZARRA · hace ' + hace(p.minutosSinPizarra || 0) + '</span>';
        else if (p.estado === 'abierta') estado = '<span class="bot-estado abierta">🟡 CARRERA ABIERTA</span>';
        else if (p.estado === 'calculado') estado = '<span class="bot-estado calculado">✅ CALCULADO</span>';
        else estado = '<span class="bot-estado anterior">Versión anterior del bot</span>';
        let cuerpo = '';
        if (p.estado === 'falta_pizarra' || p.estado === 'abierta') {
          cuerpo = `<div class="bot-pizarra">
            <div><label for="botPz${i}">Pizarra (llegada)</label><input id="botPz${i}" type="text" inputmode="numeric" placeholder="ej. 3 1 2 4" autocomplete="off"></div>
            <div><label for="botRet${i}">Retirados (opcional)</label><input id="botRet${i}" class="corto" type="text" placeholder="ej. 7" autocomplete="off"></div>
            <button class="btn btn-primario" type="button" data-acc="pizarra" data-i="${i}">🏁 Poner pizarra</button>
          </div>`;
        } else if (p.estado === 'calculado') {
          const bolas = p.pizarra ? '<span class="bot-llegada">' + String(p.pizarra).split('.').map(n => '<b>' + esc(n) + '</b>').join('') + '</span>' : '';
          cuerpo = `<div class="bot-fila"><span class="bot-sub">Pizarra ${bolas}${p.ret ? ' · Ret: ' + esc(p.ret) : ''}</span>
            <button class="btn btn-secundario" type="button" data-acc="reabrir" data-i="${i}" title="Borra el plano calculado (va a la papelera) y deja las jugadas en espera para corregirlas">↩️ Reabrir carrera</button></div>`;
        }
        html += `<div class="bot-carrera ${p.estado === 'falta_pizarra' ? 'falta' : ''}" id="botCarrera${i}">
          <div class="bot-fila">
            <div><div class="bot-titulo">${esc(p.hipodromo)} · ${ordinal(p.carrera)} carrera</div>
              <div class="bot-sub">${p.jugadas} jugada${p.jugadas === 1 ? '' : 's'} · ${money(p.total)} en total</div></div>
            ${estado}
            <div class="bot-acc"><button class="btn btn-secundario" type="button" data-acc="editar" data-i="${i}">✏️ Ver / editar jugadas</button></div>
          </div>
          ${cuerpo}
          <div id="botRes${i}"></div>
        </div>`;
      });
    });
    lista.innerHTML = html;
  }
  async function clickPlanos(ev) {
    const b = ev.target.closest('[data-acc]'); if (!b) return;
    const acc = b.dataset.acc, p = BOT.planos && BOT.planos[Number(b.dataset.i)];
    if (acc === 'planos-recargar') return cargarPlanos();
    if (!p) return;
    if (acc === 'editar') return abrirEditar(p.fecha, p.hipodromo, p.carrera);
    if (acc === 'pizarra') {
      const i = b.dataset.i;
      const piz = document.getElementById('botPz' + i).value.trim(), ret = document.getElementById('botRet' + i).value.trim();
      if (!piz) { mensajePlanos('Escribe la pizarra (la llegada) de ' + esc(p.hipodromo) + ', ' + ordinal(p.carrera) + ' carrera. Por ejemplo: 3 1 2 4', 'info'); return; }
      b.disabled = true; b.textContent = 'Calculando…';
      try {
        const r = await api('/pizarra', { method: 'POST', body: JSON.stringify({ fecha: p.fecha, hipodromo: p.hipodromo, carrera: p.carrera, pizarra: piz, ret }) });
        mensajePlanos('✅ Pizarra cargada en <b>' + esc(p.hipodromo) + ', ' + ordinal(p.carrera) + ' carrera</b>: se calculó y ya está en los saldos de los clientes.', 'ok');
        await cargarPlanos();
        const sit = BOT.planos && BOT.planos.findIndex(x => x.fecha === p.fecha && x.hipodromo === p.hipodromo && x.carrera === p.carrera);
        const res = sit >= 0 && document.getElementById('botRes' + sit);
        if (res && r.texto) res.innerHTML = '<div class="bot-resultado">' + esc(r.texto) + '</div>';
      } catch (e) { mensajePlanos('⚠️ ' + esc(e.message), ''); b.disabled = false; b.textContent = '🏁 Poner pizarra'; }
    }
    if (acc === 'reabrir') {
      if (!confirm('¿Reabrir ' + p.hipodromo + ', ' + ordinal(p.carrera) + ' carrera?\n\nEl plano calculado se mueve a la papelera (se revierten sus saldos y tickets) y las jugadas del bot vuelven a quedar en espera para corregirlas y poner la pizarra otra vez.')) return;
      try { await api('/reabrir', { method: 'POST', body: JSON.stringify({ fecha: p.fecha, hipodromo: p.hipodromo, carrera: p.carrera }) });
        mensajePlanos('↩️ Carrera reabierta: <b>' + esc(p.hipodromo) + ', ' + ordinal(p.carrera) + '</b> vuelve a esperar pizarra. Corrige lo que necesites y ponle la pizarra.', 'info');
        await cargarPlanos(); }
      catch (e) { mensajePlanos('⚠️ ' + esc(e.message), ''); }
    }
  }

  // ---------------- EDITAR JUGADAS ----------------
  function raizEditar() { return document.getElementById('botEditarRaiz'); }
  async function datosAuxiliares() {
    if (!BOT.clientes) { try { BOT.clientes = (await apiHipismo('/api/jugadores')).map(j => j.nombre).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')); } catch (e) { BOT.clientes = []; } }
    if (!BOT.hipodromos) { try { BOT.hipodromos = (await apiHipismo('/api/hipismo/hipodromos')).map(h => h.nombre).filter(Boolean); } catch (e) { BOT.hipodromos = []; } }
  }
  async function armarEditar() {
    const raiz = raizEditar(); if (!raiz) return;
    await datosAuxiliares();
    if (!raiz.dataset.armado) {
      raiz.dataset.armado = '1';
      raiz.addEventListener('click', clickEditar);
    }
    const ed = BOT.ed;
    if (!ed.fecha) ed.fecha = hoyVE();
    if (!ed.hipodromo && BOT.hipodromos.length) ed.hipodromo = BOT.hipodromos[0];
    raiz.innerHTML = `
      <h2>🤖 Jugadas Bot IA · Editar Jugadas</h2>
      <p class="desc">Elige el día, el hipódromo y la carrera. Aquí puedes <b>agregar</b> una jugada que faltó, <b>editar</b> el monto, la apuesta o los clientes, o <b>eliminar</b> una con error. Solo se editan las que esperan la pizarra; si la carrera ya se calculó, se reabre primero.</p>
      <datalist id="botClientesDL">${BOT.clientes.map(n => '<option value="' + esc(n) + '">').join('')}</datalist>
      <div class="bot-selector">
        <div><label for="botEdFecha">Día</label><input type="date" id="botEdFecha" value="${esc(ed.fecha)}"></div>
        <div><label for="botEdHip">Hipódromo</label><select id="botEdHip">${BOT.hipodromos.map(h => '<option' + (h === ed.hipodromo ? ' selected' : '') + '>' + esc(h) + '</option>').join('')}</select></div>
        <div><label for="botEdCarrera">Carrera</label><input type="number" min="1" max="30" id="botEdCarrera" value="${esc(ed.carrera)}" style="width:90px"></div>
        <div><button class="btn btn-primario" type="button" data-acc="ed-cargar">Ver jugadas</button></div>
      </div>
      <div id="botEdMsg"></div>
      <div id="botEdCuerpo"></div>`;
    if (ed.jugadas) pintarEditar(); else if (ed.carrera) cargarEditar();
    else document.getElementById('botEdCuerpo').innerHTML = '<div class="resultado-vacio">Elige la carrera y toca «Ver jugadas».</div>';
  }
  function abrirEditar(fecha, hipodromo, carrera) {
    BOT.ed = { fecha, hipodromo, carrera: String(carrera), jugadas: null, calculada: false, pizarra: null, editando: null };
    const btn = document.querySelector('[data-vista="botEditar"]');
    mostrarVista('botEditar', btn);
  }
  function mensajeEd(html, tipo) { const m = document.getElementById('botEdMsg'); if (m) m.innerHTML = html ? '<div class="bot-aviso ' + (tipo || '') + '">' + html + '</div>' : ''; }
  async function cargarEditar() {
    const ed = BOT.ed;
    ed.fecha = document.getElementById('botEdFecha').value; ed.hipodromo = document.getElementById('botEdHip').value; ed.carrera = document.getElementById('botEdCarrera').value;
    const cuerpo = document.getElementById('botEdCuerpo');
    if (!ed.fecha || !ed.hipodromo || !(Number(ed.carrera) > 0)) { mensajeEd('Elige el día, el hipódromo y el número de carrera.', 'info'); return; }
    cuerpo.innerHTML = '<div class="resultado-vacio">Cargando…</div>';
    try {
      const q = '?fecha=' + encodeURIComponent(ed.fecha) + '&hipodromo=' + encodeURIComponent(ed.hipodromo) + '&carrera=' + encodeURIComponent(ed.carrera);
      const r = await api('/planos/jugadas' + q);
      ed.jugadas = r.jugadas; ed.editando = null;
      ed.calculada = r.jugadas.length > 0 && r.jugadas.every(j => j.calculada);
      ed.pizarra = null;
      if (ed.calculada) { try { const pl = await api('/planos?desde=' + ed.fecha + '&hasta=' + ed.fecha); const f = pl.planos.find(x => x.hipodromo === ed.hipodromo && String(x.carrera) === String(ed.carrera)); ed.pizarra = f ? f.pizarra : null; } catch (e) { /* se muestra sin pizarra */ } }
      pintarEditar();
    } catch (e) { cuerpo.innerHTML = '<div class="resultado-vacio">No se pudo cargar: ' + esc(e.message) + '</div>'; }
  }
  const inp = (id, v, ph, extra) => '<input id="' + id + '" value="' + esc(v) + '" placeholder="' + esc(ph || '') + '" autocomplete="off" ' + (extra || '') + '>';
  function pintarEditar() {
    const ed = BOT.ed, cuerpo = document.getElementById('botEdCuerpo'); if (!cuerpo) return;
    const js = ed.jugadas || [];
    const total = js.reduce((a, j) => a + j.monto, 0);
    let html = '';
    if (ed.calculada) {
      const bolas = ed.pizarra ? ' · pizarra <span class="bot-llegada">' + String(ed.pizarra).split('.').map(n => '<b>' + esc(n) + '</b>').join('') + '</span>' : '';
      html += '<div class="bot-aviso ok">✅ Esta carrera ya está calculada' + bolas + '. Para cambiar jugadas, reábrela: el plano va a la papelera y las jugadas vuelven a esperar la pizarra. <button class="btn btn-secundario" type="button" data-acc="ed-reabrir">↩️ Reabrir carrera</button></div>';
    } else if (js.some(j => j.editable)) {
      html += '<div class="bot-aviso info">⏳ Estas jugadas esperan la pizarra. Puedes corregirlas antes de ponerla.</div>';
    }
    html += '<div class="bot-tabla-wrap"><table class="bot-tabla"><thead><tr><th>Juega</th><th>Apuesta</th><th class="num">Monto</th><th>Da</th><th></th></tr></thead><tbody>';
    if (!js.length) html += '<tr><td colspan="5" class="bot-sub">No hay jugadas del bot en esta carrera todavía.</td></tr>';
    js.forEach(j => {
      if (ed.editando === j.id) {
        html += `<tr class="edit"><td>${inp('botEJug', j.jugador, '', 'list="botClientesDL"')}</td><td>${inp('botEAp', j.apuestaTexto, 'ej. 4x1 doy a8')}</td><td class="num">${inp('botEMon', j.monto, '', 'inputmode="decimal"')}</td><td>${inp('botEBan', j.banquero, '', 'list="botClientesDL"')}</td>
          <td class="bot-acc"><button class="btn btn-primario" type="button" data-acc="ed-guardar" data-id="${esc(j.id)}">Guardar</button><button class="btn btn-secundario" type="button" data-acc="ed-cancelar">Cancelar</button></td></tr>`;
      } else {
        html += `<tr><td>${esc(j.jugador)}</td><td>${esc(j.apuesta)}</td><td class="num">${money(j.monto)}</td><td>${esc(j.banquero)}</td>
          <td class="bot-acc">${j.editable ? `<button class="btn btn-secundario" type="button" data-acc="ed-editar" data-id="${esc(j.id)}">✏️ Editar</button><button class="btn btn-secundario" type="button" data-acc="ed-eliminar" data-id="${esc(j.id)}">🗑️ Eliminar</button>` : (j.version_anterior ? '<span class="bot-sub">versión anterior</span>' : '<span class="bot-sub">calculada</span>')}</td></tr>`;
      }
    });
    html += '</tbody><tfoot><tr><td colspan="2">' + js.length + ' jugada' + (js.length === 1 ? '' : 's') + '</td><td class="num">' + money(total) + '</td><td colspan="2"></td></tr></tfoot></table></div>';
    if (!ed.calculada) {
      html += `<h3 style="margin:18px 0 6px;">➕ Agregar una jugada que faltó</h3>
        <div class="bot-tabla-wrap"><table class="bot-tabla"><tbody><tr class="nueva">
          <td>${inp('botNJug', '', 'Juega (cliente)', 'list="botClientesDL"')}</td><td>${inp('botNAp', '', 'Apuesta: 4x1 doy a8, 3n del 8…')}</td><td class="num">${inp('botNMon', '', 'Monto', 'inputmode="decimal"')}</td><td>${inp('botNBan', '', 'Da (cliente)', 'list="botClientesDL"')}</td>
          <td class="bot-acc"><button class="btn btn-primario" type="button" data-acc="ed-agregar">Agregar</button></td></tr></tbody></table></div>
        <p class="bot-sub">La apuesta se escribe como en el chat: <b>4x1 doy a8</b> (cruce, 10 a 8), <b>3n del 8</b>, <b>2p del 5</b>, <b>1p del 6</b>. Quien «juega» es quien arriesga el monto; quien «da» arriesga su parte.</p>`;
    }
    cuerpo.innerHTML = html;
  }
  async function clickEditar(ev) {
    const b = ev.target.closest('[data-acc]'); if (!b) return;
    const acc = b.dataset.acc, ed = BOT.ed, id = b.dataset.id;
    const v = i => (document.getElementById(i) || {}).value || '';
    try {
      if (acc === 'ed-cargar') return cargarEditar();
      if (acc === 'ed-editar') { ed.editando = id; return pintarEditar(); }
      if (acc === 'ed-cancelar') { ed.editando = null; return pintarEditar(); }
      if (acc === 'ed-guardar') {
        await api('/jugadas/' + id, { method: 'PUT', body: JSON.stringify({ jugador: v('botEJug'), banquero: v('botEBan'), apuesta: v('botEAp'), monto: v('botEMon').replace(',', '.') }) });
        mensajeEd('✅ Jugada corregida.', 'ok'); return cargarEditar();
      }
      if (acc === 'ed-eliminar') {
        const j = ed.jugadas.find(x => x.id === id);
        if (!confirm('¿Eliminar la jugada de ' + j.jugador + ' (' + j.apuesta + ' con ' + money(j.monto) + ' contra ' + j.banquero + ')?')) return;
        await api('/jugadas/' + id, { method: 'DELETE' }); mensajeEd('🗑️ Jugada eliminada: su saldo quedó libre.', 'ok'); return cargarEditar();
      }
      if (acc === 'ed-agregar') {
        await api('/jugadas', { method: 'POST', body: JSON.stringify({ fecha: ed.fecha, hipodromo: ed.hipodromo, carrera: Number(ed.carrera), jugador: v('botNJug'), banquero: v('botNBan'), apuesta: v('botNAp'), monto: v('botNMon').replace(',', '.') }) });
        mensajeEd('✅ Jugada agregada: queda en espera de la pizarra.', 'ok'); return cargarEditar();
      }
      if (acc === 'ed-reabrir') {
        if (!confirm('¿Reabrir ' + ed.hipodromo + ', ' + ed.carrera + 'ª carrera?\n\nEl plano calculado va a la papelera (se revierten saldos y tickets) y las jugadas del bot vuelven a esperar la pizarra.')) return;
        await api('/reabrir', { method: 'POST', body: JSON.stringify({ fecha: ed.fecha, hipodromo: ed.hipodromo, carrera: Number(ed.carrera) }) });
        mensajeEd('↩️ Carrera reabierta. Ya puedes corregir las jugadas y volver a poner la pizarra desde «Planos».', 'info'); return cargarEditar();
      }
    } catch (e) { mensajeEd('⚠️ ' + esc(e.message), ''); }
  }

  // ---------------- arranque ----------------
  if (typeof REFRESCAR_AL_ENTRAR_VISTA === 'object') {
    REFRESCAR_AL_ENTRAR_VISTA.botPlanos = () => cargarPlanos();
    REFRESCAR_AL_ENTRAR_VISTA.botEditar = () => armarEditar();
  }
  let intentos = 0;
  (function esperar() {
    if (typeof TOKEN !== 'undefined' && TOKEN) { refrescarEstado(); if (!BOT.timer) BOT.timer = setInterval(refrescarEstado, 60000); return; }
    if (++intentos < 40) setTimeout(esperar, 1000);
  })();
  window.botIARefrescar = refrescarEstado;
})();
