// =================================================================
// PRUEBA: bot de jugadas del chat de Hipismo (17-11-2026) — con los mensajes REALES del video del grupo AMERICANAS DREAM.
// Motor puro: todo lo externo (clientes, pozo, guardado, respuestas) va con piezas falsas.
// =================================================================
const path = require('path');
const m = require(path.join(__dirname, '..', 'src', 'services', 'hipismoJugadasChat'));

let pasaron = 0, fallaron = 0;
const check = (c, msg) => { if (c) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) === JSON.stringify(b) ? '' : '  -> obtuve ' + JSON.stringify(a)));

// ---------- 1) Leer ofertas ----------
let o = m.interpretarOferta('Juego 4x1 con 75 doy a8');
check(o.ok && o.lado === 'doy' && o.monto === 75 && JSON.stringify(o.apuesta.cruce) === '{"gruposA":[4],"gruposB":[1]}' && o.apuesta.modalidad === '10a8', '"Juego 4x1 con 75 doy a8": juega el que publica, 4 contra 1, 10a8, monto 75');
o = m.interpretarOferta('Juego 4x5 recibo a 8 200');
check(o.ok && o.lado === 'recibo' && o.monto === 200 && o.apuesta.modalidad === '10a8' && JSON.stringify(o.apuesta.cruce) === '{"gruposA":[4],"gruposB":[5]}', '"Juego 4x5 recibo a 8 200": recibe, monto 200 (el monto va solo al final)');
o = m.interpretarOferta('Juego 2y2 y 2p del 5 con 40');
check(o.ok && JSON.stringify(o.apuesta.grupo) === '[5]' && o.apuesta.modalidad === '2y2-2p' && o.monto === 40, '"Juego 2y2 y 2p del 5 con 40": combo 2y2 + 2p del caballo 5');
eq(m.interpretarOferta('Juego 2 y 3n del 6 120'), m.interpretarOferta('Juego 2p y 3n del 6 con 120'), 'la y separada permite abreviar 2p');
o = m.interpretarOferta('Juego  2 y 2n del 4 con 100&#x20;');
check(o.ok && o.apuesta.modalidad === '2y2' && o.apuesta.grupo[0] === 4 && o.monto === 100, '2 y 2n se lee como 2y2 del 4 con 100');
const pagoSegundo = require('../src/services/hipismoCalc').resolverModalidad(o.apuesta.modalidad, 2);
check(pagoSegundo.j * o.monto === 50, 'si el 4 llega segundo, el jugador gana 50 sobre 100 antes de comisión');
o = m.interpretarOferta('Juego 2y3n del 6 120');
check(o.ok && o.apuesta.modalidad === '2y3n', 'la modalidad escrita junta 2y3n conserva su significado');
for (const parada of ['juego 100 1p 1y2 del 3&#x20;', 'juego 100 1y2 1p del 3', 'juego 100 1y2/1p del 3&#x20;']) {
  const oferta = m.interpretarOferta(parada);
  check(oferta.ok && oferta.monto === 100 && oferta.apuesta.grupo[0] === 3 &&
    oferta.apuesta.modalidad.split('-').sort().join('/') === '1p/1y2', parada + ' reparte 100 entre 1p y 1y2 del 3');
}
check(m.interpretarOferta('juego 100 1/2 del 3').apuesta.modalidad === '1/2', 'la modalidad individual 1/2 mantiene su significado');
o = m.interpretarOferta('Juego 4x1 10@8 con 60');
check(o.ok && o.apuesta.modalidad === '10a8' && o.monto === 60 && o.lado === 'doy', '"10@8" es lo mismo que 10a8');
o = m.interpretarOferta('Juego 4 x 1 10a8 con 120');
check(o.ok && JSON.stringify(o.apuesta.cruce) === '{"gruposA":[4],"gruposB":[1]}' && o.monto === 120, '"4 x 1" con espacios es 4x1');
o = m.interpretarOferta('Juego 4x1 con 9.50 doy a8');
check(o.ok && o.monto === 9.5, '9.50 es nueve con cincuenta (no 950)');
o = m.interpretarOferta('Juego 1x4 recibo a7 con 30');
check(o.ok && o.lado === 'recibo' && o.apuesta.modalidad === '10a7' && o.monto === 30, '"Juego 1x4 recibo a7 con 30"');
o = m.interpretarOferta('Juego 4.1x5 con 12');
check(o.ok && JSON.stringify(o.apuesta.cruce) === '{"gruposA":[4,1],"gruposB":[5]}' && o.apuesta.modalidad === null, '"4.1x5": 2 caballos contra 1, pelo a pelo');
o = m.interpretarOferta('Juego 4x1 recibo a8 con 1.250,50');
check(o.ok && o.monto === 1250.5, '1.250,50 es mil doscientos cincuenta con cincuenta');
check(m.interpretarOferta('Ajá ksa') === null && m.interpretarOferta('me puedes enviar el racing de Montaner por favor') === null && m.interpretarOferta('27') === null, 'lo que no empieza con "Juego" no es una oferta');
o = m.interpretarOferta('Juego 4x1 doy a8');
check(o && o.ok === false && /monto/.test(o.motivo), 'una oferta sin monto se rechaza');

// 17-11-2026: formas naturales de escribir (prueba real en el grupo)
o = m.interpretarOferta('Juego 3n del 5 400');
check(o && o.ok && o.monto === 400 && JSON.stringify(o.apuesta.grupo) === '[5]' && o.apuesta.modalidad === '3n', '"Juego 3n del 5 400": el monto suelto al final se entiende');
o = m.interpretarOferta('juego 3p del.7 120');
check(o.ok && o.monto === 120 && o.apuesta.modalidad === '3p' && o.apuesta.grupo[0] === 7, 'del.7 se lee como del 7');
o = m.interpretarOferta('juego 3p del.7 1.20');
check(o.ok && o.monto === 1.2 && o.apuesta.grupo[0] === 7, 'el punto del monto 1.20 conserva los decimales');
o = m.interpretarOferta('CONSIGO A9 el 1  200');
check(o.ok && o.lado === 'recibo' && o.monto === 200 && o.apuesta.modalidad === 'a9' && o.apuesta.grupo[0] === 1, 'Consigo A9 el 1 con doble espacio acepta 200 para banquear');
for (const parada of ['CONSIGO A9 el 1 \u200B200', 'CONSIGO A9 el 1  200\u200E', 'CONSIGO A9 el 1  1.20\u200E']) {
  const limpia = parada.replace(/[\u200B\u200E]/g, '');
  eq(m.interpretarOferta(parada), m.interpretarOferta(limpia), 'una marca invisible junto al monto no altera la parada');
}
check(!m.interpretarOferta('CONSIGO A9 el 1  2\u200B00').ok, 'una marca dentro del monto no une los dígitos');
for (const [parada, cuota, monto] of [
  ['Juego a 5 el 4 200', '10a5', 200],
  ['Juego 10 a 7 el 4 180', '10a7', 180],
  ['Juego 10a5 el 4 con 200$', '10a5', 200],
  ['Juego a 5 el 4 1.20 $', '10a5', 1.2]
]) {
  const oferta = m.interpretarOferta(parada);
  check(oferta.ok && oferta.lado === 'doy' && oferta.monto === monto &&
    oferta.apuesta.modalidad === cuota && oferta.apuesta.grupo[0] === 4, parada + ' conserva la cuota, el caballo y el monto');
}
for (const parada of ['juego 200 a5 el 4&#x20;', 'juego a 5 el 4 200', 'juego 200 a 5 el 4 ']) {
  const oferta = m.interpretarOferta(parada);
  check(oferta.ok && oferta.lado === 'doy' && oferta.monto === 200 &&
    /^(?:10)?a5$/.test(oferta.apuesta.modalidad) && oferta.apuesta.grupo[0] === 4, parada + ' se lee como jugar el 4 a 10a5 por 200');
}
check(!m.interpretarOferta('Juego a 5 el 4').ok, 'el caballo no reemplaza un monto ausente');
eq(m.interpretarOferta('Juego 2p.del 6 50'), m.interpretarOferta('Juego 2p del 6 con 50'), 'un punto accidental antes de del no invalida la parada');
eq(m.interpretarOferta('Juego 2p.del.6 1.20'), m.interpretarOferta('Juego 2p del 6 con 1.20'), 'se corrigen los separadores del caballo y se conserva el monto decimal');
eq(m.interpretarOferta('juego 2p del 6 con 50 mas ....'), m.interpretarOferta('juego 2p del 6 con 50'), 'más al final de una parada conserva el monto');
eq(m.interpretarOferta('Juego 2p del 6 1.20 más'), m.interpretarOferta('Juego 2p del 6 con 1.20'), 'más al final conserva los decimales');
o = m.interpretarOferta('Juego 4x1 75');
check(o && o.ok && o.monto === 75 && o.apuesta.cruce, '"Juego 4x1 75": monto suelto en un cruce');
o = m.interpretarOferta('Juego 4 x 1 doy a8');
check(o && o.ok === false && /monto/.test(o.motivo), '"4 x 1" no toma el 1 como monto');
o = m.interpretarOferta('Juego 3n del 5');
check(o && o.ok === false && /monto/.test(o.motivo), 'sin monto sigue pidiendo el monto');
eq(m.interpretarAbrirCarrera('Abierta primera de churchill'), { hipodromo: 'churchill', carrera: 1 }, '"Abierta primera de churchill" abre la 1ra');
eq(m.interpretarAbrirCarrera('Abre la 2da carrera de Mountaineer'), { hipodromo: 'Mountaineer', carrera: 2 }, '"Abre la 2da carrera de Mountaineer"');
eq(m.interpretarAbrirCarrera('Abierta 3ra en La Rinconada'), { hipodromo: 'La Rinconada', carrera: 3 }, '"Abierta 3ra en La Rinconada"');
eq(m.interpretarAbrirCarrera('Abierta 8va de gulf'), { hipodromo: 'gulf', carrera: 8 }, '"Abierta 8va de gulf"');
eq(m.interpretarAbrirCarrera('abierta 8va gulf'), { hipodromo: 'gulf', carrera: 8 }, '"abierta 8va gulf" (sin "de")');
eq(m.interpretarAbrirCarrera('Abierta, 8va de gulf.'), { hipodromo: 'gulf', carrera: 8 }, 'con coma y punto final');
eq(m.interpretarAbrirCarrera('Abierta gulfstream park 8va carrera'), { hipodromo: 'gulfstream park', carrera: 8 }, '"Abierta gulfstream park 8va carrera" (el número al final)');
for (const frase of ['2da valencia abierta', 'abierta segunda valencia', 'abierta 2 de valencia&#x20;',
  'abierta 2da valencia&#x20;', 'abierta valencia 2da', 'abierta valencia segunda']) {
  eq(m.interpretarAbrirCarrera(frase), { hipodromo: 'valencia', carrera: 2 }, '"' + frase + '" abre la segunda de Valencia');
}
check(m.interpretarAbrirCarrera('Abierta') === null && m.interpretarAbrirCarrera('Cerrado') === null, '"Abierta" sola o "Cerrado" no abren nada');

// ---------- 2) Leer respuestas ----------
eq(m.interpretarRespuesta('27'), { tipo: 'monto', monto: 27 }, 'respuesta "27" = 27');
eq(m.interpretarRespuesta('J'), { tipo: 'todo' }, 'respuesta "J" = todo lo que quede');
eq(m.interpretarRespuesta('Jugo'), { tipo: 'todo' }, 'respuesta "Jugo" = todo');
eq(m.interpretarRespuesta('Sf'), { tipo: 'sf' }, 'respuesta "Sf" se reconoce');
eq(m.interpretarRespuesta('Se fue'), { tipo: 'sf' }, 'respuesta "Se fue" se reconoce');
eq(m.interpretarRespuesta('SEFUE'), { tipo: 'sf' }, '"sefue" pegado también');
eq(m.interpretarRespuesta('SF'), { tipo: 'sf' }, '"SF" en mayúsculas');
eq(m.interpretarRespuesta('Se fue todo'), { tipo: 'sf' }, '"Se fue todo"');
check(m.interpretarRespuesta('No') === null && m.interpretarRespuesta('Nada') === null, '"No" o "Nada" NO retiran jugadas');
check(m.interpretarRespuesta('buenas tardes') === null, 'una charla cualquiera no es respuesta');

// ---------- 3) Riesgo (cuadra con los avisos de Dreamy en el video) ----------
let r = m.riesgoPorUnidad(m.interpretarOferta('Juego 4x1 10a8 con 10').apuesta);
check(Math.abs(r.jugador - 1) < 1e-9 && Math.abs(r.banquero - 0.8) < 1e-9, 'cruce 10a8: quien juega arriesga 100% y quien da arriesga 80%');
r = m.riesgoPorUnidad(m.interpretarOferta('Juego 1x4 10a7 con 10').apuesta);
check(Math.abs(r.banquero - 0.7) < 1e-9, 'cruce 10a7: quien da arriesga 70% (20 de disponible alcanza para 28,57)');
r = m.riesgoPorUnidad(m.interpretarOferta('Juego 2y2 y 2p del 5 con 40').apuesta);
check(r.jugador > 0.99 && r.banquero > 0.99, 'combo en un caballo: ambos lados arriesgan el monto completo');

// ---------- 4) Escenario completo ----------
const CLIENTES = { j_cachaco: 'CACHACO', j_marvel: 'MARVEL', j_flow: 'NANA', j_miel: 'MIEL', j_kahelt: 'KAHELT', j_luis: 'LUIS', j_raul: 'RAUL', j_bestia: 'BESTIA', j_ricardo: 'RICARDO' };
const DISP = { NANA: { limitado: true, disponible: 20 }, MIEL: { limitado: true, disponible: 0.96 }, RICARDO: { limitado: true, disponible: 1000 } };
const guardadas = [], enviadas = [], publicadas = [];
const deps = {
  nombreGrupo: 'Dream',
  hoy: () => '2026-11-16',
  identificar: async rem => CLIENTES[rem.jid] || null,
  resolverHipodromo: async t => (/mountaineer/i.test(t) ? 'Mountaineer' : null),
  disponible: async n => DISP[n] || { limitado: false, disponible: 0 },
  guardarJugada: async j => {
    guardadas.push(j);
    if (DISP[j.jugadorNombre]) DISP[j.jugadorNombre].disponible = Math.round((DISP[j.jugadorNombre].disponible - j.riesgoJugador) * 100) / 100;
    if (DISP[j.banqueroNombre]) DISP[j.banqueroNombre].disponible = Math.round((DISP[j.banqueroNombre].disponible - j.riesgoBanquero) * 100) / 100;
  },
  cargarJugadas: async () => [],
  responder: async (t, op) => { enviadas.push({ t, op }); },
  publicar: async t => { publicadas.push(t); }
};
const motor = m.crearMotor(deps);
let n = 0;
const ADMIN = { jid: 'j_dreamy', nombre: 'Dreamy' };
const msg = (jid, texto, extra) => ({ texto, id: 'id' + (++n), citadoId: null, remitente: { jid, nombre: jid.replace('j_', '') }, esAdmin: false, ...(extra || {}) });
const ultima = () => enviadas[enviadas.length - 1];

(async function main() {
  // sin carrera abierta
  await motor.procesarMensaje(msg('j_cachaco', 'Juego 4x1 con 75 doy a8'));
  check(enviadas.length === 1 && /no hay una carrera abierta|Todavía no hay una carrera abierta/i.test(ultima().t), 'sin carrera abierta: avisa que un administrador debe abrirla');
  await motor.procesarMensaje(msg('j_cachaco', 'Juego 4x1 con 75 doy a8'));
  check(enviadas.length === 1, 'el mismo aviso no se repite a cada mensaje');

  // un NO administrador no puede abrir
  await motor.procesarMensaje(msg('j_cachaco', 'Mountaineer 1ra carrera'));
  check(motor.estado().abierta === false, 'un jugador no puede abrir la carrera');
  await motor.procesarMensaje(msg('j_dreamy', 'Mountaineer 1era carrera', { esAdmin: true }));
  check(motor.estado().abierta === true && motor.estado().hipodromo === 'Mountaineer' && motor.estado().carrera === 1, 'el administrador abre "Mountaineer 1era carrera"');
  await motor.procesarMensaje(msg('j_dreamy', 'Gulfstream 3ra carrera', { esAdmin: true }));
  check(motor.estado().carrera === 1 && /No encontré el hipódromo/.test(ultima().t), 'un hipódromo que el grupo no tiene no abre nada');

  // Cachaco publica 120; Marvel 22; Nana(FlowSport) 25
  const of1 = msg('j_cachaco', 'Juego 4 x 1 10a8 con 120');
  const antesEnv = enviadas.length;
  await motor.procesarMensaje(of1);
  check(enviadas.length === antesEnv, 'publicar una jugada válida no genera ningún mensaje (como en el video)');
  const rMarvel = msg('j_marvel', '22', { citadoId: of1.id });
  await motor.procesarMensaje(rMarvel);
  check(guardadas.length === 1 && guardadas[0].jugadorNombre === 'CACHACO' && guardadas[0].banqueroNombre === 'MARVEL' && guardadas[0].monto === 22, '"22" de Marvel: juega Cachaco, da Marvel, 22');
  check(ultima().t === '✅ Aquí jugaron' && ultima().op.citarId === rMarvel.id, 'responde "✅ Aquí jugaron" citando el mensaje de Marvel');
  await motor.procesarMensaje(msg('j_flow', '25', { citadoId: of1.id }));
  check(guardadas.length === 2 && guardadas[1].banqueroNombre === 'NANA' && guardadas[1].monto === 25, 'FlowSport es el cliente NANA (se identifica por su número): da 25');
  check(guardadas[1].riesgoBanquero === 20 && guardadas[1].riesgoJugador === 25, 'el riesgo guardado: banquero 25 x 80% = 20, jugador 25');
  check(DISP.NANA.disponible === 0, 'el disponible de Nana bajó a 0 tras arriesgar 20');

  // J toma lo que queda: 120 - 22 - 25 = 73
  const rJ = msg('j_ricardo', 'J', { citadoId: of1.id });
  await motor.procesarMensaje(rJ);
  check(guardadas.length === 3 && guardadas[2].monto === 73 && guardadas[2].banqueroNombre === 'RICARDO', '"J" juega exactamente lo que quedaba (73)');
  check(ultima().t === '✅ Aquí jugaron 73,00', '"J" sobre una parada ya tomada en parte: aclara cuánto se jugó (73,00)');
  // ya topada
  await motor.procesarMensaje(msg('j_kahelt', '50', { citadoId: of1.id }));
  check(guardadas.length === 3 && ultima().t === '❌ Aquí nada, ya está topada', 'cuando ya no queda nada: "❌ Aquí nada, ya está topada"');

  // Parcial: oferta de 300, uno juega 200, otro pide J ... solo 100
  const of2 = msg('j_luis', 'Juego 2p del 8 con 300');
  await motor.procesarMensaje(of2);
  await motor.procesarMensaje(msg('j_marvel', '200', { citadoId: of2.id }));
  check(guardadas[3].monto === 200, 'oferta de 300, responden 200: juegan 200');
  await motor.procesarMensaje(msg('j_ricardo', '200', { citadoId: of2.id }));
  check(guardadas[4].monto === 100 && ultima().t === '✅ Aquí solo 100,00', 'piden 200 pero solo quedaban 100: juegan 100 y el bot responde "Aquí solo 100,00"');

  // Roles con "recibo": Luis recibe, Raul responde J => Raul JUEGA 5x4 a 8 con 200, y Luis da
  const of3 = msg('j_luis', 'Juego 4x5 recibo a 8 200');
  await motor.procesarMensaje(of3);
  await motor.procesarMensaje(msg('j_raul', 'J', { citadoId: of3.id }));
  const g = guardadas[5];
  check(g.jugadorNombre === 'RAUL' && g.banqueroNombre === 'LUIS' && g.monto === 200 && g.apuesta.modalidad === '10a8' && JSON.stringify(g.apuesta.cruce) === '{"gruposA":[5],"gruposB":[4]}', 'con "recibo": Raúl juega 5x4 a 8 con 200 y Luis da (los caballos se invierten)');
  check(g.textoLinea === 'Juega RAUL 10A8 (5x4) con 200,00 da LUIS', 'la línea guardada queda lista para el sistema: ' + g.textoLinea);

  // "Sf / Se fue": el jugador retira todas sus jugadas
  const ofSf = msg('j_luis', 'Juego 4x1 con 80 doy a8');
  const ofSf2 = msg('j_luis', 'Juego 3x2 con 50 doy a8');
  await motor.procesarMensaje(ofSf); await motor.procesarMensaje(ofSf2);
  const antesSf = guardadas.length;
  await motor.procesarMensaje(msg('j_luis', 'Sf'));
  const rSf = msg('j_marvel', '30', { citadoId: ofSf.id });
  await motor.procesarMensaje(rSf);
  check(guardadas.length === antesSf && ultima().t === '*❌ Aquí nada, puso se fue*\n*🚨🚨🚨🚨🚨*' && ultima().op.citarId === rSf.id, 'Luis escribió "Sf": si Marvel le pone 30 a su jugada, el bot responde "Aquí nada, puso se fue" y no registra nada');
  await motor.procesarMensaje(msg('j_ricardo', 'J', { citadoId: ofSf2.id }));
  check(guardadas.length === antesSf && ultima().t === '*❌ Aquí nada, puso se fue*\n*🚨🚨🚨🚨🚨*', 'también para su otra jugada abierta (se fueron TODAS)');
  const ofNueva = msg('j_luis', 'Juego 4x1 con 40 doy a8');
  await motor.procesarMensaje(ofNueva);
  await motor.procesarMensaje(msg('j_marvel', '40', { citadoId: ofNueva.id }));
  check(guardadas.length === antesSf + 1 && guardadas[antesSf].monto === 40, 'si Luis publica una jugada NUEVA después del "Se fue", esa sí se juega');
  // "Se fue" como respuesta a otro y "sefue" suelto
  const ofOtro = msg('j_kahelt', 'Juego 4x1 con 60 doy a8');
  await motor.procesarMensaje(ofOtro);
  await motor.procesarMensaje(msg('j_kahelt', 'sefue', { citadoId: ofNueva.id }));
  const antesOtro = guardadas.length;
  await motor.procesarMensaje(msg('j_marvel', '20', { citadoId: ofOtro.id }));
  check(guardadas.length === antesOtro && ultima().t === '*❌ Aquí nada, puso se fue*\n*🚨🚨🚨🚨🚨*', '"sefue" (aunque sea como respuesta a otro mensaje) retira las jugadas de quien lo escribe');

  // Control de pozo al PUBLICAR: con saldo pero menos de lo puesto, se le pide corregir y la parada queda abierta (juega solo su disponible)
  await motor.procesarMensaje(msg('j_miel', 'Juego 4x1 10@8 con 60'));
  check(/^\*🚨🚨🚨🚨🚨\*\n@@ \*Favor corregir monto, su monto disponible para jugadas es de 0,96\. En caso de recibir alguna respuesta, jugará solo su disponible\.\*$/.test(ultima().t) && ultima().op.mencionar === 'j_miel', 'Miel con 0,96 publica 60: "@Miel Favor corregir monto, su monto disponible para jugadas es de 0,96. En caso de recibir alguna respuesta, jugará solo su disponible."');
  check([...motor._ofertas.values()].some(x => x.autorNombre === 'MIEL' && x.monto === 60), 'esa parada SÍ queda abierta (con lo que puso)');
  // sin nada de saldo: no se registra y quien responde recibe la explicación
  const dispMiel = DISP.MIEL.disponible;
  DISP.MIEL.disponible = 0;
  const ofMiel = msg('j_miel', 'Juego 4x1 10@8 con 70');
  await motor.procesarMensaje(ofMiel);
  check(/^Saludos @@ \(Miel\), dispone de un saldo de 0,00\./.test(ultima().t) && ![...motor._ofertas.values()].some(x => x.autorNombre === 'MIEL' && x.monto === 70), 'Miel sin saldo: "Saludos (Miel), dispone de un saldo de 0,00..." y la parada no se registra');
  await motor.procesarMensaje(msg('j_marvel', '20', { citadoId: ofMiel.id, citadoTexto: 'Juego 4x1 10@8 con 70' }));
  check(/^❌ Aquí nada, esa parada no quedó registrada: quien la publicó no tiene saldo disponible/.test(ultima().t), 'responder a una parada rechazada por saldo: "esa parada no quedó registrada: quien la publicó no tiene saldo"');
  DISP.MIEL.disponible = dispMiel;
  const nOfertas = motor._ofertas.size;
  DISP.NANA.disponible = 20;
  await motor.procesarMensaje(msg('j_flow', 'Juego 1x4 recibo a7 con 30'));
  check(/^\*🚨🚨🚨🚨🚨\*\n@@ \*Favor corregir monto, su monto disponible para jugadas es de 28,57\./.test(ultima().t), 'FlowSport recibiendo a7 con 30 y 20 de saldo: "Favor corregir monto, su monto disponible para jugadas es de 28,57"');
  await motor.procesarMensaje(msg('j_flow', 'Juego 1x4 recibo a7 con 28,57'));
  check([...motor._ofertas.values()].some(x => x.autorNombre === 'NANA' && x.monto === 28.57), 'con 28,57 sí queda publicada');

  // Control de pozo al RESPONDER
  const of4 = msg('j_kahelt', 'Juego 4x1 con 75 doy a8');
  await motor.procesarMensaje(of4);
  const antes = guardadas.length;
  await motor.procesarMensaje(msg('j_miel', '50', { citadoId: of4.id }));
  check(guardadas.length === antes + 1 && guardadas[antes].monto === 1.2 && guardadas[antes].banqueroNombre === 'MIEL', 'Miel responde 50 pero su saldo (0,96, da a 8 arriesga 0,8) solo alcanza para 1,20: se juega 1,20');
  check(ultima().t === '✅ @@ @@2 Aquí solo jugaron 1,20 por pozo de @@3' && ultima().op.mencionar === 'j_kahelt' && ultima().op.mencionar2 === 'j_miel' && ultima().op.mencionar3 === 'j_miel', 'avisa "@(el que publicó) @(Miel) Aquí solo jugaron 1,20 por pozo de @(Miel)" etiquetando a las dos personas');
  await motor.procesarMensaje(msg('j_kahelt', '30', { citadoId: of4.id }));
  check(guardadas.length === antes + 1, 'responderse a uno mismo no juega nada');
  // saldo en 0: no se juega nada y se le avisa su saldo
  DISP.MIEL.disponible = 0;
  await motor.procesarMensaje(msg('j_miel', 'J', { citadoId: of4.id }));
  check(guardadas.length === antes + 1 && /^Saludos @@ \([A-Za-z]+\), dispone de un saldo de 0,00\./.test(ultima().t), 'con saldo 0 no se juega y se le dice "dispone de un saldo de 0,00..."');

  // Ejemplo del usuario: a un cliente le quedan 300 y marca "J" en una parada de 1.000: se juegan solo 300 y se etiqueta a las dos personas
  DISP.LUIS = { limitado: true, disponible: 300 };
  const of1000 = msg('j_kahelt', 'Juego 4x1 con 1000 recibo a8');
  await motor.procesarMensaje(of1000);
  const gAntes = guardadas.length;
  await motor.procesarMensaje(msg('j_luis', 'J', { citadoId: of1000.id }));
  check(guardadas.length === gAntes + 1 && guardadas[gAntes].monto === 300 && guardadas[gAntes].jugadorNombre === 'LUIS', 'saldo 300 y "J" en una parada de 1.000: se juegan 300');
  check(ultima().t === '✅ @@ @@2 Aquí solo jugaron 300,00 por pozo de @@3' && ultima().op.mencionar === 'j_kahelt' && ultima().op.mencionar2 === 'j_luis' && ultima().op.mencionar3 === 'j_luis', '"@(el de la parada) @(Luis) Aquí solo jugaron 300,00 por pozo de @(Luis)"');
  await motor.procesarMensaje(msg('j_luis', '500', { citadoId: of1000.id }));
  check(guardadas.length === gAntes + 1 && /dispone de un saldo de 0,00/.test(ultima().t), 'Luis ya gastó los 300: si marca 500 no se juega y se le avisa su saldo (0,00)');
  DISP.LUIS.disponible = 300;

  // Ejemplo del usuario: saldo 1.732,70 y publica "Juego 3p del 1 2000"
  DISP.BESTIA = { limitado: true, disponible: 1732.7 };
  const ofGrande = msg('j_bestia', 'Juego 3p del 1 2000');
  await motor.procesarMensaje(ofGrande);
  check(/^\*🚨🚨🚨🚨🚨\*\n@@ \*Favor corregir monto, su monto disponible para jugadas es de 1\.732,70\. En caso de recibir alguna respuesta, jugará solo su disponible\.\*$/.test(ultima().t) && ultima().op.mencionar === 'j_bestia', 'saldo 1.732,70 y publica 2000: se le etiqueta "Favor corregir monto, su monto disponible para jugadas es de 1.732,70..."');
  const gG = guardadas.length;
  await motor.procesarMensaje(msg('j_raul', 'J', { citadoId: ofGrande.id }));
  check(guardadas.length === gG + 1 && guardadas[gG].monto === 1732.7 && guardadas[gG].jugadorNombre === 'BESTIA' && guardadas[gG].banqueroNombre === 'RAUL', 'otro cliente marca J: juegan solo 1.732,70');
  check(ultima().t === '✅ @@ @@2 Aquí solo jugaron 1.732,70 por pozo de @@3' && ultima().op.mencionar === 'j_bestia' && ultima().op.mencionar2 === 'j_raul' && ultima().op.mencionar3 === 'j_bestia', 'avisa "Aquí solo jugaron 1.732,70 por pozo de @(el que publicó)" etiquetando a los dos');
  await motor.procesarMensaje(msg('j_ricardo', 'J', { citadoId: ofGrande.id }));
  check(guardadas.length === gG + 1 && /ya no tiene disponible/.test(ultima().t), 'una vez usado su saldo, el que sigue recibe "ya no tiene disponible"');

  // Número desconocido
  await motor.procesarMensaje(msg('j_nadie', 'Juego 4x1 con 10 doy a8'));
  check(/no está registrado como cliente/.test(ultima().t), 'un número que no es cliente: se le avisa');
  const antes2 = enviadas.length;
  await motor.procesarMensaje(msg('j_nadie', 'Juego 4x1 con 10 doy a8'));
  check(enviadas.length === antes2, 'sin repetir el aviso a cada mensaje');

  // Parada de 400 que ya fue tomada en parte: "J", "jugo" o un monto mayor juegan solo lo que queda y el bot dice cuánto
  const ofQ = msg('j_cachaco', 'Juego 4x1 con 400 doy a8');
  await motor.procesarMensaje(ofQ);
  await motor.procesarMensaje(msg('j_marvel', '300', { citadoId: ofQ.id }));
  check(ultima().t === '✅ Aquí jugaron', 'juegan 300 de 400 (lo que pidieron): "Aquí jugaron" sin monto');
  await motor.procesarMensaje(msg('j_luis', 'J', { citadoId: ofQ.id }));
  check(guardadas[guardadas.length - 1].monto === 100 && ultima().t === '✅ Aquí jugaron 100,00', 'quedaban 100 y responden "J": se juegan 100 y el bot responde "Aquí jugaron 100,00"');
  const ofQ2 = msg('j_cachaco', 'Juego 4x1 con 400 doy a8');
  await motor.procesarMensaje(ofQ2);
  await motor.procesarMensaje(msg('j_marvel', '300', { citadoId: ofQ2.id }));
  await motor.procesarMensaje(msg('j_luis', 'jugo', { citadoId: ofQ2.id }));
  check(ultima().t === '✅ Aquí jugaron 100,00', '"jugo" cuenta igual que "J"');
  const ofQ3 = msg('j_cachaco', 'Juego 4x1 con 400 doy a8');
  await motor.procesarMensaje(ofQ3);
  await motor.procesarMensaje(msg('j_marvel', '300', { citadoId: ofQ3.id }));
  await motor.procesarMensaje(msg('j_luis', '250', { citadoId: ofQ3.id }));
  check(ultima().t === '✅ Aquí solo 100,00', 'quedaban 100 y piden 250: juegan 100 y el bot lo dice');
  const ofQ4 = msg('j_cachaco', 'Juego 4x1 con 80 doy a8');
  await motor.procesarMensaje(ofQ4);
  await motor.procesarMensaje(msg('j_marvel', 'J', { citadoId: ofQ4.id }));
  check(ultima().t === '✅ Aquí jugaron', '"J" sobre una parada intacta juega todo y responde "Aquí jugaron" sin monto');
  // @lid: pista para el administrador y comando "registrar"
  await motor.procesarMensaje(msg('99999@lid', 'Juego 4x1 con 10 doy a8'));
  check(/no está registrado como cliente/.test(ultima().t) && /registrar NOMBRE_DEL_CLIENTE/.test(ultima().t), 'un número oculto (@lid) sin cliente: el aviso trae la pista "registrar NOMBRE_DEL_CLIENTE"');
  const registros = [];
  deps.registrarNumero = async x => { registros.push(x); return /^tykhe$/i.test(x.nombre) ? { ok: true, nombre: 'TYKHE' } : { ok: false, motivo: 'No encontré ningún cliente llamado "' + x.nombre + '" en este grupo.' }; };
  await motor.procesarMensaje(msg('j_dreamy', 'registrar tykhe', { esAdmin: true }));
  check(registros.length === 0 && /Responde \(cita\) el mensaje/.test(ultima().t), '"registrar" sin citar a la persona: pide citar su mensaje');
  await motor.procesarMensaje(msg('j_dreamy', 'registrar tykhe', { esAdmin: true, citadoParticipante: '99999@lid' }));
  check(registros.length === 1 && registros[0].jid === '99999@lid' && registros[0].nombre === 'tykhe' && /Listo: ese número quedó registrado como \*TYKHE\*/.test(ultima().t), 'el administrador registra: manda el @lid citado y el nombre, y confirma');
  await motor.procesarMensaje(msg('j_dreamy', 'registrar fulano', { esAdmin: true, citadoParticipante: '99999@lid' }));
  check(/No encontré ningún cliente/.test(ultima().t), 'si el cliente no existe, el administrador recibe el motivo');
  await motor.procesarMensaje(msg('j_cachaco', 'registrar tykhe', { citadoParticipante: '99999@lid' }));
  check(registros.length === 2, 'un jugador que escribe "registrar" no registra nada');
  delete deps.registrarNumero;

  // Vigencia de la parada: 3 minutos
  const T0 = Date.now();
  const ofT = msg('j_cachaco', 'Juego 4x1 con 75 doy a8', { ts: T0 });
  await motor.procesarMensaje(ofT);
  const antesT = guardadas.length;
  await motor.procesarMensaje(msg('j_marvel', '10', { citadoId: ofT.id, ts: T0 + 181000 }));
  check(guardadas.length === antesT && /tiene 1 minuto/.test(ultima().t), 'después de 3 minutos la jugada queda pendiente de confirmación');
  await motor.procesarMensaje(msg('j_marvel', '10', { citadoId: ofT.id, ts: T0 + 180000 }));
  check(guardadas.length === antesT && /tiene 1 minuto/.test(ultima().t), 'a los 3 minutos también se solicita confirmación');
  const ofT2 = msg('j_cachaco', 'Juego 4x1 con 75 doy a8', { ts: T0 });
  await motor.procesarMensaje(ofT2);
  await motor.procesarMensaje(msg('j_marvel', '10', { citadoId: ofT2.id, ts: T0 + 179000 }));
  check(guardadas.length === antesT + 1 && ultima().t === '✅ Aquí jugaron', 'a los 2:59 todavía vale: "Aquí jugaron"');
  // "se fue" en todas sus variantes (también errores de tecleo)
  for (const frase of ['sf', 'Se fue', 'sefue', 'cfue', 'sedue', 'se due', 'S F', 'sf.', 'se fueron']) {
    const ofS = msg('j_cachaco', 'Juego 4x1 con 75 doy a8');
    await motor.procesarMensaje(ofS);
    await motor.procesarMensaje(msg('j_cachaco', frase));
    const g0 = guardadas.length;
    await motor.procesarMensaje(msg('j_marvel', 'J', { citadoId: ofS.id }));
    check(guardadas.length === g0 && ultima().t === '*❌ Aquí nada, puso se fue*\n*🚨🚨🚨🚨🚨*', '"' + frase + '" mata la parada: el bot responde "Aquí nada, puso se fue"');
  }
  // lo ya jugado antes del "se fue" se conserva y lo que se publica después de él vale
  const ofA = msg('j_cachaco', 'Juego 4x1 con 100 doy a8');
  await motor.procesarMensaje(ofA);
  await motor.procesarMensaje(msg('j_marvel', '30', { citadoId: ofA.id }));
  const gA = guardadas.length;
  await motor.procesarMensaje(msg('j_cachaco', 'se fue'));
  await motor.procesarMensaje(msg('j_marvel', '30', { citadoId: ofA.id }));
  check(guardadas.length === gA && ultima().t === '*❌ Aquí nada, puso se fue*\n*🚨🚨🚨🚨🚨*', 'lo que sobraba de la parada murió con el "se fue" (lo jugado antes se mantiene)');
  const ofB = msg('j_cachaco', 'Juego 4x1 con 40 doy a8');
  await motor.procesarMensaje(ofB);
  await motor.procesarMensaje(msg('j_marvel', 'J', { citadoId: ofB.id }));
  check(guardadas.length === gA + 1 && ultima().t === '✅ Aquí jugaron', 'una parada publicada DESPUÉS del "se fue" es nueva y sí vale');
  // parada que el bot no tiene en memoria (reinicio / publicada antes de abrir)
  const nAntes = enviadas.length;
  await motor.procesarMensaje(msg('j_marvel', '20', { citadoId: 'DESCONOCIDA', citadoTexto: 'Juego 4x1 con 75 doy a8' }));
  check(/^❌ Aquí nada, esa parada ya no está activa/.test(ultima().t), 'respuesta a una parada que el bot no conoce: avisa "Aquí nada" y que la publiquen de nuevo');
  await motor.procesarMensaje(msg('j_marvel', '20', { citadoId: 'OTRO', citadoTexto: 'hola buenas' }));
  check(enviadas.length === nAntes + 1, 'responder con un monto a una charla cualquiera no genera mensaje');
  // el aviso de "no registrado" se vuelve a dar pasado un minuto
  // notas para el panel
  const notasMotor = [];
  deps.nota = t => notasMotor.push(t);
  const ofN = msg('j_cachaco', 'Juego 4x1 con 75 doy a8');
  await motor.procesarMensaje(ofN);
  await motor.procesarMensaje(msg('j_marvel', '10', { citadoId: ofN.id }));
  check(notasMotor.some(t => /Jugada publicada por CACHACO/.test(t)) && notasMotor.some(t => /Se jugó: CACHACO con 10,00 contra MARVEL/.test(t)), 'el motor deja notas de lo que decidió (para el panel de Súper-admin)');
  delete deps.nota;

  // no administradores que intentan abrir/cerrar: ya no se quedan sin respuesta
  const nAd = enviadas.length;
  await motor.procesarMensaje(msg('j_socio', 'Abierta 8va de gulf'));
  check(enviadas.length === nAd + 1 && /no está autorizado para abrir carreras/.test(ultima().t) && ultima().op.registroDe === 'j_socio', 'un jugador escribe "Abierta 8va de gulf": el bot explica que no está autorizado (y deja marcado a quién autorizar)');
  await motor.procesarMensaje(msg('j_socio', 'Abierta 8va de gulf'));
  check(enviadas.length === nAd + 1, 'el mismo aviso no se repite a cada intento');
  await motor.procesarMensaje(msg('j_marvel', 'Cerrado'));
  check(/no está autorizado para cerrar carreras/.test(ultima().t) && motor.estado().abierta === true, 'un jugador escribe "Cerrado": se explica y la carrera sigue abierta');
  const autorizados = [];
  deps.autorizarAdmin = async x => { autorizados.push(x); return { ok: true }; };
  await motor.procesarMensaje(msg('j_dreamy', 'autorizar', { esAdmin: true }));
  check(autorizados.length === 0 && /No sé a quién autorizar/.test(ultima().t), '"autorizar" sin citar a nadie: pide citar');
  await motor.procesarMensaje(msg('j_dreamy', 'autorizar', { esAdmin: true, citadoParticipante: 'j_socio' }));
  check(autorizados.length === 1 && autorizados[0].jid === 'j_socio' && /ahora es administrador/.test(ultima().t), 'el administrador autoriza citando a la persona');
  await motor.procesarMensaje(msg('j_marvel', 'autorizar', { citadoParticipante: 'j_socio' }));
  check(autorizados.length === 1, 'un jugador no puede autorizar a nadie');
  delete deps.autorizarAdmin;

  // Oferta que no se entiende: preguntar en el grupo
  await motor.procesarMensaje(msg('j_kahelt', 'Juego 4x1 doy a8'));
  check(/MALO, debe corregir: su jugada está mal escrita/.test(ultima().t) && /falta el monto/.test(ultima().t) && !/Escríbela así/.test(ultima().t), 'una jugada sin monto: el bot dice MALO, debe corregir (sin ejemplo)');

  // ---- Términos: roles de quien publica y de quien responde ----
  eq(m.interpretarRespuesta('jugue 200'), { tipo: 'monto', monto: 200, rol: 'juega' }, '"jugué 200" = quiere jugar 200');
  eq(m.interpretarRespuesta('Doy 200'), { tipo: 'monto', monto: 200, rol: 'da' }, '"doy 200" = quiere dar 200');
  eq(m.interpretarRespuesta('consigo 50'), { tipo: 'monto', monto: 50, rol: 'da' }, '"consigo 50" = quiere dar 50');
  eq(m.interpretarRespuesta('200'), { tipo: 'monto', monto: 200 }, 'el monto solo sigue siendo neutro (sirve para jugar o para dar)');
  eq(m.interpretarOferta('consigo 3n del 1 200').lado, 'recibo', '"Consigo 3n del 1 200": quien publica quiere banquear');
  eq(m.interpretarOferta('Consigo 3n del 1 200').monto, 200, '"Consigo": el monto se entiende igual');
  check(m.conflictoDeRol('doy', { rol: 'juega' }) && m.conflictoDeRol('recibo', { rol: 'da' }) && !m.conflictoDeRol('doy', { rol: 'da' }) && !m.conflictoDeRol('recibo', { rol: 'juega' }) && !m.conflictoDeRol('doy', {}), 'solo hay conflicto cuando los dos piden el mismo rol');
  check(m.pareceParadaMalEscrita('jhuego 2p del 8 300') && m.pareceParadaMalEscrita('2p del 8 300') && m.pareceParadaMalEscrita('juegoo 3n del 1 200'), 'detecta paradas con verbo mal escrito o sin verbo');
  check(!m.pareceParadaMalEscrita('hola buenas tardes') && !m.pareceParadaMalEscrita('el 8 es mi caballo') && !m.pareceParadaMalEscrita('Juego 2p del 8 300') && !m.pareceParadaMalEscrita('200'), 'la charla normal, una parada buena o un monto suelto no se marcan como mal escritas');

  const ofJ = msg('j_cachaco', 'Juego 2p del 8 300');
  await motor.procesarMensaje(ofJ);
  const gT = guardadas.length;
  await motor.procesarMensaje(msg('j_marvel', 'jugue 200', { citadoId: ofJ.id }));
  check(guardadas.length === gT && ultima().t === '❌ Aquí nada, mal término: ambos juegan.', 'publican "Juego…" y responden "jugué 200": Aquí nada, mal término, ambos juegan');
  await motor.procesarMensaje(msg('j_marvel', 'doy 100', { citadoId: ofJ.id }));
  check(guardadas.length === gT + 1 && ultima().t === '✅ Aquí jugaron' && guardadas[gT].jugadorNombre === 'CACHACO' && guardadas[gT].banqueroNombre === 'MARVEL', 'publican "Juego…" y responden "doy 100": sí vale (uno juega y el otro da)');
  const ofC = msg('j_cachaco', 'Consigo 3n del 1 200');
  await motor.procesarMensaje(ofC);
  const gC = guardadas.length;
  await motor.procesarMensaje(msg('j_marvel', 'doy 200', { citadoId: ofC.id }));
  check(guardadas.length === gC && ultima().t === '❌ Aquí nada, error de término: ambos dan.', 'publican "Consigo…" y responden "doy 200": Aquí nada, error de término, ambos dan');
  await motor.procesarMensaje(msg('j_marvel', 'jugue 100', { citadoId: ofC.id }));
  check(guardadas.length === gC + 1 && guardadas[gC].jugadorNombre === 'MARVEL' && guardadas[gC].banqueroNombre === 'CACHACO', 'publican "Consigo…" y responden "jugué 100": sí vale (juega el que responde)');

  eq(m.interpretarOferta('Juego 2000 3p del 1'), { ok: true, lado: 'doy', monto: 2000, apuesta: { cruce: null, grupo: [1], modalidad: '3p' }, cuota: null }, '"Juego 2000 3p del 1": juega 2000 a 3 puestos del caballo 1 (monto pegado al verbo)');
eq(m.interpretarOferta('Juego 3p del 1 2000').monto, 2000, 'el monto al final sigue funcionando');
check(m.interpretarOferta('Juego 2.000 3p del 1').monto === 2000 && m.interpretarOferta('Juego 2000 4x1 doy a8').apuesta.modalidad === '10a8' && m.interpretarOferta('Consigo 500 3n del 1').lado === 'recibo', 'monto con punto de miles, con cruce y cuota, y con "Consigo" también se entienden');
check(m.interpretarOferta('Juego 2000 hola').ok === false && m.interpretarOferta('Juego 2000').ok === false, 'sin una apuesta reconocible sigue siendo "mal escrita"');
eq(m.interpretarRespuesta('ponte 200'), { tipo: 'monto', monto: 200 }, '"ponte 200" = monto neutro');
  const ofPon = msg('j_cachaco', 'juego 2p del 8 300');
  await motor.procesarMensaje(ofPon);
  const gPon = guardadas.length;
  await motor.procesarMensaje(msg('j_marvel', 'ponte 200', { citadoId: ofPon.id }));
  check(guardadas.length === gPon + 1 && guardadas[gPon].jugadorNombre === 'CACHACO' && guardadas[gPon].banqueroNombre === 'MARVEL' && guardadas[gPon].monto === 200 && ultima().t === '✅ Aquí jugaron', '"juego 2p del 8 300" y responden "ponte 200": van jugando 200 (juega quien publicó)');
  const ofPon2 = msg('j_cachaco', 'consigo 2p del 8 400');
  await motor.procesarMensaje(ofPon2);
  const gPon2 = guardadas.length;
  await motor.procesarMensaje(msg('j_marvel', 'ponte 100', { citadoId: ofPon2.id }));
  check(guardadas.length === gPon2 + 1 && guardadas[gPon2].jugadorNombre === 'MARVEL' && guardadas[gPon2].banqueroNombre === 'CACHACO' && guardadas[gPon2].monto === 100 && ultima().t === '✅ Aquí jugaron', '"consigo 2p del 8 400" y responden "ponte 100": van jugando (juega el que responde)');

  // Parada mal escrita
  const ofM = msg('j_cachaco', 'jhuego 2p del 8 300');
  await motor.procesarMensaje(ofM);
  check(/MALO, debe corregir: su jugada está mal escrita/.test(ultima().t) && ultima().op.mencionar === 'j_cachaco', 'parada con el verbo mal escrito ("jhuego…"): MALO, debe corregir, su jugada está mal escrita');
  const gM = guardadas.length;
  await motor.procesarMensaje(msg('j_marvel', 'j', { citadoId: ofM.id, citadoTexto: 'jhuego 2p del 8 300' }));
  check(guardadas.length === gM && ultima().t === '❌ Aquí nada, parada mal escrita.', 'responder "j" a una parada mal escrita: Aquí nada, parada mal escrita');
  await motor.procesarMensaje(msg('j_marvel', '200', { citadoId: ofM.id }));
  check(guardadas.length === gM && ultima().t === '❌ Aquí nada, parada mal escrita.', 'responder un monto a una parada mal escrita: también Aquí nada');
  await motor.procesarMensaje(msg('j_marvel', 'jugo 200', { citadoId: 'XYZ', citadoTexto: 'Juego 4x1 doy a8' }));
  check(guardadas.length === gM && ultima().t === '❌ Aquí nada, parada mal escrita.', 'responder a una parada sin monto (el bot la vio mal escrita): Aquí nada, parada mal escrita');
  await motor.procesarMensaje(msg('j_cachaco', '2p del 8 300'));
  check(/MALO, debe corregir/.test(ultima().t), 'una parada sin verbo ("2p del 8 300"): no se sabe si juega o da → MALO, debe corregir');
  const nCh = enviadas.length;
  await motor.procesarMensaje(msg('j_cachaco', 'buenas tardes muchachos'));
  check(enviadas.length === nCh, 'la charla normal no recibe respuesta');

  // Plano: cada 4 jugadas nuevas se publicó solo
  check(publicadas.length >= 1, 'cada 4 jugadas nuevas el bot publica el plano (' + publicadas.length + ' veces hasta ahora)');
  const antesPl = publicadas.length;
  await motor.procesarMensaje(msg('j_cachaco', 'plano'));
  check(publicadas.length === antesPl, 'un jugador no puede pedir el plano');
  await motor.procesarMensaje(msg('j_dreamy', 'Plano', { esAdmin: true }));
  check(publicadas.length === antesPl + 1, 'un administrador pide "plano" y sale');
  const plano = publicadas[publicadas.length - 1];
  check(/^\*🇻🇪🏇🏟️DREAM🏟️🏇🇻🇪\*/.test(plano) && /Mountaineer, 1ra Carrera/.test(plano) && /Pizarra: \.\.\.\.\./.test(plano) && /\*TERCIOS\*/.test(plano), 'encabezado de Cargar Planos');
  check(/^Juega Cachaco 10A8 \(4x1\) con 22,00 da Marvel/m.test(plano) && /^Juega Cachaco 10A8 \(4x1\) con 25,00 da Nana/m.test(plano), 'líneas "Juega Cachaco 10A8 (4x1) con 22,00 da Marvel"');
  check(/Juega Bestia|Juega Luis 2P \(8\) con 300|Juega Luis 2P \(8\) con 200,00 da Marvel/.test(plano) || /2P \(8\) con 200,00/.test(plano), 'una jugada de grupo se ve "2P (8)"');
  check(/Juega Raul 10A8 \(5x4\) con 200,00 da Luis/.test(plano), 'la jugada "recibo" sale con Raúl jugando 5x4');
  check(new RegExp('Total Jugadas: ' + guardadas.length + '\n').test(plano), 'incluye antes del pie "Total jugadas: ' + guardadas.length + '"');

  check(plano.endsWith(require('../src/services/hipismoCalc').PIE_PLANO_DEFECTO) &&
    !/\*GANAN\*|\*PIERDEN\*/.test(plano), 'usa el pie del programa y deja resultados para la pizarra');

  // Cierre
  await motor.procesarMensaje(msg('j_cachaco', 'cierra'));
  check(motor.estado().abierta === true, 'un jugador no puede cerrar');
  const antesCierre = publicadas.length;
  await motor.procesarMensaje(msg('j_dreamy', 'cierra', { esAdmin: true }));
  check(motor.estado().abierta === false && publicadas.length === antesCierre + 1 && enviadas.slice(-2).some(e => /^\*_🔒❌ CARRERA CERRADA SE DIO LA PARTIDA EN MOUNTAINEER, 1ERA CARRERA\. YA NO SE RECIBEN MAS JUGADAS,❌🔒_\*\n\*_🚫 NO HAY MAS JUGADA🚫_\*\n\*_🚫 NO HAY MAS JUGADA🚫_\*\n\*_ÉXITOS A TODOS EN SUS APUESTAS, AL TENER PIZARRA OFICIAL SE ENVIARAN LOS TOTALES DE ESTA CARRERA 💰🐎💰🐎_\*\n\*_🔒 CARRERA CERRADA🔒_\*\n\*_NOS REGIMOS POR EL CHAT📲 Y NUESTROS REGLAMENTOS ‼️_\*\n\*_JUEGA GANA Y COBRA SEGURO EN [^\n_]+_\*$/.test(e.t)), 'el administrador cierra: avisa (en negrita, línea por línea) y publica el plano final');
  check(/^Juega Cachaco/m.test(publicadas[publicadas.length - 1]) && new RegExp('Total Jugadas: ' + guardadas.length + '\n').test(publicadas[publicadas.length - 1]), 'el plano final trae TODAS las jugadas que hubo en la carrera');
  const antes3 = guardadas.length;
  const of5 = msg('j_luis', 'Juego 4x1 con 10 doy a8');
  await motor.procesarMensaje(of5);
  await motor.procesarMensaje(msg('j_marvel', '10', { citadoId: of5.id }));
  check(guardadas.length === antes3, 'con la carrera cerrada ya no se registra nada');

  // ---------- PIZARRA desde el chat ----------
  eq(m.interpretarPizarra('Pizarra 6.10.4.8.2'), { llegada: '6.10.4.8.2', ret: '' }, '"Pizarra 6.10.4.8.2"');
  eq(m.interpretarPizarra('pizarra 6-10-4-8-2'), { llegada: '6.10.4.8.2', ret: '' }, 'con guiones');
  eq(m.interpretarPizarra('Llegada: 6 10 4 8 Ret 3, 7'), { llegada: '6.10.4.8', ret: '3, 7' }, '"Llegada: 6 10 4 8 Ret 3, 7" (con retirados)');
  check(m.interpretarPizarra('Pizarra') === null && m.interpretarPizarra('Pizarra 6') === null && m.interpretarPizarra('Pizarra: .....') === null, 'sin llegada válida no es una pizarra');
  eq(m.interpretarRetirados('Ret 3, 7'), '3, 7', '"Ret 3, 7"');
  const pizarras = [];
  deps.cargarPizarra = async x => { pizarras.push(x); return { ok: true, texto: '*RESULTADO DE LA CARRERA*\nGANAN: Marvel' }; };
  await motor.procesarMensaje(msg('j_dreamy', 'Mountaineer 2da carrera', { esAdmin: true }));
  await motor.procesarMensaje(msg('j_dreamy', 'Pizarra 3.1.2.4', { esAdmin: true }));
  check(pizarras.length === 0 && /no hay jugadas del bot pendientes para calcular/.test(ultima().t), 'pizarra en una carrera sin jugadas: avisa y no calcula nada');
  const ofP = msg('j_cachaco', 'Juego 4x1 con 75 doy a8');
  await motor.procesarMensaje(ofP);
  await motor.procesarMensaje(msg('j_marvel', '50', { citadoId: ofP.id }));
  await motor.procesarMensaje(msg('j_curioso', 'Pizarra 3.1.2.4'));
  check(pizarras.length === 0 && /no está autorizado para cargar la pizarra/.test(ultima().t), 'un jugador no puede cargar la pizarra: se le explica');
  await motor.procesarMensaje(msg('j_dreamy', 'Ret 7', { esAdmin: true }));
  check(/Retirados anotados: 7/.test(ultima().t), '"Ret 7" anota los retirados de la carrera');
  await motor.procesarMensaje(msg('j_dreamy', 'Pizarra 3-1-2-4', { esAdmin: true }));
  check(pizarras.length === 1 && pizarras[0].hipodromo === 'Mountaineer' && pizarras[0].carrera === 2 && pizarras[0].pizarra === '3.1.2.4' && pizarras[0].ret === '7' && pizarras[0].fecha === '2026-11-16', 'el administrador escribe la pizarra: se calcula esa carrera con la llegada y los retirados anotados');
  check(motor.estado().abierta === false, 'la pizarra cierra la carrera');
  check(/Pizarra cargada: \*Mountaineer, 2da Carrera\* — llegada 3\.1\.2\.4 \(Ret: 7\)/.test(enviadas[enviadas.length - 1].t) && publicadas[publicadas.length - 1] === '*RESULTADO DE LA CARRERA*\nGANAN: Marvel', 'el bot avisa y publica el resultado (quién gana y quién pierde)');
  deps.cargarPizarra = async () => ({ ok: false, motivo: 'esa carrera ya tiene un plano registrado.' });
  await motor.procesarMensaje(msg('j_dreamy', 'Pizarra 1.2.3', { esAdmin: true }));
  check(/No pude cargar la pizarra: esa carrera ya tiene un plano registrado/.test(ultima().t), 'si el sistema rechaza el cálculo, el bot dice el motivo');
  delete deps.cargarPizarra;

  // ---------- PIZARRA: otras formas de escribirla (18-11-2026) ----------
  eq(m.interpretarPizarra('pizarra 4 5 6 7'), { llegada: '4.5.6.7', ret: '' }, '"pizarra 4 5 6 7" (espacios)');
  eq(m.interpretarPizarra('llegada 4,5,6,7'), { llegada: '4.5.6.7', ret: '' }, '"llegada 4,5,6,7" (comas)');
  eq(m.interpretarPizarra('pizarra 4.5.6.7'), { llegada: '4.5.6.7', ret: '' }, '"pizarra 4.5.6.7" (puntos)');
  eq(m.interpretarPizarra('Pizarra 4/5/6/7'), { llegada: '4.5.6.7', ret: '' }, '"Pizarra 4/5/6/7" (barras)');
  eq(m.interpretarPizarra('pizarra 1 2 3 4 5 6 7 8'), { llegada: '1.2.3.4.5.6.7.8', ret: '' }, 'tantos puestos como hagan falta');
  eq(m.interpretarPizarra('Pizarra 5ta de gulf 4,5,6,7'), { llegada: '4.5.6.7', ret: '', carrera: 5, hipodromo: 'gulf' }, '"Pizarra 5ta de gulf 4,5,6,7" trae la carrera');
  eq(m.interpretarPizarra('pizarra gulf 5ta 4-5-6-7 ret 3'), { llegada: '4.5.6.7', ret: '3', carrera: 5, hipodromo: 'gulf' }, 'el hipódromo antes del número y con retirados');
  eq(m.interpretarPizarra('pizarra 5ta 4 5 6 7'), { llegada: '4.5.6.7', ret: '', carrera: 5 }, '"pizarra 5ta 4 5 6 7": solo el número de carrera');
  eq(m.interpretarPizarra('pizarra gulfstream park 8va carrera: 1.2.3'), { llegada: '1.2.3', ret: '', carrera: 8, hipodromo: 'gulfstream park' }, 'con "carrera" y dos puntos');
  check(m.interpretarPizarra('llegada tarde') === null && m.interpretarPizarra('pizarra gulf 4 5 6 7') === null, 'charla o pizarra sin número de carrera clara no se toma');
  eq(m.carreraDePlanoCitado('*🏇 Sistema Dream 🏇*\nLunes, 16 de Noviembre de 2026\nMountaineer, 3ra Carrera\nRet:\nPizarra: .....'), { hipodromo: 'Mountaineer', carrera: 3, fecha: '2026-11-16' }, 'de un plano del bot se saca la carrera y la fecha');
  check(m.carreraDePlanoCitado('hola buenas') === null && m.carreraDePlanoCitado(null) === null, 'un texto cualquiera no es un plano');

  const pizarras2 = [], resultados = [];
  deps.cargarPizarra = async x => { pizarras2.push(x); return { ok: true, texto: 'TXT', datosImagen: { grupo: 'X' } }; };
  deps.publicarResultado = async r => { resultados.push(r); };
  deps.cargarJugadas = async q => (q.carrera === 5 || q.carrera === 3 ? [{ monto: 10 }] : []);
  const antesAbierta = motor.estado();
  await motor.procesarMensaje(msg('j_dreamy', 'Pizarra 5ta de mountaineer 4,5,6,7', { esAdmin: true }));
  check(pizarras2.length === 1 && pizarras2[0].hipodromo === 'Mountaineer' && pizarras2[0].carrera === 5 && pizarras2[0].pizarra === '4.5.6.7' && pizarras2[0].fecha === '2026-11-16', 'pizarra con la carrera explícita: calcula esa carrera aunque la actual sea otra');
  check(resultados.length === 1 && resultados[0].texto === 'TXT' && motor.estado().carrera === antesAbierta.carrera, 'el resultado se publica con publicarResultado y no toca la carrera actual');
  await motor.procesarMensaje(msg('j_dreamy', 'pizarra 4 5 6', { esAdmin: true, citadoTexto: 'Mountaineer, 3ra Carrera\nLunes, 16 de Noviembre de 2026' }));
  check(pizarras2.length === 2 && pizarras2[1].carrera === 3 && pizarras2[1].hipodromo === 'Mountaineer' && pizarras2[1].pizarra === '4.5.6', 'pizarra citando el plano del bot: la carrera sale del plano citado');
  await motor.procesarMensaje(msg('j_dreamy', 'Pizarra 5ta de gulf 4 5 6 7', { esAdmin: true }));
  check(pizarras2.length === 2 && /No encuentro el hipódromo "gulf"/.test(ultima().t), 'un hipódromo que no existe en el grupo se avisa');
  await motor.procesarMensaje(msg('j_dreamy', 'Pizarra 9na de mountaineer 4 5 6 7', { esAdmin: true }));
  check(pizarras2.length === 2 && /no hay jugadas del bot pendientes para calcular/.test(ultima().t), 'una carrera sin jugadas pendientes no se calcula');
  await motor.procesarMensaje(msg('j_visita', 'Pizarra 5ta de mountaineer 4 5 6 7'));
  check(pizarras2.length === 2 && /no está autorizado para cargar la pizarra/.test(ultima().t), 'un jugador tampoco puede cargar una pizarra con carrera explícita');
  delete deps.publicarResultado;
  delete deps.cargarPizarra;
  deps.cargarJugadas = async () => [];

  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
