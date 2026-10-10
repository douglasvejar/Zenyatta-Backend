// =================================================================
// EGRESS DE SUPABASE (10-10-2026) — aviso "Egress Exceeded": cada petición
// autenticada bajaba el logo COMPLETO (base64, MBs) y el chat abierto bajaba
// todos los adjuntos cada 8s. Esta prueba protege que no vuelva a pasar:
// las consultas "calientes" no pueden traer columnas base64 crudas.
// =================================================================
const fs = require('fs');
const path = require('path');
const { urlLogoGrupo } = require('../src/services/logoGrupo');

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }
const leer = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// 1) Ninguna consulta de las rutas calientes selecciona logo_base64 "crudo"
//    (solo como "(logo_base64 IS NOT NULL)") — se revisan las que solo
//    necesitan saber si el grupo TIENE logo.
const CALIENTES = ['src/middleware/auth.js', 'src/routes/cliente.js', 'src/routes/hipismoCliente.js', 'src/services/gruposClientes.js', 'src/routes/auth.js'];
for (const rel of CALIENTES) {
  const sqls = leer(rel).split('\n').filter(l => /SELECT|FROM grupos|g\.logo_base64|logo_base64 AS/i.test(l) && /logo_base64/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  const crudas = sqls.filter(l => /logo_base64/.test(l) && !/IS NOT NULL/.test(l.replace(/\s+/g, ' ')));
  check(crudas.length === 0, `${rel}: el SELECT no trae logo_base64 crudo (solo "IS NOT NULL")${crudas.length ? ' -> ' + crudas[0].trim() : ''}`);
}

// 2) urlLogoGrupo sigue funcionando con el booleano
check(urlLogoGrupo('g1', { logo_url: null, logo_base64: true }) === '/api/imagenes/logo-grupo/g1', 'urlLogoGrupo: con logo_base64=true arma la URL del proxy');
check(urlLogoGrupo('g1', { logo_url: null, logo_base64: false }) === null, 'urlLogoGrupo: sin logo (false) devuelve null');
check(urlLogoGrupo('g1', { grupo_logo_url: null, grupo_logo_base64: true }, { campoUrl: 'grupo_logo_url', campoBase64: 'grupo_logo_base64' }) === '/api/imagenes/logo-grupo/g1', 'urlLogoGrupo: funciona con los alias del login de Empleado');

// 3) El chat: la lista NO trae adjunto_datos
const chat = leer('src/services/chat.js');
const listar = chat.slice(chat.indexOf('async function listarMensajes'), chat.indexOf('async function obtenerAdjunto'));
check(!/SELECT[^;]*\badjunto_datos\b(?!\s+IS)/.test(listar.replace(/\(adjunto_datos IS NOT NULL\)/g, '')), 'listarMensajes no selecciona adjunto_datos');
check(/tiene_adjunto/.test(listar), 'listarMensajes marca tiene_adjunto');

// 4) La revisión nocturna no hace SELECT * de todos los grupos
check(!/SELECT \* FROM grupos WHERE modulo_hipismo_habilitado/.test(leer('src/services/hipismoCuadreNocturno.js')), 'la pasada nocturna ya no trae SELECT * (con logo) de todos los grupos cada 15 min');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
