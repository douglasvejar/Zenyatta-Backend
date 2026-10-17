// Temas del panel de Hipismo (15-10-2026). Cada grupo elige uno (grupos.hipismo_tema). Los estilos viven en
// public/hipismo-mockup.html como html[data-tema="..."]; esta lista es la única que acepta el servidor.
const TEMAS_HIPISMO = ['cristal', 'clasico', 'noche', 'club', 'pasto', 'pastel', 'mono'];
const TEMA_HIPISMO_DEFECTO = 'cristal';
function normalizarTemaHipismo(valor) {
  const v = typeof valor === 'string' ? valor.trim() : '';
  return TEMAS_HIPISMO.includes(v) ? v : TEMA_HIPISMO_DEFECTO;
}
module.exports = { TEMAS_HIPISMO, TEMA_HIPISMO_DEFECTO, normalizarTemaHipismo };
