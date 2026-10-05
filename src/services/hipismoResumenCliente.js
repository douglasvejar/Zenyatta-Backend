// =================================================================
// Resumen semanal de UN cliente de Hipismo (24-09-2026, a pedido del
// usuario: nueva pestaña "Saldos > Detallado por Cliente" — "basicamente
// lo mismo que balance general pero al darle click al cliente puedo ver
// todas sus jugadas, asi como ellos la ven en sus links personalizados").
//
// Esto es EXACTAMENTE el mismo armado (día > hipódromo > carreras, con
// Deportes "anclado" si aplica) que ya usaba routes/hipismoCliente.js
// (el portal público, sin login, por token) — se saca a este archivo
// propio para poder reusarlo tal cual desde 2 lugares sin duplicar la
// lógica:
//   1) el portal público del cliente (routes/hipismoCliente.js, busca al
//      jugador por su token, sin sesión), y
//   2) la nueva pantalla del Administrador "Detallado por Cliente"
//      (GET /api/hipismo/clientes/:nombre/detalle-semana en
//      routes/hipismo.js, con sesión normal, busca al jugador por
//      nombre+grupo) — así el Administrador ve EXACTAMENTE lo mismo que
//      el cliente ve en su propio link, sin poder desviarse nunca de esa
//      fuente ("puedo ver todas sus jugadas, asi como ellos la ven en
//      sus links personalizados").
const { obtenerLineasHipismoCliente } = require('./hipismoLineasCliente');
const { leerHistorial } = require('./historial');
const db = require('../db');
const { round2, montoDecididoExacto, montoBaseComisionExacto } = require('./hipismoAdelantadasCalc');
const { montoBaseTerciosAdelantadaExacto } = require('./hipismoTerciosAdelantadasCalc');
const { obtenerCargasEspecialesRango } = require('./hipismoCargasEspeciales');
const { urlLogoGrupo, temaColorGrupo } = require('./logoGrupo');
// obtenerComisionesPropias (26-09-2026, ver la nota grande de
// construirResumenCuentaComisionHipismo más abajo) — MISMA función que ya
// usa routes/hipismo.js para Balance General/Cierre Final/Saldo
// Comisiones, ahora en su propio archivo (services/hipismoComisionPropia.js)
// precisamente para poder reusarla acá sin duplicarla.
const { obtenerComisionesPropias, obtenerAjustesComision } = require('./hipismoComisionPropia');
// calcularAjustesCruce (30-09-2026, ver la nota grande de
// construirCierreFinalHipismo más abajo) — misma función que ya usaba
// GET /cierre-final en routes/hipismo.js.
// netearJugadorBanqueroTercios (02-10-2026, ver la nota grande EXACTA junto
// a su definición en hipismoCalc.js — caso GG "juega y banquea y queda en
// 0 en esa carrera"): necesaria acá porque construirCierreFinalHipismo es
// la referencia "golden" del % devuelto para TODOS los clientes a la vez
// (Balance General/Cierre Final) — sin este neteo, GG saldría cobrando %
// devuelto sobre su lado jugador Y su lado banquero por separado, nunca
// neteados, justo la inconsistencia que el usuario pidió corregir en TODOS
// los reportes que tocan % devuelto.
const { calcularAjustesCruce, netearJugadorBanqueroTercios } = require('./hipismoCalc');
// numeroSemanaISO (03-10-2026, a pedido del usuario: nombrar la carpeta
// de "Copiar Imagen HD" como "Semana (cliente), (del día al día, semana
// X del año)" -- mismo cálculo EXACTO que ya usan Cierre Final/Balance
// General/Semana por Días para mostrar "Semana X de YYYY" en pantalla
// (ver routes/hipismo.js), ahora expuesto también acá para que el link
// propio del cliente (y el Detallado por Cliente del Administrador, que
// reusa esta misma función) lo tenga disponible sin tener que
// recalcularlo en el frontend.
const { numeroSemanaISO } = require('./fechaSemana');

// "⚽ Deportes" se guarda como un hipódromo más dentro de "dias[].hipodromos"
// (mismo shape que un hipódromo real), pero con tipo:'deportes' — ver la
// nota grande que tenía routes/hipismoCliente.js antes de este refactor.
const NOMBRE_BLOQUE_DEPORTES = 'Deportes';
// "🔄 Traspasos de Comisión" (26-09-2026, ver la nota grande de
// construirResumenCuentaComisionHipismo más abajo) — mismo criterio que
// el bloque de Deportes de arriba: un pseudo-hipódromo más dentro de
// "dias[].hipodromos", con tipo:'traspaso', SOLO puede aparecer en el
// resumen de una cuenta de comisión (nunca en el de un cliente normal).
const NOMBRE_BLOQUE_TRASPASOS = 'Traspasos de Comisión';
const NOMBRE_BLOQUE_CARGA_ESPECIAL = 'Carga Masiva Especial';
// Mismo nombre de ítem que ya usaba GET /cierre-final en routes/hipismo.js
// (NOMBRE_ITEM_REMATE) — ver la nota grande de construirCierreFinalHipismo
// más abajo.
const NOMBRE_ITEM_REMATE = 'REMATE';

function resultadoTicketDeportes(t) {
  if (t.estado === 'GANADA') return t.gana;
  if (t.estado === 'PERDIDA') return -t.arriesga;
  return 0;
}

// montoBaseParaPct(linea) (02-10-2026, a pedido del usuario: "LOS % QUE SE
// DEVUELVEN ES DE LO DECIDIDO NO DE LO APOSTADO... SIEMPRE ES BASE A LO
// DECIDIDO SIN SACARLE EL 5%... LO QUE SE DECIDA EN LA JUGADA NETA") —
// toma una línea de obtenerLineasHipismoCliente() (services/
// hipismoLineasCliente.js) y devuelve la base correcta sobre la que debe
// calcularse el % propio/de aval de un cliente (o de su banquero), para
// CUALQUIER tipo de línea: nunca `linea.monto` (lo apostado bruto), salvo
// que coincida con lo decidido (como en una pérdida completa).
//   - Tercios (linea.tipo ausente, ver obtenerLineasHipismoCliente): usa
//     montoDecidido() sobre linea.resultado (resultado_jugador o
//     resultado_banquero, según linea.rol) + linea.sinComision -- la
//     inversa exacta de montoMostrado() en hipismoCalc.js.
//   - Adelantada, rol jugador: linea.resultado YA es resultado_cliente, un
//     neto definitivo sin ningún 5% embebido (ver resolverTablaFija/
//     resolverClienteMarca en hipismoAdelantadasCalc.js) -- montoDecidido
//     con sinComision=true simplemente lo deja en valor absoluto.
//   - Adelantada, rol banquero: cada banquero cubre `porcentajeBanqueado`%
//     de la base DECIDIDA de la jugada completa (linea.resultadoClienteJugada
//     -- mismo "base" que ya usa resolverBanqueoMarca para repartir entre
//     banqueadores), nunca de linea.monto (el apostado bruto de la Marca
//     completa) ni de linea.resultado (que además puede traer una comisión
//     VARIABLE y opcional del propio banquero, un mecanismo totalmente
//     aparte del 5% de Tercios -- ver resolverBanqueoMarca).
// montoBaseParaPct devolvía SIEMPRE un valor YA redondeado (montoDecidido),
// que sus 2 llamadores (más abajo, líneas ~246 y ~429) vuelven a multiplicar
// por un % y a redondear OTRA VEZ — el mismo doble redondeo en cadena (ver
// la nota grande EXACTA de montoDecididoExacto en hipismoAdelantadasCalc.js,
// "otro programa" dio $0.01 menos) que se arregló en los 7 lugares del
// barrido de netos. Acá aplicaba igual, tanto para construirResumenCuentaComisionHipismo
// (totalSemana/totalHoy de una cuenta de comisión — un total agregado real,
// SÍ dentro del alcance de este arreglo) como para el toggle "incluir % en
// sus jugadas" de construirResumenClienteHipismo (que sigue exactamente
// igual en cuanto a QUÉ monto usa como base — eso no cambia, solo deja de
// redondearse 2 veces antes de aplicar el %). Devuelve el valor EXACTO, sin
// redondear — cada llamador ya hace su propio round2() una sola vez al
// sacar el % final.
function montoBaseParaPct(linea) {
  if (linea.tipo === 'adelantada' && linea.rol === 'banquero') {
    const baseJugada = montoDecididoExacto(linea.resultadoClienteJugada, true);
    return baseJugada * (Number(linea.porcentajeBanqueado) || 0) / 100;
  }
  if (linea.tipo === 'adelantada') {
    return montoDecididoExacto(linea.resultado, true);
  }
  // Jugadas entre Tercios Adelantadas (05-10-2026): base decidida con el %
  // de comisión configurado en ESA jugada (ver montoBaseTerciosAdelantadaExacto).
  if (linea.tipo === 'tercios_adelantada') {
    return montoBaseTerciosAdelantadaExacto(linea.resultado, linea.comisionPorcentaje);
  }
  // 04-10-2026, a pedido explícito del usuario ("estas jugadas a premio
  // no dejan comision, ni % de devolucion... ni para el grupo ni para
  // ellos mismo ni para sus avalados") -- ver la nota grande de
  // montoBaseComisionExacto en hipismoAdelantadasCalc.js: esta rama es
  // SOLO Tercios (linea.tipo ausente), así que linea.sinComision acá
  // SIEMPRE es la bandera REAL del ticket ("a premio"), nunca el `true`
  // hardcodeado de Adelantadas de arriba -- cambiar a la versión que
  // devuelve 0 es seguro acá.
  return montoBaseComisionExacto(linea.resultado, linea.sinComision);
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDeFechaUTC(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function hoyVenezuela() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }
function rangoSemana(fecha, offsetSemanas) {
  const diaSemana = fecha.getUTCDay();
  const diffHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(fecha);
  lunes.setUTCDate(lunes.getUTCDate() + diffHastaLunes + offsetSemanas * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { desde: isoDeFechaUTC(lunes), hasta: isoDeFechaUTC(domingo) };
}

// =================================================================
// RESUMEN DE UNA CUENTA DE COMISIÓN (26-09-2026, a pedido del usuario:
// "LOS LINK DE % NO DAN SALDO DICEN 0") — hasta esta ronda, el link de
// un cliente "{nombre} - PORCENTAJE" (jugadores.es_cuenta_comision=true,
// ver la nota grande en sql/schema.sql) caía en la rama de siempre de
// construirResumenClienteHipismo de más abajo, que busca jugadas donde
// cliente_nombre/banquero_nombre = el nombre de la cuenta — pero una
// cuenta de comisión NUNCA tiene jugadas propias (Cargar Planos/Remates
// ni siquiera la ofrecen como "quién apostó", ver la nota grande de
// obtenerComisionesPropias en services/hipismoComisionPropia.js), así
// que esa consulta siempre volvía vacía y el link mostraba saldo 0,
// aunque GET /cierre-final y GET /saldo-comisiones (routes/hipismo.js) SÍ
// venían calculando bien su saldo agregado hace rato.
//
// Esta función replica ESA MISMA fórmula ("% de TODO lo que el cliente
// real apostó COMO JUGADOR — Tercios + Remate + Adelantadas, nunca lo que
// banqueó, y Winners nunca cuenta — gane o pierda cada jugada puntual",
// ver la nota grande de agregarPorcentajeDevuelto) pero a nivel de
// DETALLE (carrera por carrera, no solo el total semanal), reusando:
//   1) obtenerComisionesPropias (services/hipismoComisionPropia.js) para
//      resolver, de cada cliente real candidato, si su % (propio y/o de
//      aval) apunta a ESTA cuenta puntual, y
//   2) obtenerLineasHipismoCliente (mismo archivo que usa el resumen
//      normal, más abajo) para traer, SIN escribir ninguna consulta SQL
//      nueva de jugadas, el detalle carrera por carrera de cada cliente
//      real que alimenta esta cuenta.
// Los "Traspasos de Comisión" (ajustes manuales, ver POST
// /comisiones/traspaso en routes/hipismo.js) sí quedan guardados con el
// nombre de la cuenta como cliente_nombre directo, así que esos se leen
// aparte y se muestran como su propio pseudo-hipódromo "🔄 Traspasos de
// Comisión" (mismo criterio que ya usa el bloque "⚽ Deportes" anclado).
// =================================================================
// % DEVUELTO QUE LLEGA A UNA FICHA COMO DESTINO (propio redirigido y/o
// aval de otro cliente) — EXTRAÍDO tal cual (sin cambiar una sola línea
// de la fórmula) de construirResumenCuentaComisionHipismo el 03-10-2026,
// caso real "Mrmoney": un CLIENTE NORMAL (no una cuenta de comisión
// dedicada "{nombre} - PORCENTAJE") mostraba +$12,10 en la grilla
// "Detallado por Cliente" (GET /cierre-final, la referencia "golden") y
// $0,00/"No hay jugadas cargadas" en su propio detalle/link — porque
// buscarOCrearFicha (services/hipismoComisionPropia.js) permite que el
// operador elija CUALQUIER ficha existente, real o dedicada, como
// "¿Quién lo avala?" de otro cliente (o como destino de su % propio
// redirigido) — y construirCierreFinalHipismo YA sumaba esto bien porque
// su acumular()/acumularDevuelto() genérico no distingue el tipo de
// ficha destino, pero esta lógica (antes solo dentro de
// construirResumenCuentaComisionHipismo) solo se ejecutaba cuando
// es_cuenta_comision=true. Ahora la llaman los 2 casos: una cuenta de
// comisión dedicada Y la rama normal de un cliente real que resulta ser
// el avalador/destino de otro (ver construirResumenClienteHipismo más
// abajo) — mismo bug de fondo que "Traspasos de Comisión en un cliente
// normal", arreglado unas líneas más abajo ese mismo día.
// =================================================================
async function calcularDevueltoDestinoHipismo(grupoId, destinoId, destinoNombre, desde, hasta, hoyIso) {
  // Candidatos: clientes reales (nunca otra cuenta de comisión) cuyo %
  // propio y/o % de algún avalador resuelve a ESTA ficha puntual — el
  // destino ya quedó enlazado acá en jugadores.cuenta_comision_id la
  // primera vez que se guardó un Plano/Remate que generó comisión (ver
  // asegurarCuentasComisionParaNombres en services/hipismoComisionPropia.js),
  // así que resolverlo es un simple JOIN/EXISTS, sin adivinar nombres.
  //
  // 28-09-2026: comision_propia ahora SIEMPRE es para el propio cliente
  // (se quitó la opción de mandarlo al aval), y el % de aval pasó de un
  // solo avalado_por_id/porcentaje_devuelto_aval a la tabla
  // jugadores_avales_porcentaje (varios avaladores por cliente) — ver la
  // nota grande de obtenerComisionesPropias en services/hipismoComisionPropia.js.
  //
  // 29-09-2026: "incluir % en sus jugadas" — si el propio cliente tiene
  // el toggle en ON, su comision_propia YA NO alimenta ninguna cuenta
  // aparte (se acumula directo en sus propias jugadas, ver
  // construirResumenClienteHipismo más abajo) — el primer cond1 lo
  // excluye a propósito. El % que gane por ser AVALADOR de otros
  // (cond2) nunca se ve afectado por su propio toggle.
  //
  // 02-10-2026: cond2 ya NO pasa por av.cuenta_comision_id (esa
  // indirección doble quedó eliminada, ver la nota grande de
  // obtenerComisionesPropias en hipismoComisionPropia.js) — ahora
  // jap.avalador_id YA ES directamente la ficha elegida por el operador,
  // así que basta comparar avalador_id contra esta ficha puntual.
  //
  // 03-10-2026: "j.id <> $2" — guardia extra al generalizar esta función
  // para una ficha que ya NO es necesariamente una cuenta de comisión
  // dedicada (antes imposible que calzara consigo misma; ahora, defensa
  // en profundidad para cualquier dato mal configurado).
  const rFuentes = await db.query(
    `SELECT j.nombre
       FROM jugadores j
      WHERE j.grupo_id = $1
        AND NOT COALESCE(j.es_cuenta_comision, false)
        AND j.id <> $2
        AND (
          (j.cuenta_comision_id = $2 AND j.comision_propia > 0 AND NOT COALESCE(j.incluir_porcentaje_en_jugadas, false))
          OR EXISTS (
            SELECT 1 FROM jugadores_avales_porcentaje jap
             WHERE jap.jugador_id = j.id AND jap.porcentaje > 0 AND jap.avalador_id = $2
          )
        )`,
    [grupoId, destinoId]
  );
  const nombresFuente = rFuentes.rows.map(row => row.nombre);

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;
  let cantidadJugadas = 0;

  if (nombresFuente.length) {
    const comisionesPropias = await obtenerComisionesPropias(grupoId, nombresFuente);

    for (const nombreFuente of nombresFuente) {
      // Puede haber hasta 2 entradas para este mismo cliente (% propio +
      // % de aval, ver la nota grande de obtenerComisionesPropias) — acá
      // solo interesan las que apuntan a ESTA ficha puntual.
      const entradas = (comisionesPropias[nombreFuente] || [])
        .filter(info => info && info.pct && info.cuentaNombre === destinoNombre);
      if (!entradas.length) continue;

      const lineas = await obtenerLineasHipismoCliente(grupoId, nombreFuente, desde, hasta);

      // Neteo jugador/banquero por carrera (03-10-2026, a pedido del
      // usuario: "al abrir el cliente me da un saldo completamente
      // distinto , xq esta pasando eso" — la cuenta de comisión "Agregados
      // soy ganador" mostraba un total DISTINTO en el modal de detalle
      // (esta función) que en la grilla "Detallado por Cliente"
      // (construirCierreFinalHipismo, más abajo), que SÍ aplica el neteo
      // de netearJugadorBanqueroTercios desde el 02-10-2026 (caso real
      // "GG": juega y banquea en la MISMA carrera, y el % debe cobrarse
      // sobre el NETO de las 2 posiciones, nunca sobre la suma de ambas
      // por separado — ver la nota grande EXACTA junto a esa función en
      // hipismoCalc.js). Acá, como obtenerLineasHipismoCliente devuelve UN
      // renglón POR TICKET (nunca ya neteado por carrera), el bucle de
      // abajo le cobraba % a "GG" sobre su lado jugador Y su lado
      // banquero por separado cuando coincidían en la misma carrera — este
      // era el "8vo lugar" que el barrido del 02-10-2026 ("los 7 lugares")
      // no había cubierto todavía, porque esta función no existía como tal
      // en ese momento.
      //
      // Se arma acá, por cada nombreFuente, el mismo neteo a partir de sus
      // propios tickets crudos de Tercios (el neteo NUNCA aplica a
      // Remate/Adelantadas/Winners — ver esa misma nota grande), con el
      // mismo patrón ya usado en GET /saldo-comisiones (routes/hipismo.js).
      //
      // 03-10-2026, 2da vuelta (caso real "Agregados ferrocarril": grilla
      // $43,92 vs modal $43,98, SIN que el cliente origen jugara y
      // banqueara la misma carrera -- solo tenía 2 jugadas de Tercios
      // distintas en la MISMA carrera): netearJugadorBanqueroTercios ya
      // acumula EXACTO (sin redondear) TODOS los tickets de una carrera
      // para un nombre, sea dual o no -- así que usar SIEMPRE su
      // `netoExacto` como base del % (no solo cuando dual:true) también
      // resuelve, de regalo, el otro bug hermano ya conocido en este
      // código base ("acumular EXACTO por carrera, redondear 1 sola vez",
      // ver esa nota grande en GET /comisiones-devueltas de routes/
      // hipismo.js, caso real "CODINO"): antes, 2 tickets de un mismo
      // cliente en la misma carrera se redondeaban CADA UNO por separado y
      // se sumaban esos redondeos, en vez de sumar el monto exacto de la
      // carrera y redondear una sola vez -- la diferencia de unos
      // centavos que mostraba "Agregados ferrocarril".
      const rTicketsFuente = await db.query(
        `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero,
                t.sin_comision, p.fecha, p.hipodromo_nombre, p.carrera_numero
           FROM hipismo_tickets t
           JOIN hipismo_planos p ON p.id = t.plano_id
          WHERE t.grupo_id = $1 AND (t.cliente_nombre = $2 OR t.banquero_nombre = $2)
            AND p.fecha BETWEEN $3 AND $4`,
        [grupoId, nombreFuente, desde, hasta]
      );
      const netoPorCarreraFuente = netearJugadorBanqueroTercios(rTicketsFuente.rows.map(t => ({
        clienteNombre: t.cliente_nombre,
        banqueroNombre: t.banquero_nombre,
        resultadoJugador: t.resultado_jugador,
        resultadoBanquero: t.resultado_banquero,
        sinComision: t.sin_comision,
        fecha: t.fecha instanceof Date ? t.fecha.toISOString().slice(0, 10) : t.fecha,
        hipodromoNombre: t.hipodromo_nombre,
        carreraNumero: t.carrera_numero
      })));
      // claveCarrera de Tercios ya cobrada (dual o no) -- para que, si el
      // cliente origen tiene 2+ tickets de Tercios en la MISMA carrera
      // (jugando y banqueando, o varias jugadas del mismo lado), el % se
      // cobre UNA sola vez sobre el monto exacto acumulado de esa carrera,
      // nunca una vez por renglón/ticket.
      const carreraTerciosYaAgregada = new Set();
      // base EXACTA fusionada por carrera (05-10-2026, ver más abajo)
      const baseFusionadaPorCarrera = new Map();

      lineas.forEach(linea => {
        // Winners nunca genera % devuelto — no tiene "monto apostado"
        // (ver la nota grande de agregarPorcentajeDevuelto). Remate
        // (26-09-2026, a pedido del usuario: "LOS REMATES NO LE PRODUCEN
        // % DE DEVOLUCION A LOS CLIENTES") tampoco genera %, sin importar
        // el rol. "cruce_ajuste" (ver hipismoLineasCliente.js) no es una
        // jugada con monto propio, es un ajuste de saldo — no aporta base
        // para calcular ningún %.
        if (linea.tipo === 'winner') return;
        if (linea.tipo === 'remate') return;
        if (linea.tipo === 'cruce_ajuste') return;
        // NUNCA una jugada que "no se decidió" (29-09-2026, a pedido
        // explícito del usuario: "toda jugada que no se decida no genera
        // % ni comisión"). linea.resultado queda en 0 exactamente cuando
        // la jugada no se decidió -- un Tercios "pp"/"a premio" donde
        // ningún caballo figuró (ver resolverCruzado() en
        // hipismoCalc.js), una familia "Nn" empatada en la posición N, o
        // una Marca de Jugadas Adelantadas resuelta nula (ver
        // resolverClienteMarca en hipismoAdelantadasCalc.js) -- nunca de
        // una jugada genuinamente decidida (que siempre gana o pierde
        // una fracción distinta de cero de un monto real).
        if (Number(linea.resultado) === 0) return;
        // TAMBIÉN EL LADO BANQUERO, EN CUALQUIER PRESENTACIÓN (29-09-2026,
        // caso real "Mrincreible" banqueando en Tercios, y luego a pedido
        // explícito del usuario: "las marcas en todas sus presentaciones
        // sean adelantadas o en jugadas contra tercios del plano... deben
        // cumplir todas la misma regla"). Antes esto se excluía a
        // propósito ("solo el rol JUGADOR genera %") — ahora banquear
        // también genera % propio/de aval, sea Tercios o una Marca de
        // Jugadas Adelantadas.
        //
        // montoParaPct (02-10-2026, "LOS % QUE SE DEVUELVEN ES DE LO
        // DECIDIDO NO DE LO APOSTADO" — ver la nota grande de
        // montoBaseParaPct arriba del todo del archivo): NUNCA
        // linea.monto (lo apostado bruto) salvo que coincida con lo
        // decidido — para una Marca banqueada, además, hay que escalar a
        // la PARTE real de ESTE banquero (`porcentajeBanqueado`).
        //
        // Tercios en la MISMA carrera (ver las 2 notas grandes de arriba):
        // SIEMPRE se cobra sobre el acumulado EXACTO de netearJugadorBanqueroTercios
        // para esa carrera, redondeando una sola vez -- cubre a la vez el
        // caso "GG" (dual jugador+banquero) y el caso "Agregados
        // ferrocarril" (2+ jugadas del mismo lado en la misma carrera).
        // Esto solo existe para Tercios (linea.tipo ausente, igual que
        // netearJugadorBanqueroTercios) -- las Marcas de Jugadas
        // Adelantadas se quedan exactamente como estaban.
        // 05-10-2026 ("12 de 72 cliente(s) no cuadran", ver la nota grande de
        // acumularDevuelto en construirCierreFinalHipismo): TODAS las
        // líneas que generan % (Tercios, Tablas/Marcas y Jugadas entre
        // Tercios Adelantadas) se funden por carrera -- se suma su base
        // EXACTA y el % se redondea UNA sola vez por carrera, igual que la
        // grilla. Antes solo Tercios se fundía (las demás redondeaban línea
        // por línea y, además, Tercios Adelantadas no estaba conectada en
        // la grilla, de ahí los céntimos/dólares de diferencia).
        const claveCarrera = `${linea.fecha}::${linea.hipodromoNombre}::${linea.carreraNumero}`;
        if (!linea.tipo) {
          if (carreraTerciosYaAgregada.has(claveCarrera)) return; // esta carrera ya se cobró con otro renglón/ticket
          carreraTerciosYaAgregada.add(claveCarrera);
        }
        let montoParaPct;
        let origenTipoNeto = null;
        if (!linea.tipo) {
          const infoNeto = netoPorCarreraFuente.get(claveCarrera)?.get(nombreFuente);
          montoParaPct = infoNeto ? infoNeto.netoExacto : montoBaseParaPct(linea);
          if (infoNeto && infoNeto.dual) origenTipoNeto = 'tercios-neto';
        } else {
          montoParaPct = montoBaseParaPct(linea);
        }
        const baseAbs = Math.abs(Number(montoParaPct) || 0);
        if (!baseAbs) return;
        if (!baseFusionadaPorCarrera.has(claveCarrera)) {
          baseFusionadaPorCarrera.set(claveCarrera, { base: 0, primera: linea, origenTipo: origenTipoNeto || linea.tipo || 'tercios', tipos: new Set() });
        }
        const acc = baseFusionadaPorCarrera.get(claveCarrera);
        acc.base += baseAbs;
        acc.tipos.add(linea.tipo || 'tercios');
        if (!linea.tipo) acc.origenTipo = origenTipoNeto || 'tercios'; // si hay Tercios en la carrera, manda su etiqueta
      });

      baseFusionadaPorCarrera.forEach(acc => {
        const linea = acc.primera;
        entradas.forEach(info => {
          const devuelto = round2(acc.base * (info.pct / 100));
          if (!devuelto) return;

          const fechaIso = linea.fecha;
          if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
          const hipMap = porDia.get(fechaIso);
          const hipNombre = linea.hipodromoNombre;
          if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, pais: linea.pais, carreras: [] });

          hipMap.get(hipNombre).carreras.push({
            tipo: 'comision',
            origenTipo: acc.origenTipo,
            carrera: linea.carreraNumero,
            pizarra: linea.pizarra,
            modalidad: linea.modalidad,
            caballo: linea.caballo,
            clienteOrigen: nombreFuente,
            porcentaje: info.pct,
            // El monto mostrado en esta línea de comisión es la BASE real
            // sobre la que se calculó el %, no el monto completo de la
            // jugada — para que el detalle ("X% de $monto = $resultado")
            // cuadre también cuando la base viene escalada (banqueo de una
            // Marca), neteada (jugar y banquear en la misma carrera) o
            // fusionada con otras jugadas de la misma carrera.
            monto: acc.base,
            resultado: devuelto
          });

          totalSemana += devuelto;
          cantidadJugadas += 1;
          if (fechaIso === hoyIso) totalHoy += devuelto;
        });
      });
    }
  }

  return { porDia, totalSemana, totalHoy, cantidadJugadas };
}

async function construirResumenCuentaComisionHipismo(jugador, grupo, semanaParam, rangoPersonalizado) {
  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const { porDia, totalSemana: totalSemanaDestino, totalHoy: totalHoyDestino, cantidadJugadas: cantidadDestino } =
    await calcularDevueltoDestinoHipismo(jugador.grupo_id, jugador.id, jugador.nombre, desde, hasta, hoyIso);
  let totalSemana = totalSemanaDestino;
  let totalHoy = totalHoyDestino;
  let cantidadJugadas = cantidadDestino;

  // Traspasos de Comisión (ajustes manuales, ver POST /comisiones/traspaso
  // en routes/hipismo.js) — a diferencia de arriba, estos SÍ quedan
  // guardados directamente con el nombre de esta cuenta como
  // cliente_nombre, así que se leen tal cual, uno por fila.
  const rTraspasos = await db.query(
    `SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes
      WHERE grupo_id = $1 AND cliente_nombre = $2 AND fecha BETWEEN $3 AND $4
      ORDER BY fecha DESC, creado_en ASC`,
    [jugador.grupo_id, jugador.nombre, desde, hasta]
  );
  rTraspasos.rows.forEach(row => {
    const monto = Number(row.monto);
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    if (!hipMap.has(NOMBRE_BLOQUE_TRASPASOS)) {
      hipMap.set(NOMBRE_BLOQUE_TRASPASOS, { nombre: NOMBRE_BLOQUE_TRASPASOS, tipo: 'traspaso', carreras: [] });
    }
    hipMap.get(NOMBRE_BLOQUE_TRASPASOS).carreras.push({
      tipo: 'traspaso',
      nota: row.nota || null,
      resultado: monto
    });

    totalSemana += monto;
    cantidadJugadas += 1;
    if (fechaIso === hoyIso) totalHoy += monto;
  });

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(jugador.grupo_id, grupo), ...temaColorGrupo(grupo) },
    jugador: { nombre: jugador.nombre },
    semana,
    rango: { desde, hasta },
    numeroSemana: numeroSemanaISO(desde),
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    // Una cuenta de comisión nunca tiene Deportes anclado propio — su
    // saldo es 100% derivado de otros clientes de Hipismo.
    modulos: { hipismo: true, deportes: false },
    resumen: {
      totalSemana: round2(totalSemana),
      totalHoy: round2(totalHoy),
      cantidadJugadas,
      totalHipismo: round2(totalSemana),
      totalDeportes: 0,
      cantidadJugadasHipismo: cantidadJugadas,
      cantidadJugadasDeportes: 0
    },
    dias
  };
}

// jugador: fila de "jugadores" (necesita .grupo_id, .nombre, .modulos_anclados).
// grupo: fila de "grupos" (necesita .nombre, .logo_url, .modulo_deportes_habilitado).
// semanaParam: 'actual' (default) | 'anterior'.
async function construirResumenClienteHipismo(jugador, grupo, semanaParam, rangoPersonalizado) {
  // Cuenta de comisión ("{nombre} - PORCENTAJE", ver la nota grande de
  // construirResumenCuentaComisionHipismo arriba) — nunca tiene jugadas
  // propias, así que su saldo se arma con una lógica completamente
  // aparte (26-09-2026, al arreglar "LOS LINK DE % NO DAN SALDO DICEN 0").
  if (jugador.es_cuenta_comision) {
    return construirResumenCuentaComisionHipismo(jugador, grupo, semanaParam, rangoPersonalizado);
  }

  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const lineasHipismo = await obtenerLineasHipismoCliente(jugador.grupo_id, jugador.nombre, desde, hasta);

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;

  // "incluir % en sus jugadas" (29-09-2026, ver la nota grande en
  // sql/schema.sql, columna jugadores.incluir_porcentaje_en_jugadas) —
  // con el toggle en ON, la propia comisión de este cliente
  // (jugadores.comision_propia) se sube DIRECTO al resultado de cada una
  // de sus jugadas, en vez de ir a una cuenta "{nombre} - PORCENTAJE"
  // aparte (ver obtenerComisionesPropias en services/hipismoComisionPropia.js,
  // que es donde se corta esa cuenta aparte para este mismo cliente).
  const pctPropioIncluido = jugador.incluir_porcentaje_en_jugadas ? (Number(jugador.comision_propia) || 0) : 0;
  let comisionPropiaIncluidaSemana = 0;

  // COMISIÓN EXACTA POR CARRERA, REDONDEADA 1 SOLA VEZ (03-10-2026, casos
  // reales "Legolas" Y "Sammy": Balance General y el propio link nunca
  // cuadraban, aun después del arreglo de Traspasos). 2 causas DISTINTAS
  // que terminan necesitando la MISMA solución:
  //
  // 1) "Legolas" (carrera dual): cuando el cliente juega Y banquea en la
  //    MISMA carrera (ej. Keeneland 1ra, "Jugó 2/2 del 1" + "Dio 2p del
  //    1"), el bloque de abajo ANTES le sumaba su % sobre CADA lado por
  //    separado (como confirmó el caso PEDRO el 29-09-2026), mientras que
  //    Cierre Final -- que SÍ aplica netearJugadorBanqueroTercios --
  //    cobraba sobre el NETO de esa carrera (más chico cuando un lado
  //    ganó y el otro perdió).
  // 2) "Sammy" (sin ninguna carrera dual, solo $0,60 de diferencia): un
  //    cliente con MUCHAS jugadas en la MISMA carrera (ej. Keeneland 5ta,
  //    4 líneas "Jugó" seguidas) -- Cierre Final (acumularDevuelto en
  //    construirCierreFinalHipismo más abajo en este archivo) agrupa TODA
  //    la plata de una misma carrera (mismo cliente, mismo destino, mismo
  //    %) en un solo acumulador EXACTO y redondea 1 SOLA VEZ al final
  //    (mismo patrón ya confirmado para el caso CODINO), pero el bloque
  //    de abajo ANTES redondeaba el % de CADA línea por separado y después
  //    sumaba esos redondeos -- con una sola jugada por carrera da
  //    exactamente lo mismo, pero con varias jugadas en la misma carrera
  //    (lo más común con un cliente activo) el redondeo de céntimos se
  //    va acumulando línea por línea hasta notarse (los $0,60 de Sammy en
  //    una semana con decenas de líneas).
  //
  // La solución para las 2 es la MISMA: en vez de redondear el % de cada
  // línea por separado, se suma el monto EXACTO (sin redondear) de TODAS
  // las líneas propias de una misma carrera -- neteando jugador vs.
  // banquero con la regla EXACTA de netearJugadorBanqueroTercios cuando
  // de verdad hay un lado de cada uno (caso Loba: resta si un lado ganó y
  // el otro perdió, suma completo si ganó en los 2 lados), o sumando sin
  // más cuando -como el 99% de los casos- solo hay un rol por carrera
  // (decididoBanquero o decididoJugador en 0, la resta/suma da lo mismo
  // que sumar todas las líneas de ese único lado) -- y se redondea UNA
  // SOLA VEZ el resultado de esa carrera, asignado a la PRIMERA línea de
  // esa carrera (en el mismo orden en que ya vienen: fecha DESC, creado_en
  // ASC), con $0 adicional en las demás líneas de esa misma carrera para
  // este cliente. Con una sola jugada por carrera (la gran mayoría de los
  // clientes, la mayoría de las carreras) este cálculo da EXACTAMENTE el
  // mismo número de siempre (redondear 1 línea sola no cambia nada) --
  // nada de esto se nota salvo cuando hay 2+ líneas propias en la misma
  // carrera.
  //
  // SOLO Tercios puro (líneas sin `.tipo`, ver obtenerLineasHipismoCliente
  // en services/hipismoLineasCliente.js) -- Marcas/Tablas Fijas de
  // Jugadas Adelantadas se quedan exactamente como están, mismo alcance
  // EXACTO que netearJugadorBanqueroTercios en todo el resto del código.
  const comisionPorCarreraPropia = new Map();
  if (pctPropioIncluido) {
    const porCarreraPropia = new Map();
    // 05-10-2026 ("12 de 72 cliente(s) no cuadran", ver la nota grande de
    // acumularDevuelto en construirCierreFinalHipismo): las Jugadas
    // Adelantadas (Tablas/Marcas) y las Jugadas entre Tercios Adelantadas
    // (`linea.tipo` presente) ahora TAMBIÉN se funden con los Tercios de la
    // misma carrera -- se suma su base EXACTA (sin redondear) a la de la
    // carrera y se redondea 1 sola vez, igual que la grilla (Cierre Final),
    // en vez de redondear su % línea por línea.
    const otrosPorCarrera = new Map();
    lineasHipismo.forEach(linea => {
      if (!linea.rol || Number(linea.resultado) === 0) return;
      const clave = `${linea.fecha}::${linea.hipodromoNombre}::${linea.carreraNumero}`;
      if (linea.tipo) {
        otrosPorCarrera.set(clave, (otrosPorCarrera.get(clave) || 0) + Math.abs(Number(montoBaseParaPct(linea)) || 0));
        return;
      }
      // 04-10-2026: + linea.sinComision -- las jugadas "a premio" SIN
      // comisión no generan % propio incluido tampoco (mismo pedido
      // explícito del usuario, ver la nota grande de montoBaseComisionExacto
      // en hipismoAdelantadasCalc.js).
      if (linea.sinComision) return;
      if (!porCarreraPropia.has(clave)) porCarreraPropia.set(clave, { decididoJugador: 0, decididoBanquero: 0, sumaJugador: 0, sumaBanquero: 0 });
      const acc = porCarreraPropia.get(clave);
      const decidido = montoDecididoExacto(linea.resultado, linea.sinComision);
      if (linea.rol === 'jugador') { acc.decididoJugador += decidido; acc.sumaJugador += Number(linea.resultado); }
      else { acc.decididoBanquero += decidido; acc.sumaBanquero += Number(linea.resultado); }
    });
    // Misma regla EXACTA que netearJugadorBanqueroTercios en hipismoCalc.js
    // (ver la nota grande "Neteo real" ahí, caso Loba 03-10-2026): resta
    // cuando un lado ganó y el otro perdió, suma completo cuando ganó en
    // los 2 lados a la vez. Sin carrera dual (el caso normal) un lado
    // queda en 0 y esto se reduce a sumar todas las líneas de ese único
    // lado -- ver la nota grande de arriba, caso "Sammy".
    const baseTerciosPorCarrera = new Map();
    porCarreraPropia.forEach((acc, clave) => {
      const ganoLosDosLados = acc.sumaJugador > 0 && acc.sumaBanquero > 0;
      const netoExacto = ganoLosDosLados
        ? (acc.decididoJugador + acc.decididoBanquero)
        : Math.abs(acc.decididoJugador - acc.decididoBanquero);
      baseTerciosPorCarrera.set(clave, Math.abs(netoExacto));
    });
    new Set([...baseTerciosPorCarrera.keys(), ...otrosPorCarrera.keys()]).forEach(clave => {
      const base = (baseTerciosPorCarrera.get(clave) || 0) + (otrosPorCarrera.get(clave) || 0);
      comisionPorCarreraPropia.set(clave, round2(base * pctPropioIncluido / 100));
    });
  }
  const carrerasConComisionPropia = new Set(comisionPorCarreraPropia.keys());

  lineasHipismo.forEach(linea => {
    const fechaIso = linea.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = linea.hipodromoNombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, pais: linea.pais, carreras: [] });

    // Remate/Winner/cruce_ajuste nunca traen `.rol` en absoluto (ver
    // obtenerLineasHipismoCliente en services/hipismoLineasCliente.js),
    // así que quedan excluidos solos con el chequeo de `linea.rol`.
    //
    // TAMBIÉN EL LADO BANQUERO, EN CUALQUIER PRESENTACIÓN (29-09-2026,
    // mismo caso "Mrincreible" — ver la nota grande en
    // construirResumenCuentaComisionHipismo más arriba): antes esto solo
    // contaba `linea.rol === 'jugador'`, a propósito ("nunca lo que
    // banqueó"); el usuario confirmó primero que el % también se gana
    // banqueando en Tercios, y luego, a pedido explícito ("las marcas en
    // todas sus presentaciones... deben cumplir todas la misma regla"),
    // que el banqueo de una Marca (Jugadas Adelantadas) también cuenta.
    //
    // montoParaPct (02-10-2026, "LOS % QUE SE DEVUELVEN ES DE LO DECIDIDO
    // NO DE LO APOSTADO" — igual que en construirResumenCuentaComisionHipismo,
    // ver la nota grande de montoBaseParaPct arriba del todo del archivo):
    // NUNCA linea.monto salvo que coincida con lo decidido.
    // NUNCA una jugada que "no se decidió" (29-09-2026, a pedido
    // explícito del usuario: "toda jugada que no se decida no genera %
    // ni comisión") — mismo chequeo que construirResumenCuentaComisionHipismo
    // más arriba, ver esa nota grande para el detalle de qué casos caen
    // acá (linea.resultado en 0).
    // COMISIÓN EXACTA POR CARRERA, REDONDEADA 1 SOLA VEZ — ACTUALIZADO
    // 03-10-2026 (casos Legolas Y Sammy, ver la nota grande completa
    // arriba de esta función, junto a comisionPorCarreraPropia). Para
    // Tercios puro (sin `.tipo`), en vez de redondear el % de CADA línea
    // por separado (lo que esta función hacía antes a propósito, caso
    // PEDRO del 29-09-2026), se usa la comisión ya calculada EXACTA por
    // carrera (neteando jugador/banquero cuando aplica, sumando sin más
    // cuando no) y redondeada 1 sola vez, asignada a la PRIMERA línea de
    // esa carrera que aparezca acá, con $0 en las demás líneas de la
    // misma carrera para este cliente — así el total de la ficha SIEMPRE
    // cuadra con Cierre Final (que calcula igual, agrupando por carrera),
    // tenga el cliente una carrera dual o simplemente varias jugadas
    // propias en la misma carrera. Las Marcas/Tablas Fijas de Jugadas
    // Adelantadas (`linea.tipo` presente) quedan FUERA de este
    // agrupamiento por carrera y se calculan exactamente como siempre,
    // línea por línea.
    let comisionIncluida = 0;
    if (pctPropioIncluido && linea.rol && Number(linea.resultado) !== 0) {
      // 05-10-2026: TODAS las líneas con rol (Tercios, Tablas/Marcas y
      // Jugadas entre Tercios Adelantadas) comparten la misma comisión
      // fusionada de su carrera, asignada a la PRIMERA línea de esa
      // carrera (ver la nota grande de comisionPorCarreraPropia arriba).
      const claveCarrera = `${linea.fecha}::${linea.hipodromoNombre}::${linea.carreraNumero}`;
      if (carrerasConComisionPropia.has(claveCarrera)) {
        comisionIncluida = comisionPorCarreraPropia.get(claveCarrera);
        comisionPorCarreraPropia.delete(claveCarrera);
        carrerasConComisionPropia.delete(claveCarrera);
      }
    }
    const resultadoFinal = comisionIncluida ? round2(linea.resultado + comisionIncluida) : linea.resultado;

    const carrera = {
      carrera: linea.carreraNumero,
      pizarra: linea.pizarra,
      modalidad: linea.modalidad,
      monto: linea.monto,
      rol: linea.rol,
      resultado: resultadoFinal,
      tipo: linea.tipo,
      ganoRemate: linea.ganoRemate,
      subtipo: linea.subtipo,
      numeroEjemplar: linea.numeroEjemplar,
      numero1: linea.numero1,
      numero2: linea.numero2,
      // esCruce/grupoCaballos/cruceGrupoA/cruceGrupoB (04-10-2026, ver la
      // nota grande de obtenerLineasHipismoCliente en
      // services/hipismoLineasCliente.js) — SOLO los trae una línea
      // `tipo: 'tercios_adelantada'` (undefined para cualquier otro tipo,
      // igual que numeroEjemplar/numero1/numero2 de arriba ya quedan
      // undefined para lo que no es Adelantada), hacen falta para que
      // armarJugadaTextoDetallado()/armarJugadaTexto() puedan armar el
      // texto de esa jugada sin un `.caballo` (que esta jugada no tiene).
      esCruce: linea.esCruce,
      grupoCaballos: linea.grupoCaballos,
      cruceGrupoA: linea.cruceGrupoA,
      cruceGrupoB: linea.cruceGrupoB
    };
    if (comisionIncluida) carrera.comisionPropiaIncluida = comisionIncluida;
    if (linea.modalidad === 'pp') {
      carrera.caballoA = linea.caballoA;
      carrera.caballoB = linea.caballoB;
    } else if (linea.tipo !== 'adelantada' && linea.tipo !== 'tercios_adelantada') {
      carrera.caballo = linea.caballo;
    }
    hipMap.get(hipNombre).carreras.push(carrera);

    totalSemana += resultadoFinal;
    comisionPropiaIncluidaSemana += comisionIncluida;
    if (fechaIso === hoyIso) totalHoy += resultadoFinal;
  });

  // TRASPASOS DE COMISIÓN EN UN CLIENTE NORMAL (03-10-2026, a pedido del
  // usuario: "los saldos de los link no dan igual al de los balances...
  // legolas por ejemplo da 3853 y en el link dice 3861,98" — BUG REAL
  // encontrado: POST /comisiones/traspaso deja explícito que "el destino
  // puede ser CUALQUIER cliente (otra cuenta de comisión, O UN CLIENTE
  // NORMAL)" (ver la nota grande de esa ruta en routes/hipismo.js), y
  // GET /cierre-final (Balance General/Cierre Final, la referencia
  // "golden") SÍ suma esos ajustes a CUALQUIER cliente vía
  // obtenerAjustesComision — pero esta función (el link público del
  // cliente Y "Detallado por Cliente" del Administrador, ver la nota
  // grande del archivo) NUNCA leía hipismo_comisiones_ajustes para un
  // cliente normal, solo construirResumenCuentaComisionHipismo (arriba)
  // lo hacía, y SOLO para una cuenta "{nombre} - PORCENTAJE". Un cliente
  // normal que recibió/mandó un traspaso de comisión quedaba con ese
  // monto en Balance General pero invisible en su propio link — y si esa
  // semana el traspaso era su ÚNICO movimiento (sin jugadas), el link
  // directamente daba $0 en vez del monto real ("muestran un saldo en la
  // pantalla y al darle click sale en 0"). Mismo query y mismo bloque
  // "Traspasos de Comisión" (tipo:'traspaso', NOMBRE_BLOQUE_TRASPASOS)
  // que ya usa construirResumenCuentaComisionHipismo más arriba — el
  // frontend (hipismo-mockup.html/hipismo-cliente-portal.html) ya lo
  // sabe pintar genéricamente por `hip.tipo`, sin importar si el dueño es
  // una cuenta de comisión o un cliente normal.
  let cantidadTraspasos = 0;
  const rTraspasosCliente = await db.query(
    `SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes
      WHERE grupo_id = $1 AND cliente_nombre = $2 AND fecha BETWEEN $3 AND $4
      ORDER BY fecha DESC, creado_en ASC`,
    [jugador.grupo_id, jugador.nombre, desde, hasta]
  );
  rTraspasosCliente.rows.forEach(row => {
    const monto = Number(row.monto);
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    if (!hipMap.has(NOMBRE_BLOQUE_TRASPASOS)) {
      hipMap.set(NOMBRE_BLOQUE_TRASPASOS, { nombre: NOMBRE_BLOQUE_TRASPASOS, tipo: 'traspaso', carreras: [] });
    }
    hipMap.get(NOMBRE_BLOQUE_TRASPASOS).carreras.push({
      tipo: 'traspaso',
      nota: row.nota || null,
      resultado: monto
    });

    totalSemana += monto;
    cantidadTraspasos += 1;
    if (fechaIso === hoyIso) totalHoy += monto;
  });

  // CARGA MASIVA ESPECIAL (05-10-2026): mismas líneas que suma Cierre Final
  // (obtenerCargasEspecialesRango), mostradas como un pseudo-hipódromo
  // "Carga Masiva Especial" con el mismo render que los Traspasos
  // (`tipo: 'traspaso'`, una nota y el monto) — así el link/Detallado por
  // Cliente siempre cuadran con la grilla.
  const cargasEspecialesCliente = await obtenerCargasEspecialesRango(jugador.grupo_id, desde, hasta, jugador.nombre);
  cargasEspecialesCliente.forEach(l => {
    if (!porDia.has(l.fecha)) porDia.set(l.fecha, new Map());
    const hipMap = porDia.get(l.fecha);
    if (!hipMap.has(NOMBRE_BLOQUE_CARGA_ESPECIAL)) {
      hipMap.set(NOMBRE_BLOQUE_CARGA_ESPECIAL, { nombre: NOMBRE_BLOQUE_CARGA_ESPECIAL, tipo: 'traspaso', carreras: [] });
    }
    hipMap.get(NOMBRE_BLOQUE_CARGA_ESPECIAL).carreras.push({
      tipo: 'traspaso',
      nota: (l.carrera ? `Carrera ${l.carrera} — ` : '') + `Carga especial ${l.codigoNombre}`,
      resultado: l.monto
    });
    totalSemana += l.monto;
    cantidadTraspasos += 1;
    if (l.fecha === hoyIso) totalHoy += l.monto;
  });

  // % DEVUELTO COMO DESTINO DE OTRO CLIENTE EN UN CLIENTE NORMAL
  // (03-10-2026, caso real "Mrmoney": mostraba +$12,10 en "Detallado por
  // Cliente"/Balance General y "$0,00 / No hay jugadas cargadas" en su
  // propio link — mismo bug de fondo que los Traspasos de arriba, pero
  // con la ficha de "¿Quién lo avala?"/% propio redirigido de OTRO
  // cliente apuntando a este cliente, en vez de a una cuenta de comisión
  // dedicada. Ver la nota grande EXACTA de calcularDevueltoDestinoHipismo,
  // extraída de construirResumenCuentaComisionHipismo para poder llamarse
  // también acá. cantidadDestino se suma igual que cantidadTraspasos,
  // más abajo en el resumen.)
  const destinoInfo = await calcularDevueltoDestinoHipismo(jugador.grupo_id, jugador.id, jugador.nombre, desde, hasta, hoyIso);
  destinoInfo.porDia.forEach((hipMapDestino, fechaIso) => {
    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    hipMapDestino.forEach((hipodromoData, hipNombre) => {
      if (!hipMap.has(hipNombre)) {
        hipMap.set(hipNombre, hipodromoData);
      } else {
        hipMap.get(hipNombre).carreras.push(...hipodromoData.carreras);
      }
    });
  });
  totalSemana += destinoInfo.totalSemana;
  totalHoy += destinoInfo.totalHoy;

  const totalHipismo = totalSemana;
  let totalDeportes = 0;
  let cantidadJugadasDeportes = 0;

  const deportesAnclado = !!(jugador.modulos_anclados && grupo.modulo_deportes_habilitado);
  if (deportesAnclado) {
    const ticketsDeportes = await leerHistorial(jugador.grupo_id, { desde, hasta, cliente: jugador.nombre });
    ticketsDeportes.forEach(t => {
      const resultado = resultadoTicketDeportes(t);
      const fechaIso = t.fecha;

      if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
      const hipMap = porDia.get(fechaIso);
      if (!hipMap.has(NOMBRE_BLOQUE_DEPORTES)) {
        hipMap.set(NOMBRE_BLOQUE_DEPORTES, { nombre: NOMBRE_BLOQUE_DEPORTES, tipo: 'deportes', carreras: [] });
      }
      hipMap.get(NOMBRE_BLOQUE_DEPORTES).carreras.push({
        ticket: t.ticket,
        detalle: t.detalle,
        estado: t.estado,
        monto: t.arriesga,
        resultado
      });

      totalDeportes += resultado;
      cantidadJugadasDeportes += 1;
      totalSemana += resultado;
      if (fechaIso === hoyIso) totalHoy += resultado;
    });
  }

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(jugador.grupo_id, grupo), ...temaColorGrupo(grupo) },
    jugador: { nombre: jugador.nombre },
    semana,
    rango: { desde, hasta },
    numeroSemana: numeroSemanaISO(desde),
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    modulos: { hipismo: true, deportes: deportesAnclado },
    resumen: {
      totalSemana,
      totalHoy,
      // cantidadTraspasos/destinoInfo.cantidadJugadas (03-10-2026, ver las
      // 2 notas grandes de arriba) — se suman a cantidadJugadas/
      // cantidadJugadasHipismo igual que ya hace
      // construirResumenCuentaComisionHipismo, para que el conteo de
      // movimientos de la semana no se quede corto cuando el cliente tuvo
      // un traspaso de comisión y/o cobró % como destino de otro cliente.
      cantidadJugadas: lineasHipismo.length + cantidadTraspasos + destinoInfo.cantidadJugadas + cantidadJugadasDeportes,
      totalHipismo,
      totalDeportes,
      cantidadJugadasHipismo: lineasHipismo.length + cantidadTraspasos + destinoInfo.cantidadJugadas,
      cantidadJugadasDeportes,
      // "incluir % en sus jugadas" (29-09-2026) — cuánto de totalSemana/
      // totalHipismo de arriba es comisión propia YA incluida en las
      // jugadas de este cliente (0 si el toggle está OFF o no tiene %) —
      // el frontend lo puede mostrar como referencia, sin que afecte el
      // total (que ya la trae sumada).
      comisionPropiaIncluidaSemana: round2(comisionPropiaIncluidaSemana)
    },
    dias
  };
}

// =================================================================
// RESUMEN DEL ÍTEM "REMATE" (26-09-2026, a pedido del usuario, ver la
// nota grande de GET /cierre-final en routes/hipismo.js y de
// calcularRemate en services/hipismoRemateCalc.js: "esos 2000 negativos
// deben salir en un ítem en balance como si fuera OTRO CLIENTE llamado
// REMATE, igual detallado en que carrera fue y en que hipódromo"). No es
// un cliente real — NUNCA tiene fila en "jugadores", así que GET
// /clientes/:nombre/detalle-semana lo especial-casa (ver ese archivo)
// en vez de buscarlo ahí, y llama a esta función en su lugar. SOLO se
// usa desde la parte administrativa (Detallado por Cliente en
// hipismo-mockup.html) — nunca hay un link público para esto, así que
// el resultado/ganancia-o-pérdida de cada remate nunca llega al cliente.
async function construirResumenRemateHipismo(grupoId, grupo, semanaParam, rangoPersonalizado) {
  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const rRemates = await db.query(
    `SELECT hipodromo_nombre, carrera_numero, fecha, pizarra, pool_total, pago_ganador,
            comision_total, comision_porcentaje, garantia, pago_fijo, hubo_ganador, modo
       FROM hipismo_remates WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3
       ORDER BY fecha DESC, creado_en ASC`,
    [grupoId, desde, hasta]
  );

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;
  let cantidadJugadas = 0;

  rRemates.rows.forEach(r => {
    // comision_total (nombre de columna sin cambios, ver la nota grande
    // en sql/schema.sql) ya ES el resultado de este remate — un remate
    // con resultado 0 (rarísimo, pero posible) no aporta ninguna línea
    // visible.
    const resultado = round2(Number(r.comision_total));
    if (!resultado) return;
    const fechaIso = r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : r.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = r.hipodromo_nombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, carreras: [] });

    hipMap.get(hipNombre).carreras.push({
      tipo: 'remate_resultado',
      carrera: r.carrera_numero,
      pizarra: r.pizarra,
      // "manual" (04-10-2026, ver la nota grande de POST
      // /remates/manual) = monto neto directo, sin pool/comisión; "paga"
      // = REMATE PAGA (monto fijo, sin %); "garantiza" = REMATE GARANTIZA
      // (piso + %); "porcentaje" = ni una ni otra, solo el % de siempre
      // — ver la nota grande de calcularRemate.
      modo: r.modo === 'manual' ? 'manual' : (r.pago_fijo != null ? 'paga' : (r.garantia != null ? 'garantiza' : 'porcentaje')),
      poolTotal: Number(r.pool_total),
      pagoGanador: Number(r.pago_ganador),
      huboGanador: r.hubo_ganador,
      resultado
    });

    totalSemana += resultado;
    cantidadJugadas += 1;
    if (fechaIso === hoyIso) totalHoy += resultado;
  });

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(grupoId, grupo), ...temaColorGrupo(grupo) },
    jugador: { nombre: 'REMATE' },
    semana,
    rango: { desde, hasta },
    numeroSemana: numeroSemanaISO(desde),
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    modulos: { hipismo: true, deportes: false },
    resumen: {
      totalSemana: round2(totalSemana),
      totalHoy: round2(totalHoy),
      cantidadJugadas,
      totalHipismo: round2(totalSemana),
      totalDeportes: 0,
      cantidadJugadasHipismo: cantidadJugadas,
      cantidadJugadasDeportes: 0
    },
    dias
  };
}

// =================================================================
// RESUMEN DEL ÍTEM "WINNERS" (28-09-2026, a pedido del usuario: "al
// meterme en detallado por cliente [WINNERS] ... no se encontró ese
// cliente") — mismo caso EXACTO que construirResumenRemateHipismo de
// arriba: "WINNERS" es un ítem sintético del balance (ver la nota
// grande del ítem "WINNERS" en GET /cierre-final, routes/hipismo.js),
// NUNCA una fila real de "jugadores", así que GET
// /clientes/:nombre/detalle-semana lo especial-casa en vez de buscarlo
// ahí. Antes de esta función, hacer click en el cuadro "WINNERS" de
// "Detallado por Cliente" siempre daba 404 ("No se encontró ese
// cliente"), aunque su saldo SÍ apareciera bien en Balance General/
// Cierre Final (que arman ese saldo aparte, sin pasar por esta ruta).
//
// El detalle, fila por fila, es el ESPEJO exacto de cada registro de
// "Cargar Winners": si el cliente ganó +400 con un caballo, "WINNERS"
// "perdió" esos mismos 400 — nunca el monto tal cual del cliente (mismo
// invariante de "todo negativo tiene su contraparte" que ya aplica
// acumular('WINNERS', -monto) en /cierre-final).
async function construirResumenWinnersHipismo(grupoId, grupo, semanaParam, rangoPersonalizado) {
  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const rWinners = await db.query(
    `SELECT hipodromo_nombre, carrera_numero, fecha, cliente_nombre, caballo, monto
       FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3
       ORDER BY fecha DESC, creado_en ASC`,
    [grupoId, desde, hasta]
  );

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;
  let cantidadJugadas = 0;

  rWinners.rows.forEach(w => {
    const resultado = round2(-Number(w.monto));
    if (!resultado) return;
    const fechaIso = w.fecha instanceof Date ? w.fecha.toISOString().slice(0, 10) : w.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = w.hipodromo_nombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, carreras: [] });

    hipMap.get(hipNombre).carreras.push({
      tipo: 'winner_contraparte',
      carrera: w.carrera_numero,
      caballo: w.caballo,
      clienteNombre: w.cliente_nombre,
      monto: Math.abs(Number(w.monto)),
      resultado
    });

    totalSemana += resultado;
    cantidadJugadas += 1;
    if (fechaIso === hoyIso) totalHoy += resultado;
  });

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(grupoId, grupo), ...temaColorGrupo(grupo) },
    jugador: { nombre: 'WINNERS' },
    semana,
    rango: { desde, hasta },
    numeroSemana: numeroSemanaISO(desde),
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    modulos: { hipismo: true, deportes: false },
    resumen: {
      totalSemana: round2(totalSemana),
      totalHoy: round2(totalHoy),
      cantidadJugadas,
      totalHipismo: round2(totalSemana),
      totalDeportes: 0,
      cantidadJugadasHipismo: cantidadJugadas,
      cantidadJugadasDeportes: 0
    },
    dias
  };
}

// "TABLAS FIJAS", carrera por carrera (04-10-2026, a pedido del usuario,
// caso real: al hacerle click a "Tablas fijas" en Detallado por Cliente
// salía "No se encontró ese cliente" -- mismo motivo EXACTO por el que
// "WINNERS" tuvo este mismo bug el 28-09-2026: "TABLAS FIJAS" tampoco es
// una fila real de "jugadores", es el ítem AGREGADO que arma
// construirCierreFinalHipismo con acumular('TABLAS FIJAS', ...) más
// arriba -- GET /clientes/:nombre/detalle-semana ahora lo especial-casa
// igual que REMATE/WINNERS, en vez de 404ear.
//
// Mismo invariante EXACTO que ya usa Cierre Final/mezclarAdelantadasEnBalance
// (ver la nota grande de comisionAdelantadasSemana más arriba): el lado
// de "TABLAS FIJAS" por cada jugada es el espejo NETO de su comisión --
// cliente + TABLAS FIJAS + comisión (ya plegada en COMISIÓN GRUPO) = 0
// exacto. Acá se arma esa misma cuenta por jugada, carrera por carrera,
// para que el Administrador vea exactamente lo mismo que ya suma el
// total de Balance General, nunca un número aparte.
async function construirResumenTablasFijasHipismo(grupoId, grupo, semanaParam, rangoPersonalizado) {
  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const rTablasFijas = await db.query(
    `SELECT j.cliente_nombre, j.carrera_numero, j.numero_ejemplar, j.monto, j.resultado_cliente,
            j.comision, j.gano, j.pizarra_usada,
            p.fecha, p.hipodromo_nombre, h.pais
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
       LEFT JOIN hipismo_hipodromos h ON h.id = p.hipodromo_id
      WHERE j.grupo_id = $1 AND j.tipo = 'tf' AND p.fecha BETWEEN $2 AND $3
        AND j.estado IN ('resuelto', 'sin_decidir')
      ORDER BY p.fecha DESC, j.creado_en ASC`,
    [grupoId, desde, hasta]
  );

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;
  let cantidadJugadas = 0;

  rTablasFijas.rows.forEach(j => {
    // Mismo cálculo EXACTO que acumular('TABLAS FIJAS', -(resultado_cliente
    // + comisionTf)) en construirCierreFinalHipismo -- una jugada
    // 'sin_decidir' siempre da resultado_cliente=0 y comision=0, así que
    // resultado acá da 0 y se salta sola (mismo criterio que REMATE/
    // WINNERS arriba: una jugada sin efecto no aporta ninguna línea).
    const comisionTf = j.comision != null ? Number(j.comision) : 0;
    const resultado = round2(-(Number(j.resultado_cliente) + comisionTf));
    if (!resultado) return;
    const fechaIso = j.fecha instanceof Date ? j.fecha.toISOString().slice(0, 10) : j.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = j.hipodromo_nombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, carreras: [] });

    hipMap.get(hipNombre).carreras.push({
      tipo: 'tf_resultado',
      carrera: j.carrera_numero,
      pizarra: j.pizarra_usada,
      clienteNombre: j.cliente_nombre,
      numeroEjemplar: j.numero_ejemplar,
      monto: Number(j.monto),
      comision: comisionTf,
      ganoCliente: !!j.gano,
      resultado
    });

    totalSemana += resultado;
    cantidadJugadas += 1;
    if (fechaIso === hoyIso) totalHoy += resultado;
  });

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(grupoId, grupo), ...temaColorGrupo(grupo) },
    jugador: { nombre: 'TABLAS FIJAS' },
    semana,
    rango: { desde, hasta },
    numeroSemana: numeroSemanaISO(desde),
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    modulos: { hipismo: true, deportes: false },
    resumen: {
      totalSemana: round2(totalSemana),
      totalHoy: round2(totalHoy),
      cantidadJugadas,
      totalHipismo: round2(totalSemana),
      totalDeportes: 0,
      cantidadJugadasHipismo: cantidadJugadas,
      cantidadJugadasDeportes: 0
    },
    dias
  };
}

// =================================================================
// CIERRE FINAL / BALANCE GENERAL DE HIPISMO (30-09-2026, a pedido del
// usuario: "desde super admin muestrame en la pestaña balance por
// clientes, el balance general del grupo que corresponda modulo
// hipismo") — esta función es EXACTAMENTE la misma lógica que ya traía
// GET /cierre-final en routes/hipismo.js (el motor real detrás de la
// pantalla "📒 Balance General" de hipismo-mockup.html), sacada a este
// archivo compartido para poder reusarla desde 2 lugares SIN duplicar
// ninguna de sus reglas — varias de ellas fruto de bugs reales ya
// corregidos (LUSHO-100 con el cruce de jugadas, Halland con Tablas
// Fijas, el bug de comparación string/number de Sebastian, etc., ver los
// comentarios de cada bloque más abajo):
//   1) el propio GET /cierre-final (routes/hipismo.js), con
//      grupoId=req.grupoId (la resolución de semana/rango sigue viviendo
//      en la ruta, que es lo único realmente específico de esa pantalla), y
//   2) la nueva ruta de Super-admin GET
//      /api/superadmin/grupos/:id/hipismo-cierre-final, con
//      grupoId=el :id de la URL — mismo criterio ya usado para el
//      Balance por Cliente de Deportes (calcularBalanceGeneral).
//
// A diferencia de construirResumenClienteHipismo/RemateHipismo/
// WinnersHipismo de arriba (que arman el DETALLE día-por-día de UN
// cliente), esta función arma el RESUMEN de TODOS los clientes del grupo
// para un rango — por eso recibe desde/hasta ya resueltos (no
// semanaParam/rangoPersonalizado) y no arma "dias"/"hipodromos", solo la
// lista `clientes` con su saldo ya neto, tal cual el shape que devolvía
// GET /cierre-final.
async function construirCierreFinalHipismo(grupoId, desde, hasta) {
  // `p.hipodromo_nombre, p.carrera_numero, p.fecha` (02-10-2026, agregadas
  // SOLO para el neteo jugador/banquero de más abajo —
  // netearJugadorBanqueroTercios agrupa por carrera, fecha+hipódromo+
  // número— ningún otro uso de rTickets en esta función las necesitaba
  // antes).
  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero, t.monto,
            t.plano_id, t.sin_comision, p.cruza_jugadas, p.hipodromo_nombre, p.carrera_numero, p.fecha
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );
  const rApuestasRemate = await db.query(
    `SELECT a.cliente_nombre, a.resultado, a.monto
       FROM hipismo_remate_apuestas a
       JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );
  // Jugadas Adelantadas (23-09-2026, ver la nota grande en
  // services/hipismoAdelantadasCalc.js): el lado del CLIENTE que jugó
  // (tf o marca) ya es definitivo apenas sale de 'pendiente' —
  // 'resuelto', 'falta_banqueo' y 'sin_decidir' entran todos acá (en
  // 'sin_decidir' resultado_cliente ya quedó en 0). El lado de los
  // BANQUEADORES de una Marca solo existe una vez 'resuelto' (adentro
  // del jsonb banqueadores) — cada banquero es, para efectos de saldo,
  // un cliente más (ej. "MARCAS ZENYATTA").
  // p.fecha, p.hipodromo_nombre, j.carrera_numero (02-10-2026, ver la nota
  // grande EXACTA de acumularDevuelto más abajo: hacen falta para poder
  // fusionar por carrera las jugadas de un mismo cliente antes de
  // redondear — antes esta consulta no las traía porque nada en esta
  // función las necesitaba).
  const rAdelantadas = await db.query(
    `SELECT j.cliente_nombre, j.tipo, j.resultado_cliente, j.comision, j.banqueadores, j.monto, j.gano,
            p.fecha, p.hipodromo_nombre, j.carrera_numero
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [grupoId, desde, hasta]
  );
  // "Jugadas entre Tercios Adelantadas" (04-10-2026, a pedido del
  // usuario, caso real "Rambo": "LA JUGADA QUE NO SALE LA CARGA POR
  // JUGADAS ADELANTDAS ENTRE TERCIOS" — Balance General/Cierre Final
  // (esta función) nunca había leído hipismo_tercios_adelantadas_jugadas:
  // el único lugar donde esa plata se veía era, UNA SOLA VEZ y sin
  // persistir, en la respuesta de POST /planos justo al guardar el plano
  // que la resolvió (mezclarTerciosAdelantadasEnBalance en
  // routes/hipismo.js) — recargar Balance General después (GET
  // /cierre-final, esta misma función) perdía esa plata por completo.
  // A diferencia de Tablas Fijas/Marcas, acá NO hace falta ninguna
  // cuenta "espejo": jugador y banquero ya son 2 clientes reales que
  // suman 0 entre ellos solos (menos la comisión del grupo) — mismo
  // criterio EXACTO, mismo nombre de ítem ("% TERCIOS ADELANTADAS"), que
  // ya usa mezclarTerciosAdelantadasEnBalance para el Balance General
  // efímero de "Cargar Planos", para que el ítem se vea IGUAL recién
  // guardado el plano que al recargar la pantalla más tarde.
  const rTerciosAdelantadas = await db.query(
    `SELECT j.jugador_nombre, j.banquero_nombre, j.resultado_jugador, j.resultado_banquero, j.comision_grupo,
            j.comision_porcentaje, p.fecha, p.hipodromo_nombre, j.carrera_numero
       FROM hipismo_tercios_adelantadas_jugadas j
       JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto', 'sin_decidir')`,
    [grupoId, desde, hasta]
  );

  // "Cargar Winners" (26-09-2026, ver la nota grande junto a POST /winners):
  // cada fila ya es el resultado NETO de ese cliente, así que se suma
  // exactamente igual que un ticket ya resuelto — sin comisión ni "monto
  // apostado" aparte (Winners no tiene ninguno de los 2).
  //
  // ÍTEM "WINNERS" (28-09-2026, a pedido del usuario: "ya le sale
  // reflejada al cliente su jugada y su positivo y negativo eso esta
  // excelente, pero eso debe ir contra el codigo llamado winners....
  // si lusho tiene +400 en winners, winners debe decir -400... todo
  // negativo debe tener su contra parte reflejado en la contabilidad")
  // — mismo principio ya aplicado a TABLAS FIJAS/PORCENTAJE MARCAS/
  // REMATE: cada monto que gana o pierde un cliente en Winners tiene
  // que tener su contraparte exacta en otro renglón, o el balance no
  // cuadra (la suma de TODOS los saldos positivos y negativos deja de
  // dar 0). Acá "WINNERS" es literalmente el otro lado de la apuesta —
  // si LUSHO ganó +400, alguien (el ítem "WINNERS") tiene que perder
  // esos mismos 400. Ver el forEach más abajo, que acumula el espejo
  // exacto (-monto) de cada fila junto con el lado del cliente.
  const rWinners = await db.query(
    `SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );

  const porCliente = new Map();
  function acumular(nombre, resultado) {
    if (!porCliente.has(nombre)) porCliente.set(nombre, { nombre, jugadas: 0, gano: 0, perdio: 0 });
    const c = porCliente.get(nombre);
    c.jugadas += 1;
    const n = Number(resultado);
    if (n > 0) c.gano += n;
    else if (n < 0) c.perdio += -n;
  }
  rTickets.rows.forEach(t => {
    acumular(t.cliente_nombre, t.resultado_jugador);
    acumular(t.banquero_nombre, t.resultado_banquero);
  });
  rApuestasRemate.rows.forEach(a => acumular(a.cliente_nombre, a.resultado));
  rWinners.rows.forEach(w => {
    acumular(w.cliente_nombre, w.monto);
    acumular('WINNERS', -Number(w.monto));
  });

  let comisionAdelantadasSemana = 0;
  rAdelantadas.rows.forEach(j => {
    acumular(j.cliente_nombre, j.resultado_cliente);
    if (j.comision != null) comisionAdelantadasSemana += Number(j.comision);
    // "TABLAS FIJAS" (28-09-2026, a pedido del usuario: "el item tabla
    // fijas no me sale en los balances... todos los item deben verse
    // reflejado con su saldo en balances", y corregido el mismo día tras
    // ver Halland -36 convertirse en "Tablas fijas +36" en vez de
    // "+35,10 / % de tablas fijas +0,90") — el espejo de Tablas Fijas
    // sale NETO de su propia comisión (mismo invariante que
    // resolverTablaFija: cliente + tablasFijas + comisión = 0 exacto).
    //
    // 02-10-2026 (a pedido explícito del usuario, verificando contra OTRO
    // sistema: "106,02 es la comisión que queda en el grupo... eso debe
    // salir en Balance General donde dice COMISIÓN GRUPO... se hicieron
    // de comisión 183,55 [bruta, con el 5%]... la devolución fue de
    // 77,52... restando eso le queda al grupo 106,02"): "% DE TABLAS
    // FIJAS" y "PORCENTAJE MARCAS" (antes acá abajo) DEJAN de armarse
    // como su propio renglón de "cliente" — esa comisión ahora se suma
    // directo a `comisionAdelantadasSemana`, que a su vez se pliega
    // dentro de "COMISIÓN GRUPO" (comisionSemana, más abajo) junto con la
    // de Tercios, para que COMISIÓN GRUPO sea de una vez el total REAL
    // que le queda al grupo (Tercios + Tablas Fijas + Marcas, ya neto de
    // TODO lo devuelto) en vez de solo la parte de Tercios. "TABLAS
    // FIJAS" sigue exactamente igual (NETO de su comisión) — de dónde
    // sale esa comisión (acá adentro, o en el pie) no cambia la cuenta:
    // cliente + TABLAS FIJAS ya no suma 0 solos, el "hueco" que queda
    // (justo la comisionTf) es la misma plata que ahora aparece en
    // COMISIÓN GRUPO.
    if (j.tipo === 'tf') {
      const comisionTf = j.comision != null ? Number(j.comision) : 0;
      acumular('TABLAS FIJAS', -(Number(j.resultado_cliente) + comisionTf));
    }
    // "PORCENTAJE MARCAS" (28-09-2026, "ese item que también es como un
    // cliente, me vas a ir sumando siempre ese 2.5% que deja [el
    // banquero] en marcas" — 02-10-2026, ver la nota grande de arriba:
    // ya NO se arma como su propio renglón de "cliente"; esa comisión
    // (j.comision, armada por resolverBanqueoMarca) ya quedó sumada en
    // comisionAdelantadasSemana arriba, que ahora se pliega en COMISIÓN
    // GRUPO) — los banqueadores (abajo) siguen apareciendo cada uno con
    // su propio monto, ya neto de la comisión que paguen.
    if (Array.isArray(j.banqueadores)) {
      j.banqueadores.forEach(b => acumular(b.nombre, b.monto));
    }
  });

  // Jugadas entre Tercios Adelantadas (04-10-2026; corregido el mismo día
  // a pedido explícito del usuario, viendo el ítem en Balance General: "%
  // TERCIOS ADELANTADAS, no me lo pongas asi aparte, sumamelo directo a la
  // comision del grupo") — jugador y banquero suman exactamente igual que
  // un ticket de Tercios ya resuelto (ambos reales, ambos definitivos
  // apenas sale de 'pendiente'); la comisión del grupo YA NO se arma como
  // su propio renglón de "cliente" — se acumula en
  // comisionTerciosAdelantadasSemana y se pliega directo dentro de
  // "COMISIÓN GRUPO" (comisionSemana, más abajo), mismo criterio que ya
  // se usa para "% DE TABLAS FIJAS"/"PORCENTAJE MARCAS" desde el
  // 02-10-2026 (ver la nota grande de comisionAdelantadasSemana más
  // arriba).
  //
  // OJO — esto SOLO cambia esta función (GET /cierre-final, que alimenta
  // Balance General Y Cierre Final). El Balance General EFÍMERO que se
  // devuelve justo al guardar un plano (mezclarTerciosAdelantadasEnBalance
  // en routes/hipismo.js) SIGUE mostrando "% TERCIOS ADELANTADAS" como su
  // propio ítem aparte, a propósito — mismo motivo técnico por el que
  // "% DE TABLAS FIJAS" también sigue apareciendo aparte ahí: el campo
  // `comisionTotal` que devuelve esa respuesta no se puede inflar sin
  // romper "Comisiones por Carrera", que lee ese mismo valor crudo
  // guardado en hipismo_planos.comision_total (ver la nota grande junto a
  // mezclarAdelantadasEnBalance). Si en la práctica se nota raro que ese
  // ítem aparezca aparte justo al guardar el plano y ya no al recargar la
  // pantalla, avisa para buscarle otra vuelta.
  let comisionTerciosAdelantadasSemana = 0;
  rTerciosAdelantadas.rows.forEach(j => {
    acumular(j.jugador_nombre, j.resultado_jugador);
    acumular(j.banquero_nombre, j.resultado_banquero);
    if (j.comision_grupo) comisionTerciosAdelantadasSemana = round2(comisionTerciosAdelantadasSemana + Number(j.comision_grupo));
  });

  // "% DEVUELTO" (23-09-2026, undécima ronda, a pedido del usuario: "un
  // item llama pedro - porcentaje... recuerda todo debe verse reflejado
  // en balances") — mismo cálculo que Balance General de "Cargar Planos"
  // (ver agregarPorcentajeDevuelto más arriba), pero agregado para TODA
  // la semana: cada cliente con % propio configurado
  // (jugadores.comision_propia) se gana ese % de TODO lo que apostó,
  // gane o pierda cada jugada puntual, sumado como su propio "cliente"
  // aparte ("{NOMBRE} - PORCENTAJE") en esta misma lista.
  //
  // TAMBIÉN EL LADO BANQUERO, EN CUALQUIER PRESENTACIÓN (29-09-2026, caso
  // real "Mrincreible": tiene 1% propio configurado y avales, pero en la
  // jugada real él era el BANQUERO — antes esto se excluía a propósito
  // ("nunca lo que banqueó"); el usuario confirmó primero que quería el %
  // también banqueando Tercios, y luego, a pedido explícito ("las marcas
  // en todas sus presentaciones... deben cumplir todas la misma regla"),
  // que el banqueo de una Marca (Jugadas Adelantadas, j.banqueadores
  // arriba) también cuenta.
  const nombresJugadores = new Set();
  rTickets.rows.forEach(t => nombresJugadores.add(t.cliente_nombre));
  rTickets.rows.forEach(t => nombresJugadores.add(t.banquero_nombre));
  rApuestasRemate.rows.forEach(a => nombresJugadores.add(a.cliente_nombre));
  rAdelantadas.rows.forEach(j => {
    nombresJugadores.add(j.cliente_nombre);
    if (Array.isArray(j.banqueadores)) j.banqueadores.forEach(b => nombresJugadores.add(b.nombre));
  });
  // 05-10-2026: Jugadas entre Tercios Adelantadas también generan el % propio/de
  // aval de sus 2 lados (ver el bloque de acumularDevuelto más abajo).
  rTerciosAdelantadas.rows.forEach(j => {
    nombresJugadores.add(j.jugador_nombre);
    nombresJugadores.add(j.banquero_nombre);
  });
  const comisionesPropias = await obtenerComisionesPropias(grupoId, Array.from(nombresJugadores));
  // "COMISIÓN REAL" (29-09-2026, a pedido del usuario: "de la comisión
  // que queda en el grupo debes restar todos los % que se le devuelven a
  // los clientes para ver la comisión real de cuánto queda en el
  // grupo") — se necesita el TOTAL devuelto (todos los "{destino} -
  // PORCENTAJE" juntos) para restárselo a comisionSemana más abajo. A
  // propósito NO se le resta nada de "% DE TABLAS FIJAS" ni
  // "PORCENTAJE MARCAS" (ver la nota grande de comisionAdelantadasSemana
  // más abajo: esos 2 ya tienen su contraparte EXACTA dentro de la misma
  // lista de "clientes" — TABLAS FIJAS, y cliente+banqueadores de una
  // Marca — así que ya suman $0 netos entre sí; sumarlos o restarlos acá
  // sería contarlos 2 veces). El usuario confirmó con un ejemplo numérico
  // que la fórmula correcta es exactamente: comisión de Tercios del rango
  // MENOS todo lo devuelto — matemáticamente idéntico a "voltear el signo
  // de la suma de TODOS los saldos de la lista" (por eso, para no
  // duplicar lógica, `comisionSemana` se termina de calcular más abajo
  // restando `totalDevueltoSemana` de la comisión de Tercios).
  // FUSIONAR POR CARRERA ANTES DE REDONDEAR (02-10-2026, caso real: Balance
  // General mostraba Comisión $379,65 y el usuario esperaba $379,78 — "SI
  // NO ESTAS REDONDEANDO ALGO" — mismo bug, mismo arreglo YA probado en
  // /comisiones-devueltas, ver la nota grande EXACTA ahí: cuando un cliente
  // tiene 2+ tickets/jugadas en la MISMA carrera, redondear el % devuelto
  // de cada uno por separado y sumar esos redondeos NO siempre da lo mismo
  // que sumar los montos EXACTOS de esa carrera y redondear una sola vez
  // ("suma de redondeos" vs "redondeo de la suma"). Antes, acumularDevuelto
  // redondeaba y sumaba de una vez cada vez que se llamaba — ahora solo
  // acumula el monto EXACTO (sin redondear) agrupado por
  // (carrera, cliente, destino, %) en `porGrupoCarrera`; recién al final
  // (justo antes de armar `clientes`) se redondea UNA vez por grupo y ESE
  // valor ya redondeado es el que se suma a la cuenta destino y a
  // totalDevueltoSemana.
  const porGrupoCarrera = new Map();
  function acumularDevuelto(nombre, monto, claveCarrera) {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return;
    // 24-09-2026: hasta 2 entradas simultáneas por cliente (ver la nota
    // grande de obtenerComisionesPropias) — cada una con su propio
    // destino, así que cada una suma su propio ítem "{destino} -
    // PORCENTAJE" aparte (pueden ser 2 ítems distintos para el mismo
    // cliente en la misma semana) — por eso el grupo incluye destino y %,
    // no solo nombre+carrera.
    infos.forEach(info => {
      if (!info || !info.pct) return;
      const exacto = Math.abs(Number(monto) || 0) * (info.pct / 100);
      if (!exacto) return;
      const claveGrupo = `${claveCarrera}::${nombre}::${info.destino}::${info.pct}`;
      if (!porGrupoCarrera.has(claveGrupo)) {
        // Ver la nota grande de arriba (agregarPorcentajeDevuelto):
        // info.cuentaNombre ya es el nombre final, no hace falta pegarle
        // el sufijo de nuevo.
        porGrupoCarrera.set(claveGrupo, { cuentaNombre: info.cuentaNombre, exacto: 0 });
      }
      porGrupoCarrera.get(claveGrupo).exacto += exacto;
    });
  }
  let totalDevueltoSemana = 0;
  // 26-09-2026, a pedido del usuario ("LOS REMATES NO LE PRODUCEN % DE
  // DEVOLUCION A LOS CLIENTES"): Remate SÍ suma al saldo normal (arriba,
  // acumular()) pero NUNCA genera % devuelto — a propósito no se llama
  // acumularDevuelto() con rApuestasRemate acá.
  //
  // NUNCA una jugada que "no se decidió" (29-09-2026, a pedido explícito
  // del usuario: "toda jugada que no se decida no genera % ni
  // comisión"): un ticket de Tercios queda con resultado_jugador Y
  // resultado_banquero en 0 cuando una Marca "pp"/"a premio" no tuvo
  // ningún caballo que figurara (ver resolverCruzado() en
  // hipismoCalc.js) — se excluye de acumularDevuelto() por completo. Una
  // Marca de Jugadas Adelantadas queda con j.gano en null SOLO cuando
  // quedó 'sin_decidir' (nula, ver resolverClienteMarca en
  // hipismoAdelantadasCalc.js) — Tabla Fija siempre decide true/false, así
  // que filtrar por "j.gano !== null" descarta justo esas.
  //
  // 29-09-2026, BUG REAL encontrado (caso Sebastian: seguía cobrando % de
  // una Marca "pp" nula aun DESPUÉS de este mismo filtro, commit 0fac94f):
  // "pg" devuelve una columna `numeric` como STRING de JS ("0.00"), nunca
  // como number -- así que "t.resultado_jugador === 0" (comparación
  // ESTRICTA string contra number) siempre daba false, sin importar el
  // valor real, y el filtro nunca excluía nada en producción (el mock de
  // los tests sí usaba numbers de JS directos, por eso las pruebas pasaban
  // igual). Se envuelve en Number(...) para comparar de verdad.
  // 02-10-2026 ("LOS % QUE SE DEVUELVEN ES DE LO DECIDIDO NO DE LO
  // APOSTADO... SIEMPRE ES BASE A LO DECIDIDO SIN SACARLE EL 5%"): la base
  // del % propio/de aval es montoDecidido() (la inversa de montoMostrado()
  // en hipismoCalc.js) sobre el resultado YA DECIDIDO de esa línea, nunca
  // t.monto (lo apostado bruto) — en una jugada fraccionada ("10A4") el
  // que gana solo decide una fracción del monto, aunque el que pierde sí
  // suele perder el monto completo (ahí lo decidido y lo apostado
  // coinciden, por eso el bug viejo no se notaba en las pérdidas).
  // NETEO jugador/banquero por carrera (02-10-2026, caso GG: ver la nota
  // grande EXACTA de netearJugadorBanqueroTercios en hipismoCalc.js) — un
  // cliente que juega Y banquea en la MISMA carrera (Tercios únicamente)
  // deja de generar % devuelto por cada lado por separado y pasa a
  // generarlo UNA sola vez sobre el NETO de ambos lados en esa carrera. El
  // resto de los clientes (un solo rol por carrera, la gran mayoría) sigue
  // exactamente igual que siempre — mismo criterio EXACTO que ya usa
  // obtenerApuestasDelRango en routes/hipismo.js para /comisiones-devueltas.
  const netoPorCarreraCierre = netearJugadorBanqueroTercios(rTickets.rows.map(t => ({
    clienteNombre: t.cliente_nombre, banqueroNombre: t.banquero_nombre,
    resultadoJugador: t.resultado_jugador, resultadoBanquero: t.resultado_banquero,
    sinComision: t.sin_comision,
    fecha: t.fecha instanceof Date ? t.fecha.toISOString().slice(0, 10) : t.fecha,
    hipodromoNombre: t.hipodromo_nombre, carreraNumero: t.carrera_numero
  })));
  // Pares (carrera::nombre) ya neteados — evita generar el % devuelto del
  // neto más de una vez por cliente dual cuando tiene varios tickets en la
  // misma carrera (mismo criterio EXACTO que `dualAgregado` en
  // obtenerApuestasDelRango).
  const dualAgregadoCierre = new Set();
  rTickets.rows
    .filter(t => !(Number(t.resultado_jugador) === 0 && Number(t.resultado_banquero) === 0))
    .forEach(t => {
      const fechaFila = t.fecha instanceof Date ? t.fecha.toISOString().slice(0, 10) : t.fecha;
      const claveCarrera = `${fechaFila}::${t.hipodromo_nombre}::${t.carrera_numero}`;
      const infoJugador = netoPorCarreraCierre.get(claveCarrera)?.get(t.cliente_nombre);
      const infoBanquero = netoPorCarreraCierre.get(claveCarrera)?.get(t.banquero_nombre);
      // Lado JUGADOR — se omite si este cliente es dual en esta carrera (su
      // % devuelto sale más abajo, sobre el neto, una sola vez).
      // 04-10-2026: montoDecididoExacto -> montoBaseComisionExacto -- una
      // jugada "a premio" SIN comisión (t.sin_comision, bandera REAL del
      // ticket, NUNCA el `true` hardcodeado de Adelantadas) no debe generar
      // % devuelto, ni ganando ni perdiendo (pedido explícito del usuario,
      // ver la nota grande de montoBaseComisionExacto en
      // hipismoAdelantadasCalc.js).
      if (!(infoJugador && infoJugador.dual)) {
        acumularDevuelto(t.cliente_nombre, montoBaseComisionExacto(t.resultado_jugador, t.sin_comision), claveCarrera);
      }
      // Lado BANQUERO (29-09-2026, ver la nota grande de nombresJugadores
      // más arriba): el lado banquero de Tercios también genera % devuelto
      // — mismo criterio, se omite si es dual.
      if (!(infoBanquero && infoBanquero.dual)) {
        acumularDevuelto(t.banquero_nombre, montoBaseComisionExacto(t.resultado_banquero, t.sin_comision), claveCarrera);
      }
      // % devuelto sobre el NETO — una sola vez por (carrera, cliente) dual,
      // sin importar cuántos tickets lo disparen. netoExacto (02-10-2026,
      // ver la nota grande EXACTA en hipismoAdelantadasCalc.js), no `neto`
      // (ya redondeado) — acumularDevuelto() redondea una sola vez abajo.
      [t.cliente_nombre, t.banquero_nombre].forEach(nombre => {
        const info = netoPorCarreraCierre.get(claveCarrera)?.get(nombre);
        if (!info || !info.dual) return;
        const claveDual = `${claveCarrera}::${nombre}`;
        if (dualAgregadoCierre.has(claveDual)) return;
        dualAgregadoCierre.add(claveDual);
        acumularDevuelto(nombre, info.netoExacto, claveCarrera);
      });
    });
  // resultado_cliente de Jugadas Adelantadas ya es un neto DEFINITIVO sin
  // ningún 5% embebido (ver resolverTablaFija/resolverClienteMarca en
  // hipismoAdelantadasCalc.js) -- montoDecididoExacto con sinComision=true
  // lo deja tal cual, en valor absoluto, SIN redondear (acumularDevuelto()
  // ya no redondea acá -- solo fusiona por carrera; se redondea una vez
  // por grupo al armar `clientes`, más abajo). La clave de carrera usa
  // p.fecha/p.hipodromo_nombre/j.carrera_numero (agregadas arriba a
  // rAdelantadas) para poder fusionar con tickets de Tercios de la misma
  // carrera, igual que ya hace obtenerApuestasDelRango.
  rAdelantadas.rows.filter(j => j.gano !== null).forEach(j => {
    const fechaFila = j.fecha instanceof Date ? j.fecha.toISOString().slice(0, 10) : j.fecha;
    const claveCarrera = `${fechaFila}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    acumularDevuelto(j.cliente_nombre, montoDecididoExacto(j.resultado_cliente, true), claveCarrera);
  });
  // 29-09-2026 (misma nota): el lado BANQUERO de una Marca también genera
  // % devuelto — cada banqueador solo banqueó su `porcentaje` de la base
  // DECIDIDA de la jugada completa (|resultado_cliente|, el mismo "base"
  // que ya usa resolverBanqueoMarca para repartir entre banqueadores —
  // ver services/hipismoAdelantadasCalc.js), nunca de j.monto (el
  // apostado bruto de la Marca completa). (Una Marca nula nunca llega a
  // tener banqueadores -- solo se banquea una Marca ya decidida -- así que
  // este bloque no necesita el mismo filtro de j.gano, pero se deja fuera
  // del .filter() de arriba a propósito para no confundir al próximo
  // lector con un filtro que acá nunca hace nada.)
  rAdelantadas.rows.forEach(j => {
    if (!Array.isArray(j.banqueadores)) return;
    // montoDecididoExacto, no montoDecidido (02-10-2026, ver la nota
    // grande EXACTA en hipismoAdelantadasCalc.js) — sin redondear antes de
    // repartir entre banqueadores.
    const baseJugada = montoDecididoExacto(j.resultado_cliente, true);
    const fechaFila = j.fecha instanceof Date ? j.fecha.toISOString().slice(0, 10) : j.fecha;
    const claveCarrera = `${fechaFila}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    j.banqueadores.forEach(b => {
      const parte = baseJugada * (Number(b.porcentaje) || 0) / 100;
      acumularDevuelto(b.nombre, parte, claveCarrera);
    });
  });

  // Jugadas entre Tercios Adelantadas (05-10-2026, a pedido explícito del
  // usuario, tras ver "12 de 72 cliente(s) no cuadran" en Detallado por
  // Cliente: el link y las cuentas de comisión SÍ le cobraban al cliente su
  // % propio/de aval sobre estas jugadas, pero esta grilla (la referencia
  // "golden") nunca las contaba -- el usuario decidió: "que lo gane en todos
  // lados"). Se acumula EXACTO por carrera, igual que Tercios/Adelantadas
  // (misma claveCarrera, así fusiona con cualquier otra jugada del mismo
  // cliente en esa carrera y se redondea una sola vez abajo). Base = lo
  // DECIDIDO (inversa del % de comisión configurado en ESA jugada, ver
  // montoBaseTerciosAdelantadaExacto) y jamás una jugada que no se decidió
  // (resultado 0 -- 'sin_decidir'). Ambos lados (jugador y banquero)
  // generan % -- mismo criterio que el lado banquero de Tercios.
  rTerciosAdelantadas.rows.forEach(j => {
    const fechaFila = j.fecha instanceof Date ? j.fecha.toISOString().slice(0, 10) : j.fecha;
    const claveCarrera = `${fechaFila}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    if (Number(j.resultado_jugador) !== 0) {
      acumularDevuelto(j.jugador_nombre, montoBaseTerciosAdelantadaExacto(j.resultado_jugador, j.comision_porcentaje), claveCarrera);
    }
    if (Number(j.resultado_banquero) !== 0) {
      acumularDevuelto(j.banquero_nombre, montoBaseTerciosAdelantadaExacto(j.resultado_banquero, j.comision_porcentaje), claveCarrera);
    }
  });

  // Recién ahora se redondea UNA vez por (carrera, cliente, destino, %) —
  // ver la nota grande EXACTA de acumularDevuelto más arriba — y ese valor
  // ya redondeado es el que se suma a la cuenta destino y a
  // totalDevueltoSemana (nunca al revés).
  porGrupoCarrera.forEach(({ cuentaNombre, exacto }) => {
    const devuelto = round2(exacto);
    if (!devuelto) return;
    acumular(cuentaNombre, devuelto);
    totalDevueltoSemana = round2(totalDevueltoSemana + devuelto);
  });

  const clientes = Array.from(porCliente.values())
    .map(c => ({ ...c, saldo: c.gano - c.perdio }));

  // AJUSTE POR CRUCE (26-09-2026, a pedido del usuario: "LOS PLANOS SI ME
  // ESTAN CRUZANDO LAS JUGADAS SI ME LAS ESTA CRUZANDO FIJATE LUSHO-100
  // PERO EN LOS BALANCES NO ME LA ESTA CRUZANDO... CORRIGE" — el bug: en
  // un plano con cruza_jugadas=true, calcularPlano() guarda cada ticket
  // con su valor YA "mostrado" línea por línea (sin cruzar) — el cruce
  // real (neto por cliente, comisión una sola vez sobre el neto) solo
  // vive en el total efímero que "Cargar Planos" muestra una vez y
  // nunca se persiste. Acá se reconstruye ese neto cruzado por plano
  // (calcularAjustesCruce, en services/hipismoCalc.js) y se suma la
  // diferencia contra la suma "sin cruzar" de las líneas de ese cliente
  // en ese plano — así el saldo de Cierre Final (y, por el mismo
  // mecanismo en obtenerLineasHipismoCliente, Balance General y el link
  // del cliente) coincide con lo que el plano cruzado realmente cobra.
  const ticketsPorPlanoCruzado = new Map();
  rTickets.rows.forEach(t => {
    if (!t.cruza_jugadas) return;
    if (!ticketsPorPlanoCruzado.has(t.plano_id)) ticketsPorPlanoCruzado.set(t.plano_id, []);
    ticketsPorPlanoCruzado.get(t.plano_id).push({
      clienteNombre: t.cliente_nombre,
      banqueroNombre: t.banquero_nombre,
      resultadoJugador: Number(t.resultado_jugador),
      resultadoBanquero: Number(t.resultado_banquero),
      sinComision: t.sin_comision
    });
  });
  ticketsPorPlanoCruzado.forEach(ticketsDelPlano => {
    const ajustesCruce = calcularAjustesCruce(ticketsDelPlano);
    Object.keys(ajustesCruce).forEach(nombre => {
      const monto = ajustesCruce[nombre];
      if (!monto) return;
      let c = clientes.find(x => x.nombre === nombre);
      if (!c) { c = { nombre, jugadas: 0, gano: 0, perdio: 0, saldo: 0 }; clientes.push(c); }
      c.saldo = round2(c.saldo + monto);
    });
  });

  // TRASPASO DE COMISIÓN (26-09-2026, ver POST /comisiones/traspaso en
  // routes/hipismo.js) — se suma/resta encima del saldo ya calculado; si
  // el cliente del ajuste no tenía ninguna jugada esta semana (ej. recién
  // recibió un traspaso sin haber jugado nada), se agrega como una fila
  // nueva.
  const ajustesComision = await obtenerAjustesComision(grupoId, desde, hasta);
  Object.keys(ajustesComision).forEach(nombre => {
    const monto = ajustesComision[nombre];
    if (!monto) return;
    let c = clientes.find(x => x.nombre === nombre);
    if (!c) { c = { nombre, jugadas: 0, gano: 0, perdio: 0, saldo: 0 }; clientes.push(c); }
    c.saldo = round2(c.saldo + monto);
  });

  // CARGA MASIVA ESPECIAL (05-10-2026, ver la nota grande de
  // services/hipismoCargasEspeciales.js): cada línea es un movimiento de
  // saldo directo (positivo gana, negativo pierde) que se suma encima, igual
  // que un traspaso; la suma de cada carga es 0 por construcción, así que los
  // totales siguen cuadrando. Si el cliente no tenía nada esta semana, se
  // agrega como una fila nueva.
  const cargasEspeciales = await obtenerCargasEspecialesRango(grupoId, desde, hasta);
  cargasEspeciales.forEach(l => {
    let c = clientes.find(x => x.nombre === l.clienteNombre);
    if (!c) { c = { nombre: l.clienteNombre, jugadas: 0, gano: 0, perdio: 0, saldo: 0 }; clientes.push(c); }
    c.saldo = round2(c.saldo + l.monto);
  });

  // ÍTEM "REMATE" (26-09-2026, a pedido del usuario: "esos 2000 negativos
  // deben salir en un ítem en balance como si fuera OTRO CLIENTE llamado
  // REMATE, igual detallado en que carrera fue y en que hipódromo... creo
  // que actualmente no lo estás colocando en su ítem llamado remate, sino
  // que lo estás sumando en la comisión... soluciona eso"). Cada remate
  // guarda en comision_total el resultado (ganancia o pérdida) de ESE
  // remate puntual — sea "REMATE PAGA" (monto fijo) o "REMATE GARANTIZA"
  // (piso + %, incluyendo el 20% de ganancia de la casa cuando aplica) —
  // ver la nota grande de calcularRemate en services/hipismoRemateCalc.js.
  // Acá se suma TODO eso como un ítem más de "clientes", nunca mezclado
  // con comisionSemana/comisionAdelantadasSemana.
  const rComisionRemate = await db.query(
    `SELECT COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_remates WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );
  const resultadoRemateSemana = round2(Number(rComisionRemate.rows[0].total));
  if (resultadoRemateSemana) {
    let cRemate = clientes.find(x => x.nombre === NOMBRE_ITEM_REMATE);
    if (!cRemate) { cRemate = { nombre: NOMBRE_ITEM_REMATE, jugadas: 0, gano: 0, perdio: 0, saldo: 0 }; clientes.push(cRemate); }
    cRemate.saldo = round2(cRemate.saldo + resultadoRemateSemana);
  }

  clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Comisión de Tercios de la semana: mismo total ya guardado por plano
  // (ver /comisiones-por-carrera en routes/hipismo.js) — no depende de
  // los tickets sueltos.
  const rComision = await db.query(
    `SELECT COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );
  // "COMISIÓN REAL" (29-09-2026, "de la comisión que queda en el grupo
  // debes restar todos los % que se le devuelven a los clientes para ver
  // la comisión real de cuánto queda en el grupo" — confirmado con un
  // ejemplo numérico exacto, "CASO A PARA TODOS LOS RENGLONES").
  //
  // "COMISIÓN GRUPO" = TODO, no solo Tercios (02-10-2026, a pedido
  // explícito del usuario verificando contra otro sistema — ver la nota
  // grande de comisionAdelantadasSemana más arriba): antes, comisionSemana
  // era SOLO la comisión de Tercios menos lo devuelto, porque "% DE
  // TABLAS FIJAS"/"PORCENTAJE MARCAS" ya aparecían como su propio renglón
  // de "cliente" (sumarlos acá también habría sido pagarlos 2 veces). Ya
  // que esos 2 renglones dejaron de armarse (ver arriba), ahora SÍ hace
  // falta sumarlos acá para que no se pierda esa plata — por eso se le
  // suma comisionAdelantadasSemana (Tablas Fijas + Marcas, ya con su
  // propio % devuelto restado adentro de totalDevueltoSemana). El
  // resultado es exactamente la fórmula que confirmó el usuario con el
  // otro sistema: "se hicieron de comisión 183,55 [bruta, de TODOS los
  // tipos de jugada, con el 5%]... la devolución fue de 77,52... restando
  // eso le queda al grupo 106,02" — comisión BRUTA (Tercios+TF+Marcas)
  // menos TODO lo devuelto (Tercios+TF+Marcas). Remate NUNCA entra acá —
  // sigue siendo su propio ítem "REMATE" aparte, nunca "comisión" del
  // grupo (ver la nota grande de comisionRemateSemana más abajo).
  const comisionSemana = round2(Number(rComision.rows[0].total) - totalDevueltoSemana + comisionAdelantadasSemana + comisionTerciosAdelantadasSemana);

  return {
    clientes,
    comisionSemana,
    // comisionRemateSemana (26-09-2026): se sigue devolviendo el dato
    // crudo por compatibilidad, pero YA NO representa "comisión" — el
    // frontend ya no lo suma al total de comisión mostrado (ver el ítem
    // "REMATE" arriba, dentro de "clientes", que es donde se muestra de
    // verdad ahora).
    comisionRemateSemana: Number(rComisionRemate.rows[0].total),
    // comisionAdelantadasSemana (23-09-2026): comisión cruda de Tablas
    // Fijas + Marcas de la semana. 02-10-2026: ahora SÍ está sumada
    // dentro de comisionSemana ("COMISIÓN GRUPO", ver la nota grande de
    // arriba) — se sigue devolviendo también suelta por compatibilidad.
    comisionAdelantadasSemana,
    // comisionTerciosAdelantadasSemana (04-10-2026): comisión cruda de
    // Jugadas entre Tercios Adelantadas de la semana, ya sumada dentro de
    // comisionSemana (ver la nota grande de arriba) — se devuelve también
    // suelta por compatibilidad, mismo criterio que comisionAdelantadasSemana.
    comisionTerciosAdelantadasSemana
  };
}

// =================================================================
// DIAGNÓSTICO: cuadre entre Balance General/Cierre Final y el link/
// detalle de CADA cliente (03-10-2026, a pedido del usuario después del
// caso "Mrmoney" y de encontrar OTRO caso igual con "Legolas", un cliente
// normal mostrando $2.863,98 en la grilla y $2.871,98 en su propio modal:
// "encontré otro cliente con el mismo error... necesito soluciones este
// error de raíz para todos"). En vez de seguir arreglando un caso a la
// vez cada vez que alguien manda una captura de pantalla, esta función
// corre LOS 2 CÁLCULOS para cada cliente real de un grupo
// (construirCierreFinalHipismo, la referencia "golden" de Balance
// General/Cierre Final/"Detallado por Cliente", y
// construirResumenClienteHipismo, lo que ve el cliente en su link propio
// Y el Administrador al hacerle click en "Detallado por Cliente") y
// reporta CUALQUIER cliente donde los 2 totales no cuadren, con ambos
// montos — así deja de depender de que alguien reporte "acá me sale un
// número y allá otro" para encontrar estos huecos: se puede correr
// después de cualquier cambio y confirmar que TODOS los clientes de un
// grupo cuadran, no solo el que se revisó a mano.
//
// Ítems que no son una ficha real de "jugadores" (WINNERS, TABLAS FIJAS,
// REMATE, un banqueador que ya no existe como cliente, etc.) no tienen
// link/detalle propio con el que comparar — se saltan solos (no hay
// jugador que buscar por ese nombre).
// =================================================================
async function diagnosticarSaldosHipismo(grupoId, grupo, desde, hasta) {
  const resultadoCierre = await construirCierreFinalHipismo(grupoId, desde, hasta);
  // 03-10-2026 -- BUG REAL encontrado con el caso real de "Sebastian"
  // (toggle "incluir % en sus jugadas" ON): esta query solo traía
  // id/grupo_id/nombre/modulos_anclados/es_cuenta_comision, SIN
  // comision_propia NI incluir_porcentaje_en_jugadas -- construirResumen
  // ClienteHipismo lee esos 2 campos directo del objeto `jugador` que le
  // pasamos (ver pctPropioIncluido más abajo en este archivo) para sumarle
  // el % incluido a cada jugada. Faltando esos campos, pctPropioIncluido
  // siempre daba 0 acá (aunque el cliente SÍ tuviera el toggle ON), y el
  // diagnóstico comparaba el total SIN el % incluido contra la grilla
  // (que sí lo trae bien, por otro camino) -- un FALSO POSITIVO de este
  // propio diagnóstico, no una discrepancia real de dinero.
  const rJugadores = await db.query(
    'SELECT id, grupo_id, nombre, modulos_anclados, es_cuenta_comision, comision_propia, incluir_porcentaje_en_jugadas FROM jugadores WHERE grupo_id = $1',
    [grupoId]
  );
  const porNombre = new Map(rJugadores.rows.map(j => [j.nombre, j]));
  // rangoPersonalizado (no semanaParam) para los dos cálculos: así
  // comparan EXACTAMENTE el mismo rango de fechas, sin depender de que
  // "semana actual" resuelva al mismo desde/hasta en 2 llamadas separadas
  // a hoyVenezuela() (nunca debería diferir, pero esto lo deja imposible).
  const rangoPersonalizado = { desde, hasta };

  // ÍTEMS PSEUDO SIEMPRE SE SALTAN POR NOMBRE, no solo cuando no hay
  // jugador que calce (03-10-2026, caso real "Winners" en producción:
  // salió reportado como discrepancia con +$15,00 de diferencia). Estos 3
  // nombres (acumular('WINNERS', ...), acumular('TABLAS FIJAS', ...) y
  // NOMBRE_ITEM_REMATE más arriba en este archivo) son renglones
  // AGREGADOS que arma Cierre Final solo, nunca la ficha de un cliente
  // real -- si por coincidencia existe un jugador real con ese mismo
  // nombre exacto en el grupo (ej. un cliente literal llamado "Winners"),
  // comparar su propio link contra el renglón agregado de Cierre Final
  // compara 2 cosas completamente distintas y siempre va a dar "distinto"
  // sin que sea un bug de dinero.
  const NOMBRES_PSEUDO_ITEM = new Set(['WINNERS', 'TABLAS FIJAS', 'REMATE']);
  const discrepancias = [];
  for (const c of resultadoCierre.clientes) {
    if (NOMBRES_PSEUDO_ITEM.has(c.nombre)) continue;
    const jugador = porNombre.get(c.nombre);
    if (!jugador) continue;
    const resumen = await construirResumenClienteHipismo(jugador, grupo, 'actual', rangoPersonalizado);
    const totalGrid = round2(c.saldo);
    // totalHipismo, NUNCA totalSemana (03-10-2026): Cierre Final/Balance
    // General es EXCLUSIVO de Hipismo (nunca consulta tickets_historial de
    // Deportes) — si se comparara contra totalSemana, CUALQUIER cliente
    // con "Deportes anclado" (modulos_anclados, una comodidad para que ese
    // cliente vea sus 2 módulos juntos en su propio link) saldría marcado
    // como "discrepancia" sin serlo, solo porque su link suma Deportes y
    // Cierre Final nunca lo tuvo que sumar.
    const totalLink = round2(resumen.resumen.totalHipismo);
    if (Math.abs(round2(totalLink - totalGrid)) >= 0.01) {
      discrepancias.push({ nombre: c.nombre, totalGrid, totalLink, diferencia: round2(totalLink - totalGrid) });
    }
  }
  return { rango: { desde, hasta }, totalClientesRevisados: resultadoCierre.clientes.length, discrepancias };
}

module.exports = {
  construirResumenClienteHipismo, construirResumenRemateHipismo, construirResumenWinnersHipismo,
  construirResumenTablasFijasHipismo, construirCierreFinalHipismo, diagnosticarSaldosHipismo
};
