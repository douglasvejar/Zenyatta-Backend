// Prueba (04-10-2026): motor puro de "Jugadas entre Tercios Adelantadas"
// -- valida el parser/resolver contra TODAS las líneas y ejemplos
// reales/literales que dio el usuario en el chat (el plano de ejemplo
// completo + los fragmentos de aclaración de Raul/Hanry/Sammy/Ricky).
const {
  parsearLineaTerciosAdelantada,
  resolverLineaTerciosAdelantada,
  parsearPlanoTerciosAdelantadas,
  extraerPctDeTexto,
  extraerHipodromoDeTexto,
  parseCaballosToken
} = require('../src/services/hipismoTerciosAdelantadasCalc.js');
const { parsearPizarra, round2 } = require('../src/services/hipismoCalc.js');

let ok = 0, fallaron = 0;
function assertEq(desc, real, esperado) {
  const iguales = (typeof real === 'number' && typeof esperado === 'number')
    ? Math.abs(real - esperado) < 0.001
    : JSON.stringify(real) === JSON.stringify(esperado);
  if (iguales) { console.log(`OK   ${desc}`); ok++; }
  else { console.log(`FAIL ${desc}: real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`); fallaron++; }
}

// ================= parseCaballosToken: pegado SIEMPRE es el numero completo =================
// Corrección 04-10-2026: el usuario aclaró que un pegado SIN separador
// es SIEMPRE el número completo (nunca se parte por "plausibilidad") --
// para 2+ caballos hace falta un separador explícito: "y", "-", "." o "/".
assertEq('parseCaballosToken("47") -> UN caballo, el numero 47 completo', parseCaballosToken('47'), [47]);
assertEq('parseCaballosToken("78") -> UN caballo, el numero 78 completo', parseCaballosToken('78'), [78]);
assertEq('parseCaballosToken("10") -> UN caballo (diez)', parseCaballosToken('10'), [10]);
assertEq('parseCaballosToken("3") -> UN caballo', parseCaballosToken('3'), [3]);
assertEq('parseCaballosToken("4-7") -> separador explicito, dos caballos', parseCaballosToken('4-7'), [4, 7]);
assertEq('parseCaballosToken("4,7") -> separador explicito, dos caballos', parseCaballosToken('4,7'), [4, 7]);
assertEq('parseCaballosToken("4y7") -> separador explicito, dos caballos', parseCaballosToken('4y7'), [4, 7]);
assertEq('parseCaballosToken("4.7") -> separador explicito (punto), dos caballos', parseCaballosToken('4.7'), [4, 7]);
assertEq('parseCaballosToken("4/7") -> separador explicito (slash), dos caballos', parseCaballosToken('4/7'), [4, 7]);
assertEq('parseCaballosToken("10-15") -> separador explicito, NO se parte en digitos', parseCaballosToken('10-15'), [10, 15]);

// ================= Líneas del plano de ejemplo completo =================
{
  // "HANRY 2x7 20 DA HOUSTON" -- sin "juega", cruce pegado, monto antes de DA
  const p = parsearLineaTerciosAdelantada('HANRY 2x7 20 DA HOUSTON');
  assertEq('L1 jugador', p.jugadorNombre, 'HANRY');
  assertEq('L1 banquero', p.banqueroNombre, 'HOUSTON');
  assertEq('L1 monto', p.monto, 20);
  assertEq('L1 cruce', p.cruce, { gruposA: [2], gruposB: [7] });
  assertEq('L1 modalidad (ninguna -> pelo a pelo)', p.modalidad, null);
  assertEq('L1 sin errores', p.errores, { faltaJugador: false, faltaBanquero: false, faltaMonto: false, faltaApuesta: false });
}
{
  // "HANRY JUEGA 1X2 400 DA SAMMY"
  const p = parsearLineaTerciosAdelantada('HANRY JUEGA 1X2 400 DA SAMMY');
  assertEq('L2 jugador', p.jugadorNombre, 'HANRY');
  assertEq('L2 banquero', p.banqueroNombre, 'SAMMY');
  assertEq('L2 monto', p.monto, 400);
  assertEq('L2 cruce', p.cruce, { gruposA: [1], gruposB: [2] });
}
{
  // "MR INCREIBLE JUEGA 2Y2 DEL 2 DA RICKY 150" -- nombre de 2 palabras,
  // monto DESPUES del banquero (confirmado explicitamente por el usuario).
  const p = parsearLineaTerciosAdelantada('MR INCREIBLE JUEGA 2Y2 DEL 2 DA RICKY 150');
  assertEq('L3 jugador (nombre de 2 palabras)', p.jugadorNombre, 'MR INCREIBLE');
  assertEq('L3 banquero', p.banqueroNombre, 'RICKY');
  assertEq('L3 monto (viene DESPUES del banquero)', p.monto, 150);
  assertEq('L3 grupo (DEL 2 -> un solo caballo)', p.grupo, [2]);
  assertEq('L3 modalidad', p.modalidad, '2y2');
}
{
  // "GG JUEGA 2x1 20 DA ROJAS"
  const p = parsearLineaTerciosAdelantada('GG JUEGA 2x1 20 DA ROJAS');
  assertEq('L4 jugador', p.jugadorNombre, 'GG');
  assertEq('L4 banquero', p.banqueroNombre, 'ROJAS');
  assertEq('L4 monto', p.monto, 20);
  assertEq('L4 cruce', p.cruce, { gruposA: [2], gruposB: [1] });
}
{
  // "SAMMY JUEGA 3X6 10A8 DA RICKY" -- a esta le FALTA el monto
  // (confirmado explicitamente por el usuario: "esa jugada le falta el
  // monto, el empleado se equivoco al hacer el plano").
  const p = parsearLineaTerciosAdelantada('SAMMY JUEGA 3X6 10A8 DA RICKY');
  assertEq('L5 jugador', p.jugadorNombre, 'SAMMY');
  assertEq('L5 banquero', p.banqueroNombre, 'RICKY');
  assertEq('L5 cruce', p.cruce, { gruposA: [3], gruposB: [6] });
  assertEq('L5 modalidad (decimos)', p.modalidad, '10a8');
  assertEq('L5 FALTA el monto -> alerta, no bloquea el resto del plano', p.errores.faltaMonto, true);
  assertEq('L5 monto null', p.monto, null);
}
{
  // "RICKY JUEGA 10X3 27 DA HOUSTON" -- "10" debe quedar como UN
  // caballo (diez), no separarse en "1" y "0".
  const p = parsearLineaTerciosAdelantada('RICKY JUEGA 10X3 27 DA HOUSTON');
  assertEq('L6 jugador', p.jugadorNombre, 'RICKY');
  assertEq('L6 banquero', p.banqueroNombre, 'HOUSTON');
  assertEq('L6 monto', p.monto, 27);
  assertEq('L6 cruce (10 queda ENTERO, no se parte en digitos)', p.cruce, { gruposA: [10], gruposB: [3] });
}
{
  // "RAMBO JUEGO 2PTS 2Y3 DEL 4 180 DA MUJICA" -- prefijo decorativo
  // "2PTS" se ignora, la modalidad real es "2y3" ("jugada mixta...se
  // lee asi como leiste 2p/3n" -- en este caso concreto el usuario
  // confirmó que esta jugada es simplemente "2y3", el prefijo "2PTS" es
  // puro relleno/decorativo sin significado propio).
  const p = parsearLineaTerciosAdelantada('RAMBO JUEGO 2PTS 2Y3 DEL 4 180 DA MUJICA');
  assertEq('L7 jugador', p.jugadorNombre, 'RAMBO');
  assertEq('L7 banquero', p.banqueroNombre, 'MUJICA');
  assertEq('L7 monto', p.monto, 180);
  assertEq('L7 grupo (DEL 4)', p.grupo, [4]);
  assertEq('L7 modalidad (2PTS se ignora, queda 2y3)', p.modalidad, '2y3');
}

// ================= Fragmentos de aclaración (Raul/Hanry) =================
{
  // "raul juega 1p 47 con 300 da hanry" -- modalidad ANTES del grupo.
  // Corrección 04-10-2026: "47" pegado SIN separador es el caballo
  // número 47 completo (un solo caballo), no "4 y 7".
  const p = parsearLineaTerciosAdelantada('raul juega 1p 47 con 300 da hanry');
  assertEq('Raul#1 jugador', p.jugadorNombre, 'RAUL');
  assertEq('Raul#1 banquero', p.banqueroNombre, 'HANRY');
  assertEq('Raul#1 monto', p.monto, 300);
  assertEq('Raul#1 grupo (47 pegado -> UN caballo, el 47)', p.grupo, [47]);
  assertEq('Raul#1 modalidad', p.modalidad, '1p');
}
{
  // "raul puede jugar 4y7 x 7y8 con 300 lo da hanry" -- cruce de
  // GRUPOS con separador explícito "y" en cada lado (la forma real,
  // según la corrección del usuario -- "47 x 78" sin separador sería
  // caballo 47 contra caballo 78, cada uno un solo caballo).
  const p = parsearLineaTerciosAdelantada('raul puede jugar 4y7 x 7y8 con 300 lo da hanry');
  assertEq('Raul#2 jugador', p.jugadorNombre, 'RAUL');
  assertEq('Raul#2 banquero', p.banqueroNombre, 'HANRY');
  assertEq('Raul#2 monto', p.monto, 300);
  assertEq('Raul#2 cruce de grupos (4y7 x 7y8 -> {4,7} contra {7,8})', p.cruce, { gruposA: [4, 7], gruposB: [7, 8] });
  assertEq('Raul#2 sin modalidad (pelo a pelo)', p.modalidad, null);
}
{
  // "raul puede jugar 47 x 78 con 300 lo da hanry" -- SIN separador en
  // cada lado -> caballo 47 (uno solo) contra caballo 78 (uno solo).
  const p = parsearLineaTerciosAdelantada('raul puede jugar 47 x 78 con 300 lo da hanry');
  assertEq('Raul#2b cruce SIN separador -> un caballo por lado (47 contra 78)', p.cruce, { gruposA: [47], gruposB: [78] });
}
{
  // "raul puede juugar 47 10a8 con 400 los da hanry" (typo "juugar"
  // tolerado) -- grupo ANTES de la modalidad decimos, "47" = un solo
  // caballo (el 47).
  const p = parsearLineaTerciosAdelantada('raul puede juugar 47 10a8 con 400 los da hanry');
  assertEq('Raul#3 jugador', p.jugadorNombre, 'RAUL');
  assertEq('Raul#3 banquero', p.banqueroNombre, 'HANRY');
  assertEq('Raul#3 monto', p.monto, 400);
  assertEq('Raul#3 grupo (47 pegado -> UN caballo, el 47)', p.grupo, [47]);
  assertEq('Raul#3 modalidad (decimos, viene DESPUES del grupo)', p.modalidad, '10a8');
}
{
  // "raul 4y7 con 400" -- sin verbo y sin modalidad, CON separador
  // explícito -> grupo de 2 caballos; modalidad por defecto "1p" se
  // aplica al resolver (ver más abajo).
  const p = parsearLineaTerciosAdelantada('raul 4y7 con 400 da hanry');
  assertEq('Raul#4 jugador (sin verbo)', p.jugadorNombre, 'RAUL');
  assertEq('Raul#4 grupo (con separador explicito)', p.grupo, [4, 7]);
  assertEq('Raul#4 modalidad (ninguna indicada)', p.modalidad, null);
}

// ================= Resolución: ejemplo Sammy/Ricky (3x6 10a8, monto 100, comision 3%) =================
{
  const linea = { cruce: { gruposA: [3], gruposB: [6] }, grupo: null, modalidad: '10a8', monto: 100 };
  // Pizarra donde el 3 (jugador Sammy) llega de PRIMERO -> Sammy gana.
  const rank = parsearPizarra('3-6-1-2');
  const r = resolverLineaTerciosAdelantada(linea, rank, 3);
  assertEq('Sammy gana: cobra 100*0.8*0.97 = 77.6', r.montoJugadorMostrado, 77.6);
  assertEq('Sammy gana: Ricky (banquero) pierde COMPLETO los 80 (sin reducir)', r.montoBanqueroMostrado, -80);
  assertEq('Sammy gana: decidida', r.decidida, true);
}
{
  const linea = { cruce: { gruposA: [3], gruposB: [6] }, grupo: null, modalidad: '10a8', monto: 100 };
  // Pizarra donde el 6 (banquero Ricky) llega mejor que el 3 -> Sammy pierde.
  const rank = parsearPizarra('6-3-1-2');
  const r = resolverLineaTerciosAdelantada(linea, rank, 3);
  assertEq('Sammy pierde: pierde el monto COMPLETO, 100', r.montoJugadorMostrado, -100);
  assertEq('Sammy pierde: Ricky cobra 100*0.97 = 97', r.montoBanqueroMostrado, 97);
}

// ================= Resolución: ejemplo Raul/Hanry (47 x 78, pizarra "8-1-3-7-4") =================
{
  // Raul{4,7} contra Hanry{7,8}, pelo a pelo (sin decimos). Pizarra
  // "8-1-3-7-4": pos(8)=1, pos(1)=2, pos(3)=3, pos(7)=4, pos(4)=5.
  // Raul: mejor de {4,7} = min(pos(4)=5, pos(7)=4) = 4.
  // Hanry: mejor de {7,8} = min(pos(7)=4, pos(8)=1) = 1.
  // Hanry (banquero) gana porque 1 < 4.
  const linea = { cruce: { gruposA: [4, 7], gruposB: [7, 8] }, grupo: null, modalidad: null, monto: 300 };
  const rank = parsearPizarra('8-1-3-7-4');
  const r = resolverLineaTerciosAdelantada(linea, rank, 5);
  assertEq('Raul/Hanry: gana Hanry (jugador Raul pierde el monto completo)', r.montoJugadorMostrado, -300);
  assertEq('Raul/Hanry: Hanry (banquero) cobra 300*0.95 = 285', r.montoBanqueroMostrado, 285);
}

// ================= Resolución: grupo con decimos, "raul 47 10a8" -- gana si CUALQUIERA llega 1ro =================
{
  const linea = { cruce: null, grupo: [4, 7], modalidad: '10a8', monto: 400 };
  // El 7 llega de primero -> Raul gana (uno de sus 2 caballos llegó primero).
  const rank = parsearPizarra('7-1-2-3');
  const r = resolverLineaTerciosAdelantada(linea, rank, 5);
  assertEq('Raul#3 resuelto: gana (7 llego 1ro) cobra 400*0.8*0.95=304', r.montoJugadorMostrado, 304);
  assertEq('Raul#3 resuelto: Hanry pierde completo 320', r.montoBanqueroMostrado, -320);
}
{
  const linea = { cruce: null, grupo: [4, 7], modalidad: '10a8', monto: 400 };
  // Ninguno de los 2 llega de primero -> Raul pierde completo.
  const rank = parsearPizarra('1-4-7-3');
  const r = resolverLineaTerciosAdelantada(linea, rank, 5);
  assertEq('Raul#3 resuelto: pierde (ninguno llego 1ro) pierde 400 completo', r.montoJugadorMostrado, -400);
  assertEq('Raul#3 resuelto: Hanry cobra 400*0.95=380', r.montoBanqueroMostrado, 380);
}

// ================= Resolución: grupo SIN modalidad -> default "1p" =================
{
  const linea = { cruce: null, grupo: [4, 7], modalidad: null, monto: 400 };
  // El 7 llega 2do -> con 1p (top 1) NO alcanza, pierde.
  const rank = parsearPizarra('1-7-3');
  const r = resolverLineaTerciosAdelantada(linea, rank, 5);
  assertEq('Default 1p: 7 llega 2do, no alcanza para 1p -> pierde completo', r.montoJugadorMostrado, -400);
}
{
  const linea = { cruce: null, grupo: [4, 7], modalidad: null, monto: 400 };
  // El 4 llega 1ro -> con 1p gana completo -5%.
  const rank = parsearPizarra('4-7-3');
  const r = resolverLineaTerciosAdelantada(linea, rank, 5);
  assertEq('Default 1p: 4 llega 1ro -> gana 400*0.95=380', r.montoJugadorMostrado, 380);
}

// ================= Cruce "pelo a pelo": ninguno figura en la pizarra -> no se decide =================
{
  const linea = { cruce: { gruposA: [4], gruposB: [7] }, grupo: null, modalidad: null, monto: 100 };
  const rank = parsearPizarra('1-2-3');
  const r = resolverLineaTerciosAdelantada(linea, rank, 5);
  assertEq('Cruce sin ninguno en pizarra: NO se decide', r.decidida, false);
  assertEq('No se decide: comision del grupo es 0', r.comisionGrupo, 0);
}

// ================= Comisión del grupo (aplica igual que al cliente) =================
{
  const linea = { cruce: null, grupo: [4], modalidad: '1p', monto: 400 };
  const rank = parsearPizarra('4-7-3');
  const r = resolverLineaTerciosAdelantada(linea, rank, 5);
  // Ganancia cruda = 400, mostrada = 380 -> el grupo se queda con 20 (5%).
  assertEq('Comision del grupo = 5% de la ganancia (20 de 400)', r.comisionGrupo, 20);
}

// ================= parsearPlanoTerciosAdelantadas: el plano completo de ejemplo =================
{
  const planoTexto = `
*🏇🏻🇻🇪GRUPO ZENYATTA🐎🇻🇪*

*🇻🇪JUGADAS ADELANTADAS LA RINCONADA🇻🇪*

*1RA CARRERA*

*HANRY 2x7 20 DA HOUSTON*

*7MA CARRERA*

*HANRY JUEGA 1X2 400 DA SAMMY*

*MR INCREIBLE JUEGA 2Y2 DEL 2 DA RICKY 150*

*GG JUEGA 2x1 20 DA ROJAS*

*2DA CARRERA*

*SAMMY JUEGA 3X6 10A8 DA RICKY*

*9NA CARRERA*

*RICKY JUEGA 10X3 27 DA HOUSTON*

*8VA CARRERA*

*RAMBO JUEGO 2PTS 2Y3 DEL 4 180 DA MUJICA*

*NOTA= JUGADAS ADELANTADAS  -3%* 👀👀👀

👉🏼 *LOS PLANOS SON REFERENCIALES📝✍️*
👉🏼 *LA GUIA ES EL CHAT SE GANA Y PAGA CON EL CHAT* 📝
`;
  const r = parsearPlanoTerciosAdelantadas(planoTexto);
  assertEq('Plano: hipodromo', r.hipodromo, 'LA RINCONADA');
  assertEq('Plano: % sugerido', r.pctSugerido, 3);
  assertEq('Plano: 7 lineas reconocidas', r.lineas.length, 7);
  assertEq('Plano: L1 carrera 1', r.lineas[0].carreraNumero, 1);
  assertEq('Plano: L2 carrera 7', r.lineas[1].carreraNumero, 7);
  assertEq('Plano: L3 carrera 7', r.lineas[2].carreraNumero, 7);
  assertEq('Plano: L4 carrera 7', r.lineas[3].carreraNumero, 7);
  assertEq('Plano: L5 carrera 2', r.lineas[4].carreraNumero, 2);
  assertEq('Plano: L6 carrera 9', r.lineas[5].carreraNumero, 9);
  assertEq('Plano: L7 carrera 8', r.lineas[6].carreraNumero, 8);
  assertEq('Plano: L5 (Sammy) marcada con falta de monto', r.lineas[4].errores.faltaMonto, true);
  const otras = r.lineas.filter((_, idx) => idx !== 4);
  assertEq('Plano: ninguna otra linea con error', otras.every(l => !l.errores.faltaMonto && !l.errores.faltaJugador && !l.errores.faltaBanquero), true);
}

console.log(`\n${ok} OK, ${fallaron} FALLARON`);
if (fallaron > 0) process.exit(1);
