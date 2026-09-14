// =================================================================
// PRUEBA: autorización EXCLUSIVA para los comandos de chat de WhatsApp
// (09-09-2026, a pedido del usuario: "los comandos lo puede mandar el
// mismo que manda el comando sabana jugada, pero aparte en super admin
// yo puedo agregar un numero y activarle o desactivarle, la funcion de
// enviar comandos" — ver la nota grande en sql/schema.sql).
//
// Cubre 3 capas:
//   1) whatsappTrigger.normalizarTelefono()/telefonoDeParticipante() —
//      puras, sin base de datos.
//   2) PATCH /api/superadmin/grupos/:id/comandos-habilitado y
//      .../comandos-numero — mismo patrón de "pg"/express falsos que
//      test_whatsapp_habilitado_superadmin.js.
//   3) whatsappBot.estaAutorizadoParaComandos()/manejarMensajeEntrante() —
//      que "SABANA DE JUGADAS" NUNCA pasa por este candado (sigue
//      aceptando a cualquiera del grupo), y que los 4 comandos SÍ: el
//      número correcto los dispara, cualquier otro participante del
//      MISMO grupo se ignora en silencio, y apagar el interruptor
//      bloquea hasta al número correcto.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';
const JID = '120363000000000005@g.us';
const NUMERO_AUTORIZADO = '584121234567';

const TABLAS = {
  grupos: [{
    id: GRUPO_ID, nombre: 'Deportes Bernal', whatsapp_grupo_jid: JID, whatsapp_habilitado: true,
    modelo_comision: 'plano', comision_tiers: [],
    comandos_whatsapp_habilitado: true, comandos_whatsapp_numero: NUMERO_AUTORIZADO
  }],
  jugadores: [{ id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', activo: true, comision_propia: 0 }],
  avales: [], equipos_globales: [], equipos_personalizados: [],
  tickets_historial: [], polla_historial: [], transferencias: [],
  sabanas_pendientes_whatsapp: [], whatsapp_dia_estado: [], dias_confirmados: []
};

global.fetch = () => Promise.resolve({ json: async () => ({ dates: [{ games: [] }] }) });

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  // --- rutas de Súper-admin nuevas ---
  if (/^UPDATE grupos SET comandos_whatsapp_habilitado = \$1 WHERE id = \$2 RETURNING id, comandos_whatsapp_habilitado, comandos_whatsapp_numero/i.test(sql)) {
    const [habilitado, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.comandos_whatsapp_habilitado = habilitado;
    return { rows: [{ id: grupo.id, comandos_whatsapp_habilitado: grupo.comandos_whatsapp_habilitado, comandos_whatsapp_numero: grupo.comandos_whatsapp_numero }] };
  }
  if (/^UPDATE grupos SET comandos_whatsapp_numero = \$1 WHERE id = \$2 RETURNING id, comandos_whatsapp_numero/i.test(sql)) {
    const [numero, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.comandos_whatsapp_numero = numero;
    return { rows: [{ id: grupo.id, comandos_whatsapp_numero: grupo.comandos_whatsapp_numero }] };
  }

  // --- lo que necesita whatsappBot.js ---
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: grupo ? [{ modelo_comision: grupo.modelo_comision, comision_tiers: grupo.comision_tiers }] : [] };
  }
  if (/^SELECT comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE id = \$1/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: grupo ? [{ comandos_whatsapp_habilitado: !!grupo.comandos_whatsapp_habilitado, comandos_whatsapp_numero: grupo.comandos_whatsapp_numero || null }] : [] };
  }
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) return { rows: [] };
  if (/^DELETE FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) return { rows: [] };
  if (/^DELETE FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO dias_confirmados \(grupo_id, fecha\)/i.test(sql)) return { rows: [{ confirmado_en: new Date() }] };
  if (/^SELECT confirmado_en FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) return { rows: [] };
  if (/^SELECT nombre FROM grupos WHERE id = \$1/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: grupo ? [{ nombre: grupo.nombre }] : [] };
  }
  if (/^SELECT id FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.whatsapp_grupo_jid === params[0] && g.whatsapp_habilitado === true);
    return { rows: grupo ? [{ id: grupo.id }] : [] };
  }
  if (/^INSERT INTO sabanas_pendientes_whatsapp/i.test(sql)) {
    const fila = { id: 'p' + (TABLAS.sabanas_pendientes_whatsapp.length + 1), grupo_id: params[0], fecha_detectada: params[1], texto: params[2], remitente: params[3], remitente_nombre: params[4], recibido_en: new Date(), estado: 'pendiente', nota: null, procesado_en: null };
    TABLAS.sabanas_pendientes_whatsapp.push(fila);
    return { rows: [fila] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'importada'/i.test(sql)) {
    const [grupoId, id] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
    if (fila) { fila.estado = 'importada'; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'descartada'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
    if (fila) { fila.estado = 'descartada'; fila.nota = nota || null; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'error'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
    if (fila) { fila.estado = 'error'; fila.nota = nota || null; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^SELECT .* FROM whatsapp_dia_estado WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    return { rows: fila ? [fila] : [] };
  }
  if (/^INSERT INTO whatsapp_dia_estado \(grupo_id, fecha, ultimo_texto, ultimo_texto_en\)/i.test(sql)) {
    const [grupoId, fecha, texto] = params;
    let fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (!fila) { fila = { grupo_id: grupoId, fecha, ultimo_texto: null, sabana_final_en: null, ultima_verificacion_en: null, ultimo_envio_resumen_en: null, ultimo_hash_resumen: null, cierre_enviado_en: null }; TABLAS.whatsapp_dia_estado.push(fila); }
    fila.ultimo_texto = texto;
    return { rows: [fila] };
  }
  if (/^UPDATE whatsapp_dia_estado SET ultima_verificacion_en = now\(\)/i.test(sql)) return { rows: [] };
  if (/^UPDATE whatsapp_dia_estado SET ultimo_envio_resumen_en = now\(\), ultimo_hash_resumen = \$3/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.SUPERADMIN_SECRET = 'fake-secret';

const superadminRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));
const whatsappBot = require(path.join(__dirname, '..', 'src', 'services', 'whatsappBot'));
const { normalizarTelefono, telefonoDeParticipante } = require(path.join(__dirname, '..', 'src', 'services', 'whatsappTrigger'));
const { formatearFechaISO } = require(path.join(__dirname, '..', 'src', 'services', 'historial'));

Module._load = originalLoad;

const entradaHabilitado = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/comandos-habilitado');
const handlerHabilitado = entradaHabilitado[1][1];
const entradaNumero = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/comandos-numero');
const handlerNumero = entradaNumero[1][1];

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function crearSockFalso() {
  const mensajes = [];
  return { mensajes, sendMessage: async (jid, contenido) => { mensajes.push({ jid, text: contenido.text }); } };
}

function crearMensaje(texto, participante) {
  return { key: { remoteJid: JID, fromMe: false, participant: participante }, message: { conversation: texto }, pushName: 'Cliente Prueba' };
}

(async function main() {
  // =================================================================
  // 1) normalizarTelefono()/telefonoDeParticipante() — puras
  // =================================================================
  check(normalizarTelefono('+58 412-123.4567') === '584121234567', 'normalizarTelefono() deja solo los dígitos, sin importar +/espacios/guiones/puntos');
  check(normalizarTelefono('584121234567') === '584121234567', 'un número ya limpio se devuelve igual');
  check(normalizarTelefono(null) === '' && normalizarTelefono(undefined) === '', 'null/undefined no revientan, devuelven cadena vacía');
  check(normalizarTelefono('') === '', 'una cadena vacía se devuelve vacía');

  check(telefonoDeParticipante('584121234567:12@s.whatsapp.net') === '584121234567', 'telefonoDeParticipante() saca el número de un JID con sufijo de dispositivo (":12")');
  check(telefonoDeParticipante('584121234567@s.whatsapp.net') === '584121234567', 'y también de un JID sin sufijo de dispositivo');
  check(telefonoDeParticipante(null) === '' && telefonoDeParticipante(42) === '', 'un valor no-string no revienta, devuelve cadena vacía');

  // =================================================================
  // 2) PATCH /api/superadmin/grupos/:id/comandos-habilitado y .../comandos-numero
  // =================================================================
  const res1 = await invocarRuta(handlerHabilitado, { params: { id: GRUPO_ID }, body: { habilitado: false } });
  check(res1._status === 200 && res1._json.comandosWhatsappHabilitado === false, 'PATCH comandos-habilitado con false lo apaga');
  check(TABLAS.grupos[0].comandos_whatsapp_habilitado === false, 'y queda de verdad apagado en la fila del grupo');

  const res2 = await invocarRuta(handlerHabilitado, { params: { id: GRUPO_ID }, body: { habilitado: true } });
  check(res2._json.comandosWhatsappHabilitado === true, 'PATCH comandos-habilitado con true lo vuelve a prender');

  const res3 = await invocarRuta(handlerNumero, { params: { id: GRUPO_ID }, body: { numero: '+58 412-999.8888' } });
  check(res3._status === 200 && res3._json.comandosWhatsappNumero === '+58 412-999.8888', 'PATCH comandos-numero guarda el número TAL CUAL lo escribió el Súper-admin (la normalización es solo para comparar, no para guardar)');
  check(TABLAS.grupos[0].comandos_whatsapp_numero === '+58 412-999.8888', 'y queda guardado de verdad en la fila del grupo');

  // Se restaura el número autorizado real para el resto de la prueba.
  await invocarRuta(handlerNumero, { params: { id: GRUPO_ID }, body: { numero: NUMERO_AUTORIZADO } });

  const res4 = await invocarRuta(handlerNumero, { params: { id: GRUPO_ID }, body: { numero: null } });
  check(res4._json.comandosWhatsappNumero === null, 'mandar numero:null desvincula el número (queda null)');
  const res5 = await invocarRuta(handlerNumero, { params: { id: GRUPO_ID }, body: { numero: '   ' } });
  check(res5._json.comandosWhatsappNumero === null, 'un número de solo espacios también se recorta y queda null');

  const res6 = await invocarRuta(handlerHabilitado, { params: { id: 'no-existe' }, body: { habilitado: true } });
  check(res6._status === 404, 'PATCH comandos-habilitado sobre un grupo que no existe da 404');
  const res7 = await invocarRuta(handlerNumero, { params: { id: 'no-existe' }, body: { numero: '123' } });
  check(res7._status === 404, 'PATCH comandos-numero sobre un grupo que no existe da 404');

  // Se deja todo configurado y correcto para la parte 3.
  TABLAS.grupos[0].comandos_whatsapp_habilitado = true;
  TABLAS.grupos[0].comandos_whatsapp_numero = NUMERO_AUTORIZADO;

  // =================================================================
  // 3) whatsappBot: el candado de comandos NUNCA afecta "SABANA DE
  // JUGADAS", y SÍ filtra los 4 comandos por número
  // =================================================================
  const HOY = formatearFechaISO(new Date());
  const PARTICIPANTE_AUTORIZADO = NUMERO_AUTORIZADO + ':1@s.whatsapp.net';
  const PARTICIPANTE_OTRO = '584129999999:1@s.whatsapp.net';

  // "SABANA DE JUGADAS" la manda CUALQUIERA del grupo, sin que importe el
  // número autorizado de comandos (son 2 candados totalmente separados) —
  // se prueba mandándola desde el participante NO autorizado para
  // comandos, y confirmando que igual se carga normalmente.
  const sockSabana = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockSabana, crearMensaje(['SABANA DE JUGADAS', HOY, 'PEDRO', 'houston -120', '100//90'].join('\n'), PARTICIPANTE_OTRO));
  check(sockSabana.mensajes.length === 1, '"SABANA DE JUGADAS" se carga igual sin importar quién la mande — el candado de comandos NO le aplica a esto');

  // El número AUTORIZADO SÍ puede mandar "act".
  const sockActAutorizado = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockActAutorizado, crearMensaje('act', PARTICIPANTE_AUTORIZADO));
  check(sockActAutorizado.mensajes.length === 1, 'el número configurado en Súper-admin SÍ puede disparar "act"');

  // Cualquier OTRO participante del MISMO grupo (no el número autorizado)
  // NO puede — se ignora en silencio, sin ningún aviso de "no
  // autorizado".
  const sockActOtro = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockActOtro, crearMensaje('act', PARTICIPANTE_OTRO));
  check(sockActOtro.mensajes.length === 0, 'otro participante del mismo grupo (no el número autorizado) NO puede disparar "act" — se ignora en silencio');

  // Apagar el interruptor bloquea hasta al número correcto.
  TABLAS.grupos[0].comandos_whatsapp_habilitado = false;
  const sockActApagado = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockActApagado, crearMensaje('act', PARTICIPANTE_AUTORIZADO));
  check(sockActApagado.mensajes.length === 0, 'con comandos_whatsapp_habilitado en false, ni el número correcto puede disparar ningún comando');
  TABLAS.grupos[0].comandos_whatsapp_habilitado = true;

  // Sin ningún número configurado, nadie puede (no hay "modo abierto" por default).
  TABLAS.grupos[0].comandos_whatsapp_numero = null;
  const sockActSinNumero = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockActSinNumero, crearMensaje('act', PARTICIPANTE_AUTORIZADO));
  check(sockActSinNumero.mensajes.length === 0, 'sin ningún número configurado, ningún comando se dispara, ni siquiera desde el número que antes estaba autorizado');
  TABLAS.grupos[0].comandos_whatsapp_numero = NUMERO_AUTORIZADO;

  // estaAutorizadoParaComandos() directo, para el caso puntual de un
  // grupo inexistente (no debería poder pasar en la práctica, pero no
  // tiene que reventar).
  const autorizadoGrupoInexistente = await whatsappBot.estaAutorizadoParaComandos('no-existe', PARTICIPANTE_AUTORIZADO);
  check(autorizadoGrupoInexistente === false, 'estaAutorizadoParaComandos() sobre un grupo inexistente devuelve false, no revienta');

  // =================================================================
  // 4) resolverNumeroRealDelRemitente() — el caso real reportado por el
  // usuario probando "corte semana" en el grupo Bernal: WhatsApp mandó
  // "30971613171802@lid" en vez de un número real (09-09-2026).
  // =================================================================
  const JID_NORMAL = '584121234567:1@s.whatsapp.net';
  const sockSinExtras = { sendMessage: async () => {} };
  const igual = await whatsappBot.resolverNumeroRealDelRemitente(sockSinExtras, { key: {} }, JID_NORMAL);
  check(igual === JID_NORMAL, 'un JID normal (@s.whatsapp.net) se devuelve tal cual — sin tocarlo');

  const LID = '30971613171802@lid';
  const sinNadaQueLoResuelva = await whatsappBot.resolverNumeroRealDelRemitente(sockSinExtras, { key: {} }, LID);
  check(sinNadaQueLoResuelva === LID, 'un @lid, sin participantAlt/participantPn ni signalRepository.lidMapping disponible, se devuelve tal cual (no revienta)');

  const conParticipantAlt = await whatsappBot.resolverNumeroRealDelRemitente(sockSinExtras, { key: { participantAlt: JID_NORMAL } }, LID);
  check(conParticipantAlt === JID_NORMAL, 'si el mensaje trae "participantAlt" (el JID real), se usa ese en vez del @lid');

  const conParticipantPn = await whatsappBot.resolverNumeroRealDelRemitente(sockSinExtras, { key: { participantPn: JID_NORMAL } }, LID);
  check(conParticipantPn === JID_NORMAL, 'y lo mismo con "participantPn" (el otro nombre que puede traer según la versión de Baileys)');

  const sockConMapeo = { signalRepository: { lidMapping: { getPNForLID: async (lid) => (lid === LID ? JID_NORMAL : null) } } };
  const conMapeo = await whatsappBot.resolverNumeroRealDelRemitente(sockConMapeo, { key: {} }, LID);
  check(conMapeo === JID_NORMAL, 'si no viene en el mensaje, se intenta con sock.signalRepository.lidMapping.getPNForLID()');

  const sockMapeoQueFalla = { signalRepository: { lidMapping: { getPNForLID: async () => { throw new Error('no disponible'); } } } };
  const conMapeoQueFalla = await whatsappBot.resolverNumeroRealDelRemitente(sockMapeoQueFalla, { key: {} }, LID);
  check(conMapeoQueFalla === LID, 'si sock.signalRepository.lidMapping.getPNForLID() revienta, no se propaga el error — se devuelve el @lid tal cual');

  // Extremo a extremo: el usuario carga, como "número autorizado", los
  // MISMOS dígitos que trae el @lid (la solución inmediata que sugiere el
  // log de diagnóstico) — sin ningún participantAlt/lidMapping
  // disponible (el caso real reportado), el comando SÍ se dispara.
  TABLAS.grupos[0].comandos_whatsapp_numero = '30971613171802';
  const sockActConLid = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockActConLid, crearMensaje('act', LID));
  check(sockActConLid.mensajes.length === 1, 'cargando los dígitos del propio @lid como "número autorizado" (la solución inmediata), el comando se dispara igual, sin necesitar el número de teléfono real');
  TABLAS.grupos[0].comandos_whatsapp_numero = NUMERO_AUTORIZADO;

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de autorización de comandos se cayó con una excepción:', e);
  process.exit(1);
});
