// =================================================================
// PRUEBA: comando "link <cliente>" por Telegram (17-11-2026) — el administrador pide el link de saldo de un
// cliente de Hipismo y el bot responde con el mensaje completo + link. Base y cliente de Telegram falsos.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const G1 = 'g1', G2 = 'g2';
const CHAT1 = -1001, CHAT2 = -1002, CENTRAL = -1999;
const TABLAS = {
  grupos: [
    { id: G1, nombre: 'Grupo Los Vaqueros', activo: true, telegram_habilitado: true, telegram_chat_id: String(CHAT1), modulo_hipismo_habilitado: true, modulo_hipismo_oficinas_habilitado: false, funciones_habilitadas: null },
    { id: G2, nombre: 'Grupo Sin Link', activo: true, telegram_habilitado: true, telegram_chat_id: String(CHAT2), modulo_hipismo_habilitado: true, modulo_hipismo_oficinas_habilitado: false, funciones_habilitadas: ['hip_clientes'] },
    { id: 'g3', nombre: 'Solo Deportes', activo: true, telegram_habilitado: true, telegram_chat_id: '-1003', modulo_hipismo_habilitado: false, modulo_hipismo_oficinas_habilitado: false, funciones_habilitadas: null }
  ],
  jugadores: [
    { id: 'j1', grupo_id: G1, nombre: 'PEDRO PÉREZ', token: 'tok-pedro', activo: true },
    { id: 'j2', grupo_id: G1, nombre: 'PEDRO MARTÍNEZ', token: 'tok-pedro-m', activo: true },
    { id: 'j3', grupo_id: G1, nombre: 'MARÍA', token: 'tok-maria', activo: true },
    { id: 'j4', grupo_id: G1, nombre: 'LUIS', token: 'tok-luis', activo: true },
    { id: 'j5', grupo_id: G1, nombre: 'LUISA', token: 'tok-luisa', activo: true },
    { id: 'j6', grupo_id: G2, nombre: 'MARÍA', token: 'tok-otro-grupo', activo: true },
    { id: 'j7', grupo_id: 'g3', nombre: 'JUAN', token: 'tok-juan', activo: true }
  ]
};
function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM grupos WHERE id = \$1/i.test(sql)) return { rows: TABLAS.grupos.filter(g => g.id === params[0]) };
  if (/^SELECT id, nombre, token, activo FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT id FROM grupos WHERE telegram_chat_id = \$1 AND telegram_habilitado = true/i.test(sql)) {
    const f = TABLAS.grupos.find(g => g.telegram_chat_id === params[0] && g.telegram_habilitado);
    return { rows: f ? [{ id: f.id }] : [] };
  }
  if (/^SELECT id, nombre FROM grupos WHERE telegram_habilitado = true AND activo = true/i.test(sql)) {
    return { rows: TABLAS.grupos.filter(g => g.telegram_habilitado && g.activo).map(g => ({ id: g.id, nombre: g.nombre })) };
  }
  if (/^SELECT id FROM grupos WHERE id = \$1 AND telegram_habilitado = true/i.test(sql)) {
    const f = TABLAS.grupos.find(g => g.id === params[0] && g.telegram_habilitado);
    return { rows: f ? [{ id: f.id }] : [] };
  }
  throw new Error('BD falsa: consulta no prevista: ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
Module._load = function (request) { if (request === 'pg') return { Pool: fakePool }; return originalLoad.apply(this, arguments); };
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.TELEGRAM_CENTRAL_CHAT_ID = String(CENTRAL);
process.env.PUBLIC_BASE_URL = 'https://ejemplo.test/';
delete process.env.RAILWAY_PUBLIC_DOMAIN;

const { detectarComando } = require(path.join(__dirname, '..', 'src', 'services', 'whatsappTrigger'));
const link = require(path.join(__dirname, '..', 'src', 'services', 'linkClienteChat'));
const telegramBot = require(path.join(__dirname, '..', 'src', 'services', 'telegramBot'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
const check = (c, m) => { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } };

const ADMIN = { id: 1, first_name: 'Dueño', is_bot: false };
const MIEMBRO = { id: 2, first_name: 'Cliente', is_bot: false };
let uid = 1;
const upd = (texto, { chat = CHAT1, from = ADMIN } = {}) => ({ update_id: uid++, message: { message_id: uid, chat: { id: chat, type: 'supergroup' }, from, text: texto } });
function api() {
  const enviados = [];
  return { enviados, enviarTexto: async (c, t) => { enviados.push({ chat: String(c), texto: t }); }, esAdministrador: async (c, u) => u === 1 };
}

(async function main() {
  // --- detección del comando ---
  check(JSON.stringify(detectarComando('link pedro')) === '{"tipo":"link_cliente","nombre":"pedro"}', 'detecta "link pedro"');
  check(detectarComando('Link  MARÍA  López') && detectarComando('Link  MARÍA  López').nombre === 'maria lopez', 'ignora mayúsculas/espacios dobles');
  check(detectarComando('/link@mi_bot luis') && detectarComando('/link@mi_bot luis').tipo === 'link_cliente', 'detecta "/link@bot nombre"');
  check(detectarComando('link') === null && detectarComando('linkear algo') === null && detectarComando('hola link pedro') === null, 'no confunde "link" solo, "linkear" ni frases con "link" en medio');
  check(detectarComando('saldo final').tipo === 'saldo_dia' && detectarComando('act').tipo === 'actualizar_sabana', 'los comandos de antes siguen igual');

  // --- armado directo ---
  let t = await link.responderLinkCliente(G1, 'maria');
  check(t.includes('en su grupo Grupo Los Vaqueros') && t.includes('Balance del jugador MARÍA en su grupo de confianza Grupo Los Vaqueros 🐎🐎🐎💰💰💰') && t.endsWith('https://ejemplo.test/hipismo-cliente-portal.html?token=tok-maria'),
    'mensaje completo idéntico al de "Copiar link" (sin tildes, y sin doble barra en la dirección)');
  check(!t.includes('tok-otro-grupo'), 'no mezcla clientes de otro grupo (MARÍA del otro grupo)');
  t = await link.responderLinkCliente(G1, 'luis');
  check(t.includes('token=tok-luis') && !t.includes('tok-luisa'), 'el nombre exacto gana sobre los parecidos (LUIS vs LUISA)');
  t = await link.responderLinkCliente(G1, 'pedro');
  check(/varios clientes/.test(t) && t.includes('PEDRO PÉREZ') && t.includes('PEDRO MARTÍNEZ') && !t.includes('token='), 'si hay varios, lista los nombres y no manda ningún link');
  t = await link.responderLinkCliente(G1, 'pedro perez');
  check(t.includes('token=tok-pedro') && t.includes('jugador PEDRO PÉREZ'), 'con el nombre completo (sin tildes) sí lo encuentra');
  t = await link.responderLinkCliente(G1, 'zzz');
  check(/No encontré ningún cliente llamado "zzz"/.test(t), 'cliente inexistente: lo dice');
  t = await link.responderLinkCliente(G2, 'maria');
  check(/Link del cliente.*no está activado/.test(t) && !t.includes('token='), 'grupo con "Link del cliente" apagado: no manda link');
  t = await link.responderLinkCliente('g3', 'juan');
  check(/módulo de Hipismo no está activo/.test(t), 'grupo sin Hipismo: no manda link');
  const base = process.env.PUBLIC_BASE_URL; delete process.env.PUBLIC_BASE_URL;
  t = await link.responderLinkCliente(G1, 'luis');
  check(/PUBLIC_BASE_URL/.test(t) && !t.includes('token='), 'sin dirección pública configurada: avisa qué falta');
  process.env.RAILWAY_PUBLIC_DOMAIN = 'mi-app.up.railway.app';
  t = await link.responderLinkCliente(G1, 'luis');
  check(t.endsWith('https://mi-app.up.railway.app/hipismo-cliente-portal.html?token=tok-luis'), 'usa RAILWAY_PUBLIC_DOMAIN si no hay PUBLIC_BASE_URL');
  delete process.env.RAILWAY_PUBLIC_DOMAIN; process.env.PUBLIC_BASE_URL = base;

  // --- por Telegram ---
  let a = api(); let ctx = telegramBot._usarCliente(a);
  await telegramBot.manejarActualizacion(upd('link luis'), ctx);
  check(a.enviados.length === 1 && a.enviados[0].chat === String(CHAT1) && a.enviados[0].texto.endsWith('token=tok-luis'), 'administrador escribe "link luis" en el grupo vinculado: el bot responde con el mensaje + link');
  a = api(); ctx = telegramBot._usarCliente(a);
  await telegramBot.manejarActualizacion(upd('/link@mi_bot maria'), ctx);
  check(a.enviados.length === 1 && a.enviados[0].texto.endsWith('token=tok-maria'), '"/link@bot maria" también funciona');
  a = api(); ctx = telegramBot._usarCliente(a);
  await telegramBot.manejarActualizacion(upd('link luis', { from: MIEMBRO }), ctx);
  check(a.enviados.length === 0, 'un miembro que no es administrador: el bot no responde nada');
  await telegramBot.manejarActualizacion(upd('/link luis', { from: MIEMBRO }), ctx);
  check(a.enviados.length === 0, '"/link" de un no administrador tampoco responde');
  a = api(); ctx = telegramBot._usarCliente(a);
  await telegramBot.manejarActualizacion(upd('link luis', { chat: -5555 }), ctx);
  check(a.enviados.length === 0, 'en un chat que no está vinculado a ningún grupo: no responde');
  a = api(); ctx = telegramBot._usarCliente(a);
  await telegramBot.manejarActualizacion(upd('link maria', { chat: CHAT2 }), ctx);
  check(a.enviados.length === 1 && /no está activado/.test(a.enviados[0].texto) && !a.enviados[0].texto.includes('tok-maria'), 'el grupo 2 solo ve sus propios clientes/avisos (aislado del grupo 1)');
  a = api(); ctx = telegramBot._usarCliente(a);
  await telegramBot.manejarActualizacion(upd('Grupo Los Vaqueros\nlink luis', { chat: CENTRAL }), ctx);
  check(a.enviados.length === 1 && a.enviados[0].chat === String(CENTRAL) && /LOS VAQUEROS/.test(a.enviados[0].texto) && a.enviados[0].texto.includes('token=tok-luis'), 'en el grupo central, con el nombre del grupo en la primera línea, también funciona');

  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
