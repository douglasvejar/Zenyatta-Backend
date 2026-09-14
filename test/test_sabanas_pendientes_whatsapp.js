// =================================================================
// PRUEBA: sabanasPendientesWhatsapp.js — la bandeja de sábanas
// recibidas por el bot de WhatsApp (03-09-2026, ver la nota grande en
// sql/schema.sql sobre la tabla sabanas_pendientes_whatsapp).
//
// Mismo patrón de "pg" falso en memoria que ya usan
// test_balance_general.js / test_papelera_sabana.js, etc. — sin tocar
// una base de datos real.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let siguienteId = 1;
const TABLAS = {
  grupos: [
    { id: 'g1', whatsapp_grupo_jid: '120363000000000001@g.us', whatsapp_habilitado: true },
    { id: 'g2', whatsapp_grupo_jid: null, whatsapp_habilitado: false },
    // g3 (04-09-2026, a pedido del usuario): tiene el JID cargado pero el
    // Súper-admin todavía NO le prendió el servicio — grupoIdPorJid()
    // tiene que ignorarlo igual que si no tuviera ningún JID.
    { id: 'g3', whatsapp_grupo_jid: '120363000000000099@g.us', whatsapp_habilitado: false }
  ],
  sabanas_pendientes_whatsapp: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT id FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true/i.test(sql)) {
    const [jid] = params;
    const fila = TABLAS.grupos.find(g => g.whatsapp_grupo_jid === jid && g.whatsapp_habilitado === true);
    return { rows: fila ? [{ id: fila.id }] : [] };
  }

  if (/^INSERT INTO sabanas_pendientes_whatsapp/i.test(sql)) {
    const [grupoId, fechaDetectada, texto, remitente, remitenteNombre] = params;
    // Cada fila con un "recibido_en" estrictamente más nuevo que la
    // anterior (en vez de new Date() sin más) — así el orden DESC de
    // listarRecientes()/listarPendientes() es determinístico en la
    // prueba, sin depender de que 2 inserciones caigan en milisegundos
    // distintos de verdad.
    const idNum = siguienteId++;
    const fila = {
      id: 'p' + idNum,
      grupo_id: grupoId,
      fecha_detectada: fechaDetectada,
      texto,
      remitente,
      remitente_nombre: remitenteNombre,
      recibido_en: new Date(Date.now() + idNum * 1000),
      estado: 'pendiente',
      nota: null,
      procesado_en: null
    };
    TABLAS.sabanas_pendientes_whatsapp.push(fila);
    return { rows: [fila] };
  }

  if (/^SELECT .* FROM sabanas_pendientes_whatsapp WHERE grupo_id = \$1 AND estado = 'pendiente' ORDER BY recibido_en DESC/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.sabanas_pendientes_whatsapp.filter(p => p.grupo_id === grupoId && p.estado === 'pendiente');
    return { rows: filas };
  }

  if (/^SELECT .* FROM sabanas_pendientes_whatsapp WHERE grupo_id = \$1 ORDER BY recibido_en DESC LIMIT \d+/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.sabanas_pendientes_whatsapp.filter(p => p.grupo_id === grupoId).sort((a, b) => b.recibido_en - a.recibido_en);
    return { rows: filas };
  }

  if (/^SELECT .* FROM sabanas_pendientes_whatsapp WHERE grupo_id = \$1 ORDER BY recibido_en DESC/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.sabanas_pendientes_whatsapp.filter(p => p.grupo_id === grupoId).sort((a, b) => b.recibido_en - a.recibido_en);
    return { rows: filas };
  }

  if (/^SELECT .* FROM sabanas_pendientes_whatsapp WHERE grupo_id = \$1 AND id = \$2/i.test(sql)) {
    const [grupoId, id] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id);
    return { rows: fila ? [fila] : [] };
  }

  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'importada'/i.test(sql)) {
    const [grupoId, id] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
    if (!fila) return { rows: [] };
    fila.estado = 'importada';
    fila.procesado_en = new Date();
    return { rows: [fila] };
  }

  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'descartada'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
    if (!fila) return { rows: [] };
    fila.estado = 'descartada';
    fila.nota = nota || null;
    fila.procesado_en = new Date();
    return { rows: [fila] };
  }

  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'error'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
    if (!fila) return { rows: [] };
    fila.estado = 'error';
    fila.nota = nota || null;
    fila.procesado_en = new Date();
    return { rows: [fila] };
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
  grupoIdPorJid,
  crearPendiente,
  listarPendientes,
  listarRecientes,
  obtenerPendiente,
  marcarImportada,
  descartarPendiente,
  marcarError
} = require(path.join(__dirname, '..', 'src', 'services', 'sabanasPendientesWhatsapp'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}
async function checkLanza(fn, statusEsperado, msg) {
  try {
    await fn();
    fallaron++; console.error('FALLÓ (no lanzó ningún error):', msg);
  } catch (e) {
    check(e.status === statusEsperado, msg + ' (status ' + e.status + ')');
  }
}

(async function main() {
  // --- 1) grupoIdPorJid: encuentra el grupo correcto, o null si no hay match ---
  check(await grupoIdPorJid('120363000000000001@g.us') === 'g1', 'grupoIdPorJid encuentra el grupo dueño de ese JID de WhatsApp (habilitado)');
  check(await grupoIdPorJid('999999@g.us') === null, 'grupoIdPorJid devuelve null si ningún grupo tiene configurado ese JID (mensaje se ignora)');
  check(await grupoIdPorJid(null) === null, 'grupoIdPorJid(null) no revienta, devuelve null');
  // --- 1.b) el interruptor del Súper-admin (04-09-2026): un JID
  // configurado pero con whatsapp_habilitado=false se ignora IGUAL que si
  // no tuviera ningún JID — así alcanza con apagar el servicio para
  // cortarlo, sin tener que borrar el JID guardado ---
  check(await grupoIdPorJid('120363000000000099@g.us') === null, 'un grupo con el JID cargado pero el servicio APAGADO (whatsapp_habilitado=false) se ignora igual que si no tuviera JID');

  // --- 2) crearPendiente: guarda el mensaje tal cual, con y sin fecha detectada ---
  const p1 = await crearPendiente('g1', { texto: 'SABANA 03-09-2026\nGIANCO ...', fechaDetectada: '2026-09-03', remitente: '58412@s.whatsapp.net', remitenteNombre: 'Juan' });
  check(p1.estado === 'pendiente', 'un mensaje recién creado queda en estado pendiente');
  check(p1.fechaDetectada === '2026-09-03', 'crearPendiente guarda la fecha detectada cuando viene informada');
  check(p1.texto === 'SABANA 03-09-2026\nGIANCO ...', 'crearPendiente guarda el texto EXACTO del mensaje, sin tocarlo');

  const p2 = await crearPendiente('g1', { texto: 'SABANA DE HOY\n...' });
  check(p2.fechaDetectada === null, 'crearPendiente acepta que no haya fecha detectada (queda en null, se completa a mano al importar)');

  await checkLanza(() => crearPendiente('g1', { texto: '   ' }), 400, 'crearPendiente rechaza un texto vacío/solo espacios');
  await checkLanza(() => crearPendiente(null, { texto: 'SABANA' }), 400, 'crearPendiente rechaza si falta el grupo');

  // --- 3) listarPendientes: solo trae las 'pendiente' de ESE grupo, no de otros ---
  await crearPendiente('g2', { texto: 'SABANA de otro grupo' });
  const pendientesG1 = await listarPendientes('g1');
  check(pendientesG1.length === 2, 'listarPendientes(g1) trae solo los 2 mensajes de g1, no el de g2');
  check(pendientesG1.every(p => p.grupoId === 'g1'), 'listarPendientes nunca mezcla mensajes de otro grupo (aislamiento entre tenants)');

  // --- 4) obtenerPendiente: 404 si no existe o es de otro grupo ---
  const obtenido = await obtenerPendiente('g1', p1.id);
  check(obtenido.id === p1.id, 'obtenerPendiente trae el mensaje correcto por id');
  await checkLanza(() => obtenerPendiente('g1', 'no-existe'), 404, 'obtenerPendiente lanza 404 si el id no existe');
  await checkLanza(() => obtenerPendiente('g2', p1.id), 404, 'obtenerPendiente lanza 404 si el id existe pero es de OTRO grupo (evita fuga entre tenants)');

  // --- 5) marcarImportada: cambia el estado y ya no aparece en listarPendientes ---
  const importado = await marcarImportada('g1', p1.id);
  check(importado.estado === 'importada', 'marcarImportada cambia el estado a importada');
  check(!!importado.procesadoEn, 'marcarImportada deja procesadoEn con la fecha/hora en que se importó');
  const pendientesTrasImportar = await listarPendientes('g1');
  check(pendientesTrasImportar.length === 1 && pendientesTrasImportar[0].id === p2.id, 'tras importar p1, listarPendientes(g1) ya solo trae p2');
  await checkLanza(() => marcarImportada('g1', p1.id), 404, 'marcarImportada por segunda vez sobre el mismo mensaje lanza 404 (ya no está pendiente)');

  // --- 6) descartarPendiente: mismo comportamiento, con estado descartada + nota ---
  const descartado = await descartarPendiente('g1', p2.id, 'el día ya estaba cerrado con SABANA FINAL');
  check(descartado.estado === 'descartada', 'descartarPendiente cambia el estado a descartada');
  check(descartado.nota === 'el día ya estaba cerrado con SABANA FINAL', 'descartarPendiente guarda el motivo en nota');
  const pendientesTrasDescartar = await listarPendientes('g1');
  check(pendientesTrasDescartar.length === 0, 'tras descartar p2, listarPendientes(g1) ya no trae nada pendiente');

  // --- 7) listarPendientes({incluirResueltas:true}) trae también las ya resueltas ---
  const todos = await listarPendientes('g1', { incluirResueltas: true });
  check(todos.length === 2, 'listarPendientes con incluirResueltas:true trae también las importadas/descartadas');

  // --- 8) marcarError: para un intento de auto-importación que falló ---
  const p3 = await crearPendiente('g1', { texto: 'SABANA con un error' });
  const conError = await marcarError('g1', p3.id, 'No se detectaron apuestas válidas.');
  check(conError.estado === 'error', 'marcarError deja el mensaje en estado error');
  check(conError.nota === 'No se detectaron apuestas válidas.', 'marcarError guarda el motivo del error en nota');
  await checkLanza(() => marcarError('g1', p3.id, 'de nuevo'), 404, 'marcarError por segunda vez sobre el mismo mensaje lanza 404 (ya no está pendiente)');

  // --- 9) listarRecientes: trae TODO (cualquier estado) del grupo, más nuevo primero, acotado ---
  const recientesG1 = await listarRecientes('g1', 10);
  check(recientesG1.length === 3, 'listarRecientes(g1) trae los 3 mensajes de g1 (importada + descartada + error), sin importar el estado');
  check(recientesG1.every(p => p.grupoId === 'g1'), 'listarRecientes nunca mezcla mensajes de otro grupo');
  check(recientesG1[0].id === p3.id, 'listarRecientes ordena del más nuevo al más viejo');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
