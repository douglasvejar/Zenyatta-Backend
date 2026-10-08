// =================================================================
// PRUEBA: foto del balance de la semana (08-10-2026) — "corte semana" manda,
// después del total del grupo, una foto con los clientes activos en la semana.
// Cubre los datos, el SVG (columnas, colores del grupo, paginado, escape de
// texto), el PNG real, y el envío de fotos por la API de Telegram.
// =================================================================
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:1/x';
const assert = require('assert');
const img = require('../src/services/saldosSemanaImagen');
const { crearClienteTelegram } = require('../src/services/telegramApi');
const { crearSock, crearSockCentral } = require('../src/services/telegramBot');

let ok = 0, mal = 0;
function check(cond, msg) { try { assert.ok(cond); ok++; console.log('OK: ' + msg); } catch (e) { mal++; console.log('FALLÓ: ' + msg); } }

const cli = (a, g, p, c, pol, tr, s, conJugadas = true) => ({ porFecha: conJugadas ? { '2026-10-05': {} } : {}, totalArriesgado: a, totalGanado: g, totalPerdido: p, totalComision: c, totalPolla: pol, totalTransferencias: tr, totalSaldoCliente: s });

(async () => {
  // --- datos ---
  const porCliente = {
    BERNAL: cli(300, 150, 200, 0, 0, 0, -50),
    LOPEZ: cli(100, 0, 100, 10, 0, 0, -90),
    CARLOS: cli(0, 0, 0, 0, 0, 0, 0, false)
  };
  const datos = img.armarDatosFoto({ grupoNombre: 'Bernal', desde: '2026-10-05', hasta: '2026-10-11', porCliente });
  check(datos.clientes.length === 2 && !datos.clientes.some(c => c.nombre === 'CARLOS'), 'solo entran los clientes con jugadas en la semana');
  check(datos.total.apostado === 400 && datos.total.saldo === -140 && datos.total.comision === 10, 'la fila TOTAL suma cada columna de los clientes');

  // --- columnas: las que están en cero no se pintan ---
  let titulos = img.columnasDe(datos).map(c => c.titulo);
  check(titulos.join('|') === 'APOSTADO|GANADO|PERDIDO|%|SALDO SEMANA', 'sin Polla ni traspasos en la semana, esas columnas no salen (el % sí, porque LOPEZ tiene)');
  const conTodo = img.armarDatosFoto({ grupoNombre: 'X', desde: '2026-10-05', hasta: '2026-10-11', porCliente: { A: cli(10, 0, 0, 0, 5, 7, 12) } });
  titulos = img.columnasDe(conTodo).map(c => c.titulo);
  check(titulos.includes('POLLA') && titulos.includes('TRASPASOS') && !titulos.includes('%'), 'con Polla y traspasos distintos de cero, esas columnas salen (y el % no, si nadie tiene)');

  // --- SVG ---
  const svgs = img.armarPaginasSvg(datos, { primario: null, secundario: null, logoDataUri: null });
  check(svgs.length === 1 && svgs[0].includes('TOTAL') && svgs[0].includes('BERNAL') && svgs[0].includes('LOPEZ'), 'una foto con los 2 clientes y la fila TOTAL');
  check(svgs[0].includes('#14532d'), 'sin colores configurados usa el verde clásico por defecto');
  const svgColor = img.armarPaginasSvg(datos, { primario: '1e3a8a', secundario: '#F59E0B', logoDataUri: null })[0];
  check(svgColor.includes('#1e3a8a') && svgColor.includes('#f59e0b'), 'usa los colores del grupo (con o sin #, en mayúsculas o minúsculas)');
  const svgMalo = img.armarPaginasSvg(datos, { primario: 'azul', secundario: '12', logoDataUri: null })[0];
  check(svgMalo.includes('#14532d'), 'un color inválido no rompe nada: cae al verde por defecto');
  const svgLogo = img.armarPaginasSvg(datos, { logoDataUri: 'data:image/png;base64,AAAA' })[0];
  check(svgLogo.includes('<image'), 'con logo del grupo lo dibuja en la cabecera');
  const raro = img.armarDatosFoto({ grupoNombre: 'A & <B>', desde: '2026-10-05', hasta: '2026-10-11', porCliente: { 'R&D <x>': cli(1, 0, 0, 0, 0, 0, 1) } });
  const svgRaro = img.armarPaginasSvg(raro, {})[0];
  check(svgRaro.includes('A &amp; &lt;B&gt;') && svgRaro.includes('R&amp;D &lt;x&gt;') && !svgRaro.includes('<x>'), 'los nombres con & < > se escapan (no rompen el dibujo)');

  // --- paginado ---
  const muchos = {};
  for (let i = 0; i < 90; i++) muchos['CLIENTE' + String(i).padStart(2, '0')] = cli(10, 5, 5, 0, 0, 0, 1);
  const datosMuchos = img.armarDatosFoto({ grupoNombre: 'G', desde: '2026-10-05', hasta: '2026-10-11', porCliente: muchos });
  const pags = img.armarPaginasSvg(datosMuchos, {});
  check(pags.length === 3, '90 clientes se reparten en 3 fotos de hasta ' + img.FILAS_POR_FOTO + ' filas');
  check(!pags[0].includes('>TOTAL<') && !pags[1].includes('>TOTAL<') && pags[2].includes('>TOTAL<'), 'la fila TOTAL sale solo en la última foto');
  check(pags[0].includes('(1/3)') && pags[2].includes('(3/3)'), 'cada foto dice cuál es (1/3, 2/3, 3/3)');

  // --- PNG real ---
  const png = img.svgAPng(svgs[0]);
  check(Buffer.isBuffer(png) && png.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && png.length > 5000, 'el SVG se convierte en un PNG válido (con la fuente incluida en el repo)');

  // --- Telegram: enviarFoto ---
  const llamadas = [];
  const fetchFalso = async (url, opts) => { llamadas.push({ url, opts }); return { json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
  const api = crearClienteTelegram({ token: 'T', fetchImpl: fetchFalso });
  await api.enviarFoto(-100123, png, '📊 Balance de la semana');
  const l = llamadas[0];
  check(/\/sendPhoto$/.test(l.url) && l.opts.body instanceof FormData && !l.opts.headers, 'enviarFoto usa sendPhoto con multipart (sin content-type fijo)');
  check(l.opts.body.get('chat_id') === '-100123' && l.opts.body.get('photo').size === png.length && /Balance/.test(l.opts.body.get('caption')) && l.opts.body.get('parse_mode') === 'HTML', 'manda el chat, la foto completa y el texto con formato');

  let n = 0;
  const fetchRechaza = async (url, opts) => { n++; return { json: async () => (n === 1 ? { ok: false, description: "Bad Request: can't parse entities" } : { ok: true, result: {} }) }; };
  await crearClienteTelegram({ token: 'T', fetchImpl: fetchRechaza }).enviarFoto(1, png, '*x*');
  check(n === 2, 'si Telegram rechaza el formato del texto, reintenta la foto sin formato');

  // --- socks de Telegram ---
  const enviadas = [];
  const apiFalsa = { enviarFoto: async (chat, buf, cap) => enviadas.push({ chat, buf, cap }), enviarTexto: async () => {} };
  await crearSock(apiFalsa).sendMessage('tg_-100777@g.us', { image: png, caption: 'hola' });
  check(enviadas[0].chat === '-100777' && enviadas[0].buf === png && enviadas[0].cap === 'hola', 'el sock de un chat propio manda la foto a ese chat');
  await crearSockCentral(apiFalsa, '-100999', 'Deportes Bernal').sendMessage('x', { image: png, caption: '📊 Balance de la semana' });
  check(enviadas[1].chat === '-100999' && /^📍 \*DEPORTES BERNAL\*\n📊 Balance/.test(enviadas[1].cap), 'el sock del grupo central manda la foto al central con el nombre del grupo arriba');

  console.log('\n' + ok + ' pruebas OK, ' + mal + ' fallaron.');
  process.exit(mal ? 1 : 0);
})();
