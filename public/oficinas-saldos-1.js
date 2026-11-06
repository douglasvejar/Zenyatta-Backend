/* =================================================================
   HIPISMO OFICINAS — Recargas, Retiros y Control de Pozos (05-11-2026, a pedido del usuario: "haz todas esas mejoras").
   Es la misma lógica y el mismo servidor que ya usa Hipismo Grupos Hípicos (rutas /api/hipismo/recargas-pago-diario, /retiros,
   /metodos-pago, /comprobantes/:id y /control-pozos): una recarga o un retiro con método de pago, referencia y foto del comprobante
   se ve igual en los dos módulos. Este archivo solo pinta las pantallas de Oficinas.
   Usa los ayudantes de hipismo-oficinas.html: $, esc, api, fmt, msg, nombreBonito, normNombre, redondearCentavos, CLIENTES,
   cargarClientes, fechaHoyVenezuela, TOKEN, INF, queryPeriodo.
   ================================================================= */

// ---------- Excel (.csv con BOM y ';' para que Excel en español lo abra con columnas) ----------
function descargarExcel(nombreArchivo, filas) {
  const celda = v => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const texto = '﻿' + filas.map(f => f.map(celda).join(';')).join('\r\n');
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombreArchivo.replace(/\.csv$/i, '') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const numExcel = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',');

// ---------- Datos del pago: método, referencia y foto ----------
let METODOS_PAGO = { predeterminados: ['Zelle', 'Pago móvil', 'Dólares efectivo', 'Bolívares efectivo', 'Banesco Panamá', 'Cash App'], personalizados: [] };
const PAGO_IMAGEN = {};
const PAGO_IMAGEN_MAX_LADO = 1600;

async function cargarMetodosPago() {
  try { const d = await api('/api/hipismo/metodos-pago'); if (d && d.predeterminados) METODOS_PAGO = { predeterminados: d.predeterminados, personalizados: d.personalizados || [] }; } catch (e) { /* quedan los predeterminados */ }
}
function bloquePagoMiniHtml(p) {
  return `<div class="rec-campo rec-campo-metodo">
      <label class="rec-rot" for="selMetodo${p}">Método de pago</label>
      <select id="selMetodo${p}" onchange="cambioMetodoPago('${p}')"></select>
      <div id="boxOtroMetodo${p}" class="rec-otro" style="display:none;"><input type="text" id="inpOtroMetodo${p}" maxlength="60" placeholder="Escribe el método" title="Queda guardado en la lista de tu grupo"></div>
    </div>
    <div class="rec-campo">
      <label class="rec-rot" for="inpReferencia${p}">Referencia</label>
      <input type="text" id="inpReferencia${p}" maxlength="160" placeholder="Opcional" autocomplete="off">
    </div>
    <div class="rec-campo">
      <span class="rec-rot">Foto</span>
      <span class="rec-foto"><label class="btn btn-sec rec-foto-btn" title="Foto de la referencia del pago (opcional)">📎 Adjuntar<input type="file" id="filePago${p}" accept="image/*" hidden onchange="elegirImagenPago('${p}', this)"></label><span id="prevPago${p}" class="rec-foto-ok"></span></span>
    </div>`;
}
function pintarSelectMetodoPago(p, valor) {
  const sel = $('selMetodo' + p);
  if (!sel) return;
  const actual = valor !== undefined ? valor : sel.value;
  const todos = METODOS_PAGO.predeterminados.concat(METODOS_PAGO.personalizados);
  if (actual && actual !== '__otro' && !todos.includes(actual)) todos.push(actual);
  sel.innerHTML = '<option value="">— Sin especificar —</option>' + todos.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('') + '<option value="__otro">Otro…</option>';
  sel.value = actual || '';
  cambioMetodoPago(p);
}
function cambioMetodoPago(p) {
  const sel = $('selMetodo' + p), box = $('boxOtroMetodo' + p);
  if (box && sel) box.style.display = sel.value === '__otro' ? '' : 'none';
}
function elegirImagenPago(p, input) {
  const prev = $('prevPago' + p);
  const f = input.files && input.files[0];
  delete PAGO_IMAGEN[p];
  if (prev) prev.textContent = '';
  if (!f) return;
  if (!/^image\//.test(f.type)) { if (prev) { prev.style.color = 'var(--danger)'; prev.textContent = 'Elige una imagen.'; } input.value = ''; return; }
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, PAGO_IMAGEN_MAX_LADO / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    PAGO_IMAGEN[p] = { base64: c.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg' };
    if (prev) { prev.style.color = 'var(--ok)'; prev.textContent = '✅ Foto lista'; prev.title = f.name; }
  };
  img.onerror = () => { URL.revokeObjectURL(url); if (prev) { prev.style.color = 'var(--danger)'; prev.textContent = 'No se pudo leer esa imagen.'; } input.value = ''; };
  img.src = url;
}
function leerDatosPago(p) {
  const sel = $('selMetodo' + p);
  let metodo = sel ? sel.value : '';
  if (metodo === '__otro') metodo = ($('inpOtroMetodo' + p).value || '').trim();
  const ref = $('inpReferencia' + p);
  const datos = { metodo, referencia: ref ? ref.value.trim() : '' };
  if (PAGO_IMAGEN[p]) datos.imagen = PAGO_IMAGEN[p];
  return datos;
}
function limpiarDatosPago(p, valores) {
  delete PAGO_IMAGEN[p];
  const v = valores || {};
  pintarSelectMetodoPago(p, v.metodo || '');
  const o = $('inpOtroMetodo' + p); if (o) o.value = '';
  const r = $('inpReferencia' + p); if (r) r.value = v.referencia || '';
  const f = $('filePago' + p); if (f) f.value = '';
  const prev = $('prevPago' + p);
  if (prev) { prev.style.color = 'var(--text-dim)'; prev.textContent = v.tieneImagen ? '🖼️ Ya tiene foto (si subes otra, la reemplaza).' : ''; }
}
function textoPago(x) {
  if (!x) return '';
  const partes = [];
  if (x.metodo) partes.push(x.metodo);
  if (x.referencia) partes.push('Ref. ' + x.referencia);
  return partes.join(' · ');
}
function chipsPagoHtml(x) {
  if (!x) return '';
  let h = '';
  if (x.metodo) h += `<span class="rec-chip">💳 ${esc(x.metodo)}</span>`;
  if (x.referencia) h += `<span class="rec-chip">Ref. ${esc(x.referencia)}</span>`;
  return h;
}
function botonVerImagenHtml(id) {
  return `<button type="button" class="btn btn-sec btn-ver-imagen" onclick="event.stopPropagation(); verComprobante('${esc(id)}')">🖼️ Ver imagen</button>`;
}
async function verComprobante(id) {
  let blob;
  try {
    const res = await fetch('/api/hipismo/comprobantes/' + encodeURIComponent(id), { headers: TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {} });
    if (!res.ok) {
      let m = 'No se pudo abrir la imagen.';
      try { const j = await res.json(); if (j && j.error) m = j.error; } catch (e) { /* sin cuerpo */ }
      alert(m); return;
    }
    blob = await res.blob();
  } catch (e) { alert('No se pudo conectar con el servidor.'); return; }
  const url = URL.createObjectURL(blob);
  const velo = document.createElement('div');
  velo.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.88); display:flex; align-items:center; justify-content:center; padding:16px; cursor:zoom-out;';
  velo.innerHTML = `<img src="${url}" alt="Comprobante del pago" style="max-width:96vw; max-height:90vh; object-fit:contain; border-radius:8px; background:#fff;"><button type="button" aria-label="Cerrar" style="position:absolute; top:12px; right:14px; font-size:22px; line-height:1; background:#fff; color:#111; border:none; border-radius:50%; width:36px; height:36px; cursor:pointer;">✕</button>`;
  const cerrar = () => { document.removeEventListener('keydown', alEsc); velo.remove(); URL.revokeObjectURL(url); };
  const alEsc = ev => { if (ev.key === 'Escape') cerrar(); };
  velo.addEventListener('click', cerrar);
  document.addEventListener('keydown', alEsc);
  document.body.appendChild(velo);
}

// ---------- Pantalla Recargas y Retiros ----------
function irASubSaldos(sub) {
  document.querySelectorAll('#panel-recargas .subtab').forEach(b => b.classList.toggle('activa', b.dataset.sub === sub));
  document.querySelectorAll('#panel-recargas .subpanel').forEach(p => p.classList.toggle('activo', p.id === 'subpanel-' + sub));
  if (sub === 'recargas') pintarRecargas(); else entrarRetiros();
}
async function entrarRecargas() {
  const f = $('rcFecha'); if (f && !f.value) f.value = fechaHoyVenezuela();
  const f2 = $('rtFecha'); if (f2 && !f2.value) f2.value = fechaHoyVenezuela();
  await cargarMetodosPago();
  const activa = document.querySelector('#panel-recargas .subtab.activa');
  if (activa && activa.dataset.sub === 'retiros') await entrarRetiros(); else await pintarRecargas();
}

let RECARGAS = { cuenta: 'POZOS PAGO DIARIOS', clientes: [], recargas: [] };
async function saldosSemanaPorCliente() {
  try {
    const d = await api('/api/hipismo/cierre-final?semana=actual');
    const m = new Map();
    INF.armarBalance(d, () => false).filas.forEach(f => m.set(normNombre(f.nombre), f.saldo));
    return m;
  } catch (e) { return new Map(); }
}
async function pintarRecargas() {
  const cont = $('rcClientes'), lista = $('rcLista');
  let d;
  try { d = await api('/api/hipismo/recargas-pago-diario'); }
  catch (e) { cont.innerHTML = `<div class="vacio">No se pudo cargar: ${esc(e.message)}</div>`; lista.innerHTML = ''; return; }
  RECARGAS = { cuenta: d.cuenta || RECARGAS.cuenta, clientes: (d.clientes || []).filter(c => c.activo), recargas: d.recargas || [] };
  const saldos = await saldosSemanaPorCliente();
  const signo = n => (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n));
  if (!RECARGAS.clientes.length) {
    cont.innerHTML = '<div class="vacio">Todavía no hay clientes de pago diario. Márcalos en <b>Crear Cliente u Oficina</b> (casilla 💵 Pago diario, o el botón en la lista de clientes).</div>';
  } else {
    cont.innerHTML = RECARGAS.clientes.map((c, i) => {
      const saldo = redondearCentavos(saldos.get(normNombre(c.nombre)) || 0);
      return `<div class="rec-cli">
        <div class="rec-cli-cab"><span class="rec-cli-nombre">💵 ${esc(nombreBonito(c.nombre))}</span>
          <span class="rec-cli-saldo ${saldo > 0 ? 'pos' : (saldo < 0 ? 'neg' : '')}">Saldo de la semana <b>${signo(saldo)}</b></span></div>
        <div class="rec-campos">
          ${bloquePagoMiniHtml('Rec' + i)}
          <div class="rec-campo rec-campo-monto"><label class="rec-rot" for="rcMonto${i}">Monto a recargar</label>
            <input type="number" step="0.01" min="0" id="rcMonto${i}" placeholder="+ monto" onkeydown="if(event.key==='Enter')recargarCliente(${i})"></div>
          <div class="rec-campo rec-campo-btn"><span class="rec-rot" aria-hidden="true">&nbsp;</span><button class="btn rec-btn" type="button" onclick="recargarCliente(${i})">Recargar</button></div>
        </div></div>`;
    }).join('');
    RECARGAS.clientes.forEach((c, i) => { delete PAGO_IMAGEN['Rec' + i]; pintarSelectMetodoPago('Rec' + i, ''); });
  }
  pintarListaMovimientos(lista, RECARGAS.recargas, 'recarga');
}
function nombreDiaCorto(iso) {
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const d = new Date(iso + 'T12:00:00');
  return dias[d.getDay()] + ' ' + INF.fechaCorta(iso);
}
function pintarListaMovimientos(cont, items, tipo) {
  if (!items.length) { cont.innerHTML = `<div class="vacio">Todavía no se ha registrado ${tipo === 'recarga' ? 'ninguna recarga' : 'ningún retiro'}.</div>`; return; }
  const porDia = new Map();
  items.forEach(r => { if (!porDia.has(r.fecha)) porDia.set(r.fecha, []); porDia.get(r.fecha).push(r); });
  cont.innerHTML = Array.from(porDia.entries()).map(([fecha, ls]) => {
    const total = redondearCentavos(ls.reduce((a, r) => a + Number(r.monto), 0));
    const notaDef = tipo === 'recarga' ? 'Recarga de saldo (pago diario)' : 'Retiro (pago a cliente)';
    return `<div style="margin-bottom:14px;"><div class="mov-dia">📅 ${nombreDiaCorto(fecha)} <span>— ${ls.length} ${tipo === 'recarga' ? 'recarga(s)' : 'retiro(s)'}, total ${INF.dinero(total)}</span></div>
      ${ls.map(r => `<div class="mov-fila"><span class="rec-linea">${tipo === 'recarga' ? '💵' : '💸'} <b>${esc(nombreBonito(r.cliente))}</b>: <b>${tipo === 'recarga' ? '+' : ''}${INF.dinero(r.monto)}</b>
        ${tipo === 'retiro' ? `<span class="rec-chip">→ ${esc(r.cuenta || 'PAGOS A CLIENTES')}</span>` : ''}
        ${r.nota && r.nota !== notaDef ? `<span style="color:var(--text-dim)">(${esc(r.nota)})</span>` : ''}${chipsPagoHtml(r)}${r.tieneImagen ? botonVerImagenHtml(r.id) : ''}</span>
        <span class="mov-acc"><button type="button" class="btn btn-sec btn-chico" onclick="${tipo === 'recarga' ? 'cambiarMontoRecarga' : 'editarRetiro'}('${esc(r.id)}')">✏️ ${tipo === 'recarga' ? 'Cambiar monto' : 'Editar'}</button>
        <button type="button" class="btn btn-peligro btn-chico" onclick="${tipo === 'recarga' ? 'eliminarRecarga' : 'eliminarRetiro'}('${esc(r.id)}')">🗑️ Eliminar</button></span></div>`).join('')}</div>`;
  }).join('');
}
async function recargarCliente(i) {
  const c = RECARGAS.clientes[i], inp = $('rcMonto' + i);
  if (!c || !inp) return;
  const monto = Number(inp.value);
  if (!monto || monto <= 0) return msg('rcMsg', 'Escribe un monto mayor a 0 para ' + nombreBonito(c.nombre) + '.', false);
  const fecha = $('rcFecha').value || fechaHoyVenezuela(), nota = $('rcNota').value.trim();
  const pago = leerDatosPago('Rec' + i);
  const resumenPago = textoPago(pago) + (pago.imagen ? (textoPago(pago) ? ' · ' : '') + 'con foto' : '');
  if (!confirm(`¿Recargar ${INF.dinero(monto)} a ${nombreBonito(c.nombre)}?\n\n${nombreBonito(c.nombre)} +${INF.dinero(monto)}\n${RECARGAS.cuenta} −${INF.dinero(monto)}` + (resumenPago ? `\n\nPago: ${resumenPago}` : ''))) return;
  try { await api('/api/hipismo/recargas-pago-diario', { method: 'POST', body: JSON.stringify(Object.assign({ cliente: c.nombre, monto, fecha, nota }, pago)) }); }
  catch (e) { return msg('rcMsg', 'No se pudo recargar: ' + e.message, false); }
  await cargarMetodosPago();
  await pintarRecargas();
  msg('rcMsg', `✅ Listo: ${nombreBonito(c.nombre)} +${INF.dinero(monto)} y ${RECARGAS.cuenta} −${INF.dinero(monto)}.`, true);
}
async function cambiarMontoRecarga(id) {
  const r = RECARGAS.recargas.find(x => x.id === id); if (!r) return;
  const txt = prompt(`Nuevo monto de la recarga de ${nombreBonito(r.cliente)} (ahora ${INF.dinero(r.monto)}):`, r.monto);
  if (txt === null) return;
  const monto = Number(String(txt).replace(',', '.'));
  if (!monto || monto <= 0) return msg('rcMsg', 'Escribe un monto mayor a 0.', false);
  try { await api('/api/hipismo/recargas-pago-diario/' + id, { method: 'PUT', body: JSON.stringify({ monto }) }); }
  catch (e) { return msg('rcMsg', 'No se pudo corregir: ' + e.message, false); }
  await pintarRecargas(); msg('rcMsg', '✅ Recarga corregida.', true);
}
async function eliminarRecarga(id) {
  const r = RECARGAS.recargas.find(x => x.id === id);
  if (!confirm(`¿Eliminar la recarga de ${r ? INF.dinero(r.monto) + ' a ' + nombreBonito(r.cliente) : 'este cliente'}? Su saldo y ${RECARGAS.cuenta} vuelven a como estaban.`)) return;
  try { await api('/api/hipismo/recargas-pago-diario/' + id, { method: 'DELETE' }); }
  catch (e) { return alert('No se pudo eliminar: ' + e.message); }
  await pintarRecargas(); msg('rcMsg', '🗑️ Recarga eliminada.', true);
}

// ---------- Retiros ----------
let RETIROS = [];
let RETIRO_EDITANDO = null;
function cuentaDestinoRetiro(cliente) {
  const c = CLIENTES.find(x => normNombre(x.nombre) === normNombre(cliente));
  return c && c.pago_diario ? 'POZOS PAGO DIARIOS' : 'PAGOS A CLIENTES';
}
function poblarSelectRetiro() {
  const sel = $('rtCliente'), actual = sel.value;
  const q = normNombre($('rtBuscar').value);
  const lista = CLIENTES.filter(c => !c.es_cuenta_comision && c.activo !== false && (!q || normNombre(c.nombre).includes(q)));
  sel.innerHTML = '<option value="">— Elige —</option>' + lista.map(c => `<option value="${esc(c.nombre)}">${esc(nombreBonito(c.nombre))}${c.pago_diario ? ' 💵' : ''}</option>`).join('');
  if (actual && lista.some(c => c.nombre === actual)) sel.value = actual;
  pintarPistaRetiro();
}
function pintarPistaRetiro() {
  const c = $('rtCliente').value, m = Number($('rtMonto').value) || 0;
  $('rtPista').textContent = c ? `El retiro de ${nombreBonito(c)} se suma a ${cuentaDestinoRetiro(c)}` + (m > 0 ? ` (${nombreBonito(c)} −${INF.dinero(m)} / ${cuentaDestinoRetiro(c)} +${INF.dinero(m)}).` : '.') : '';
}
async function entrarRetiros() {
  await cargarMetodosPago();
  if (!$('rtPagoBloque').firstElementChild) $('rtPagoBloque').innerHTML = `<div class="rec-campos">${bloquePagoMiniHtml('Ret')}</div>`;
  pintarSelectMetodoPago('Ret');
  if (!CLIENTES.length) await cargarClientes();
  poblarSelectRetiro();
  await pintarListaRetiros();
}
async function pintarListaRetiros() {
  const cont = $('rtLista');
  try { RETIROS = (await api('/api/hipismo/retiros')).retiros || []; }
  catch (e) { cont.innerHTML = `<div class="vacio">No se pudo cargar: ${esc(e.message)}</div>`; return; }
  pintarListaMovimientos(cont, RETIROS, 'retiro');
}
function restablecerRetiro() {
  RETIRO_EDITANDO = null;
  $('rtMonto').value = ''; $('rtNota').value = '';
  limpiarDatosPago('Ret');
  $('rtGuardar').textContent = '+ Registrar retiro'; $('rtCancelar').style.display = 'none';
  pintarPistaRetiro();
}
function editarRetiro(id) {
  const r = RETIROS.find(x => x.id === id); if (!r) return;
  RETIRO_EDITANDO = { id: r.id, cliente: r.cliente, monto: Number(r.monto) };
  $('rtBuscar').value = ''; poblarSelectRetiro();
  const sel = $('rtCliente');
  if (![...sel.options].some(o => o.value === r.cliente)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(r.cliente)}">${esc(nombreBonito(r.cliente))}</option>`);
  sel.value = r.cliente;
  $('rtMonto').value = r.monto; $('rtFecha').value = r.fecha;
  $('rtNota').value = r.nota && r.nota !== 'Retiro (pago a cliente)' ? r.nota : '';
  limpiarDatosPago('Ret', r);
  $('rtGuardar').textContent = '💾 Guardar cambios'; $('rtCancelar').style.display = '';
  msg('rtMsg', '✏️ Editando un retiro: cambia lo que haga falta y presiona "Guardar cambios".', true);
  pintarPistaRetiro();
  $('rtMonto').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function guardarRetiro() {
  const cliente = $('rtCliente').value, monto = Number($('rtMonto').value);
  const fecha = $('rtFecha').value || fechaHoyVenezuela(), nota = $('rtNota').value.trim();
  const pago = leerDatosPago('Ret');
  if (!cliente) return msg('rtMsg', 'Elige el cliente al que se le pagó.', false);
  if (!monto || monto <= 0) return msg('rtMsg', 'Escribe un monto mayor a 0.', false);
  const editando = RETIRO_EDITANDO, cuenta = cuentaDestinoRetiro(cliente);
  if (!editando && !confirm(`¿Registrar un retiro de ${INF.dinero(monto)} a ${nombreBonito(cliente)}?\n\n${nombreBonito(cliente)} -${INF.dinero(monto)}\n${cuenta} +${INF.dinero(monto)}`)) return;
  const cuerpo = JSON.stringify(Object.assign({ cliente, monto, fecha, nota }, pago));
  try {
    if (editando) await api('/api/hipismo/retiros/' + editando.id, { method: 'PUT', body: cuerpo });
    else await api('/api/hipismo/retiros', { method: 'POST', body: cuerpo });
  } catch (e) { return msg('rtMsg', 'No se pudo guardar el retiro: ' + e.message, false); }
  await cargarMetodosPago();
  restablecerRetiro(); pintarSelectMetodoPago('Ret');
  msg('rtMsg', editando ? '✅ Retiro corregido.' : `✅ Listo: ${nombreBonito(cliente)} -${INF.dinero(monto)} y ${cuenta} +${INF.dinero(monto)}.`, true);
  await pintarListaRetiros();
}
async function eliminarRetiro(id) {
  const r = RETIROS.find(x => x.id === id);
  if (!confirm(`¿Eliminar el retiro de ${r ? INF.dinero(r.monto) + ' a ' + nombreBonito(r.cliente) : 'este cliente'}? Su saldo vuelve a como estaba.`)) return;
  try { await api('/api/hipismo/retiros/' + id, { method: 'DELETE' }); }
  catch (e) { return alert('No se pudo eliminar: ' + e.message); }
  if (RETIRO_EDITANDO && RETIRO_EDITANDO.id === id) restablecerRetiro();
  msg('rtMsg', '🗑️ Retiro eliminado.', true);
  await pintarListaRetiros();
}

// ---------- Pago diario en la lista de clientes ----------
async function alternarPagoDiario(id, valor) {
  const c = CLIENTES.find(x => x.id === id);
  if (!c) return;
  if (!confirm(valor ? `¿Marcar a ${nombreBonito(c.nombre)} como cliente de PAGO DIARIO? Podrás recargarle saldo en "Recargas y Retiros".` : `¿Quitar a ${nombreBonito(c.nombre)} de PAGO DIARIO?`)) return;
  try { await api('/api/hipismo/clientes/' + encodeURIComponent(id) + '/pago-diario', { method: 'PUT', body: JSON.stringify({ pagoDiario: !!valor }) }); }
  catch (e) { return alert('No se pudo cambiar: ' + e.message); }
  await cargarClientes();
}

// ---------- Control de Pozos ----------
let CPO = null, CPO_FILTRO = 'todos', CPO_BUSCAR = '';
async function cargarControlPozosOf() {
  const caja = $('cpoTabla');
  caja.innerHTML = '<div class="vacio">Cargando…</div>';
  try { CPO = await api('/api/hipismo/control-pozos'); }
  catch (e) { caja.innerHTML = `<div class="vacio" style="color:var(--danger)">${esc(e.message)}</div>`; return; }
  pintarControlPozosOf();
}
function cpoFiltrar(f, btn) {
  CPO_FILTRO = f;
  document.querySelectorAll('#cpoFiltros button').forEach(b => b.classList.toggle('activo', b === btn));
  pintarControlPozosOf();
}
function cpoBuscar(v) { CPO_BUSCAR = normNombre(v); pintarControlPozosOf(); }
function filasControlPozos() {
  if (!CPO) return [];
  return CPO.clientes.filter(c => {
    if (CPO_BUSCAR && !normNombre(c.nombre).includes(CPO_BUSCAR)) return false;
    if (CPO_FILTRO === 'todos') return true;
    if (CPO_FILTRO === 'pago_diario') return c.tipo !== 'avalado';
    return c.semaforo === CPO_FILTRO;
  });
}
function pintarControlPozosOf() {
  if (!CPO) return;
  const r = CPO.resumen;
  $('cpoResumen').innerHTML = [
    ['Colocado', INF.dinero(r.totalColocado)], ['Jugado', INF.dinero(r.totalApostado)], ['Ganado / perdido', INF.dineroConSigno(r.totalNeto)],
    ['En juego', INF.dinero(r.totalEnJuego)], ['Disponible', INF.dinero(r.totalDisponible)],
    ['🔴 Rojos', r.rojos], ['🟡 Amarillos', r.amarillos], ['🟢 Verdes', r.verdes]
  ].map(([t, v]) => `<div class="cpo-kpi"><span>${t}</span><b>${v}</b></div>`).join('');
  const tipoTxt = { avalado: 'Con pozo', pago_diario: '💵 Pago diario', pago_diario_pozo: '💵 Pago diario + pozo' };
  const filas = filasControlPozos();
  $('cpoTabla').innerHTML = filas.length ? `<div class="tabla-wrap"><table class="tabla-simple"><thead><tr><th></th><th>Cliente</th><th>Tipo</th><th class="num">Colocado</th><th class="num">Jugado</th><th class="num">Ganado/perdido</th><th class="num">En juego</th><th class="num">Disponible</th><th class="num">%</th><th>Últ. recarga</th><th>Últ. jugada</th></tr></thead><tbody>${filas.map(c => `<tr>
      <td><span class="semaforo ${c.semaforo}" title="${c.semaforo}"></span></td><td><b>${esc(nombreBonito(c.nombre))}</b></td><td>${tipoTxt[c.tipo] || c.tipo}</td>
      <td class="num">${INF.dinero(c.colocado)}</td><td class="num">${INF.dinero(c.apostado)}</td><td class="num ${c.neto < 0 ? 'neg' : (c.neto > 0 ? 'pos' : '')}">${INF.dineroConSigno(c.neto)}</td>
      <td class="num">${INF.dinero(c.enJuego)}</td><td class="num"><b>${INF.dinero(c.disponible)}</b></td><td class="num">${c.colocado > 0 ? c.porcentaje + '%' : '—'}</td>
      <td>${c.ultimaRecarga ? INF.fechaCorta(c.ultimaRecarga) : '—'}</td><td>${c.ultimaJugada ? INF.fechaCorta(c.ultimaJugada) : '—'}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="vacio">No hay clientes con pozo o de pago diario con ese filtro.</div>';
}
function exportarControlPozosExcel() {
  const filas = filasControlPozos();
  descargarExcel('control_de_pozos', [['Cliente', 'Tipo', 'Colocado', 'Jugado', 'Ganado/perdido', 'En juego', 'Disponible', '% disponible', 'Última recarga', 'Última jugada', 'Semáforo']]
    .concat(filas.map(c => [nombreBonito(c.nombre), c.tipo, numExcel(c.colocado), numExcel(c.apostado), numExcel(c.neto), numExcel(c.enJuego), numExcel(c.disponible), c.colocado > 0 ? c.porcentaje : '', c.ultimaRecarga || '', c.ultimaJugada || '', c.semaforo])));
}
