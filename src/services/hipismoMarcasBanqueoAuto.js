// Banqueo automático de Marcas, configurable POR GRUPO (06-10-2026).
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
// un error de base de datos devuelve null (el grupo queda en modo manual).
async function obtenerBanqueoMarcasGrupo(grupoId) {
  try {
    const r = await db.query('SELECT hipismo_marcas_banqueo FROM grupos WHERE id = $1', [grupoId]);
    const fila = r && r.rows && r.rows[0];
    if (!fila || !fila.hipismo_marcas_banqueo) return null;
    const v = typeof fila.hipismo_marcas_banqueo === 'string' ? JSON.parse(fila.hipismo_marcas_banqueo) : fila.hipismo_marcas_banqueo;
    const { lista, error } = validarBanqueoMarcas(v);
    return !error && lista.length ? lista : null;
  } catch (e) {
    return null;
  }
}

async function guardarBanqueoMarcasGrupo(grupoId, lista) {
  await db.query('UPDATE grupos SET hipismo_marcas_banqueo = $1 WHERE id = $2', [lista.length ? JSON.stringify(lista) : null, grupoId]);
  return lista.length ? lista : null;
}

async function asegurarBanqueoAutomaticoMarcas(grupoId) {
  try {
    const config = await obtenerBanqueoMarcasGrupo(grupoId);
    if (!config) return 0; // grupo sin banqueo automático: flujo manual de siempre
    const r = await db.query(
      `SELECT id, gano, monto, resultado_cliente, comision_porcentaje
         FROM hipismo_adelantadas_jugadas
        WHERE grupo_id = $1 AND tipo = 'marca' AND estado = 'falta_banqueo'`,
      [grupoId]
    );
    const filas = (r && r.rows) || [];
    for (const j of filas) {
      const acierta = !!j.gano;
      const base = acierta ? Number(j.resultado_cliente) : Number(j.monto);
      const banqueo = banqueoAutomaticoMarca({ acierta, base }, j.comision_porcentaje, null, config);
      if (!banqueo) continue;
      await db.query(
        `UPDATE hipismo_adelantadas_jugadas
            SET estado = 'resuelto', comision = $1, banqueadores = $2
          WHERE id = $3 AND grupo_id = $4 AND estado = 'falta_banqueo'`,
        [banqueo.comisionMarcas, JSON.stringify(banqueo.banqueadores), j.id, grupoId]
      );
    }
    return filas.length;
  } catch (e) {
    console.error('[marcas] no se pudo banquear automáticamente:', e.message);
    return 0;
  }
}

module.exports = {
  MAX_BANQUEADORES, validarBanqueoMarcas, obtenerBanqueoMarcasGrupo, guardarBanqueoMarcasGrupo, asegurarBanqueoAutomaticoMarcas
};
