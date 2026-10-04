// =================================================================
// PRUEBA: "INCLUIR % EN SUS JUGADAS" (29-09-2026, ver la nota grande en
// sql/schema.sql, columna jugadores.incluir_porcentaje_en_jugadas, y el
// pedido del usuario: "si esta en on el tercio queda con su % incluido
// en sus jugadas y no necesitara un item aparte para su %, lo unico que
// le saldra aparte en un item con su nombre y % seria los % que se gane
// por sus avalados... y si lo coloco en off... en la ficha NOMBRE -
// PORCENTAJE le saldra el % de todas sus jugadas mas el % que se gane
// por sus avalados").
//
// Escenario, 2 clientes que juegan EXACTAMENTE lo mismo (apuestan 300 y
// pierden esa jugada, ambos con comision_propia = 1%), para poder
// comparar ON vs OFF con el mismo número:
//   - PEDRO: incluir_porcentaje_en_jugadas = true (ON). Además es
//     avalador de OTRO cliente al 2% — esa relación es independiente del
//     toggle y tiene que seguir funcionando igual.
//   - MARIA: incluir_porcentaje_en_jugadas = false (OFF, default) —
//     tiene que comportarse EXACTAMENTE igual que antes de esta función
//     existir (retrocompatible).
//
// Cubre las 3 capas que toca esta función:
//   1) obtenerComisionesPropias() — el "cuentaNombre"/"incluidaEnJugada"
//      que devuelve para cada entrada.
//   2) asegurarCuentasComisionParaNombres() — no crea cuenta aparte para
//      el cliente en ON.
//   3) construirResumenClienteHipismo() (rama normal, ficha propia del
//      cliente) — el netting DIRECTO en el resultado de cada jugada
//      (rol=jugador Y rol=banquero de Tercios, ver la actualización
//      29-09-2026 más abajo) y el nuevo campo
//      resumen.comisionPropiaIncluidaSemana.
//
// ACTUALIZACIÓN 29-09-2026 (caso real "Mrincreible" — tenía % propio
// configurado pero actuaba de BANQUERO en la jugada real, y su % nunca se
// aplicaba): el % propio/de aval ahora también se gana banqueando en
// Tercios, no solo jugando — PEDRO banqueando la jugada de OTRO (más
// abajo) es la prueba de esto.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

function formatearFechaISOLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mes + '-' + dia;
}

const TABLAS = {
  jugadores: [],
  jugadores_avales_porcentaje: [],
  hipismo_tickets: [],
  hipismo_planos: [],
  hipismo_hipodromos: [],
  hipismo_remate_apuestas: [],
  hipismo_remates: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_adelantadas_planos: [],
  hipismo_winners: [],
  hipismo_comisiones_ajustes: [],
  tickets_historial: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // --- calcularDevueltoDestinoHipismo (services/hipismoResumenCliente.js,
  //     03-10-2026, caso "Mrmoney") --- mismo query/criterio que ya usa
  //     test_hipismo_resumen_cuenta_comision.js para la misma lógica.
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

  // --- obtenerComisionesPropias (services/hipismoComisionPropia.js) ---
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre, j\.incluir_porcentaje_en_jugadas/i.test(sql)) {
    const [grupoId, nombres] = params;
    const delGrupo = TABLAS.jugadores.filter(j => j.grupo_id === grupoId);
    const porId = new Map(delGrupo.map(j => [j.id, j]));
    const rows = delGrupo.filter(j => nombres.includes(j.nombre)).map(j => {
      const ccPropio = j.cuenta_comision_id ? porId.get(j.cuenta_comision_id) : null;
      return {
        id: j.id, nombre: j.nombre, comision_propia: j.comision_propia,
        cc_propio_nombre: ccPropio ? ccPropio.nombre : null,
        incluir_porcentaje_en_jugadas: !!j.incluir_porcentaje_en_jugadas
      };
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
        const ccAval = avalador && avalador.cuenta_comision_id ? porId.get(avalador.cuenta_comision_id) : null;
        return { jugador_id: a.jugador_id, porcentaje: a.porcentaje, avalador_nombre: avalador ? avalador.nombre : null, cc_avalador_nombre: ccAval ? ccAval.nombre : null };
      });
    return { rows };
  }

  // --- asegurarCuentasComisionParaNombres (services/hipismoComisionPropia.js) ---
  if (/^SELECT id, nombre, comision_propia, cuenta_comision_id.*incluir_porcentaje_en_jugadas FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0,
        cuenta_comision_id: j.cuenta_comision_id || null,
        incluir_porcentaje_en_jugadas: !!j.incluir_porcentaje_en_jugadas
      }))
    };
  }
  if (/^SELECT DISTINCT jap\.avalador_id, av\.nombre AS avalador_nombre, av\.cuenta_comision_id AS avalador_cuenta_comision_id/i.test(sql)) {
    const [grupoId, idsJugadores] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const vistos = new Set();
    const rows = [];
    TABLAS.jugadores_avales_porcentaje
      .filter(a => a.grupo_id === grupoId && idsJugadores.includes(a.jugador_id) && a.porcentaje > 0)
      .forEach(a => {
        if (vistos.has(a.avalador_id)) return;
        vistos.add(a.avalador_id);
        const av = porId.get(a.avalador_id);
        rows.push({ avalador_id: a.avalador_id, avalador_nombre: av ? av.nombre : null, avalador_cuenta_comision_id: av ? av.cuenta_comision_id || null : null });
      });
    return { rows };
  }
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial, es_cuenta_comision\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    let cuenta = TABLAS.jugadores.find(j => j.grupo_id === grupoId && j.nombre === nombre);
    if (!cuenta) {
      cuenta = { id: 'cta-auto-' + (TABLAS.jugadores.length + 1), grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0, comision_propia: 0, es_cuenta_comision: true };
      TABLAS.jugadores.push(cuenta);
    } else {
      cuenta.es_cuenta_comision = true;
    }
    return { rows: [{ id: cuenta.id }] };
  }
  if (/^UPDATE jugadores SET cuenta_comision_id = \$1 WHERE id = \$2 AND grupo_id = \$3 AND cuenta_comision_id IS NULL/i.test(sql)) {
    const [cuentaId, jugadorId, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === jugadorId && x.grupo_id === grupoId);
    if (j && !j.cuenta_comision_id) j.cuenta_comision_id = cuentaId;
    return { rows: [] };
  }

  // --- Tercios (obtenerLineasHipismoCliente) ---
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
  // --- Remate (vacío en esta prueba) ---
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) {
    return { rows: [] };
  }
  // --- Adelantadas (vacío en esta prueba) ---
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) {
    return { rows: [] };
  }
  // --- Winners (vacío en esta prueba) ---
  if (/^SELECT w\.caballo, w\.monto, w\.fecha, w\.hipodromo_nombre, w\.carrera_numero, h\.pais/i.test(sql)) {
    return { rows: [] };
  }
  // --- Tickets crudos para el neteo jugador/banquero por carrera, usados
  //     por calcularDevueltoDestinoHipismo (03-10-2026, caso "Mrmoney") —
  //     mismo query/criterio que ya usa test_hipismo_resumen_cuenta_comision.js.
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
  // --- Deportes anclado (no aplica en esta prueba) ---
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros\s+FROM tickets_historial/i.test(sql)) {
    return { rows: [] };
  }
  // --- Traspasos de Comisión de un cliente normal (03-10-2026, ver la
  // nota grande de construirResumenClienteHipismo en
  // services/hipismoResumenCliente.js) — vacío en esta prueba. ---
  if (/^SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes/i.test(sql)) {
    return { rows: [] };
  }

  throw new Error('La base de datos falsa de esta prueba (incluir-porcentaje-en-jugadas) no sabe responder: ' + sql);
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

const { obtenerComisionesPropias, asegurarCuentasComisionParaNombres } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoComisionPropia'));
const { construirResumenClienteHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoResumenCliente'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

(async function main() {
  const GRUPO_ID = 'grupo-incluir-pct-1';
  const grupo = { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: false };
  const FECHA = formatearFechaISOLocal(new Date());

  TABLAS.hipismo_hipodromos.push({ id: 'hip-1', pais: 'VE' });
  TABLAS.hipismo_planos.push({ id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 4, fecha: FECHA, pizarra: '1.2.3' });

  // PEDRO: 1% propio, toggle ON, además avalador de OTRO al 2%.
  TABLAS.jugadores.push({ id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 1, incluir_porcentaje_en_jugadas: true, cuenta_comision_id: null, es_cuenta_comision: false });
  // MARIA: 1% propio, toggle OFF (default) — se comporta como siempre.
  TABLAS.jugadores.push({ id: 'j-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', comision_propia: 1, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false });
  // OTRO: sin % propio, pero PEDRO es su avalador al 2%.
  TABLAS.jugadores.push({ id: 'j-otro', grupo_id: GRUPO_ID, nombre: 'OTRO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false });
  TABLAS.jugadores_avales_porcentaje.push({ grupo_id: GRUPO_ID, jugador_id: 'j-otro', avalador_id: 'j-pedro', porcentaje: 2 });

  // =========== 1) obtenerComisionesPropias ===========
  const comisiones = await obtenerComisionesPropias(GRUPO_ID, ['PEDRO', 'MARIA', 'OTRO']);

  const entradasPedro = comisiones['PEDRO'] || [];
  check(entradasPedro.length === 1, 'PEDRO (toggle ON): una sola entrada (su % propio) — el reporte de "avalado por" pertenece a OTRO, no a él');
  check(entradasPedro[0] && entradasPedro[0].cuentaNombre === 'PEDRO' && entradasPedro[0].incluidaEnJugada === true,
    'PEDRO (toggle ON): cuentaNombre pasa a ser su PROPIO nombre e incluidaEnJugada=true (ya no genera cuenta aparte)');

  const entradasMaria = comisiones['MARIA'] || [];
  check(entradasMaria.length === 1, 'MARIA (toggle OFF): una sola entrada (su % propio)');
  check(entradasMaria[0] && entradasMaria[0].cuentaNombre === 'MARIA - PORCENTAJE' && !entradasMaria[0].incluidaEnJugada,
    'MARIA (toggle OFF): sigue yendo a su cuenta aparte "MARIA - PORCENTAJE", sin incluidaEnJugada (retrocompatible)');

  const entradasOtro = comisiones['OTRO'] || [];
  check(entradasOtro.length === 1 && entradasOtro[0].destino === 'PEDRO' && entradasOtro[0].esAvalAdicional === true,
    'OTRO genera 1 entrada hacia su avalador PEDRO (2%)');
  // 02-10-2026: tras el rediseño, avalador_id YA ES directamente la ficha
  // elegida por el operador al configurar este aval -- en este caso, el
  // PROPIO PEDRO (su cliente real), así que lo que gana por avalar a OTRO
  // cae DIRECTO en su misma ficha, sin ninguna cuenta "PEDRO - PORCENTAJE"
  // auto-creada por detrás. Si el operador hubiera querido una ficha
  // aparte, la habría escrito explícitamente al configurar el aval.
  check(entradasOtro[0].cuentaNombre === 'PEDRO' && !entradasOtro[0].incluidaEnJugada,
    'Lo que PEDRO gana por avalar a OTRO cae directo en su propia ficha "PEDRO" (el operador eligió esa ficha al configurar el aval) -- ya no se auto-crea una cuenta aparte');

  // =========== 2) asegurarCuentasComisionParaNombres ===========
  await asegurarCuentasComisionParaNombres(GRUPO_ID, ['PEDRO', 'MARIA', 'OTRO']);
  const pedroActualizado = TABLAS.jugadores.find(j => j.id === 'j-pedro');
  const mariaActualizada = TABLAS.jugadores.find(j => j.id === 'j-maria');
  check(!!mariaActualizada.cuenta_comision_id, 'MARIA (toggle OFF): SÍ se le crea/enlaza su cuenta "MARIA - PORCENTAJE", como siempre');
  const cuentaMariaCreada = TABLAS.jugadores.find(j => j.id === mariaActualizada.cuenta_comision_id);
  check(!!cuentaMariaCreada && cuentaMariaCreada.nombre === 'MARIA - PORCENTAJE', 'La cuenta creada para MARIA se llama "MARIA - PORCENTAJE"');
  // 02-10-2026: PEDRO (toggle ON) ya NO termina con jugadores.cuenta_comision_id
  // enlazado -- el segundo loop que antes creaba/enlazaba una cuenta aparte
  // para avaladores fue ELIMINADO (ver la nota grande sobre
  // asegurarCuentasComisionParaNombres en hipismoComisionPropia.js): ahora
  // avalador_id ya apunta directo a la ficha elegida por el operador, sin
  // necesitar ningún enlace adicional acá.
  check(!pedroActualizado.cuenta_comision_id,
    'PEDRO (toggle ON) NO recibe ningún cuenta_comision_id por avalar a OTRO -- ya no existe esa creación automática de cuenta aparte');
  check(!TABLAS.jugadores.some(j => j.nombre === 'PEDRO - PORCENTAJE'),
    'No se crea ninguna cuenta "PEDRO - PORCENTAJE" -- el crédito del aval ya fue directo a la ficha real de PEDRO');

  // =========== 3) construirResumenClienteHipismo (ficha propia) ===========
  // PEDRO juega 300 y pierde, Y ADEMÁS banquea una jugada de OTRO por 50 en
  // esta MISMA carrera (carrera_numero: 4, La Rinconada, mismo plano-1) —
  // o sea, PEDRO es un cliente DUAL (juega Y banquea en la misma carrera),
  // con el toggle ON a la vez. ACTUALIZADO 03-10-2026 (caso real
  // "Legolas", ver la nota grande en construirResumenClienteHipismo en
  // services/hipismoResumenCliente.js): antes esta prueba confirmaba que
  // cada lado se ganaba su % por separado (3,00 + 0,50 = 3,50) -- el
  // usuario confirmó que eso rompía el cuadre con Balance General
  // (Cierre Final SÍ netea una carrera dual) y pidió netear también acá.
  // Con el neteo (misma regla EXACTA de netearJugadorBanqueroTercios,
  // caso Loba): decidido jugador = 300, decidido banquero = 50/0,95 = 50
  // (monto ya neto de comisión, resultado positivo) -> como PEDRO perdió
  // jugando y ganó banqueando (no ganó en los 2 lados), se RESTA:
  // |300 - 50| = 250 decidido neto -> 1% de 250 = 2,50, UNA sola comisión
  // asignada a la PRIMERA línea de esa carrera (la de jugador, que es la
  // que se crea primero), con $0 en la de banquero.
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '4', monto: 300, resultado_jugador: -300, resultado_banquero: 285 });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'OTRO', banquero_nombre: 'PEDRO', modalidad: '1/2', caballo: '6', monto: 50, resultado_jugador: -50, resultado_banquero: 47.5 });
  // MARIA juega exactamente lo mismo (300, pierde) pero con el toggle OFF
  // -> su ficha debe seguir mostrando el -300 crudo, sin tocar.
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'MARIA', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '5', monto: 300, resultado_jugador: -300, resultado_banquero: 285 });

  const fichaPedro = await construirResumenClienteHipismo(pedroActualizado, grupo, 'actual');
  // Carrera dual neteada (ver nota grande arriba): comisión única de 2,50
  // cae en la línea de JUGADOR (la primera en aparecer), $0 en la de
  // BANQUERO.
  const esperadoComisionNetaPedro = 2.50;
  const esperadoPedroNeto = round2(-300 + esperadoComisionNetaPedro);
  const esperadoBanqueoPedro = 47.5;
  // 03-10-2026 (caso "Mrmoney", ver calcularDevueltoDestinoHipismo en
  // services/hipismoResumenCliente.js): PEDRO también es el avalador real
  // de OTRO al 2% (línea 225 de este archivo) — OTRO perdió 50 decidido
  // esta semana, así que PEDRO ahora SÍ ve ese 2% de 50 = 1,00 en su propia
  // ficha, algo que antes de este arreglo quedaba invisible acá (aunque
  // Balance General/Cierre Final siempre lo sumó bien).
  const esperadoAvalPedroSobreOtro = 1.00;
  const esperadoPedroTotal = round2(esperadoPedroNeto + esperadoBanqueoPedro + esperadoAvalPedroSobreOtro);
  check(fichaPedro.resumen.totalSemana === esperadoPedroTotal,
    `PEDRO (toggle ON, carrera dual neteada): su ficha suma su línea de jugador con la comisión neta de la carrera (-297,50) más lo que ganó bancando a OTRO sin comisión adicional (47,50, ya consumida por la línea de jugador) más el 2% que gana avalando a OTRO (1,00): esperado ${esperadoPedroTotal}, obtenido ${fichaPedro.resumen.totalSemana}`);
  check(fichaPedro.resumen.comisionPropiaIncluidaSemana === esperadoComisionNetaPedro,
    `PEDRO: resumen.comisionPropiaIncluidaSemana es la comisión NETA de su carrera dual (2,50, no 3,00+0,50=3,50 por separado -- el % de aval sobre OTRO NO cuenta acá, es un ítem de comisión aparte): obtenido ${fichaPedro.resumen.comisionPropiaIncluidaSemana}`);
  const diaPedroFicha = fichaPedro.dias.find(d => d.fecha === FECHA);
  const hipPedroFicha = diaPedroFicha.hipodromos.find(h => h.nombre === 'La Rinconada');
  const lineaJugadorPedro = hipPedroFicha.carreras.find(c => c.rol === 'jugador');
  const lineaBanqueroPedro = hipPedroFicha.carreras.find(c => c.rol === 'banquero');
  check(!!lineaJugadorPedro && lineaJugadorPedro.resultado === esperadoPedroNeto && lineaJugadorPedro.comisionPropiaIncluida === esperadoComisionNetaPedro,
    'La línea de PEDRO como JUGADOR (primera de la carrera dual) se lleva la comisión NETA completa (-297,50) y el campo comisionPropiaIncluida=2,50');
  check(!!lineaBanqueroPedro && lineaBanqueroPedro.resultado === esperadoBanqueoPedro && !lineaBanqueroPedro.comisionPropiaIncluida,
    'La línea de PEDRO como BANQUERO de OTRO (misma carrera dual) NO recibe comisión adicional (ya se asignó completa a la línea de jugador) -- queda en 47,50 sin el campo comisionPropiaIncluida');
  const lineaAvalPedro = hipPedroFicha.carreras.find(c => c.tipo === 'comision');
  check(!!lineaAvalPedro && lineaAvalPedro.clienteOrigen === 'OTRO' && lineaAvalPedro.porcentaje === 2 && lineaAvalPedro.resultado === 1,
    'ARREGLO "Mrmoney" (03-10-2026): aparece una línea de comisión aparte en la propia ficha de PEDRO por avalar a OTRO (2% de 50 = 1,00), antes invisible acá');

  const fichaMaria = await construirResumenClienteHipismo(mariaActualizada, grupo, 'actual');
  check(fichaMaria.resumen.totalSemana === -300,
    `MARIA (toggle OFF): su ficha sigue mostrando la jugada CRUDA, sin tocar (-300,00): obtenido ${fichaMaria.resumen.totalSemana}`);
  check(fichaMaria.resumen.comisionPropiaIncluidaSemana === 0,
    'MARIA (toggle OFF): comisionPropiaIncluidaSemana da 0 (nada se incluyó, retrocompatible)');
  const diaMariaFicha = fichaMaria.dias.find(d => d.fecha === FECHA);
  const hipMariaFicha = diaMariaFicha.hipodromos.find(h => h.nombre === 'La Rinconada');
  const lineaMaria = hipMariaFicha.carreras.find(c => c.rol === 'jugador');
  check(!!lineaMaria && lineaMaria.resultado === -300 && !lineaMaria.comisionPropiaIncluida,
    'La línea de MARIA no trae el campo comisionPropiaIncluida (no aplica con el toggle OFF)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "incluir % en sus jugadas" se cayó con una excepción:', e);
  process.exit(1);
});
