// =================================================================
// PRUEBA: whatsappDiaEstado.js — el "reloj"/candado de cada día para el
// bot de WhatsApp (03-09-2026, más tarde todavía, ver la nota grande en
// sql/schema.sql sobre whatsapp_dia_estado).
//
// Mismo patrón de "pg" falso en memoria que el resto del proyecto. El
// UPSERT (ON CONFLICT ... DO UPDATE) se simula a mano, incluido el
// COALESCE de marcarSabanaFinalRecibida (no pisar un sabana_final_en que
// ya existía).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    { id: 'g1', whatsapp_grupo_jid: '120363000000000001@g.us' },
    { id: 'g2', whatsapp_grupo_jid: null } // sin JID vinculado
  ],
  whatsapp_dia_estado: [] // { grupo_id, fecha, ultimo_texto, ultimo_texto_en, sabana_final_en, ultima_verificacion_en, ultimo_envio_resumen_en, ultimo_hash_resumen, cierre_enviado_en }
};

function filaVacia(grupoId, fecha) {
  return {
    grupo_id: grupoId, fecha,
    ultimo_texto: null, ultimo_texto_en: null,
    sabana_final_en: null, ultima_verificacion_en: null,
    ultimo_envio_resumen_en: null, ultimo_hash_resumen: null,
    cierre_enviado_en: null
  };
}

function buscar(grupoId, fecha) {
  return TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT .* FROM whatsapp_dia_estado WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = buscar(grupoId, fecha);
    return { rows: fila ? [fila] : [] };
  }

  if (/^INSERT INTO whatsapp_dia_estado \(grupo_id, fecha, ultimo_texto, ultimo_texto_en\)/i.test(sql)) {
    const [grupoId, fecha, texto] = params;
    let fila = buscar(grupoId, fecha);
    if (!fila) { fila = filaVacia(grupoId, fecha); TABLAS.whatsapp_dia_estado.push(fila); }
    fila.ultimo_texto = texto;
    fila.ultimo_texto_en = new Date();
    return { rows: [fila] };
  }

  if (/^INSERT INTO whatsapp_dia_estado \(grupo_id, fecha, sabana_final_en\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    let fila = buscar(grupoId, fecha);
    if (!fila) { fila = filaVacia(grupoId, fecha); TABLAS.whatsapp_dia_estado.push(fila); }
    if (!fila.sabana_final_en) fila.sabana_final_en = new Date(); // COALESCE: no pisa si ya existía
    return { rows: [fila] };
  }

  if (/^UPDATE whatsapp_dia_estado SET ultima_verificacion_en = now\(\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = buscar(grupoId, fecha);
    if (fila) fila.ultima_verificacion_en = new Date();
    return { rows: [] };
  }

  if (/^UPDATE whatsapp_dia_estado SET ultimo_envio_resumen_en = now\(\), ultimo_hash_resumen = \$3/i.test(sql)) {
    const [grupoId, fecha, hash] = params;
    const fila = buscar(grupoId, fecha);
    if (fila) { fila.ultimo_envio_resumen_en = new Date(); fila.ultimo_hash_resumen = hash; }
    return { rows: [] };
  }

  if (/^UPDATE whatsapp_dia_estado SET cierre_enviado_en = now\(\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = buscar(grupoId, fecha);
    if (fila) fila.cierre_enviado_en = new Date();
    return { rows: [] };
  }

  if (/^SELECT .* FROM whatsapp_dia_estado WHERE grupo_id = \$1 AND fecha >= /i.test(sql)) {
    const [grupoId, diasHaciaAtras] = params;
    const hoy = new Date();
    const limite = new Date(hoy.getTime() - diasHaciaAtras * 24 * 60 * 60 * 1000);
    const filas = TABLAS.whatsapp_dia_estado.filter(w => {
      if (w.grupo_id !== grupoId) return false;
      if (new Date(w.fecha + 'T00:00:00Z') < new Date(limite.toISOString().split('T')[0] + 'T00:00:00Z')) return false;
      return true;
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));
    return { rows: filas };
  }

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
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

const {
  obtenerEstadoDia,
  registrarTextoRecibido,
  marcarSabanaFinalRecibida,
  registrarVerificacion,
  registrarEnvioResumen,
  marcarCierreEnviado,
  listarDiasDelGrupo
} = require(path.join(__dirname, '..', 'src', 'services', 'whatsappDiaEstado'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// Fechas relativas a HOY (en vez de fechas fijas) — listarDiasDelGrupo()
// filtra por CURRENT_DATE de verdad, así que un margen fijo de "7 días
// hacia atrás" necesita fechas relativas a HOY para seguir siendo válido
// sin importar cuándo se corra esta prueba (con fechas fijas, esta prueba
// se rompía sola apenas "hoy" avanzaba más allá de esas fechas).
function fechaHace(dias) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().split('T')[0];
}
const DIA_A = fechaHace(2); // el más viejo: termina cerrado (cierre_enviado_en)
const DIA_B = fechaHace(1); // día abierto, sin cerrar
const DIA_C = fechaHace(0); // hoy: solo recibe SABANA FINAL, sin ninguna sábana con texto

(async function main() {
  // --- 1) obtenerEstadoDia: null si no existe todavía ---
  check(await obtenerEstadoDia('g1', DIA_A) === null, 'un día que nunca recibió nada por WhatsApp da null');

  // --- 2) registrarTextoRecibido: crea la fila la primera vez ---
  const e1 = await registrarTextoRecibido('g1', DIA_A, 'SABANA 03-09-2026\nGIANCO ...');
  check(e1.ultimoTexto === 'SABANA 03-09-2026\nGIANCO ...', 'registrarTextoRecibido guarda el texto de la primera sábana del día');
  check(!!e1.ultimoTextoEn, 'registrarTextoRecibido deja ultimoTextoEn con la fecha/hora');
  check(e1.sabanaFinalEn === null, 'un día recién creado por una sábana normal NO está cerrado');

  // --- 3) registrarTextoRecibido de nuevo: REEMPLAZA el texto (no acumula) ---
  const e2 = await registrarTextoRecibido('g1', DIA_A, 'SABANA 03-09-2026\nGIANCO ...\nMANOLO ...');
  check(e2.ultimoTexto === 'SABANA 03-09-2026\nGIANCO ...\nMANOLO ...', 'una segunda sábana del mismo día REEMPLAZA el texto guardado (nunca acumula 2 sábanas)');
  const soloUnaFila = TABLAS.whatsapp_dia_estado.filter(w => w.grupo_id === 'g1' && w.fecha === DIA_A);
  check(soloUnaFila.length === 1, 'sigue siendo UNA sola fila para ese grupo+fecha (upsert, no un registro nuevo por cada sábana)');

  // --- 4) marcarSabanaFinalRecibida: idempotente, no pisa el timestamp original ---
  const { estado: cerrado1, yaEstabaCerrado: dup1 } = await marcarSabanaFinalRecibida('g1', DIA_A);
  check(!!cerrado1.sabanaFinalEn, 'marcarSabanaFinalRecibida deja sabanaFinalEn con la fecha/hora del cierre');
  check(dup1 === false, 'la PRIMERA vez que llega SABANA FINAL, yaEstabaCerrado da false');

  const primerTimestamp = cerrado1.sabanaFinalEn;
  const { estado: cerrado2, yaEstabaCerrado: dup2 } = await marcarSabanaFinalRecibida('g1', DIA_A);
  check(dup2 === true, 'si llega OTRA "SABANA FINAL" el mismo día, yaEstabaCerrado da true (duplicado)');
  check(cerrado2.sabanaFinalEn.getTime() === primerTimestamp.getTime(), 'el segundo "SABANA FINAL" NO pisa el timestamp original del cierre');

  // --- 5) un día que solo recibe "SABANA FINAL" sin ninguna sábana normal antes (caso raro, no revienta) ---
  const { estado: soloFinal } = await marcarSabanaFinalRecibida('g1', DIA_C);
  check(!!soloFinal.sabanaFinalEn && soloFinal.ultimoTexto === null, 'un "SABANA FINAL" sin ninguna sábana previa ese día no revienta (queda con ultimoTexto null)');

  // --- 6) registrarVerificacion / registrarEnvioResumen / marcarCierreEnviado ---
  await registrarVerificacion('g1', DIA_A);
  check(!!buscar('g1', DIA_A).ultima_verificacion_en, 'registrarVerificacion deja ultima_verificacion_en con la fecha/hora');

  await registrarEnvioResumen('g1', DIA_A, 'hash-abc');
  const filaTrasEnvio = buscar('g1', DIA_A);
  check(!!filaTrasEnvio.ultimo_envio_resumen_en && filaTrasEnvio.ultimo_hash_resumen === 'hash-abc', 'registrarEnvioResumen deja ultimo_envio_resumen_en + el hash guardado');

  await marcarCierreEnviado('g1', DIA_A);
  check(!!buscar('g1', DIA_A).cierre_enviado_en, 'marcarCierreEnviado deja cierre_enviado_en con la fecha/hora');

  // --- 7) un día abierto normal más, para que listarDiasDelGrupo tenga
  // algo abierto (además de DIA_A ya cerrado) que comparar ---
  await registrarTextoRecibido('g1', DIA_B, 'SABANA 04-09-2026\nWISTON ...'); // día abierto normal, sin SABANA FINAL todavía
  await registrarTextoRecibido('g2', DIA_B, 'SABANA de un grupo SIN whatsapp_grupo_jid vinculado');

  // --- 8) listarDiasDelGrupo: TODOS los días de un grupo, abiertos o cerrados ---
  const diasG1 = await listarDiasDelGrupo('g1', 7);
  check(!!diasG1.find(d => d.fecha === DIA_A && !!d.cierreEnviadoEn), '2026-09-03 (ya cerrado) SÍ aparece en listarDiasDelGrupo');
  check(!!diasG1.find(d => d.fecha === DIA_B), '2026-09-04 (abierto) también aparece');
  check(!diasG1.find(d => d.grupoId === 'g2'), 'listarDiasDelGrupo("g1", ...) no trae días de otro grupo (g2)');
  check(diasG1[0].fecha >= diasG1[diasG1.length - 1].fecha, 'listarDiasDelGrupo ordena del más nuevo al más viejo');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
