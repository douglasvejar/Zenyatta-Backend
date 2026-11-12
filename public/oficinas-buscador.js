// =================================================================
// oficinas-buscador.js (12-11-2026) — BUSCADOR GENERAL arriba a la derecha de Hipismo Oficinas.
// Pedido del usuario: "en la esquina superior derecha agrega el apartado para buscar módulo, pantalla o cliente, como en Grupos".
// Es el mismo buscador que ya tiene Hipismo Grupos Hípicos (atajo "/" o Ctrl/Cmd+K, flechas + Enter, Esc), adaptado a Oficinas:
//   - Módulos: Deportes / Hipismo Grupos Hípicos (solo los que este grupo tiene habilitados).
//   - Pantallas: los botones del menú de la izquierda que el usuario puede ver (respeta los permisos).
//   - Clientes: los clientes y oficinas ya cargados; al elegir uno se abre su "Detallado por Cliente".
// No hace consultas nuevas por cada letra: busca en lo que ya está en pantalla. Solo si la lista de clientes aún está vacía la pide
// UNA vez al enfocar la casilla (la misma consulta que ya usa el resto de la página). Todo el HTML y el CSS se crean desde aquí.
// =================================================================
(function () {
  'use strict';
  if (window.OficinasBuscador) return;

  let items = [], activo = -1, listo = false;

  const norm = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const esc = t => { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };
  const bonito = n => String(n || '').trim().toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());

  const SVG = {
    modulo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/></svg>',
    pantalla: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    cliente: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.9-3.6 3.8-5.4 7.5-5.4s6.6 1.8 7.5 5.4"/></svg>'
  };

  function poner() {
    const st = document.createElement('style');
    st.textContent = `
.obus{position:relative;width:340px;max-width:100%}
.obus .obus-lupa{position:absolute;left:13px;top:50%;width:17px;height:17px;margin-top:-8.5px;color:var(--text-dim,#766f64);pointer-events:none;z-index:1}
.obus input{-webkit-appearance:none;appearance:none;width:100%;height:40px;padding:0 40px 0 38px;border-radius:999px;border:1px solid var(--card-border,rgba(70,55,30,.14));background:var(--card,#fffdf9);font:inherit;font-size:13.5px;color:var(--text,#2c2a26);outline:none;box-shadow:0 2px 8px rgba(30,60,58,.06)}
.obus input::-webkit-search-cancel-button{-webkit-appearance:none}
.obus input::placeholder{color:var(--text-dim,#766f64)}
.obus input:focus{border-color:var(--accent-grass,#3f8a85);box-shadow:0 0 0 3px rgba(63,138,133,.18)}
.obus kbd{position:absolute;right:11px;top:50%;transform:translateY(-50%);min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:7px;background:rgba(63,138,133,.12);color:var(--text-dim,#766f64);font:600 12px/22px inherit;text-align:center;pointer-events:none}
.obus-res{position:absolute;right:0;top:calc(100% + 8px);width:min(420px,calc(100vw - 24px));z-index:9500;max-height:min(70vh,520px);overflow-y:auto;padding:8px;border-radius:16px;background:var(--card,#fffdf9);border:1px solid var(--card-border,rgba(70,55,30,.14));box-shadow:0 18px 44px rgba(30,60,58,.24)}
.obus-res[hidden]{display:none}
.obus-grupo{margin:4px 0 2px;padding:6px 10px 4px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim,#766f64)}
.obus-item{display:flex;align-items:center;gap:12px;width:100%;padding:8px 10px;border:0;border-radius:12px;background:transparent;text-align:left;cursor:pointer;font:inherit;color:var(--text,#2c2a26)}
.obus-ic{flex:none;width:32px;height:32px;border-radius:10px;background:rgba(63,138,133,.12);color:var(--accent-grass,#3f8a85);display:flex;align-items:center;justify-content:center}
.obus-ic svg{width:17px;height:17px}
.obus-txt{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.obus-t{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.obus-s{font-size:12px;color:var(--text-dim,#766f64);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.obus-item.activo,.obus-item:hover{background:rgba(63,138,133,.12)}
.obus-item.activo .obus-ic,.obus-item:hover .obus-ic{background:linear-gradient(135deg,var(--accent-grass,#3f8a85),var(--accent-lime,#5fa39b));color:#fff}
.obus-vacio{padding:14px 12px;font-size:13px;color:var(--text-dim,#766f64)}
@media (max-width:900px){.obus{order:3;flex:1 1 100%;width:auto}.obus kbd{display:none}.obus input{height:44px;font-size:16px}.obus-res{left:0;right:0;width:auto}}`;
    document.head.appendChild(st);

    const cont = document.createElement('div');
    cont.className = 'obus'; cont.id = 'obus';
    cont.innerHTML = `
  <svg class="obus-lupa" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>
  <input type="search" id="obusInput" placeholder="Buscar módulo, pantalla o cliente…" autocomplete="off" spellcheck="false" aria-label="Buscar en todo el panel" aria-controls="obusRes">
  <kbd aria-hidden="true">/</kbd>
  <div class="obus-res" id="obusRes" role="listbox" hidden></div>`;
    const barra = document.querySelector('.barra-der');
    if (barra) barra.insertBefore(cont, barra.firstChild); else (document.querySelector('.topbar') || document.body).appendChild(cont);

    const inp = $('obusInput');
    inp.addEventListener('input', () => buscar(inp.value));
    inp.addEventListener('focus', () => { pedirClientesSiFaltan(); buscar(inp.value); });
    inp.addEventListener('keydown', tecla);
    $('obusRes').addEventListener('mousedown', e => e.preventDefault()); // que el clic no le quite el foco antes de elegir
    $('obusRes').addEventListener('click', e => { const b = e.target.closest('.obus-item'); if (b) elegir(Number(b.dataset.i)); });
    $('obusRes').addEventListener('mousemove', e => { const b = e.target.closest('.obus-item'); if (b) marcar(Number(b.dataset.i)); });
    document.addEventListener('click', e => { if (!cont.contains(e.target)) cerrar(); });
    document.addEventListener('keydown', e => {
      const t = e.target, escribiendo = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === '/' && !escribiendo && !e.ctrlKey && !e.metaKey && !e.altKey) || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) { e.preventDefault(); inp.focus(); inp.select(); }
    });
  }
  const $ = id => document.getElementById(id);

  // ---- fuentes de resultados ----
  function visible(el) { return !!el && !el.classList.contains('oculto') && el.getClientRects().length > 0; }
  function modulos() {
    const g = (typeof GRUPO !== 'undefined' && GRUPO) ? GRUPO : {}, r = [];
    if (g.moduloDeportesHabilitado) r.push({ titulo: 'Deportes', sub: 'Cambiar de módulo', accion: () => { location.href = 'grupo.html'; } });
    if (g.moduloHipismoHabilitado) r.push({ titulo: 'Hipismo Grupos Hípicos', sub: 'Cambiar de módulo', accion: () => { location.href = 'hipismo-mockup.html'; } });
    return r;
  }
  function pantallas() {
    return Array.from(document.querySelectorAll('.tabs .tab[data-tab]')).filter(visible).map(b => {
      const txt = b.textContent.replace(/\s+/g, ' ').trim();
      const sinIcono = txt.replace(/^[^\p{L}\p{N}]+/u, '').trim() || txt;
      return { titulo: sinIcono, sub: 'Pantalla del menú', tab: b.dataset.tab, accion: () => { if (typeof irATab === 'function') irATab(b.dataset.tab); } };
    });
  }
  function clientes() {
    const lista = (typeof CLIENTES !== 'undefined' && Array.isArray(CLIENTES)) ? CLIENTES : [];
    const tabDetalle = document.querySelector('.tabs .tab[data-tab="detalle"]');
    const puedeDetalle = visible(tabDetalle);
    return lista.filter(c => c && c.nombre && !c.es_cuenta_comision).map(c => ({
      titulo: bonito(c.nombre),
      sub: puedeDetalle ? 'Ver su detallado' : 'Ver en Crear Cliente u Oficina',
      accion: () => {
        if (puedeDetalle && typeof verDetalleDe === 'function') verDetalleDe(c.nombre);
        else if (typeof irATab === 'function') irATab('clientes');
      }
    }));
  }
  function pedirClientesSiFaltan() {
    try {
      const vacia = (typeof CLIENTES === 'undefined') || !CLIENTES.length;
      if (vacia && typeof cargarClientes === 'function' && !pedirClientesSiFaltan.hecho) { pedirClientesSiFaltan.hecho = true; Promise.resolve(cargarClientes()).then(() => { const i = $('obusInput'); if (i && document.activeElement === i) buscar(i.value); }).catch(() => {}); }
    } catch (e) { /* no crítico */ }
  }

  // ---- búsqueda y pantalla de resultados ----
  function buscar(q) {
    const box = $('obusRes'); if (!box) return;
    const tokens = norm(q).split(' ').filter(Boolean);
    const coincide = it => !tokens.length || tokens.every(t => norm(it.titulo + ' ' + it.sub).includes(t));
    const grupos = [];
    let pant = pantallas();
    if (tokens.length) pant = pant.filter(coincide);
    else pant = ['jugadas', 'registro', 'balance', 'detalle', 'clientes'].map(t => pant.find(p => p.tab === t)).filter(Boolean);
    if (pant.length) grupos.push({ nombre: tokens.length ? 'Pantallas' : 'Ir a', icono: SVG.pantalla, items: pant.slice(0, 8) });
    const mods = modulos().filter(coincide);
    if (mods.length) grupos.push({ nombre: 'Módulos', icono: SVG.modulo, items: mods });
    if (tokens.length) {
      const cli = clientes().filter(coincide).slice(0, 8);
      if (cli.length) grupos.push({ nombre: 'Clientes', icono: SVG.cliente, items: cli });
    }
    items = []; let html = '';
    grupos.forEach(g => {
      html += `<div class="obus-grupo">${esc(g.nombre)}</div>`;
      g.items.forEach(it => {
        html += `<button type="button" class="obus-item" role="option" data-i="${items.length}"><span class="obus-ic">${g.icono}</span><span class="obus-txt"><span class="obus-t">${esc(it.titulo)}</span><span class="obus-s">${esc(it.sub)}</span></span></button>`;
        items.push(it);
      });
    });
    if (!items.length) html = '<div class="obus-vacio">No encontré nada con eso. Prueba con el nombre de una pantalla, de un cliente o de un módulo.</div>';
    else if (!tokens.length) html += '<div class="obus-vacio" style="padding-top:6px;">Escribe el nombre de una pantalla, un cliente o un módulo.</div>';
    box.innerHTML = html; box.hidden = false;
    marcar(items.length ? 0 : -1);
  }
  function marcar(i) {
    activo = i;
    document.querySelectorAll('#obusRes .obus-item').forEach(b => b.classList.toggle('activo', Number(b.dataset.i) === i));
  }
  function cerrar() { const b = $('obusRes'); if (b) b.hidden = true; }
  function elegir(i) {
    const it = items[i]; if (!it) return;
    cerrar();
    const inp = $('obusInput'); if (inp) { inp.value = ''; inp.blur(); }
    try { it.accion(); } catch (e) { /* si algo falla al abrir, la página sigue igual */ }
  }
  function tecla(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      marcar((activo + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      const a = document.querySelector('#obusRes .obus-item.activo'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); if (activo >= 0) elegir(activo); }
    else if (e.key === 'Escape') { cerrar(); e.target.blur(); }
  }

  function iniciar() {
    if (listo) return; listo = true;
    if (!localStorage.getItem('zenyatta_token')) return;      // sin sesión la página manda al inicio de sesión
    poner();
  }
  window.OficinasBuscador = { iniciar, norm };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
