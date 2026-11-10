// =================================================================
// oficinas-informes.js (09-10-2026) — Hipismo Oficinas: la parte "pura" (sin pantalla) de los informes
// Balance General, Detallado por Cliente y Comisión por Carrera. Vive aparte para poder probarla con node
// (test/test_hipismo_oficinas_informes.js) y asegurar que los saldos de las 3 pantallas coinciden.
//
// No calcula plata propia: solo ordena y suma lo que ya devuelven
//   GET /api/hipismo/cierre-final                          (Balance General)
//   GET /api/hipismo/clientes/:nombre/detalle-semana       (Detallado por Cliente)
//   GET /api/hipismo/oficinas/comision-por-carrera         (Comisión por Carrera)
// =================================================================
(function (raiz) {
  // Mismo redondeo que el servidor: el medio centavo siempre sube (en valor absoluto) y nunca "-0".
  const r2 = n => { const x = Number(n) || 0; return (x < 0 ? -1 : 1) * Math.round(Math.abs(x) * 100 + 1e-6) / 100 || 0; };

  // 1.234,50 (siempre 2 decimales, punto de miles y coma decimal)
  function dinero(n) {
    const v = r2(n);
    return (Object.is(v, -0) ? 0 : v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // +1.234,50 / -1.234,50 / 0,00
  function dineroConSigno(n) {
    const v = r2(n);
    if (v > 0) return '+' + dinero(v);
    if (v < 0) return '-' + dinero(-v);
    return dinero(0);
  }
  function fechaCorta(iso) {
    const [a, m, d] = String(iso).split('-');
    return `${d}/${m}/${a}`;
  }
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  function nombreDia(iso) {
    return DIAS[new Date(iso + 'T00:00:00Z').getUTCDay()];
  }
  // El servidor manda numeroSemana como { anio, semana } (o, en respuestas viejas, como un número): siempre se muestra solo el número.
  function numeroSemanaDe(d) {
    const n = d && d.numeroSemana;
    if (n && typeof n === 'object') return n.semana;
    return n;
  }
  function textoPeriodo(d) {
    const rango = `${fechaCorta(d.rango.desde)} al ${fechaCorta(d.rango.hasta)}`;
    if (d.rangoPersonalizado) return `Del ${rango}`;
    return `Semana ${numeroSemanaDe(d)} — ${rango}`;
  }

  // ---------------- Balance General ----------------
  // cierre: respuesta de /cierre-final. esItem(nombre) dice si el renglón es un ítem (REMATE, "X - PORCENTAJE"…)
  // y no un cliente real. Devuelve las filas, el total de todos los renglones y la comisión de la oficina.
  function armarBalance(cierre, esItem) {
    const filas = (cierre.clientes || []).map(c => ({
      nombre: c.nombre, jugadas: Number(c.jugadas) || 0, saldo: r2(c.saldo), esItem: !!(esItem && esItem(c.nombre))
    }));
    const totalClientes = r2(filas.reduce((s, f) => s + f.saldo, 0));
    const comisionOficina = r2(cierre.comisionSemana);
    // En un grupo cuadrado, lo que ganan y pierden todos los renglones + la comisión de la oficina suma 0.
    const diferencia = r2(totalClientes + comisionOficina);
    // Balance en dos columnas: a la izquierda los que PIERDEN (el que más pierde arriba) y a la derecha los que GANAN (el que más gana arriba).
    const pierden = filas.filter(f => f.saldo < 0).sort((a, b) => a.saldo - b.saldo || a.nombre.localeCompare(b.nombre, 'es'));
    const ganan = filas.filter(f => f.saldo > 0).sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, 'es'));
    const sinSaldo = filas.filter(f => f.saldo === 0);
    const totalPierden = r2(pierden.reduce((s, f) => s + f.saldo, 0));
    const totalGanan = r2(ganan.reduce((s, f) => s + f.saldo, 0));
    return { filas, pierden, ganan, sinSaldo, totalPierden, totalGanan, totalClientes, comisionOficina, diferencia };
  }

  // ---------------- Detallado por Cliente ----------------
  // resp: respuesta de /clientes/:nombre/detalle-semana. Ordena por día > hipódromo > carrera y suma cada nivel.
  // Puestos con nini: el motor los guarda como "1p-2n"; en pantalla se leen 1P/2N (como en la lista de Tipo).
  function modalidadBonita(m) {
    return String(m === undefined || m === null ? '' : m).replace(/^(\d{1,2})p-(\d{1,2})n$/i, (x, a, b) => `${a}P/${b}N`);
  }
  function descripcionLinea(l) {
    if (l.tipo === 'traspaso') return 'Traspaso' + (l.nota ? ' — ' + l.nota : '');
    if (l.tipo === 'carga') return l.texto || 'Carga';
    if (l.tipo === 'devolucion-propia') return `% devuelto${l.porcentaje !== undefined ? ' ' + l.porcentaje + '% de ' + dinero(l.monto) : ''}`;
    if (l.tipo === 'comision') {
      const pct = l.porcentaje !== undefined ? `${l.porcentaje}% de ${dinero(l.monto)}` : '';
      return `% devuelto${l.clienteOrigen ? ' (' + l.clienteOrigen + ')' : ''}${pct ? ' — ' + pct : ''}`;
    }
    if (l.ticket) return `Ticket ${l.ticket}${l.detalle ? ' — ' + l.detalle : ''}`;
    const rol = l.rol === 'banquero' ? 'Dio' : (l.rol === 'jugador' ? 'Jugó' : '');
    let caballo = '';
    if (l.modalidad === 'pp' && l.caballoA !== undefined) caballo = `${l.caballoA}x${l.caballoB}`;
    else if (l.caballo !== undefined && l.caballo !== null) caballo = String(l.caballo).replace(/^\(|\)$/g, '');
    const jugada = [modalidadBonita(l.modalidad), caballo ? `(${caballo})` : ''].filter(Boolean).join(' ');
    const monto = l.monto !== undefined && l.monto !== null ? ` con ${dinero(l.monto)}` : '';
    return [rol, jugada].filter(Boolean).join(' ') + monto || 'Jugada';
  }

  // Partes de una jugada para pintarla bonita (chip Jugó/Dio + modalidad + caballos de colores + monto). Devuelve null si la
  // línea no es una jugada normal (traspaso, carga, % devuelto, ticket suelto…): esas se siguen mostrando como texto.
  function partesJugada(l) {
    if (l.tipo === 'traspaso' || l.tipo === 'carga' || l.tipo === 'comision' || l.tipo === 'devolucion-propia' || l.ticket) return null;
    const rol = l.rol === 'banquero' ? 'Dio' : (l.rol === 'jugador' ? 'Jugó' : '');
    let caballo = '';
    if (l.modalidad === 'pp' && l.caballoA !== undefined) caballo = `${l.caballoA}x${l.caballoB}`;
    else if (l.caballo !== undefined && l.caballo !== null) caballo = String(l.caballo).replace(/^\(|\)$/g, '');
    if (!rol && !l.modalidad && !caballo) return null;
    return { rol, modalidad: l.modalidad ? modalidadBonita(l.modalidad) : '', caballo, monto: l.monto !== undefined && l.monto !== null ? dinero(l.monto) : '' };
  }

  // ---- Caballos de colores (mismos colores de gualdrapa que el portal del cliente: 1 rojo, 2 blanco, 3 azul, 4 amarillo…) ----
  // Cabeza de caballo de game-icons.net (Delapouite, CC BY 3.0), la misma que ya usa el portal del cliente.
  const CABALLO_PATH = "M400 16c-21.335 9.73-58.244 17.34-73.086 48.232-22.36 1.948-72.753 10.673-122.22 40.25-58.098 34.74-116.017 97.417-131.776 213.702l-.48 3.537-2.774 2.25c-30.87 25.002-40.657 38.937-44.416 61.153-3.536 20.9-.72 51.46-.363 101.877H328.36c3.455-16.892 10.44-29.245 12.472-41.568 2.337-14.176.19-29.938-20.812-58.547-43.078-58.683-46.853-129.458-12.916-171.28-8.654-2.765-15.09-6.887-19.458-12.546-6.115-7.924-7.4-17.006-8.57-25.884l17.848-2.352c1.112 8.446 2.38 13.88 4.97 17.237 2.59 3.356 7.31 6.472 19.55 8.46l-.022.128.172-.17 5.998 9.424c19.957 31.358 42.84 51.292 73.332 54.44l6.51.672 1.367 6.4c2.74 12.828 8.626 19.095 15.116 22.238 6.49 3.143 14.225 2.944 20.47.205 9.316-4.086 14.518-11.35 16.7-22.712 2.122-11.05.546-25.834-5.137-42.106-33.538-38.248-44.475-87.277-63.903-128.772-6.055-9.947-12.448-18.518-20.385-24.856C376.808 55.126 386.456 34.852 400 16zM214.068 34.97C179.55 35.06 146.075 43.06 96 58.58c31.146 9.92 70.397 18.9 86.037 39.01 4.463-3.017 8.94-5.88 13.418-8.56 40.51-24.22 80.387-35.286 108.23-40.04-35.854-9.477-63.047-14.094-89.617-14.023zM157.16 96.712c-1.13-.01-2.265-.01-3.402.004-30.353.37-63.1 9.745-96.647 31.283 27.186 3.672 54.67 3.724 72.58 15.398 15.9-17.92 33.144-32.634 50.677-44.668-7.548-1.244-15.292-1.938-23.207-2.017zM368 128a13.214 13.215 0 0 1 13.213 13.215A13.214 13.215 0 0 1 368 154.432a13.214 13.215 0 0 1-13.213-13.217A13.214 13.215 0 0 1 368 128zm-238.906 16.068c-36.395 1.495-68.903 6.53-104.76 24.766 33.236 7.095 50.913 13.507 65.025 33.83 11.522-22.53 25.045-41.93 39.734-58.596zM74.518 201.46C53.53 201.65 36.614 213.14 16 224c27.854 0 46.067 3.862 58.71 12.055 4.33-11.652 9.16-22.615 14.41-32.924-5.12-1.19-9.963-1.71-14.602-1.67zm-.623 36.82c-17.933 5.845-35.452 7.15-54.23 22.284 17.62 4.638 34.79 9.596 41.398 22.034 3.496-15.77 7.814-30.523 12.832-44.32zm370.142 8.57c1.617-.035 3.222.044 4.783.187l-1.64 17.926c-3.928-.36-5.513.416-5.57.465-.058.048-1.035.656-.635 5.886l-17.95 1.372c-.638-8.35 1.297-16.207 6.955-20.997 4.245-3.593 9.206-4.735 14.057-4.84zM52.215 290.723c-10.352.13-23.76 5.646-34.656 12.334 12.173 6.83 12.357 23.472 8.938 37.668 7.3-9.105 16.855-18.323 29.158-28.48 1.016-7.043 2.19-13.9 3.506-20.585-2.082-.67-4.42-.97-6.947-.937z";
  const COLORES_EJEMPLAR = {
    1: ['#e02020', '#ffffff'], 2: ['#f2f2f2', '#111111'], 3: ['#1560bd', '#ffffff'], 4: ['#f5c400', '#111111'], 5: ['#1d7a3d', '#ffffff'],
    6: ['#111111', '#ffffff'], 7: ['#f07c1d', '#111111'], 8: ['#f48fb1', '#111111'], 9: ['#33b5e5', '#111111'], 10: ['#6a1b9a', '#ffffff'],
    11: ['#9e9e9e', '#111111'], 12: ['#a4d65e', '#111111'], 13: ['#6d4c2a', '#ffffff'], 14: ['#7b1024', '#ffffff'], 15: ['#e8d9b5', '#111111'],
    16: ['#0d7d6e', '#ffffff'], 17: ['#e0607a', '#ffffff'], 18: ['#6a2fc9', '#ffffff'], 19: ['#e8785c', '#111111'], 20: ['#1f9fd9', '#ffffff']
  };
  function colorEjemplar(n) { return COLORES_EJEMPLAR[Number(n)] || ['#616161', '#ffffff']; }
  // Etiqueta con el número (color de la gualdrapa) + cabeza de caballo pintada del mismo color.
  function caballoColorHTML(numero) {
    const n = parseInt(numero, 10);
    if (!n || isNaN(n)) return '';
    const [bg, fg] = colorEjemplar(n);
    return `<span class="cab-col" title="Caballo ${n}"><svg class="cab-num" width="24" height="24" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="18" fill="${bg}" stroke="#6b665c" stroke-width="5"/><text x="50" y="72" font-size="${n > 9 ? 54 : 62}" font-weight="800" fill="${fg}" text-anchor="middle" font-family="Arial, sans-serif">${n}</text></svg><svg class="cab-cabeza" width="22" height="22" viewBox="0 0 512 512"><path d="${CABALLO_PATH}" fill="${bg}" stroke="#57524a" stroke-width="22" stroke-linejoin="round" paint-order="stroke"/></svg></span>`;
  }
  // "3" / "4x3" / "1y2" / "1y2x3" -> caballos de colores con su separador. Si no trae números, queda el texto tal cual.
  function caballosHTML(texto) {
    const t = String(texto === undefined || texto === null ? '' : texto).trim();
    if (!t) return '';
    if (!/\d/.test(t)) return escHtml(t);
    return t.split(/(\d+)/).filter(x => x !== '').map(x => /^\d+$/.test(x) ? caballoColorHTML(x) : `<span class="cab-sep">${escHtml(x.trim())}</span>`).join('');
  }
  function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // La línea completa de una jugada: [Jugó|Dio] [modalidad] [caballos] con monto.
  function jugadaHTML(j) {
    if (!j) return '';
    const chip = j.rol ? `<span class="jug-rol ${j.rol === 'Dio' ? 'dio' : 'jugo'}">${escHtml(j.rol)}</span>` : '';
    const mod = j.modalidad ? `<span class="jug-mod">${escHtml(j.modalidad)}</span>` : '';
    const cab = j.caballo ? `<span class="jug-cab">${caballosHTML(j.caballo)}</span>` : '';
    const monto = j.monto ? `<span class="jug-monto">con <b>${escHtml(j.monto)}</b></span>` : '';
    return `<span class="jug">${chip}${mod}${cab}${monto}</span>`;
  }

  function armarDetalleCliente(resp) {
    const dias = (resp.dias || []).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map(dia => {
      const hipodromos = (dia.hipodromos || []).map(h => {
        const porCarrera = new Map();
        (h.carreras || []).forEach(l => {
          const n = l.carrera ? Number(l.carrera) : 0;
          if (!porCarrera.has(n)) porCarrera.set(n, []);
          porCarrera.get(n).push({ texto: descripcionLinea(l), resultado: r2(l.resultado), rol: l.rol || null, tipo: l.tipo || null, jugada: partesJugada(l) });
        });
        const carreras = Array.from(porCarrera.entries()).sort((a, b) => a[0] - b[0]).map(([numero, lineas]) => ({
          numero, lineas, total: r2(lineas.reduce((s, x) => s + x.resultado, 0))
        }));
        return { nombre: h.nombre, esCarreras: !h.tipo, carreras, total: r2(carreras.reduce((s, c) => s + c.total, 0)) };
      });
      // Hipódromos primero (A-Z); traspasos, deportes y otros bloques al final.
      hipodromos.sort((a, b) => (a.esCarreras === b.esCarreras ? 0 : (a.esCarreras ? -1 : 1)) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
      return { fecha: dia.fecha, hipodromos, total: r2(hipodromos.reduce((s, h) => s + h.total, 0)) };
    });
    const totalPeriodo = r2(dias.reduce((s, d) => s + d.total, 0));
    return { dias, totalPeriodo, totalSegunServidor: r2(resp.resumen ? resp.resumen.totalSemana : totalPeriodo) };
  }

  // Nombre de hipódromo para mostrar: cada palabra empieza con mayúscula, como lo hayan escrito al crearlo
  // ("gulfstream park" / "GULFSTREAM PARK" -> "Gulfstream Park"). Las siglas escritas a mano (mezcla de mayúsculas y
  // minúsculas, ej. "McKee") se respetan; "de/del/la/y…" van en minúscula salvo al principio.
  const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);
  function nombreHipodromo(n) {
    return String(n === undefined || n === null ? '' : n).trim().replace(/\s+/g, ' ').split(' ').map((w, i) => {
      if (!w) return w;
      const mixta = /[a-záéíóúñü]/.test(w) && /[A-ZÁÉÍÓÚÑÜ]/.test(w.slice(1));
      const base = mixta ? w : w.toLowerCase();
      if (i > 0 && CONECTORES.has(base)) return base;
      return base.charAt(0).toUpperCase() + base.slice(1);
    }).join(' ');
  }

  const api = { nombreHipodromo, r2, dinero, dineroConSigno, fechaCorta, nombreDia, textoPeriodo, numeroSemanaDe, armarBalance, armarDetalleCliente, descripcionLinea, partesJugada, jugadaHTML, caballosHTML, caballoColorHTML, colorEjemplar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.OficinasInformes = api;
})(typeof window !== 'undefined' ? window : globalThis);
