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
  if (/^SELECT nombre, pais FROM hipismo_hipodromos WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.hipismo_hipodromos.filter(h => h.grupo_id === params[0]).map(h => ({ nombre: h.nombre, pais: h.pais })) };
  }
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) return { rows: [] };
  if (/^SELECT w\.caballo, w\.monto, w\.fecha, w\.hipodromo_nombre, w\.carrera_numero, h\.pais/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros\s+FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (pais-bandera-link) no sabe responder: ' + sql);
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

// 15-10-2026: en el link del cliente todos los hipódromos salían con la
// bandera de Venezuela porque el país venía de un JOIN por hipodromo_id (que
// da null cuando el plano no tiene ese id y se asumía 'VE'). Ahora se busca por
// nombre en hipismo_hipodromos.
(async function main() {
  const GRUPO_ID = 'grupo-pais-1';
  const grupo = { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: false };
  const FECHA = formatearFechaISOLocal(new Date());

  TABLAS.hipismo_hipodromos.push({ id: 'hip-ve', grupo_id: GRUPO_ID, nombre: 'La Rinconada', pais: 'VE' });
  TABLAS.hipismo_hipodromos.push({ id: 'hip-us', grupo_id: GRUPO_ID, nombre: 'Keeneland', pais: 'US' });
  // Los 2 planos SIN hipodromo_id (el caso que fallaba): el JOIN da pais null.
  TABLAS.hipismo_planos.push({ id: 'p1', grupo_id: GRUPO_ID, hipodromo_id: null, hipodromo_nombre: 'Keeneland', carrera_numero: 5, fecha: FECHA, pizarra: '1' });
  TABLAS.hipismo_planos.push({ id: 'p2', grupo_id: GRUPO_ID, hipodromo_id: null, hipodromo_nombre: 'LA RINCONADA', carrera_numero: 2, fecha: FECHA, pizarra: '2' });
  TABLAS.jugadores.push({ id: 'j1', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 0, incluir_porcentaje_en_jugadas: false });
  TABLAS.hipismo_tickets.push({ plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'ANA', banquero_nombre: 'BANCO', modalidad: '2N', caballo: '10', monto: 100, resultado_jugador: 95, resultado_banquero: -95 });
  TABLAS.hipismo_tickets.push({ plano_id: 'p2', grupo_id: GRUPO_ID, cliente_nombre: 'ANA', banquero_nombre: 'BANCO', modalidad: '2N', caballo: '3', monto: 50, resultado_jugador: -50, resultado_banquero: 50 });

  const ficha = await construirResumenClienteHipismo(TABLAS.jugadores[0], grupo, 'actual');
  const hips = ficha.dias.flatMap(d => d.hipodromos);
  const keeneland = hips.find(h => h.nombre === 'Keeneland');
  const rinconada = hips.find(h => h.nombre === 'LA RINCONADA');
  check(!!keeneland && keeneland.pais === 'US', `Keeneland sale con país US aunque el plano no tenga hipodromo_id: ${keeneland && keeneland.pais}`);
  check(!!rinconada && rinconada.pais === 'VE', `LA RINCONADA (mayúsculas distintas) sale con país VE: ${rinconada && rinconada.pais}`);

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron) process.exitCode = 1;
})();
