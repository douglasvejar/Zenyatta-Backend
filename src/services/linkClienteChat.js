// =================================================================
// LINK DE SALDO DE UN CLIENTE POR CHAT (Telegram / WhatsApp) — 17-11-2026,
// a pedido del usuario: "a través del Telegram poder pedir el link de saldo
// de los clientes de Hipismo Grupos". Un administrador escribe en el grupo
//     link PEDRO
// y el bot responde con el MISMO mensaje que arma el botón "🔗 Copiar link"
// de Hipismo > Clientes (public/hipismo-mockup.html, copiarLinkClienteHipismo):
// el texto de agradecimiento + "Balance del jugador X en su grupo de confianza Y" + el link.
//
// Reglas:
//   - Solo busca entre los clientes del grupo dueño del chat (los grupos son independientes).
//   - Sin importar tildes ni mayúsculas. Nombre exacto primero; si no, los que lo contienen.
//     Si hay varios, responde la lista para que el administrador escriba el nombre completo.
//   - Respeta lo mismo que la página pública: el grupo debe estar activo, tener el módulo de Hipismo
//     y la función "Link del cliente" (hip_link_cliente) encendida; si no, el link no abriría.
//   - La dirección pública se toma de PUBLIC_BASE_URL (o RAILWAY_PUBLIC_DOMAIN). Sin ninguna de las dos
//     el bot avisa qué falta configurar en vez de inventar una dirección.
// =================================================================
const db = require('../db');
const { funcionHabilitada } = require('./funcionesGrupo');

const sinTildes = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = t => sinTildes(t).toLowerCase().replace(/\s+/g, ' ').trim();

function baseUrlPublica() {
  const explicita = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (explicita) return explicita.replace(/\/+$/, '');
  const railway = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railway) return 'https://' + railway.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return null;
}

// Mismo texto que copiarLinkClienteHipismo() de la pantalla.
function armarMensajeLinkCliente({ nombreGrupo, nombreCliente, url }) {
  const g = nombreGrupo || 'nuestro grupo';
  return 'Gracias por preferirnos y jugar en su grupo ' + g + ', a continuación se anexa su link para que pueda verificar sus jugadas, este no se vence y funciona las 24hrs. Cualquier duda o diferencia estoy a su disposición.\n\n' +
    'Balance del jugador ' + nombreCliente + ' en su grupo de confianza ' + g + ' 🐎🐎🐎💰💰💰\n\n' +
    url;
}

// Devuelve { exactos, parecidos } entre una lista de jugadores { nombre, ... }.
function buscarClientes(jugadores, buscado) {
  const q = normalizar(buscado);
  if (!q) return { exactos: [], parecidos: [] };
  const lista = (jugadores || []).map(j => ({ j, n: normalizar(j.nombre) }));
  const exactos = lista.filter(x => x.n === q).map(x => x.j);
  if (exactos.length) return { exactos, parecidos: [] };
  const parecidos = lista.filter(x => x.n.includes(q)).map(x => x.j);
  return { exactos: [], parecidos };
}

// Arma la respuesta (siempre un texto listo para mandar) para el comando "link <cliente>".
async function responderLinkCliente(grupoId, nombreBuscado) {
  const buscado = String(nombreBuscado || '').trim();
  if (!buscado) return '⚠️ Escribe el nombre del cliente: *link NOMBRE*';

  const rGrupo = await db.query('SELECT * FROM grupos WHERE id = $1', [grupoId]);
  const grupo = rGrupo.rows[0];
  if (!grupo || grupo.activo === false) return '⚠️ Este grupo no está disponible en este momento.';
  if (!grupo.modulo_hipismo_habilitado && !grupo.modulo_hipismo_oficinas_habilitado) {
    return '⚠️ El módulo de Hipismo no está activo en este grupo, así que no hay links de saldo.';
  }
  if (!funcionHabilitada(grupo, 'hip_link_cliente')) {
    return '⚠️ El "Link del cliente" no está activado para este grupo. Pídele al administrador de la plataforma que lo active.';
  }

  const rJug = await db.query('SELECT id, nombre, token, activo FROM jugadores WHERE grupo_id = $1 ORDER BY nombre', [grupoId]);
  const jugadores = rJug.rows;
  const { exactos, parecidos } = buscarClientes(jugadores, buscado);
  const candidatos = exactos.length ? exactos : parecidos;

  if (!candidatos.length) {
    return '⚠️ No encontré ningún cliente llamado "' + buscado + '" en ' + grupo.nombre + '.';
  }
  if (candidatos.length > 1) {
    const nombres = candidatos.slice(0, 15).map(j => '• ' + j.nombre).join('\n');
    return '⚠️ "' + buscado + '" calza con varios clientes. Escribe el nombre completo:\n' + nombres + (candidatos.length > 15 ? '\n… y ' + (candidatos.length - 15) + ' más.' : '');
  }

  const cliente = candidatos[0];
  const base = baseUrlPublica();
  if (!base) {
    return '⚠️ Falta configurar la dirección pública de la plataforma (variable PUBLIC_BASE_URL en el servidor) para poder armar el link.';
  }
  const url = base + '/hipismo-cliente-portal.html?token=' + cliente.token;
  return armarMensajeLinkCliente({ nombreGrupo: grupo.nombre, nombreCliente: cliente.nombre, url });
}

module.exports = { responderLinkCliente, armarMensajeLinkCliente, buscarClientes, baseUrlPublica, normalizar };
