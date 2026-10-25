// =================================================================
// PRUEBA ESTÁTICA (25-10-2026): ningún texto que ve el usuario puede traer "Zenyatta" escrito a la fuerza — cada grupo
// ve SIEMPRE el nombre de su propio grupo (plano, saldos, totales, imágenes, textos copiados, Excel, bots).
// "Zenyatta" solo se permite en comentarios, en las claves internas de localStorage (zenyatta_token, ...) y en la URL del repo.
// (La prueba completa en navegador con un grupo "LARGAVITA" es ui_nombre_grupo.js; esta corre siempre, sin base de datos.)
// =================================================================
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
function archivos(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (!['node_modules', 'img', 'videos', 'assets', '.git'].includes(n)) archivos(p, out); }
    else if (/\.(js|html)$/.test(n) && !/-1\.html$/.test(n)) out.push(p);
  }
  return out;
}
const lista = [...archivos(path.join(raiz, 'src')), ...archivos(path.join(raiz, 'public'))];
let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

const malos = [];
lista.forEach(f => {
  let enBloque = false;
  fs.readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
    let l = linea;
    if (enBloque) { if (l.includes('*/') || l.includes('-->')) { enBloque = false; l = l.replace(/^.*?(\*\/|-->)/, ''); } else return; }
    // Comentarios de bloque / HTML que abren y no cierran en la misma línea.
    const abre = l.match(/(\/\*|<!--)(?!.*(\*\/|-->))/);
    if (abre) { enBloque = true; l = l.slice(0, abre.index); }
    l = l.replace(/\/\*.*?\*\//g, '').replace(/<!--.*?-->/g, '');
    if (/^\s*(\/\/|\*)/.test(l)) return;
    l = l.replace(/\s\/\/\s.*$/, '');                        // comentario al final de la línea
    l = l.replace(/zenyatta_[a-z_]+/gi, '').replace(/Zenyatta-Backend/gi, ''); // claves de localStorage y repo
    if (/zenyatta/i.test(l)) malos.push(path.relative(raiz, f) + ':' + (i + 1) + '  ' + l.trim().slice(0, 140));
  });
});
check(lista.length > 40, 'se revisaron ' + lista.length + ' archivos del código (src + public)');
check(malos.length === 0, 'ningún texto visible/fijo dice "Zenyatta"' + (malos.length ? '\n  ' + malos.join('\n  ') : ''));

// Los textos de respaldo (cuando falta el nombre) son genéricos, no el de un grupo en particular.
const { generarTextoListadoSabana } = require('../src/services/planoWhatsAppTexto');
const texto = generarTextoListadoSabana({ tickets: [], fecha: '2026-10-25' }, { nombreGrupo: 'LARGAVITA' });
check(texto.startsWith('*LARGAVITA*'), 'el plano de Deportes arranca con el nombre del grupo (LARGAVITA)');
check(!/zenyatta/i.test(generarTextoListadoSabana({ tickets: [], fecha: '2026-10-25' })), 'sin nombre de grupo el respaldo tampoco dice Zenyatta');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron ? 1 : 0);
