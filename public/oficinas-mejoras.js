/* =================================================================
   HIPISMO OFICINAS — mejoras (05-11-2026, a pedido del usuario: "haz todas esas mejoras").
   Se carga DESPUÉS del script de hipismo-oficinas.html: usa sus ayudantes y variables ($, esc, api, fmt, msg, INF, FILAS, REGISTRO,
   HIPODROMOS, CLIENTES, GRUPO, queryPeriodo, nombreBonito, nombreHip, normNombre...) y engancha las funciones que ya existen.
     1. Permisos por empleado (oficinas_saldos / oficinas_informes / oficinas_eliminar), compatibles hacia atrás.
     2. Aviso de carreras pendientes de llegada en Balance General y Saldos con Pozos.
     3. Carga rápida: duplicar fila (Ctrl+D), contraparte ⇄, copiar las jugadas de otra carrera, aviso de pozo bajo antes de guardar.
     4. Registro: ver las jugadas de una carrera y editar UNA jugada directo.
     5. Cierre del Día y Historial de cambios.
     6. Descargar Excel del Balance General, Detallado, Comisión por Carrera, Cierre del Día e Historial.
   ================================================================= */

// ---------- 1. Permisos ----------
const PERMISOS_OFICINAS_FRONT = ['oficinas_saldos', 'oficinas_informes', 'oficinas_eliminar'];
function puedeOficina(clave) {
  if (!GRUPO || GRUPO.rol !== 'empleado') return true;
  const p = Array.isArray(GRUPO.permisos) ? GRUPO.permisos : [];
  return !p.some(x => PERMISOS_OFICINAS_FRONT.includes(x)) || p.includes(clave);
}
function aplicarPermisosOficina() {
  document.querySelectorAll('[data-perm]').forEach(el => { if (!puedeOficina(el.dataset.perm)) el.remove(); });
  // si la pestaña activa se quitó, vuelve a Jugadas
  if (!document.querySelector('.tab.activa')) irATab('jugadas');
}

// ---------- 2. Carreras pendientes en los informes ----------
async function avisarPendientesPeriodo(prefijo, idAviso) {
  const caja = $(idAviso);
  if (!caja) return;
  caja.className = 'aviso info oculto'; caja.innerHTML = '';
  try {
    const d = await api('/api/hipismo/oficinas/pendientes-periodo?' + queryPeriodo(prefijo));
    if (!d.total) return;
    const lista = d.carreras.slice(0, 8).map(c => `${esc(nombreHip(c.hipodromo))} carrera ${c.carrera} (${INF.fechaCorta(c.fecha).slice(0, 5)})`).join(' · ');
    caja.innerHTML = `⏳ <b>Hay ${d.total} ${d.total === 1 ? 'carrera guardada sin llegada' : 'carreras guardadas sin llegada'}</b> en este período: no cuentan en los saldos hasta que se les cargue la pizarra. ${lista}${d.total > 8 ? ' …' : ''}
      <button type="button" class="btn btn-sec btn-chico" style="margin-left:8px;" onclick="irATab('registro')">Ir al Registro</button>`;
    caja.classList.remove('oculto');
  } catch (e) { /* el aviso nunca estorba al informe */ }
}
(function enganchar() {
  const _cb = cargarBalance;
  cargarBalance = async function () { const r = _cb.apply(this, arguments); avisarPendientesPeriodo('bal', 'balPendientes'); return r; };
  const _cs = cargarSaldosPozos;
  cargarSaldosPozos = async function () { const r = _cs.apply(this, arguments); avisarPendientesPeriodo('sp', 'spPendientes'); return r; };
  // guardar datos para el Excel
  const _pc = pintarComision; pintarComision = function (d) { window.__COM = d; return _pc.apply(this, arguments); };
  const _pd = pintarDetalle; pintarDetalle = function (nombre, resp) { window.__DET = { nombre, resp }; return _pd.apply(this, arguments); };
  // el cuadre (con su pausa) también revisa el pozo de los jugadores
  const _pq = programarCuadre; programarCuadre = function () { const r = _pq.apply(this, arguments); revisarPozosTabla(); return r; };
})();

// ---------- 3. Carga rápida ----------
function duplicarFila(i) {
  const f = FILAS[i]; if (!f) return;
  FILAS.splice(i + 1, 0, { jugador: f.jugador, lado: f.lado, tipo: f.tipo, caballo: f.caballo, monto: f.monto });
  pintarTabla(); programarCuadre();
  const inp = document.querySelector(`#jTbody input[data-i="${i + 1}"][data-c="jugador"]`); if (inp) { inp.focus(); inp.select(); }
}
// Contraparte: la misma jugada (tipo, caballo y monto) del otro lado, para ponerle el jugador que la tomó.
function duplicarContraparte(i) {
  const f = FILAS[i]; if (!f) return;
  FILAS.splice(i + 1, 0, { jugador: '', lado: f.lado === 'jugo' ? 'dio' : 'jugo', tipo: f.tipo, caballo: f.caballo, monto: f.monto });
  pintarTabla(); programarCuadre();
  const inp = document.querySelector(`#jTbody input[data-i="${i + 1}"][data-c="jugador"]`); if (inp) inp.focus();
}
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== 'd') return;
  const t = e.target;
  if (!t || !t.dataset || t.dataset.i === undefined || !t.closest || !t.closest('#jTbody')) return;
  e.preventDefault(); duplicarFila(+t.dataset.i);
});
async function copiarDeOtraCarrera() {
  const h = $('jHipodromo').value, n = Number($('jCopiarN').value);
  if (!h) return msg('jMsg', 'Elige primero el hipódromo.', false);
  if (!n || n < 1) return msg('jMsg', 'Escribe el número de la carrera de donde copiar las jugadas.', false);
  let r;
  try { r = await api(`/api/hipismo/oficinas/carrera?hipodromoId=${encodeURIComponent(h)}&carrera=${n}&fecha=${encodeURIComponent($('jFecha').value)}`); }
  catch (e) { return msg('jMsg', e.message, false); }
  if (!r.existe || !r.filas || !r.filas.length) return msg('jMsg', `La carrera ${n} no tiene jugadas guardadas en ese día y hipódromo.`, false);
  const hayDatos = FILAS.some(f => f.jugador || f.monto);
  if (hayDatos && !confirm(`La tabla ya tiene jugadas. ¿Reemplazarlas por las ${r.filas.length} jugadas de la carrera ${n}?`)) return;
  FILAS = r.filas.map(f => ({ jugador: nombreBonito(f.jugador), lado: f.lado, tipo: f.tipo, caballo: f.caballo, monto: String(f.monto) }));
  pintarTabla(); programarCuadre();
  msg('jMsg', `📋 Copié ${FILAS.length} jugadas de la carrera ${n}. Corrige lo que cambie y agrega la llegada de esta carrera.`, true);
}

// Aviso de pozo: clientes con pozo o de pago diario cuyo total en esta carrera supera lo que les queda disponible. Solo avisa.
let POZOS_DISP = new Map();
async function cargarPozosDisp() {
  try {
    const d = await api('/api/hipismo/control-pozos');
    POZOS_DISP = new Map((d.clientes || []).map(c => [normNombre(c.nombre), c]));
  } catch (e) { POZOS_DISP = new Map(); }
  revisarPozosTabla();
}
function revisarPozosTabla() {
  const caja = $('jPozoAviso');
  if (!caja) return;
  const suma = new Map();
  FILAS.forEach(f => { const k = normNombre(f.jugador); const m = Number(String(f.monto).replace(',', '.')) || 0; if (k && m > 0) suma.set(k, (suma.get(k) || 0) + m); });
  const pasados = [];
  suma.forEach((total, k) => { const p = POZOS_DISP.get(k); if (p && p.colocado > 0 && total > p.disponible + 0.004) pasados.push({ k, nombre: p.nombre, total, disponible: p.disponible }); });
  const claves = new Set(pasados.map(x => x.k));
  document.querySelectorAll('#jTbody tr').forEach((tr, i) => {
    const f = FILAS[i]; tr.classList.toggle('fila-pozo', !!(f && claves.has(normNombre(f.jugador))));
  });
  if (!pasados.length) { caja.classList.add('oculto'); caja.innerHTML = ''; return; }
  caja.innerHTML = '⚠️ <b>Pozo bajo:</b> ' + pasados.map(x => `${esc(nombreBonito(x.nombre))} tiene disponible ${INF.dinero(x.disponible)} y en esta carrera suma ${INF.dinero(x.total)}`).join(' · ') + '. Se puede guardar igual: solo es un aviso.';
  caja.classList.remove('oculto');
}

// ---------- 4. Registro: ver las jugadas y editar UNA jugada ----------
async function verJugadasRegistro(btn, hipodromoId, numero) {
  const tr = btn.closest('tr');
  const siguiente = tr.nextElementSibling;
  if (siguiente && siguiente.classList.contains('reg-detalle')) { siguiente.remove(); btn.textContent = '👁️ Jugadas'; return; }
  btn.disabled = true;
  let r;
  try { r = await api(`/api/hipismo/oficinas/carrera?hipodromoId=${encodeURIComponent(hipodromoId)}&carrera=${numero}&fecha=${encodeURIComponent(REGISTRO.fecha)}`); }
  catch (e) { btn.disabled = false; return msg('rMsg', e.message, false); }
  btn.disabled = false;
  const filas = r.filas || [];
  const det = document.createElement('tr');
  det.className = 'reg-detalle';
  det.innerHTML = `<td colspan="7" style="background:var(--card-2);padding:8px 12px;">${filas.length ? `<table class="tabla-simple" style="min-width:0;"><thead><tr><th>#</th><th>Jugador</th><th>Jugó / Dio</th><th>Tipo</th><th>Caballo</th><th class="num">Monto</th><th></th></tr></thead><tbody>${filas.map((f, i) => `<tr><td>${i + 1}</td><td>${esc(nombreBonito(f.jugador))}</td><td>${f.lado === 'jugo' ? 'Jugó' : 'Dio'}</td><td>${esc(f.tipo)}</td><td>${esc(f.caballo)}</td><td class="num">${INF.dinero(f.monto)}</td>
      <td class="num"><button type="button" class="btn btn-sec btn-chico" onclick="abrirDelRegistro('${esc(hipodromoId)}', ${numero}, ${i})">✏️ Corregir esta jugada</button></td></tr>`).join('')}</tbody></table>` : '<span class="sub-linea">Esta carrera se cargó como plano en Hipismo Grupos Hípicos: no tiene tabla de jugadas para mostrar.</span>'}</td>`;
  tr.after(det);
  btn.textContent = '🙈 Ocultar';
}
(function enganchaRegistro() {
  const _ar = abrirDelRegistro;
  abrirDelRegistro = async function (hipodromoId, numero, indice) {
    await _ar.call(this, hipodromoId, numero);
    if (indice === undefined || indice === null) return;
    const inp = document.querySelector(`#jTbody input[data-i="${indice}"][data-c="monto"]`);
    if (!inp) return;
    const tr = inp.closest('tr'); if (tr) { tr.classList.add('fila-resaltada'); setTimeout(() => tr.classList.remove('fila-resaltada'), 4000); }
    inp.focus(); inp.select();
  };
  const _pr = pintarRegistro;
  pintarRegistro = function () {
    _pr.apply(this, arguments);
    // agrega el botón "Jugadas" en cada fila de carrera (sin romper el clic de la fila, que sigue abriendo la carrera completa)
    document.querySelectorAll('#rLista tr.reg-fila').forEach(tr => {
      const m = /abrirDelRegistro\((?:'([^']*)'|null),\s*(\d+)\)/.exec(tr.getAttribute('onclick') || '');
      const celda = tr.lastElementChild;
      if (!m || !m[1] || !celda || celda.querySelector('.btn-ver-jugadas')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-sec btn-chico btn-ver-jugadas'; b.style.marginRight = '6px'; b.textContent = '👁️ Jugadas';
      b.setAttribute('onclick', `event.stopPropagation(); verJugadasRegistro(this, '${m[1]}', ${m[2]})`);
      celda.prepend(b);
    });
  };
})();

// ---------- 5a. Cierre del Día ----------
let CIERRE_DIA = null;
function moverDiaCierre(n) {
  const f = new Date(($('cdFecha').value || fechaHoyVenezuela()) + 'T12:00:00'); f.setDate(f.getDate() + n);
  $('cdFecha').value = f.toISOString().slice(0, 10); cargarCierreDia();
}
async function cargarCierreDia() {
  const caja = $('cdContenido');
  if (!$('cdFecha').value) $('cdFecha').value = fechaHoyVenezuela();
  caja.innerHTML = '<div class="vacio">Cargando…</div>';
  try { CIERRE_DIA = await api('/api/hipismo/oficinas/cierre-dia?fecha=' + encodeURIComponent($('cdFecha').value)); }
  catch (e) { caja.innerHTML = `<div class="vacio" style="color:var(--danger)">${esc(e.message)}</div>`; return; }
  pintarCierreDia();
}
function pintarCierreDia() {
  const d = CIERRE_DIA; if (!d) return;
  const s = d.saldos;
  const estado = !d.totales.carreras ? ['vacio', 'Sin carreras cargadas', 'Ese día no hay nada cargado.']
    : d.listo ? ['ok', '✅ El día está completo y cuadra', 'Todas las carreras están calculadas y el saldo de los clientes más la comisión de la oficina da 0.']
    : ['mal', '⚠️ El día todavía no está cerrado', 'Revisa los avisos de abajo.'];
  const hips = ordenarHipodromos(d.hipodromos, h => h.nombre).map(h => `<div class="cd-hip"><div class="cd-hip-cab"><b>${banderaHip(h.nombre)} ${esc(nombreHip(h.nombre))}</b>
      <span class="rec-chip">✅ ${h.calculadas} calculadas</span>${h.pendientes ? `<span class="rec-chip" style="color:#92400e;background:#fffbeb;">⏳ ${h.pendientes} sin llegada</span>` : ''}${h.faltantes.length ? `<span class="rec-chip" style="color:#92400e;background:#fffbeb;">❔ sin carga: ${h.faltantes.join(', ')}</span>` : ''}</div>
      <div class="cargadas">${h.carreras.map(c => `<span class="chip-carrera${c.estado === 'pendiente' ? ' pend' : ''}" style="cursor:default;">${c.numero}${c.estado === 'pendiente' ? ' ⏳' : ' ✓'}</span>`).join('')}</div></div>`).join('');
  $('cdContenido').innerHTML = `
    <div class="cd-estado ${estado[0]}"><b>${estado[1]}</b><span>${estado[2]}</span></div>
    ${d.avisos.length ? `<ul class="cd-avisos">${d.avisos.map(a => `<li class="${a.nivel}">${esc(a.texto)}</li>`).join('')}</ul>` : ''}
    <div class="cpo-kpis">
      <div class="cpo-kpi"><span>Carreras</span><b>${d.totales.carreras}</b></div>
      <div class="cpo-kpi"><span>Calculadas</span><b>${d.totales.calculadas}</b></div>
      <div class="cpo-kpi"><span>Sin llegada</span><b>${d.totales.pendientes}</b></div>
      <div class="cpo-kpi"><span>Saldo de los clientes</span><b>${INF.dineroConSigno(s.totalClientes)}</b></div>
      <div class="cpo-kpi"><span>Comisión oficina</span><b>${INF.dinero(s.comisionOficina)}</b></div>
      <div class="cpo-kpi"><span>Diferencia</span><b style="color:${s.cuadra ? 'var(--ok)' : 'var(--danger)'}">${INF.dineroConSigno(s.diferencia)}</b></div>
    </div>${hips}`;
}
function copiarCierreDiaTexto() {
  const d = CIERRE_DIA; if (!d) return;
  const l = [`CIERRE DEL DÍA ${INF.nombreDia(d.fecha).toUpperCase()} ${INF.fechaCorta(d.fecha)}`, ''];
  d.hipodromos.forEach(h => l.push(`${nombreHip(h.nombre)}: ${h.calculadas} calculadas${h.pendientes ? `, ${h.pendientes} sin llegada` : ''}${h.faltantes.length ? `, sin carga: ${h.faltantes.join(', ')}` : ''}`));
  l.push('', `Saldo de los clientes: ${INF.dineroConSigno(d.saldos.totalClientes)}`, `Comisión oficina: ${INF.dinero(d.saldos.comisionOficina)}`, d.saldos.cuadra ? '✅ Cuadra' : `⚠️ No cuadra (diferencia ${INF.dineroConSigno(d.saldos.diferencia)})`);
  (navigator.clipboard ? navigator.clipboard.writeText(l.join('\n')) : Promise.reject()).then(() => msg('cdMsg', '📋 Resumen copiado.', true), () => msg('cdMsg', 'No pude copiar: tu navegador no lo permite.', false));
}

// ---------- 5b. Historial de cambios ----------
const GRUPOS_HISTORIAL = {
  ediciones: ['PLANO_EDITADO', 'ADELANTADA_EDITADA', 'WINNER_EDITADO', 'PIZARRA_EDITADA', 'TERCIOS_ADELANTADA_EDITADA'],
  eliminaciones: ['PLANO_ELIMINADO', 'ADELANTADA_ELIMINADA', 'JORNADA_ELIMINADA', 'WINNER_ELIMINADO', 'PIZARRA_ELIMINADA', 'TERCIOS_ADELANTADA_ELIMINADA', 'REMATE_MANUAL_ELIMINADO', 'PENDIENTE_ELIMINADO'],
  pozos: ['APUESTA_SOBRE_POZO', 'POZO_BAJO'],
  cuadre: ['CUADRE_DESCUADRADO']
};
const ETIQUETAS_HISTORIAL = {
  PLANO_EDITADO: '✏️ Carrera editada', PLANO_ELIMINADO: '🗑️ Carrera eliminada', PENDIENTE_ELIMINADO: '🗑️ Pendiente eliminada', JORNADA_ELIMINADA: '🗑️ Jornada eliminada',
  ADELANTADA_EDITADA: '✏️ Adelantada editada', ADELANTADA_ELIMINADA: '🗑️ Adelantada eliminada', WINNER_EDITADO: '✏️ Winner editado', WINNER_ELIMINADO: '🗑️ Winner eliminado',
  PIZARRA_EDITADA: '✏️ Pizarra editada', PIZARRA_ELIMINADA: '🗑️ Pizarra eliminada', TERCIOS_ADELANTADA_EDITADA: '✏️ Tercios adelantada editada', TERCIOS_ADELANTADA_ELIMINADA: '🗑️ Tercios adelantada eliminada',
  REMATE_MANUAL_ELIMINADO: '🗑️ Remate eliminado', APUESTA_SOBRE_POZO: '⚠️ Apuesta sobre el pozo', POZO_BAJO: '🔴 Pozo bajo', CUADRE_DESCUADRADO: '⚠️ Cuadre descuadrado'
};
let HISTORIAL = [];
async function cargarHistorial() {
  const caja = $('hiTabla');
  caja.innerHTML = '<div class="vacio">Cargando…</div>';
  try { HISTORIAL = await api('/api/hipismo/alertas'); }
  catch (e) { caja.innerHTML = `<div class="vacio" style="color:var(--danger)">${esc(e.message)}</div>`; return; }
  pintarHistorial();
}
function filasHistorial() {
  const g = $('hiTipo').value, q = normNombre($('hiBuscar').value), desde = $('hiDesde').value, hasta = $('hiHasta').value;
  return (HISTORIAL || []).filter(a => {
    if (g !== 'todo' && !(GRUPOS_HISTORIAL[g] || []).includes(a.tipo)) return false;
    const dia = String(a.creado_en || '').slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    if (q && !normNombre([a.usuario, a.hipodromo_nombre, a.mensaje, a.tipo].join(' ')).includes(q)) return false;
    return true;
  });
}
function fechaHoraVE(iso) {
  const d = new Date(iso); if (isNaN(d)) return '—';
  const v = new Date(d.getTime() - 4 * 3600 * 1000);
  return v.toISOString().slice(8, 10) + '/' + v.toISOString().slice(5, 7) + '/' + v.toISOString().slice(0, 4) + ' ' + v.toISOString().slice(11, 16);
}
function pintarHistorial() {
  const filas = filasHistorial();
  $('hiTabla').innerHTML = filas.length ? `<div class="tabla-wrap"><table class="tabla-simple"><thead><tr><th>Cuándo</th><th>Qué pasó</th><th>Usuario</th><th>Carrera</th><th>Detalle</th></tr></thead><tbody>${filas.map(a => `<tr>
      <td style="white-space:nowrap;">${fechaHoraVE(a.creado_en)}</td><td style="white-space:nowrap;">${esc(ETIQUETAS_HISTORIAL[a.tipo] || a.tipo)}</td><td>${esc(a.usuario || '—')}</td>
      <td style="white-space:nowrap;">${a.hipodromo_nombre ? esc(nombreHip(a.hipodromo_nombre)) + (a.carrera_numero ? ' · ' + a.carrera_numero : '') : '—'}${a.fecha ? ' <span class="sub-linea">(' + INF.fechaCorta(String(a.fecha).slice(0, 10)) + ')</span>' : ''}</td><td>${esc(a.mensaje || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="vacio">No hay cambios con ese filtro.</div>';
}

// ---------- 6. Excel ----------
function exportarExcel(que) {
  if (que === 'balance') {
    if (!BALANCE) return;
    const b = INF.armarBalance(BALANCE, esItemBalance);
    descargarExcel('balance_general', [['Cliente / ítem', 'Saldo']].concat(b.filas.map(f => [nombreBonito(f.nombre) + (f.esItem ? ' (ÍTEM)' : ''), numExcel(f.saldo)]),
      [['TOTAL DE TODOS LOS CLIENTES E ÍTEMS', numExcel(b.totalClientes)], ['COMISIÓN OFICINA ' + (GRUPO.nombre || '').toUpperCase(), numExcel(b.comisionOficina)], ['Diferencia sin ubicar', numExcel(b.diferencia)]]));
  } else if (que === 'comision') {
    const d = window.__COM; if (!d) return;
    const filas = [['Fecha', 'Hipódromo', 'Carrera', 'Comisión 5%', 'Devuelto', 'Comisión neta']];
    d.dias.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(dia => dia.hipodromos.forEach(h => h.carreras.forEach(c => filas.push([dia.fecha, nombreHip(h.nombre), c.carreraNumero, numExcel(c.bruta), numExcel(c.devuelto), numExcel(c.neta)]))));
    filas.push(['TOTAL DE LAS CARRERAS', '', '', numExcel(d.totales.bruta), numExcel(d.totales.devuelto), numExcel(d.totales.neta)]);
    if (Math.abs(d.otrosConceptos) >= 0.005) filas.push(['Comisión de jugadas adelantadas (no ligada a una carrera)', '', '', '', '', numExcel(d.otrosConceptos)]);
    filas.push(['COMISIÓN OFICINA', '', '', '', '', numExcel(d.comisionOficina)]);
    descargarExcel('comision_por_carrera', filas);
  } else if (que === 'detalle') {
    const x = window.__DET; if (!x) return;
    const det = INF.armarDetalleCliente(x.resp);
    const filas = [['Cliente', 'Fecha', 'Hipódromo / ítem', 'Carrera', 'Detalle', 'Resultado']];
    det.dias.forEach(dia => dia.hipodromos.forEach(h => h.carreras.forEach(c => c.lineas.forEach(l => filas.push([nombreBonito(x.nombre), dia.fecha, h.esCarreras ? nombreHip(h.nombre) : h.nombre, c.numero || '', l.texto, numExcel(l.resultado)])))));
    filas.push([nombreBonito(x.nombre), 'TOTAL DEL PERÍODO', '', '', '', numExcel(det.totalPeriodo)]);
    descargarExcel('detallado_' + normNombre(x.nombre).toLowerCase().replace(/\s+/g, '_'), filas);
  } else if (que === 'cierredia') {
    const d = CIERRE_DIA; if (!d) return;
    const filas = [['Hipódromo', 'Carrera', 'Estado']];
    d.hipodromos.forEach(h => { h.carreras.forEach(c => filas.push([nombreHip(h.nombre), c.numero, c.estado === 'pendiente' ? 'Pendiente de llegada' : 'Calculada'])); h.faltantes.forEach(n => filas.push([nombreHip(h.nombre), n, 'Sin carga'])); });
    filas.push([], ['Saldo de los clientes', '', numExcel(d.saldos.totalClientes)], ['Comisión oficina', '', numExcel(d.saldos.comisionOficina)], ['Diferencia', '', numExcel(d.saldos.diferencia)]);
    descargarExcel('cierre_del_dia_' + d.fecha, filas);
  } else if (que === 'historial') {
    descargarExcel('historial_de_cambios', [['Fecha y hora', 'Qué pasó', 'Usuario', 'Hipódromo', 'Carrera', 'Fecha de la carrera', 'Detalle']]
      .concat(filasHistorial().map(a => [fechaHoraVE(a.creado_en), ETIQUETAS_HISTORIAL[a.tipo] || a.tipo, a.usuario || '', a.hipodromo_nombre ? nombreHip(a.hipodromo_nombre) : '', a.carrera_numero || '', a.fecha ? String(a.fecha).slice(0, 10) : '', a.mensaje || ''])));
  }
}

// ---------- arranque ----------
(function arrancarMejoras() {
  aplicarPermisosOficina();
  const _it = irATab;
  irATab = function (t) {
    _it.apply(this, arguments);
    if (t === 'cierredia') cargarCierreDia();
    if (t === 'historial') cargarHistorial();
    if (t === 'jugadas') cargarPozosDisp();
  };
  const _gc = guardarCarrera;
  guardarCarrera = async function () { const r = await _gc.apply(this, arguments); cargarPozosDisp(); return r; };
  cargarPozosDisp();
})();
