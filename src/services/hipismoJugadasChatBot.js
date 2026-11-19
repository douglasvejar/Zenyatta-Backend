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

const TEXTO_PLANO_BOT = motorChat.TEXTO_PLANO_BOT; // la usa también routes/hipismo.js para mostrar estas jugadas en TERCIOS
const sesiones = new Map();        // grupoId -> { motor, cola, mensajes: Map(id -> msg) }
const cacheGrupos = new Map();     // jid -> { valor, hasta }
const cacheClientes = new Map();
const MARCA_ADMIN = '__ADMIN__'; // en hipismo_chat_numeros: el número no es un cliente sino un administrador autorizado con "autorizar"   // grupoId -> { lista, hasta }
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

// Un administrador asocia el número (o el código oculto @lid) de quien escribió con un cliente de la ficha: "registrar NOMBRE" citando su mensaje.
// El número (o @lid) del propio bot: nunca se asocia a un cliente (pasaba si el administrador respondía al mensaje del bot).
function esDelBot(sock, jid) {
  const u = sock && sock.user;
  if (!u) return false;
  const d = telefonoDeParticipante(jid);
  return !!d && [u.id, u.lid, u.jid].some(x => x && telefonoDeParticipante(String(x)) === d);
}

async function registrarNumeroManual(grupoId, { jid, jidReal, nombre }, obtenerSock) {
  // Se guardan los dos: el código oculto (@lid) y, si se pudo resolver, el teléfono real (WhatsApp muestra uno u otro según la conexión).
  const lista0 = [jid, jidReal].map(j => telefonoDeParticipante(j)).filter((d, i, a) => d && a.indexOf(d) === i);
  const digitos = lista0[0];
  if (!digitos) return { ok: false, motivo: 'No pude leer el número de esa persona.' };
  if (obtenerSock && lista0.some(j => esDelBot(obtenerSock(), j + '@s.whatsapp.net') )) return { ok: false, motivo: 'Ese es el número del propio bot, no el de un cliente. Responde al mensaje de la persona (o a mi aviso para ella).' };
  const buscado = normNombre(nombre);
  if (!buscado) return { ok: false, motivo: 'Escribe el nombre del cliente: *registrar NOMBRE*' };
  const r = await db.query(`SELECT nombre FROM jugadores WHERE grupo_id = $1 AND COALESCE(es_cuenta_comision, false) = false`, [grupoId]);
  const lista = r.rows.map(f => ({ nombre: f.nombre, n: normNombre(f.nombre) }));
  let hallados = lista.filter(f => f.n === buscado);
  if (hallados.length === 0) hallados = lista.filter(f => f.n.includes(buscado));
  if (hallados.length === 0) return { ok: false, motivo: 'No encontré ningún cliente llamado "' + nombre + '" en este grupo.' };
  if (hallados.length > 1) return { ok: false, motivo: 'Hay varios clientes que se parecen a "' + nombre + '" (' + hallados.slice(0, 4).map(f => f.nombre).join(', ') + '). Escribe el nombre completo.' };
  for (const d of lista0) {
    await db.query(
      `INSERT INTO hipismo_chat_numeros (grupo_id, digitos, jugador_nombre) VALUES ($1,$2,$3)
       ON CONFLICT (grupo_id, digitos) DO UPDATE SET jugador_nombre = EXCLUDED.jugador_nombre`,
      [grupoId, d, hallados[0].nombre]
    );
  }
  cacheClientes.delete(grupoId);
  return { ok: true, nombre: hallados[0].nombre };
}

// Para el panel de Súper-admin: por qué el bot ignoró un mensaje que llegó por el número propio de un grupo.
async function motivoSinGrupoPropio(grupoId, jid) {
  try {
    const r = await db.query('SELECT activo, hipismo_chat_habilitado, whatsapp_propio_activo, whatsapp_propio_jid FROM grupos WHERE id = $1', [grupoId]);
    const g = r.rows[0];
    if (!g) return 'No se encontró el grupo en el sistema';
    if (!g.activo) return 'Ignorado: el grupo está INACTIVO (actívalo en la lista de Grupos de Súper-admin)';
    if (!g.hipismo_chat_habilitado) return 'Ignorado: el servicio Corredores y Administración Inteligente no está contratado';
    if (!g.whatsapp_propio_activo) return 'Ignorado: el número propio no está marcado como vinculado';
    if (!g.whatsapp_propio_jid) return 'Ignorado: todavía no elegiste el grupo de WhatsApp (elígelo en el desplegable y toca Guardar grupo)';
    if (g.whatsapp_propio_jid !== jid) return 'Ignorado: este chat no es el elegido para este número';
  } catch (e) { /* sin detalle */ }
  return 'Ignorado por el bot';
}

// Número -> cliente. Se comparan los últimos 10 dígitos (así "0414-1234567" y "+58 414 1234567" son el mismo).
// `jids` puede ser un jid o varios (el real y el crudo): WhatsApp a veces muestra el @lid y a veces el teléfono, según la conexión,
// así que se prueban todos contra los números asociados a mano y contra las fichas.
async function cacheDeClientes(grupoId) {
  let c = cacheClientes.get(grupoId);
  if (!c || c.hasta < Date.now()) {
    const r = await db.query(`SELECT nombre, telefono FROM jugadores WHERE grupo_id = $1 AND telefono IS NOT NULL AND telefono <> '' AND COALESCE(es_cuenta_comision, false) = false`, [grupoId]);
    const mapa = new Map();
    const admins = new Set();
    try {
      const rm = await db.query('SELECT digitos, jugador_nombre FROM hipismo_chat_numeros WHERE grupo_id = $1', [grupoId]);
      rm.rows.forEach(f => { if (f.jugador_nombre === MARCA_ADMIN) admins.add(String(f.digitos)); else mapa.set(String(f.digitos), f.jugador_nombre); });
    } catch (e) { if (!e || (e.code !== '42P01' && e.code !== '42703')) console.error('[hipismoChat] No se pudieron leer los números registrados a mano:', e.message); }
    c = { lista: r.rows.map(f => ({ nombre: f.nombre, digitos: normalizarTelefono(f.telefono) })).filter(f => f.digitos.length >= 7), mapa, admins, hasta: Date.now() + 60000 };
    cacheClientes.set(grupoId, c);
  }
  return c;
}

async function clientePorNumero(grupoId, jids) {
  const todos = [].concat(jids || []).map(j => telefonoDeParticipante(j)).filter((d, i, a) => d && a.indexOf(d) === i);
  if (!todos.length) return null;
  const c = await cacheDeClientes(grupoId);
  for (const digitos of todos) if (c.mapa && c.mapa.has(digitos)) return c.mapa.get(digitos); // asociado a mano por un administrador ("registrar NOMBRE")
  const ult = s => s.slice(-10);
  for (const digitos of todos) {
    const hallado = c.lista.find(f => (f.digitos.length >= 10 && digitos.length >= 10) ? ult(f.digitos) === ult(digitos) : f.digitos === digitos);
    if (hallado) return hallado.nombre;
  }
  return null;
}

// Administradores autorizados con el comando "autorizar" (además del número de Súper-admin y del chip del bot).
async function esAdminRegistrado(grupoId, jids) {
  const todos = [].concat(jids || []).map(j => telefonoDeParticipante(j)).filter(Boolean);
  if (!todos.length) return false;
  try { const c = await cacheDeClientes(grupoId); return todos.some(d => c.admins && c.admins.has(d)); } catch (e) { return false; }
}

async function autorizarAdminManual(grupoId, { jid }, obtenerSock) {
  const digitos = telefonoDeParticipante(jid);
  if (!digitos) return { ok: false, motivo: 'No pude leer el número de esa persona.' };
  if (obtenerSock && esDelBot(obtenerSock(), jid)) return { ok: false, motivo: 'Ese es el número del propio bot, no el de una persona.' };
  await db.query(
    `INSERT INTO hipismo_chat_numeros (grupo_id, digitos, jugador_nombre) VALUES ($1,$2,$3)
     ON CONFLICT (grupo_id, digitos) DO UPDATE SET jugador_nombre = EXCLUDED.jugador_nombre`,
    [grupoId, digitos, MARCA_ADMIN]
  );
  cacheClientes.delete(grupoId);
  return { ok: true };
}

// Lo que le queda para jugar. Los clientes sin pozo (libres) no tienen tope. A lo que ya calcula el sistema ("en juego" de las
// adelantadas descuenta solo el monto del que juega) se le corrige lo que ESTE bot ya confirmó y sigue pendiente:
// el jugador arriesga su monto (ya descontado) y el que da arriesga su parte (monto x N/10 en 10aN), que antes no se descontaba.
async function disponibleDe(grupoId, nombre) {
  const filas = await clientesConPozoDisponible(grupoId, [nombre], { incluirSinPozo: true });
  if (!filas.length) return { limitado: false, disponible: 0 };
  const c = filas[0];
  if (c.sinPozo) return { limitado: true, disponible: 0, detalle: 'Cuenta de ' + nombre + ': cliente Libre marcado "sin pozo" (todavía no tiene pozo asignado)' };
  let disp = Number(c.disponible) || 0;
  const dispSistema = disp;
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
  const f2 = x => (Math.round(x * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    limitado: true, disponible: Math.round(disp * 100) / 100,
    detalle: 'Cuenta de ' + nombre + ': pozo asignado ' + f2(Number(c.base) || 0) + ' · disponible del sistema (pozo + resultados − en juego) ' + f2(dispSistema) + ' · ajuste por paradas del bot pendientes ' + f2(disp - dispSistema) + ' · queda ' + f2(disp)
  };
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
  // Igual que al cargarla a mano: si al jugador le quedó poco pozo, queda la alerta en Administración > Alertas. Nunca impide guardar.
  try {
    await ext.alertarPozoBajo(grupoId, { nombres: [j.jugadorNombre], hipodromoNombre: j.hipodromo, fecha: j.fecha, etiqueta: 'tercios adelantadas de ' + j.hipodromo, excluir: [] });
  } catch (e) { console.warn('[hipismoChat] No se pudo revisar el pozo bajo (la jugada ya quedó guardada):', e.message); }
}

// Carrera abierta/cerrada de cada grupo, para que un reinicio del servidor no la pierda.
async function cargarEstadoCarrera(grupoId) {
  try {
    const r = await db.query(`SELECT hipodromo, carrera, abierta, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM hipismo_chat_estado WHERE grupo_id = $1`, [grupoId]);
    return r.rows[0] || null;
  } catch (e) {
    if (!e || (e.code !== '42P01' && e.code !== '42703')) console.error('[hipismoChat] No se pudo leer el estado de la carrera:', e.message);
    return null;
  }
}
async function guardarEstadoCarrera(grupoId, e) {
  try {
    await db.query(
      `INSERT INTO hipismo_chat_estado (grupo_id, hipodromo, carrera, abierta, fecha, actualizado_en) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (grupo_id) DO UPDATE SET hipodromo = EXCLUDED.hipodromo, carrera = EXCLUDED.carrera, abierta = EXCLUDED.abierta, fecha = EXCLUDED.fecha, actualizado_en = now()`,
      [grupoId, e.hipodromo, e.carrera, !!e.abierta, e.fecha]
    );
  } catch (err) {
    if (!err || (err.code !== '42P01' && err.code !== '42703')) console.error('[hipismoChat] No se pudo guardar el estado de la carrera:', err.message);
  }
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

// Cargar la pizarra desde el chat: usa el mismo manejador de "Cargar Planos" (plano vacío + pizarra) y devuelve el texto del resultado.
// `ext` se puede reemplazar en las pruebas.
const ext = {
  guardarPlano: (grupoId, body) => require('../routes/hipismo').guardarPlanoParaBot(grupoId, body),
  alertarPozoBajo: (grupoId, datos) => require('../routes/hipismo').alertarPozoBajoParaBot(grupoId, datos),
  generarImagen: (grupoId, datos) => require('./hipismoPlanoImagenServidor').generarImagenPlano({ grupoId, datos })
};
async function cargarPizarraChat(grupoId, { hipodromo, carrera, fecha, pizarra, ret }) {
  let out;
  try { out = await ext.guardarPlano(grupoId, { texto: '', pizarra, hipodromoNombre: hipodromo, carreraNumero: carrera, fecha, ret: ret || '' }); }
  catch (e) { console.error('[hipismoChat] Error al cargar la pizarra:', e); return { ok: false, motivo: 'error interno al calcular (' + e.message + ')' }; }
  // POST /planos (guardar) responde 201 con { plano, datosImagen, ... }: el texto del resultado va en plano.texto_resultado
  // (textoResultado solo viene en "calcular"). Se aceptan las dos formas.
  const textoOk = out && out.body && (out.body.textoResultado || (out.body.plano && out.body.plano.texto_resultado));
  if (out && out.status === 201 && textoOk) return { ok: true, texto: textoOk, datosImagen: out.body.datosImagen || null };
  if (out && out.status === 201) return { ok: true, texto: 'Carrera calculada y guardada en los saldos de los clientes.', datosImagen: out.body && out.body.datosImagen || null };
  const err = out && out.body && out.body.error;
  if (out && out.status === 409) return { ok: false, motivo: 'esa carrera ya tiene un plano registrado. Para volver a calcularla, bórralo primero en Eliminar Planos del panel.' };
  if (err && /Falta el texto del plano/i.test(err)) return { ok: false, motivo: 'no encontré jugadas pendientes del bot para esa carrera (¿ya se calcularon o se borraron?).' };
  return { ok: false, motivo: err || 'no se pudo calcular la carrera.' };
}

// Cómo publica el bot el plano ya resuelto (al cargar la pizarra): 'texto' (el plano de siempre) o 'imagen' (la tarjeta con la llegada,
// las jugadas y quiénes ganan/pierden, con el texto "TOTALES DE LA CARRERA ..." de pie de foto). Se elige por grupo en Súper-admin.
async function formatoPlanoDe(grupoId) {
  try {
    const r = await db.query('SELECT hipismo_chat_plano_formato FROM grupos WHERE id = $1', [grupoId]);
    return r.rows[0] && r.rows[0].hipismo_chat_plano_formato === 'imagen' ? 'imagen' : 'texto';
  } catch (e) { return 'texto'; }
}
async function publicarResultadoPlano(s, grupoId, r) {
  if ((await formatoPlanoDe(grupoId)) === 'imagen' && r.datosImagen) {
    const png = await ext.generarImagen(grupoId, r.datosImagen);
    if (png && await enviarImagen(s, png, r.datosImagen.textoAcompanante)) return;
    if (s.anotarActual) s.anotarActual('No se pudo enviar la imagen del plano: se envió en texto');
  }
  await enviar(s, r.texto, {});
}

function fechaHoyVenezuela() {
  return require('./fechaVenezuela').fechaVenezuelaHoy();
}

function sesionDe(grupo, sock, remoteJid) {
  let s = sesiones.get(grupo.id);
  if (!s) {
    s = { cola: Promise.resolve(), mensajes: new Map(), avisos: new Map(), sock: null, jid: remoteJid, motor: null };
    s.motor = motorChat.crearMotor({
      nombreGrupo: grupo.nombre,
      hoy: fechaHoyVenezuela,
      identificar: async rem => {
        const jidVisto = rem.jidReal || rem.jid;
        const nombre = await clientePorNumero(grupo.id, [rem.jidReal, rem.jid]);
        if (!nombre) console.log('[hipismoChat] Grupo ' + grupo.id + ': ninguna ficha tiene el teléfono ' + (telefonoDeParticipante(jidVisto) || '?') + ' (jid visto: ' + jidVisto + ').');
        // Para el panel de Súper-admin ("Último mensaje que llegó"): qué número vio el bot y si lo encontró en alguna ficha.
        if (s.anotarActual) {
          const dig = telefonoDeParticipante(jidVisto);
          const oculto = String(jidVisto).endsWith('@lid');
          s.anotarActual('Número que vio el bot: ' + (dig || '?') + (oculto ? ' (WhatsApp lo oculta: es un código interno, no un teléfono)' : '') + ' → ' + (nombre ? 'es el cliente ' + nombre : 'ninguna ficha tiene ese teléfono'));
        }
        return nombre;
      },
      resolverHipodromo: t => resolverHipodromo(grupo.id, t),
      disponible: n => disponibleDe(grupo.id, n),
      guardarJugada: j => guardarJugada(grupo.id, j),
      cargarJugadas: q => cargarJugadas(grupo.id, q),
      cargarEstado: () => cargarEstadoCarrera(grupo.id),
      registrarNumero: x => registrarNumeroManual(grupo.id, x, () => s.sock),
      autorizarAdmin: x => autorizarAdminManual(grupo.id, x, () => s.sock),
      guardarEstado: e => guardarEstadoCarrera(grupo.id, e),
      nota: t => { if (s.anotarActual) s.anotarActual(t); },
      cargarPizarra: x => cargarPizarraChat(grupo.id, x),
      responder: (texto, op) => enviar(s, texto, op || {}),
      publicar: texto => enviar(s, texto, {}),
      publicarResultado: r => publicarResultadoPlano(s, grupo.id, r)
    });
    sesiones.set(grupo.id, s);
  }
  s.sock = sock; s.jid = remoteJid;
  return s;
}

async function enviar(s, texto, op) {
  const contenido = { text: texto };
  // '@@' = a quien se menciona (op.mencionar); '@@2' y '@@3' = otras personas (op.mencionar2/3). Sin persona, la marca se quita.
  const menciones = [];
  const poner = (marca, jid, nombre) => {
    if (!contenido.text.includes(marca)) return;
    const dig = jid ? telefonoDeParticipante(jid) : null;
    if (jid && dig && !String(jid).endsWith('@lid')) { contenido.text = contenido.text.replace(marca, '@' + dig); menciones.push(jid); }
    else contenido.text = contenido.text.replace(marca, jid ? '@' + (nombre || '') : '');
  };
  poner('@@3', op.mencionar3, op.nombre3);
  poner('@@2', op.mencionar2, op.nombre2);
  poner('@@', op.mencionar, op.nombre);
  if (menciones.length) contenido.mentions = menciones.filter((j, i, a) => a.indexOf(j) === i);
  const citado = op.citarId ? s.mensajes.get(op.citarId) : null;
  try {
    const enviado = await s.sock.sendMessage(s.jid, contenido, citado ? { quoted: citado } : undefined);
    const id = enviado && enviado.key && enviado.key.id;
    if (id && op.registroDe) { s.avisos.set(id, op.registroDe); if (s.avisos.size > 200) s.avisos.delete(s.avisos.keys().next().value); } // aviso "no registrado": el admin puede responderle a ÉL con "registrar NOMBRE"
    if (id) { enviadosPorElBot.add(id); if (enviadosPorElBot.size > 500) enviadosPorElBot.delete(enviadosPorElBot.values().next().value); }
  } catch (e) {
    console.error('[hipismoChat] No se pudo responder en el grupo ' + s.jid + ':', e.message);
  }
}

// Manda una imagen (PNG) al grupo con su pie de foto. Devuelve true si salió.
async function enviarImagen(s, png, pie) {
  try {
    const enviado = await s.sock.sendMessage(s.jid, { image: png, caption: pie || '' });
    const id = enviado && enviado.key && enviado.key.id;
    if (id) { enviadosPorElBot.add(id); if (enviadosPorElBot.size > 500) enviadosPorElBot.delete(enviadosPorElBot.values().next().value); }
    return true;
  } catch (e) {
    console.error('[hipismoChat] No se pudo enviar la imagen en el grupo ' + s.jid + ':', e.message);
    return false;
  }
}

function extraerCitadoParticipante(msg) {
  const m = msg && msg.message;
  const ci = m && m.extendedTextMessage && m.extendedTextMessage.contextInfo;
  return (ci && ci.participant) || null;
}

// Texto del mensaje que se está respondiendo (WhatsApp lo trae dentro de la respuesta): sirve para reconocer una parada aunque el bot ya no la tenga en memoria.
function extraerCitadoTexto(msg) {
  const m = msg && msg.message;
  const ci = m && m.extendedTextMessage && m.extendedTextMessage.contextInfo;
  const q = ci && ci.quotedMessage;
  return (q && (q.conversation || (q.extendedTextMessage && q.extendedTextMessage.text) || (q.imageMessage && q.imageMessage.caption))) || null;
}

// Hora en que escribieron el mensaje (milisegundos). WhatsApp la manda en segundos (a veces como objeto Long).
function tiempoDeMensaje(msg) {
  const t = msg && msg.messageTimestamp;
  const n = t && typeof t === 'object' && typeof t.toNumber === 'function' ? t.toNumber() : Number(t);
  return n > 0 ? n * 1000 : null;
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
async function intentar({ sock, msg, remoteJid, texto, ayudas, grupoId, anotar }) {
  if (!texto || !remoteJid) return false;
  const idMsg = msg.key && msg.key.id;
  if (idMsg && enviadosPorElBot.has(idMsg)) return false; // lo escribió el propio bot
  const grupo = grupoId ? await grupoPropio(grupoId, remoteJid) : await grupoDelChat(remoteJid);
  if (!grupo) {
    if (grupoId && anotar) anotar(await motivoSinGrupoPropio(grupoId, remoteJid));
    return false;
  }
  if (anotar) anotar('Lo leyó el bot de jugadas');
  // Si el grupo tiene su número propio conectado, la conexión general se hace a un lado (no se responde dos veces).
  if (!grupoId) {
    let propia = false;
    try { propia = require('./whatsappSesionesGrupo').estaConectada(grupo.id); } catch (e) { /* sin gestor: sigue la general */ }
    if (propia) return false;
  }

  const jidCrudo = (msg.key && msg.key.participant) || remoteJid;
  const jidReal = await ayudas.resolverRemitente(jidCrudo);
  if (anotar && String(jidReal).endsWith('@lid')) anotar('Lo leyó el bot, pero WhatsApp oculta el número de ' + (msg.pushName || 'esa persona') + ' y no se pudo identificar al cliente');
  const fromMe = !!(msg.key && msg.key.fromMe);
  const s = sesionDe(grupo, sock, remoteJid);
  s.anotarActual = anotar || null;
  if (idMsg) { s.mensajes.set(idMsg, msg); if (s.mensajes.size > 400) s.mensajes.delete(s.mensajes.keys().next().value); }
  const esAdmin = (await ayudas.esAdministrador(grupo, jidReal, fromMe)) || (await esAdminRegistrado(grupo.id, [jidReal, jidCrudo]));
  let citadoPart = extraerCitadoParticipante(msg);
  const citadoIdMsg = extraerCitadoId(msg);
  // Si el administrador responde al aviso "no está registrado" del bot, se registra a la persona a la que iba dirigido el aviso.
  if (citadoIdMsg && s.avisos.has(citadoIdMsg)) citadoPart = s.avisos.get(citadoIdMsg);
  else if (citadoPart && esDelBot(sock, citadoPart)) citadoPart = null; // citó un mensaje del propio bot que no es un aviso conocido

  const mensaje = {
    texto, id: idMsg, ts: tiempoDeMensaje(msg), citadoId: extraerCitadoId(msg), citadoParticipante: citadoPart, citadoTexto: extraerCitadoTexto(msg), esAdmin,
    remitente: { jid: jidCrudo, jidReal, nombre: msg.pushName || telefonoDeParticipante(jidReal) }
  };
  s.cola = s.cola.then(() => s.motor.procesarMensaje(mensaje)).catch(async e => {
    console.error('[hipismoChat] Error al procesar un mensaje:', e);
    if (anotar) anotar('ERROR interno al procesar este mensaje: ' + (e && e.message));
    // Antes un error aquí dejaba al bot mudo sin explicación: ahora se avisa en el grupo (una vez por minuto).
    if (Date.now() - (s.ultimoAvisoError || 0) > 60000) {
      s.ultimoAvisoError = Date.now();
      await enviar(s, '⚠️ No pude procesar ese mensaje por un error interno. Avisa al administrador.', { citarId: idMsg });
    }
  });
  await s.cola;
  return false; // los mensajes siguen su camino normal (no choca con "SABANA DE JUGADAS"); nada de esto lo reconoce el resto
}

module.exports = { _enviar: enviar, _ext: ext, intentar, autorizarAdminManual, registrarNumeroManual, _registrarNumeroManual: registrarNumeroManual, clientePorNumero, disponibleDe, guardarJugada, cargarJugadas, resolverHipodromo, TEXTO_PLANO_BOT, _sesiones: sesiones };
