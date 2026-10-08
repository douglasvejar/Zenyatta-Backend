// =================================================================
// saldosSemanaImagen.js (08-10-2026) — LA FOTO DEL BALANCE DE LA SEMANA.
// Pedido del usuario: después del "TOTAL DEL GRUPO" del comando
// "corte semana", mandar una foto con todos los clientes activos en la
// semana: cuánto han apostado, cuánto han ganado, cuánto han perdido,
// Polla, traspasos y cómo van (saldo de la semana).
//
// Las fotos del panel se dibujan en el navegador; el bot no tiene
// navegador, así que acá se arma la misma tabla como SVG (texto puro) y
// se convierte a PNG con @resvg/resvg-js (sin Chrome, sin canvas). La
// fuente (Poppins) viaja dentro del repo (src/assets/fonts) para no
// depender de las fuentes del servidor.
//
// Los NÚMEROS no se calculan acá: llegan de
// balanceGeneral.calcularBalanceSemanalPorCliente (la misma cuenta del
// panel "Saldos Semana" y del texto del corte), así la foto y los
// mensajes nunca muestran cifras distintas. Los colores y el logo salen
// de la configuración del grupo (Súper-admin), nada va fijo por grupo.
// =================================================================
const path = require('path');
const db = require('../db');
const { formatMontoPlano, formatDineroPlano } = require('./planoWhatsAppTexto');

const FUENTES = ['Poppins-Regular.ttf', 'Poppins-Medium.ttf', 'Poppins-Bold.ttf']
  .map(f => path.join(__dirname, '..', 'assets', 'fonts', f));

// Color por defecto cuando el grupo no configuró los suyos (verde clásico).
const COLOR_PRIMARIO_DEFECTO = '#14532d';
const COLOR_SECUNDARIO_DEFECTO = '#16a34a';
const POSITIVO = '#15803d';
const NEGATIVO = '#b91c1c';
const FILAS_POR_FOTO = 38;
const EPS = 0.005;

const redondear = n => Math.round((Number(n) || 0) * 100) / 100;
const hayMonto = n => Math.abs(Number(n) || 0) >= EPS;

function escaparXml(t) {
  return String(t === undefined || t === null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function recortar(texto, max) {
  const t = String(texto || '').trim();
  return t.length > max ? t.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : t;
}

function hexValido(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  return m ? '#' + m[1].toLowerCase() : null;
}

// Negro o blanco según el fondo, para que el título se lea con cualquier color del grupo.
function textoSobre(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#10231a' : '#ffffff';
}

function fechaCorta(iso) {
  const [a, m, d] = String(iso || '').split('-');
  return d && m ? `${d}/${m}` : String(iso || '');
}

// ---------------------------------------------------------------
// Datos: sale 1 a 1 de lo que ya calculó calcularBalanceSemanalPorCliente.
// Solo entran los clientes con movimiento en la semana.
// ---------------------------------------------------------------
function armarDatosFoto({ grupoNombre, desde, hasta, porCliente }) {
  const clientes = Object.keys(porCliente || {})
    .filter(n => Object.keys(porCliente[n].porFecha || {}).length > 0)
    .sort()
    .map(nombre => {
      const c = porCliente[nombre];
      return {
        nombre,
        apostado: c.totalArriesgado || 0,
        ganado: c.totalGanado || 0,
        perdido: c.totalPerdido || 0,
        comision: c.totalComision || 0,
        polla: c.totalPolla || 0,
        traspasos: c.totalTransferencias || 0,
        saldo: c.totalSaldoCliente || 0
      };
    });
  const total = clientes.reduce((acc, c) => {
    ['apostado', 'ganado', 'perdido', 'comision', 'polla', 'traspasos', 'saldo'].forEach(k => { acc[k] += c[k]; });
    return acc;
  }, { apostado: 0, ganado: 0, perdido: 0, comision: 0, polla: 0, traspasos: 0, saldo: 0 });
  return { grupoNombre: grupoNombre || '', desde, hasta, clientes, total };
}

// Las columnas con puros ceros (Polla, traspasos, %) no se pintan: ocupan lugar sin decir nada.
function columnasDe(datos) {
  const hay = k => datos.clientes.some(c => hayMonto(c[k]));
  const cols = [
    { k: 'apostado', titulo: 'APOSTADO', tipo: 'monto' },
    { k: 'ganado', titulo: 'GANADO', tipo: 'ganado' },
    { k: 'perdido', titulo: 'PERDIDO', tipo: 'perdido' }
  ];
  if (hay('comision')) cols.push({ k: 'comision', titulo: '%', tipo: 'signo' });
  if (hay('polla')) cols.push({ k: 'polla', titulo: 'POLLA', tipo: 'signo' });
  if (hay('traspasos')) cols.push({ k: 'traspasos', titulo: 'TRASPASOS', tipo: 'signo' });
  cols.push({ k: 'saldo', titulo: 'SALDO SEMANA', tipo: 'saldo' });
  return cols;
}

function textoCelda(col, valor) {
  const v = redondear(valor);
  if (col.tipo === 'monto' || col.tipo === 'ganado' || col.tipo === 'perdido') return formatMontoPlano(Math.abs(v)) + '$';
  if (Math.abs(v) < EPS) return col.tipo === 'saldo' ? '0,00$' : '—';
  return formatDineroPlano(v);
}

function colorCelda(col, valor) {
  const v = redondear(valor);
  if (col.tipo === 'ganado') return v > 0 ? POSITIVO : '#6b7280';
  if (col.tipo === 'perdido') return v > 0 ? NEGATIVO : '#6b7280';
  if (col.tipo === 'monto') return '#1b1f23';
  if (Math.abs(v) < EPS) return col.tipo === 'saldo' ? '#6b7280' : '#9ca3af';
  return v > 0 ? POSITIVO : NEGATIVO;
}

// ---------------------------------------------------------------
// SVG de UNA foto (una página de hasta FILAS_POR_FOTO clientes).
// ---------------------------------------------------------------
function armarSvg(datos, { pagina, paginas, filas, esUltima, estilo }) {
  const cols = columnasDe(datos);
  const primario = hexValido(estilo && estilo.primario) || COLOR_PRIMARIO_DEFECTO;
  const secundario = hexValido(estilo && estilo.secundario) || COLOR_SECUNDARIO_DEFECTO;
  const sobre = textoSobre(primario);
  const sobreDerecha = textoSobre(secundario); // el texto de la derecha cae sobre el 2.º color del degradado
  const logo = estilo && estilo.logoDataUri;

  const MARGEN = 40;
  const ANCHO_NOMBRE = 270;
  const ANCHO_COL = 150;
  const ANCHO = MARGEN * 2 + ANCHO_NOMBRE + cols.length * ANCHO_COL;
  const ALTO_CABECERA = 120;
  const ALTO_TITULOS = 48;
  const ALTO_FILA = 50;
  const ALTO_TOTAL = 62;
  const ALTO_PIE = 52;
  const alto = ALTO_CABECERA + ALTO_TITULOS + filas.length * ALTO_FILA + (esUltima ? ALTO_TOTAL : 0) + ALTO_PIE;
  const xDerecha = i => MARGEN + ANCHO_NOMBRE + (i + 1) * ANCHO_COL - 14;

  const nombreGrupo = recortar(String(datos.grupoNombre || 'GRUPO').toUpperCase(), 34);
  const rango = `${fechaCorta(datos.desde)} al ${fechaCorta(datos.hasta)}`;
  const subtitulo = `SALDOS DE LA SEMANA · ${rango}` + (paginas > 1 ? `  (${pagina}/${paginas})` : '');
  const xTitulo = MARGEN + (logo ? 92 : 0);

  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${alto}" viewBox="0 0 ${ANCHO} ${alto}" font-family="Poppins">`);
  p.push(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${primario}"/><stop offset="1" stop-color="${secundario}"/></linearGradient>` +
    `<clipPath id="lg"><circle cx="${MARGEN + 36}" cy="${ALTO_CABECERA / 2}" r="36"/></clipPath></defs>`);
  p.push(`<rect width="${ANCHO}" height="${alto}" fill="#ffffff"/>`);
  // Cabecera con los colores del grupo.
  p.push(`<rect width="${ANCHO}" height="${ALTO_CABECERA}" fill="url(#g)"/>`);
  if (logo) {
    p.push(`<circle cx="${MARGEN + 36}" cy="${ALTO_CABECERA / 2}" r="38" fill="#ffffff"/>`);
    p.push(`<image href="${logo}" x="${MARGEN}" y="${ALTO_CABECERA / 2 - 36}" width="72" height="72" preserveAspectRatio="xMidYMid slice" clip-path="url(#lg)"/>`);
  }
  p.push(`<text x="${xTitulo}" y="54" font-size="34" font-weight="700" fill="${sobre}">${escaparXml(nombreGrupo)}</text>`);
  p.push(`<text x="${xTitulo}" y="90" font-size="19" font-weight="500" fill="${sobre}" fill-opacity="0.88">${escaparXml(subtitulo)}</text>`);
  p.push(`<text x="${ANCHO - MARGEN}" y="90" font-size="19" font-weight="500" text-anchor="end" fill="${sobreDerecha}" fill-opacity="0.92">${datos.clientes.length} ${datos.clientes.length === 1 ? 'cliente' : 'clientes'} con jugadas</text>`);

  // Títulos de columnas.
  const yTit = ALTO_CABECERA;
  p.push(`<rect y="${yTit}" width="${ANCHO}" height="${ALTO_TITULOS}" fill="#f1f5f4"/>`);
  p.push(`<text x="${MARGEN}" y="${yTit + 31}" font-size="14" font-weight="700" fill="#4b5563" letter-spacing="1.2">CLIENTE</text>`);
  cols.forEach((c, i) => {
    p.push(`<text x="${xDerecha(i)}" y="${yTit + 31}" font-size="14" font-weight="700" text-anchor="end" fill="#4b5563" letter-spacing="1.2">${escaparXml(c.titulo)}</text>`);
  });

  // Filas.
  let y = yTit + ALTO_TITULOS;
  filas.forEach((f, idx) => {
    if (idx % 2 === 1) p.push(`<rect y="${y}" width="${ANCHO}" height="${ALTO_FILA}" fill="#f8faf9"/>`);
    p.push(`<text x="${MARGEN}" y="${y + 32}" font-size="20" font-weight="500" fill="#1b1f23">${escaparXml(recortar(f.nombre, 22))}</text>`);
    cols.forEach((c, i) => {
      const esSaldo = c.tipo === 'saldo';
      p.push(`<text x="${xDerecha(i)}" y="${y + 32}" font-size="${esSaldo ? 21 : 19}" font-weight="${esSaldo ? 700 : 400}" text-anchor="end" fill="${colorCelda(c, f[c.k])}">${escaparXml(textoCelda(c, f[c.k]))}</text>`);
    });
    p.push(`<line x1="${MARGEN}" x2="${ANCHO - MARGEN}" y1="${y + ALTO_FILA}" y2="${y + ALTO_FILA}" stroke="#e5e7eb"/>`);
    y += ALTO_FILA;
  });

  // Total (solo en la última foto).
  if (esUltima) {
    p.push(`<rect y="${y}" width="${ANCHO}" height="${ALTO_TOTAL}" fill="${primario}" fill-opacity="0.09"/>`);
    p.push(`<rect y="${y}" width="${ANCHO}" height="3" fill="${primario}"/>`);
    p.push(`<text x="${MARGEN}" y="${y + 39}" font-size="21" font-weight="700" fill="#1b1f23">TOTAL</text>`);
    cols.forEach((c, i) => {
      p.push(`<text x="${xDerecha(i)}" y="${y + 39}" font-size="${c.tipo === 'saldo' ? 23 : 20}" font-weight="700" text-anchor="end" fill="${colorCelda(c, datos.total[c.k])}">${escaparXml(textoCelda(c, datos.total[c.k]))}</text>`);
    });
    y += ALTO_TOTAL;
  }

  p.push(`<text x="${MARGEN}" y="${y + 33}" font-size="14" fill="#6b7280">Saldo: positivo (+) el cliente va ganando · negativo (−) va perdiendo.</text>`);
  p.push('</svg>');
  return p.join('');
}

function armarPaginasSvg(datos, estilo) {
  const filas = datos.clientes;
  const paginas = Math.max(1, Math.ceil(filas.length / FILAS_POR_FOTO));
  const svgs = [];
  for (let i = 0; i < paginas; i++) {
    svgs.push(armarSvg(datos, {
      pagina: i + 1,
      paginas,
      filas: filas.slice(i * FILAS_POR_FOTO, (i + 1) * FILAS_POR_FOTO),
      esUltima: i === paginas - 1,
      estilo
    }));
  }
  return svgs;
}

// SVG -> PNG. @resvg/resvg-js se carga recién acá: si por algo no está instalado, el resto del bot
// sigue funcionando y solo esta foto se omite (devuelve null).
function svgAPng(svg) {
  let Resvg;
  try { ({ Resvg } = require('@resvg/resvg-js')); } catch (e) {
    console.error('[saldosSemanaImagen] @resvg/resvg-js no está instalado — no se puede armar la foto:', e.message);
    return null;
  }
  const r = new Resvg(svg, {
    font: { fontFiles: FUENTES, loadSystemFonts: false, defaultFontFamily: 'Poppins' },
    background: '#ffffff'
  });
  return r.render().asPng();
}

// Logo y colores del grupo (Súper-admin). El logo solo se usa si está subido como archivo
// (png/jpg/webp/gif); una logo_url externa no se descarga desde acá.
async function cargarEstiloGrupo(grupoId) {
  const r = await db.query('SELECT nombre, tema_color_primario, tema_color_secundario, logo_base64, logo_mime FROM grupos WHERE id = $1', [grupoId]);
  const g = r.rows[0] || {};
  const mime = String(g.logo_mime || '').toLowerCase();
  const logoOk = g.logo_base64 && /^image\/(png|jpe?g|webp|gif)$/.test(mime);
  return {
    nombre: g.nombre || '',
    primario: g.tema_color_primario || null,
    secundario: g.tema_color_secundario || null,
    logoDataUri: logoOk ? `data:${mime};base64,${g.logo_base64}` : null
  };
}

// Punto de entrada: devuelve la lista de PNG (Buffer) de la semana, o [] si no hay clientes con
// jugadas o no se pudo dibujar. Nunca lanza: el corte de texto ya salió y esta foto es un extra.
async function generarFotosSaldosSemana({ grupoId, desde, hasta, porCliente }) {
  try {
    const estilo = await cargarEstiloGrupo(grupoId);
    const datos = armarDatosFoto({ grupoNombre: estilo.nombre, desde, hasta, porCliente });
    if (datos.clientes.length === 0) return [];
    const fotos = [];
    for (const svg of armarPaginasSvg(datos, estilo)) {
      const png = svgAPng(svg);
      if (!png) return [];
      fotos.push(png);
    }
    return fotos;
  } catch (e) {
    console.error('[saldosSemanaImagen] No se pudo armar la foto del balance semanal (grupo ' + grupoId + '):', e.message);
    return [];
  }
}

module.exports = {
  armarDatosFoto,
  columnasDe,
  armarSvg,
  armarPaginasSvg,
  svgAPng,
  cargarEstiloGrupo,
  generarFotosSaldosSemana,
  FILAS_POR_FOTO
};
