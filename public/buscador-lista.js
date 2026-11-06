// =================================================================
// SALTO POR LETRAS EN LAS LISTAS DE HIPÓDROMOS (06-11-2026, a pedido del usuario: "al presionar T se mueva por
// todos los hipódromos con T, sin fin"). Las listas marcadas con data-buscar muestran SIEMPRE todos los hipódromos
// y funcionan por teclado así:
//   - Una letra salta al primer hipódromo que empieza con ella; repetir la misma letra pasa al siguiente que
//     también empieza con ella, y al llegar al último vuelve al primero (da vueltas sin fin).
//   - Varias letras seguidas y rápidas ("tam") buscan el nombre que empieza con todas ellas.
//   - Flechas arriba/abajo mueven, Enter (o clic) elige, Esc cierra.
// El <select> sigue siendo el dueño del valor: al elegir se le pone el valor y se dispara su evento "change",
// así que todo el código que ya existe (onchange, .value) funciona igual y el aspecto de cada tema no cambia.
// =================================================================
(function () {
  'use strict';
  if (window.BuscadorLista) return;

  function normalizar(t) {
    return String(t || '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')          // banderas (pares de letras regionales)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // acentos
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Lo que se muestra de cada opción, con su grupo (optgroup) si lo tiene.
  function leerOpciones(sel) {
    const r = [];
    Array.from(sel.children).forEach(h => {
      if (h.tagName === 'OPTGROUP') {
        Array.from(h.children).forEach(o => r.push({ valor: o.value, texto: o.textContent.trim(), grupo: h.label || '', off: o.disabled || h.disabled }));
      } else if (h.tagName === 'OPTION') {
        r.push({ valor: h.value, texto: h.textContent.trim(), grupo: '', off: h.disabled });
      }
    });
    return r;
  }

  // Busca el siguiente hipódromo para lo tecleado. Una sola letra (o la misma letra repetida): pasa al SIGUIENTE
  // que empieza con ella, dando la vuelta al llegar al final. Varias letras distintas: el primero, desde el actual,
  // que empieza con todas. Si nada empieza igual, prueba con el inicio de alguna palabra ("park" -> Turfway Park).
  // Devuelve el índice o -1.
  function siguienteCoincidencia(items, activo, tecleado) {
    const q = normalizar(tecleado);
    if (!q || !items.length) return -1;
    const unaLetra = q.split('').every(c => c === q[0]);
    const clave = unaLetra ? q[0] : q;
    const desde = unaLetra ? activo + 1 : Math.max(activo, 0);
    const n = items.length;
    const buscar = pred => {
      for (let k = 0; k < n; k++) {
        const i = ((desde + k) % n + n) % n;
        if (!items[i].off && pred(normalizar(items[i].texto))) return i;
      }
      return -1;
    };
    let i = buscar(t => t.startsWith(clave));
    if (i < 0) i = buscar(t => t.split(' ').some((p, idx) => idx > 0 && p.startsWith(clave)));
    return i;
  }

  let abierto = null; // { sel, panel, lista, todas, activo, buffer, ultimaTecla }

  function cerrar(devolverFoco) {
    if (!abierto) return;
    const { sel, panel } = abierto;
    document.removeEventListener('mousedown', fueraDelPanel, true);
    window.removeEventListener('resize', cerrarSinFoco);
    window.removeEventListener('scroll', alDesplazar, true);
    panel.remove();
    abierto = null;
    if (devolverFoco) { try { sel.focus(); } catch (e) { /* nada */ } }
  }
  const cerrarSinFoco = () => cerrar(false);
  function fueraDelPanel(e) { if (abierto && !abierto.panel.contains(e.target) && e.target !== abierto.sel) cerrar(false); }
  function alDesplazar(e) { if (abierto && !abierto.panel.contains(e.target)) cerrar(false); }

  function elegir(valor) {
    if (!abierto) return;
    const sel = abierto.sel;
    const cambio = sel.value !== valor;
    cerrar(true);
    if (cambio) {
      sel.value = valor;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function pintar() {
    const a = abierto; if (!a) return;
    a.lista.innerHTML = '';
    let ultimoGrupo = null;
    a.todas.forEach((o, i) => {
      if (o.grupo && o.grupo !== ultimoGrupo) {
        const g = document.createElement('div'); g.className = 'bl-grupo'; g.textContent = o.grupo; a.lista.appendChild(g);
      }
      ultimoGrupo = o.grupo;
      const el = document.createElement('div');
      el.className = 'bl-op' + (o.off ? ' bl-off' : '') + (o.valor === a.sel.value ? ' bl-actual' : '');
      el.textContent = o.texto;
      el.dataset.i = String(i);
      a.lista.appendChild(el);
    });
  }

  function marcar(i) {
    const a = abierto; if (!a) return;
    a.activo = i;
    a.lista.querySelectorAll('.bl-op').forEach(el => el.classList.toggle('bl-sel', Number(el.dataset.i) === i));
    const el = a.lista.querySelector('.bl-op[data-i="' + i + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function mover(delta) {
    const a = abierto; if (!a || !a.todas.length) return;
    let i = a.activo;
    for (let n = 0; n < a.todas.length; n++) {
      i = (i + delta + a.todas.length) % a.todas.length;
      if (!a.todas[i].off) break;
    }
    marcar(i);
  }

  // Una letra (o varias seguidas y rápidas): salta según siguienteCoincidencia.
  function teclear(letra) {
    const a = abierto; if (!a) return;
    const ahora = Date.now();
    a.buffer = (ahora - a.ultimaTecla > 900 ? '' : a.buffer) + letra;
    a.ultimaTecla = ahora;
    let i = siguienteCoincidencia(a.todas, a.activo, a.buffer);
    // Si lo acumulado no coincide con nada ("s" y enseguida "g"), se empieza de nuevo con la letra recién tecleada.
    if (i < 0 && a.buffer.length > 1) { a.buffer = letra; i = siguienteCoincidencia(a.todas, a.activo, letra); }
    if (i >= 0) marcar(i);
  }

  function abrir(sel, letraInicial) {
    if (abierto) cerrar(false);
    if (sel.disabled) return;
    inyectarEstilos();
    const panel = document.createElement('div');
    panel.className = 'bl-panel';
    panel.setAttribute('role', 'listbox');
    panel.tabIndex = -1;
    const lista = document.createElement('div');
    lista.className = 'bl-lista';
    const ayuda = document.createElement('div');
    ayuda.className = 'bl-ayuda';
    ayuda.textContent = 'Teclea una letra para saltar; repítela para pasar al siguiente.';
    panel.appendChild(lista);
    panel.appendChild(ayuda);
    document.body.appendChild(panel);

    const r = sel.getBoundingClientRect();
    const ancho = Math.max(r.width, 230);
    panel.style.minWidth = ancho + 'px';
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)) + 'px';
    const abajo = window.innerHeight - r.bottom;
    if (abajo < 260 && r.top > abajo) { panel.style.bottom = (window.innerHeight - r.top + 4) + 'px'; lista.style.maxHeight = Math.min(320, r.top - 60) + 'px'; }
    else { panel.style.top = (r.bottom + 4) + 'px'; lista.style.maxHeight = Math.min(320, Math.max(120, abajo - 60)) + 'px'; }

    abierto = { sel, panel, lista, todas: leerOpciones(sel), activo: -1, buffer: '', ultimaTecla: 0 };
    pintar();
    let ini = abierto.todas.findIndex(o => o.valor === sel.value);
    if (ini < 0) ini = abierto.todas.findIndex(o => !o.off);
    marcar(ini);
    if (letraInicial) teclear(letraInicial);

    panel.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
      else if (e.key === 'Home') { e.preventDefault(); marcar(abierto.todas.findIndex(o => !o.off)); }
      else if (e.key === 'End') { e.preventDefault(); for (let i = abierto.todas.length - 1; i >= 0; i--) if (!abierto.todas[i].off) { marcar(i); break; } }
      else if (e.key === 'Enter' || (e.key === ' ' && !abierto.buffer)) {
        e.preventDefault();
        const o = abierto && abierto.todas[abierto.activo];
        if (o && !o.off) elegir(o.valor);
      }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
      else if (e.key === 'Tab') { cerrar(false); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); teclear(e.key); }
    });
    lista.addEventListener('mousemove', e => { const el = e.target.closest('.bl-op'); if (el && abierto && abierto.activo !== Number(el.dataset.i)) marcar(Number(el.dataset.i)); });
    lista.addEventListener('click', e => {
      const el = e.target.closest('.bl-op'); if (!el || !abierto) return;
      const o = abierto.todas[Number(el.dataset.i)];
      if (o && !o.off) elegir(o.valor);
    });
    document.addEventListener('mousedown', fueraDelPanel, true);
    window.addEventListener('resize', cerrarSinFoco);
    window.addEventListener('scroll', alDesplazar, true);
    panel.focus();
  }

  function esBuscable(el) { return el && el.tagName === 'SELECT' && el.hasAttribute('data-buscar'); }

  // Delegado en el documento: sirve también para listas que se creen o rellenen después.
  document.addEventListener('mousedown', e => {
    const sel = e.target.closest && e.target.closest('select');
    if (!esBuscable(sel) || e.button !== 0) return;
    e.preventDefault();      // evita la lista nativa
    sel.focus();
    if (abierto && abierto.sel === sel) cerrar(false); else abrir(sel, '');
  }, true);

  document.addEventListener('keydown', e => {
    const sel = e.target;
    if (!esBuscable(sel) || e.ctrlKey || e.metaKey || e.altKey) return;
    const imprimible = e.key && e.key.length === 1 && e.key !== ' ';
    if (imprimible) { e.preventDefault(); abrir(sel, e.key); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); abrir(sel, ''); }
  }, true);

  let estilosPuestos = false;
  function inyectarEstilos() {
    if (estilosPuestos) return; estilosPuestos = true;
    const st = document.createElement('style');
    st.textContent = [
      '.bl-panel{position:fixed;z-index:100000;background:#fff;color:#1f2933;border:1px solid #c9ced6;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.22);padding:8px;font:14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-sizing:border-box}',
      '.bl-panel:focus{outline:none}',
      '.bl-lista{overflow-y:auto;overscroll-behavior:contain}',
      '.bl-ayuda{margin-top:6px;padding:6px 8px 0;border-top:1px solid #e3e7ec;font-size:11.5px;color:#6b7683}',
      '.bl-op{padding:8px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}',
      '.bl-op.bl-actual{font-weight:700}',
      '.bl-op.bl-sel{background:#dcecf2;color:#12303c}',
      '.bl-op.bl-off{opacity:.45;cursor:default}',
      '.bl-grupo{padding:8px 10px 3px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7683}',
      '.bl-op{scroll-margin:4px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  window.BuscadorLista = { normalizar, siguienteCoincidencia, leerOpciones, abrir, cerrar: () => cerrar(false) };
})();
