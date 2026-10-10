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
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
  function textoPeriodo(d) {
    const rango = `${fechaCorta(d.rango.desde)} al ${fechaCorta(d.rango.hasta)}`;
    if (d.rangoPersonalizado) return `Del ${rango}`;
    return `Semana ${d.numeroSemana} — ${rango}`;
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
    return { filas, totalClientes, comisionOficina, diferencia };
  }

  // ---------------- Detallado por Cliente ----------------
  // resp: respuesta de /clientes/:nombre/detalle-semana. Ordena por día > hipódromo > carrera y suma cada nivel.
  function descripcionLinea(l) {
    if (l.tipo === 'traspaso') return 'Traspaso' + (l.nota ? ' — ' + l.nota : '');
    if (l.tipo === 'carga') return l.texto || 'Carga';
    if (l.tipo === 'comision') {
      const pct = l.porcentaje !== undefined ? `${l.porcentaje}% de ${dinero(l.monto)}` : '';
      return `% devuelto${l.clienteOrigen ? ' (' + l.clienteOrigen + ')' : ''}${pct ? ' — ' + pct : ''}`;
    }
    if (l.ticket) return `Ticket ${l.ticket}${l.detalle ? ' — ' + l.detalle : ''}`;
    const rol = l.rol === 'banquero' ? 'Dio' : (l.rol === 'jugador' ? 'Jugó' : '');
    let caballo = '';
    if (l.modalidad === 'pp' && l.caballoA !== undefined) caballo = `${l.caballoA}x${l.caballoB}`;
    else if (l.caballo !== undefined && l.caballo !== null) caballo = String(l.caballo).replace(/^\(|\)$/g, '');
    const jugada = [l.modalidad, caballo ? `(${caballo})` : ''].filter(Boolean).join(' ');
    const monto = l.monto !== undefined && l.monto !== null ? ` con ${dinero(l.monto)}` : '';
    return [rol, jugada].filter(Boolean).join(' ') + monto || 'Jugada';
  }

  function armarDetalleCliente(resp) {
    const dias = (resp.dias || []).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map(dia => {
      const hipodromos = (dia.hipodromos || []).map(h => {
        const porCarrera = new Map();
        (h.carreras || []).forEach(l => {
          const n = l.carrera ? Number(l.carrera) : 0;
          if (!porCarrera.has(n)) porCarrera.set(n, []);
          porCarrera.get(n).push({ texto: descripcionLinea(l), resultado: r2(l.resultado), rol: l.rol || null, tipo: l.tipo || null });
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

  const api = { nombreHipodromo, r2, dinero, dineroConSigno, fechaCorta, nombreDia, textoPeriodo, armarBalance, armarDetalleCliente, descripcionLinea };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.OficinasInformes = api;
})(typeof window !== 'undefined' ? window : globalThis);
