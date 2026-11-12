// Prueba (12-11-2026): al cerrar sesión en Deportes (grupo.html / app.js) la pantalla NO puede conservar nada del grupo anterior
// (sábana pegada, resumen por cliente, resultados...). Se verificó en Chromium: login grupo A, sábana procesada, cerrar sesión, login
// grupo B -> antes quedaban 78 caracteres de tabla, 1 ticket y la sábana pegada; ahora todo en cero. Aquí se vigilan las piezas clave.
const fs = require('fs'); const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
let ok = 0, fail = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK: ' + m); } else { fail++; console.log('FALLÓ: ' + m); } };
const i = app.indexOf('function cerrarSesion(mensaje)');
const cuerpo = app.slice(i, app.indexOf('\n}\n', i));
check(i > 0, 'existe cerrarSesion()');
check(/querySelectorAll\('textarea, input/.test(cuerpo) && /\.value = ''/.test(cuerpo), 'cerrarSesion vacía los cuadros de texto (la sábana pegada, etc.)');
check(/window\.location\.replace\(/.test(cuerpo) && !/location\.reload\(/.test(cuerpo), 'cerrarSesion vuelve a cargar la página limpia con navegación (no recarga que restaure lo escrito)');
check(/localStorage\.setItem\('zenyatta_login_mensaje', mensaje\)/.test(cuerpo) && /localStorage\.getItem\('zenyatta_login_mensaje'\)/.test(app), 'el aviso (inactividad / sesión vencida) viaja a la pantalla de login por la bandera de un solo uso');
check(/localStorage\.removeItem\('zenyatta_token'\)/.test(cuerpo) && cuerpo.indexOf("removeItem('zenyatta_token')") < cuerpo.indexOf('location.replace'), 'primero se borra la sesión y después se recarga (no hay bucle de recargas)');
let compila = true; try { new (require('vm').Script)(app); } catch (e) { compila = false; } check(compila, 'app.js compila');
console.log(`\n${ok} pruebas OK, ${fail} fallaron.`); if (fail) process.exit(1);
