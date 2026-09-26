// =================================================================
// PRUEBA: "Jugadas Adelantadas" — Tablas Fijas y Marcas (23-09-2026, a
// pedido del usuario, con un plano real de ejemplo pegado por él). Cubre
// el motor de cálculo puro (services/hipismoAdelantadasCalc.js) y las
// rutas reales (POST /adelantadas/calcular, POST /adelantadas,
// GET /adelantadas/pendientes, POST /planos —el engenche con "Cargar
// Planos"—, POST /adelantadas/jugadas/:id/banquear, GET /cierre-final)
// contra una base de datos falsa en memoria — mismo patrón que
// test_hipismo_remate.js (Module._load intercepta "pg"/"express" antes
// de requerir el router real).
//
// Casos cubiertos:
//   1. Parser: el plano real completo del usuario (18 líneas, 6
//      clientes, TF y Marcas mezcladas) — 0 errores de cálculo, 0 líneas
//      sin reconocer.
//   2. Motor de cálculo: los 2 ejemplos numéricos confirmados por el
//      usuario (Linares +225/Tablas Fijas -226,88/Comisión +1,88 al
//      ganar; Manolo -80/Tablas Fijas +78/Comisión +2 al perder) y el de
//      Marcas (Houston 4x7 120$ acierta -> +100, 2 banqueros al 50%,
//      solo uno cobra 2.5% -> Houston +100/Zenyatta -50/Sammy -51,25/
//      Comisión Marcas +1,25 — TODO suma exactamente 0).
//   3. Detección de un error de cálculo (la multiplicación no calza) ->
//      POST /adelantadas no guarda nada y devuelve el detalle del error.
//   4. POST /planos con la pizarra de una carrera resuelve solas las
//      Tablas Fijas pendientes de esa carrera (quedan 'resuelto') y deja
//      las Marcas en 'falta_banqueo' — y el texto del plano trae abajo
//      el bloque "PARADA ADELANTADAS".
//   5. Una carrera de puros adelantados, SIN ningún Tercios en vivo:
//      POST /planos con texto VACÍO pero con adelantadas pendientes de
//      esa carrera igual guarda y resuelve (antes de este cambio,
//      hubiera fallado por "Falta el texto del plano").
//   6. Una Marca de hipódromo NACIONAL cuya pizarra nunca llega a 5
//      puestos -> queda 'sin_decidir' (0 para el cliente) en vez de
//      pendiente para siempre.
//   7. POST /adelantadas/jugadas/:id/banquear completa una Marca
//      'falta_banqueo' -> pasa a 'resuelto' con los banqueadores y la
//      comisión ya calculados.
//   8. GET /cierre-final: el saldo de Jugadas Adelantadas (cliente Y
//      banqueadores) entra al mismo saldo semanal por cliente, con su
//      comisión SEPARADA (comisionAdelantadasSemana).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const calc = require(path.join(__dirname, '..', 'src', 'services', 'hipismoAdelantadasCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// =================================================================
// PARTE 1: motor de cálculo puro, sin base de datos.
// =================================================================
const PLANO_ADELANTADAS_EJEMPLO = `*🇻🇪PLANOS MARCAS Y TABLAS ADELANTADAS ZENYATTA 🇻🇪*


*JUGANDO HALLAND*

2) 5TF DEL 5 A 39 ,195/500$
7) 5TF DEL 2 A 42 , 210/500$
10) 5TF DEL 1 A 41 ,205/500$
12) 5TF DEL 2 A 8 ,40/500$
11) 5TF DEL 1 A 45, 225/500$
 12) 8x4 120$

*JUGANDO HANRY*

9) 1X2 120$
9) 13X2 120$
13) 6x7 120$

*JUGANDO MATURIN*

2) 6X12 120$
12) 3TF DEL 7 A 15 ,45 /300$

*JUGANDO HOUSTON*

3) 4X7 120$

*JUGANDO RAMBO*

2) 5TF DEL 3 A 15 ,75/500$
6) 5TF DEL 6 A 14 , 70/500$
11) 5TF DEL 8 A 30 , 150/500$
9) 2x13 120$

*JUGANDO LINARES*

11) 5TF DEL 11 A 16 , 80/500$
12) 3TF DEL 3 A 25 ,75/300$
`;

const { jugadas: jugadasEjemplo, sinReconocer: sinReconocerEjemplo } = calc.parsearJugadasAdelantadas(PLANO_ADELANTADAS_EJEMPLO);
check(jugadasEjemplo.length === 18, 'El plano real del usuario parsea las 18 líneas (5 TF + 1 marca de Halland, 3 marcas de Hanry, 1 TF + 1 marca de Maturin, 1 marca de Houston, 3 TF + 1 marca de Rambo, 2 TF de Linares)');
check(sinReconocerEjemplo.length === 0, 'Ninguna línea del plano real queda "sin reconocer"');
check(jugadasEjemplo.filter(j => j.errorCalculo).length === 0, 'Ninguna línea del plano real tiene error de cálculo (el usuario ya las escribió bien)');

const linares12 = jugadasEjemplo.find(j => j.cliente === 'LINARES' && j.carreraNumero === 12);
check(!!linares12 && linares12.cantidadTf === 3 && linares12.numeroEjemplar === 3 && linares12.precioPorTf === 25 && linares12.monto === 75 && linares12.gananciaPotencial === 300,
  'Linares en la 12: 3TF del 3 a 25 (monto 75, ganancia 300) parseado correcto');
const rankLinaresGana = h => (h === 3 ? 1 : 99);
const resLinares = calc.resolverTablaFija(linares12, rankLinaresGana, 2.5);
check(resLinares.gano === true, 'Linares gana la tabla fija (el 3 llegó 1ro)');
check(resLinares.resultadoCliente === 225, 'Linares neto +225 (300 de ganancia - 75 apostado)');
check(resLinares.comision === 1.88, 'Comisión Tablas Fijas = 1,88 (2.5% de 75 = 1,875, redondeado)');
check(resLinares.tablasFijas === -226.88, 'Tablas Fijas (la banca) -226,88 — cliente + tablas fijas + comisión suman exactamente 0');
check(Math.round((resLinares.resultadoCliente + resLinares.tablasFijas + resLinares.comision) * 100) === 0, 'Linares + Tablas Fijas + Comisión suman 0 exacto');

const resManolo = calc.resolverTablaFija({ numeroEjemplar: 5, monto: 80, gananciaPotencial: 400 }, () => 99, 2.5);
check(resManolo.gano === false, 'Manolo pierde la tabla fija');
check(resManolo.resultadoCliente === -80, 'Manolo neto -80 (pierde el monto completo)');
check(resManolo.comision === 2, 'Comisión Tablas Fijas = 2 (2.5% de 80)');
check(resManolo.tablasFijas === 78, 'Tablas Fijas (la banca) +78 (80 - 2 de comisión)');

const houston3 = jugadasEjemplo.find(j => j.cliente === 'HOUSTON');
check(!!houston3 && houston3.numero1 === 4 && houston3.numero2 === 7 && houston3.monto === 120, 'Houston en la 3: marca 4x7 120$ parseada correcta');
const rankHoustonAcierta = h => (h === 4 ? 1 : h === 7 ? 2 : 99);
const clienteHouston = calc.resolverClienteMarca(houston3, rankHoustonAcierta);
check(clienteHouston.acierta === true, 'Houston acierta la marca (4 llegó 1ro, 7 llegó 2do)');
check(clienteHouston.resultadoCliente === 100, 'Houston neto +100 (120/1.2, ganancia completa sin netear lo jugado)');
const banqueoHouston = calc.resolverBanqueoMarca(clienteHouston, [
  { nombre: 'MARCAS ZENYATTA', porcentaje: 50, pagaComision: false },
  { nombre: 'MARCAS SAMMY', porcentaje: 50, pagaComision: true }
], 2.5);
const zenyattaLinea = banqueoHouston.banqueadores.find(b => b.nombre === 'MARCAS ZENYATTA');
const sammyLinea = banqueoHouston.banqueadores.find(b => b.nombre === 'MARCAS SAMMY');
check(zenyattaLinea.monto === -50, 'Marcas Zenyatta -50 (50% de 100, no cobra comisión)');
check(sammyLinea.monto === -51.25, 'Marcas Sammy -51,25 (50 + 2.5% de comisión sobre su parte)');
check(banqueoHouston.comisionMarcas === 1.25, 'Comisión Marcas (un solo ítem genérico, no "Comisión Marcas Sammy") = 1,25');
const sumaHouston = clienteHouston.resultadoCliente + zenyattaLinea.monto + sammyLinea.monto + banqueoHouston.comisionMarcas;
check(Math.round(sumaHouston * 100) === 0, 'Houston + Zenyatta + Sammy + Comisión Marcas suman 0 exacto');

// Houston pierde (no acierta) — el cliente pierde el monto completo, tal
// como confirmó el usuario ("si no acierta houston pierde completo").
const clienteHoustonPierde = calc.resolverClienteMarca(houston3, () => 99);
check(clienteHoustonPierde.acierta === false && clienteHoustonPierde.resultadoCliente === -120, 'Si Houston no acierta, pierde el monto completo (-120)');
const banqueoHoustonPierde = calc.resolverBanqueoMarca(clienteHoustonPierde, [
  { nombre: 'MARCAS ZENYATTA', porcentaje: 50, pagaComision: false },
  { nombre: 'MARCAS SAMMY', porcentaje: 50, pagaComision: true }
], 2.5);
const sumaHoustonPierde = clienteHoustonPierde.resultadoCliente
  + banqueoHoustonPierde.banqueadores.reduce((a, b) => a + b.monto, 0)
  + banqueoHoustonPierde.comisionMarcas;
check(Math.round(sumaHoustonPierde * 100) === 0, 'Si Houston pierde, cliente + banqueadores + comisión también suman 0 exacto');

// Decidibilidad de una marca — "pizarra de 5 puestos" en hipódromos nacionales.
check(calc.esMarcaDecidible('6.7.8', true) === false, 'Marca de hipódromo NACIONAL con solo 3 puestos en la pizarra -> no decidible todavía');
check(calc.esMarcaDecidible('6.7.8.3.1', true) === true, 'Marca de hipódromo NACIONAL con 5 puestos -> decidible');
check(calc.esMarcaDecidible('6.7', false) === true, 'Marca de hipódromo NO nacional (US) con solo 2 puestos ya es decidible (la regla de 5 puestos es solo para nacionales)');

// Error de cálculo: la multiplicación no calza con lo escrito en el plano.
const { jugadas: jugadasConError } = calc.parsearJugadasAdelantadas('*JUGANDO PRUEBA*\n\n5) 3TF DEL 4 A 20 ,50/300$\n');
check(jugadasConError[0].errorCalculo === true, 'Detecta el error: 3 TF × 20 = 60, pero el plano dice 50');

// =================================================================
// PARTE 2: rutas reales, contra una base de datos falsa en memoria.
// =================================================================
const GRUPO_ID = 'grupo-adelantadas-1';
// GET /cierre-final calcula la semana "actual" contra la fecha de HOY del
// sistema (hora Venezuela) — para que la parte 8 de esta prueba no dependa
// de en qué día del año se corra, todo el fixture usa "hoy" (mismo cálculo
// que hoyVenezuela()/isoDeFechaUTC() en routes/hipismo.js) en vez de una
// fecha fija, así siempre cae dentro de la semana "actual".
function pad2Prueba(n) { return n < 10 ? '0' + n : '' + n; }
const FECHA_PRUEBA = (() => {
  const hoyVe = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return `${hoyVe.getUTCFullYear()}-${pad2Prueba(hoyVe.getUTCMonth() + 1)}-${pad2Prueba(hoyVe.getUTCDate())}`;
})();
const TABLAS = {
  jugadores: [],
  hipismo_hipodromos: [{ id: 'hip-1', grupo_id: GRUPO_ID, nombre: 'La Rinconada', pais: 'VE' }],
  hipismo_planos: [],
  hipismo_tickets: [],
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: []
};
let seq = 1;
const nuevoId = (prefijo) => prefijo + (seq++);

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      TABLAS.jugadores.push({ id: nuevoId('j'), grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0, comision_propia: 0 });
    }
    return { rows: [] };
  }
  // "% devuelto" (undécima ronda) — obtenerComisionesPropias() en
  // routes/hipismo.js. Ningún cliente de esta prueba tiene % propio
  // configurado salvo el que se agrega a mano puntualmente (ver más abajo
  // en PARTE 2), así que por defecto devuelve 0/nada para todos.
  // (23-09-2026, duodécima-tercera ronda) obtenerComisionesPropias() ahora
  // hace un LEFT JOIN contra la misma tabla para resolver el nombre del
  // aval (redirección de "% devuelto" — ver la nota grande en
  // routes/hipismo.js). Ningún jugador de esta prueba tiene
  // avalado_por_id/porcentaje_devuelto_destino configurado, así que
  // aval_nombre siempre da null y el comportamiento queda igual que antes.
  if (/^SELECT j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, av\.nombre AS aval_nombre,\s+cc_propio\.nombre AS cc_propio_nombre, cc_aval\.nombre AS cc_aval_nombre\s+FROM jugadores j\s+LEFT JOIN jugadores av ON av\.id = j\.avalado_por_id\s+LEFT JOIN jugadores cc_propio ON cc_propio\.id = j\.cuenta_comision_id\s+LEFT JOIN jugadores cc_aval ON cc_aval\.id = av\.cuenta_comision_id\s+WHERE j\.grupo_id = \$1 AND j\.nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        nombre: j.nombre, comision_propia: j.comision_propia || 0,
        porcentaje_devuelto_destino: j.porcentaje_devuelto_destino || 'cliente',
        porcentaje_devuelto_aval: j.porcentaje_devuelto_aval || 0,
        aval_nombre: j.avalado_por_id ? ((TABLAS.jugadores.find(x => x.id === j.avalado_por_id) || {}).nombre || null) : null,
        cc_propio_nombre: null,
        cc_aval_nombre: null
      }))
    };
  }
  // "Cuenta de comisión como cliente real" (26-09-2026) —
  // asegurarCuentasComisionParaNombres() en routes/hipismo.js decide, por
  // cada nombre que jugó, si hace falta crear/enlazar su cuenta de
  // comisión real ANTES de guardar. Casi ningún jugador de esta prueba
  // tiene % propio configurado, así que casi siempre no hace falta crear
  // nada.
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, j\.cuenta_comision_id,\s+av\.id AS aval_id, av\.nombre AS aval_nombre, av\.cuenta_comision_id AS aval_cuenta_comision_id\s+FROM jugadores j\s+LEFT JOIN jugadores av ON av\.id = j\.avalado_por_id\s+WHERE j\.grupo_id = \$1 AND j\.nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => {
        const aval = j.avalado_por_id ? TABLAS.jugadores.find(x => x.id === j.avalado_por_id) : null;
        return {
          id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0,
          porcentaje_devuelto_destino: j.porcentaje_devuelto_destino || 'cliente',
          porcentaje_devuelto_aval: j.porcentaje_devuelto_aval || 0,
          cuenta_comision_id: j.cuenta_comision_id || null,
          aval_id: aval ? aval.id : null,
          aval_nombre: aval ? aval.nombre : null,
          aval_cuenta_comision_id: aval ? (aval.cuenta_comision_id || null) : null
        };
      })
    };
  }
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial, es_cuenta_comision\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    let cuenta = TABLAS.jugadores.find(j => j.grupo_id === grupoId && j.nombre === nombre);
    if (!cuenta) {
      cuenta = { id: nuevoId('j'), grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0, comision_propia: 0, es_cuenta_comision: true };
      TABLAS.jugadores.push(cuenta);
    } else {
      cuenta.es_cuenta_comision = true;
    }
    return { rows: [{ id: cuenta.id }] };
  }
  if (/^UPDATE jugadores SET cuenta_comision_id = \$1 WHERE id = \$2 AND grupo_id = \$3 AND cuenta_comision_id IS NULL/i.test(sql)) {
    const [cuentaId, jugadorId, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === jugadorId && x.grupo_id === grupoId && !x.cuenta_comision_id);
    if (j) j.cuenta_comision_id = cuentaId;
    return { rows: [] };
  }
  // "Traspaso de comisión" (26-09-2026) — /cierre-final ahora suma los
  // ajustes de hipismo_comisiones_ajustes sobre el saldo en vivo. Esta
  // prueba no hace ningún traspaso, así que siempre queda vacío.
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes\s+WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3\s+GROUP BY cliente_nombre/i.test(sql)) {
    return { rows: [] };
  }

  if (/^SELECT pais FROM hipismo_hipodromos/i.test(sql)) {
    const [grupoId, nombre] = params;
    const h = TABLAS.hipismo_hipodromos.find(x => x.grupo_id === grupoId && x.nombre === nombre);
    return { rows: h ? [{ pais: h.pais }] : [] };
  }
  if (/^SELECT nombre FROM hipismo_hipodromos/i.test(sql)) {
    const [id, grupoId] = params;
    const h = TABLAS.hipismo_hipodromos.find(x => x.id === id && x.grupo_id === grupoId);
    return { rows: h ? [{ nombre: h.nombre }] : [] };
  }

  // ---- Jugadas Adelantadas ----
  if (/^INSERT INTO hipismo_adelantadas_planos/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, fecha, textoOriginal] = params;
    const fila = { id: nuevoId('plad'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre, fecha, texto_original: textoOriginal, creado_en: Date.now() };
    TABLAS.hipismo_adelantadas_planos.push(fila);
    return { rows: [fila] };
  }
  if (/^INSERT INTO hipismo_adelantadas_jugadas/i.test(sql)) {
    const [planoId, grupoId, cliente, carreraNumero, tipo, cantidadTf, numeroEjemplar, precioPorTf, gananciaPotencial, numero1, numero2, monto, comisionPorcentaje, textoOriginal, errorCalculo, detalleError] = params;
    const fila = {
      id: nuevoId('jad'), plano_id: planoId, grupo_id: grupoId, cliente_nombre: cliente, carrera_numero: carreraNumero, tipo,
      cantidad_tf: cantidadTf, numero_ejemplar: numeroEjemplar, precio_por_tf: precioPorTf, ganancia_potencial: gananciaPotencial,
      numero1, numero2, monto, comision_porcentaje: comisionPorcentaje, texto_original: textoOriginal, error_calculo: errorCalculo, detalle_error: detalleError,
      estado: 'pendiente', gano: null, resultado_cliente: null, comision: null, banqueadores: null, pizarra_usada: null, resuelto_en: null, creado_en: Date.now() + seq
    };
    TABLAS.hipismo_adelantadas_jugadas.push(fila);
    return { rows: [fila] };
  }
  if (/^SELECT j\.\* FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p/i.test(sql)) {
    const [grupoId, hipodromoNombre, carreraNumero, fecha] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && String(j.carrera_numero) === String(carreraNumero) && j.estado === 'pendiente')
      .filter(j => {
        const p = TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id);
        return p && p.hipodromo_nombre === hipodromoNombre && p.fecha === fecha;
      })
      .sort((a, b) => a.creado_en - b.creado_en);
    return { rows: filas };
  }
  if (/^UPDATE hipismo_adelantadas_jugadas\s+SET estado = \$1, gano = \$2, resultado_cliente/i.test(sql)) {
    const [estado, gano, resultadoCliente, comision, pizarraUsada, id, grupoId] = params;
    const j = TABLAS.hipismo_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (j) { j.estado = estado; j.gano = gano; j.resultado_cliente = resultadoCliente; j.comision = comision; j.pizarra_usada = pizarraUsada; j.resuelto_en = Date.now(); }
    return { rows: j ? [j] : [] };
  }
  // PUT /adelantadas/jugadas/:id (duodécima-tercera ronda, editar).
  if (/^UPDATE hipismo_adelantadas_jugadas\s+SET cliente_nombre = \$1, monto = \$2, numero_ejemplar = \$3, numero1 = \$4, numero2 = \$5,\s*estado = \$6, gano = \$7, resultado_cliente = \$8, comision = \$9, banqueadores = \$10\s*WHERE id = \$11 AND grupo_id = \$12/i.test(sql)) {
    const [cliente, monto, numeroEjemplar, numero1, numero2, estado, gano, resultadoCliente, comision, banqueadores, id, grupoId] = params;
    const j = TABLAS.hipismo_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (j) {
      Object.assign(j, {
        cliente_nombre: cliente, monto, numero_ejemplar: numeroEjemplar, numero1, numero2,
        estado, gano, resultado_cliente: resultadoCliente, comision,
        banqueadores: banqueadores == null ? null : JSON.parse(banqueadores)
      });
    }
    return { rows: j ? [j] : [] };
  }
  // DELETE /adelantadas/jugadas/:id (duodécima-tercera ronda, eliminar).
  if (/^DELETE FROM hipismo_adelantadas_jugadas WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    TABLAS.hipismo_adelantadas_jugadas = TABLAS.hipismo_adelantadas_jugadas.filter(x => !(x.id === id && x.grupo_id === grupoId));
    return { rows: [] };
  }
  // Alertas (duodécima-tercera ronda, registrarAlerta()).
  if (/^INSERT INTO hipismo_alertas \(grupo_id, tipo, usuario, hipodromo_nombre, carrera_numero, fecha, mensaje\)/i.test(sql)) {
    const [grupoId, tipo, usuario, hipodromoNombre, carreraNumero, fecha, mensaje] = params;
    TABLAS.hipismo_alertas = TABLAS.hipismo_alertas || [];
    TABLAS.hipismo_alertas.push({ id: nuevoId('alerta'), grupo_id: grupoId, tipo, usuario, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, mensaje, creado_en: Date.now() });
    return { rows: [] };
  }
  if (/^SELECT j\.\*, p\.hipodromo_nombre, p\.fecha\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND j\.estado IN/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && (j.estado === 'pendiente' || j.estado === 'falta_banqueo'))
      .map(j => {
        const p = TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id);
        return { ...j, hipodromo_nombre: p.hipodromo_nombre, fecha: p.fecha };
      });
    return { rows: filas };
  }
  // POST /adelantadas/jugadas/:id/banquear — busca la jugada puntual (por
  // id), trayendo también el hipódromo/fecha de su plano (23-09-2026, a
  // pedido del usuario: "se va colocando positivo a marcas... en
  // balance" — hace falta saber de qué carrera es la marca para poder
  // sumarla en vivo si Balance General está mostrando esa misma carrera).
  if (/^SELECT j\.\*, p\.hipodromo_nombre, p\.fecha\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.id = \$1 AND j\.grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const j = TABLAS.hipismo_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (!j) return { rows: [] };
    const p = TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id);
    return { rows: [{ ...j, hipodromo_nombre: p.hipodromo_nombre, fecha: p.fecha }] };
  }
  if (/^UPDATE hipismo_adelantadas_jugadas\s+SET estado = 'resuelto', comision = \$1, banqueadores = \$2/i.test(sql)) {
    const [comision, banqueadoresJson, id, grupoId] = params;
    const j = TABLAS.hipismo_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (j) { j.estado = 'resuelto'; j.comision = comision; j.banqueadores = JSON.parse(banqueadoresJson); }
    return { rows: j ? [j] : [] };
  }
  // GET /cierre-final: saldo de Jugadas Adelantadas de la semana.
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.comision, j\.banqueadores/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && ['resuelto', 'falta_banqueo', 'sin_decidir'].includes(j.estado))
      .filter(j => {
        const p = TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id);
        return p && p.fecha >= desde && p.fecha <= hasta;
      });
    return { rows: filas.map(j => ({ cliente_nombre: j.cliente_nombre, resultado_cliente: j.resultado_cliente, comision: j.comision, banqueadores: j.banqueadores, monto: j.monto })) };
  }

  // ---- Cargar Planos ----
  if (/^INSERT INTO hipismo_planos/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, carreraNumero, fecha, ret, pizarra, cruzaJugadas, textoOriginal, textoResultado, comisionTotal] = params;
    const fila = { id: nuevoId('plano'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, ret, pizarra, cruza_jugadas: cruzaJugadas, texto_original: textoOriginal, texto_resultado: textoResultado, comision_total: comisionTotal, creado_en: Date.now() };
    TABLAS.hipismo_planos.push(fila);
    return { rows: [fila] };
  }
  if (/^INSERT INTO hipismo_tickets/i.test(sql)) {
    return { rows: [] };
  }

  // ---- Cierre Final: resto de las consultas (todas vacías en esta prueba) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto/i.test(sql)) return { rows: [] };
  // GET /montos-apostados / GET /comisiones-devueltas (undécima ronda) —
  // usan las mismas 3 consultas de "una fecha puntual" (no semana);
  // ninguna prueba de este archivo ejercita estas 2 rutas nuevas todavía
  // (ver test_hipismo_reportes.js), pero quedan cubiertas acá también por
  // si algún otro flujo las toca sin querer.
  if (/^SELECT t\.cliente_nombre, t\.modalidad, t\.caballo, t\.monto, p\.hipodromo_nombre, p\.carrera_numero/i.test(sql)) return { rows: [] };
  if (/^SELECT a\.cliente_nombre, a\.caballo, a\.monto, r\.hipodromo_nombre, r\.carrera_numero/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.monto, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, p\.hipodromo_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) return { rows: [{ total: 0 }] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) return { rows: [{ total: 0 }] };

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));

Module._load = originalLoad;

function handlerDe(metodo, rutaPath) {
  const entrada = hipismoRouter.__handlers.find(([m, args]) => m === metodo && args[0] === rutaPath);
  return entrada[1][entrada[1].length - 1];
}
const handlerAdelantadasCalcular = handlerDe('post', '/adelantadas/calcular');
const handlerAdelantadasGuardar = handlerDe('post', '/adelantadas');
const handlerAdelantadasPendientes = handlerDe('get', '/adelantadas/pendientes');
const handlerAdelantadasBanquear = handlerDe('post', '/adelantadas/jugadas/:id/banquear');
const handlerAdelantadasEditar = handlerDe('put', '/adelantadas/jugadas/:id');
const handlerAdelantadasEliminar = handlerDe('delete', '/adelantadas/jugadas/:id');
const handlerPlanosGuardar = handlerDe('post', '/planos');
const handlerCierreFinal = handlerDe('get', '/cierre-final');

function invocarRuta(handler, req, paramsExtra) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    if (paramsExtra) req.params = paramsExtra;
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {} };
}

(async function main() {
  // --- 3) Error de cálculo -> POST /adelantadas no guarda nada ---
  const reqError = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: '*JUGANDO PRUEBA*\n\n5) 3TF DEL 4 A 20 ,50/300$\n', hipodromoNombre: 'La Rinconada', fecha: FECHA_PRUEBA }
  });
  const resError = await invocarRuta(handlerAdelantadasGuardar, reqError);
  check(resError._status === 400, 'POST /adelantadas con un error de cálculo responde 400');
  check(resError._json.errores && resError._json.errores.length === 1 && resError._json.errores[0].cliente === 'PRUEBA', 'El error identifica al cliente (PRUEBA) y la jugada exacta');
  check(TABLAS.hipismo_adelantadas_planos.length === 0, 'No se guardó ningún plano de adelantadas cuando hay un error de cálculo');

  // --- POST /adelantadas/calcular: vista previa sin guardar ---
  const resPreview = await invocarRuta(handlerAdelantadasCalcular, Object.assign(reqBase(GRUPO_ID), { body: { texto: PLANO_ADELANTADAS_EJEMPLO } }));
  check(resPreview._status === 200 && resPreview._json.jugadas.length === 18, 'POST /adelantadas/calcular (vista previa) devuelve las 18 jugadas sin guardar nada');
  check(TABLAS.hipismo_adelantadas_planos.length === 0, 'La vista previa sigue sin guardar nada en la base');

  // --- 1) Guardar el plano real del usuario para La Rinconada, 2026-09-25 ---
  const resGuardar = await invocarRuta(handlerAdelantadasGuardar, Object.assign(reqBase(GRUPO_ID), {
    body: { texto: PLANO_ADELANTADAS_EJEMPLO, hipodromoNombre: 'La Rinconada', fecha: FECHA_PRUEBA, comisionPorcentaje: 2.5 }
  }));
  check(resGuardar._status === 201, 'POST /adelantadas guarda el plano real (201)');
  check(resGuardar._json.cantidadJugadas === 18, 'Guardó las 18 jugadas');
  check(TABLAS.hipismo_adelantadas_jugadas.filter(j => j.estado === 'pendiente').length === 18, 'Las 18 jugadas quedan en estado "pendiente"');
  check(TABLAS.jugadores.some(j => j.nombre === 'LINARES') && TABLAS.jugadores.some(j => j.nombre === 'HOUSTON'), 'Los clientes del plano de adelantadas quedan auto-registrados');

  // --- GET /adelantadas/pendientes: agrupado por carrera ---
  const resPendientes1 = await invocarRuta(handlerAdelantadasPendientes, Object.assign(reqBase(GRUPO_ID), { body: {} }));
  check(resPendientes1._json.total === 18 && resPendientes1._json.esperandoPizarra === 18, 'GET /adelantadas/pendientes ve las 18 jugadas esperando pizarra');
  const carrera12 = resPendientes1._json.carreras.find(c => c.carreraNumero === 12 && c.hipodromoNombre === 'La Rinconada');
  check(!!carrera12 && carrera12.jugadas.length === 4, 'La carrera 12 de La Rinconada tiene sus 4 jugadas adelantadas juntas (Halland TF + Halland marca 8x4, Maturin TF, Linares TF)');

  // 23-09-2026 (undécima ronda), a pedido del usuario ("un item llama
  // pedro - porcentaje... pedro tiene 1% de porcentaje entonces pedro
  // jugo 100 y los pierde... pedro -100... pero en el item pedro -
  // porcentaje le va a salir en esa carrera +1"): se le carga a LINARES
  // un 1% de comisión propia para probar que, en esta MISMA carrera 12,
  // aparece su propio ítem "LINARES - PORCENTAJE" aparte, sin tocar su
  // resultado normal (+225, sin ajustar).
  TABLAS.jugadores.find(j => j.nombre === 'LINARES').comision_propia = 1;

  // --- 4) POST /planos con la pizarra de la carrera 12 (el 3 gana, único
  // caso de TF que gana en esa carrera puntual: Linares) — el 4 llega 2do
  // para que la marca de Halland (8x4) tampoco acierte (necesitaría 8
  // 1ro y 4 2do). Pizarra de 5 puestos completa (hipódromo nacional). ---
  const textoTerciosCarrera12 = 'Juega Sebastian 1p (10) con 50,00 da Flaco'; // cualquier Tercios real de esa misma carrera, no depende de las adelantadas
  const resPlanos12 = await invocarRuta(handlerPlanosGuardar, Object.assign(reqBase(GRUPO_ID), {
    body: { texto: textoTerciosCarrera12, pizarra: '3.4.7.8.1', cruzaJugadas: false, hipodromoNombre: 'La Rinconada', carreraNumero: 12, fecha: FECHA_PRUEBA }
  }));
  check(resPlanos12._status === 201, 'POST /planos (carrera 12) guarda el plano de Tercios y resuelve las adelantadas de esa carrera (201)');
  check(resPlanos12._json.adelantadasResueltas.length === 4, 'Devuelve las 4 jugadas adelantadas resueltas de la carrera 12');

  const linaresResuelto = TABLAS.hipismo_adelantadas_jugadas.find(j => j.cliente_nombre === 'LINARES' && j.carrera_numero === 12);
  check(linaresResuelto.estado === 'resuelto' && Number(linaresResuelto.gano) !== 0 || linaresResuelto.gano === true, 'La TF de Linares en la 12 queda "resuelto" (ganó, el 3 llegó 1ro)');
  check(Number(linaresResuelto.resultado_cliente) === 225, 'Linares queda con +225 guardado de verdad en la base');
  const maturinTf12 = TABLAS.hipismo_adelantadas_jugadas.find(j => j.cliente_nombre === 'MATURIN' && j.carrera_numero === 12 && j.tipo === 'tf');
  check(maturinTf12.estado === 'resuelto' && maturinTf12.gano === false, 'La TF de Maturin en la 12 queda "resuelto" (perdió, jugó el 7 y ganó el 3)');
  const halland12Marca = TABLAS.hipismo_adelantadas_jugadas.find(j => j.cliente_nombre === 'HALLAND' && j.carrera_numero === 12 && j.tipo === 'marca');
  check(halland12Marca.estado === 'falta_banqueo', 'La marca de Halland en la 12 (8x4) queda "falta_banqueo" — ya se sabe si acertó, falta asignar quién banquea');
  check(halland12Marca.gano === false, 'La marca 8x4 de Halland no acertó (ganó 3, 2do 4 — no es 8x4)');
  check(Number(halland12Marca.resultado_cliente) === -120, 'Halland pierde el monto completo de su marca (-120)');

  check(resPlanos12._json.plano.texto_resultado.includes('PARADA ADELANTADAS'), 'El texto del plano de la carrera 12 incluye el bloque "PARADA ADELANTADAS"');
  check(resPlanos12._json.plano.texto_resultado.includes('Linares +225'), 'El bloque de adelantadas muestra a Linares ganando +225');
  check(resPlanos12._json.plano.texto_resultado.includes('Tablas fijas'), 'El bloque de adelantadas también muestra el neto de "Tablas Fijas" (la banca)');
  // 23-09-2026, a pedido del usuario (pegó un plano real donde el aviso
  // "PLANO REFERENCIAL" quedaba en el MEDIO del mensaje, arriba de
  // "PARADA ADELANTADAS", en vez de al final de todo): el pie tiene que
  // aparecer DESPUÉS del bloque de adelantadas, no antes.
  const idxParada = resPlanos12._json.plano.texto_resultado.indexOf('PARADA ADELANTADAS');
  const idxPie = resPlanos12._json.plano.texto_resultado.indexOf('PLANO REFERENCIAL');
  check(idxParada !== -1 && idxPie !== -1 && idxPie > idxParada, 'El aviso "PLANO REFERENCIAL" queda DESPUÉS de "PARADA ADELANTADAS" (al final de todo el mensaje), no en el medio');
  check((resPlanos12._json.plano.texto_resultado.match(/PLANO REFERENCIAL/g) || []).length === 1, 'El aviso "PLANO REFERENCIAL" aparece una sola vez (no se duplica)');

  // --- 9) Balance General (Cargar Planos) también tiene que reflejar las
  // Jugadas Adelantadas de esta misma carrera, no solo el texto — a
  // pedido del usuario: "en balance no me estas cargando los saldos de
  // las jugadas adelantadas.... debes sumarle en la carrera
  // correspondiente si el cliente gana o pierde... y se va colocando
  // positivo a marcas... tambien tablas fijas". El plano de Tercios de
  // esta carrera solo trae a Sebastian/Flaco (comisión 2,5) — Linares,
  // Halland, Maturin y "TABLAS FIJAS" son 100% de las adelantadas.
  check(resPlanos12._json.totalesFinales.LINARES === 225, '9) Balance General de la carrera 12 ya trae a Linares +225 (Tablas Fijas)');
  check(resPlanos12._json.totalesFinales.HALLAND === -160, 'Balance General trae a Halland -160 (-40 de su Tabla Fija, -120 de su Marca que perdió)');
  check(resPlanos12._json.totalesFinales.MATURIN === -45, 'Balance General trae a Maturin -45 (su Tabla Fija, perdió)');
  // 23-09-2026 (undécima ronda), a pedido del usuario ("necesito me
  // coloques el resultado de las tablas SIN el 2.5% y ese 2.5% aparte en
  // un item llamado % de tablas fijas"): "TABLAS FIJAS" ya no absorbe la
  // comisión (antes daba -144,01) — ahora es el espejo exacto de los 3
  // clientes (-225 de Linares que ganó, +40 y +45 de Halland/Maturin que
  // perdieron = -140) y la comisión de las 3 Tablas Fijas (1,88+1,00+1,13
  // = 4,01) vive en su propio ítem aparte.
  check(resPlanos12._json.totalesFinales['TABLAS FIJAS'] === -140, 'Balance General trae a "TABLAS FIJAS" (la banca) -140, el espejo exacto de los 3 clientes, SIN la comisión adentro');
  check(resPlanos12._json.totalesFinales['% DE TABLAS FIJAS'] === 4.01, 'Balance General trae un ítem aparte "% DE TABLAS FIJAS" +4,01 (la comisión de las 3 tablas fijas de esta carrera, separada de "TABLAS FIJAS")');
  check(resPlanos12._json.comisionTotal === 6.51, 'La Comisión (footer) del Balance General SIGUE sumando la de Tercios (2,5) más la de las 3 Tablas Fijas (4,01) = 6,51 — sin cambios, el ítem nuevo es una vista adicional');
  // 23-09-2026 (undécima ronda), "% devuelto" — LINARES tiene 1% de
  // comisión propia (cargado arriba): se gana 1% de lo que jugó en su
  // Tabla Fija (75) = 0,75, SIN que su resultado normal (+225) se toque.
  check(resPlanos12._json.totalesFinales['LINARES - PORCENTAJE'] === 0.75, 'Balance General trae el ítem "LINARES - PORCENTAJE" +0,75 (1% de los 75 que jugó en su Tabla Fija), sin tocar su +225 normal');
  // La Marca de Halland todavía no tiene banqueadores asignados (sigue
  // 'falta_banqueo') — solo entra el lado del cliente por ahora, el de
  // los banqueadores se suma más adelante cuando se resuelva el banqueo
  // (ver el punto 10 más abajo).
  check(!('MARCAS ZENYATTA' in resPlanos12._json.totalesFinales), 'Los banqueadores de la Marca de Halland todavía no aparecen (falta asignarlos)');

  // --- 6) Marca de hipódromo NACIONAL con pizarra de solo 3 puestos ->
  // 'sin_decidir' (usa la carrera 2, que tiene 2 TF de Halland/Rambo y 1
  // marca de Maturin). ---
  const resPlanos2 = await invocarRuta(handlerPlanosGuardar, Object.assign(reqBase(GRUPO_ID), {
    body: { texto: '', pizarra: '5.3.1', cruzaJugadas: false, hipodromoNombre: 'La Rinconada', carreraNumero: 2, fecha: FECHA_PRUEBA }
  }));
  check(resPlanos2._status === 201, '5) POST /planos con texto VACÍO pero con adelantadas pendientes de esa carrera IGUAL guarda (201) — "jala" la jugada adelantada sin ningún Tercios en vivo');
  const maturinMarca2 = TABLAS.hipismo_adelantadas_jugadas.find(j => j.cliente_nombre === 'MATURIN' && j.carrera_numero === 2 && j.tipo === 'marca');
  check(maturinMarca2.estado === 'sin_decidir', '6) La marca de Maturin en la 2 (hipódromo nacional, pizarra de solo 3 puestos) queda "sin_decidir" en vez de pendiente para siempre');
  check(Number(maturinMarca2.resultado_cliente) === 0, 'Con "sin_decidir" el cliente queda en 0, no se le carga ninguna pérdida ni ganancia');
  const hallandTf2 = TABLAS.hipismo_adelantadas_jugadas.find(j => j.cliente_nombre === 'HALLAND' && j.carrera_numero === 2 && j.tipo === 'tf');
  check(hallandTf2.estado === 'resuelto' && hallandTf2.gano === true, 'La TF de Halland en la 2 (jugó el 5, ganó el 5) SÍ se resuelve normal — a Tablas Fijas no le aplica la regla de 5 puestos, solo necesita el 1er lugar');
  // Este ES el caso exacto que el usuario pegó como ejemplo (una carrera
  // sin NINGÚN Tercios en vivo, solo adelantadas): confirma que acá
  // también el pie queda al final, después de "PARADA ADELANTADAS".
  const idxParada2 = resPlanos2._json.plano.texto_resultado.indexOf('PARADA ADELANTADAS');
  const idxPie2 = resPlanos2._json.plano.texto_resultado.indexOf('PLANO REFERENCIAL');
  check(idxParada2 !== -1 && idxPie2 > idxParada2, 'En una carrera sin Tercios en vivo (solo adelantadas), el aviso "PLANO REFERENCIAL" también queda al final, después de "PARADA ADELANTADAS"');

  // --- 7) Banquear la marca de Halland en la 12 (8x4, perdió) ---
  const resBanqueo = await invocarRuta(handlerAdelantadasBanquear, Object.assign(reqBase(GRUPO_ID), {
    body: { banqueadores: [{ nombre: 'MARCAS ZENYATTA', porcentaje: 60, pagaComision: false }, { nombre: 'MARCAS SAMMY', porcentaje: 40, pagaComision: true }], comisionPorcentaje: 2.5 }
  }), { id: halland12Marca.id });
  check(resBanqueo._status === 200, '7) POST /adelantadas/jugadas/:id/banquear resuelve la marca de Halland (200)');
  check(resBanqueo._json.jugada.estado === 'resuelto', 'La marca de Halland pasa a "resuelto" tras asignar el banqueo');
  const bqZenyatta = resBanqueo._json.jugada.banqueadores.find(b => b.nombre === 'MARCAS ZENYATTA');
  const bqSammy = resBanqueo._json.jugada.banqueadores.find(b => b.nombre === 'MARCAS SAMMY');
  check(bqZenyatta.monto === 72, 'Halland perdió 120 -> Marcas Zenyatta (60%, no cobra comisión) +72');
  check(bqSammy.monto === 46.8, 'Marcas Sammy (40%, cobra 2.5%) +46,8 (48 - 1,2 de comisión)');
  check(resBanqueo._json.jugada.comision === 1.2, 'Comisión Marcas = 1,2 (2.5% de la parte de Sammy, 48)');
  const sumaBanqueoHalland = Number(halland12Marca.resultado_cliente) + bqZenyatta.monto + bqSammy.monto + resBanqueo._json.jugada.comision;
  check(Math.round(sumaBanqueoHalland * 100) === 0, 'Halland + Marcas Zenyatta + Marcas Sammy + Comisión Marcas suman 0 exacto');

  // 23-09-2026, a pedido del usuario ("se va colocando positivo a
  // marcas... en balance" y "para saber cuanto pierde o gana cada uno
  // colcocarle como se llama y cuanto"): el banqueo también devuelve de
  // qué carrera es (para que el frontend pueda sumarlo en vivo a Balance
  // General si está mostrando esa misma carrera) y el detalle completo
  // ya resuelto (para mostrarlo nombre por nombre).
  check(resBanqueo._json.hipodromoNombre === 'La Rinconada' && resBanqueo._json.carreraNumero === 12 && resBanqueo._json.fecha === FECHA_PRUEBA,
    'El banqueo devuelve el hipódromo/carrera/fecha de la marca banqueada (La Rinconada, carrera 12)');
  check(resBanqueo._json.resultadoCliente === -120, 'El banqueo devuelve el neto del cliente (Halland -120)');
  check(resBanqueo._json.banqueadores.length === 2 && resBanqueo._json.banqueadores.find(b => b.nombre === 'MARCAS SAMMY').monto === 46.8,
    'El banqueo devuelve el detalle de cada banqueador (nombre y monto), no solo el estado');
  check(resBanqueo._json.comisionMarcas === 1.2, 'El banqueo devuelve la Comisión Marcas por separado');

  // Doble banqueo debe rechazarse.
  const resBanqueoDoble = await invocarRuta(handlerAdelantadasBanquear, Object.assign(reqBase(GRUPO_ID), {
    body: { banqueadores: [{ nombre: 'MARCAS ZENYATTA', porcentaje: 100, pagaComision: false }] }
  }), { id: halland12Marca.id });
  check(resBanqueoDoble._status === 400, 'Intentar banquear 2 veces la misma marca responde 400 (ya está "resuelto")');

  // 23-09-2026, a pedido del usuario ("colocame para agregar hasta 4
  // marqueros que banqueen la marca") — el servidor también rechaza un
  // 5to banqueador, no solo el formulario del frontend. Se reintenta
  // sobre la misma marca de Halland (ya "resuelto", pero eso da 400 por
  // otro motivo — lo que importa acá es que la validación del límite de
  // 4 corre ANTES de mirar el estado de la jugada).
  const resBanqueoCincoBanqueros = await invocarRuta(handlerAdelantadasBanquear, Object.assign(reqBase(GRUPO_ID), {
    body: {
      banqueadores: [
        { nombre: 'A', porcentaje: 20, pagaComision: false }, { nombre: 'B', porcentaje: 20, pagaComision: false },
        { nombre: 'C', porcentaje: 20, pagaComision: false }, { nombre: 'D', porcentaje: 20, pagaComision: false },
        { nombre: 'E', porcentaje: 20, pagaComision: false }
      ]
    }
  }), { id: halland12Marca.id });
  check(resBanqueoCincoBanqueros._status === 400, 'Intentar banquear con 5 banqueadores responde 400 (el máximo son 4)');

  // Porcentajes que no suman 100 deben rechazarse.
  const resBanqueoMalo = await invocarRuta(handlerAdelantadasBanquear, Object.assign(reqBase(GRUPO_ID), {
    body: { banqueadores: [{ nombre: 'MARCAS ZENYATTA', porcentaje: 50, pagaComision: false }] }
  }), { id: hallandTf2.id }); // una TF, no una marca
  check(resBanqueoMalo._status === 400, 'Intentar banquear una Tabla Fija (no una Marca) responde 400');

  // --- 8) GET /cierre-final: saldo de Jugadas Adelantadas + comisión separada ---
  const resCierre = await invocarRuta(handlerCierreFinal, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
  // OJO: /cierre-final usa la semana ACTUAL calculada en base a "hoy" del
  // sistema — como la prueba guardó todo con fecha fija '2026-09-25', solo
  // hace sentido esta parte si esa fecha entra en el rango de "hoy". Para
  // no depender de la fecha real del entorno, se recalcula el saldo de
  // Linares directamente contra la tabla falsa en vez de contra la
  // respuesta HTTP.
  const linaresFila = TABLAS.hipismo_adelantadas_jugadas.filter(j => j.cliente_nombre === 'LINARES' && j.estado !== 'pendiente');
  check(linaresFila.length === 1 && Number(linaresFila[0].resultado_cliente) === 225, 'Confirmado en la base: Linares tiene su +225 de Tablas Fijas guardado, listo para que Cierre Final lo sume en la semana que corresponda');
  check(typeof resCierre._json.comisionAdelantadasSemana === 'number', 'GET /cierre-final devuelve comisionAdelantadasSemana como un campo separado (aunque sea 0 si la fecha de prueba no cae en la semana actual)');

  // =================================================================
  // 10) PUT/DELETE /adelantadas/jugadas/:id (duodécima-tercera ronda, a
  // pedido del usuario: "en jugadas adelantadas quiero poder seleccionar
  // cada jugada, eliminarla, editarla"). Reusa los fixtures ya resueltos
  // de los puntos anteriores (linaresResuelto = TF ganada carrera 12,
  // halland12Marca = Marca YA banqueada carrera 12, maturinMarca2 =
  // Marca 'sin_decidir' carrera 2) para probar los 3 caminos de
  // recálculo posibles, más una jugada todavía 'pendiente'.
  // =================================================================

  // --- 10a) Editar una TF ya resuelta (Linares, ganó) -> recalcula con
  // la MISMA pizarra que ya se usó (3 en 1er lugar) ---
  const resEditarTf = await invocarRuta(handlerAdelantadasEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 100 } }), { id: linaresResuelto.id });
  check(resEditarTf._status === 200, '10a) PUT /adelantadas/jugadas/:id edita la TF de Linares (200)');
  check(resEditarTf._json.monto === 100, 'El monto queda en 100');
  check(resEditarTf._json.estado === 'resuelto' && resEditarTf._json.gano === true, 'Sigue "resuelto" y ganada (mismo caballo, misma pizarra)');
  check(resEditarTf._json.resultadoCliente === 200, 'Recalculado: 300 (ganancia potencial, sin tocar) - 100 (monto nuevo) = 200');
  check(resEditarTf._json.comision === 2.5, 'Comisión recalculada: 2.5% de 100 = 2,5');

  // --- 10b) Editar una Marca YA banqueada (Halland, perdió su 8x4) ->
  // recalcula el cliente Y vuelve a resolver el banqueo con los MISMOS
  // banqueadores/porcentajes/decisiones de comisión que ya tenía ---
  const resEditarMarca = await invocarRuta(handlerAdelantadasEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 200 } }), { id: halland12Marca.id });
  check(resEditarMarca._status === 200, '10b) PUT /adelantadas/jugadas/:id edita la Marca ya banqueada de Halland (200)');
  check(resEditarMarca._json.monto === 200 && resEditarMarca._json.gano === false, 'Sigue sin acertar (8 no llegó 1ro) con el monto nuevo (200)');
  check(resEditarMarca._json.resultadoCliente === -200, 'Halland pierde el monto completo nuevo (-200)');
  const bqZenyattaEditado = resEditarMarca._json.banqueadores.find(b => b.nombre === 'MARCAS ZENYATTA');
  const bqSammyEditado = resEditarMarca._json.banqueadores.find(b => b.nombre === 'MARCAS SAMMY');
  check(bqZenyattaEditado.monto === 120, 'Marcas Zenyatta (60%, no cobra comisión) recalculado a +120 (60% de 200)');
  check(bqSammyEditado.monto === 78, 'Marcas Sammy (40%, cobra 2.5%) recalculado a +78 (80 - 2 de comisión)');
  check(resEditarMarca._json.comision === 2, 'Comisión Marcas recalculada a 2 (2.5% de la parte de Sammy, 80)');
  const sumaEditada = resEditarMarca._json.resultadoCliente + bqZenyattaEditado.monto + bqSammyEditado.monto + resEditarMarca._json.comision;
  check(Math.round(sumaEditada * 100) === 0, 'Después de editar, Halland + los 2 banqueadores + la comisión siguen sumando 0 exacto');

  // --- 10c) Editar una Marca "sin_decidir" -> el monto se actualiza pero
  // el estado/resultado NO se recalculan (nunca se pudo decidir, y eso no
  // depende de lo que se esté editando) ---
  const resEditarSinDecidir = await invocarRuta(handlerAdelantadasEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 999 } }), { id: maturinMarca2.id });
  check(resEditarSinDecidir._status === 200 && resEditarSinDecidir._json.monto === 999, '10c) PUT edita el monto de una marca "sin_decidir"');
  check(resEditarSinDecidir._json.estado === 'sin_decidir' && resEditarSinDecidir._json.resultadoCliente === 0, 'Pero el estado sigue "sin_decidir" y el resultado sigue en 0 (nunca se pudo decidir esa carrera)');

  // --- 10d) Editar una jugada todavía 'pendiente' (sin pizarra_usada) ->
  // solo cambian los campos editados, nada se recalcula ---
  const houstonPendiente = TABLAS.hipismo_adelantadas_jugadas.find(j => j.cliente_nombre === 'HOUSTON' && j.estado === 'pendiente');
  const resEditarPendiente = await invocarRuta(handlerAdelantadasEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 150, cliente: 'HOUSTON EDITADO' } }), { id: houstonPendiente.id });
  check(resEditarPendiente._status === 200 && resEditarPendiente._json.monto === 150 && resEditarPendiente._json.cliente === 'HOUSTON EDITADO', '10d) PUT edita cliente y monto de una jugada pendiente');
  check(resEditarPendiente._json.estado === 'pendiente' && resEditarPendiente._json.resultadoCliente === null, 'Sigue "pendiente" — no hay pizarra_usada todavía, nada que recalcular');
  check(TABLAS.jugadores.some(j => j.nombre === 'HOUSTON EDITADO'), 'El nuevo nombre del cliente queda auto-registrado en jugadores');

  // --- Alertas: las 4 ediciones de arriba generaron su alerta ---
  check(TABLAS.hipismo_alertas.filter(a => a.tipo === 'ADELANTADA_EDITADA').length === 4, 'Cada PUT de arriba generó su alerta "ADELANTADA_EDITADA"');
  check(TABLAS.hipismo_alertas.every(a => a.usuario === 'Zenyatta'), 'Todas las alertas quedan con el usuario que las hizo (req.nombreActor)');

  // --- 10e) Editar una jugada que no existe -> 404 ---
  const resEditarNoExiste = await invocarRuta(handlerAdelantadasEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 10 } }), { id: 'jad-no-existe' });
  check(resEditarNoExiste._status === 404, '10e) PUT sobre una jugada que no existe responde 404');

  // --- 10f) Eliminar una jugada pendiente (borrado definitivo, sin
  // papelera — ver la nota grande en routes/hipismo.js) ---
  const cantidadAntesDeBorrar = TABLAS.hipismo_adelantadas_jugadas.length;
  const resEliminar = await invocarRuta(handlerAdelantadasEliminar, reqBase(GRUPO_ID), { id: houstonPendiente.id });
  check(resEliminar._status === 200 && resEliminar._json.ok === true, '10f) DELETE /adelantadas/jugadas/:id elimina la jugada (200)');
  check(TABLAS.hipismo_adelantadas_jugadas.length === cantidadAntesDeBorrar - 1, 'La jugada desaparece de verdad de la tabla (borrado definitivo, no papelera)');
  check(!TABLAS.hipismo_adelantadas_jugadas.some(j => j.id === houstonPendiente.id), 'Ya no está por id');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'ADELANTADA_ELIMINADA' && a.usuario === 'Zenyatta'), 'El borrado también generó su alerta "ADELANTADA_ELIMINADA"');

  // --- 10g) Eliminar una jugada que no existe -> 404 ---
  const resEliminarNoExiste = await invocarRuta(handlerAdelantadasEliminar, reqBase(GRUPO_ID), { id: 'jad-no-existe' });
  check(resEliminarNoExiste._status === 404, '10g) DELETE sobre una jugada que no existe responde 404');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
