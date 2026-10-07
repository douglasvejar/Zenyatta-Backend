// Banqueo automático de Marcas y de Tablas Fijas, configurable POR GRUPO (06-10-2026).
//
// La plataforma se vende a varios grupos y cada uno banquea las Marcas a su
// manera (el primero usa MARCAS ZENYATTA 50% + MARCAS SAMMY 50% con 2,5% de
// comisión; otro puede tener otros nombres, otros %, uno solo, o ninguno).
// Por eso la configuración vive en la base, columna
// grupos.hipismo_marcas_banqueo (jsonb): un array de hasta 4 objetos
// { nombre, porcentaje, pagaComision } cuyos % suman 100. Sin configuración
// (NULL o []) el grupo conserva el flujo manual de siempre: la Marca queda
// 'falta_banqueo' y el operador la banquea a mano.
//
// Con configuración, toda Marca decidida se banquea sola (ver
// banqueoAutomaticoMarca en hipismoAdelantadasCalc.js) y sus ítems salen en
// Balance General igual que TABLAS FIJAS. Esta función también sirve para
// las Marcas que ya estaban 'falta_banqueo' cuando el grupo guarda su
// configuración: se banquean solas al consultar (idempotente, solo toca
// filas 'falta_banqueo'; ante un error de base nunca rompe la lectura).
const db = require('../db');
const { banqueoAutomaticoMarca } = require('./hipismoAdelantadasCalc');

const MAX_BANQUEADORES = 4;

// Columnas de configuración (lista blanca: el nombre de la columna nunca viene
// del cliente). Tablas Fijas (06-10-2026, "HAGAMOS LA MISMA CONFIGURACION
// PARA TABLAS FIJAS, CADA GRUPO ESTABLECE SU CONFIGURACION") usa el MISMO
// formato que Marcas: sin configurar, sus TF siguen jugando contra el ítem
// "TABLAS FIJAS" de siempre.
const COLUMNA_MARCAS = 'hipismo_marcas_banqueo';
const COLUMNA_TF = 'hipismo_tf_banqueo';
const COLUMNAS_PERMITIDAS = new Set([COLUMNA_MARCAS, COLUMNA_TF]);

// Valida y normaliza lo que manda la pantalla. -> { error } | { lista }
// (lista [] = sin banqueo automático).
function validarBanqueoMarcas(entrada) {
  if (entrada === null || entrada === undefined) return { lista: [] };
  if (!Array.isArray(entrada)) return { error: 'La configuración de banqueo debe ser una lista de banqueadores.' };
  if (entrada.length > MAX_BANQUEADORES) return { error: `Una Marca admite hasta ${MAX_BANQUEADORES} banqueadores.` };
  const lista = [];
  const vistos = new Set();
  for (const b of entrada) {
    const nombre = String((b && b.nombre) || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!nombre) return { error: 'Todos los banqueadores necesitan un nombre.' };
    if (vistos.has(nombre)) return { error: `${nombre} está repetido: cada banqueador va una sola vez.` };
    vistos.add(nombre);
    const porcentaje = Number(b.porcentaje);
    if (!isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 100) return { error: `El % de ${nombre} debe estar entre 0 y 100.` };
    lista.push({ nombre, porcentaje: Math.round(porcentaje * 100) / 100, pagaComision: !!b.pagaComision });
  }
  if (lista.length) {
    const suma = lista.reduce((acc, b) => acc + b.porcentaje, 0);
    if (Math.abs(suma - 100) > 0.01) return { error: `Los % de los banqueadores deben sumar 100% (suman ${Math.round(suma * 100) / 100}%).` };
  }
  return { lista };
}

// Configuración del grupo -> array (≥1) o null si no tiene. Nunca lanza: ante
// un error de base de datos devuelve null (el grupo queda en modo manual /
// banca "TABLAS FIJAS" de siempre).
async function leerConfigBanqueo(grupoId, columna) {
  if (!COLUMNAS_PERMITIDAS.has(columna)) return null;
  try {
    const r = await db.query(`SELECT ${columna} FROM grupos WHERE id = $1`, [grupoId]);
    const fila = r && r.rows && r.rows[0];
    if (!fila || !fila[columna]) return null;
    const v = typeof fila[columna] === 'string' ? JSON.parse(fila[columna]) : fila[columna];
    const { lista, error } = validarBanqueoMarcas(v);
    return !error && lista.length ? lista : null;
  } catch (e) {
    return null;
  }
}

async function guardarConfigBanqueo(grupoId, columna, lista) {
  if (!COLUMNAS_PERMITIDAS.has(columna)) throw new Error('Columna de configuración no permitida.');
  await db.query(`UPDATE grupos SET ${columna} = $1 WHERE id = $2`, [lista.length ? JSON.stringify(lista) : null, grupoId]);
  return lista.length ? lista : null;
}

const obtenerBanqueoMarcasGrupo = grupoId => leerConfigBanqueo(grupoId, COLUMNA_MARCAS);
const guardarBanqueoMarcasGrupo = (grupoId, lista) => guardarConfigBanqueo(grupoId, COLUMNA_MARCAS, lista);
const obtenerBanqueoTablasFijasGrupo = grupoId => leerConfigBanqueo(grupoId, COLUMNA_TF);
const guardarBanqueoTablasFijasGrupo = (grupoId, lista) => guardarConfigBanqueo(grupoId, COLUMNA_TF, lista);

// opciones.incluirYaBanqueadas (06-10-2026, "PREGUNTAME UNA SOLA VEZ LOS % Y
// NOMBRE DE QUIEN BANQUEA Y SE LO APLICAS A TODAS LAS MARCAS"): además de las
// que esperan banqueo, vuelve a banquear con la configuración del grupo las
// Marcas ya decididas que tenían otros banqueadores (cambia sus saldos).
// -> { pendientes, rebanqueadas } (cantidad de Marcas tocadas en cada caso).
async function banquearMarcasConConfig(grupoId, config, estadoOrigen) {
  const filtroExtra = estadoOrigen === 'resuelto' ? "AND banqueadores IS NOT NULL AND gano IS NOT NULL" : '';
  const r = await db.query(
    `SELECT id, gano, monto, resultado_cliente, comision_porcentaje, sin_comision
       FROM hipismo_adelantadas_jugadas
      WHERE grupo_id = $1 AND tipo = 'marca' AND estado = '${estadoOrigen}' ${filtroExtra}`,
    [grupoId]
  );
  const filas = (r && r.rows) || [];
  let tocadas = 0;
  for (const j of filas) {
    const acierta = !!j.gano;
    const base = acierta ? Number(j.resultado_cliente) : Number(j.monto);
    const banqueo = banqueoAutomaticoMarca({ acierta, base }, j.sin_comision ? 0 : j.comision_porcentaje, null, config);
    if (!banqueo) continue;
    await db.query(
      `UPDATE hipismo_adelantadas_jugadas
          SET estado = 'resuelto', comision = $1, banqueadores = $2
        WHERE id = $3 AND grupo_id = $4 AND estado = '${estadoOrigen}'`,
      [banqueo.comisionMarcas, JSON.stringify(banqueo.banqueadores), j.id, grupoId]
    );
    tocadas += 1;
  }
  return tocadas;
}

async function asegurarBanqueoAutomaticoMarcas(grupoId, opciones) {
  try {
    const config = await obtenerBanqueoMarcasGrupo(grupoId);
    if (!config) return 0; // grupo sin banqueo automático: flujo manual de siempre
    const pendientes = await banquearMarcasConConfig(grupoId, config, 'falta_banqueo');
    if (opciones && opciones.incluirYaBanqueadas) {
      const rebanqueadas = await banquearMarcasConConfig(grupoId, config, 'resuelto');
      return { pendientes, rebanqueadas };
    }
    return pendientes;
  } catch (e) {
    console.error('[marcas] no se pudo banquear automáticamente:', e.message);
    return (opciones && opciones.incluirYaBanqueadas) ? { pendientes: 0, rebanqueadas: 0 } : 0;
  }
}

module.exports = {
  MAX_BANQUEADORES, validarBanqueoMarcas, obtenerBanqueoMarcasGrupo, guardarBanqueoMarcasGrupo,
  obtenerBanqueoTablasFijasGrupo, guardarBanqueoTablasFijasGrupo, asegurarBanqueoAutomaticoMarcas
};
