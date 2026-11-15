// 15-11-2026: Registro de Jugadas de Oficinas con la vista mejorada (resumen, buscador, llegada con colores, panel con cuadre).
const fs = require('fs'), path = require('path');
const leer = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = leer('public/hipismo-oficinas.html'), mej = leer('public/oficinas-mejoras.js');
let ok = 0, fail = 0;
const check = (c, m) => { if (c) ok++; else { fail++; console.log('FALLA:', m); } };

check(/class="reg-kpis"|reg-kpis/.test(html) && /Pendientes de llegada/.test(html) && /Total jugado/.test(html), 'resumen del día (KPIs)');
check(/id="rBuscar"/.test(html) && /buscarJugadorRegistro\(\)/.test(html), 'buscador de jugador del día');
check(/verTodasJugadasRegistro\(true\)/.test(html) && /verTodasJugadasRegistro\(false\)/.test(html), 'botones ver/ocultar todas');
check(/INF\.colorEjemplar\(n\)/.test(html) && /reg-llega/.test(html) && /nth-child\(1\) \{ box-shadow: 0 0 0 2px #f5c400/.test(html), 'llegada con colores y aro de oro/plata/bronce');
check(/reg-del/.test(html) && /aria-label="Eliminar carrera"/.test(html) && /puedeOficina\('oficinas_eliminar'\)/.test(html), 'Eliminar sigue protegido por permiso y queda en gris');
check(/onclick="abrirDelRegistro\(\$\{idH\(h\)\}, \$\{c\.numero\}\)"/.test(html), 'tocar la fila sigue abriendo la carrera');
check(/REG_DET = new Map\(\)/.test(html), 'caché de jugadas se vacía al cargar el día');
check(/function htmlDetalleRegistro/.test(mej) && /reg-cuadra/.test(mej) && /No cuadra/.test(mej), 'panel de jugadas con cuadre');
check(/INF\.caballosHTML\(f\.caballo\)/.test(mej) && /reg-rol/.test(mej), 'jugadas con chip Jugó/Dio y caballos de colores');
check(/abrirDelRegistro\('\$\{esc\(hipodromoId\)\}', \$\{numero\}, \$\{i\}\)/.test(mej), 'Corregir abre la jugada puntual');
check(/regNorm\(f\.jugador\)\.includes\(q\)/.test(mej) && /REG_BUSQ/.test(mej), 'búsqueda sin tildes y sin carreras cruzadas');
check(!/pintarRegistro = function/.test(mej), 'ya no se parcha pintarRegistro desde mejoras');
try { new Function(mej); check(true, 'mejoras JS válido'); } catch (e) { check(false, 'JS inválido ' + e.message); }
console.log(`${ok} OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
