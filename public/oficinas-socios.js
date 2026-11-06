// =================================================================
// HIPISMO OFICINAS — Socios (05-11-2026): lo mismo que Hipismo Grupos Hípicos pero con la pantalla verde de Oficinas.
//   Configuración > Socios        crear socios (suma EXACTAMENTE 100%) y asignarles clientes
//   🤝 Comisiones por Socios      cuánto produjo cada cliente en comisión, por socio (suma = comisión de Balance General)
//   🤝 Balance por Socios         el saldo real de cada cliente por socio y la comisión que le toca a cada uno
//   Saldos con Pozos              elegir quién sale en la imagen / texto que se manda a los clientes
// Las rutas ya existen (GET/PUT /socios, PUT /socios/asignar, GET /comisiones-socios, GET /balance-socios,
// GET/PUT /pozos-plano-excluidos). Un grupo sin socios no ve nada de esto y calcula como siempre.
// Usa las funciones de la página: api, $, esc, msg, iniciarPeriodo, queryPeriodo, ponerInforme, cabeceraInforme,
// copiarImagenHD, descargarPDF, descargarExcel (oficinas-saldos.js), nombreBonito, normNombre, CLIENTES, cargarClientes.
// =================================================================
(function () {
  'use strict';
  const INFO = window.OficinasInformes;
  const dinero = n => INFO.dinero(n);
  const conSigno = n => INFO.dineroConSigno(n);
  const pctTxt = p => Number(p).toLocaleString('es-VE', { maximumFractionDigits: 4 });
  const tituloAvaladosPor = nombre => 'CLIENTES AVALADOS POR ' + String(nombre || '').trim().replace(/^(clientes\s+)?avalados?\s+por\s+/i, '').toUpperCase();
  const esAdmin = () => !GRUPO || GRUPO.rol !== 'empleado';
  const quitarTildes = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let SOCIOS = [];
  let EDITANDO = [];
  let SIN_TABLA = false;

  // ---------- visibilidad de las pestañas ----------
  function actualizarVisibilidad() {
    ['comisionessocios', 'balancesocios'].forEach(t => {
      const b = document.querySelector('.tab[data-tab="' + t + '"]');
      if (b) b.classList.toggle('oculto', !SOCIOS.length);
    });
  }
  async function cargarSociosOf() {
    try {
      const r = await api('/api/hipismo/socios');
      SOCIOS = Array.isArray(r.socios) ? r.socios : [];
      SIN_TABLA = !!r.sinTabla;
    } catch (e) { /* sin conexión o sin permiso: queda lo que había */ }
    actualizarVisibilidad();
  }

  // ---------- Configuración > Socios ----------
  async function entrarSocios() {
    await cargarSociosOf();
    EDITANDO = SOCIOS.map(s => ({ id: s.id, nombre: s.nombre, porcentaje: s.porcentaje }));
    if (!CLIENTES.length) await cargarClientes();
    msg('socMsg', SIN_TABLA ? 'Falta correr el SQL pendiente en Supabase (tabla hipismo_socios) para poder guardar socios.' : '', false);
    pintarFilasSocios();
    pintarAsignacion();
  }
  function sumaEditando() { return EDITANDO.reduce((a, s) => a + Math.round((Number(s.porcentaje) || 0) * 10000), 0) / 10000; }
  function pintarSuma() {
    const el = $('socSuma'), btn = $('socGuardar');
    if (!el) return;
    if (!EDITANDO.length) { el.className = 'soc-cuadre ok'; el.textContent = 'Sin socios: la oficina calcula la comisión como siempre.'; btn.disabled = false; return; }
    const suma = sumaEditando();
    if (Math.round(suma * 10000) === 1000000) { el.className = 'soc-cuadre ok'; el.textContent = '✅ La distribución suma exactamente 100%.'; btn.disabled = false; }
    else {
      const dif = Math.round((100 - suma) * 10000) / 10000;
      el.className = 'soc-cuadre mal'; el.textContent = `Suma ${pctTxt(suma)}% — ${dif > 0 ? 'faltan' : 'sobran'} ${pctTxt(Math.abs(dif))}% para llegar a 100%.`; btn.disabled = true;
    }
  }
  function pintarFilasSocios() {
    const cont = $('socFilas');
    const cuenta = new Map(SOCIOS.map(s => [s.id, s.clientes]));
    if (!EDITANDO.length) cont.innerHTML = '<div class="vacio">Todavía no hay socios. Pulsa "+ Agregar socio" para crear el primero.</div>';
    else cont.innerHTML = EDITANDO.map((s, i) => `<div class="soc-fila">
        <div class="soc-nombre"><label>Socio</label><input type="text" value="${esc(s.nombre || '')}" placeholder="Nombre del socio" data-i="${i}" data-c="nombre" autocomplete="off"></div>
        <div class="soc-pct"><label>% que le toca</label><input type="number" step="0.01" min="0" max="100" value="${s.porcentaje === '' ? '' : (Number(s.porcentaje) || 0)}" data-i="${i}" data-c="porcentaje"></div>
        <div class="soc-n">${s.id ? (cuenta.get(s.id) || 0) + ' cliente(s)' : 'nuevo'}</div>
        <button type="button" class="btn btn-sec btn-chico" data-quitar="${i}" title="Quitar socio">🗑️</button></div>`).join('');
    pintarSuma();
  }
  function agregarSocio() { EDITANDO.push({ id: null, nombre: '', porcentaje: EDITANDO.length ? 0 : 100 }); pintarFilasSocios(); }
  function quitarSocio(i) {
    const s = EDITANDO[i];
    const original = s && s.id ? SOCIOS.find(x => x.id === s.id) : null;
    if (original && original.clientes > 0 && !confirm(`${original.nombre} tiene ${original.clientes} cliente(s). Si lo quitas y guardas, esos clientes quedan sin socio. ¿Quitarlo?`)) return;
    EDITANDO.splice(i, 1); pintarFilasSocios();
  }
  async function guardarSocios() {
    msg('socMsg', 'Guardando…', true);
    try {
      const r = await api('/api/hipismo/socios', { method: 'PUT', body: JSON.stringify({ socios: EDITANDO.map(s => ({ id: s.id, nombre: s.nombre, porcentaje: Number(s.porcentaje) || 0 })) }) });
      SOCIOS = r.socios || [];
      EDITANDO = SOCIOS.map(s => ({ id: s.id, nombre: s.nombre, porcentaje: s.porcentaje }));
      actualizarVisibilidad();
      msg('socMsg', SOCIOS.length ? '✅ Socios guardados.' : '✅ Sin socios: la oficina calcula como siempre.', true);
      await cargarClientes();
      pintarFilasSocios(); pintarAsignacion();
    } catch (e) { msg('socMsg', e.message, false); }
  }
  function pintarAsignacion() {
    const card = $('socAsignar');
    card.classList.toggle('oculto', !SOCIOS.length);
    if (!SOCIOS.length) return;
    const ops = ['<option value="">— Sin socio —</option>'].concat(SOCIOS.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`)).join('');
    const masivo = $('socMasivo'), previo = masivo.value;
    masivo.innerHTML = ops; masivo.value = previo;
    const filtro = quitarTildes($('socBuscar').value);
    const lista = CLIENTES.filter(j => !filtro || quitarTildes(j.nombre).includes(filtro)).slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    $('socLista').innerHTML = lista.length ? lista.map(j => `<div class="soc-cli">
        <label><input type="checkbox" class="soc-chk" value="${esc(j.nombre)}"> <span>${esc(nombreBonito(j.nombre))}</span>${j.es_cuenta_comision ? ' <small>cuenta de comisión</small>' : ''}</label>
        <select data-cliente="${esc(j.nombre)}">${ops.replace(`value="${esc(j.hipismo_socio_id || '')}"`, `value="${esc(j.hipismo_socio_id || '')}" selected`)}</select></div>`).join('')
      : '<div class="vacio">No hay clientes que coincidan.</div>';
  }
  async function asignar(nombres, socioId) {
    try {
      await api('/api/hipismo/socios/asignar', { method: 'PUT', body: JSON.stringify({ clientes: nombres, socioId: socioId || null }) });
      nombres.forEach(n => { const j = CLIENTES.find(x => x.nombre === n); if (j) j.hipismo_socio_id = socioId || null; });
      msg('socAsigMsg', '✅ Guardado.', true);
      await cargarSociosOf(); pintarFilasSocios();
    } catch (e) { msg('socAsigMsg', e.message, false); pintarAsignacion(); }
  }
  async function asignarMarcados() {
    const nombres = Array.from(document.querySelectorAll('.soc-chk:checked')).map(c => c.value);
    if (!nombres.length) { msg('socAsigMsg', 'Marca al menos un cliente.', false); return; }
    await asignar(nombres, $('socMasivo').value);
    pintarAsignacion();
  }

  // ---------- Comisiones por Socios ----------
  let COMISIONES = null, BALANCE = null;
  const textoPeriodo = d => {
    if (!d || !d.rango) return '';
    const r = `${INFO.fechaCorta(d.rango.desde)} al ${INFO.fechaCorta(d.rango.hasta)}`;
    return d.rangoPersonalizado || !d.numeroSemana ? `Del ${r}` : `Semana ${d.numeroSemana} — ${r}`;
  };
  function tarjeta(titulo, pct, filasHtml, pie) {
    return `<div class="soc-tarjeta"><div class="soc-cab"><span>${esc(titulo)}</span>${pct ? `<span class="pct">${esc(pct)}</span>` : ''}</div>${filasHtml}${pie}</div>`;
  }
  async function cargarComisionesSocios() {
    const caja = $('csCaptura'); caja.innerHTML = '<div class="vacio">Cargando…</div>';
    $('csCuadre').className = 'soc-cuadre'; $('csCuadre').textContent = '';
    try {
      const d = await api('/api/hipismo/comisiones-socios?' + queryPeriodo('cs'));
      COMISIONES = d; pintarComisionesSocios();
    } catch (e) { COMISIONES = null; caja.innerHTML = `<div class="vacio" style="color:var(--danger)">${esc(e.message)}</div>`; }
  }
  function pintarComisionesSocios() {
    const d = COMISIONES; if (!d) return;
    if (!d.activo) { ponerInforme('csCaptura', '<div class="vacio">Esta oficina todavía no tiene socios. Créalos en Configuración &gt; Socios.</div>'); return; }
    const filas = (cl, vacio) => cl.length ? cl.map(c => `<div class="soc-f${c.esAjuste ? ' ajuste' : ''}"><span>${esc(c.esAjuste ? c.nombre : nombreBonito(c.nombre))}</span><b>${dinero(c.monto)}</b></div>`).join('') : `<div class="soc-vacio">${vacio}</div>`;
    const pie = total => `<div class="soc-total"><span>TOTALES</span><span>${dinero(total)}</span></div>`;
    let html = cabeceraInforme('Comisiones por Avales y Socios', d, '') + '<div class="soc-rejilla">';
    d.socios.forEach(s => { html += tarjeta(tituloAvaladosPor(s.nombre), pctTxt(s.porcentaje) + '%', filas(s.clientes, 'Sin comisión en este período.'), pie(s.total)); });
    if (d.sinSocio) html += tarjeta('SIN SOCIO', '', filas(d.sinSocio.clientes, ''), pie(d.sinSocio.total));
    html += '</div>';
    html += `<div class="soc-caja"><span>💼 COMISIÓN TOTAL</span><b>${dinero(d.comisionTotal)}</b></div>`;
    html += tarjeta('POR SOCIO', 'según su % del total', d.porSocio.map(s => `<div class="soc-f"><span>${esc(s.nombre)} <small>(${pctTxt(s.porcentaje)}%)</small></span><b>${dinero(s.monto)}</b></div>`).join(''),
      `<div class="soc-total"><span>TOTAL</span><span>${dinero(d.porSocio.reduce((a, s) => a + s.monto, 0))}</span></div>`);
    ponerInforme('csCaptura', html);
    const c = $('csCuadre');
    if (d.cuadra) { c.className = 'soc-cuadre ok'; c.textContent = `✅ Cuadra al centavo con la comisión del Balance General (${dinero(d.comisionTotal)}).`; }
    else { c.className = 'soc-cuadre mal'; c.textContent = `⚠️ No cuadra: las tarjetas suman ${dinero(d.sumaTarjetas)} y la comisión es ${dinero(d.comisionTotal)} (diferencia ${dinero(d.diferencia)}).`; }
  }
  function textoComisiones(d) {
    let t = `*Comisiones por Avales y Socios — ${textoPeriodo(d)}*\n────────────────────────────────\n`;
    const bloque = (titulo, cl, total) => {
      t += `\n*${titulo}*\n`;
      cl.forEach(c => { t += `  • ${c.esAjuste ? c.nombre : nombreBonito(c.nombre)}:  ${dinero(c.monto)}\n`; });
      t += `  TOTALES: ${dinero(total)}\n`;
    };
    d.socios.forEach(s => bloque(`${tituloAvaladosPor(s.nombre)} (${pctTxt(s.porcentaje)}%)`, s.clientes, s.total));
    if (d.sinSocio) bloque('SIN SOCIO', d.sinSocio.clientes, d.sinSocio.total);
    t += `\n──────────────────────────────\n*COMISIÓN TOTAL: ${dinero(d.comisionTotal)}*\n\n*POR SOCIO*\n`;
    d.porSocio.forEach(s => { t += `  • ${s.nombre} (${pctTxt(s.porcentaje)}%):  ${dinero(s.monto)}\n`; });
    return t;
  }

  // ---------- Balance por Socios ----------
  async function cargarBalanceSocios() {
    const caja = $('bsCaptura'); caja.innerHTML = '<div class="vacio">Cargando…</div>';
    $('bsCuadre').className = 'soc-cuadre'; $('bsCuadre').textContent = '';
    try {
      const d = await api('/api/hipismo/balance-socios?' + queryPeriodo('bs'));
      BALANCE = d; pintarBalanceSocios();
    } catch (e) { BALANCE = null; caja.innerHTML = `<div class="vacio" style="color:var(--danger)">${esc(e.message)}</div>`; }
  }
  function pintarBalanceSocios() {
    const d = BALANCE; if (!d) return;
    if (!d.activo) { ponerInforme('bsCaptura', '<div class="vacio">Esta oficina todavía no tiene socios. Créalos en Configuración &gt; Socios.</div>'); return; }
    const filas = cl => cl.length ? cl.map(c => `<div class="soc-f"><span>${esc(nombreBonito(c.nombre))}</span><b class="${c.saldo < 0 ? 'neg' : 'pos'}">${conSigno(c.saldo)}</b></div>`).join('') : '<div class="soc-vacio">Sin saldo en este período.</div>';
    const pie = (total, comTxt, com) => `<div class="soc-sub"><span>TOTAL CLIENTES</span><span>${conSigno(total)}</span></div>` + (comTxt ? `<div class="soc-com"><span>${comTxt}</span><span>${dinero(com)}</span></div>` : '');
    let html = cabeceraInforme('Balance por Socios', d, '') + '<div class="soc-rejilla">';
    d.socios.forEach(s => { html += tarjeta(tituloAvaladosPor(s.nombre), pctTxt(s.porcentaje) + '%', filas(s.clientes), pie(s.totalSaldo, `COMISIÓN (${pctTxt(s.porcentaje)}%)`, s.comision)); });
    if (d.sinSocio) html += tarjeta('SIN SOCIO', '', filas(d.sinSocio.clientes), pie(d.sinSocio.totalSaldo, '', 0));
    html += '</div>';
    html += `<div class="soc-caja"><span>💼 COMISIÓN TOTAL DE LA OFICINA</span><b>${dinero(d.comisionTotal)}</b></div>`;
    ponerInforme('bsCaptura', html);
    const c = $('bsCuadre');
    if (d.cuadra) { c.className = 'soc-cuadre ok'; c.textContent = `✅ Los saldos son los del Balance General y las comisiones de los socios suman exacto la comisión total (${dinero(d.comisionTotal)}).`; }
    else { c.className = 'soc-cuadre mal'; c.textContent = `⚠️ Las comisiones de los socios suman ${dinero(d.sumaComisiones)} y la comisión total es ${dinero(d.comisionTotal)}.`; }
  }
  function textoBalance(d) {
    let t = `*Balance por Socios — ${textoPeriodo(d)}*\n────────────────────────────────\n`;
    const bloque = (titulo, cl, total, comTxt, com) => {
      t += `\n*${titulo}*\n`;
      cl.forEach(c => { t += `  • ${nombreBonito(c.nombre)}:  ${conSigno(c.saldo)}\n`; });
      t += `  TOTAL CLIENTES: ${conSigno(total)}\n`;
      if (comTxt) t += `  *${comTxt}: ${dinero(com)}*\n`;
    };
    d.socios.forEach(s => bloque(`${tituloAvaladosPor(s.nombre)} (${pctTxt(s.porcentaje)}%)`, s.clientes, s.totalSaldo, `COMISIÓN (${pctTxt(s.porcentaje)}%)`, s.comision));
    if (d.sinSocio) bloque('SIN SOCIO', d.sinSocio.clientes, d.sinSocio.totalSaldo, '', 0);
    t += `\n──────────────────────────────\n*COMISIÓN TOTAL: ${dinero(d.comisionTotal)}*`;
    return t;
  }
  function copiarTexto(texto, idAviso) {
    const a = $(idAviso);
    const ok = () => { a.textContent = '✅ Texto copiado'; setTimeout(() => { a.textContent = ''; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(ok).catch(() => { a.textContent = 'No se pudo copiar'; });
    else a.textContent = 'No se pudo copiar';
  }
  function copiarComisionesTexto() { if (COMISIONES && COMISIONES.activo) copiarTexto(textoComisiones(COMISIONES), 'csToast'); }
  function copiarBalanceTexto() { if (BALANCE && BALANCE.activo) copiarTexto(textoBalance(BALANCE), 'bsToast'); }
  function excelComisionesSocios() {
    const d = COMISIONES; if (!d || !d.activo) return;
    const f = [['Socio', 'Cliente', 'Comisión']];
    d.socios.forEach(s => { s.clientes.forEach(c => f.push([s.nombre, c.esAjuste ? c.nombre : nombreBonito(c.nombre), numExcel(c.monto)])); f.push([s.nombre, 'TOTAL (' + pctTxt(s.porcentaje) + '%)', numExcel(s.total)]); });
    if (d.sinSocio) { d.sinSocio.clientes.forEach(c => f.push(['SIN SOCIO', c.esAjuste ? c.nombre : nombreBonito(c.nombre), numExcel(c.monto)])); f.push(['SIN SOCIO', 'TOTAL', numExcel(d.sinSocio.total)]); }
    f.push(['', 'COMISIÓN TOTAL', numExcel(d.comisionTotal)]);
    d.porSocio.forEach(s => f.push([s.nombre, 'Le toca (' + pctTxt(s.porcentaje) + '%)', numExcel(s.monto)]));
    descargarExcel('comisiones_por_socios_' + d.rango.desde + '_' + d.rango.hasta, f);
  }
  function excelBalanceSocios() {
    const d = BALANCE; if (!d || !d.activo) return;
    const f = [['Socio', 'Cliente', 'Saldo']];
    d.socios.forEach(s => { s.clientes.forEach(c => f.push([s.nombre, nombreBonito(c.nombre), numExcel(c.saldo)])); f.push([s.nombre, 'TOTAL CLIENTES', numExcel(s.totalSaldo)]); f.push([s.nombre, 'COMISIÓN (' + pctTxt(s.porcentaje) + '%)', numExcel(s.comision)]); });
    if (d.sinSocio) { d.sinSocio.clientes.forEach(c => f.push(['SIN SOCIO', nombreBonito(c.nombre), numExcel(c.saldo)])); f.push(['SIN SOCIO', 'TOTAL CLIENTES', numExcel(d.sinSocio.totalSaldo)]); }
    f.push(['', 'COMISIÓN TOTAL', numExcel(d.comisionTotal)]);
    descargarExcel('balance_por_socios_' + d.rango.desde + '_' + d.rango.hasta, f);
  }

  // ---------- Saldos con Pozos: quién sale en el plano ----------
  // La lista de los que NO salen se guarda en el servidor (la misma de Grupos Hípicos: es el mismo grupo). Si falta el SQL
  // (tabla hipismo_pozos_excluidos) se queda en el navegador.
  const CLAVE_EXC = 'oficinas_plano_excluidos';
  let EXCLUIDOS = new Set(), EXC_CARGADOS = false, EXC_SERVIDOR = true;
  async function cargarExcluidos() {
    if (EXC_CARGADOS) return;
    let local = [];
    try { local = JSON.parse(localStorage.getItem(CLAVE_EXC) || '[]'); } catch (e) { local = []; }
    try {
      const r = await api('/api/hipismo/pozos-plano-excluidos');
      if (r.sinTabla) { EXC_SERVIDOR = false; EXCLUIDOS = new Set(local); }
      else { EXC_SERVIDOR = true; EXCLUIDOS = new Set(r.nombres || []); }
    } catch (e) { EXCLUIDOS = new Set(local); }
    EXC_CARGADOS = true;
  }
  async function guardarExcluidos() {
    const lista = Array.from(EXCLUIDOS);
    try { localStorage.setItem(CLAVE_EXC, JSON.stringify(lista)); } catch (e) { /* sin almacenamiento */ }
    if (!EXC_SERVIDOR) return;
    try { await api('/api/hipismo/pozos-plano-excluidos', { method: 'PUT', body: JSON.stringify({ nombres: lista }) }); }
    catch (e) { if (e.datos && e.datos.sinTabla) EXC_SERVIDOR = false; }
  }
  function filasPlano() { return filasSaldosPozos().filter(f => !EXCLUIDOS.has(f.nombre)); }
  function pintarSeleccion() {
    const caja = $('spSeleccion'); if (!caja) return;
    const todas = filasSaldosPozos();
    const sale = todas.filter(f => !EXCLUIDOS.has(f.nombre)).length;
    $('spContador').textContent = `Salen en el plano: ${sale} de ${todas.length}`;
    caja.innerHTML = todas.map(f => `<label class="sp-sel${EXCLUIDOS.has(f.nombre) ? ' off' : ''}"><input type="checkbox" data-n="${esc(f.nombre)}" ${EXCLUIDOS.has(f.nombre) ? '' : 'checked'}> ${esc(nombreBonito(f.nombre))} <small>${conSigno(f.total)}</small></label>`).join('')
      || '<span class="vacio">Todavía no hay clientes.</span>';
  }
  function circulo(f) {
    // Misma regla del plano de Grupos Hípicos: con pozo, 🟢 si le queda 80% o más, 🔴 si menos del 15%, 🟡 en medio; sin pozo, siempre 🟢.
    if (!(f.pozo > 0)) return '🟢';
    const p = f.total / f.pozo;
    return p >= 0.8 ? '🟢' : (p < 0.15 ? '🔴' : '🟡');
  }

  // ---------- conexión con la página ----------
  function iniciar() {
    // Configuración > Socios (solo el administrador)
    const sub = document.querySelector('#panel-configuracion .subtab[data-sub="socios"]');
    if (sub && !esAdmin()) { sub.classList.add('oculto'); }
    const pc = $('socFilas');
    if (pc) {
      pc.addEventListener('input', e => {
        const el = e.target; const i = Number(el.dataset.i); if (!EDITANDO[i]) return;
        EDITANDO[i][el.dataset.c] = el.value; if (el.dataset.c === 'porcentaje') pintarSuma();
      });
      pc.addEventListener('click', e => { const b = e.target.closest('[data-quitar]'); if (b) quitarSocio(Number(b.dataset.quitar)); });
      $('socLista').addEventListener('change', e => { const s = e.target.closest('select[data-cliente]'); if (s) asignar([s.dataset.cliente], s.value); });
    }
    if ($('csPeriodo')) iniciarPeriodo('cs', cargarComisionesSocios);
    if ($('bsPeriodo')) iniciarPeriodo('bs', cargarBalanceSocios);
    const sel = $('spSeleccion');
    if (sel) sel.addEventListener('change', e => {
      const c = e.target.closest('input[data-n]'); if (!c) return;
      if (c.checked) EXCLUIDOS.delete(c.dataset.n); else EXCLUIDOS.add(c.dataset.n);
      guardarExcluidos(); pintarSeleccion(); pintarSaldosPozos();
    });
    cargarSociosOf();
  }

  // Saldos con Pozos: la imagen y el texto solo llevan a los marcados.
  const pintarSaldosPozosOriginal = window.pintarSaldosPozos;
  window.pintarSaldosPozos = function () {
    const d = SALDOS_POZOS; if (!d) return;
    if (!EXC_CARGADOS) { cargarExcluidos().then(() => { pintarSeleccion(); window.pintarSaldosPozos(); }); return pintarSaldosPozosOriginal(); }
    const conDev = $('spIncluirDev').checked;
    const filas = filasPlano().map(f => `<tr><td>${esc(nombreBonito(f.nombre))}${f.esItem ? '<span class="item-tag">ÍTEM</span>' : ''}</td><td class="num">${celdaSaldo(f.total)}</td></tr>`).join('');
    ponerInforme('spCaptura', cabeceraInforme('Saldos con Pozos', d, conDev ? 'con devolución %' : 'sin devolución %') + `<table>
      <thead><tr><th>Cliente</th><th class="num">Saldo + Pozo</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="2" class="vacio">No hay clientes marcados para el plano.</td></tr>'}</tbody></table>`);
    pintarSeleccion();
  };
  window.copiarSaldosPozosTexto = function () {
    if (!SALDOS_POZOS) return;
    const conDev = $('spIncluirDev').checked;
    let t = `*Saldos + Pozos (${conDev ? 'con' : 'sin'} devolución %)*\n${INFO.textoPeriodo(SALDOS_POZOS)}\n\n`;
    filasPlano().forEach(f => { t += `${circulo(f)} ${nombreBonito(f.nombre).toUpperCase()}: *${conSigno(f.total)}*\n`; });
    copiarTexto(t, 'spToast');
  };
  function marcarTodos() { EXCLUIDOS = new Set(); guardarExcluidos(); pintarSeleccion(); pintarSaldosPozos(); }
  function desmarcarTodos() { EXCLUIDOS = new Set(filasSaldosPozos().map(f => f.nombre)); guardarExcluidos(); pintarSeleccion(); pintarSaldosPozos(); }
  function quitarEnCero() { filasSaldosPozos().forEach(f => { if (f.total === 0) EXCLUIDOS.add(f.nombre); }); guardarExcluidos(); pintarSeleccion(); pintarSaldosPozos(); }

  // Entrar a las pestañas nuevas (se suma a lo que ya hace irATab)
  const irATabAnterior = window.irATab;
  window.irATab = function (t) {
    irATabAnterior.apply(this, arguments);
    if (t === 'comisionessocios') cargarComisionesSocios();
    if (t === 'balancesocios') cargarBalanceSocios();
    if (t === 'configuracion') cargarSociosOf();
  };
  const irASubConfigAnterior = window.irASubConfig;
  window.irASubConfig = function (s) { irASubConfigAnterior.apply(this, arguments); if (s === 'socios') entrarSocios(); };

  Object.assign(window, {
    agregarSocio, guardarSocios, asignarMarcados, pintarAsignacion,
    copiarComisionesTexto, copiarBalanceTexto, excelComisionesSocios, excelBalanceSocios,
    marcarTodosPlano: marcarTodos, desmarcarTodosPlano: desmarcarTodos, quitarEnCeroPlano: quitarEnCero,
    cargarSociosOf
  });
  iniciar();
})();
