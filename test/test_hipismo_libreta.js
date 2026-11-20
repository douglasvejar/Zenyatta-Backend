// =================================================================
// PRUEBA: libreta de contactos (20-11-2026). El teléfono guardado en la ficha del cliente hace que el bot lo reconozca aunque WhatsApp
// oculte su número (@lid), sin pedir "registrar" en el chat. Base de datos y WhatsApp falsos.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const T = {
  jugadores: [
    { nombre: 'MARVEL', telefono: '0412-4537732' }, { nombre: 'NANA', telefono: '58 424 1746628' },
    { nombre: 'RICARDO', telefono: '+1 (904) 767-0886' }, { nombre: 'SIN TELEFONO', telefono: '' }
  ],
  numeros: []
};
function consulta(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT nombre, telefono FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: T.jugadores.filter(j => j.telefono) };
  if (/^SELECT digitos, jugador_nombre FROM hipismo_chat_numeros WHERE grupo_id = \$1/i.test(sql)) return { rows: T.numeros };
  throw new Error('consulta no prevista: ' + sql);
}
const fakePool = function () { return { query: async (t, p) => consulta(t, p), connect: async () => ({ query: async (t, p) => consulta(t, p), release() {} }), on() {} }; };
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
const glue = require(path.join(__dirname, '..', 'src', 'services', 'hipismoJugadasChatBot'));
const libreta = require(path.join(__dirname, '..', 'src', 'services', 'hipismoLibreta'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
const check = (c, m) => { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } };

// WhatsApp falso: conoce a MARVEL (con código oculto) y a NANA; RICARDO no tiene WhatsApp.
let consultas = 0;
const sock = {
  onWhatsApp: async (...numeros) => {
    consultas++;
    const base = { '584124537732': { jid: '584124537732@s.whatsapp.net', exists: true, lid: '11122233344455@lid' }, '584241746628': { jid: '584241746628@s.whatsapp.net', exists: true, lid: '99988877766655@lid' } };
    return numeros.filter(n => base[n]).map(n => base[n]);
  }
};
const G = 'gLibreta';

(async () => {
  // 1) formatos de teléfono de la ficha
  check(JSON.stringify(libreta._candidatos('0412-4537732')) === '["584124537732"]', '0412-… se pasa a formato internacional (58412…)');
  check(JSON.stringify(libreta._candidatos('4124537732')) === '["584124537732"]', '412… sin cero también');
  check(JSON.stringify(libreta._candidatos('+58 424 1746628')) === '["584241746628"]', '+58 … queda igual');
  check(JSON.stringify(libreta._candidatos('+1 (904) 767-0886')) === '["19047670886"]', 'un número de otro país queda como está');
  check(libreta._candidatos('123').length === 0 && libreta._candidatos('').length === 0, 'un teléfono muy corto o vacío no se consulta');

  // 2) un remitente @lid que ninguna ficha tiene "tal cual" se reconoce por la libreta
  check(await glue.clientePorLibreta(G, sock, ['11122233344455@lid']) === 'MARVEL', 'el código oculto de MARVEL se reconoce por el teléfono de su ficha');
  check(await glue.clientePorLibreta(G, sock, ['99988877766655@lid']) === 'NANA', 'el código oculto de NANA también (sin volver a preguntar a WhatsApp)');
  check(consultas === 1, 'WhatsApp se consultó una sola vez para todas las fichas (' + consultas + ')');
  check(libreta.jidDe(G, 'MARVEL') === '584124537732@s.whatsapp.net', 'se sabe con qué jid etiquetar a MARVEL aunque no haya escrito');

  // 3) el teléfono real (cuando WhatsApp sí lo muestra) también funciona, con formatos distintos
  check(await glue.clientePorLibreta(G, sock, ['584124537732:7@s.whatsapp.net']) === 'MARVEL', 'el teléfono real con :dispositivo se reconoce');

  // 4) un desconocido no se confunde con nadie y no satura a WhatsApp
  check(await glue.clientePorLibreta(G, sock, ['5551112223334@lid']) === null, 'un código desconocido sigue sin cliente (se le pedirá registrar)');
  const antes = consultas;
  await glue.clientePorLibreta(G, sock, ['5551112223335@lid']);
  check(consultas === antes, 'otro desconocido inmediato no vuelve a consultar a WhatsApp (espera mínima)');

  // 5) sin WhatsApp conectado, o si WhatsApp falla: no lanza error, queda como antes
  check(await glue.clientePorLibreta(G, null, ['11122233344455@lid']) === null, 'sin WhatsApp conectado devuelve null sin fallar');
  libreta.invalidar('gFalla');
  const roto = { onWhatsApp: async () => { throw new Error('sin conexión'); } };
  check(await glue.clientePorLibreta('gFalla', roto, ['11122233344455@lid']) === null, 'si WhatsApp falla devuelve null sin fallar');
  // aunque falle, el teléfono real de la ficha igual se reconoce (no depende de WhatsApp)
  libreta.invalidar('gFalla2');
  check(await glue.clientePorLibreta('gFalla2', roto, ['584241746628@s.whatsapp.net']) === 'NANA', 'si WhatsApp falla, el teléfono real igual coincide con la ficha');

  // 6) cambiar una ficha invalida la libreta (olvidarClientes) y se vuelve a armar con el teléfono nuevo
  T.jugadores[0].telefono = '0414-9998877';
  glue.olvidarClientes(G);
  const sock2 = { onWhatsApp: async (...n) => n.filter(x => x === '584149998877').map(x => ({ jid: x + '@s.whatsapp.net', exists: true, lid: '77777777777777@lid' })) };
  check(await glue.clientePorLibreta(G, sock2, ['11122233344455@lid']) === null, 'el código del teléfono viejo ya no es de MARVEL');
  libreta.invalidar(G);
  check(await glue.clientePorLibreta(G, sock2, ['77777777777777@lid']) === 'MARVEL', 'con el teléfono nuevo MARVEL se reconoce');

  // 7) una ficha borrada no queda en la libreta
  T.jugadores.splice(0, 1);
  glue.olvidarClientes(G);
  check(await glue.clientePorLibreta(G, sock2, ['77777777777777@lid']) === null, 'una ficha borrada deja de reconocerse');

  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
