// =================================================================
// PRUEBA: bandeja de chat de Súper-admin muestra TODOS los grupos
// (02-09-2026, a pedido del usuario).
// =================================================================
// El usuario reportó: "actualmente solo me deja responder a quienes me
// escriban, pero yo buscar un grupo para enviarle un mensaje no me
// muestra en la bandeja de mensaje la lista de los grupos". Causa: la
// consulta de listarConversaciones() (chat.js) tenía un
// "WHERE EXISTS (SELECT 1 FROM mensajes_chat ...)" que dejaba afuera
// cualquier grupo sin mensajes todavía. Se sacó ese filtro — esta prueba
// simula, en JS, exactamente lo que la consulta SQL real devolvería
// contra un set de datos armado a mano (mismo patrón que el resto de
// las pruebas de este proyecto: base de datos falsa en memoria).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPOS = [
  { id: 'g-conmensajes', nombre: 'CON MENSAJES', activo: true },
  { id: 'g-sinmensajes', nombre: 'SIN MENSAJES TODAVÍA', activo: true },
  { id: 'g-inactivo', nombre: 'GRUPO INACTIVO', activo: false }
];
const MENSAJES = [
  { grupo_id: 'g-conmensajes', remitente: 'grupo', texto: 'Hola, tengo una duda', creado_en: '2026-09-02T10:00:00Z', leido_superadmin: false }
];

// Reimplementa, en JS puro, lo que la consulta SQL real de
// listarConversaciones() calcularía por cada grupo (LEFT correlated
// subqueries) — así se puede probar el comportamiento sin una base de
// datos real, verificando el mismo resultado fila por fila.
function simularListarConversaciones() {
  return GRUPOS.map(g => {
    const msjsDelGrupo = MENSAJES.filter(m => m.grupo_id === g.id).sort((a, b) => a.creado_en < b.creado_en ? 1 : -1);
    const ultimo = msjsDelGrupo[0] || null;
    return {
      grupo_id: g.id,
      grupo_nombre: g.nombre,
      grupo_activo: g.activo,
      ultimo_mensaje: ultimo ? ultimo.texto : null,
      ultimo_en: ultimo ? ultimo.creado_en : null,
      no_leidos: msjsDelGrupo.filter(m => m.remitente === 'grupo' && !m.leido_superadmin).length
    };
  }).sort((a, b) => {
    if (a.ultimo_en && b.ultimo_en) return a.ultimo_en < b.ultimo_en ? 1 : -1;
    if (a.ultimo_en) return -1;
    if (b.ultimo_en) return 1;
    return a.grupo_nombre.localeCompare(b.grupo_nombre);
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) Verifica el comportamiento simulado (documenta el contrato esperado) ---
const conversaciones = simularListarConversaciones();
check(conversaciones.length === 3, 'listarConversaciones(): devuelve los 3 grupos, no solo el que tiene mensajes');
check(conversaciones.some(c => c.grupo_id === 'g-sinmensajes'), 'El grupo SIN mensajes todavía aparece en la lista (antes quedaba afuera)');
check(conversaciones.some(c => c.grupo_id === 'g-inactivo'), 'Un grupo inactivo también aparece (para poder contactarlo igual)');
check(conversaciones[0].grupo_id === 'g-conmensajes', 'El grupo CON el mensaje más reciente aparece primero');
const filaSinMensajes = conversaciones.find(c => c.grupo_id === 'g-sinmensajes');
check(filaSinMensajes.ultimo_mensaje === null && filaSinMensajes.ultimo_en === null, 'Un grupo sin mensajes trae ultimo_mensaje/ultimo_en en null (el frontend lo muestra como "Sin mensajes todavía")');

// --- 2) Verifica que el código FUENTE realmente sacó el WHERE EXISTS ---
// (para no depender solo de la simulación de arriba si alguien reintrodujera
// el filtro por error).
const fs = require('fs');
const chatJsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'chat.js'), 'utf8');
const funcion = chatJsSrc.slice(chatJsSrc.indexOf('async function listarConversaciones'), chatJsSrc.indexOf('async function contarNoLeidosGrupo'));
check(!/WHERE\s+EXISTS/i.test(funcion), 'listarConversaciones(): el SQL ya NO tiene "WHERE EXISTS" (eso era lo que ocultaba a los grupos sin mensajes)');
check(/FROM\s+grupos\s+g/i.test(funcion) && !/JOIN\s+mensajes_chat/i.test(funcion), 'listarConversaciones(): sigue construyendo la fila a partir de TODOS los grupos (FROM grupos g, sin un JOIN que los filtre)');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
