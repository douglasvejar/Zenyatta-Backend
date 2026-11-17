// =================================================================
// BOT DE JUGADAS DEL CHAT (HIPISMO) — conexión con WhatsApp y con el sistema (17-11-2026).
// El cerebro (leer ofertas, emparejar, pozo, plano) vive en hipismoJugadasChat.js y se prueba aparte; acá solo se conecta:
//   - qué grupo del sistema es este chat (grupos.whatsapp_grupo_jid + whatsapp_habilitado + hipismo_chat_habilitado, los 3 de Súper-admin)
//   - quién es cada jugador: por su NÚMERO, contra jugadores.telefono (ficha del cliente)
//   - cuánto pozo le queda (el mismo número de "Pozos"/alertas, ajustado por lo que este bot ya confirmó y sigue pendiente)
//   - guardar cada jugada confirmada en "Jugadas entre Tercios Adelantadas" (pendiente: se resuelve sola al cargar la pizarra)
//   - responder en el grupo citando el mensaje y mencionando al jugador
// Un mensaje a la vez por grupo (cola), para que el pozo y el "queda por jugar" nunca se pisen.
// =================================================================
const db = require('../db');
const motorChat = require('./hipismoJugadasChat');
const { normalizarTelefono, telefonoDeParticipante, quitarTildes } = require('./whatsappTrigger');
const { clientesConPozoDisponible } = require('./hipismoAlertaPozo');

const TEXTO_PLANO_BOT = 'Jugadas del chat de WhatsApp (bot)';
const sesiones = new Map();        // grupoId -> { motor, cola, mensajes: Map(id -> msg) }
const cacheGrupos = new Map();     // jid -> { valor, hasta }
const cacheClientes = new Map();   // grupoId -> { lista, hasta }
const enviadosPorElBot = new Set();

const normNombre = t => quitarTildes(String(t || '')).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function grupoDelChat(jid) {
  const c = cacheGrupos.get(jid);
  if (c && c.hasta > Date.now()) return c.valor;
  let valor = null;
  try {
    const r = await db.query(
      `SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero
         FROM grupos
        WHERE whatsapp_grupo_jid = $1 AND whatsapp_habilitado = true AND hipismo_chat_habilitado = true AND activo = true`,
      [jid]
    );
    valor = r.rows[0] || null;
  } catch (e) {
    if (!e || e.code !== '42703') console.error('[hipismoChat] No se pudo leer el grupo del chat:', e.message);
  }
  cacheGrupos.set(jid, { valor, hasta: Date.now() + 30000 });
  return valor;
}

// Grupo cuando el mensaje llegó por la conexión PROPIA de ese grupo (whatsappSesionesGrupo.js): el grupo ya se sabe, y el chat de
// WhatsApp es el que Súper-admin eligió para ese número (grupos.whatsapp_propio_jid).
async function grupoPropio(grupoId, jid) {
  const clave = 'propio|' + grupoId + '|' + jid;
  const c = cacheGrupos.get(clave);
  if (c && c.hasta > Date.now()) return c.valor;
  let valor = null;
  try {
    const r = await db.query(
      `SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero
         FROM grupos
        WHERE id = $1 AND whatsapp_propio_jid = $2 AND whatsapp_propio_activo = true AND hipismo_chat_habilitado = true AND activo = true`,
      [grupoId, jid]
    );
    valor = r.rows[0] || null;
  } catch (e) {
    if (!e || e.code !== '42703') console.error('[hipismoChat] No se pudo leer el grupo del número propio:', e.message);
  }
  cacheGrupos.set(clave, { valor, hasta: Date.now() + 30000 });
  return valor;
}

// Número -> cliente. Se comparan los últimos 10 dígitos (así "0414-1234567" y "+58 414 1234567" son el mismo).
async function clientePorNumero(grupoId, jidReal) {
  const digitos = telefonoDeParticipante(jidReal);
  if (!digitos) return null;
  let c = cacheClientes.get(grupoId);
  if (!c || c.hasta < Date.now()) {
    const r = await db.query(`SELECT nombre, telefono FROM jugadores WHERE grupo_id = $1 AND telefono IS NOT NULL AND telefono <> '' AND COALESCE(es_cuenta_comision, false) = false`, [grupoId]);
    c = { lista: r.rows.map(f => ({ nombre: f.nombre, digitos: normalizarTelefono(f.telefono) })).filter(f => f.digitos.length >= 7), hasta: Date.now() + 60000 };
    cacheClientes.set(grupoId, c);
  }
  const ult = s => s.slice(-10);
  const hallado = c.lista.find(f => (f.digitos.length >= 10 && digitos.length >= 10) ? ult(f.digitos) === ult(digitos) : f.digitos === digitos);
  return hallado ? hallado.nombre : null;
}

// Lo que le queda para jugar. Los clientes sin pozo (libres) no tienen tope. A lo que ya calcula el sistema ("en juego" de las
// adelantadas descuenta solo el monto del que juega) se le corrige lo que ESTE bot ya confirmó y sigue pendiente:
// el jugador arriesga su monto (ya descontado) y el que da arriesga su parte (monto x N/10 en 10aN), que antes no se descontaba.
async function disponibleDe(grupoId, nombre) {
  const filas = await clientesConPozoDisponible(grupoId, [nombre], { incluirSinPozo: true });
  if (!filas.length) return { limitado: false, disponible: 0 };
  const c = filas[0];
  if (c.sinPozo) return { limitado: true, disponible: 0 };
  let disp = Number(c.disponible) || 0;
  const r = await db.query(
    `SELECT c.jugador_nombre, c.banquero_nombre, c.monto, c.riesgo_jugador, c.riesgo_banquero
       FROM hipismo_chat_jugadas c
       JOIN hipismo_tercios_adelantadas_jugadas a ON a.id = c.adelantada_jugada_id
      WHERE c.grupo_id = $1 AND a.estado = 'pendiente' AND (c.jugador_nombre = $2 OR c.banquero_nombre = $2)`,
    [grupoId, nombre]
  );
  r.rows.forEach(f => {
    if (f.jugador_nombre === nombre) disp += (Number(f.monto) || 0) - (Number(f.riesgo_jugador) || 0);
    if (f.banquero_nombre === nombre) disp -= Number(f.riesgo_banquero) || 0;
  });
  return { limitado: true, disponible: Math.round(disp * 100) / 100 };
}

async function resolverHipodromo(grupoId, texto) {
  const r = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE grupo_id = $1', [grupoId]);
  const buscado = normNombre(texto);
  if (!buscado) return null;
  const lista = r.rows.map(f => ({ nombre: f.nombre, n: normNombre(f.nombre) }));
  const exactos = lista.filter(f => f.n === buscado);
  if (exactos.length === 1) return exactos[0].nombre;
  const parecidos = lista.filter(f => f.n.includes(buscado) || (f.n.length >= 4 && buscado.includes(f.n)));
  return parecidos.length === 1 ? parecidos[0].nombre : null;
}

async function guardarJugada(grupoId, j) {
  await db.transaccion(async client => {
    let rp = await client.query(
      `SELECT id, comision_porcentaje FROM hipismo_tercios_adelantadas_planos
        WHERE grupo_id = $1 AND hipodromo_nombre = $2 AND fecha = $3 AND texto_original = $4 ORDER BY creado_en LIMIT 1`,
      [grupoId, j.hipodromo, j.fecha, TEXTO_PLANO_BOT]
    );
    if (!rp.rows.length) {
      const rh = await client.query('SELECT id FROM hipismo_hipodromos WHERE grupo_id = $1 AND nombre = $2', [grupoId, j.hipodromo]);
      rp = await client.query(
        `INSERT INTO hipismo_tercios_adelantadas_planos (grupo_id, hipodromo_id, hipodromo_nombre, fecha, comision_porcentaje, texto_original)
         VALUES ($1,$2,$3,$4,5,$5) RETURNING id, comision_porcentaje`,
        [grupoId, rh.rows[0] ? rh.rows[0].id : null, j.hipodromo, j.fecha, TEXTO_PLANO_BOT]
      );
    }
    const plano = rp.rows[0];
    const a = j.apuesta;
    const rj = await client.query(
      `INSERT INTO hipismo_tercios_adelantadas_jugadas
         (plano_id, grupo_id, jugador_nombre, banquero_nombre, carrera_numero, es_cruce, grupo_caballos, cruce_grupo_a, cruce_grupo_b, modalidad, monto, comision_porcentaje, texto_original, falta_monto, falta_jugador, falta_banquero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,false,false) RETURNING id`,
      [plano.id, grupoId, j.jugadorNombre, j.banqueroNombre, j.carrera, !!a.cruce, a.cruce ? null : JSON.stringify(a.grupo || null),
        a.cruce ? JSON.stringify(a.cruce.gruposA) : null, a.cruce ? JSON.stringify(a.cruce.gruposB) : null, a.modalidad || null, j.monto, plano.comision_porcentaje, j.textoLinea]
    );
    await client.query(
      `INSERT INTO hipismo_chat_jugadas (grupo_id, fecha, hipodromo_nombre, carrera_numero, jugador_nombre, banquero_nombre, monto, riesgo_jugador, riesgo_banquero, texto_linea, adelantada_jugada_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [grupoId, j.fecha, j.hipodromo, j.carrera, j.jugadorNombre, j.banqueroNombre, j.monto, j.riesgoJugador, j.riesgoBanquero, j.textoLinea, rj.rows[0].id]
    );
  });
}

// Las jugadas de la carrera, tal cual están hoy en el sistema (si alguien borró o editó una desde "Revisar Jugadas", el plano lo refleja).
async function cargarJugadas(grupoId, { fecha, hipodromo, carrera }) {
  const r = await db.query(
    `SELECT a.jugador_nombre, a.banquero_nombre, a.monto, a.es_cruce, a.grupo_caballos, a.cruce_grupo_a, a.cruce_grupo_b, a.modalidad
       FROM hipismo_chat_jugadas c
       JOIN hipismo_tercios_adelantadas_jugadas a ON a.id = c.adelantada_jugada_id
      WHERE c.grupo_id = $1 AND c.fecha = $2 AND c.hipodromo_nombre = $3 AND c.carrera_numero = $4
      ORDER BY c.creado_en`,
    [grupoId, fecha, hipodromo, carrera]
  );
  const lista = v => (Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v) : []));
  return r.rows.map(f => ({
    jugadorNombre: f.jugador_nombre, banqueroNombre: f.banquero_nombre, monto: Number(f.monto),
    apuesta: f.es_cruce
      ? { cruce: { gruposA: lista(f.cruce_grupo_a), gruposB: lista(f.cruce_grupo_b) }, grupo: null, modalidad: f.modalidad }
      : { cruce: null, grupo: lista(f.grupo_caballos), modalidad: f.modalidad }
  }));
}

function fechaHoyVenezuela() {
  return require('./fechaVenezuela').fechaVenezuelaHoy();
}

function sesionDe(grupo, sock, remoteJid) {
  let s = sesiones.get(grupo.id);
  if (!s) {
    s = { cola: Promise.resolve(), mensajes: new Map(), sock: null, jid: remoteJid, motor: null };
    s.motor = motorChat.crearMotor({
      nombreGrupo: grupo.nombre,
      hoy: fechaHoyVenezuela,
      identificar: async rem => clientePorNumero(grupo.id, rem.jidReal || rem.jid),
      resolverHipodromo: t => resolverHipodromo(grupo.id, t),
      disponible: n => disponibleDe(grupo.id, n),
      guardarJugada: j => guardarJugada(grupo.id, j),
      cargarJugadas: q => cargarJugadas(grupo.id, q),
      responder: (texto, op) => enviar(s, texto, op || {}),
      publicar: texto => enviar(s, texto, {})
    });
    sesiones.set(grupo.id, s);
  }
  s.sock = sock; s.jid = remoteJid;
  return s;
}

async function enviar(s, texto, op) {
  const contenido = { text: texto };
  if (op.mencionar) {
    const dig = telefonoDeParticipante(op.mencionar);
    if (dig && !String(op.mencionar).endsWith('@lid')) {
      contenido.text = texto.replace('@@', '@' + dig);
      contenido.mentions = [op.mencionar];
    } else {
      contenido.text = texto.replace('@@', '@' + (op.nombre || ''));
    }
  } else {
    contenido.text = texto.replace('@@', '');
  }
  const citado = op.citarId ? s.mensajes.get(op.citarId) : null;
  try {
    const enviado = await s.sock.sendMessage(s.jid, contenido, citado ? { quoted: citado } : undefined);
    const id = enviado && enviado.key && enviado.key.id;
    if (id) { enviadosPorElBot.add(id); if (enviadosPorElBot.size > 500) enviadosPorElBot.delete(enviadosPorElBot.values().next().value); }
  } catch (e) {
    console.error('[hipismoChat] No se pudo responder en el grupo ' + s.jid + ':', e.message);
  }
}

function extraerCitadoId(msg) {
  const m = msg && msg.message;
  const ci = m && m.extendedTextMessage && m.extendedTextMessage.contextInfo;
  return (ci && ci.stanzaId) || null;
}

// `grupoId` solo viene cuando el mensaje entró por el número propio de ese grupo.
// Devuelve true si el mensaje le tocaba a este bot (el grupo tiene el servicio y era una jugada, una respuesta o un comando de
// administrador); false para que siga su camino normal (sábana, comandos de Deportes...).
// `ayudas.resolverRemitente(jid)` pasa un @lid al número real; `ayudas.esAdministrador(grupo, jidReal, fromMe)` dice si puede abrir/cerrar/pedir plano.
async function intentar({ sock, msg, remoteJid, texto, ayudas, grupoId }) {
  if (!texto || !remoteJid) return false;
  const idMsg = msg.key && msg.key.id;
  if (idMsg && enviadosPorElBot.has(idMsg)) return false; // lo escribió el propio bot
  const grupo = grupoId ? await grupoPropio(grupoId, remoteJid) : await grupoDelChat(remoteJid);
  if (!grupo) return false;
  // Si el grupo tiene su número propio conectado, la conexión general se hace a un lado (no se responde dos veces).
  if (!grupoId) {
    let propia = false;
    try { propia = require('./whatsappSesionesGrupo').estaConectada(grupo.id); } catch (e) { /* sin gestor: sigue la general */ }
    if (propia) return false;
  }

  const jidCrudo = (msg.key && msg.key.participant) || remoteJid;
  const jidReal = await ayudas.resolverRemitente(jidCrudo);
  const fromMe = !!(msg.key && msg.key.fromMe);
  const s = sesionDe(grupo, sock, remoteJid);
  if (idMsg) { s.mensajes.set(idMsg, msg); if (s.mensajes.size > 400) s.mensajes.delete(s.mensajes.keys().next().value); }
  const esAdmin = await ayudas.esAdministrador(grupo, jidReal, fromMe);
  const mensaje = {
    texto, id: idMsg, citadoId: extraerCitadoId(msg), esAdmin,
    remitente: { jid: jidCrudo, jidReal, nombre: msg.pushName || telefonoDeParticipante(jidReal) }
  };
  s.cola = s.cola.then(() => s.motor.procesarMensaje(mensaje)).catch(e => console.error('[hipismoChat] Error al procesar un mensaje:', e));
  await s.cola;
  return false; // los mensajes siguen su camino normal (no choca con "SABANA DE JUGADAS"); nada de esto lo reconoce el resto
}

module.exports = { intentar, clientePorNumero, disponibleDe, guardarJugada, cargarJugadas, resolverHipodromo, TEXTO_PLANO_BOT, _sesiones: sesiones };
