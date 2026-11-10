// =================================================================
// oficinas-tipos.js (10-11-2026) — LISTAS DESPLEGABLES DEL TIPO DE JUGADA y del PREMIO en la tabla de Hipismo Oficinas.
// Pedido del usuario: en "Tipo" hay tres modalidades:
//   1) MARCAS (un caballo contra otro: sale la casilla del premio y el caballo en dos casillas),
//   2) JUGADAS A PREMIO (un solo caballo: sale la casilla del premio PP, 10A9 … 10A1, también 10A7,5; y la caja "Sin %"),
//   3) PUESTOS (1P, 1P/2N, 2N, 2P/2N, 2P, 2P/3N … 6P) — todo en MAYÚSCULAS, el nombre en un color y la abreviación en otro.
// Las casillas siguen siendo escribibles ("2p", "10a7,5"): la lista ayuda a elegir y filtra mientras se escribe.
// Este archivo solo dibuja la lista y escribe el valor en la casilla (y dispara los eventos "input" y "change" que la pantalla
// ya escuchaba): no cambia ningún cálculo ni hace consultas al servidor (Supabase).
// =================================================================
(function () {
  'use strict';
  if (window.OficinasTipos) return;

  // v = lo que queda escrito en la casilla (el servidor lo entiende: ver hipismoOficinasCalc.js).
  const MODALIDADES = [
    { t: 'Marcas (caballo vs caballo)', a: 'MARCAS', v: 'Marcas', cls: 'tp-marca' },
    { t: 'Jugadas a premio (un caballo)', a: 'A PREMIO', v: 'A premio', cls: 'tp-apremio' }
  ];
  const PUESTOS = [
    ['Un puesto', '1P'], ['Un puesto y dos nini', '1P/2N'], ['Dos nini', '2N'], ['Dos puestos y dos nini', '2P/2N'],
    ['Dos puestos', '2P'], ['Dos puestos y tres nini', '2P/3N'], ['Tres nini', '3N'], ['Tres puestos y tres nini', '3P/3N'],
    ['Tres puestos', '3P'], ['Tres puestos y cuatro nini', '3P/4N'], ['Cuarto nini', '4N'], ['Cuatro puestos y cuatro nini', '4P/4N'],
    ['Cuatro puestos', '4P'], ['Cuatro puestos y cinco nini', '4P/5N'], ['Quinto nini', '5N'], ['Cinco puestos y cinco nini', '5P/5N'],
    ['Cinco puestos', '5P'], ['Cinco puestos y sexto nini', '5P/6N'], ['Sexto nini', '6N'], ['Seis puestos y seis nini', '6P/6N'],
    ['Seis puestos', '6P']
  ].map(([t, a]) => ({ t, a, v: a.toLowerCase(), cls: '' }));
  const PREMIOS = [
    ['Pelo a pelo', 'PP'], ['Diez a nueve', '10A9'], ['Diez a ocho', '10A8'], ['Diez a siete', '10A7'], ['Diez a seis', '10A6'],
    ['Diez a cinco', '10A5'], ['Diez a cuatro', '10A4'], ['Diez a tres', '10A3'], ['Diez a dos', '10A2'], ['Diez a uno', '10A1']
  ].map(([t, a]) => ({ t, a, v: a.toLowerCase(), cls: '' }));

  const LISTAS = {
    tipo: { secciones: [{ titulo: 'Modalidades', items: MODALIDADES }, { titulo: 'Puestos', items: PUESTOS }], ancho: 372, nota: '' },
    premio: { secciones: [{ titulo: 'Premio', items: PREMIOS }], ancho: 300, nota: 'También puedes escribir 10A7,5 · 10A8,5…' }
  };

  function norm(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function todos(lista) { return lista.secciones.reduce((r, s) => r.concat(s.items), []); }

  // Qué opciones salen para lo escrito. Vacío: todas. Con texto: las que lo traen en la abreviación o en el nombre; primero la abreviación exacta.
  function filtrar(lista, texto) {
    const q = norm(texto);
    if (!q) return lista.secciones.map(s => ({ titulo: s.titulo, items: s.items.slice() }));
    const puntaje = it => {
      const a = norm(it.a), t = norm(it.t);
      if (a === q) return 0;
      if (a.startsWith(q)) return 1;
      if (a.includes(q)) return 2;
      if (t.startsWith(q)) return 3;
      if (t.includes(q)) return 4;
      return -1;
    };
    return lista.secciones.map(s => ({
      titulo: s.titulo,
      items: s.items.map((it, i) => ({ it, p: puntaje(it), i })).filter(x => x.p >= 0).sort((x, y) => x.p - y.p || x.i - y.i).map(x => x.it)
    })).filter(s => s.items.length);
  }
  // La opción cuya abreviación (o valor) es EXACTAMENTE lo escrito: "2p/2n", "2P/2N", "marcas", "a premio", "10a8".
  function exacta(lista, texto) {
    const q = norm(texto);
    if (!q) return null;
    return todos(lista).find(it => norm(it.a) === q || norm(it.v) === q) || null;
  }

  let abierto = null;   // { input, clase, panel, items:[{it,el}], activo }
  let estilo = false;
  function poner() {
    if (estilo) return; estilo = true;
    const st = document.createElement('style');
    st.textContent = [
      '.tp-panel{position:fixed;z-index:100000;background:#fff;border:1px solid #c9ced6;border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.22);padding:8px;overflow-y:auto;box-sizing:border-box;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
      '.tp-sec{font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#766f64;padding:8px 10px 4px;text-transform:uppercase}',
      '.tp-sec:first-child{padding-top:2px}',
      '.tp-op{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 10px;border-radius:8px;font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;cursor:pointer;scroll-margin:30px}',
      '.tp-op .tp-t{color:#5b544a}',
      '.tp-op .tp-a{color:#fff;background:#2f6764;border-radius:6px;padding:2px 8px;font-weight:800;font-size:12px;letter-spacing:.04em;min-width:58px;text-align:center;white-space:nowrap}',
      '.tp-op.tp-apremio .tp-a{background:#b45309}',
      '.tp-op.tp-act{background:#e3f1ef}',
      '.tp-op.tp-act .tp-t{color:#1f4a47}',
      '.tp-nota{font-size:11px;color:#766f64;padding:6px 10px 2px}',
      '.tp-vacio{font-size:12.5px;color:#766f64;padding:8px 10px}',
      'input.tp-in{text-transform:uppercase;background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'><path d=\'M0 0l5 6 5-6z\' fill=\'%23766f64\'/></svg>");background-repeat:no-repeat;background-position:right 8px center;padding-right:22px !important;cursor:pointer}',
      'input.tp-in::placeholder{text-transform:none}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function cerrar() {
    if (!abierto) return;
    abierto.panel.remove();
    abierto = null;
  }

  // Llena (o vuelve a llenar) el panel abierto. filtro vacío: todas las opciones; con texto: solo las que coinciden.
  function llenar(filtro, valorActual) {
    const { clase, panel } = abierto;
    const lista = LISTAS[clase];
    const secciones = filtrar(lista, filtro);
    let html = '';
    if (!secciones.length) html = '<div class="tp-vacio">Sin coincidencias: se queda lo que escribas.</div>';
    const items = [];
    secciones.forEach(s => {
      html += `<div class="tp-sec">${esc(s.titulo)}</div>`;
      s.items.forEach(it => { html += `<div class="tp-op ${it.cls || ''}" data-k="${items.length}"><span class="tp-t">${esc(it.t)}</span><span class="tp-a">${esc(it.a)}</span></div>`; items.push({ it }); });
    });
    if (lista.nota && secciones.length) html += `<div class="tp-nota">${esc(lista.nota)}</div>`;
    panel.innerHTML = html;
    panel.querySelectorAll('.tp-op').forEach(el => { items[Number(el.dataset.k)].el = el; });
    // opción activa: la que coincide exacto con lo escrito; si se está filtrando, la primera; si no, ninguna.
    let activo = -1;
    const ex = exacta(lista, valorActual);
    if (ex) activo = items.findIndex(x => x.it === ex);
    if (activo < 0 && norm(filtro) && items.length) activo = 0;
    abierto.items = items;
    marcar(activo, true);
  }

  function colocar() {
    if (!abierto) return;
    const { input, panel, clase } = abierto;
    const r = input.getBoundingClientRect();
    const ancho = Math.max(LISTAS[clase].ancho, r.width);
    panel.style.width = ancho + 'px';
    const izq = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8));
    panel.style.left = izq + 'px';
    const abajo = window.innerHeight - r.bottom - 12, arriba = r.top - 12;
    panel.style.maxHeight = '';
    const alto = Math.min(panel.scrollHeight + 2, 460);
    if (abajo >= Math.min(alto, 300) || abajo >= arriba) { panel.style.top = (r.bottom + 4) + 'px'; panel.style.maxHeight = Math.max(160, Math.min(460, abajo)) + 'px'; }
    else { const h = Math.max(160, Math.min(460, arriba)); panel.style.maxHeight = h + 'px'; panel.style.top = Math.max(8, r.top - 4 - Math.min(alto, h)) + 'px'; }
  }

  function marcar(i, centrar) {
    if (!abierto) return;
    abierto.activo = i;
    abierto.items.forEach((x, k) => x.el && x.el.classList.toggle('tp-act', k === i));
    if (i >= 0 && abierto.items[i] && abierto.items[i].el && centrar) abierto.items[i].el.scrollIntoView({ block: 'nearest' });
  }

  function abrir(input) {
    poner();
    if (abierto && abierto.input === input) return;
    cerrar();
    const panel = document.createElement('div');
    panel.className = 'tp-panel';
    abierto = { input, clase: input.dataset.c === 'premio' ? 'premio' : 'tipo', panel, items: [], activo: -1 };
    document.body.appendChild(panel);
    llenar('', input.value);         // al abrir se ven TODAS las opciones, con la actual resaltada
    colocar();
  }

  // Escribe la opción elegida en la casilla y avisa a la pantalla (input + change), como si se hubiera tecleado.
  function elegir(it) {
    if (!abierto) return;
    const input = abierto.input, clase = abierto.clase;
    const tbody = input.closest('tbody');
    const i = input.dataset.i, c = input.dataset.c;
    cerrar();
    input.value = it.v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Siguiente casilla: tras el premio el caballo; tras un puesto el caballo; tras Marcas / A premio la pantalla ya pasó al premio.
    if (!tbody) return;
    const sel = n => tbody.querySelector(`[data-i="${i}"][data-c="${n}"]`);
    const yaEnfocado = document.activeElement && tbody.contains(document.activeElement) && document.activeElement.dataset.c === 'premio' && c === 'tipo';
    if (yaEnfocado) return;
    const sig = clase === 'premio' ? (sel('cab1') || sel('caballo')) : (sel('premio') || sel('cab1') || sel('caballo'));
    if (sig) sig.focus();
  }

  // Si lo escrito es exactamente una opción ("2P/2N", "a premio"), la casilla queda con su forma canónica.
  function normalizarAlSalir(input) {
    const clase = input.dataset.c === 'premio' ? 'premio' : 'tipo';
    const ex = exacta(LISTAS[clase], input.value);
    if (ex && input.value !== ex.v) {
      input.value = ex.v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function esCasilla(el) {
    return el && el.tagName === 'INPUT' && el.dataset && (el.dataset.c === 'tipo' || el.dataset.c === 'premio') && el.closest('#jTbody') && !el.disabled;
  }

  function instalar() {
    const tbody = document.getElementById('jTbody');
    if (!tbody) return;
    tbody.addEventListener('focusin', e => { if (esCasilla(e.target)) { abrir(e.target); try { e.target.select(); } catch (x) { /* nada */ } } });
    tbody.addEventListener('click', e => { if (esCasilla(e.target) && (!abierto || abierto.input !== e.target)) abrir(e.target); });
    tbody.addEventListener('input', e => {
      if (!esCasilla(e.target) || !e.isTrusted) return;           // solo cuando la persona teclea
      if (!abierto || abierto.input !== e.target) abrir(e.target);
      llenar(e.target.value, e.target.value);   // mientras se teclea se filtra
      colocar();
    });
    tbody.addEventListener('keydown', e => {
      if (!esCasilla(e.target)) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (!abierto || abierto.input !== e.target) abrir(e.target);
        e.preventDefault();
        const n = abierto.items.length; if (!n) return;
        const a = abierto.activo;
        marcar(k === 'ArrowDown' ? (a + 1) % n : (a <= 0 ? n - 1 : a - 1), true);
      } else if (k === 'Enter' && abierto && abierto.input === e.target && abierto.activo >= 0) {
        e.preventDefault(); elegir(abierto.items[abierto.activo].it);
      } else if (k === 'Escape' && abierto) { cerrar(); }
    });
    tbody.addEventListener('focusout', e => {
      if (!esCasilla(e.target)) return;
      // si el foco se fue a la propia lista (clic en una opción) no se cierra todavía: la opción elige con mousedown
      if (abierto && abierto.input === e.target) cerrar();
      normalizarAlSalir(e.target);
    });
    document.addEventListener('mousedown', e => {
      const op = e.target.closest && e.target.closest('.tp-op');
      if (op && abierto && abierto.panel.contains(op)) { e.preventDefault(); const x = abierto.items[Number(op.dataset.k)]; if (x) elegir(x.it); }
      else if (abierto && abierto.panel.contains(e.target)) e.preventDefault();
    }, true);
    window.addEventListener('resize', () => { if (abierto) colocar(); });
    window.addEventListener('scroll', e => { if (abierto && !(abierto.panel.contains(e.target))) colocar(); }, true);
  }

  window.OficinasTipos = { MODALIDADES, PUESTOS, PREMIOS, filtrar, exacta, instalar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar); else instalar();
})();
