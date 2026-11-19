// =================================================================
// PRUEBA: flujo "ERROR" del bot de Corredores (19-11-2026). Un cliente escribe "error" sobre su última jugada: el bot cita la jugada,
// etiqueta a los dos y le pregunta al otro si se la quita; repite el llamado cada 35 s (aquí 40 ms) hasta 3 veces; si dice SÍ se borra,
// si dice NO siguen jugando, si nadie responde se etiqueta a los administradores, y si la carrera se cierra siguen jugando.
// =================================================================
const path = require('path');
const m = require(path.join(__dirname, '..', 'src', 'services', 'hipismoJugadasChat'));
let pasaron = 0, fallaron = 0;
const check = (c, msg) => { if (c) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } };
const dormir = ms => new Promise(r => setTimeout(r, ms));

const ADM = '584141111111@s.whatsapp.net';
const CLIENTES = { j_cachaco: 'CACHACO', j_marvel: 'MARVEL', j_nana: 'NANA' };
const guardadas = [], borradas = [], enviadas = [], publicadas = [];
let contadorId = 0;
const deps = {
  nombreGrupo: 'Dream', hoy: () => '2026-11-19', esperaErrorMs: 40,
  identificar: async rem => CLIENTES[rem.jid] || null,
  resolverHipodromo: async t => (/belmont/i.test(t) ? 'Belmont Park' : null),
  disponible: async () => ({ limitado: false, disponible: 0 }),
  guardarJugada: async j => { const id = 'p' + (++contadorId); guardadas.push({ ...j, id }); return id; },
  eliminarJugada: async id => { borradas.push(id); return { ok: true }; },
  listarAdmins: async () => [{ jid: '584141111111@s.whatsapp.net', nombre: 'Admin' }],
  cargarJugadas: async () => [],
  responder: async (t, op) => { enviadas.push({ t, op }); },
  publicar: async t => { publicadas.push(t); }
};
const motor = m.crearMotor(deps);
let n = 0;
const msg = (jid, texto, extra) => ({ texto, id: 'id' + (++n), citadoId: null, remitente: { jid, nombre: jid.replace('j_', '') }, esAdmin: false, ...(extra || {}) });
const ultima = () => enviadas[enviadas.length - 1];
const conTexto = re => enviadas.filter(e => re.test(e.t));

async function jugar(quienPublica, quienResponde, texto, monto) {
  const of = msg(quienPublica, texto);
  await motor.procesarMensaje(of);
  const r = msg(quienResponde, String(monto), { citadoId: of.id });
  await motor.procesarMensaje(r);
  return { of, r };
}

(async function main() {
  await motor.procesarMensaje(msg(ADM, 'Belmont 5ta carrera', { esAdmin: true }));

  // ---------- "error" sin jugadas: no hace nada ----------
  let antes = enviadas.length;
  await motor.procesarMensaje(msg('j_nana', 'error'));
  check(enviadas.length === antes, '"error" de alguien que no tiene jugadas en la carrera: el bot no dice nada');

  // ---------- 1) el otro dice SÍ ----------
  const j1 = await jugar('j_cachaco', 'j_marvel', 'Juego 4x1 con 20 doy a8', 20);
  check(guardadas.length === 1 && guardadas[0].id === 'p1', 'la jugada se guardó y el motor conoce su id');
  await motor.procesarMensaje(msg('j_cachaco', 'ERROR'));
  let llamado = ultima();
  check(/^\*SALUDOS, AQUÍ EL TERCIO @@ MARCA ERROR, ¿SE LA QUITA\?\* @@2$/.test(llamado.t) && llamado.op.mencionar === 'j_cachaco' && llamado.op.mencionar2 === 'j_marvel', 'Cachaco escribe "error": el bot etiqueta a Cachaco (marca el error) y le pregunta a Marvel (@@2) si se la quita');
  check(llamado.op.citarId === j1.of.id, 'el llamado cita la jugada (el mensaje de la parada)');
  await motor.procesarMensaje(msg('j_nana', 'si'));
  check(borradas.length === 0, 'una tercera persona que dice "si" no borra nada');
  await motor.procesarMensaje(msg('j_marvel', 'Sí!'));
  check(borradas.join() === 'p1', 'Marvel responde "Sí": se borra la jugada p1');
  check(/^\*MUCHAS GRACIAS ESTIMADO TERCIO @@ QUE SE LA ESTÁ BORRANDO, AQUÍ NADA SE LA BORRARON\* @@2$/.test(ultima().t) && ultima().op.mencionar === 'j_marvel' && ultima().op.mencionar2 === 'j_cachaco', 'agradece al que la borra (@@ = Marvel) y etiqueta también a Cachaco (@@2)');
  const nLlamados = conTexto(/MARCA ERROR/).length;
  await dormir(150);
  check(conTexto(/MARCA ERROR/).length === nLlamados, 'resuelto el caso no se vuelve a llamar');
  await motor.procesarMensaje(msg(ADM, 'plano', { esAdmin: true }));
  check(!/Juega Cachaco/.test(publicadas[publicadas.length - 1]) && /Total jugadas: 0$/.test(publicadas[publicadas.length - 1]), 'el plano ya no trae la jugada borrada');

  // ---------- 2) el otro dice NO (marca el que da) ----------
  const j2 = await jugar('j_cachaco', 'j_marvel', 'Juego 4x1 con 30 doy a8', 30);
  await motor.procesarMensaje(msg('j_marvel', 'error'));
  llamado = ultima();
  check(/MARCA ERROR/.test(llamado.t) && llamado.op.mencionar === 'j_marvel' && llamado.op.mencionar2 === 'j_cachaco', 'Marvel marca error: se le pregunta a Cachaco (el otro de esa jugada)');
  await motor.procesarMensaje(msg('j_cachaco', 'No'));
  check(borradas.join() === 'p1' && /^\*VAN JUGANDO YA QUE @@ NO SE LA BORRÓ, LA JUGADA VA AL PLANO\* @@2$/.test(ultima().t) && ultima().op.mencionar === 'j_cachaco' && ultima().op.mencionar2 === 'j_marvel', 'Cachaco dice "No": van jugando, etiquetando a ambos, y la jugada sigue en el plano');

  // ---------- 3) nadie responde: 3 llamados y luego los administradores ----------
  const j3 = await jugar('j_cachaco', 'j_marvel', 'Juego 4x1 con 40 doy a8', 40);
  const antes3 = conTexto(/MARCA ERROR/).length;
  await motor.procesarMensaje(msg('j_cachaco', 'error'));
  await dormir(250);
  check(conTexto(/MARCA ERROR/).length - antes3 === 3, 'sin respuesta, el bot llama exactamente 3 veces');
  const esc = conTexto(/ATENCIÓN ADMINISTRADORES/);
  check(esc.length === 1 && /@@L$/.test(esc[0].t) && esc[0].op.mencionarLista.length === 1 && esc[0].op.mencionarLista[0].jid === '584141111111@s.whatsapp.net' && esc[0].op.mencionar === 'j_cachaco' && esc[0].op.mencionar2 === 'j_marvel', 'tras el 3er llamado se etiqueta a todos los administradores (y a los dos involucrados)');
  await dormir(150);
  check(conTexto(/ATENCIÓN ADMINISTRADORES/).length === 1 && conTexto(/MARCA ERROR/).length - antes3 === 3, 'no insiste más después de llamar a los administradores');
  await motor.procesarMensaje(msg(ADM, 'quitar', { esAdmin: true }));
  check(borradas.join() === 'p1,p3' && /UN ADMINISTRADOR AUTORIZÓ BORRAR LA JUGADA/.test(ultima().t), 'el administrador responde "quitar": se borra la jugada');

  // ---------- 4) un administrador decide "van jugando" ----------
  await jugar('j_cachaco', 'j_marvel', 'Juego 4x1 con 50 doy a8', 50);
  await motor.procesarMensaje(msg('j_marvel', 'error'));
  await dormir(250);
  await motor.procesarMensaje(msg(ADM, 'van jugando', { esAdmin: true }));
  check(borradas.join() === 'p1,p3' && /VAN JUGANDO POR DECISIÓN DEL ADMINISTRADOR/.test(ultima().t), 'el administrador dice "van jugando": la jugada se queda');

  // ---------- 5) la carrera se cierra con el llamado pendiente ----------
  const j5 = await jugar('j_cachaco', 'j_marvel', 'Juego 2p del 5 con 60', 60);
  await motor.procesarMensaje(msg('j_marvel', 'error'));
  const antes5 = conTexto(/MARCA ERROR/).length, escAntes = conTexto(/ATENCIÓN ADMINISTRADORES/).length;
  await motor.procesarMensaje(msg(ADM, 'cierra', { esAdmin: true }));
  check(conTexto(/LA CARRERA SE CERRÓ Y @@ NO SE LA BORRÓ, VAN JUGANDO/).length === 1, 'si se cierra la carrera con un llamado pendiente: "van jugando" etiquetando a ambos');
  await dormir(150);
  check(conTexto(/MARCA ERROR/).length === antes5 && conTexto(/ATENCIÓN ADMINISTRADORES/).length === escAntes, 'cerrada la carrera ya no se llama de nuevo ni se molesta a los administradores');
  check(borradas.join() === 'p1,p3', 'y no se borró nada');

  // ---------- 6) "error" citando una jugada concreta ----------
  await motor.procesarMensaje(msg(ADM, 'Belmont 6ta carrera', { esAdmin: true }));
  const a = await jugar('j_cachaco', 'j_marvel', 'Juego 4x1 con 11 doy a8', 11);
  await jugar('j_cachaco', 'j_marvel', 'Juego 4x1 con 12 doy a8', 12);
  await motor.procesarMensaje(msg('j_cachaco', 'error', { citadoId: a.of.id }));
  check(ultima().op.citarId === a.of.id, 'si cita su primera jugada, el llamado es por ESA jugada (no la última)');
  await motor.procesarMensaje(msg('j_marvel', 'dale'));
  check(borradas[borradas.length - 1] === guardadas.find(g => g.monto === 11).id, 'y al aceptar se borra esa misma');

  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
