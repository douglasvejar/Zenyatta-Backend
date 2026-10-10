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
// PROXY/SERVIDOR DEL LOGO DE UN GRUPO (21-09-2026, para la pestaña
// "⬇️ Descargar" > "📅 Saldos Semana": el header de la imagen/PDF que se
// genera lleva el logo del propio grupo). Sin login a propósito, mismo
// criterio que /logo y que GET /api/cliente/:token (el link del cliente
// YA muestra este mismo logo sin pedir ninguna sesión) — no es
// información nueva ni sensible de ningún grupo, es literalmente la
// misma imagen que cualquiera con el link de un cliente de ese grupo ya
// puede ver.
//
// REVISADO 29-09-2026, a pedido del usuario: "quiero subir el logo del
// grupo, no por url si no cargar la imagen del grupo desde super admin" —
// ahora el logo casi siempre es un ARCHIVO subido, guardado como base64
// en grupos.logo_base64/logo_mime (ver la nota grande junto a esas
// columnas en sql/schema.sql, y PATCH /api/superadmin/grupos/:id/logo).
// Este endpoint sirve ESE archivo directo cuando existe — ya no hace
// falta ningún fetch a un servidor externo para el caso normal. Si el
// grupo NO tiene un archivo subido (nunca lo actualizó desde antes de
// este cambio) cae al comportamiento legacy: proxyar la logo_url externa
// que tenía pegada, exactamente como funcionaba hasta ahora — así un
// grupo viejo no se queda de repente sin logo por no haber vuelto a
// subirlo.
// 10-10-2026 (aviso de Supabase "Egress Exceeded"): antes este endpoint
// bajaba el logo COMPLETO (base64, varios MB) desde Postgres en cada
// pedido, y el navegador lo repetía cada 5 min por cada pantalla abierta.
// Ahora (a) el logo ya decodificado se guarda en memoria del servidor
// junto con su huella (md5, calculada por Postgres: sale solo ~32 bytes);
// (b) la respuesta lleva ETag, así que si el navegador ya lo tiene
// contesta 304 sin mandar la imagen; (c) cada 5 min el navegador solo revalida (304). Si el Súper-admin sube otro logo, la huella cambia y se vuelve
// a bajar una sola vez.
const LOGOS_EN_MEMORIA = new Map(); // grupoId -> { etag, mime, buffer }
const LOGOS_TOPE = 200;

function recordarLogo(grupoId, entrada) {
  if (LOGOS_EN_MEMORIA.size >= LOGOS_TOPE) LOGOS_EN_MEMORIA.delete(LOGOS_EN_MEMORIA.keys().next().value);
  LOGOS_EN_MEMORIA.set(grupoId, entrada);
}

router.get('/logo-grupo/:grupoId', asyncHandler(async (req, res) => {
  const id = req.params.grupoId;
  // Solo metadatos + huella: el base64 NO se trae si no hace falta.
  const r = await db.query(
    'SELECT logo_url, logo_mime, (logo_base64 IS NOT NULL) AS tiene_archivo, md5(logo_base64) AS huella FROM grupos WHERE id = $1',
    [id]
  );
  const fila = r.rows[0];
  if (!fila) return res.status(404).end();

  if (fila.tiene_archivo) {
    const etag = '"' + fila.huella + '"';
    res.set('Cache-Control', 'public, max-age=300'); // 5 min como siempre; con ETag la revalidación es un 304 sin imagen
    res.set('ETag', etag);
    if (((req.headers || {})['if-none-match']) === etag) return res.status(304).end();

    let entrada = LOGOS_EN_MEMORIA.get(id);
    if (!entrada || entrada.etag !== etag) {
      const rb = await db.query('SELECT logo_base64 FROM grupos WHERE id = $1', [id]);
      if (!rb.rows[0] || !rb.rows[0].logo_base64) return res.status(404).end();
      entrada = { etag, mime: fila.logo_mime || 'image/png', buffer: Buffer.from(rb.rows[0].logo_base64, 'base64') };
      recordarLogo(id, entrada);
    }
    res.set('Content-Type', entrada.mime);
    return res.send(entrada.buffer);
  }

  // --- Legacy: logo_url externa pegada antes del 29-09-2026 ---
  // A diferencia de /logo (que recibe la URL directo por query string —
  // solo sirve porque el whitelist de dominios de arriba evita que se use
  // como proxy genérico), acá NUNCA se acepta una URL desde el cliente:
  // se recibe nada más que un :grupoId y ESTE SERVIDOR busca en su propia
  // base cuál es la logo_url guardada para ese grupo — así no hay ningún
  // riesgo de SSRF (el navegador no puede pedir "de intermediario"
  // ninguna URL que no haya puesto ya el propio Súper-admin, tiempo
  // atrás).
  const logoUrl = fila.logo_url;
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
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buffer);
  } catch (e) {
    res.status(502).json({ error: 'No se pudo obtener el logo.' });
  }
}));

module.exports = router;
