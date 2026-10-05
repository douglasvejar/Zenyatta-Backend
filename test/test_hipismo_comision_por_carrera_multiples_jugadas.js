// =================================================================
// PRUEBA: "incluir % en sus jugadas" cuadra con Balance General cuando el
// cliente tiene VARIAS jugadas propias en la MISMA carrera, SIN ninguna
// carrera dual (03-10-2026, caso real "Sammy": $0,60 de diferencia entre
// la grilla y su propio link, sin ningún "Jugó X" + "Dio Y" mezclados en
// la misma carrera -- a diferencia de Legolas).
//
// Causa real, confirmada con los números EXACTOS de la captura real de
// Sammy (Keeneland, 5ta Carrera, sábado 3 de octubre, 4 jugadas "Jugó"
// seguidas, comision_propia = 1,5%, decidido 25/25/105/105 según
// montoDecididoExacto): Balance General (construirCierreFinalHipismo,
// vía acumularDevuelto/porGrupoCarrera) agrupa TODA la plata de una misma
// carrera y redondea 1 SOLA VEZ al final (mismo patrón ya confirmado para
// el caso CODINO) -- pero antes de este arreglo, construirResumenClienteHipismo
// (la ficha propia del cliente) redondeaba el % de CADA línea por
// separado y sumaba esos redondeos. Con 1 sola jugada por carrera da
// exactamente lo mismo, pero con varias jugadas en la misma carrera el
// redondeo de céntimos se acumula:
//   viejo (buggy):  round2(25*1.5%) + round2(25*1.5%) + round2(105*1.5%) + round2(105*1.5%)
//                 = 0,38 + 0,38 + 1,58 + 1,58 = 3,92
//   nuevo (correcto, igual que Balance General): round2(25*1.5% + 25*1.5% + 105*1.5% + 105*1.5%)
//                 = round2(3,90) = 3,90
//
// El usuario confirmó (03-10-2026, misma decisión que ya había tomado
// para el caso Legolas): la comisión neta/exacta de la carrera se asigna
// COMPLETA a la primera línea de esa carrera, con $0 adicional en las
// demás líneas de la misma carrera para este cliente -- el MISMO
// mecanismo de netoIncluidoPorCarrera, ahora aplicado a CUALQUIER
// carrera con 2+ jugadas propias (dual o no), no solo a las duales.
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
  if (/^SELECT j\.nombre\s+FROM jugadores j\s+WHERE j\.grupo_id = \$1/i.test(sql)) {
    return { rows: [] }; // sin traspasos/avales en esta prueba
  }
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
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) return { rows: [] };
  if (/^SELECT w\.caballo, w\.monto, w\.fecha, w\.hipodromo_nombre, w\.carrera_numero, h\.pais/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros\s+FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (comision-por-carrera-multiples-jugadas) no sabe responder: ' + sql);
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
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

(async function main() {
  const GRUPO_ID = 'grupo-comision-carrera-1';
  const grupo = { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: false };
  const FECHA = formatearFechaISOLocal(new Date());

  TABLAS.hipismo_hipodromos.push({ id: 'hip-1', pais: 'VE' });
  TABLAS.hipismo_planos.push({ id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'Keeneland', carrera_numero: 5, fecha: FECHA, pizarra: '10 9 4' });

  // SAMMY: 1,5% propio, toggle ON -- mismos números EXACTOS que la
  // captura real (Keeneland 5ta, sábado 3 de octubre): 4 jugadas propias
  // (todas "Jugó", SIN ningún "Dio" -- no hay carrera dual acá), montos
  // decididos 25 / 25 / 105 / 105 según montoDecididoExacto (resultado
  // positivo, sin sinComision -> decidido = resultado/0.95).
  TABLAS.jugadores.push({ id: 'j-sammy', grupo_id: GRUPO_ID, nombre: 'SAMMY', comision_propia: 1.5, incluir_porcentaje_en_jugadas: true, cuenta_comision_id: null, es_cuenta_comision: false });
  // resultado = decidido * 0.95 (gana con comisión del 5%, como cualquier
  // jugada normal con sinComision=false/null).
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'SAMMY', banquero_nombre: 'BANCO', modalidad: '2N', caballo: '10', monto: 25, resultado_jugador: 23.75, resultado_banquero: -23.75 });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'SAMMY', banquero_nombre: 'BANCO', modalidad: '2/2', caballo: '10', monto: 25, resultado_jugador: 23.75, resultado_banquero: -23.75 });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'SAMMY', banquero_nombre: 'BANCO', modalidad: '2N', caballo: '10', monto: 105, resultado_jugador: 99.75, resultado_banquero: -99.75 });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'SAMMY', banquero_nombre: 'BANCO', modalidad: '2/2', caballo: '10', monto: 105, resultado_jugador: 99.75, resultado_banquero: -99.75 });

  const sammy = TABLAS.jugadores[0];
  const ficha = await construirResumenClienteHipismo(sammy, grupo, 'actual');

  // Lo que el bug viejo (redondear cada línea por separado) habría dado:
  const comisionViejaBuggy = round2(25 * 0.015) + round2(25 * 0.015) + round2(105 * 0.015) + round2(105 * 0.015);
  check(comisionViejaBuggy === 3.92, `(sanity check del propio cálculo viejo, no del código real): ${comisionViejaBuggy} debía dar 3,92`);

  // Lo correcto (igual que Balance General: exacto por carrera, 1 solo
  // redondeo): 25*1.5% + 25*1.5% + 105*1.5% + 105*1.5% = 3,90 exacto.
  const comisionCorrecta = round2(25 * 0.015 + 25 * 0.015 + 105 * 0.015 + 105 * 0.015);
  check(comisionCorrecta === 3.90, `(sanity check): la suma exacta antes de redondear da 3,90, no 3,92 -- diferencia real de 2 centavos en ESTA sola carrera: ${comisionCorrecta}`);

  check(ficha.resumen.comisionPropiaIncluidaSemana === comisionCorrecta,
    `SAMMY (4 jugadas propias en la MISMA carrera, sin ninguna dual): comisionPropiaIncluidaSemana usa la suma EXACTA redondeada 1 sola vez (3,90), NO la suma de 4 redondeos individuales (3,92 -- el bug viejo): obtenido ${ficha.resumen.comisionPropiaIncluidaSemana}`);

  const esperadoTotalSemana = round2(23.75 + 23.75 + 99.75 + 99.75 + comisionCorrecta);
  check(ficha.resumen.totalSemana === esperadoTotalSemana,
    `SAMMY: totalSemana (247,00 de resultado crudo + 3,90 de comisión exacta) cuadra con lo que Balance General calcularía para esta misma carrera: esperado ${esperadoTotalSemana}, obtenido ${ficha.resumen.totalSemana}`);

  const dia = ficha.dias.find(d => d.fecha === FECHA);
  const hip = dia.hipodromos.find(h => h.nombre === 'Keeneland');
  const lineas = hip.carreras.filter(c => c.carrera === 5);
  check(lineas.length === 4, 'Las 4 jugadas de Sammy en Keeneland 5ta siguen apareciendo, una por una, en su ficha');

  // El usuario confirmó (misma decisión que para Legolas): la comisión
  // completa de la carrera cae en la PRIMERA línea que aparece, $0 en
  // las demás líneas de esa misma carrera.
  check(lineas[0].comisionPropiaIncluida === comisionCorrecta,
    `La PRIMERA jugada de la carrera se lleva la comisión COMPLETA de la carrera (3,90), no solo la suya individual (0,38): obtenido ${lineas[0].comisionPropiaIncluida}`);
  check(!lineas[1].comisionPropiaIncluida && !lineas[2].comisionPropiaIncluida && !lineas[3].comisionPropiaIncluida,
    'Las otras 3 jugadas de la MISMA carrera NO llevan ninguna comisión adicional (ya se asignó completa a la primera) -- quedan con su resultado crudo, sin la notita "incluye %"');

  const sumaResultadosLineas = round2(lineas.reduce((acc, c) => acc + c.resultado, 0));
  check(sumaResultadosLineas === esperadoTotalSemana,
    `La suma de las 4 líneas mostradas (23,75+23,75+99,75+${round2(99.75 + comisionCorrecta)}) da exactamente el mismo total que resumen.totalSemana -- no hay plata que aparezca ni desaparezca, solo se reubicó en qué línea se muestra: obtenido ${sumaResultadosLineas}`);

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron) process.exitCode = 1;
})();
