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
const libreta = require('./hipismoLibreta'); // el teléfono de la ficha funciona como libreta de contactos (ver ese archivo)

const TEXTO_PLANO_BOT = motorChat.TEXTO_PLANO_BOT; // la usa también routes/hipismo.js para mostrar estas jugadas en TERCIOS
const sesiones = new Map();        // Una sesión de carrera por grupo de Ludox y chat de WhatsApp.
const cacheClientes = new Map();
const MARCA_ADMIN = '__ADMIN__'; // en hipismo_chat_numeros: el número no es un cliente sino un administrador autorizado con "autorizar"   // grupoId -> { lista, hasta }
const enviadosPorElBot = new Set();

const normNombre = t => quitarTildes(String(t || '')).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function grupoDelChat(jid) {
  let valor = null;
  try {
    const r = await db.query(
      `SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero
         FROM grupos
        WHERE whatsapp_grupo_jid = $1 AND whatsapp_habilitado = true AND hipismo_chat_habilitado = true AND activo = true
          AND whatsapp_propio_chats IS NULL`,
      [jid]
    );
    valor = r.rows[0] || null;
  } catch (e) {
    if (!e || e.code !== '42703') console.error('[hipismoChat] No se pudo leer el grupo del chat:', e.message);
  }
  return valor;
}

// Grupo cuando el mensaje llegó por la conexión PROPIA de ese grupo (whatsappSesionesGrupo.js): el grupo ya se sabe, y el chat de
// WhatsApp debe estar en la lista autorizada por Súper-admin.
async function grupoPropio(grupoId, jid) {
  let valor = null;
  try {
    const r = await db.query(
      `SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero, whatsapp_propio_jid
         FROM grupos
        WHERE id = $1 AND $2 = ANY(COALESCE(whatsapp_propio_chats, ARRAY[whatsapp_propio_jid]))
          AND whatsapp_propio_activo = true AND hipismo_chat_habilitado = true AND activo = true`,
      [grupoId, jid]
    );
    valor = r.rows[0] || null;
  } catch (e) {
    if (!e || e.code !== '42703') console.error('[hipismoChat] No se pudo leer el grupo del número propio:', e.message);
  }
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
  // "registrar tom slayer" cuando la ficha se llama "SLAYER": también sirve si el nombre de la ficha está dentro de lo escrito
  if (hallados.length === 0) hallados = lista.filter(f => f.n.length >= 3 && (' ' + buscado + ' ').includes(' ' + f.n + ' '));
  if (hallados.length === 0) {
    const nombres = lista.map(f => f.nombre).sort((a, b) => a.localeCompare(b)).slice(0, 40);
    return { ok: false, motivo: 'No encontré ningún cliente llamado "' + nombre + '" en este grupo.' +
      (nombres.length ? '\n\nClientes registrados: ' + nombres.join(', ') + '.\nResponde de nuevo con el nombre exacto de la lista.' : '') +
      '\nSi es un cliente nuevo, créalo primero en *Clientes* del panel y luego responde otra vez *registrar NOMBRE*.' };
  }
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
    const r = await db.query('SELECT activo, hipismo_chat_habilitado, whatsapp_propio_activo, whatsapp_propio_jid, whatsapp_propio_chats FROM grupos WHERE id = $1', [grupoId]);
    const g = r.rows[0];
    if (!g) return 'No se encontró el grupo en el sistema';
    if (!g.activo) return 'Ignorado: el grupo está INACTIVO (actívalo en la lista de Grupos de Súper-admin)';
    if (!g.hipismo_chat_habilitado) return 'Ignorado: el servicio Corredores y Administración Inteligente no está contratado';
    if (!g.whatsapp_propio_activo) return 'Ignorado: el número propio no está marcado como vinculado';
    const autorizados = g.whatsapp_propio_chats || (g.whatsapp_propio_jid ? [g.whatsapp_propio_jid] : []);
    if (!autorizados.includes(jid)) return 'Ignorado: Súper-admin no autorizó este chat';
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
    c = { lista: r.rows.map(f => ({ nombre: f.nombre, digitos: normalizarTelefono(f.telefono) })).filter(f => f.digitos.length >= 7), fichas: r.rows.map(f => ({ nombre: f.nombre, telefono: f.telefono })), mapa, admins, hasta: Date.now() + 60000 };
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

// Libreta de contactos (20-11-2026): si el número que escribió no coincide con ninguna ficha tal cual (WhatsApp lo oculta como @lid), se le
// pregunta a WhatsApp a qué cuenta pertenece el teléfono guardado de cada ficha y se busca por ahí. Así el bot reconoce al cliente por
// el teléfono de su ficha y NO pide "registrar" en el chat. Nunca lanza error: si algo falla, queda como antes (no registrado).
async function clientePorLibreta(grupoId, sock, jids) {
  if (!sock) return null;
  try {
    const c = await cacheDeClientes(grupoId);
    if (!c.fichas || !c.fichas.length) return null;
    const existe = n => n && c.fichas.some(f => f.nombre === n) ? n : null;
    let nombre = existe(libreta.nombreDe(grupoId, jids));
    if (nombre) {
      if (libreta.conviene(grupoId, false)) libreta.sincronizar(grupoId, sock, c.fichas).catch(() => {}); // refresco en segundo plano
      return nombre;
    }
    if (libreta.conviene(grupoId, true)) {
      await conLimiteWhatsApp(libreta.sincronizar(grupoId, sock, c.fichas), 'consultar la libreta');
      nombre = existe(libreta.nombreDe(grupoId, jids));
    }
    return nombre;
  } catch (e) {
    console.error('[hipismoChat] Libreta de contactos:', e && e.message);
    return null;
  }
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
const MINUTOS_ESPERA_PIZARRA = 10;
const VIGENCIA_ESPERA_SQL = "((c.cerrada_en IS NULL AND c.creado_en > now() - interval '3 hours') OR c.cerrada_en > now() - interval '" + MINUTOS_ESPERA_PIZARRA + " minutes')";
async function disponibleDe(grupoId, nombre) {
  const filas = await clientesConPozoDisponible(grupoId, [nombre], { incluirSinPozo: true });
  if (!filas.length) return { limitado: false, disponible: 0 };
  const c = filas[0];
  if (c.sinPozo) return { limitado: true, disponible: 0, detalle: 'Cuenta de ' + nombre + ': cliente Libre marcado "sin pozo" (todavía no tiene pozo asignado)' };
  let disp = Number(c.disponible) || 0;
  const dispSistema = disp;
  // Jugadas del bot que esperan la pizarra (plano en espera: NO son adelantadas, todavía no están en ningún saldo). Descuentan el riesgo de cada
  // lado mientras la carrera está abierta o hasta 10 min después de cerrada; sin pizarra pasado ese tiempo se liberan.
  // (Las de versiones anteriores, ligadas a una adelantada pendiente, se siguen corrigiendo como antes.)
  const r = await db.query(
    `SELECT c.jugador_nombre, c.banquero_nombre, c.monto, c.riesgo_jugador, c.riesgo_banquero, c.adelantada_jugada_id
       FROM hipismo_chat_jugadas c
       LEFT JOIN hipismo_tercios_adelantadas_jugadas a ON a.id = c.adelantada_jugada_id
      WHERE c.grupo_id = $1 AND (c.jugador_nombre = $2 OR c.banquero_nombre = $2)
        AND ((c.adelantada_jugada_id IS NOT NULL AND a.estado = 'pendiente')
          OR (c.adelantada_jugada_id IS NULL AND c.resuelta = false AND ${VIGENCIA_ESPERA_SQL}))`,
    [grupoId, nombre]
  );
  r.rows.forEach(f => {
    if (f.adelantada_jugada_id) { // versión anterior: el "en juego" de la adelantada ya descontó el monto completo del que juega
      if (f.jugador_nombre === nombre) disp += (Number(f.monto) || 0) - (Number(f.riesgo_jugador) || 0);
      if (f.banquero_nombre === nombre) disp -= Number(f.riesgo_banquero) || 0;
    } else {
      if (f.jugador_nombre === nombre) disp -= Number(f.riesgo_jugador) || 0;
      if (f.banquero_nombre === nombre) disp -= Number(f.riesgo_banquero) || 0;
    }
  });
  const f2 = x => (Math.round(x * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    limitado: true, disponible: Math.round(disp * 100) / 100,
    detalle: 'Cuenta de ' + nombre + ': pozo asignado ' + f2(Number(c.base) || 0) + ' · disponible del sistema (pozo + resultados − en juego) ' + f2(dispSistema) + ' · ajuste por paradas del bot en espera de pizarra ' + f2(disp - dispSistema) + ' · queda ' + f2(disp)
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

// El bot NO guarda nada como "adelantada": la jugada espera aquí (plano en espera de la pizarra, máx. unos minutos). Al cargar la pizarra el
// bot hace lo mismo que el empleado: pega el plano en Cargar Planos, calcula y confirma (ver cargarPizarraChat).
async function guardarJugada(grupoId, j) {
  const r = await db.query(
    `INSERT INTO hipismo_chat_jugadas (grupo_id, fecha, hipodromo_nombre, carrera_numero, jugador_nombre, banquero_nombre, monto, riesgo_jugador, riesgo_banquero, texto_linea, apuesta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [grupoId, j.fecha, j.hipodromo, j.carrera, j.jugadorNombre, j.banqueroNombre, j.monto, j.riesgoJugador, j.riesgoBanquero, j.textoLinea, JSON.stringify(j.apuesta || null)]
  );
  return r && r.rows && r.rows[0] ? r.rows[0].id : null;
}

// "ERROR" en el chat: el otro involucrado (o un administrador) aceptó quitar la jugada. Solo se borran las que siguen en espera de la pizarra.
async function eliminarJugadaEnEspera(grupoId, id) {
  const r = await db.query('DELETE FROM hipismo_chat_jugadas WHERE id = $1 AND grupo_id = $2 AND resuelta = false AND adelantada_jugada_id IS NULL RETURNING id', [id, grupoId]);
  return r.rows.length ? { ok: true } : { ok: false, motivo: 'ya no está en espera' };
}

// Administradores conocidos del grupo (para etiquetarlos cuando nadie responde a un "error"): el número de Súper-admin y los autorizados con "autorizar".
async function listarAdministradores(grupo) {
  const lista = [];
  const dig = telefonoDeParticipante(String(grupo.comandos_whatsapp_numero || '').replace(/\D/g, '') + '@s.whatsapp.net');
  if (dig) lista.push({ jid: dig + '@s.whatsapp.net', nombre: '' });
  try { const c = await cacheDeClientes(grupo.id); c.admins.forEach(d => lista.push({ jid: d + '@s.whatsapp.net', nombre: '' })); } catch (e) { /* solo se etiqueta a los conocidos */ }
  return lista;
}

// Carrera abierta/cerrada de cada grupo, para que un reinicio del servidor no la pierda.
async function cargarEstadoCarrera(grupoId, chatJid) {
  try {
    if (chatJid) {
      const r = await db.query('SELECT estado FROM hipismo_chat_estado_por_chat WHERE grupo_id = $1 AND chat_jid = $2', [grupoId, chatJid]);
      return r.rows[0]?.estado || null;
    }
    const r = await db.query(`SELECT hipodromo, carrera, abierta, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM hipismo_chat_estado WHERE grupo_id = $1`, [grupoId]);
    return r.rows[0] || null;
  } catch (e) {
    if (!e || (e.code !== '42P01' && e.code !== '42703')) console.error('[hipismoChat] No se pudo leer el estado de la carrera:', e.message);
    return null;
  }
}
async function guardarEstadoCarrera(grupoId, e, chatJid) {
  try {
    if (chatJid) {
      await db.query(
        `INSERT INTO hipismo_chat_estado_por_chat (grupo_id, chat_jid, estado) VALUES ($1, $2, $3)
         ON CONFLICT (grupo_id, chat_jid) DO UPDATE SET estado = EXCLUDED.estado`,
        [grupoId, chatJid, JSON.stringify({ hipodromo: e.hipodromo, carrera: e.carrera, abierta: !!e.abierta, fecha: e.fecha })]
      );
    } else {
      await db.query(
        `INSERT INTO hipismo_chat_estado (grupo_id, hipodromo, carrera, abierta, fecha, actualizado_en) VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (grupo_id) DO UPDATE SET hipodromo = EXCLUDED.hipodromo, carrera = EXCLUDED.carrera, abierta = EXCLUDED.abierta, fecha = EXCLUDED.fecha, actualizado_en = now()`,
        [grupoId, e.hipodromo, e.carrera, !!e.abierta, e.fecha]
      );
    }
  } catch (err) {
    if (!err || (err.code !== '42P01' && err.code !== '42703')) console.error('[hipismoChat] No se pudo guardar el estado de la carrera:', err.message);
  }
  // Al cerrar la carrera sus jugadas en espera empiezan a contar los minutos para soltar el saldo; si se reabre, vuelven a contar como abiertas.
  try {
    if (e.hipodromo && e.carrera && e.fecha) {
      await db.query(
        `UPDATE hipismo_chat_jugadas SET cerrada_en = ${e.abierta ? 'NULL' : 'now()'}
          WHERE grupo_id = $1 AND fecha = $2 AND hipodromo_nombre = $3 AND carrera_numero = $4 AND resuelta = false AND adelantada_jugada_id IS NULL${e.abierta ? '' : ' AND cerrada_en IS NULL'}`,
        [grupoId, e.fecha, e.hipodromo, e.carrera]
      );
    }
  } catch (err) {
    if (!err || (err.code !== '42P01' && err.code !== '42703')) console.error('[hipismoChat] No se pudo marcar la hora de cierre de las jugadas:', err.message);
  }
}

// Las jugadas de la carrera, tal cual están hoy en el sistema (si alguien borró o editó una desde "Revisar Jugadas", el plano lo refleja).
async function cargarJugadas(grupoId, { fecha, hipodromo, carrera }) {
  const r = await db.query(
    `SELECT c.jugador_nombre, c.banquero_nombre, c.monto, c.apuesta, a.es_cruce, a.grupo_caballos, a.cruce_grupo_a, a.cruce_grupo_b, a.modalidad
       FROM hipismo_chat_jugadas c
       LEFT JOIN hipismo_tercios_adelantadas_jugadas a ON a.id = c.adelantada_jugada_id
      WHERE c.grupo_id = $1 AND c.fecha = $2 AND c.hipodromo_nombre = $3 AND c.carrera_numero = $4
        AND (c.adelantada_jugada_id IS NOT NULL OR c.resuelta = false)
      ORDER BY c.creado_en`,
    [grupoId, fecha, hipodromo, carrera]
  );
  const lista = v => (Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v) : []));
  return r.rows.map(f => {
    const ap = typeof f.apuesta === 'string' ? JSON.parse(f.apuesta) : f.apuesta;
    return {
      jugadorNombre: f.jugador_nombre, banqueroNombre: f.banquero_nombre, monto: Number(f.monto),
      apuesta: ap || (f.es_cruce
        ? { cruce: { gruposA: lista(f.cruce_grupo_a), gruposB: lista(f.cruce_grupo_b) }, grupo: null, modalidad: f.modalidad }
        : { cruce: null, grupo: lista(f.grupo_caballos), modalidad: f.modalidad })
    };
  });
}

// Cargar la pizarra desde el chat: usa el mismo manejador de "Cargar Planos" (plano vacío + pizarra) y devuelve el texto del resultado.
// `ext` se puede reemplazar en las pruebas.
const ext = {
  guardarPlano: (grupoId, body) => require('../routes/hipismo').guardarPlanoParaBot(grupoId, body),
  alertarPozoBajo: (grupoId, datos) => require('../routes/hipismo').alertarPozoBajoParaBot(grupoId, datos),
  generarImagen: (grupoId, datos) => require('./hipismoPlanoImagenServidor').generarImagenPlano({ grupoId, datos })
};
// Lo que hace el empleado a mano: arma el plano con las jugadas que esperaban (el mismo formato de líneas que se pega en Cargar Planos),
// le pone la pizarra y lo calcula y confirma con el MISMO manejador de "Cargar Planos". Todo lo demás (saldos, tickets, alertas, plano) sale igual.
function lineaParaCargarPlanos(f) {
  const a = typeof f.apuesta === 'string' ? JSON.parse(f.apuesta) : (f.apuesta || {});
  const modalidad = a.modalidad || (a.cruce ? 'pp' : '1P'); // sin modalidad: un cruce es "pp (AxB)"; un caballo solo es a ganador (1P)
  const jugada = motorChat.apuestaSegura({ cruce: a.cruce || null, grupo: a.grupo || null, modalidad });
  const monto = motorChat.montoParaLinea(Number(f.monto));
  const j = String(f.jugador_nombre).trim(), b = String(f.banquero_nombre).trim();
  // El parser de la línea espera nombres de una sola palabra. Con espacios se usa el modelo de 3 líneas de "Copiar plano sin resolver"
  // (el mismo que el empleado pega en Cargar Planos), que sí los lee.
  if (/\s/.test(j) || /\s/.test(b)) return jugada + ' con ' + monto + '\nJuega ' + j + '\nConsigue ' + b;
  return 'Juega ' + j + ' ' + jugada + ' con ' + monto + ' da ' + b;
}
async function jugadasEnEspera(grupoId, { fecha, hipodromo, carrera }) {
  const r = await db.query(
    `SELECT c.id, c.jugador_nombre, c.banquero_nombre, c.monto, c.apuesta FROM hipismo_chat_jugadas c
      WHERE c.grupo_id = $1 AND c.fecha = $2 AND c.hipodromo_nombre = $3 AND c.carrera_numero = $4 AND c.adelantada_jugada_id IS NULL AND c.resuelta = false
      ORDER BY c.creado_en`,
    [grupoId, fecha, hipodromo, carrera]
  );
  return r.rows;
}
async function cargarPizarraChat(grupoId, { hipodromo, carrera, fecha, pizarra, ret }) {
  let out, espera = [];
  try {
    espera = await jugadasEnEspera(grupoId, { fecha, hipodromo, carrera });
    const texto = espera.map(lineaParaCargarPlanos).join('\n');
    out = await ext.guardarPlano(grupoId, { texto, pizarra, hipodromoNombre: hipodromo, carreraNumero: carrera, fecha, ret: ret || '' });
  }
  catch (e) { console.error('[hipismoChat] Error al cargar la pizarra:', e); return { ok: false, motivo: 'error interno al calcular (' + e.message + ')' }; }
  if (out && out.status === 201 && espera.length) {
    try { await db.query('UPDATE hipismo_chat_jugadas SET resuelta = true WHERE id = ANY($1)', [espera.map(f => f.id)]); }
    catch (e) { console.error('[hipismoChat] No se pudieron marcar las jugadas como calculadas:', e.message); }
  }
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

// Si a los 10 min de cerrada la carrera todavía no llegó la pizarra, se avisa en el grupo: sus jugadas dejan de descontar saldo.
function programarAvisoPizarra(s, grupoId, e) {
  if (!e || !e.hipodromo || !e.carrera || !e.fecha) return;
  if (s.avisoPizarra) clearTimeout(s.avisoPizarra);
  s.avisoPizarra = setTimeout(async () => {
    s.avisoPizarra = null;
    try {
      const pend = await jugadasEnEspera(grupoId, { fecha: e.fecha, hipodromo: e.hipodromo, carrera: e.carrera });
      if (!pend.length) return;
      await enviar(s, '⚠️ El plano de *' + e.hipodromo + ', ' + e.carrera + 'ª carrera* lleva más de ' + MINUTOS_ESPERA_PIZARRA + ' minutos esperando la pizarra. Sus jugadas ya no descuentan el saldo de los clientes. Un administrador debe cargarla (por ejemplo: *pizarra 3 1 2 4*).', {});
    } catch (err) { console.error('[hipismoChat] No se pudo revisar el plano en espera:', err.message); }
  }, (MINUTOS_ESPERA_PIZARRA * 60 + 5) * 1000);
  if (s.avisoPizarra.unref) s.avisoPizarra.unref();
}

function sesionDe(grupo, sock, remoteJid, propia) {
  const clave = JSON.stringify([grupo.id, remoteJid]);
  const chatEstado = propia && grupo.whatsapp_propio_jid !== remoteJid ? remoteJid : null;
  let s = sesiones.get(clave);
  if (!s) {
    s = { mensajes: new Map(), avisos: new Map(), sock: null, jid: remoteJid, motor: null };
    s.motor = motorChat.crearMotor({
      nombreGrupo: grupo.nombre,
      hoy: fechaHoyVenezuela,
      identificar: async rem => {
        const jidVisto = rem.jidReal || rem.jid;
        let nombre = await clientePorNumero(grupo.id, [rem.jidReal, rem.jid]);
        if (!nombre) nombre = await clientePorLibreta(grupo.id, s.sock, [rem.jidReal, rem.jid]);
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
      eliminarJugada: id => eliminarJugadaEnEspera(grupo.id, id),
      listarAdmins: () => listarAdministradores(grupo),
      cargarJugadas: q => cargarJugadas(grupo.id, q),
      cargarEstado: () => cargarEstadoCarrera(grupo.id, chatEstado),
      registrarNumero: x => registrarNumeroManual(grupo.id, x, () => s.sock),
      autorizarAdmin: x => autorizarAdminManual(grupo.id, x, () => s.sock),
      guardarEstado: async e => {
        await guardarEstadoCarrera(grupo.id, e, chatEstado);
        if (e.abierta) { if (s.avisoPizarra) { clearTimeout(s.avisoPizarra); s.avisoPizarra = null; } return; }
        programarAvisoPizarra(s, grupo.id, e);
      },
      nota: t => { if (s.anotarActual) s.anotarActual(t); },
      cargarPizarra: x => cargarPizarraChat(grupo.id, x),
      responder: (texto, op) => enviar(s, texto, op || {}),
      publicar: texto => enviar(s, texto, {}),
      publicarResultado: r => publicarResultadoPlano(s, grupo.id, r)
    });
    sesiones.set(clave, s);
  }
  s.sock = sock; s.jid = remoteJid;
  return s;
}

// Limita las esperas de red sin adelantar el cierre sobre una escritura de jugada.
async function conLimiteWhatsApp(operacion, descripcion, limiteMs = 8000) {
  let temporizador;
  try {
    return await Promise.race([
      operacion,
      new Promise((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new Error('WhatsApp no respondió al ' + descripcion)), limiteMs);
      })
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

async function enviar(s, texto, op) {
  const contenido = { text: texto };
  // '@@' = a quien se menciona (op.mencionar); '@@2' y '@@3' = otras personas (op.mencionar2/3). Sin persona, la marca se quita.
  const menciones = [];
  // Etiqueta REAL: en el texto va "@<número>" y el mismo jid en `mentions` (así WhatsApp lo convierte en el nombre de la persona y le llega el aviso).
  // Vale el teléfono (@s.whatsapp.net) y también el código oculto (@lid): en grupos que usan códigos ocultos WhatsApp etiqueta con ese mismo código.
  const poner = (marca, jid, nombre) => {
    if (!contenido.text.includes(marca)) return;
    const m = jid ? String(jid).match(/^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/) : null;
    if (m) { contenido.text = contenido.text.replace(marca, '@' + m[1]); menciones.push(m[1] + '@' + m[2]); }
    else contenido.text = contenido.text.replace(marca, jid ? '@' + (nombre || '') : '');
  };
  if (contenido.text.includes('@@L')) { // lista de personas (administradores): "@a @b @c"
    const trozos = [];
    (op.mencionarLista || []).forEach(p => { const m = p && p.jid ? String(p.jid).match(/^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/) : null; if (m) { trozos.push('@' + m[1]); menciones.push(m[1] + '@' + m[2]); } });
    contenido.text = contenido.text.replace('@@L', trozos.join(' '));
  }
  poner('@@3', op.mencionar3, op.nombre3);
  poner('@@2', op.mencionar2, op.nombre2);
  poner('@@', op.mencionar, op.nombre);
  if (menciones.length) contenido.mentions = menciones.filter((j, i, a) => a.indexOf(j) === i);
  const citado = op.citarId ? s.mensajes.get(op.citarId) : null;
  try {
    const enviado = await conLimiteWhatsApp(s.sock.sendMessage(s.jid, contenido, citado ? { quoted: citado } : undefined), 'enviar el mensaje');
    const id = enviado && enviado.key && enviado.key.id;
    if (id && op.registroDe) { s.avisos.set(id, op.registroDe); if (s.avisos.size > 200) s.avisos.delete(s.avisos.keys().next().value); } // aviso "no registrado": el admin puede responderle a ÉL con "registrar NOMBRE"
    if (id) { enviadosPorElBot.add(id); if (enviadosPorElBot.size > 500) enviadosPorElBot.delete(enviadosPorElBot.values().next().value); }
    return id;
  } catch (e) {
    if (s.anotarActual) s.anotarActual('No se pudo confirmar el envío del mensaje: ' + e.message);
    console.error('[hipismoChat] No se pudo responder en el grupo ' + s.jid + ':', e.message);
  }
}

// Manda una imagen (PNG) al grupo con su pie de foto. Devuelve true si salió.
async function enviarImagen(s, png, pie) {
  try {
    const enviado = await conLimiteWhatsApp(s.sock.sendMessage(s.jid, { image: png, caption: pie || '' }), 'enviar la imagen');
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

function mensajesEnOrden(mensajes) {
  const lote = (mensajes || []).map(msg => ({ msg, ts: tiempoDeMensaje(msg) }));
  if (lote.every(item => item.ts !== null)) lote.sort((a, b) => a.ts - b.ts);
  return lote.map(item => item.msg);
}

function extraerCitadoId(msg) {
  const m = msg && msg.message;
  const ci = m && m.extendedTextMessage && m.extendedTextMessage.contextInfo;
  return (ci && ci.stanzaId) || null;
}

// `grupoId` solo viene cuando el mensaje entró por el número propio de ese grupo.
// Devuelve true si el mensaje le tocaba a este bot (el grupo tiene el servicio y era una jugada, una respuesta o un comando de
// administrador); false para que siga su camino normal (sábana, comandos de Deportes...).
// `ayudas.resolverRemitente(jid)` pasa un @lid al número real; `ayudas.esAdministrador(grupo, jidReal, fromMe)` valida permisos del bot; esAdministradorDelChat valida el rol real en WhatsApp.
const colasPorChat = new Map();
const colasPorGrupo = new Map();

async function enCola(colas, clave, procesar) {
  const turno = (colas.get(clave) || Promise.resolve()).then(procesar);
  const siguiente = turno.catch(() => {});
  colas.set(clave, siguiente);
  try { return await turno; } finally {
    if (colas.get(clave) === siguiente) colas.delete(clave);
  }
}

async function intentar(entrada) {
  const { texto, remoteJid, grupoId } = entrada;
  if (!texto || !remoteJid) return false;
  // Reserva el turno antes de consultar permisos o resolver el teléfono.
  return enCola(colasPorChat, JSON.stringify([grupoId || null, remoteJid]), () => procesarEntrada(entrada));
}

async function procesarEntrada({ sock, msg, remoteJid, texto, ayudas, grupoId, anotar }) {
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

  // Los pozos se comparten entre los chats de un grupo. Ninguna operación
  // posterior puede adelantar la escritura de una jugada ya en curso.
  await enCola(colasPorGrupo, grupo.id, async () => {
    const jidCrudo = (msg.key && msg.key.participant) || remoteJid;
    let jidReal = jidCrudo;
    try {
      jidReal = await conLimiteWhatsApp(ayudas.resolverRemitente(jidCrudo), 'identificar al remitente');
    } catch (e) {
      if (anotar) anotar(e.message);
    }
    if (anotar && String(jidReal).endsWith('@lid')) anotar('Lo leyó el bot, pero WhatsApp oculta el número de ' + (msg.pushName || 'esa persona') + ' y no se pudo identificar al cliente');
    const fromMe = !!(msg.key && msg.key.fromMe);
    const s = sesionDe(grupo, sock, remoteJid, !!grupoId);
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
      esAdminCarrera: async () => {
        try {
          return await conLimiteWhatsApp(ayudas.esAdministradorDelChat?.(jidReal, fromMe) ?? false, 'verificar al administrador');
        } catch (e) {
          if (anotar) anotar(e.message);
          return false;
        }
      },
      remitente: { jid: jidCrudo, jidReal, nombre: msg.pushName || telefonoDeParticipante(jidReal) }
    };
    try {
      await s.motor.procesarMensaje(mensaje);
    } catch (e) {
      console.error('[hipismoChat] Error al procesar un mensaje:', e);
      if (anotar) anotar('ERROR interno al procesar este mensaje: ' + (e && e.message));
      // Antes un error aquí dejaba al bot mudo sin explicación: ahora se avisa en el grupo (una vez por minuto).
      if (Date.now() - (s.ultimoAvisoError || 0) > 60000) {
        s.ultimoAvisoError = Date.now();
        await enviar(s, '⚠️ No pude procesar ese mensaje por un error interno. Avisa al administrador.', { citarId: idMsg });
      }
    }
  });
  return false;
}

// 19-11-2026: al renombrar/editar un cliente el bot olvida su lista de clientes en memoria (se vuelve a leer en la próxima jugada).
function olvidarClientes(grupoId) { cacheClientes.delete(grupoId); libreta.invalidar(grupoId); }

module.exports = { conLimiteWhatsApp, mensajesEnOrden, clientePorLibreta, olvidarClientes, cargarPizarraChat, eliminarJugadaEnEspera, listarAdministradores, _enviar: enviar, _ext: ext, intentar, autorizarAdminManual, registrarNumeroManual, _registrarNumeroManual: registrarNumeroManual, clientePorNumero, disponibleDe, guardarJugada, cargarJugadas, resolverHipodromo, TEXTO_PLANO_BOT, _sesiones: sesiones };
