// =================================================================
// PRUEBA: construirResumenClienteHipismo() (24-09-2026, services/
// hipismoResumenCliente.js) — la función que arma la respuesta que ve
// UN cliente puntual, ahora compartida entre 2 lugares (ver la nota
// grande del archivo): el portal público (routes/hipismoCliente.js, por
// token) y la nueva pantalla del Administrador "Saldos > Detallado por
// Cliente" (GET /api/hipismo/clientes/:nombre/detalle-semana, por
// nombre+sesión). Esta prueba es una prueba de REGRESIÓN del refactor:
// antes esta lógica vivía inline dentro de routes/hipismoCliente.js —
// acá se confirma que, movida a su propio archivo y llamada con
// jugador/grupo ya resueltos (en vez de buscarlos ella misma por
// token), sigue produciendo exactamente el mismo resultado.
//
// Mismo patrón de base de datos falsa que test_hipismo_lineas_cliente.js
// (Module._load intercepta "pg" antes de requerir services/db.js).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// FECHA dinámica (28-09-2026, mismo arreglo que test_hipismo_resumen_cuenta_
// comision.js: una fecha fija dejaba de caer dentro de "la semana actual"
// apenas pasaba esa semana calendario, y esta prueba pide 'actual').
function formatearFechaISOLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mes + '-' + dia;
}
const FECHA = formatearFechaISOLocal(new Date());

const TABLAS = {
  hipismo_tickets: [],
  hipismo_planos: [],
  hipismo_hipodromos: [],
  hipismo_remate_apuestas: [],
  hipismo_remates: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_adelantadas_planos: [],
  tickets_historial: [],
  // 03-10-2026, ver la nota grande de construirResumenClienteHipismo en
  // services/hipismoResumenCliente.js (caso real: "legolas por ejemplo da
  // 3853 y en el link dice 3861,98" — un traspaso de comisión sobre un
  // cliente NORMAL, no una cuenta "{nombre} - PORCENTAJE", no se estaba
  // leyendo acá).
  hipismo_comisiones_ajustes: [],
  // 03-10-2026, 2da vuelta, ver la nota grande EXACTA de
  // calcularDevueltoDestinoHipismo en services/hipismoResumenCliente.js
  // (caso real "Mrmoney": +$12,10 en Balance General/"Detallado por
  // Cliente" pero "$0,00 / No hay jugadas cargadas" en su propio link —
  // Mrmoney no es una cuenta de comisión, es el AVALADOR real de OTRO
  // cliente, algo que esta función antes nunca leía para un cliente
  // normal).
  jugadores: [],
  jugadores_avales_porcentaje: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
      .map(t => ({ t, plano: TABLAS.hipismo_planos.find(p => p.id === t.plano_id) }))
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta);
    return {
      rows: filas.map(({ t, plano }) => {
        const hip = TABLAS.hipismo_hipodromos.find(h => h.id === plano.hipodromo_id);
        return {
          cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad,
          caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero,
          fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, carrera_numero: plano.carrera_numero,
          pizarra: plano.pizarra, pais: hip ? hip.pais : null
        };
      })
    };
  }
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId && a.cliente_nombre === nombre)
      .map(a => ({ a, remate: TABLAS.hipismo_remates.find(r => r.id === a.remate_id) }))
      .filter(({ remate }) => remate && remate.fecha >= desde && remate.fecha <= hasta);
    return {
      rows: filas.map(({ a, remate }) => ({
        caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto, resultado: a.resultado,
        fecha: remate.fecha, hipodromo_nombre: remate.hipodromo_nombre, carrera_numero: remate.carrera_numero,
        pizarra: remate.pizarra, numero_ganador: remate.numero_ganador, pais: null
      }))
    };
  }
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const estadosValidos = ['resuelto', 'falta_banqueo', 'sin_decidir'];
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && estadosValidos.includes(j.estado))
      .filter(j => j.cliente_nombre === nombre || (Array.isArray(j.banqueadores) && j.banqueadores.some(b => b.nombre === nombre)))
      .map(j => ({ j, plano: TABLAS.hipismo_adelantadas_planos.find(p => p.id === j.plano_id) }))
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta);
    return {
      rows: filas.map(({ j, plano }) => ({
        tipo: j.tipo, cliente_nombre: j.cliente_nombre, carrera_numero: j.carrera_numero,
        cantidad_tf: j.cantidad_tf, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2,
        monto: j.monto, resultado_cliente: j.resultado_cliente, banqueadores: j.banqueadores, pizarra_usada: j.pizarra_usada,
        fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, pais: null
      }))
    };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros\s+FROM tickets_historial/i.test(sql)) {
    const [grupoId, desde, hasta, cliente] = params;
    const filas = TABLAS.tickets_historial.filter(t =>
      t.grupo_id === grupoId && t.fecha >= desde && t.fecha <= hasta && t.cliente_nombre === cliente);
    return { rows: filas };
  }

  // "Cargar Winners" (26-09-2026) — 4ta consulta de obtenerLineasHipismoCliente.
  if (/^SELECT w\.caballo, w\.monto, w\.fecha, w\.hipodromo_nombre, w\.carrera_numero, h\.pais/i.test(sql)) {
    return { rows: [] };
  }

  // Tickets crudos para el neteo jugador/banquero por carrera, usados por
  // calcularDevueltoDestinoHipismo (03-10-2026, caso "Mrmoney") — mismo
  // query/criterio que ya usa test_hipismo_resumen_cuenta_comision.js.
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero,\s*t\.sin_comision, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
      .map(t => ({ t, plano: TABLAS.hipismo_planos.find(p => p.id === t.plano_id) }))
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta);
    return {
      rows: filas.map(({ t, plano }) => ({
        cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre,
        resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero,
        sin_comision: t.sin_comision, fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre,
        carrera_numero: plano.carrera_numero
      }))
    };
  }

  // Traspasos de Comisión de un cliente NORMAL (03-10-2026, ver la nota
  // grande de construirResumenClienteHipismo en services/hipismoResumenCliente.js
  // — mismo query/shape que ya usaba construirResumenCuentaComisionHipismo
  // para una cuenta "{nombre} - PORCENTAJE", ver test_hipismo_resumen_cuenta_comision.js).
  if (/^SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes/i.test(sql)) {
    const [grupoId, clienteNombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_comisiones_ajustes
      .filter(a => a.grupo_id === grupoId && a.cliente_nombre === clienteNombre && a.fecha >= desde && a.fecha <= hasta)
      .map(a => ({ monto: a.monto, fecha: a.fecha, nota: a.nota || null }));
    return { rows: filas };
  }

  // calcularDevueltoDestinoHipismo (03-10-2026, caso "Mrmoney", ver la
  // nota grande de TABLAS más arriba) — mismas 3 consultas que ya usa
  // test_hipismo_resumen_cuenta_comision.js para la misma lógica.
  if (/^SELECT j\.nombre\s+FROM jugadores j\s+WHERE j\.grupo_id = \$1/i.test(sql)) {
    const [grupoId, destinoId] = params;
    const rows = TABLAS.jugadores.filter(j => {
      if (j.grupo_id !== grupoId || j.es_cuenta_comision || j.id === destinoId) return false;
      const cond1 = j.cuenta_comision_id === destinoId && (Number(j.comision_propia) || 0) > 0 && !j.incluir_porcentaje_en_jugadas;
      const cond2 = TABLAS.jugadores_avales_porcentaje.some(a => a.jugador_id === j.id && (Number(a.porcentaje) || 0) > 0 && a.avalador_id === destinoId);
      return cond1 || cond2;
    }).map(j => ({ nombre: j.nombre }));
    return { rows };
  }
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const rows = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => {
      const ccPropio = j.cuenta_comision_id ? porId.get(j.cuenta_comision_id) : null;
      return { id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: ccPropio ? ccPropio.nombre : null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas || false };
    });
    return { rows };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    const [grupoId, idsJugadores] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const rows = TABLAS.jugadores_avales_porcentaje
      .filter(a => a.grupo_id === grupoId && idsJugadores.includes(a.jugador_id))
      .map(a => {
        const avalador = porId.get(a.avalador_id);
        return { jugador_id: a.jugador_id, porcentaje: a.porcentaje, avalador_nombre: avalador ? avalador.nombre : null };
      });
    return { rows };
  }

  throw new Error('La base de datos falsa de esta prueba (resumen-cliente) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';

const { construirResumenClienteHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoResumenCliente'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const GRUPO_ID = 'grupo-resumen-1';
  const grupo = { nombre: 'Zenyatta', logo_url: 'https://ejemplo.com/logo.png', modulo_deportes_habilitado: true };

  // --- Fixture: HANRY, un Tercios normal + una Adelantada (Tabla Fija) ---
  TABLAS.hipismo_planos.push({ id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: FECHA, pizarra: '6.10.4' });
  TABLAS.hipismo_hipodromos.push({ id: 'hip-1', pais: 'VE' });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'HANRY', banquero_nombre: 'BANCO', modalidad: '9x2', caballo: '9', monto: 50, resultado_jugador: -50, resultado_banquero: 47.5 });
  TABLAS.hipismo_adelantadas_planos.push({ id: 'plano-adel-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', fecha: FECHA });
  TABLAS.hipismo_adelantadas_jugadas.push({
    id: 'adel-1', plano_id: 'plano-adel-1', grupo_id: GRUPO_ID, cliente_nombre: 'HANRY', carrera_numero: 9,
    tipo: 'tf', cantidad_tf: 1, numero_ejemplar: 1, monto: 50, resultado_cliente: 47.5, banqueadores: null,
    pizarra_usada: '6.10.4', estado: 'resuelto'
  });

  const jugadorHanry = { grupo_id: GRUPO_ID, nombre: 'HANRY', modulos_anclados: false };
  const resumenHanry = await construirResumenClienteHipismo(jugadorHanry, grupo, 'actual');

  // 29-09-2026: ya no viaja la logo_url cruda -- viaja la URL del proxy
  // propio (ver services/logoGrupo.js), armada con jugador.grupo_id.
  check(resumenHanry.grupo.nombre === 'Zenyatta' && resumenHanry.grupo.logoUrl === `/api/imagenes/logo-grupo/${GRUPO_ID}`,
    'El resumen trae el nombre del grupo y la URL del proxy de su logo');
  check(resumenHanry.jugador.nombre === 'HANRY', 'El resumen trae el nombre del jugador');
  check(resumenHanry.modulos.hipismo === true && resumenHanry.modulos.deportes === false,
    'Sin Deportes anclado (modulos_anclados: false), aunque el grupo sí tenga Deportes habilitado');
  check(resumenHanry.resumen.totalSemana === -2.5, 'Total de HANRY: -50 (Tercios) + 47.5 (Adelantada) = -2.5 — el mismo caso reportado por el usuario');
  check(resumenHanry.resumen.cantidadJugadas === 2, 'Cuenta las 2 jugadas (1 Tercios + 1 Adelantada)');
  const diaHanry = resumenHanry.dias.find(d => d.fecha === FECHA);
  check(!!diaHanry, 'Trae el día agrupado');
  const carrerasHanry = diaHanry.hipodromos.find(h => h.nombre === 'La Rinconada').carreras;
  check(carrerasHanry.length === 2, 'Las 2 jugadas de HANRY quedan agrupadas bajo el mismo hipódromo/día');
  check(!!carrerasHanry.find(c => c.tipo === 'adelantada' && c.subtipo === 'tf' && c.resultado === 47.5),
    'La línea de Adelantada trae tipo/subtipo/resultado correctos, lista para que el frontend arme "🕐 Adelantada — Tabla fija (1)"');

  // --- Fixture: MULTI, con Hipismo + Deportes anclado ---
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'MULTI', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '5', monto: 40, resultado_jugador: 36, resultado_banquero: -36 });
  TABLAS.tickets_historial.push({ grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'MULTI', ticket: 'T1', detalle: 'Real Madrid ML', arriesga: 20, gana: 38, estado: 'GANADA', logros: null });
  TABLAS.tickets_historial.push({ grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'MULTI', ticket: 'T2', detalle: 'Barcelona ML', arriesga: 15, gana: 0, estado: 'PERDIDA', logros: null });

  const jugadorMulti = { grupo_id: GRUPO_ID, nombre: 'MULTI', modulos_anclados: true };
  const resumenMulti = await construirResumenClienteHipismo(jugadorMulti, grupo, 'actual');

  check(resumenMulti.modulos.deportes === true, 'MULTI tiene Deportes anclado (modulos_anclados: true + grupo con Deportes habilitado)');
  check(resumenMulti.resumen.totalHipismo === 36, 'Total de Hipismo de MULTI: 36 (Tercios)');
  check(resumenMulti.resumen.totalDeportes === 23, 'Total de Deportes de MULTI: 38 (ganada) - 15 (perdida) = 23');
  check(resumenMulti.resumen.totalSemana === 59, 'Total combinado de MULTI: 36 + 23 = 59 (Hipismo + Deportes juntos)');
  const diaMulti = resumenMulti.dias.find(d => d.fecha === FECHA);
  const bloqueDeportes = diaMulti.hipodromos.find(h => h.tipo === 'deportes');
  check(!!bloqueDeportes && bloqueDeportes.carreras.length === 2, 'El bloque "Deportes" aparece separado, con sus 2 tickets');

  // =================================================================
  // --- Fixture: LEGOLAS, el caso REAL reportado por el usuario (03-10-2026):
  // "los saldos de los link no dan igual al de los balances... legolas por
  // ejemplo da 3853 y en el link dice 3861,98". Legolas jugó normal (Tercios)
  // Y, aparte, el Administrador le hizo un traspaso de comisión (negativo,
  // plata que salió de su cuenta hacia otra) — Balance General/Cierre Final
  // (construirCierreFinalHipismo) SIEMPRE sumó ese traspaso vía
  // obtenerAjustesComision, pero el link de Legolas y "Detallado por
  // Cliente" (construirResumenClienteHipismo) lo ignoraban por completo:
  // antes de este arreglo, su link mostraba SOLO 500 (la jugada), nunca
  // 500 - 8.98 = 491.02 (lo que Balance General sí mostraba).
  // =================================================================
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'LEGOLAS', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '3', monto: 500, resultado_jugador: 500, resultado_banquero: -500 });
  TABLAS.hipismo_comisiones_ajustes.push({ grupo_id: GRUPO_ID, cliente_nombre: 'LEGOLAS', monto: -8.98, fecha: FECHA, nota: 'Traspaso de prueba' });

  const jugadorLegolas = { grupo_id: GRUPO_ID, nombre: 'LEGOLAS', modulos_anclados: false };
  const resumenLegolas = await construirResumenClienteHipismo(jugadorLegolas, grupo, 'actual');

  check(resumenLegolas.resumen.totalSemana === 491.02,
    `ARREGLO: el link/detalle de LEGOLAS da 500 (jugada) - 8.98 (traspaso) = 491.02, igual que Balance General, nunca 500 a secas -- dio ${resumenLegolas.resumen.totalSemana}`);
  const diaLegolas = resumenLegolas.dias.find(d => d.fecha === FECHA);
  const bloqueTraspasoLegolas = diaLegolas.hipodromos.find(h => h.tipo === 'traspaso');
  check(!!bloqueTraspasoLegolas && bloqueTraspasoLegolas.carreras.length === 1 && bloqueTraspasoLegolas.carreras[0].resultado === -8.98,
    'El traspaso de LEGOLAS aparece como su propio bloque "Traspasos de Comisión" (🔄), igual que ya hacía una cuenta "{nombre} - PORCENTAJE"');

  // --- Fixture: SOLOTRASPASO, un cliente que ESA semana no jugó nada —
  // su ÚNICO movimiento es un traspaso de comisión a favor. Antes de este
  // arreglo, su link/Detallado por Cliente daba $0 en vez del monto real
  // (el bug exacto que describió el usuario: "hay algunos que muestran un
  // saldo en la pantalla y al darle click sale en 0").
  TABLAS.hipismo_comisiones_ajustes.push({ grupo_id: GRUPO_ID, cliente_nombre: 'SOLOTRASPASO', monto: 25, fecha: FECHA, nota: null });
  const jugadorSoloTraspaso = { grupo_id: GRUPO_ID, nombre: 'SOLOTRASPASO', modulos_anclados: false };
  const resumenSoloTraspaso = await construirResumenClienteHipismo(jugadorSoloTraspaso, grupo, 'actual');
  check(resumenSoloTraspaso.resumen.totalSemana === 25,
    `ARREGLO: SOLOTRASPASO (sin jugadas, solo un traspaso de +25) da 25, NUNCA 0 -- dio ${resumenSoloTraspaso.resumen.totalSemana}`);
  check(resumenSoloTraspaso.resumen.cantidadJugadas === 1, 'El traspaso cuenta como 1 movimiento, para que "Detallado por Cliente" no diga "sin jugadas"');

  // =================================================================
  // --- Fixture: MRMONEY, el caso REAL reportado por el usuario (03-10-2026):
  // "este cliente muestra 12,1 al darle click me dice 0....." — MRMONEY es
  // un CLIENTE NORMAL (no una cuenta "{nombre} - PORCENTAJE") configurado
  // como "¿Quién lo avala?" de otro cliente real (FUENTE1), que SÍ jugó
  // esta semana. MRMONEY mismo no tiene ninguna jugada propia esta semana
  // -- antes de este arreglo, su link/"Detallado por Cliente" daba $0 /
  // "No hay jugadas cargadas", aunque Balance General (construirCierreFinalHipismo)
  // SÍ sumaba bien su % de aval vía el acumular()/acumularDevuelto()
  // genérico (que no distingue si el destino es una cuenta dedicada o un
  // cliente real).
  // =================================================================
  TABLAS.jugadores.push({ id: 'j-mrmoney', grupo_id: GRUPO_ID, nombre: 'MRMONEY', es_cuenta_comision: false, comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false });
  TABLAS.jugadores.push({ id: 'j-fuente1', grupo_id: GRUPO_ID, nombre: 'FUENTE1', es_cuenta_comision: false, comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false });
  TABLAS.jugadores_avales_porcentaje.push({ grupo_id: GRUPO_ID, jugador_id: 'j-fuente1', avalador_id: 'j-mrmoney', porcentaje: 2 });
  TABLAS.hipismo_planos.push({ id: 'plano-mrmoney', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 4, fecha: FECHA, pizarra: '6.10.4' });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-mrmoney', grupo_id: GRUPO_ID, cliente_nombre: 'FUENTE1', banquero_nombre: 'BANCOZ', modalidad: '1/2', caballo: '7', monto: 500, resultado_jugador: -500, resultado_banquero: 475 });

  const jugadorMrmoney = { id: 'j-mrmoney', grupo_id: GRUPO_ID, nombre: 'MRMONEY', modulos_anclados: false };
  const resumenMrmoney = await construirResumenClienteHipismo(jugadorMrmoney, grupo, 'actual');

  check(resumenMrmoney.resumen.totalSemana === 10,
    `ARREGLO: MRMONEY (sin jugadas propias, solo 2% de aval sobre los 500 decididos que perdió FUENTE1) da 10, NUNCA 0 -- dio ${resumenMrmoney.resumen.totalSemana}`);
  check(resumenMrmoney.resumen.cantidadJugadas === 1, 'El % de aval cuenta como 1 movimiento, para que "Detallado por Cliente" no diga "sin jugadas"');
  const diaMrmoney = resumenMrmoney.dias.find(d => d.fecha === FECHA);
  check(!!diaMrmoney, 'MRMONEY trae el día agrupado aunque no haya jugado él mismo');
  const comisionMrmoney = diaMrmoney.hipodromos.find(h => h.nombre === 'La Rinconada').carreras.find(c => c.tipo === 'comision');
  check(!!comisionMrmoney && comisionMrmoney.clienteOrigen === 'FUENTE1' && comisionMrmoney.porcentaje === 2 && comisionMrmoney.resultado === 10,
    'La línea de comisión de MRMONEY trae el cliente origen (FUENTE1), el % (2) y el monto devuelto (10) correctos');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de resumen de cliente se cayó con una excepción:', e);
  process.exit(1);
});
