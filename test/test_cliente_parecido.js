// =================================================================
// PRUEBA: "Cliente doble" — alerta de nombres muy parecidos (29-09-2026,
// a pedido del usuario después del caso real de "mr increible" vs
// "mrincreible": 2 nombres TÉCNICAMENTE distintos —un espacio de
// diferencia— que en la práctica eran el mismo cliente y terminaron
// generando un "cliente fantasma" sin jugadas que rompía el Balance
// General de ese cliente ("mr increible se le devuelve el 1% y le
// coloque inlcuir % en sus jugadas y no sale como deberia sale -300").
//
// El nombre EXACTAMENTE igual ya estaba bloqueado desde antes por la
// base de datos (unique(grupo_id, nombre), sql/schema.sql) — esto es
// código NUEVO de FRONTEND (encontrarClienteParecido() en
// public/hipismo-mockup.html y encontrarJugadorParecido() en
// public/app.js, ambas idénticas) que agrega una ALERTA aparte (nunca un
// bloqueo — puede ser de verdad una persona distinta) para nombres CASI
// iguales, que el servidor no puede rechazar porque técnicamente son
// otro texto.
//
// Esos 2 archivos son código de navegador (no están armados para
// importarse con require() desde Node — ver la nota grande de
// generarTextoSabanaWhatsApp() en public/app.js / la copia en
// test_extraer_sabana_texto.js, mismo criterio ya establecido en este
// proyecto para probar lógica pura de frontend): acá abajo va una COPIA
// EXACTA de normalizarNombreParaComparar()/distanciaLevenshtein()/
// encontrarClienteParecido() tal como están en esos 2 archivos —
// MANTENER SINCRONIZADA si se toca cualquiera de las 2 copias.
// =================================================================

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// ---- COPIA EXACTA de public/hipismo-mockup.html / public/app.js ----
function normalizarNombreParaComparar(nombre) {
  return (nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '');
}
function distanciaLevenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const fila = new Array(n + 1);
  for (let j = 0; j <= n; j++) fila[j] = j;
  for (let i = 1; i <= m; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = fila[j];
      fila[j] = a[i - 1] === b[j - 1] ? anterior : 1 + Math.min(anterior, fila[j], fila[j - 1]);
      anterior = temp;
    }
  }
  return fila[n];
}
function encontrarClienteParecido(nombre, idPropioAExcluir, clientes) {
  const normalizadoNuevo = normalizarNombreParaComparar(nombre);
  if (!normalizadoNuevo) return null;
  for (const j of (clientes || [])) {
    if (idPropioAExcluir && String(j.id) === String(idPropioAExcluir)) continue;
    const normalizadoExistente = normalizarNombreParaComparar(j.nombre);
    if (normalizadoExistente === normalizadoNuevo) return j;
    if (normalizadoNuevo.length >= 8 && normalizadoExistente.length >= 8 &&
        distanciaLevenshtein(normalizadoExistente, normalizadoNuevo) <= 1) return j;
  }
  return null;
}
// ---- fin de la copia ----

const CLIENTES = [
  { id: 'a1', nombre: 'MR INCREIBLE' },
  { id: 'a2', nombre: 'SEBASTIAN GOMEZ' },
  { id: 'a3', nombre: 'RAMBO' },
  { id: 'a4', nombre: 'LUIS' },
  { id: 'a5', nombre: 'JOSE PEREZ' }
];

// 1) El caso real reportado: "MRINCREIBLE" (sin espacio) contra
// "MR INCREIBLE" (con espacio) ya registrado -> coincide siempre.
(() => {
  const r = encontrarClienteParecido('MRINCREIBLE', null, CLIENTES);
  check(!!r && r.id === 'a1', '1) "MRINCREIBLE" detecta como parecido a "MR INCREIBLE" (el bug real reportado)');
})();

// 2) Tildes + espacio de más también cuentan como "idéntico normalizado".
(() => {
  const r = encontrarClienteParecido('José   Pérez', null, CLIENTES);
  check(!!r && r.id === 'a5', '2) "José   Pérez" (con tildes y espacios de más) detecta como parecido a "JOSE PEREZ"');
})();

// 3) Typo de 1 sola letra en un nombre largo (8+ caracteres de los 2
// lados) -> coincide.
(() => {
  const r = encontrarClienteParecido('SEBASTIAN GOMES', null, CLIENTES); // Z -> S, 1 carácter distinto
  check(!!r && r.id === 'a2', '3) "SEBASTIAN GOMES" (1 letra distinta) detecta como parecido a "SEBASTIAN GOMEZ"');
})();

// 4) Nombres largos pero realmente distintos -> NO coincide.
(() => {
  const r = encontrarClienteParecido('ALEJANDRO TORRES', null, CLIENTES);
  check(r === null, '4) "ALEJANDRO TORRES" (nombre largo pero distinto de verdad) NO detecta ningún parecido');
})();

// 5) Nombres CORTOS con 1 carácter de diferencia -> NO coincide (evita
// falsos positivos como "LUIS" vs "LUISA", personas casi siempre
// distintas) — ver el umbral de 8+ caracteres en encontrarClienteParecido().
(() => {
  const r = encontrarClienteParecido('LUISA', null, CLIENTES);
  check(r === null, '5) "LUISA" NO detecta como parecido a "LUIS" (nombres cortos quedan afuera del umbral de Levenshtein a propósito)');
})();

// 6) Nombre corto EXACTO (mismas letras, sin espacios de más) sigue
// bloqueado por la rama de "idéntico normalizado" aunque sea corto — este
// caso ya lo cubre además la base de datos (unique(grupo_id, nombre)),
// pero el frontend también lo detecta antes de mandar nada al servidor.
(() => {
  const r = encontrarClienteParecido('Rambo', null, CLIENTES);
  check(!!r && r.id === 'a3', '6) "Rambo" (mismas letras, sin espacios de más) detecta como idéntico a "RAMBO"');
})();

// 7) idPropioAExcluir — nunca se compara un cliente contra sí mismo (caso
// real: abrir la ficha de "MR INCREIBLE" y guardar sin cambiar el
// nombre no debe disparar la alerta).
(() => {
  const r = encontrarClienteParecido('MR INCREIBLE', 'a1', CLIENTES);
  check(r === null, '7) Comparar "MR INCREIBLE" excluyendo su propio id (a1) no encuentra ningún parecido consigo mismo');
})();

// 8) Nombre vacío -> nunca hay "parecido" (evita reventar con el select
// de "+ Crear cliente" recién abierto, antes de escribir nada).
(() => {
  const r = encontrarClienteParecido('', null, CLIENTES);
  check(r === null, '8) Un nombre vacío nunca encuentra ningún parecido');
})();

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
