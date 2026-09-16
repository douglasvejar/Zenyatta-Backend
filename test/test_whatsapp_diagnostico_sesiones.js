// =================================================================
// PRUEBA: diagnosticarSesionesGrupo() — "¿quién está trabando el envío?"
// (16-09-2026, a partir del detalle REAL de "not-acceptable" que el
// usuario copió con el botón "📋 Copiar detalle del error" y pasó al chat):
//
//   Mensaje: not-acceptable
//   Detalle técnico: { "statusCode": 500, "data": 406,
//     "stack": "...at assertSessions (.../messages-send.js:182:28)..." }
//
// Se revisó el código fuente real de Baileys (la versión v6.7.9 que usa
// este proyecto y también la más nueva disponible, v7.0.0-rc14) para
// confirmar de dónde sale esto: assertSessions() (expuesta en el propio
// `sock` que devuelve makeWASocket) junta a TODOS los participantes del
// grupo que necesitan una sesión cifrada nueva en UN SOLO pedido a
// WhatsApp — si el servidor rechaza ese pedido para UNO SOLO de esos
// números, el pedido ENTERO se cae con "not-acceptable" (código 406) y el
// mensaje no se manda a NADIE del grupo. Esto sigue igual en la versión
// más nueva de Baileys — no es algo que actualizar la librería arregle.
//
// *** SIN FORMA DE PROBAR ESTO CONTRA WHATSAPP REAL (ver la advertencia
// grande al principio de whatsappBot.js) *** — lo que SÍ se puede probar
// de verdad, sin necesitar @whiskeysockets/baileys instalado, es que
// diagnosticarSesionesGrupo() bisecciona bien: prueba sock.assertSessions
// UNO POR UNO para cada participante (nunca en un solo lote, que es
// justamente el problema), junta a los que fallan con su número ya
// extraído del jid, se salta al propio bot, y nunca revienta sin sock/jid.
// =================================================================
const assert = require('assert');
const Module = require('module');

// "pg" no está instalado en este sandbox (ver la nota grande en
// test_wiring.js) — whatsappBot.js requiere src/db.js a nivel de módulo,
// así que hace falta el mismo Pool falso que ya usa el resto de las
// pruebas de este archivo para poder ni siquiera cargarlo.
const originalLoad = Module._load;
const fakePool = function () {
  this.query = async () => ({ rows: [] });
  this.connect = async () => ({ query: async () => ({ rows: [] }), release() {} });
  this.on = () => {};
};
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};

process.env.DATABASE_URL = 'postgresql://fake/fake';

const { diagnosticarSesionesGrupo } = require('../src/services/whatsappBot');

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

async function testTodosLosParticipantesSinProblema() {
  const JID = '120363200656782643@g.us';
  const probados = [];
  const sockFalso = {
    user: { id: '58412000@s.whatsapp.net' },
    groupMetadata: async () => ({
      subject: 'Parleys VIP',
      participants: [{ id: '584121111111@s.whatsapp.net' }, { id: '584122222222@s.whatsapp.net' }]
    }),
    assertSessions: async (jids) => { probados.push(jids); return true; }
  };

  const r = await diagnosticarSesionesGrupo(sockFalso, JID);
  check(r.grupoNombre === 'Parleys VIP', 'devuelve el nombre del grupo (viene de groupMetadata)');
  check(r.totalParticipantes === 2, 'cuenta bien el total de participantes del grupo');
  check(r.revisados === 2, 'revisó a los 2 (ninguno es el propio bot)');
  check(r.sinProblema === 2, 'si assertSessions nunca falla, los 2 quedan sin problema');
  check(r.conProblema.length === 0, 'y la lista de números con problema queda vacía');
  check(probados.length === 2 && probados[0].length === 1, 'prueba a CADA participante UNO POR UNO (un solo jid por llamada) — nunca en un solo lote, que es justo lo que hace fallar el envío real');
}

async function testSeñalaAlParticipanteQueFalla() {
  const JID = '120363200656782643@g.us';
  const sockFalso = {
    user: { id: '58412000@s.whatsapp.net' },
    groupMetadata: async () => ({
      subject: 'Parleys VIP',
      participants: [
        { id: '584121111111@s.whatsapp.net' },
        { id: '584129999999@s.whatsapp.net' }, // este es el que "se borró de WhatsApp"
        { id: '584123333333@s.whatsapp.net' }
      ]
    }),
    assertSessions: async (jids) => {
      if (jids[0] === '584129999999@s.whatsapp.net') {
        const e = new Error('not-acceptable');
        e.data = 406;
        throw e;
      }
      return true;
    }
  };

  const r = await diagnosticarSesionesGrupo(sockFalso, JID);
  check(r.sinProblema === 2, 'los 2 participantes buenos quedan sin problema');
  check(r.conProblema.length === 1, 'el participante que falla queda señalado, solo, sin arrastrar a los demás');
  check(r.conProblema[0].jid === '584129999999@s.whatsapp.net', 'con su jid completo');
  check(r.conProblema[0].numero === '584129999999', 'y también el número ya extraído (sin "@s.whatsapp.net"), listo para mostrar en el panel');
  check(r.conProblema[0].mensaje === 'not-acceptable', 'y el mensaje real del error de ESE participante puntual');
}

async function testSeSaltaAlPropioBot() {
  const JID = '120363200656782643@g.us';
  let seProbóAlPropioBot = false;
  const sockFalso = {
    user: { id: '58412000:5@s.whatsapp.net' }, // con sufijo de dispositivo, como lo da Baileys de verdad
    groupMetadata: async () => ({
      subject: 'Grupo',
      participants: [
        { id: '58412000@s.whatsapp.net' }, // el propio bot, tal cual aparece en la lista de participantes (sin el ":5")
        { id: '584121111111@s.whatsapp.net' }
      ]
    }),
    assertSessions: async (jids) => {
      if (jids[0] === '58412000@s.whatsapp.net') seProbóAlPropioBot = true;
      return true;
    }
  };

  const r = await diagnosticarSesionesGrupo(sockFalso, JID);
  check(!seProbóAlPropioBot, 'nunca se prueba la sesión contra sí mismo (no tiene sentido y sería un pedido de más)');
  check(r.revisados === 1, 'el total revisado no cuenta al propio bot, aunque esté en la lista de participantes');
}

async function testNuncaRevientaSinSockOSinJid() {
  await assert.rejects(diagnosticarSesionesGrupo(null, '120363@g.us'), /conexión activa/, 'sin sock: rechaza con un mensaje claro, no un error críptico');
  await assert.rejects(diagnosticarSesionesGrupo({ groupMetadata: async () => ({ participants: [] }) }, null), /jid/, 'sin jid: rechaza con un mensaje claro');
  check(true, 'diagnosticarSesionesGrupo() nunca revienta feo sin sock/jid — siempre con un Error claro que el panel puede mostrar');
}

(async () => {
  await testTodosLosParticipantesSinProblema();
  await testSeñalaAlParticipanteQueFalla();
  await testSeSaltaAlPropioBot();
  await testNuncaRevientaSinSockOSinJid();

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exitCode = fallaron > 0 ? 1 : 0;
})();
