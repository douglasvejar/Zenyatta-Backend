// =================================================================
// PROXY DE LOGOS DE EQUIPOS (03-09-2026, corrigiendo un bug reportado
// por el usuario: "al darle click en generar imagen, la imagen que me
// genera para enviar no aparecen los logos de los equipos").
//
// Los escudos salen de mlbstatic.com (MLB) y a.espncdn.com (NFL/NHL/
// NBA/fútbol) — ver logoEquipoHTML() en public/app.js. Esos CDN no
// habilitan CORS para que un navegador les "lea los píxeles" desde otro
// origen: en pantalla el <img> se ve perfecto igual (mostrar una imagen
// nunca necesitó CORS), pero html2canvas SÍ necesita poder leer el
// contenido de cada imagen para volver a dibujarla adentro del canvas
// que arma la foto/el PDF — sin CORS, el navegador considera esa parte
// del canvas "contaminada" y html2canvas la deja en blanco, SIN tirar
// ningún error visible (por eso el bug era silencioso: el logo se veía
// bien en la pantalla normal, pero desaparecía justo en la imagen
// generada).
//
// La solución es pedir el logo desde ESTE MISMO servidor (mismo origen
// que la página → cero problema de CORS) en vez de directo al CDN
// externo: este endpoint hace de intermediario, pide la imagen real del
// lado del servidor (ahí no existe ninguna restricción de navegador) y
// se la devuelve al navegador como si fuera un archivo propio.
//
// Sin login a propósito (como GET /api/salud): son solo escudos
// PÚBLICOS de equipos, de un puñado de dominios fijos permitidos —
// nunca pasa ningún dato de ningún grupo por acá — así que no hace
// falta pedir token, y un <img src="..."> plano (que no puede mandar
// cabeceras Authorization) lo puede usar directo. El whitelist de
// dominios + exigir https es lo que evita que esto se use como un
// proxy genérico para cualquier URL.
// =================================================================
const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

const DOMINIOS_PERMITIDOS = ['www.mlbstatic.com', 'a.espncdn.com'];

router.get('/logo', asyncHandler(async (req, res) => {
  const urlStr = req.query.url;
  if (!urlStr) return res.status(400).json({ error: 'Falta el parámetro url.' });

  let url;
  try {
    url = new URL(urlStr);
  } catch (e) {
    return res.status(400).json({ error: 'URL inválida.' });
  }

  if (url.protocol !== 'https:' || !DOMINIOS_PERMITIDOS.includes(url.hostname)) {
    return res.status(400).json({ error: 'Dominio de imagen no permitido.' });
  }

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) return res.status(502).end();

    const tipo = resp.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await resp.arrayBuffer());

    res.set('Content-Type', tipo);
    // El escudo de un equipo no cambia nunca — cachear fuerte del lado
    // del navegador ahorra volver a pedirlo cada vez que se abre la
    // pestaña Sábanas o se genera una imagen/PDF.
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(buffer);
  } catch (e) {
    res.status(502).json({ error: 'No se pudo obtener la imagen.' });
  }
}));

// =================================================================
// PROXY DEL LOGO DE UN GRUPO (21-09-2026, misma necesidad de arriba pero
// para la pestaña nueva "⬇️ Descargar" > "📅 Saldos Semana": el header de
// la imagen/PDF que se genera lleva el logo del propio grupo, y ese logo
// es una URL EXTERNA cualquiera que puso el Súper-admin (grupos.logo_url,
// ver PATCH /api/superadmin/grupos/:id/logo) — no un puñado fijo de CDN
// de equipos, así que no alcanza con el whitelist de dominios de arriba.
//
// A diferencia de /logo (que recibe la URL directo por query string —
// solo sirve porque el whitelist de dominios evita que se use como proxy
// genérico), acá NUNCA se acepta una URL desde el cliente: se recibe
// nada más que un :grupoId y ESTE SERVIDOR busca en su propia base cuál
// es el logo_url guardado para ese grupo — así no hay ningún riesgo de
// SSRF (el navegador no puede pedir "de intermediario" ninguna URL que
// no haya puesto ya el propio Súper-admin).
//
// Sin login a propósito, mismo criterio que /logo y que
// GET /api/cliente/:token (el link del cliente YA muestra este mismo
// logo sin pedir ninguna sesión) — no es información nueva ni sensible
// de ningún grupo, es literalmente la misma imagen que cualquiera con el
// link de un cliente de ese grupo ya puede ver.
// =================================================================
router.get('/logo-grupo/:grupoId', asyncHandler(async (req, res) => {
  const r = await db.query('SELECT logo_url FROM grupos WHERE id = $1', [req.params.grupoId]);
  const logoUrl = r.rows[0] && r.rows[0].logo_url;
  if (!logoUrl) return res.status(404).end();

  let url;
  try {
    url = new URL(logoUrl);
  } catch (e) {
    return res.status(404).end();
  }
  if (url.protocol !== 'https:') return res.status(404).end();

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) return res.status(502).end();

    const tipo = resp.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await resp.arrayBuffer());

    res.set('Content-Type', tipo);
    // A diferencia del escudo de un equipo (que nunca cambia), el
    // Súper-admin puede actualizar el logo de un grupo — cache corto
    // (5 min) en vez de "immutable", para que un cambio de logo se vea
    // reflejado sin que el usuario tenga que limpiar caché a mano.
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buffer);
  } catch (e) {
    res.status(502).json({ error: 'No se pudo obtener el logo.' });
  }
}));

module.exports = router;
