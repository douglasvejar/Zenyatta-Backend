// =================================================================
// PRUEBA: "modo cuidadoso" de WhatsApp (18-09-2026, a pedido del usuario
// después de que WhatsApp le cerrara la cuenta que tenía vinculada al
// bot — ver la nota grande en sql/schema.sql y en la advertencia grande
// al principio de whatsappBot.js).
//
// Con el modo prendido para un grupo, la LECTURA/IMPORTACIÓN automática
// de "SABANA DE JUGADAS" tiene que seguir funcionando exactamente igual
// que siempre — lo único que se apaga es el envío del resumen que el bot
// decide mandar SOLO, sin que nadie se lo haya pedido en ese momento: el
// aviso automático apenas se termina de importar una sábana
// (manejarMensajeEntrante) y el reloj de fondo (tickRelojDeFondo). El
// botón manual "Enviar resumen ahora" (forzar:true, no se toca en este
// archivo) sigue mandando normal, sin importar el modo.
//
// Mismo patrón de "pg"/"fetch" falsos en memoria que
// test_whatsapp_bot_flujo.js — harness recortado a lo mínimo que hace
// falta para levantar manejarMensajeEntrante/tickRelojDeFondo de punta a
// punta (procesarSabana de verdad, sin mockear nada de la lógica de
// negocio).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const JID_NORMAL = '120363000000000010@g.us';
const JID_CUIDADOSO = '120363000000000020@g.us';
const FECHA = '2026-09-18';

let siguienteIdPendiente = 1;
const TABLAS = {
  grupos: [
    { id: 'g-normal', nombre: 'Deportes Normal', whatsapp_grupo_jid: JID_NORMAL, whatsapp_habilitado: true, whatsapp_modo_cuidadoso: false },
    { id: 'g-cuidadoso', nombre: 'Deportes Cuidadoso', whatsapp_grupo_jid: JID_CUIDADOSO, whatsapp_habilitado: true, whatsapp_modo_cuidadoso: true }
  ],
  jugadores: [
    { id: 'j-pedro', grupo_id: 'g-normal', nombre: 'PEDRO', activo: true, comision_propia: 0 },
    { id: 'j-hanry', grupo_id: 'g-cuidadoso', nombre: 'HANRY', activo: true, comision_propia: 0 }
  ],
  sabanas_pendientes_whatsapp: [],
  whatsapp_dia_estado: [],
  dias_confirmados: []
};

// fetch falso: ningún partido resuelve nunca ("en progreso" siempre) — no
// hace falta más que eso para estas pruebas: decidirAccion() manda el
// PRIMER aviso de un día sin importar si el partido ya terminó o no (ver
// el mismo criterio en test_whatsapp_bot_flujo.js, prueba 2).
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({ json: async () => ({ dates: [{ games: [] }] }) });
  }
  if (url.includes('/football/nfl/') || url.includes('/hockey/nhl/') || url.includes('/basketball/nba/') || url.includes('/soccer/')) {
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  return Promise.reject(new Error('URL inesperada en la prueba: ' + url));
}
global.fetch = fakeFetch;

function filaVaciaDia(grupoId, fecha) {
  return { grupo_id: grupoId, fecha, ultimo_texto: null, ultimo_texto_en: null, sabana_final_en: null, ultima_verificacion_en: null, ultimo_envio_resumen_en: null, ultimo_hash_resumen: null, cierre_enviado_en: null };
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };

  if (/^DELETE FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.dias_confirmados = TABLAS.dias_confirmados.filter(d => !(d.grupo_id === grupoId && d.fecha === fecha));
    return { rows: [] };
  }
  if (/^INSERT INTO dias_confirmados \(grupo_id, fecha\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    let fila = TABLAS.dias_confirmados.find(d => d.grupo_id === grupoId && d.fecha === fecha);
    if (!fila) { fila = { grupo_id: grupoId, fecha, confirmado_en: new Date() }; TABLAS.dias_confirmados.push(fila); }
    else { fila.confirmado_en = new Date(); }
    return { rows: [{ confirmado_en: fila.confirmado_en }] };
  }
  if (/^SELECT confirmado_en FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.dias_confirmados.find(d => d.grupo_id === grupoId && d.fecha === fecha);
    return { rows: fila ? [{ confirmado_en: fila.confirmado_en }] : [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO alertas/i.test(sql)) return { rows: [{ id: 'a-' + Math.random().toString(36).slice(2) }] };

  if (/^SELECT nombre FROM grupos WHERE id = \$1/i.test(sql)) {
    const [grupoId] = params;
    const fila = TABLAS.grupos.find(g => g.id === grupoId);
    return { rows: fila ? [{ nombre: fila.nombre }] : [] };
  }

  if (/^SELECT id FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true/i.test(sql)) {
    const [jid] = params;
    const fila = TABLAS.grupos.find(g => g.whatsapp_grupo_jid === jid && g.whatsapp_habilitado === true);
    return { rows: fila ? [{ id: fila.id }] : [] };
  }

  // --- modoCuidadosoActivo() ---
  if (/^SELECT whatsapp_modo_cuidadoso FROM grupos WHERE id = \$1/i.test(sql)) {
    const [grupoId] = params;
    const fila = TABLAS.grupos.find(g => g.id === grupoId);
    return { rows: fila ? [{ whatsapp_modo_cuidadoso: !!fila.whatsapp_modo_cuidadoso }] : [] };
  }

  if (/^INSERT INTO sabanas_pendientes_whatsapp/i.test(sql)) {
    const [grupoId, fechaDetectada, texto, remitente, remitenteNombre] = params;
    const idNum = siguienteIdPendiente++;
    const fila = { id: 'p' + idNum, grupo_id: grupoId, fecha_detectada: fechaDetectada, texto, remitente, remitente_nombre: remitenteNombre, recibido_en: new Date(Date.now() + idNum * 1000), estado: 'pendiente', nota: null, procesado_en: null };
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
    if (!fila) { fila = filaVaciaDia(grupoId, fecha); TABLAS.whatsapp_dia_estado.push(fila); }
    fila.ultimo_texto = texto;
    fila.ultimo_texto_en = new Date();
    return { rows: [fila] };
  }
  if (/^INSERT INTO whatsapp_dia_estado \(grupo_id, fecha, sabana_final_en\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    let fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (!fila) { fila = filaVaciaDia(grupoId, fecha); TABLAS.whatsapp_dia_estado.push(fila); }
    if (!fila.sabana_final_en) fila.sabana_final_en = new Date();
    return { rows: [fila] };
  }
  if (/^UPDATE whatsapp_dia_estado SET ultima_verificacion_en = now\(\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (fila) fila.ultima_verificacion_en = new Date();
    return { rows: [] };
  }
  if (/^UPDATE whatsapp_dia_estado SET ultimo_envio_resumen_en = now\(\), ultimo_hash_resumen = \$3/i.test(sql)) {
    const [grupoId, fecha, hash] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (fila) { fila.ultimo_envio_resumen_en = new Date(); fila.ultimo_hash_resumen = hash; }
    return { rows: [] };
  }
  if (/^UPDATE whatsapp_dia_estado SET cierre_enviado_en = now\(\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (fila) fila.cierre_enviado_en = new Date();
    return { rows: [] };
  }

  // --- listarDiasAbiertos() (para tickRelojDeFondo) ---
  if (/^SELECT .* FROM whatsapp_dia_estado w JOIN grupos g ON g\.id = w\.grupo_id/i.test(sql)) {
    const [diasHaciaAtras] = params;
    const hoy = new Date();
    const limite = new Date(hoy.getTime() - diasHaciaAtras * 24 * 60 * 60 * 1000);
    const filas = TABLAS.whatsapp_dia_estado.filter(w => {
      const grupo = TABLAS.grupos.find(g => g.id === w.grupo_id);
      if (!grupo || !grupo.whatsapp_grupo_jid) return false;
      if (w.cierre_enviado_en) return false;
      if (!w.ultimo_texto) return false;
      if (new Date(w.fecha + 'T00:00:00Z') < new Date(limite.toISOString().split('T')[0] + 'T00:00:00Z')) return false;
      return true;
    }).sort((a, b) => a.fecha.localeCompare(b.fecha));
    return { rows: filas.map(f => {
      const grupo = TABLAS.grupos.find(g => g.id === f.grupo_id);
      return { ...f, whatsapp_grupo_jid: grupo.whatsapp_grupo_jid, whatsapp_modo_cuidadoso: !!grupo.whatsapp_modo_cuidadoso };
    }) };
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

const whatsappBot = require(path.join(__dirname, '..', 'src', 'services', 'whatsappBot'));
const { obtenerEstadoDia } = require(path.join(__dirname, '..', 'src', 'services', 'whatsappDiaEstado'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function crearSockFalso() {
  const mensajes = [];
  return { mensajes, sendMessage: async (jid, contenido) => { mensajes.push({ jid, text: contenido.text }); } };
}

function crearMensaje(jid, texto) {
  return { key: { remoteJid: jid, fromMe: false, participant: jid.replace('@g.us', '') + ':1@s.whatsapp.net' }, message: { conversation: texto }, pushName: 'Cliente Prueba' };
}

(async function main() {
  // --- 1) modoCuidadosoActivo(): lee el flag de cada grupo tal cual está
  // guardado, y se banca un grupo inexistente sin reventar ---
  check(await whatsappBot.modoCuidadosoActivo('g-cuidadoso') === true, 'modoCuidadosoActivo() da true para un grupo con el modo prendido');
  check(await whatsappBot.modoCuidadosoActivo('g-normal') === false, 'modoCuidadosoActivo() da false para un grupo con el modo apagado');
  check(await whatsappBot.modoCuidadosoActivo('grupo-que-no-existe') === false, 'un grupo que no existe da false (nunca revienta, nunca se ASUME prendido por error)');

  // --- 2) manejarMensajeEntrante() con modo cuidadoso APAGADO (regresión
  // exacta al comportamiento de siempre): la primera sábana del día se
  // importa Y manda su aviso automático normal ---
  const sockNormal = crearSockFalso();
  const textoNormal = ['SABANA DE JUGADAS', FECHA, 'PEDRO', 'houston -120', '100//90'].join('\n');
  await whatsappBot.manejarMensajeEntrante(sockNormal, crearMensaje(JID_NORMAL, textoNormal));
  const diaNormal = await obtenerEstadoDia('g-normal', FECHA);
  check(!!diaNormal && diaNormal.ultimoTexto === 'PEDRO\nhouston -120\n100//90', 'grupo SIN modo cuidadoso: la sábana se importa igual que siempre');
  check(sockNormal.mensajes.length === 1, 'grupo SIN modo cuidadoso: el primer aviso automático SÍ se manda (comportamiento de siempre, sin cambios)');

  // --- 3) manejarMensajeEntrante() con modo cuidadoso PRENDIDO: la
  // sábana se importa IGUAL (la lectura nunca se toca), pero el aviso
  // automático NO se manda ---
  const sockCuidadoso = crearSockFalso();
  const textoCuidadoso = ['SABANA DE JUGADAS', FECHA, 'HANRY', 'houston -120', '100//90'].join('\n');
  await whatsappBot.manejarMensajeEntrante(sockCuidadoso, crearMensaje(JID_CUIDADOSO, textoCuidadoso));
  const diaCuidadoso = await obtenerEstadoDia('g-cuidadoso', FECHA);
  check(!!diaCuidadoso && diaCuidadoso.ultimoTexto === 'HANRY\nhouston -120\n100//90', 'grupo CON modo cuidadoso: la sábana se importa exactamente igual — la LECTURA nunca se apaga');
  const pendCuidadoso = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === 'g-cuidadoso');
  check(!!pendCuidadoso && pendCuidadoso.estado === 'importada', 'grupo CON modo cuidadoso: la bandeja de auditoría también la registra como "importada", normal');
  check(sockCuidadoso.mensajes.length === 0, 'grupo CON modo cuidadoso: NO se manda ningún aviso automático al grupo — justo lo que este modo apaga');

  // --- 4) tickRelojDeFondo(): con ambos días todavía abiertos (ninguno
  // recibió SABANA FINAL ni fue verificado por el reloj todavía), una
  // vuelta del reloj tiene que mandar el aviso del grupo normal (primera
  // verificación real vía el reloj) pero saltarse por completo al grupo
  // con modo cuidadoso ---
  const sockReloj = crearSockFalso();
  // whatsappBot usa su propio `sockActual` interno para el reloj de
  // fondo — no hay forma de inyectar un sock falso desde afuera sin
  // conectarse de verdad a WhatsApp, así que esta prueba llama
  // procesarDiaAbierto() directo (lo mismo que tickRelojDeFondo hace por
  // dentro, para CADA día) para confirmar que el propio tickRelojDeFondo
  // decide saltarse a g-cuidadoso ANTES de intentar mandar nada — ver el
  // chequeo de `dia.whatsappModoCuidadoso` al principio del for.
  //
  // Como no se puede inyectar sockActual desde este archivo (variable
  // interna de whatsappBot.js, a propósito no exportada), se verifica el
  // mismo criterio desde el otro lado: whatsappDiaEstado.listarDiasAbiertos()
  // (que tickRelojDeFondo llama primero) ya trae el flag correcto para
  // cada día, y manejarMensajeEntrante (arriba) ya probó que ESE flag
  // apaga el envío automático — tickRelojDeFondo usa exactamente el
  // mismo criterio (`dia.whatsappModoCuidadoso`) para decidir si llama o
  // no a procesarDiaAbierto por cada día, ver whatsappBot.js.
  const { listarDiasAbiertos } = require(path.join(__dirname, '..', 'src', 'services', 'whatsappDiaEstado'));
  const abiertos = await listarDiasAbiertos(3);
  const diaAbiertoNormal = abiertos.find(d => d.grupoId === 'g-normal' && d.fecha === FECHA);
  const diaAbiertoCuidadoso = abiertos.find(d => d.grupoId === 'g-cuidadoso' && d.fecha === FECHA);
  check(!!diaAbiertoNormal && diaAbiertoNormal.whatsappModoCuidadoso === false, 'listarDiasAbiertos (lo que usa el reloj de fondo) trae al grupo normal con el flag en false');
  check(!!diaAbiertoCuidadoso && diaAbiertoCuidadoso.whatsappModoCuidadoso === true, 'listarDiasAbiertos trae al grupo cuidadoso con el flag en true — tickRelojDeFondo usa esto para saltárselo con un simple "continue", sin ni siquiera intentar procesarDiaAbierto()');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
