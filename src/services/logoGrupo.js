// =================================================================
// Helper compartido: la URL que hay que poner en cualquier <img src="...">
// para mostrar el logo de un Grupo (29-09-2026, a pedido del usuario:
// "quiero subir el logo del grupo, no por url si no cargar la imagen del
// grupo desde super admin, queda cargada para cada grupo en su pagina" —
// ver la nota grande junto a logo_base64/logo_mime en sql/schema.sql).
//
// Antes de este cambio, cada ruta que armaba una respuesta con el logo del
// grupo mandaba directo grupo.logo_url (la URL externa que el Súper-admin
// pegaba a mano) como el `src` de la imagen. Ahora el logo casi siempre es
// un ARCHIVO subido (guardado como base64 en grupos.logo_base64/
// logo_mime, nunca en el disco del servidor — ver esa misma nota), así que
// nunca hay que mandar el valor crudo de ninguna de las 2 columnas al
// navegador: siempre hay que apuntar al mismo proxy de siempre
// (GET /api/imagenes/logo-grupo/:grupoId, ver routes/imagenes.js), que ya
// sabe servir CUALQUIERA de las 2 formas que tenga guardadas ese grupo (el
// archivo nuevo, o una logo_url legacy de un grupo que nunca se actualizó
// desde antes de este cambio).
//
// Así ningún consumidor (cliente.html, el portal de Hipismo, "Saldos
// Semana", el propio panel del Grupo en su login) necesita saber cuál de
// las 2 formas tiene guardadas un grupo puntual — alcanza con que el
// SELECT que hizo esa ruta haya traído logo_url Y logo_base64 (aunque sea
// solo para este chequeo de "¿tiene algo?", sin usar el valor real de
// ninguna de las 2 columnas).
//
// `filaGrupo` es cualquier fila de "grupos" (o un JOIN con alias
// grupo_logo_url/grupo_logo_base64, ver el segundo parámetro opcional) que
// haya traído esas 2 columnas.
function urlLogoGrupo(grupoId, filaGrupo, opts) {
  if (!grupoId || !filaGrupo) return null;
  const campoUrl = (opts && opts.campoUrl) || 'logo_url';
  const campoBase64 = (opts && opts.campoBase64) || 'logo_base64';
  if (!filaGrupo[campoUrl] && !filaGrupo[campoBase64]) return null;
  return `/api/imagenes/logo-grupo/${grupoId}`;
}

// =================================================================
// Helper compartido: el color (o par de colores) del degradado de la
// tarjeta "Total de la semana" que ve el Cliente en su link de Hipismo
// (29-09-2026, a pedido del usuario: "colocame una ventana en logos que
// diga colores reportes cliente... asi cada grupo lo puedo personalizar
// segun sus logos" — ver la nota grande junto a tema_color_primario/
// tema_color_secundario en sql/schema.sql).
//
// Mismo espíritu que urlLogoGrupo() de arriba: el consumidor (acá,
// services/hipismoResumenCliente.js) no necesita saber si el grupo tiene
// un color propio configurado o no — solo le pasa la fila de "grupos" que
// ya haya traído estas 2 columnas, y si no las trajo (o el grupo nunca
// configuró ninguna), simplemente devuelve los 2 en null, que el
// frontend interpreta como "usa el verde clásico por defecto".
//
// `opts.campoPrimario`/`campoSecundario` (01-10-2026, a pedido del
// usuario: "QUIERO LOS CUADRES COMO HICISTE EL DE GRUPO DE CLIENTES, CON
// LOS COLORES QUE TENGA EL LOGO CONFIGURADO" — ver POST /api/auth/login en
// routes/auth.js) — mismo truco de alias que ya tiene urlLogoGrupo() de
// arriba, para el login del Empleado, cuyo JOIN con "grupos" trae estas 2
// columnas con otro nombre (g.tema_color_primario AS
// grupo_tema_color_primario, etc.) para no chocar con columnas propias del
// empleado.
function temaColorGrupo(filaGrupo, opts) {
  if (!filaGrupo) return { colorPrimario: null, colorSecundario: null };
  const campoPrimario = (opts && opts.campoPrimario) || 'tema_color_primario';
  const campoSecundario = (opts && opts.campoSecundario) || 'tema_color_secundario';
  return {
    colorPrimario: filaGrupo[campoPrimario] || null,
    colorSecundario: filaGrupo[campoSecundario] || null
  };
}

module.exports = { urlLogoGrupo, temaColorGrupo };
