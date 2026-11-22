// =================================================================
// hipismoPlanoImagenServidor.js (18-11-2026) — LA TARJETA DEL PLANO RESUELTO, DIBUJADA EN EL SERVIDOR.
// Pedido del usuario: cuando el administrador pone la pizarra desde el chat de WhatsApp, el bot publica
// el plano resuelto en TEXTO o en IMAGEN, según lo que se elija para ese grupo en Súper-admin
// (grupos.hipismo_chat_plano_formato = 'texto' | 'imagen').
//
// La tarjeta del panel se dibuja en el navegador (html2canvas, public/hipismo-mockup.html). El bot no tiene
// navegador, así que acá se dibuja la MISMA tarjeta (mismas secciones, mismos datos, mismos colores del grupo,
// encabezado con la bandera de Venezuela para los hipódromos nacionales, logo del hipódromo y marca de agua con el
// logo del grupo) como SVG y se convierte a PNG con @resvg/resvg-js (el mismo mecanismo de saldosSemanaImagen.js).
//
// Los DATOS no se calculan acá: llegan de armarDatosImagenPlano (hipismoPlanoImagen.js), las mismas cifras del texto.
// Diferencias inevitables con la tarjeta del navegador: la fuente es Poppins (la del repo) en vez de Segoe UI, y la
// marca de agua del grupo solo se pone si el logo está subido como archivo (no si es un enlace externo).
// =================================================================
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { svgAPng, cargarEstiloGrupo } = require('./saldosSemanaImagen');

const CARPETA_LOGOS = path.join(__dirname, '..', '..', 'public', 'img', 'hipodromos');
// MISMA lista que PIMG_LOGOS_HIPODROMO de public/hipismo-mockup.html (al sumar un logo, agregarlo en los dos sitios).
const LOGOS_HIPODROMO = [
  { claves: ['horseshoe indianapolis', 'indianapolis'], archivo: 'horseshoe-indianapolis.png' },
  { claves: ['aqueduct'], archivo: 'aqueduct.png' },
  { claves: ['belmont'], archivo: 'belmont-park.png' },
  { claves: ['charles town', 'charlestown'], archivo: 'charles-town.png' },
  { claves: ['churchill downs'], archivo: 'churchill-downs.png' },
  { claves: ['colonial downs'], archivo: 'colonial-downs.png' },
  { claves: ['del mar'], archivo: 'del-mar.png' },
  { claves: ['delaware park'], archivo: 'delaware-park.png' },
  { claves: ['delta downs'], archivo: 'delta-downs.png' },
  { claves: ['ellis park'], archivo: 'ellis-park.png' },
  { claves: ['emerald downs'], archivo: 'emerald-downs.png' },
  { claves: ['evangeline downs', 'evangeline'], archivo: 'evangeline-downs.png' },
  { claves: ['fair grounds', 'fairgrounds'], archivo: 'fair-grounds.png' },
  { claves: ['finger lakes'], archivo: 'finger-lakes.png' },
  { claves: ['fonner park'], archivo: 'fonner-park.png' },
  { claves: ['freehold'], archivo: 'freehold-raceway.png' },
  { claves: ['gulfstream'], archivo: 'gulfstream-park.png' },
  { claves: ['hawthorne'], archivo: 'hawthorne-race-course.png' },
  { claves: ['keeneland'], archivo: 'keeneland.png' },
  { claves: ['kentucky downs'], archivo: 'kentucky-downs.png' },
  { claves: ['laurel park', 'laurel'], archivo: 'laurel-park.png' },
  { claves: ['lone star'], archivo: 'lone-star-park.png' },
  { claves: ['los alamitos'], archivo: 'los-alamitos.png' },
  { claves: ['louisiana downs'], archivo: 'louisiana-downs.png' },
  { claves: ['mahoning valley', 'mahoning'], archivo: 'mahoning-valley.png' },
  { claves: ['meadowlands'], archivo: 'meadowlands-racetrack.png' },
  { claves: ['monmouth'], archivo: 'monmouth-park.png' },
  { claves: ['mountaineer'], archivo: 'mountaineer.png' },
  { claves: ['oaklawn'], archivo: 'oaklawn-park.png' },
  { claves: ['parx'], archivo: 'parx-racing.png' },
  { claves: ['penn national'], archivo: 'penn-national.png' },
  { claves: ['pimlico'], archivo: 'pimlico.png' },
  { claves: ['prairie meadows'], archivo: 'prairie-meadows.png' },
  { claves: ['sam houston'], archivo: 'sam-houston-race-park.png' },
  { claves: ['santa anita'], archivo: 'santa-anita-park.png' },
  { claves: ['saratoga race course'], archivo: 'saratoga-race-course.png' },
  { claves: ['tampa bay'], archivo: 'tampa-bay-downs.png' },
  { claves: ['thistledown'], archivo: 'thistledown.png' },
  { claves: ['turf paradise'], archivo: 'turf-paradise.png' },
  { claves: ['turfway'], archivo: 'turfway-park.png' }
];

// Camisetas de los caballos (mismos colores que el panel).
const SILK = {
  1: ['#d62828', '#fff'], 2: ['#f4f4f4', '#111'], 3: ['#1d4ed8', '#fff'], 4: ['#facc15', '#111'], 5: ['#16a34a', '#fff'],
  6: ['#111111', '#fff'], 7: ['#f97316', '#111'], 8: ['#f472b6', '#111'], 9: ['#22b8cf', '#111'], 10: ['#7c3aed', '#fff'],
  11: ['#9ca3af', '#111'], 12: ['#a3e635', '#111'], 13: ['#d6b98c', '#111'], 14: ['#7f1d1d', '#fff'], 15: ['#2dd4bf', '#111'], 16: ['#1e3a8a', '#fff']
};
const VERDE = '#17803f';
const ROJO = '#b42318';
const GRIS = '#5b6b63';
const TINTA = '#14211b';
// Poppins es más ancha que Segoe UI (la del navegador): las letras se achican un poco para que todo quepa igual.
const ESCALA_LETRA = 0.84;

const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const redondear = v => Math.round((Number(v) || 0) * 100) / 100;
function monto(v) {
  const n = Math.abs(redondear(v));
  const [e, d] = n.toFixed(2).split('.');
  return e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
}
const signo = v => { const n = redondear(v); return (n < 0 ? '-' : '+') + monto(n); };
const anchoAprox = (texto, fs, negrita) => String(texto || '').length * fs * (negrita ? 0.6 : 0.55);
function recortarAncho(texto, fs, maxPx, negrita) {
  const t = String(texto || '');
  if (anchoAprox(t, fs, negrita) <= maxPx) return t;
  const max = Math.max(1, Math.floor(maxPx / (fs * (negrita ? 0.6 : 0.55))) - 1);
  return t.slice(0, max).trimEnd() + '…';
}

// ---------- colores del grupo (mismas fórmulas que pimgTema del panel) ----------
function hexARgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminancia(rgb) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function contraste(a, b) {
  const la = luminancia(a), lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const mezcla = (rgb, t) => `rgb(${rgb.map(v => Math.round(v * t + 255 * (1 - t))).join(',')})`;
function temaDe(c1hex, c2hex) {
  const c1 = hexARgb(c1hex) || [14, 59, 44];
  const c2 = hexARgb(c2hex) || [200, 162, 74];
  const blanco = [255, 255, 255], oscuro = [20, 33, 27];
  const fg = contraste(c1, blanco) >= contraste(c1, oscuro) ? blanco : oscuro;
  const acc = contraste(c1, c2) >= 2.2 ? c2 : fg;
  const rgb = a => `rgb(${a.join(',')})`;
  return { c1: rgb(c1), c2: rgb(c2), fg: rgb(fg), acc: rgb(acc), bg: mezcla(c1, 0.06), tint: mezcla(c1, 0.12), line: mezcla(c1, 0.2) };
}

// ---------- densidad según la cantidad de renglones (igual que pimgNivel) ----------
function nivelDe(n) {
  if (n <= 10) return { w: 1080, cols: 1, rowh: 58, fs: 28, silk: 46, cCli: 250, cMod: 96, cSilk: 56, cMonto: 150, cDa: 200, perCol: 8, fl: 52, flfs: 30 };
  if (n <= 30) return { w: 1400, cols: 2, rowh: 44, fs: 23, silk: 34, cCli: 150, cMod: 66, cSilk: 38, cMonto: 96, cDa: 128, perCol: 6, fl: 44, flfs: 23 };
  if (n <= 60) return { w: 1400, cols: 2, rowh: 41, fs: 22, silk: 30, cCli: 150, cMod: 62, cSilk: 34, cMonto: 88, cDa: 128, perCol: 6, fl: 41, flfs: 22 };
  return { w: 1800, cols: 3, rowh: 40, fs: 21, silk: 28, cCli: 140, cMod: 60, cSilk: 32, cMonto: 84, cDa: 120, perCol: 6, fl: 40, flfs: 21 };
}

function fechaLarga(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const [a, m, d] = iso.split('-').map(Number);
  return `${dias[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${a}`;
}

function archivoLogoHipodromo(nombre) {
  const n = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return null;
  const hit = LOGOS_HIPODROMO.find(l => l.claves.some(c => n.includes(c)));
  return hit ? hit.archivo : null;
}
const cacheLogos = new Map();
function logoHipodromoDataUri(nombre) {
  const archivo = archivoLogoHipodromo(nombre);
  if (!archivo) return null;
  if (cacheLogos.has(archivo)) return cacheLogos.get(archivo);
  let uri = null;
  try { uri = 'data:image/png;base64,' + fs.readFileSync(path.join(CARPETA_LOGOS, archivo)).toString('base64'); }
  catch (e) { console.error('[hipismoPlanoImagenServidor] No se pudo leer el logo ' + archivo + ':', e.message); }
  cacheLogos.set(archivo, uri);
  return uri;
}

// ¿Es un hipódromo nacional (encabezado con la bandera de Venezuela)? Por el país con que está creado; si no se encuentra, por nombre.
async function esNacional(grupoId, nombre) {
  const n = String(nombre || '').trim().toLowerCase();
  if (!n) return false;
  try {
    const r = await db.query('SELECT pais FROM hipismo_hipodromos WHERE grupo_id = $1 AND lower(nombre) = $2 LIMIT 1', [grupoId, n]);
    if (r.rows[0]) return r.rows[0].pais === 'VE';
  } catch (e) { /* sin tabla o sin base: se reconoce por nombre */ }
  return /rinconada|valencia/.test(n.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

// ---------- piezas de dibujo ----------
function silk(p, cx, cy, d, n) {
  const num = parseInt(n, 10);
  const c = SILK[num] || ['#6b7280', '#fff'];
  const fsz = Math.round(d * 0.52);
  p.push(`<circle cx="${cx}" cy="${cy}" r="${d / 2 - 1}" fill="${c[0]}" stroke="rgba(0,0,0,0.25)" stroke-width="2"/>`);
  p.push(`<text x="${cx}" y="${cy + fsz * 0.36}" font-size="${fsz}" font-weight="700" text-anchor="middle" fill="${c[1]}">${esc(n)}</text>`);
}
function estrella(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push((cx + rr * Math.cos(ang)).toFixed(1) + ',' + (cy + rr * Math.sin(ang)).toFixed(1));
  }
  return `<polygon points="${pts.join(' ')}" fill="#ffffff"/>`;
}

function participante(p, x, y, ancho, fuente, nombre, valor) {
  const texto = valor == null ? '—' : Number(valor) === 0 ? monto(0) : signo(valor);
  const color = valor == null || Number(valor) === 0 ? GRIS : Number(valor) < 0 ? ROJO : VERDE;
  const espacio = ancho - anchoAprox(texto, fuente, true) - 9;
  const visible = recortarAncho(nombre, fuente, espacio, true);
  p.push(`<text x="${x}" y="${y}" font-size="${fuente}" font-weight="700" fill="${TINTA}">${esc(visible)} <tspan dx="5" fill="${color}">${texto}</tspan></text>`);
}

function posicionesTabla(x, cw, L) {
  const xCli = x + 14;
  if (L.resultadosPorNombre) {
    const ancho = cw - 28;
    return [xCli, xCli + ancho * .31, xCli + ancho * .43, xCli + ancho * .50, xCli + ancho * .65];
  }
  const xMod = xCli + L.cCli + 6;
  const xSilk = xMod + L.cMod + 6;
  const xMonto = xSilk + L.cSilk + 6;
  return [xCli, xMod, xSilk, xMonto, xMonto + L.cMonto + 6];
}

// Una fila de jugada (o de parada adelantada). `x` es el borde izquierdo de la columna, `cw` su ancho.
function filaJugada(p, x, y, cw, L, f) {
  const F = Math.round(L.fs * ESCALA_LETRA);
  const base = y + L.rowh / 2 + F * 0.36;
  const [xCli, xMod, xSilk, xMonto, xDa] = posicionesTabla(x, cw, L);
  const xAposto = L.resultadosPorNombre ? xDa - 9 : xMonto + L.cMonto;
  const anchoSilk = L.resultadosPorNombre ? xMonto - xSilk : L.cSilk;
  const xDerecha = x + cw - 14;
  p.push(`<line x1="${x}" x2="${x + cw}" y1="${y}" y2="${y}" stroke="LINEA"/>`);
  if (L.resultadosPorNombre) participante(p, xCli, base, xMod - xCli - 8, F, f.cliente, f.res);
  else p.push(`<text x="${xCli}" y="${base}" font-size="${F}" font-weight="700" fill="${TINTA}">${esc(recortarAncho(f.cliente, F, L.cCli, true))}</text>`);
  if (f.mod) p.push(`<text x="${xMod}" y="${base}" font-size="${F}" font-weight="700" fill="${TINTA}">${esc(recortarAncho(f.mod, F, xSilk - xMod - 6, true))}</text>`);
  const toks = String(f.cab || '').split(/[^0-9]+/).filter(Boolean);
  if (toks.length === 1) silk(p, xSilk + anchoSilk / 2, y + L.rowh / 2, L.silk, toks[0]);
  else if (f.cab) {
    const fc = Math.round(F * 0.8);
    p.push(`<text x="${xSilk}" y="${y + L.rowh / 2 + fc * 0.36}" font-size="${fc}" font-weight="700" fill="${TINTA}">${esc(recortarAncho(f.cab, fc, anchoSilk, true))}</text>`);
  }
  if (f.monto !== '' && f.monto != null) p.push(`<text x="${xAposto}" y="${base}" font-size="${F}" font-weight="700" text-anchor="end" fill="${TINTA}">${monto(f.monto)}</text>`);
  if (L.resultadosPorNombre) {
    participante(p, xDa + 6, base, xDerecha - xDa - 6, F, f.da, f.resDa);
    return;
  }
  const fd = Math.round(F * 0.9);
  const anchoDa = xDerecha - xDa - 14 - anchoAprox(signo(f.res), F, true) - 8;
  p.push(`<text x="${xDa + 14}" y="${y + L.rowh / 2 + fd * 0.36}" font-size="${fd}" font-weight="700" fill="${GRIS}">${esc(recortarAncho(f.da, fd, Math.max(40, Math.min(L.cDa, anchoDa)), true))}</text>`);
  p.push(`<text x="${xDerecha}" y="${base}" font-size="${F}" font-weight="700" text-anchor="end" fill="${Number(f.res) < 0 ? ROJO : VERDE}">${signo(f.res)}</text>`);
}

// Tabla repartida en columnas (como pimgTabla). Devuelve la altura.
function tabla(p, x0, y0, ancho, filas, L, sinCab) {
  const n = Math.ceil(filas.length / L.cols);
  const cw = ancho / L.cols;
  const cabH = sinCab ? 0 : 34;
  const F = Math.round(L.fs * ESCALA_LETRA);
  let k = 0;
  for (let c = 0; c < L.cols; c++) {
    const trozo = filas.slice(c * n, (c + 1) * n);
    if (!trozo.length) continue;
    const x = x0 + c * cw;
    if (!sinCab) {
      p.push(`<rect x="${x}" y="${y0}" width="${cw}" height="${cabH}" fill="TINTE"/>`);
      const [xCli, xMod, , xMonto, xDa] = posicionesTabla(x, cw, L);
      const fh = 13;
      const t = (tx, txt, anchor) => p.push(`<text x="${tx}" y="${y0 + 22}" font-size="${fh}" font-weight="700" letter-spacing="1" ${anchor ? `text-anchor="${anchor}"` : ''} fill="${GRIS}">${txt}</text>`);
      t(xCli, 'JUEGA'); t(xMod, 'JUGÓ'); t(L.resultadosPorNombre ? xDa - 9 : xMonto + L.cMonto, 'APOSTÓ', 'end');
      t(xDa + (L.resultadosPorNombre ? 6 : 14), 'DA');
      if (!L.resultadosPorNombre) t(x + cw - 14, 'RESULTADO', 'end');
    }
    trozo.forEach((f, i) => filaJugada(p, x, y0 + cabH + i * L.rowh, cw, L, f));
    if (c > 0) p.push(`<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + cabH + trozo.length * L.rowh}" stroke="LINEA" stroke-width="2"/>`);
    k = Math.max(k, trozo.length);
  }
  void F;
  return cabH + k * L.rowh;
}

// Resumen "GANAN" / "PIERDEN": tarjeta con título de color y renglones numerados. Devuelve la altura.
function tarjetaResumen(p, x, y, ancho, items, titulo, color, L) {
  const nc = Math.max(1, Math.ceil(items.length / L.perCol));
  const porCol = Math.ceil(items.length / nc);
  const cw = ancho / nc;
  const F = Math.round(L.flfs * ESCALA_LETRA);
  p.push(`<rect x="${x}" y="${y}" width="${ancho}" height="${38 + porCol * L.fl}" rx="12" fill="#ffffff" stroke="LINEA"/>`);
  p.push(`<path d="M${x} ${y + 38} V${y + 12} a12 12 0 0 1 12 -12 H${x + ancho - 12} a12 12 0 0 1 12 12 V${y + 38} Z" fill="${color}"/>`);
  p.push(`<text x="${x + 16}" y="${y + 26}" font-size="18" font-weight="700" letter-spacing="2" fill="#ffffff">${titulo}</text>`);
  for (let c = 0; c < nc; c++) {
    const cx = x + c * cw;
    const trozo = items.slice(c * porCol, (c + 1) * porCol);
    if (c > 0) p.push(`<line x1="${cx}" x2="${cx}" y1="${y + 38}" y2="${y + 38 + trozo.length * L.fl}" stroke="LINEA" stroke-width="2"/>`);
    trozo.forEach(([nombre, v], i) => {
      const ry = y + 38 + i * L.fl;
      const cy = ry + L.fl / 2;
      p.push(`<line x1="${cx}" x2="${cx + cw}" y1="${ry}" y2="${ry}" stroke="LINEA"/>`);
      p.push(`<circle cx="${cx + 25}" cy="${cy}" r="13" fill="TINTE"/>`);
      p.push(`<text x="${cx + 25}" y="${cy + 5}" font-size="14" font-weight="700" text-anchor="middle" fill="${GRIS}">${c * porCol + i + 1}</text>`);
      const anchoNum = anchoAprox(signo(v), F, true);
      p.push(`<text x="${cx + 46}" y="${cy + F * 0.36}" font-size="${F}" font-weight="700" fill="${TINTA}">${esc(recortarAncho(nombre, F, cw - 46 - 12 - anchoNum - 8, true))}</text>`);
      p.push(`<text x="${cx + cw - 12}" y="${cy + F * 0.36}" font-size="${F}" font-weight="700" text-anchor="end" fill="${color}">${signo(v)}</text>`);
    });
  }
  return 38 + porCol * L.fl;
}

// ---------------------------------------------------------------
// SVG de la tarjeta completa. `datos` = datosImagen del plano (hipismoPlanoImagen.js).
// opciones: { estilo: {primario, secundario, logoDataUri}, nacional, logoHipodromo (data URI o null) }
// ---------------------------------------------------------------
function armarSvgPlano(datos, opciones) {
  const op = opciones || {};
  const estilo = op.estilo || {};
  const t = temaDe(estilo.primario, estilo.secundario);
  const adel = datos.adelantadas && datos.adelantadas.filas && datos.adelantadas.filas.length ? datos.adelantadas.filas : [];
  const cantidad = (datos.jugadas || []).length + adel.length;
  const L = nivelDe(cantidad);
  const W = L.w;
  const M = 32; // margen lateral
  const p = [];
  let y = 0;

  // ---- encabezado ----
  const titulo = [datos.hipodromo, datos.carreraTexto ? datos.carreraTexto + ' carrera' : ''].filter(Boolean).join(' · ') || 'Plano';
  const fecha = fechaLarga(datos.fecha);
  const grupoTxt = String(datos.grupo || '').toUpperCase();
  const HH = 143;
  const logoH = op.nacional ? op.logoHipodromo : op.logoHipodromo; // el logo del hipódromo se pone si existe en el catálogo (nacionales incluidos, como en el panel)
  const placaW = logoH ? 235 + 32 : 0;
  const maxTxt = W - M * 2 - (logoH ? placaW + 28 : 0);
  const ft = Math.max(24, Math.min(op.nacional ? 38 : 42, Math.floor((maxTxt - (op.nacional ? 56 : 0)) / (Math.max(titulo.length, 1) * 0.6))));
  if (op.nacional) {
    p.push(`<rect x="0" y="0" width="${W}" height="${HH / 3}" fill="#fcd116"/><rect x="0" y="${HH / 3}" width="${W}" height="${HH / 3}" fill="#00247d"/><rect x="0" y="${2 * HH / 3}" width="${W}" height="${HH - 2 * HH / 3}" fill="#cf142b"/>`);
    if (!logoH) {
      const ancho = 330, n = 8, alto = 16, x0 = W - 40 - ancho;
      for (let i = 0; i < n; i++) {
        const tt = (i - (n - 1) / 2) / ((n - 1) / 2);
        p.push(estrella(x0 + 17 + i * (ancho - 34) / (n - 1), HH / 2 + alto * tt * tt - alto / 2 + 4, 15));
      }
    }
    const pw = Math.min(maxTxt, Math.max(anchoAprox(titulo, ft, true), anchoAprox(grupoTxt, 20, true) + 40, 260) + 56);
    p.push(`<rect x="${M}" y="20" width="${pw}" height="${HH - 40}" rx="16" fill="#ffffff" fill-opacity="0.96"/>`);
    p.push(`<text x="${M + 28}" y="46" font-size="19" font-weight="700" letter-spacing="3.5" fill="#cf142b">${esc(recortarAncho(grupoTxt, 19, pw - 56, true))}</text>`);
    p.push(`<text x="${M + 28}" y="88" font-size="${ft}" font-weight="700" fill="#0b1b3f">${esc(recortarAncho(titulo, ft, pw - 56, true))}</text>`);
    p.push(`<text x="${M + 28}" y="${HH - 24}" font-size="20" font-weight="500" fill="#4a5568">${esc(fecha)}</text>`);
    p.push(`<rect x="0" y="${HH}" width="${W}" height="5" fill="#0b1b3f"/>`);
  } else {
    p.push(`<rect x="0" y="0" width="${W}" height="${HH}" fill="${t.c1}"/><rect x="0" y="${HH}" width="${W}" height="5" fill="${t.c2}"/>`);
    p.push(`<text x="${M}" y="42" font-size="19" font-weight="700" letter-spacing="3.5" fill="${t.acc}">${esc(recortarAncho(grupoTxt, 19, maxTxt, true))}</text>`);
    p.push(`<text x="${M}" y="${42 + ft + 6}" font-size="${ft}" font-weight="700" fill="${t.fg}">${esc(recortarAncho(titulo, ft, maxTxt, true))}</text>`);
    p.push(`<text x="${M}" y="${HH - 16}" font-size="20" font-weight="500" fill="${t.fg}" fill-opacity="0.85">${esc(fecha)}</text>`);
  }
  if (logoH) {
    const px = W - M - placaW, py = (HH - 104) / 2;
    p.push(`<rect x="${px}" y="${py}" width="${placaW}" height="104" rx="14" fill="#ffffff"/>`);
    p.push(`<image href="${logoH}" x="${px + 16}" y="${py + 8}" width="235" height="88" preserveAspectRatio="xMidYMid meet"/>`);
  }
  y = HH + 5;

  // ---- llegada ----
  const LH = 100;
  p.push(`<rect x="0" y="${y}" width="${W}" height="${LH}" fill="#ffffff"/><line x1="0" x2="${W}" y1="${y + LH}" y2="${y + LH}" stroke="LINEA"/>`);
  p.push(`<text x="${M}" y="${y + 12 + 28 + 7}" font-size="17" font-weight="700" letter-spacing="2" fill="${GRIS}">LLEGADA</text>`);
  (datos.llegada || []).forEach((n, i) => {
    const cx = M + 120 + 28 + i * 66;
    silk(p, cx, y + 12 + 28, 56, n);
    p.push(`<text x="${cx}" y="${y + 12 + 56 + 17}" font-size="15" font-weight="700" text-anchor="middle" fill="${GRIS}">${i + 1}º</text>`);
  });
  if ((datos.retirados || []).length) {
    let rx = W - M;
    const cy = y + LH / 2;
    [...datos.retirados].reverse().forEach(n => { silk(p, rx - 20, cy, 40, n); rx -= 48; });
    p.push(`<text x="${rx - 4}" y="${cy + 7}" font-size="19" font-weight="700" text-anchor="end" fill="${ROJO}">RETIRADO</text>`);
  }
  y += LH + 14;

  // ---- jugadas ----
  const cardW = W - M * 2;
  let idClip = 0;
  const tarjeta = (alto, dibujar, marca) => {
    const id = 'c' + (idClip++);
    p.push(`<clipPath id="${id}"><rect x="${M}" y="${y}" width="${cardW}" height="${alto}" rx="14"/></clipPath>`);
    p.push(`<rect x="${M}" y="${y}" width="${cardW}" height="${alto}" rx="14" fill="#ffffff" stroke="LINEA"/>`);
    p.push(`<g clip-path="url(#${id})">`);
    if (marca && estilo.logoDataUri) {
      const bw = Math.min(380, cardW), bh = alto * 0.8;
      p.push(`<image href="${estilo.logoDataUri}" x="${M + (cardW - bw) / 2}" y="${y + (alto - bh) / 2}" width="${bw}" height="${bh}" preserveAspectRatio="xMidYMid meet" opacity="0.12"/>`);
    }
    dibujar();
    p.push('</g>');
  };
  const nFilas = n => Math.ceil(n / L.cols);
  const filasJ = (datos.jugadas || []).map(j => ({
    cliente: j.cliente, mod: j.modalidad, cab: j.caballo, monto: j.monto,
    da: j.banquero, res: j.resultado, resDa: j.resultadoDa
  }));
  if (filasJ.length) {
    const alto = 34 + nFilas(filasJ.length) * L.rowh;
    tarjeta(alto, () => tabla(p, M, y, cardW, filasJ, { ...L, resultadosPorNombre: true }, false), true);
    y += alto;
  }
  if (adel.length) {
    y += filasJ.length ? 4 : 0;
    const secciones = (datos.adelantadas.secciones && datos.adelantadas.secciones.length) ? datos.adelantadas.secciones : [{ titulo: '', filas: adel }];
    const SEC = 32, SEC2 = 30;
    const alto = SEC + secciones.reduce((a, s) => a + (s.titulo ? SEC2 : 0) + nFilas(s.filas.length) * L.rowh, 0);
    tarjeta(alto, () => {
      let yy = y;
      p.push(`<rect x="${M}" y="${yy}" width="${cardW}" height="${SEC}" fill="${t.c1}"/>`);
      p.push(`<text x="${M + 16}" y="${yy + 22}" font-size="16" font-weight="700" letter-spacing="2.5" fill="${t.acc}">PARADA ADELANTADAS</text>`);
      yy += SEC;
      secciones.forEach(sec => {
        if (sec.titulo) {
          p.push(`<rect x="${M}" y="${yy}" width="${cardW}" height="${SEC2}" fill="TINTE"/><line x1="${M}" x2="${M + cardW}" y1="${yy}" y2="${yy}" stroke="LINEA"/>`);
          p.push(`<text x="${M + 16}" y="${yy + 21}" font-size="15" font-weight="700" letter-spacing="1.5" fill="${TINTA}">${esc(sec.titulo)}</text>`);
          yy += SEC2;
        }
        const fa = sec.filas.map(f => ({ cliente: f.cliente, mod: '', cab: '', monto: '', da: f.item, res: f.resultado }));
        yy += tabla(p, M, yy, cardW, fa, L, true);
      });
    }, !filasJ.length);
    y += alto;
  }
  y += 10;

  // ---- ganan / pierden ----
  const ganan = datos.ganan || [], pierden = datos.pierden || [];
  const ncG = ganan.length ? Math.max(1, Math.ceil(ganan.length / L.perCol)) : 0;
  const ncP = pierden.length ? Math.max(1, Math.ceil(pierden.length / L.perCol)) : 0;
  if (ncG + ncP) {
    p.push(`<text x="${W / 2}" y="${y + 24}" font-size="23" font-weight="700" text-anchor="middle" fill="${TINTA}">TOTALES DE LA CARRERA</text>`);
    y += 40;
    const GAP = 14;
    const util = cardW - (ncG && ncP ? GAP : 0);
    let xx = M, hMax = 0;
    if (ncG) { const w = util * ncG / (ncG + ncP); hMax = Math.max(hMax, tarjetaResumen(p, xx, y, w, ganan, 'GANAN', VERDE, L)); xx += w + GAP; }
    if (ncP) { const w = util * ncP / (ncG + ncP); hMax = Math.max(hMax, tarjetaResumen(p, xx, y, w, pierden, 'PIERDEN', ROJO, L)); }
    y += hMax;
  }
  y += 18;

  // ---- pie ----
  const total = (datos.jugadas || []).length + adel.length;
  p.push(`<text x="${M}" y="${y + 17}" font-size="17" fill="${GRIS}">Tilde su jugada y se revisará</text>`);
  p.push(`<text x="${W - M}" y="${y + 17}" font-size="17" text-anchor="end" fill="${GRIS}">${total} jugada${total === 1 ? '' : 's'} · Reclamos al privado</text>`);
  y += 40;

  const cuerpo = p.join('').replace(/LINEA/g, t.line).replace(/TINTE/g, t.tint);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="Poppins"><rect width="${W}" height="${y}" fill="${t.bg}"/>${cuerpo}</svg>`;
}

// Punto de entrada: PNG (Buffer) de la tarjeta, o null si no se pudo dibujar. Nunca lanza: el texto del plano ya salió.
async function generarImagenPlano({ grupoId, datos }) {
  try {
    if (!datos) return null;
    const estilo = await cargarEstiloGrupo(grupoId);
    const nacional = await esNacional(grupoId, datos.hipodromo);
    const svg = armarSvgPlano(datos, { estilo, nacional, logoHipodromo: logoHipodromoDataUri(datos.hipodromo) });
    return svgAPng(svg);
  } catch (e) {
    console.error('[hipismoPlanoImagenServidor] No se pudo dibujar el plano (grupo ' + grupoId + '):', e.message);
    return null;
  }
}

module.exports = { armarSvgPlano, generarImagenPlano, nivelDe, temaDe, archivoLogoHipodromo, esNacional, monto, signo };
