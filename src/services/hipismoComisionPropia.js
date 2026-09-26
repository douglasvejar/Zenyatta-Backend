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
// ACTUALIZACIÓN 24-09-2026 ("hay clientes que generan % para el mismo y
// aparte le generan % a su avalador....." — confirmado por
// AskUserQuestion: "Dos % independientes y simultáneos"): cada cliente
// puede ahora generar HASTA 2 créditos de "% devuelto" a la vez sobre el
// MISMO monto apostado, así que el valor de este mapa pasó de ser un
// solo { pct, destino } a ser un ARREGLO de ellos (puede venir vacío,
// con 1, o con 2 entradas) — ver jugadores.porcentaje_devuelto_aval en
// la nota grande de sql/schema.sql, que es 100% independiente y no toca
// para nada comision_propia/porcentaje_devuelto_destino de siempre.
async function obtenerComisionesPropias(grupoId, nombres) {
  const unicos = Array.from(new Set((nombres || []).filter(Boolean)));
  if (!unicos.length) return {};
  // cc_propio/cc_aval (26-09-2026): la cuenta de comisión REAL de cada
  // posible destino (jugadores.cuenta_comision_id, ver la nota grande en
  // sql/schema.sql) — si ya existe (se crea sola al confirmar un Plano/
  // Remate, ver asegurarCuentasComisionParaNombres más abajo), su NOMBRE
  // ACTUAL manda sobre el texto armado a mano, así que renombrarla desde
  // Administración > Clientes se refleja acá para siempre.
  const r = await db.query(
    `SELECT j.nombre, j.comision_propia, j.porcentaje_devuelto_destino, j.porcentaje_devuelto_aval, av.nombre AS aval_nombre,
            cc_propio.nombre AS cc_propio_nombre, cc_aval.nombre AS cc_aval_nombre
       FROM jugadores j
       LEFT JOIN jugadores av ON av.id = j.avalado_por_id
       LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id
       LEFT JOIN jugadores cc_aval ON cc_aval.id = av.cuenta_comision_id
      WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])`,
    [grupoId, unicos]
  );
  const mapa = {};
  r.rows.forEach(j => {
    const entradas = [];
    // Entrada 1: la de siempre — comision_propia, para el cliente o para
    // su aval según porcentaje_devuelto_destino (sin cambios).
    const pctPropio = Number(j.comision_propia) || 0;
    if (pctPropio) {
      const usaAval = j.porcentaje_devuelto_destino === 'aval' && j.aval_nombre;
      const destino = usaAval ? j.aval_nombre : j.nombre;
      const cuentaNombre = (usaAval ? j.cc_aval_nombre : j.cc_propio_nombre) || `${destino} - PORCENTAJE`;
      entradas.push({ pct: pctPropio, destino, cuentaNombre, esAvalAdicional: false });
    }
    // Entrada 2 (NUEVA): porcentaje_devuelto_aval, siempre y cuando este
    // cliente tenga un aval configurado — INDEPENDIENTE y SIMULTÁNEA a
    // la de arriba, con su propio %, siempre acreditada al aval (nunca
    // al propio cliente — para eso ya está la entrada 1 con destino
    // ='cliente').
    const pctAval = Number(j.porcentaje_devuelto_aval) || 0;
    if (pctAval && j.aval_nombre) {
      const destino = j.aval_nombre;
      const cuentaNombre = j.cc_aval_nombre || `${destino} - PORCENTAJE`;
      entradas.push({ pct: pctAval, destino, cuentaNombre, esAvalAdicional: true });
    }
    mapa[j.nombre] = entradas;
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
// para el guardado real, se asegura de que cada jugador (o su aval) que
// vaya a generar comisión YA tenga su cuenta de comisión real enlazada.
async function asegurarCuentasComisionParaNombres(grupoId, nombres) {
  const unicos = Array.from(new Set((nombres || []).filter(Boolean)));
  if (!unicos.length) return;
  const r = await db.query(
    `SELECT j.id, j.nombre, j.comision_propia, j.porcentaje_devuelto_destino, j.porcentaje_devuelto_aval, j.cuenta_comision_id,
            av.id AS aval_id, av.nombre AS aval_nombre, av.cuenta_comision_id AS aval_cuenta_comision_id
       FROM jugadores j
       LEFT JOIN jugadores av ON av.id = j.avalado_por_id
      WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])`,
    [grupoId, unicos]
  );
  for (const j of r.rows) {
    const pctPropio = Number(j.comision_propia) || 0;
    const pctAval = Number(j.porcentaje_devuelto_aval) || 0;
    if (pctPropio) {
      const usaAval = j.porcentaje_devuelto_destino === 'aval' && j.aval_id;
      if (usaAval) {
        if (!j.aval_cuenta_comision_id) await crearYLinkearCuentaComision(grupoId, j.aval_id, j.aval_nombre);
      } else if (!j.cuenta_comision_id) {
        await crearYLinkearCuentaComision(grupoId, j.id, j.nombre);
      }
    }
    if (pctAval && j.aval_id && !j.aval_cuenta_comision_id) {
      await crearYLinkearCuentaComision(grupoId, j.aval_id, j.aval_nombre);
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
  crearYLinkearCuentaComision,
  asegurarCuentasComisionParaNombres,
  agregarPorcentajeDevuelto,
  obtenerAjustesComision
};
