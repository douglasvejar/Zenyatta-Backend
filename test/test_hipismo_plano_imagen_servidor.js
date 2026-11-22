// =================================================================
// PRUEBA: la tarjeta del plano resuelto dibujada en el servidor (18-11-2026).
// Cubre el SVG (secciones, colores del grupo, bandera de Venezuela, logo del hipódromo, densidad por cantidad de
// jugadas, escape de texto) y, si @resvg/resvg-js está disponible, el PNG real.
// =================================================================
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:1/x';
const assert = require('assert');
const m = require('../src/services/hipismoPlanoImagenServidor');

let ok = 0, mal = 0;
function check(cond, msg) { try { assert.ok(cond); ok++; console.log('OK: ' + msg); } catch (e) { mal++; console.log('FALLÓ: ' + msg); } }

const nombres = ['Tykhe', 'Cachaco', 'Luis', 'Maria', 'Pedro', 'Juan'];
function datos(nj, extra) {
  const jugadas = [];
  for (let i = 0; i < nj; i++) jugadas.push({ cliente: nombres[i % 6], modalidad: '4x1', caballo: String(1 + (i % 9)), monto: 100 * (1 + i % 3), banquero: nombres[(i + 2) % 6], resultado: i % 2 ? -100 : 75, resultadoDa: i % 2 ? 95 : -80 });
  return Object.assign({
    grupo: 'Zenyatta', hipodromo: 'Gulfstream Park', carrera: 5, carreraTexto: '5ta', fecha: '2026-10-05', llegada: ['4', '5', '6', '7'], retirados: [3],
    jugadas, ganan: [['Tykhe', 450.5]], pierden: [['Cachaco', -300]], adelantadas: null
  }, extra || {});
}

(async () => {
  // --- números ---
  check(m.monto(1234.5) === '1.234,50' && m.monto(0) === '0,00' && m.signo(-75) === '-75,00' && m.signo(75) === '+75,00', 'los montos salen como en el panel: 1.234,50 / +75,00 / -75,00');

  // --- densidad (igual que el panel) ---
  check(m.nivelDe(6).w === 1080 && m.nivelDe(6).cols === 1 && m.nivelDe(24).w === 1400 && m.nivelDe(24).cols === 2 && m.nivelDe(80).cols === 3, 'pocas jugadas = 1 columna; más = 2; muchas = 3');

  // --- SVG normal ---
  let svg = m.armarSvgPlano(datos(6), { estilo: { primario: '#14532d', secundario: '#c8a24a' }, nacional: false, logoHipodromo: null });
  check(/^<svg /.test(svg) && /width="1080"/.test(svg) && /font-family="Poppins"/.test(svg), 'arma un SVG de 1080 de ancho con la fuente Poppins');
  check(/Gulfstream Park · 5ta carrera/.test(svg) && /ZENYATTA/.test(svg) && /Lunes 05-10-2026/.test(svg), 'encabezado: grupo, hipódromo · carrera y fecha');
  check(/LLEGADA/.test(svg) && /RETIRADO/.test(svg) && />4</.test(svg) && />7</.test(svg), 'llegada con los caballos y el retirado');
  check(/JUEGA/.test(svg) && /APOSTÓ/.test(svg) && />DA</.test(svg) && !/RESULTADO/.test(svg) &&
    /Tykhe <tspan[^>]*>\+75,00<\/tspan>/.test(svg) && /Luis <tspan[^>]*>-80,00<\/tspan>/.test(svg),
    'la tabla muestra el resultado individual junto a cada nombre');
  check(/TOTALES DE LA CARRERA/.test(svg) && /GANAN/.test(svg) && /PIERDEN/.test(svg) && /\+450,50/.test(svg) && /-300,00/.test(svg), 'cuadros de quiénes ganan y quiénes pierden');
  check(/6 jugadas · Reclamos al privado/.test(svg), 'el pie cuenta las jugadas');
  check(!/LINEA|TINTE/.test(svg), 'no quedan marcas de color sin reemplazar');
  check(/rgb\(20,83,45\)/.test(svg), 'usa el color primario del grupo');

  // --- bandera de Venezuela y logo ---
  const ve = m.armarSvgPlano(datos(6, { hipodromo: 'La Rinconada' }), { estilo: {}, nacional: true, logoHipodromo: null });
  check(/#fcd116/.test(ve) && /#00247d/.test(ve) && /#cf142b/.test(ve) && /<polygon/.test(ve), 'hipódromo nacional: encabezado con la bandera de Venezuela y sus estrellas');
  const conLogo = m.armarSvgPlano(datos(6), { estilo: {}, nacional: false, logoHipodromo: 'data:image/png;base64,AAAA' });
  check(/<image href="data:image\/png;base64,AAAA"/.test(conLogo), 'con logo del hipódromo lo pone a la derecha del título');
  check(m.archivoLogoHipodromo('Gulfstream Park') === 'gulfstream-park.png' && m.archivoLogoHipodromo('La Rinconada') === null, 'el catálogo de logos reconoce Gulfstream y no inventa logo a La Rinconada');

  // --- marca de agua del grupo ---
  const marca = m.armarSvgPlano(datos(6), { estilo: { logoDataUri: 'data:image/png;base64,BBBB' } });
  check(/opacity="0.12"/.test(marca) && /BBBB/.test(marca), 'el logo del grupo va de marca de agua detrás de las jugadas');

  // --- muchas jugadas y adelantadas ---
  const grande = m.armarSvgPlano(datos(24), { estilo: {} });
  check(/width="1400"/.test(grande) && (grande.match(/>JUEGA</g) || []).length === 2 &&
    (grande.match(/<tspan dx="5"/g) || []).length === 48, '24 jugadas en dos columnas con 48 resultados individuales');
  const adel = m.armarSvgPlano(datos(4, { adelantadas: { filas: [1], secciones: [{ titulo: 'JUGADAS ENTRE TERCIOS ADELANTADAS', filas: [{ cliente: 'Tykhe', item: 'Cachaco', resultado: 200 }] }] } }), { estilo: {} });
  check(/PARADA ADELANTADAS/.test(adel) && /JUGADAS ENTRE TERCIOS ADELANTADAS/.test(adel) && /5 jugadas/.test(adel), 'las adelantadas van en su sección y cuentan en el pie');
  const sinJug = m.armarSvgPlano(datos(0, { ganan: [], pierden: [] }), { estilo: {} });
  check(/<svg /.test(sinJug) && !/GANAN/.test(sinJug), 'sin jugadas ni resultados no se rompe');

  // --- texto peligroso ---
  const raro = m.armarSvgPlano(datos(1, { grupo: 'A&B <x>', jugadas: [{ cliente: 'Tom & "Jerry" <b>', modalidad: '2p', caballo: '3', monto: 10, banquero: 'X', resultado: 5 }] }), { estilo: {} });
  check(!/<b>/.test(raro) && /A&amp;B &lt;X&gt;/.test(raro) && /&quot;/.test(raro), 'el texto se escapa (nombres con & < > ")');

  // --- nombres largos se recortan ---
  const largo = m.armarSvgPlano(datos(1, { jugadas: [{ cliente: 'UN NOMBRE DE CLIENTE MUY MUY LARGO '.repeat(3), modalidad: '4x1', caballo: '3', monto: 10, banquero: 'OTRO NOMBRE DE BANQUERO LARGUISIMO', resultado: 5 }] }), { estilo: {} });
  check(/…/.test(largo), 'los nombres demasiado largos se recortan con …');

  // --- PNG real (si el servidor tiene resvg) ---
  let resvg = true;
  try { require('@resvg/resvg-js'); } catch (e) { resvg = false; }
  if (resvg) {
    const { svgAPng } = require('../src/services/saldosSemanaImagen');
    const png = svgAPng(svg);
    check(Buffer.isBuffer(png) && png.slice(1, 4).toString() === 'PNG', 'el SVG se convierte en un PNG real');
  } else {
    console.log('(sin @resvg/resvg-js en esta máquina: se omite la prueba del PNG)');
  }

  console.log('\n' + ok + ' pruebas OK, ' + mal + ' fallaron.');
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
