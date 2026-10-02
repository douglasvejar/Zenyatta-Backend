// =================================================================
// "% PROPIO" / CUENTAS DE COMISIÓN — lógica compartida (26-09-2026,
// extraída de routes/hipismo.js al arreglar "LOS LINK DE % NO DAN SALDO
// DICEN 0"). Antes estas 5 funciones vivían DENTRO de routes/hipismo.js
// y solo routes/hipismo.js podía usarlas; se sacan a este archivo propio
// para que services/hipismoResumenCliente.js (el que arma el resumen
// semanal de UN cliente, reusado por el portal público del cliente Y por
// "Detallado por Cliente" del Administrador) también pueda calcular el
// saldo real de una cuenta de comisión sin duplicar nada de esto.
//
// routes/hipismo.js sigue usando estas 5 funciones EXACTAMENTE igual que
// antes (Balance General de Cargar Planos/Remate, Comisiones Devueltas,
// Cierre Final, Saldo Comisiones, Traspaso de Comisión) — este archivo es
// un refactor puro de "dónde vive el código", sin cambiar ni una línea de
// la lógica ni de las consultas.
// =================================================================
const db = require('../db');
const { round2 } = require('./hipismoAdelantadasCalc');

// =================================================================
// "% DEVUELTO" POR CLIENTE (23-09-2026, undécima ronda) — a pedido del
// usuario, con un ejemplo numérico exacto: "si alguno de lo que pierde
// lleva comision o %... el cliente siempre va a jugar: si pierde pierde
// completo, si gana, gana -5%.... y APARTE en un item llama (nombre del
// cliente - porcentaje) alli es donde vas a colocar ese porcentaje que se
// va ganando el cliente carrera a carrera... supongamo... pedro tiene 1%
// de porcentaje entonces pedro jugo 100 y los pierde, en el plano... va a
// salir pedro -100, en el balance... esa carrera pedro -100 pero en el
// item pedro - porcentaje le va a salir en esa carrera +1".
//
// Reusa jugadores.comision_propia — el MISMO campo que ya usa Deportes
// para esto (ver services/comisiones.js: "% que gana sobre lo que ÉL
// arriesga"), compartido entre los 2 módulos en la misma tabla — nunca se
// aplica en el resultado normal del cliente (que siempre queda "pierde
// completo"/"gana -5%" tal cual, sin ajustar), sino en su propio ítem
// "{NOMBRE} - PORCENTAJE", siempre positivo (1% de lo que jugó, gane o
// pierda esa jugada puntual).
//
// REDIRECCIÓN AL AVAL (23-09-2026, duodécima-tercera ronda, a pedido del
// usuario: "en la pestaña clientes... si el porcentaje que se le
// devuelve no es para el si no para su aval, cuanto se le da de %"). Ver
// la nota grande en sql/schema.sql, columnas jugadores.avalado_por_id/
// porcentaje_devuelto_destino, y por qué esto NO reusa la tabla "avales"
// existente (concepto totalmente distinto, ver
// src/routes/jugadores.js). Cada nombre ahora resuelve a { pct, destino }
// — `destino` es el nombre del AVAL cuando porcentaje_devuelto_destino
// = 'aval' Y el aval está configurado; si no, es el mismo cliente (el
// comportamiento de siempre). El ítem "{destino} - PORCENTAJE" es a
// donde se acredita la plata; el cliente que lo GENERÓ (`nombre`) nunca
// se pierde — lo sigue mostrando GET /comisiones-devueltas tal cual
// (agrupado por quien apostó, no por quien cobra), a propósito, para que
// se pueda auditar "quién generó cuánto" aparte de "a quién se le pagó".
//
// ACTUALIZACIÓN 28-09-2026 ("en cliente la parte donde coloco el % que le
// genera a otro cliente dejame elegir varios ya que un cliente le puede
// generar % a varios" — de paso el usuario simplificó el otro campo: "%
// que se le devuelve" ahora SIEMPRE es para el propio cliente, se quita
// la opción de mandarlo al aval). Reemplaza el modelo viejo (UN solo aval
// por cliente vía jugadores.avalado_por_id + jugadores.
// porcentaje_devuelto_aval, y jugadores.porcentaje_devuelto_destino para
// elegir si comision_propia iba al cliente o a ese aval) por:
//   - comision_propia: siempre para el propio cliente (ya no se lee
//     porcentaje_devuelto_destino ni avalado_por_id para esta entrada).
//   - jugadores_avales_porcentaje: 0, 1 o VARIAS filas por cliente, cada
//     una con su propio avalador y su propio %, 100% independientes
//     entre sí y de comision_propia — cada fila es un ítem "{avalador} -
//     PORCENTAJE" propio. Ver la nota grande de esta tabla en
//     sql/schema.sql (incluye la migración de los datos viejos).
// "INCLUIR % EN SUS JUGADAS" (29-09-2026, ver la nota grande en
// sql/schema.sql, columna jugadores.incluir_porcentaje_en_jugadas, y el
// pedido del usuario al inicio de este archivo). Cuando un jugador tiene
// este toggle en ON, su comisión propia (entrada 1, `esAvalAdicional:
// false`) YA NO se acredita en una cuenta aparte "{nombre} -
// PORCENTAJE" — en cambio se marca `incluidaEnJugada: true` y
// `cuentaNombre` pasa a ser su PROPIO nombre, para que se acumule DIRECTO
// en su propia fila de balance (ver /cierre-final y /semana-por-dias en
// routes/hipismo.js, que agrupan por `cuentaNombre` sin saber nada de
// este toggle — el "merge" ocurre solo). Los reportes de auditoría
// puramente informativos (/comisiones-devueltas,
// /comisiones-devueltas-por-hipodromo, /saldo-comisiones) usan
// `incluidaEnJugada` para NO repetir esa plata aparte (ya está adentro
// de la jugada). Lo que este cliente gane por avalar a OTROS (entradas
// 2..N, `esAvalAdicional: true`) NUNCA se ve afectado por este toggle —
// sigue siempre yendo a su cuenta "{nombre} - PORCENTAJE" tal cual.
// Colapsa espacios de más entre palabras (además de mayúscula/trim) —
// mismo criterio que normalizarNombreJugador() en routes/jugadores.js.
// Se usa acá SOLO para EMPAREJAR (nunca para decidir qué se guarda), ver
// la nota grande de "CLIENTE DOBLE" POR ESPACIOS DE MÁS más abajo.
function normalizarParaEmparejar(nombre) {
  return (nombre || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
}

// =================================================================
// buscarOCrearFicha() (02-10-2026, a pedido del usuario después del caso
// real de "Agregados Ferrocarril - porcentaje - porcentaje"): reemplaza
// a crearYLinkearCuentaComision()/asegurarCuentasComisionParaNombres()
// como la forma de resolver la ficha donde va un % — el usuario fue
// explícito: "no quiero que se creen los agregados porcentaje
// automatico, quiero que yo elija en que ficha y como yo quiera que se
// llame la ficha donde va ese %". Antes, el sistema SIEMPRE inventaba el
// nombre "{Cliente} - PORCENTAJE" por su cuenta (y lo hacía en el momento
// de calcular un Plano/Remate, sin que el operador lo viera venir) — eso
// es justo lo que generó el bug real: una ficha YA auto-creada con ese
// sufijo ("Agregados Ferrocarril - PORCENTAJE") terminó, sin que nadie lo
// pidiera, con su PROPIO % configurado encima (o puesta como aval de
// otro cliente), y el sistema le volvió a pegar "- PORCENTAJE" por
// segunda vez.
//
// De ahora en adelante, el NOMBRE de esa ficha lo escribe el operador
// (en la ficha del Cliente, al configurar su % propio o un aval — ver
// routes/jugadores.js) ANTES de que exista cualquier Plano/Remate, nunca
// se inventa solo. Esta función solo busca-o-crea esa ficha EXACTA que
// el operador pidió:
//   - Si ya existe un jugador en el grupo con ese nombre (comparación
//     normalizada, mismo criterio que normalizarParaEmparejar — no
//     importa mayúscula/espacios de más), se REUSA tal cual está (puede
//     ser una cuenta de comisión dedicada YA creada antes, o incluso un
//     cliente real que SÍ juega — routes/jugadores.js es quien decide si
//     hace falta avisar de eso antes de llamar acá, ver
//     advierteSiEsClienteReal más abajo).
//   - Si no existe, se crea una ficha NUEVA marcada es_cuenta_comision
//     (para que no se ofrezca como "quién apostó" en Cargar Planos/
//     Remates/Adelantadas), con el nombre EXACTO que pidió el operador
//     (normalizado igual que cualquier otro nombre de cliente, ver
//     normalizarNombreJugador en routes/jugadores.js).
// Devuelve null si nombreTexto viene vacío.
async function buscarOCrearFicha(grupoId, nombreTexto) {
  const nombreNorm = (nombreTexto || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
  if (!nombreNorm) return null;
  const rTodos = await db.query('SELECT id, nombre, es_cuenta_comision FROM jugadores WHERE grupo_id = $1', [grupoId]);
  const existente = rTodos.rows.find(j => normalizarParaEmparejar(j.nombre) === nombreNorm);
  if (existente) {
    return { id: existente.id, nombre: existente.nombre, esNuevo: false, esClienteReal: !existente.es_cuenta_comision };
  }
  const r = await db.query(
    `INSERT INTO jugadores (grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial, es_cuenta_comision)
     VALUES ($1, $2, true, true, 'libre', 0, true) RETURNING id, nombre`,
    [grupoId, nombreNorm]
  );
  return { id: r.rows[0].id, nombre: r.rows[0].nombre, esNuevo: true, esClienteReal: false };
}

async function obtenerComisionesPropias(grupoId, nombres) {
  const unicos = Array.from(new Set((nombres || []).filter(Boolean)));
  if (!unicos.length) return {};
  // cc_propio (26-09-2026): la cuenta de comisión REAL de cada cliente
  // (jugadores.cuenta_comision_id, ver la nota grande en sql/schema.sql)
  // — si ya existe (se crea sola al confirmar un Plano/Remate, ver
  // asegurarCuentasComisionParaNombres más abajo), su NOMBRE ACTUAL manda
  // sobre el texto armado a mano, así que renombrarla desde
  // Administración > Clientes se refleja acá para siempre.
  const rJugadores = await db.query(
    `SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas
       FROM jugadores j
       LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id
      WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])`,
    [grupoId, unicos]
  );

  // =================================================================
  // "CLIENTE DOBLE" POR ESPACIOS DE MÁS (29-09-2026, a pedido del usuario
  // después del caso real: "mr increible se le devuelve el 1%... y no
  // sale como deberia sale -300"). El match de arriba (j.nombre = ANY(...))
  // es EXACTO letra por letra; si alguna jugada real ya quedó guardada en
  // hipismo_tickets/hipismo_adelantadas_jugadas con un espacio de más
  // entre palabras (ej. "MR  INCREIBLE" con doble espacio — INVISIBLE en
  // el navegador, que colapsa espacios de más al mostrar texto, así que
  // el cliente se ve idéntico en Balance General y en Clientes) ese
  // nombre no calza ahí y su % queda sin aplicarse, sin ningún aviso. De
  // acá en adelante esto ya no debería volver a pasar (ver la
  // normalización agregada en hipismoCalc.js/hipismoAdelantadasCalc.js/
  // routes/jugadores.js), pero una jugada YA guardada de antes sigue
  // así hasta que se re-guarde — por eso, para los nombres que NO
  // calzaron arriba, se trae (una sola vez) TODOS los jugadores del
  // grupo y se empareja acá en JS, colapsando espacios de más de los 2
  // lados. Solo se dispara si de verdad hace falta (`faltantes` no
  // vacío), así que el camino feliz de siempre (todo calza exacto) no
  // cambia en nada.
  const encontrados = new Set(rJugadores.rows.map(j => j.nombre));
  const faltantes = unicos.filter(n => !encontrados.has(n));
  // filasConClave: cada fila de jugador emparejada, junto con la CLAVE
  // ORIGINAL (el nombre tal cual aparece en la jugada real) bajo la que
  // tiene que quedar en `mapa` — para el camino feliz son el mismo texto;
  // para un rescate por espacios de más, la clave sigue siendo la de la
  // jugada real (para que agregarPorcentajeDevuelto() la encuentre), pero
  // los datos del jugador (nombre limpio, %, cuenta de comisión) son los
  // de su ficha real.
  const filasConClave = rJugadores.rows.map(j => ({ j, claveOriginal: j.nombre }));
  if (faltantes.length) {
    const rTodos = await db.query(
      `SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas
         FROM jugadores j
         LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id
        WHERE j.grupo_id = $1`,
      [grupoId]
    );
    const porNormalizado = new Map();
    rTodos.rows.forEach(j => { if (!encontrados.has(j.nombre)) porNormalizado.set(normalizarParaEmparejar(j.nombre), j); });
    faltantes.forEach(nombreOriginal => {
      const match = porNormalizado.get(normalizarParaEmparejar(nombreOriginal));
      if (match) filasConClave.push({ j: match, claveOriginal: nombreOriginal });
    });
  }

  const idsJugadores = filasConClave.map(({ j }) => j.id);
  const avalesPorJugadorId = {};
  if (idsJugadores.length) {
    // 02-10-2026: ya NO se junta con la "cuenta de comisión propia" del
    // avalador (cc_av/avalador.cuenta_comision_id) — desde este cambio,
    // avalador_id YA ES directamente la ficha elegida por el operador al
    // configurar el aval (ver buscarOCrearFicha más arriba y
    // routes/jugadores.js), así que avalador_nombre es, de una vez, el
    // nombre final a acreditar — sin ninguna capa de sufijo automático
    // por detrás.
    const rAvales = await db.query(
      `SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre
         FROM jugadores_avales_porcentaje jap
         JOIN jugadores av ON av.id = jap.avalador_id
        WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])`,
      [grupoId, idsJugadores]
    );
    rAvales.rows.forEach(fila => {
      if (!avalesPorJugadorId[fila.jugador_id]) avalesPorJugadorId[fila.jugador_id] = [];
      avalesPorJugadorId[fila.jugador_id].push(fila);
    });
  }
  const mapa = {};
  filasConClave.forEach(({ j, claveOriginal }) => {
    const entradas = [];
    // Entrada 1: comision_propia — SIEMPRE para el propio cliente. Si el
    // toggle "incluir % en sus jugadas" está en ON, en vez de una cuenta
    // aparte se marca `incluidaEnJugada` y `cuentaNombre` es `claveOriginal`
    // (el mismo nombre bajo el que se acumuló su propia jugada más arriba
    // — nunca j.nombre a secas, para que el % quede SIEMPRE en la misma
    // fila que su jugada, incluso en el caso de rescate por espacios de
    // más de arriba, donde j.nombre podría no ser byte-a-byte igual a
    // como se acumuló la jugada).
    const pctPropio = Number(j.comision_propia) || 0;
    if (pctPropio) {
      if (j.incluir_porcentaje_en_jugadas) {
        entradas.push({ pct: pctPropio, destino: j.nombre, cuentaNombre: claveOriginal, esAvalAdicional: false, incluidaEnJugada: true });
      } else {
        const cuentaNombre = j.cc_propio_nombre || `${j.nombre} - PORCENTAJE`;
        entradas.push({ pct: pctPropio, destino: j.nombre, cuentaNombre, esAvalAdicional: false });
      }
    }
    // Entradas 2..N: una por cada avalador configurado en
    // jugadores_avales_porcentaje, cada una con su propio %. 02-10-2026:
    // cuentaNombre YA ES avalador_nombre directo (ver la nota grande de
    // la consulta de arriba) — nunca más "{destino} - PORCENTAJE"
    // inventado acá.
    (avalesPorJugadorId[j.id] || []).forEach(fila => {
      const pctAval = Number(fila.porcentaje) || 0;
      if (!pctAval) return;
      const destino = fila.avalador_nombre;
      entradas.push({ pct: pctAval, destino, cuentaNombre: destino, esAvalAdicional: true });
    });
    mapa[claveOriginal] = entradas;
  });
  return mapa;
}

// Crea (si hace falta) la cuenta de comisión REAL de `jugadorId` y la
// enlaza en jugadores.cuenta_comision_id — nombrada igual que el texto
// de siempre ("{nombreBase} - PORCENTAJE"), marcada es_cuenta_comision
// para que Cargar Planos/Remates no la ofrezcan como "quién apostó". El
// ON CONFLICT cubre 2 confirmaciones casi simultáneas para el mismo
// cliente sin crear 2 cuentas.
async function crearYLinkearCuentaComision(grupoId, jugadorId, nombreBase) {
  const nombreCuenta = `${nombreBase} - PORCENTAJE`;
  const rCuenta = await db.query(
    `INSERT INTO jugadores (grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial, es_cuenta_comision)
     VALUES ($1, $2, true, true, 'libre', 0, true)
     ON CONFLICT (grupo_id, nombre) DO UPDATE SET es_cuenta_comision = true
     RETURNING id`,
    [grupoId, nombreCuenta]
  );
  const cuentaId = rCuenta.rows[0].id;
  await db.query(
    `UPDATE jugadores SET cuenta_comision_id = $1 WHERE id = $2 AND grupo_id = $3 AND cuenta_comision_id IS NULL`,
    [cuentaId, jugadorId, grupoId]
  );
}

// Se llama SOLO al GUARDAR de verdad un Plano o un Remate (nunca en la
// vista previa de "Calcular", para no crear cuentas de cálculos que el
// operador después no confirma) — antes de leer obtenerComisionesPropias
// para el guardado real, se asegura de que cada jugador que tenga % PROPIO
// (comisionPropia, nunca aval) YA tenga su cuenta de comisión real
// enlazada, como red de seguridad.
//
// 02-10-2026 (a pedido del usuario, ver la nota grande de buscarOCrearFicha
// más arriba): esto YA NO es el camino normal para crear esa ficha — desde
// esta ronda, el operador elige el nombre él mismo en la ficha del Cliente
// (routes/jugadores.js, comisionPropiaFicha) o lo confirma en "Revisar %
// Automáticos" (GET/POST /jugadores/.../comisiones-automaticas). Esta
// función queda SOLO como red de seguridad para un cliente viejo que
// todavía no pasó por ninguno de los 2 (cuenta_comision_id sigue en
// NULL) — una vez que ese cliente se revisa/confirma una vez, nunca
// vuelve a entrar acá (el IF de abajo ya no encuentra nada que hacer).
// El lado de AVALES que vivía acá (crear una cuenta "{avalador} -
// PORCENTAJE" aparte) SE QUITÓ por completo: desde este cambio,
// avalador_id YA ES la ficha elegida por el operador al configurar el
// aval (ver obtenerComisionesPropias más arriba) — crear algo más encima
// sería exactamente el bug que se está arreglando.
async function asegurarCuentasComisionParaNombres(grupoId, nombres) {
  const unicos = Array.from(new Set((nombres || []).filter(Boolean)));
  if (!unicos.length) return;
  const rJugadores = await db.query(
    `SELECT id, nombre, comision_propia, cuenta_comision_id, incluir_porcentaje_en_jugadas FROM jugadores WHERE grupo_id = $1 AND nombre = ANY($2::text[])`,
    [grupoId, unicos]
  );
  // "CLIENTE DOBLE" POR ESPACIOS DE MÁS (29-09-2026, ver la nota grande
  // de obtenerComisionesPropias más arriba) — mismo rescate: si algún
  // nombre de `unicos` no calzó arriba por un espacio de más entre
  // palabras, se busca también por nombre normalizado, para que la
  // cuenta de comisión real se termine creando/enlazando igual, sin
  // depender de que el nombre quede byte-a-byte idéntico. Solo se
  // dispara si de verdad hace falta, así que el camino feliz de siempre
  // no cambia en nada.
  const filas = rJugadores.rows.slice();
  const encontrados = new Set(filas.map(j => j.nombre));
  const faltantes = unicos.filter(n => !encontrados.has(n));
  if (faltantes.length) {
    const rTodos = await db.query(
      `SELECT id, nombre, comision_propia, cuenta_comision_id, incluir_porcentaje_en_jugadas FROM jugadores WHERE grupo_id = $1`,
      [grupoId]
    );
    const porNormalizado = new Map();
    rTodos.rows.forEach(j => { if (!encontrados.has(j.nombre)) porNormalizado.set(normalizarParaEmparejar(j.nombre), j); });
    faltantes.forEach(nombreOriginal => {
      const match = porNormalizado.get(normalizarParaEmparejar(nombreOriginal));
      if (match && !filas.some(f => f.id === match.id)) filas.push(match);
    });
  }
  for (const j of filas) {
    const pctPropio = Number(j.comision_propia) || 0;
    // Con el toggle en ON no hace falta ninguna cuenta aparte para su
    // propia comisión (se acumula directo en su propia fila) — ver la
    // nota grande de obtenerComisionesPropias más arriba.
    if (pctPropio && !j.cuenta_comision_id && !j.incluir_porcentaje_en_jugadas) {
      await crearYLinkearCuentaComision(grupoId, j.id, j.nombre);
    }
  }
}

// Acumula en `totales` el ítem "{destino} - PORCENTAJE" de cada entrada
// { nombre, monto } (el monto APOSTADO de esa línea puntual, nunca el
// resultado) cuyo cliente tenga % propio y/o % de aval configurado (> 0)
// — `destino` es el propio cliente, su aval "de siempre" (destino=
// 'aval'), o su aval por el % ADICIONAL nuevo — pueden ser 2 ítems
// distintos a la vez para el mismo cliente (ver la nota grande de
// obtenerComisionesPropias). Muta `totales` en el lugar (mismo criterio
// que el resto de los merges de Balance General de este archivo).
function agregarPorcentajeDevuelto(totales, comisionesPropias, entradas) {
  (entradas || []).forEach(({ nombre, monto }) => {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return;
    infos.forEach(info => {
      if (!info || !info.pct) return;
      const devuelto = round2(Math.abs(Number(monto) || 0) * (info.pct / 100));
      if (!devuelto) return;
      // 26-09-2026: info.cuentaNombre YA es el nombre final a mostrar
      // (el de la cuenta de comisión real si ya existe, o el texto de
      // siempre como vista previa — ver la nota grande de
      // obtenerComisionesPropias más arriba); info.destino en cambio es
      // el nombre "pelado" del cliente/aval, usado solo para AUDITAR
      // quién generó el % en los otros reportes.
      const clave = info.cuentaNombre;
      totales[clave] = round2((totales[clave] || 0) + devuelto);
    });
  });
}

// Suma neta de ajustes de traspaso de comisión por cliente, en un rango
// de fechas — ver la nota grande de POST /comisiones/traspaso (routes/
// hipismo.js). Devuelve {} si nunca se hizo ningún traspaso (tabla vacía
// = sin efecto, no afecta ninguna semana de antes de que existiera esta
// función).
async function obtenerAjustesComision(grupoId, desde, hasta) {
  const r = await db.query(
    'SELECT cliente_nombre, COALESCE(SUM(monto), 0) AS total FROM hipismo_comisiones_ajustes WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY cliente_nombre',
    [grupoId, desde, hasta]
  );
  const mapa = {};
  r.rows.forEach(row => { mapa[row.cliente_nombre] = Number(row.total); });
  return mapa;
}

module.exports = {
  obtenerComisionesPropias,
  buscarOCrearFicha,
  crearYLinkearCuentaComision,
  asegurarCuentasComisionParaNombres,
  agregarPorcentajeDevuelto,
  obtenerAjustesComision
};
