// =================================================================
// BUSCADOR EN LAS LISTAS DE HIPÓDROMOS (06-11-2026, a pedido del usuario: "al presionar por ejemplo T va a rodar
// por todos los hipódromos con T sin fin"). La lista nativa del navegador, al repetir una letra, da la vuelta por
// todos los que empiezan con ella. Ahora, en las listas marcadas con data-buscar:
//   - Al hacer clic (o al teclear una letra con la lista enfocada) se abre un cuadro con una casilla de búsqueda.
//   - Teclear filtra: queda SOLO lo que coincide (una "T" muestra los hipódromos con T y nada más; si sigues
//     escribiendo se afina: "TA", "TAM"…). Las banderas y los acentos no estorban.
//   - Flechas arriba/abajo mueven la selección, Enter elige, Esc cierra, clic elige.
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

  // Coincide si el texto empieza con lo escrito, o si alguna de sus palabras empieza con ello.
  // Puntaje: 0 = empieza igual, 1 = una palabra posterior empieza igual, null = no coincide.
  function puntaje(textoNorm, q) {
    if (!q) return 0;
    if (textoNorm.startsWith(q)) return 0;
    return textoNorm.split(' ').some((p, i) => i > 0 && p.startsWith(q)) ? 1 : null;
  }

  function filtrar(opciones, consulta) {
    const q = normalizar(consulta);
    if (!q) return opciones.slice();
    return opciones
      .map((o, i) => ({ o, i, p: puntaje(normalizar(o.texto), q) }))
      .filter(x => x.p !== null)
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .map(x => x.o);
  }

  let abierto = null; // { sel, panel, input, lista, items, activo }

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
    a.items = filtrar(a.todas, a.input.value);
    a.lista.innerHTML = '';
    if (!a.items.length) {
      const vacio = document.createElement('div');
      vacio.className = 'bl-vacio';
      vacio.textContent = 'Sin coincidencias';
      a.lista.appendChild(vacio);
      a.activo = -1;
      return;
    }
    const hayGrupos = !a.input.value && a.items.some(o => o.grupo);
    let ultimoGrupo = null;
    a.items.forEach((o, i) => {
      if (hayGrupos && o.grupo !== ultimoGrupo) {
        ultimoGrupo = o.grupo;
        if (o.grupo) { const g = document.createElement('div'); g.className = 'bl-grupo'; g.textContent = o.grupo; a.lista.appendChild(g); }
      }
      const el = document.createElement('div');
      el.className = 'bl-op' + (o.off ? ' bl-off' : '') + (o.valor === a.sel.value ? ' bl-actual' : '');
      el.textContent = o.texto;
      el.dataset.i = String(i);
      a.lista.appendChild(el);
    });
    // Resaltada: la que ya estaba elegida (si no se ha escrito nada) o la primera que coincide.
    let ini = a.input.value ? a.items.findIndex(o => !o.off) : a.items.findIndex(o => o.valor === a.sel.value);
    if (ini < 0) ini = a.items.findIndex(o => !o.off);
    marcar(ini);
  }

  function marcar(i) {
    const a = abierto; if (!a) return;
    a.activo = i;
    a.lista.querySelectorAll('.bl-op').forEach(el => el.classList.toggle('bl-sel', Number(el.dataset.i) === i));
    const el = a.lista.querySelector('.bl-op[data-i="' + i + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function mover(delta) {
    const a = abierto; if (!a || !a.items.length) return;
    let i = a.activo;
    for (let n = 0; n < a.items.length; n++) {
      i = (i + delta + a.items.length) % a.items.length;
      if (!a.items[i].off) break;
    }
    marcar(i);
  }

  function abrir(sel, textoInicial) {
    if (abierto) cerrar(false);
    if (sel.disabled) return;
    inyectarEstilos();
    const panel = document.createElement('div');
    panel.className = 'bl-panel';
    panel.setAttribute('role', 'listbox');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'bl-input';
    input.placeholder = 'Escribe para buscar…';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Buscar');
    const lista = document.createElement('div');
    lista.className = 'bl-lista';
    panel.appendChild(input);
    panel.appendChild(lista);
    document.body.appendChild(panel);

    const r = sel.getBoundingClientRect();
    const ancho = Math.max(r.width, 230);
    panel.style.minWidth = ancho + 'px';
    let izq = Math.min(r.left, Math.max(8, window.innerWidth - ancho - 8));
    panel.style.left = Math.max(8, izq) + 'px';
    const abajo = window.innerHeight - r.bottom;
    if (abajo < 260 && r.top > abajo) { panel.style.bottom = (window.innerHeight - r.top + 4) + 'px'; lista.style.maxHeight = Math.min(300, r.top - 70) + 'px'; }
    else { panel.style.top = (r.bottom + 4) + 'px'; lista.style.maxHeight = Math.min(300, Math.max(120, abajo - 70)) + 'px'; }

    abierto = { sel, panel, input, lista, todas: leerOpciones(sel), items: [], activo: -1 };
    input.value = textoInicial || '';
    pintar();

    input.addEventListener('input', pintar);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const o = abierto && abierto.items[abierto.activo];
        if (o && !o.off) elegir(o.valor);
      }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
      else if (e.key === 'Tab') { cerrar(false); }
    });
    lista.addEventListener('mousemove', e => { const el = e.target.closest('.bl-op'); if (el && abierto && abierto.activo !== Number(el.dataset.i)) marcar(Number(el.dataset.i)); });
    lista.addEventListener('mousedown', e => e.preventDefault()); // la casilla no pierde el foco al hacer clic
    lista.addEventListener('click', e => {
      const el = e.target.closest('.bl-op'); if (!el || !abierto) return;
      const o = abierto.items[Number(el.dataset.i)];
      if (o && !o.off) elegir(o.valor);
    });
    document.addEventListener('mousedown', fueraDelPanel, true);
    window.addEventListener('resize', cerrarSinFoco);
    window.addEventListener('scroll', alDesplazar, true);
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* nada */ }
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
      '.bl-input{width:100%;box-sizing:border-box;height:36px;padding:0 10px;border:1px solid #b8bfc9;border-radius:8px;background:#fff;color:#1f2933;font:inherit;outline:none}',
      '.bl-input:focus{border-color:#3b82a0;box-shadow:0 0 0 2px rgba(59,130,160,.25)}',
      '.bl-lista{margin-top:6px;overflow-y:auto;overscroll-behavior:contain}',
      '.bl-op{padding:8px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}',
      '.bl-op.bl-actual{font-weight:700}',
      '.bl-op.bl-sel{background:#dcecf2;color:#12303c}',
      '.bl-op.bl-off{opacity:.45;cursor:default}',
      '.bl-grupo{padding:8px 10px 3px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7683}',
      '.bl-vacio{padding:10px;color:#6b7683}'
    ].join('\n');
    document.head.appendChild(st);
  }

  window.BuscadorLista = { normalizar, filtrar, leerOpciones, abrir, cerrar: () => cerrar(false) };
})();
