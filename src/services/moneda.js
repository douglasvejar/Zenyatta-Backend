// Utilidad genérica para "moneda del grupo" (18-09-2026, a pedido del
// usuario — ver la nota grande en sql/schema.sql). Parte un listado de
// filas que YA vienen con un campo `.moneda` por fila (ej.
// resumenPorCliente de la pestaña Sábana) en dos bloques — USD y BS — y
// suma, por bloque, los campos numéricos indicados. Se usa desde
// routes/sabana.js para que la pestaña Sábana muestre "dos reportes"
// cuando el grupo está en modo 'mixto', SIN tocar en nada el cálculo
// original de cada fila (que ya viene correcto) — esto solo agrupa y
// suma números que ya están bien calculados.
//
// No se usa en absoluto si el grupo está fijo en 'usd' o 'bs' (un solo
// bloque, comportamiento de siempre) — ver los `if (moneda_modo ===
// 'mixto')` en cada ruta que la llama.
function partirPorMoneda(filas, camposASumar) {
  const bloques = {
    USD: { filas: [], totales: {} },
    BS: { filas: [], totales: {} }
  };
  camposASumar.forEach(campo => {
    bloques.USD.totales[campo] = 0;
    bloques.BS.totales[campo] = 0;
  });
  (filas || []).forEach(fila => {
    // Default seguro: si por lo que sea a una fila le falta `.moneda`
    // (no debería pasar, ver procesarSabana.js/sabanaDia.js), cae en USD
    // en vez de perderse silenciosamente de los dos bloques.
    const moneda = fila.moneda === 'BS' ? 'BS' : 'USD';
    bloques[moneda].filas.push(fila);
    camposASumar.forEach(campo => {
      bloques[moneda].totales[campo] += Number(fila[campo]) || 0;
    });
  });
  return bloques;
}

module.exports = { partirPorMoneda };
