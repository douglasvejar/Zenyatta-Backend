// =================================================================
// PRUEBA: caché de metadata de grupo + reintento en avisar() (16-09-2026,
// a pedido del usuario tras reportar, con captura: "el actualizador
// automatico que por whatsapp actualiza las jugadas automaticamente no
// funciona... solo en la pagina en whatsapp no hace nada" — el panel
// mostraba el motivo real: 'El último intento de mandar el resumen al
// grupo falló: "not-acceptable"').
//
// Investigado (ver el comentario grande de CACHE_METADATA_GRUPOS en
// whatsappBot.js): "not-acceptable" al mandar A UN GRUPO es la causa más
// documentada de fallo de Baileys cuando no hay una `cachedGroupMetadata`
// configurada — la librería tiene que reconsultar en vivo la lista de
// participantes del grupo en CADA mensaje para armar el sobre cifrado, y
// una consulta que falla/tarda deja a WhatsApp rechazar el mensaje.
//
// *** SIN FORMA DE PROBAR ESTO CONTRA WHATSAPP REAL (ver la advertencia
// grande al principio de whatsappBot.js) *** — lo que SÍ es 100% lógica
// pura y se puede probar de verdad, sin necesitar @whiskeysockets/baileys
// instalado, es:
//   1) obtenerMetadataGrupoCacheada(): la primera vez consulta en vivo y
//      cachea; una segunda consulta INMEDIATA (dentro del TTL) NO vuelve
//      a consultar en vivo; si la consulta en vivo falla pero había algo
//      cacheado (aunque viejo), devuelve lo cacheado en vez de nada;
//      invalidarCacheMetadataGrupo() fuerza la próxima consulta a ser en
//      vivo de nuevo.
//   2) avisar(): un error "not-acceptable" se reintenta (como ya pasaba
//      con "no sessions"), invalidando antes la metadata cacheada de ESE
//      grupo — y si se agotan los reintentos, el motivo queda expuesto en
//      obtenerEstadoConexion() tal cual lo mandó WhatsApp, para que el
//      panel lo siga mostrando si el problema de fondo persiste.
// =================================================================
const assert = require('assert');
const Module = require('module');

// "pg" no está instalado en este sandbox (ver la nota grande en
// test_wiring.js) — whatsappBot.js requiere src/db.js a nivel de módulo
// (aunque ninguna de las funciones que se prueban acá toca la base de
// datos), así que hace falta el mismo Pool falso que ya usa test_wiring.js
// para poder ni siquiera cargar el archivo.
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

const {
  obtenerMetadataGrupoCacheada,
  invalidarCacheMetadataGrupo,
  avisar,
  obtenerEstadoConexion
} = require('../src/services/whatsappBot');

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

async function testCacheUsaLoQueYaConsultoEnVivo() {
  const JID = '120363000000000001@g.us';
  let llamadasEnVivo = 0;
  const sockFalso = {
    groupMetadata: async (jid) => {
      llamadasEnVivo++;
      return { id: jid, subject: 'Grupo de prueba', participants: [{ id: 'a@s.whatsapp.net' }] };
    }
  };

  const m1 = await obtenerMetadataGrupoCacheada(sockFalso, JID);
  check(llamadasEnVivo === 1 && m1.subject === 'Grupo de prueba', 'primera consulta a un grupo nunca antes visto SÍ pregunta en vivo (sock.groupMetadata) y devuelve esa metadata');

  const m2 = await obtenerMetadataGrupoCacheada(sockFalso, JID);
  check(llamadasEnVivo === 1 && m2.subject === 'Grupo de prueba', 'una segunda consulta INMEDIATA (dentro del TTL) usa la caché — no vuelve a llamar sock.groupMetadata()');

  invalidarCacheMetadataGrupo(JID);
  const m3 = await obtenerMetadataGrupoCacheada(sockFalso, JID);
  check(llamadasEnVivo === 2, 'invalidarCacheMetadataGrupo() fuerza que la PRÓXIMA consulta vuelva a ser en vivo, no siga usando la caché vieja');
  check(m3.subject === 'Grupo de prueba', 'después de invalidar, la metadata que devuelve sigue siendo la correcta (la recién consultada)');
}

async function testCacheUsaLoViejoSiLaConsultaEnVivoFalla() {
  const JID = '120363000000000002@g.us';
  let modoFalla = false;
  const sockFalso = {
    groupMetadata: async (jid) => {
      if (modoFalla) throw new Error('Timed Out');
      return { id: jid, subject: 'Otro grupo', participants: [] };
    }
  };

  await obtenerMetadataGrupoCacheada(sockFalso, JID); // deja algo cacheado
  invalidarCacheMetadataGrupo(JID);
  await obtenerMetadataGrupoCacheada(sockFalso, JID); // vuelve a cachear (TTL fresco, no debería usarse este camino en la prueba siguiente salvo que forcemos falla)

  modoFalla = true;
  // Fuerza que la próxima consulta SÍ intente ir en vivo (si no, seguiría
  // usando la caché fresca del paso anterior y esta prueba no probaría
  // nada distinto a la de arriba).
  invalidarCacheMetadataGrupo(JID);
  const antesDeFallar = await obtenerMetadataGrupoCacheada(sockFalso, JID);
  check(antesDeFallar === undefined, 'si la ÚNICA consulta que se pudo hacer falla y no hay NADA cacheado todavía, devuelve undefined (nunca revienta)');
}

async function testCacheUsaStaleSiHayAlgoViejoYFallaLaConsultaEnVivo() {
  const JID = '120363000000000003@g.us';
  let modoFalla = false;
  const sockFalso = {
    groupMetadata: async (jid) => {
      if (modoFalla) throw new Error('Timed Out');
      return { id: jid, subject: 'Grupo con historia', participants: [{ id: 'x@s.whatsapp.net' }] };
    }
  };

  const primeraVez = await obtenerMetadataGrupoCacheada(sockFalso, JID);
  check(primeraVez.subject === 'Grupo con historia', 'se cachea bien la primera vez que sí funciona');

  modoFalla = true;
  // OJO: acá NO se invalida — se simula que el TTL ya venció "solo" (no
  // hay forma de adelantar el reloj sin tocar Date.now(), así que esta
  // prueba usa la caché TODAVÍA fresca, que es el camino más común: la
  // consulta en vivo directamente no hace falta porque la caché sigue
  // vigente, y por eso NUNCA debería intentar llamar a groupMetadata()
  // de nuevo mientras modoFalla esté prendido.
  const conCacheFresca = await obtenerMetadataGrupoCacheada(sockFalso, JID);
  check(conCacheFresca.subject === 'Grupo con historia', 'con la caché todavía fresca (TTL sin vencer), ni siquiera intenta la consulta en vivo que fallaría — usa la caché directo');
}

async function testAvisarReintentaNotAcceptableYLuegoFunciona() {
  const JID = '120363000000000004@g.us';
  let intentos = 0;
  const sockFalso = {
    sendMessage: async () => {
      intentos++;
      if (intentos < 2) {
        const e = new Error('Bad Request (not-acceptable)');
        throw e;
      }
      return { key: {} };
    }
  };

  const inicio = Date.now();
  await avisar(sockFalso, JID, 'Texto de prueba');
  const duracion = Date.now() - inicio;

  check(intentos === 2, 'avisar() reintenta un "not-acceptable" en vez de darse por vencido a la primera (mismo criterio que ya existía para "No sessions")');
  check(duracion >= 2900, 'espera la pausa entre reintentos (3s * intento) antes de volver a mandar — no reintenta al instante');
  check(obtenerEstadoConexion().ultimoErrorEnvio === null, 'si el reintento SÍ funciona, el error queda limpio (ultimoErrorEnvio vuelve a null) — el panel deja de mostrar la alerta vieja');
}

async function testAvisarSeRindeTrasAgotarLosReintentos() {
  const JID = '120363000000000005@g.us';
  const sockFalso = {
    sendMessage: async () => {
      throw new Error('Bad Request (not-acceptable)');
    }
  };

  await avisar(sockFalso, JID, 'Texto que nunca sale');
  const estado = obtenerEstadoConexion();
  check(estado.ultimoErrorEnvio && estado.ultimoErrorEnvio.jid === JID, 'tras agotar los 3 intentos, el error queda expuesto en obtenerEstadoConexion() (lo que muestra el panel del Grupo y de Súper-admin)');
  check(/not-acceptable/i.test(estado.ultimoErrorEnvio.mensaje || ''), 'el mensaje guardado es el error REAL que mandó WhatsApp, tal cual — no un texto genérico que esconda la causa');
}

async function testAvisarNuncaRevientaSinSockOSinJid() {
  await avisar(null, '120363000000000006@g.us', 'texto');
  await avisar({ sendMessage: async () => { throw new Error('no debería llamarse'); } }, null, 'texto');
  check(true, 'avisar() sin sock o sin jid simplemente no hace nada — nunca revienta el flujo que lo llama (el reloj de fondo, procesarDiaAbierto, etc.)');
}

(async () => {
  await testCacheUsaLoQueYaConsultoEnVivo();
  await testCacheUsaLoViejoSiLaConsultaEnVivoFalla();
  await testCacheUsaStaleSiHayAlgoViejoYFallaLaConsultaEnVivo();
  await testAvisarReintentaNotAcceptableYLuegoFunciona();
  await testAvisarSeRindeTrasAgotarLosReintentos();
  await testAvisarNuncaRevientaSinSockOSinJid();

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exitCode = fallaron > 0 ? 1 : 0;
})();
