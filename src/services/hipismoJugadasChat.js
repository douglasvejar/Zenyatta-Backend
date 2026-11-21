// =================================================================
// BOT DE JUGADAS DEL CHAT — HIPISMO GRUPOS (17-11-2026, a pedido del usuario: "los planos los hace una persona
// a través de su teléfono, confirmando cada jugada... me gustaría tener un bot que haga todo eso").
//
// Motor PURO (sin base de datos ni WhatsApp: todo lo externo entra por `deps`), así se prueba con los mensajes reales
// del video del grupo "AMERICANAS DREAM". Lo que hacía Dreamy y ahora hace el bot:
//
//   1) Un jugador OFRECE una jugada con texto libre:
//        "Juego 4x1 con 75 doy a8"          -> quien publica JUEGA; el que responda "da" (banquero), cuota 10a8
//        "Juego 4x5 recibo a 8 200"         -> quien publica "recibe": el que responda JUEGA 5x4 a 8, y quien publicó "da"
//        "Juego 2y2 y 2p del 5 con 40"      -> combo de 2 modalidades del caballo 5
//        "Juego 4x1 10@8 con 60", "Juego 4 x 1 10a8 con 120", "Juego 1x4 recibo a7 con 30"...
//   2) Otros le RESPONDEN (reply) a ese mensaje con un monto ("200"), con "J"/"jugo" (toma todo lo que queda) o "Sf".
//        - Un monto: juegan ESE monto (nunca más de lo que queda de la oferta).
//        - "J": juegan lo que quede. Si queda menos, solo juegan lo que quede.
//        - Si ya no queda nada: "❌ Nada, ya topada".
//        - Si el mismo jugador quiere más, publica OTRO mensaje: es una jugada nueva.
//   3) CONTROL DE POZO (los dos lados, solo para clientes con pozo): el que juega arriesga el monto completo; el que
//      "da" arriesga monto x N/10 (en 10aN) o el monto completo (en el resto). Si el disponible no alcanza se avisa
//      "solo tienes X disponible, coloca la parada por ese monto o menos" y NO se registra nada.
//   4) Cada jugada confirmada se guarda (deps.guardarJugada -> Jugadas entre Tercios Adelantadas: quedan pendientes y se
//      resuelven solas cuando se carga la pizarra) y se responde "✅ Aquí jugaron" citando el mensaje.
//   5) El PLANO de la carrera ("Juega X 10A8 (4x1) con 22,00 da Y" + "Total jugadas") sale: cada 4 jugadas nuevas, cuando
//      un administrador escribe "plano"/"planos", y como plano FINAL (sin pizarra) cuando un administrador cierra la carrera.
//   6) El administrador abre una carrera escribiendo "Mountaineer 1ra carrera" y la cierra con "cierra".
// =================================================================
const calc = require('./hipismoTerciosAdelantadasCalc');
const { RANK_NO_COLOCO, decimosN, ordinalCarrera, formatNombre } = require('./hipismoCalc');

const quitarTildes = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmt = n => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const limpiar = t => quitarTildes(String(t || '').replace(/[*_~]/g, '')).replace(/\s+/g, ' ').trim();

// "9.50" -> 9,5 (punto + 1 o 2 decimales); "1.000" -> 1000 (miles); "13,00" -> 13.
function parseMontoChat(txt) {
  let s = String(txt).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
const montoParaLinea = n => fmt(n).replace(/\./g, ''); // "1.250,00" -> "1250,00" (el parser de líneas usa coma decimal)

// ---------------------------------------------------------------
// Texto de la apuesta (para el plano)
// ---------------------------------------------------------------
function modalidadVisible(mod) {
  if (!mod) return '';
  return String(mod).split('-').map(m => {
    const mm = m.match(/^(\d{1,2})y(\d{1,2})n?$/i) || m.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (mm) return mm[1] + 'Y' + mm[2] + 'N';
    return m.toUpperCase();
  }).join(' Y ');
}
const modalidadSegura = mod => (mod ? String(mod).split('-').map(m => { // para guardar: sin "Y" suelta (el parser no la entiende)
  const mm = m.match(/^(\d{1,2})y(\d{1,2})n?$/i) || m.match(/^(\d{1,2})\/(\d{1,2})$/);
  return mm ? mm[1] + 'Y' + mm[2] + 'N' : m.toUpperCase();
}).join(' ') : '');
const caballosTxt = lista => (lista || []).join('.');
function apuestaVisible(a) {
  const cab = a.cruce ? caballosTxt(a.cruce.gruposA) + 'x' + caballosTxt(a.cruce.gruposB) : caballosTxt(a.grupo);
  const mod = modalidadVisible(a.modalidad);
  return (mod ? mod + ' ' : '') + '(' + cab + ')';
}
function apuestaSegura(a) {
  const cab = a.cruce ? caballosTxt(a.cruce.gruposA) + 'x' + caballosTxt(a.cruce.gruposB) : caballosTxt(a.grupo);
  const mod = modalidadSegura(a.modalidad);
  return (mod ? mod + ' ' : '') + '(' + cab + ')';
}

// ---------------------------------------------------------------
// interpretarOferta(texto) -> null (no es una oferta) | { ok:false, motivo } | { ok:true, lado, monto, apuesta, cuota }
// apuesta = { cruce:{gruposA,gruposB}|null, grupo:[..]|null, modalidad:'10a8'|null }
// ---------------------------------------------------------------
// monto: "75", "9.50", "13,00", "1.250,50"
const MONTO_SRC = '\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?';
const VERBO_OFERTA_RE = /^(?:juego|juega|jugar|jugando|jugamos|consigo|consigue)\b\s*/i;
function interpretarOfertaBase(texto) {
  let t = limpiar(texto);
  if (!VERBO_OFERTA_RE.test(t)) return null;
  // "Consigo 3n del 1 200": el que publica quiere BANQUEAR (da la jugada); "Juego ...": el que publica quiere JUGAR.
  const banquea = /^consig/i.test(t);
  t = t.replace(VERBO_OFERTA_RE, '');

  let lado = 'doy';
  let cuota = null;
  let monto = null;
  let conRecibo = false;
  let montoSuelto = false;
  const mC = t.match(/\b(doy|recibo|recibe|damos)\s*(?:a|@)?\s*(\d+(?:[.,]\d+)?)(?![\d])/i);
  if (mC) {
    lado = /^rec/i.test(mC[1]) ? 'recibo' : 'doy';
    cuota = mC[2].replace(',', '.');
    conRecibo = true;
    t = t.replace(mC[0], ' ');
  }
  const mM = t.match(new RegExp('\\bcon\\s+(' + MONTO_SRC + ')(?![\\d.,])', 'i'));
  if (mM) {
    monto = parseMontoChat(mM[1]);
    t = t.replace(mM[0], ' ');
  } else {
    // "Juego 4x5 recibo a 8 200" o "Juego 3n del 5 400": el monto va solo, al final. (No se toma un número pegado a una "x": "4 x 1".)
    const mFinal = t.match(new RegExp('(?<![x×]\\s*)(?:^|\\s)(' + MONTO_SRC + ')\\s*$', 'i'));
    if (mFinal) { monto = parseMontoChat(mFinal[1]); t = t.replace(mFinal[0], ' '); montoSuelto = true; }
  }
  if (monto === null || !(monto > 0)) return { ok: false, motivo: 'falta el monto' };
  if (banquea) lado = 'recibo';

  t = t.replace(/(\d)\s*x\s*(\d)/gi, '$1x$2').trim();
  let tokens = t.split(/\s+/).filter(Boolean);
  // "2y2 y 2p": la "y" suelta entre dos modalidades solo une el combo.
  tokens = tokens.filter((tok, i) => !(/^(?:y|\+|&)$/i.test(tok) && i > 0 && i < tokens.length - 1 && calc.tokenEsModalidadValida(tokens[i - 1]) && calc.tokenEsModalidadValida(tokens[i + 1])));
  const espec = tokens.join(' ');
  const yaTieneDecimos = tokens.some(tok => decimosN(tok.replace(/@/g, 'a')) !== null);
  const especFinal = (cuota !== null && !yaTieneDecimos) ? (espec + ' 10a' + cuota).trim() : espec;

  const prueba = calc.parsearLineaTerciosAdelantada('JUG ' + especFinal + ' con ' + montoParaLinea(monto) + ' da BAN');
  // Si el número final se tomó como monto y lo que queda no es una apuesta, lo más probable es que simplemente faltó el monto.
  const fallo = montoSuelto && !conRecibo ? 'falta el monto' : 'no entendí la apuesta';
  if (!prueba.ok || prueba.errores.faltaApuesta) return { ok: false, motivo: fallo };
  if (prueba.jugadorNombre !== 'JUG' || prueba.banqueroNombre !== 'BAN') return { ok: false, motivo: fallo };

  // "10@8" se guarda como "10a8" (misma jugada, una sola forma)
  const apuesta = { cruce: prueba.cruce, grupo: prueba.grupo, modalidad: prueba.modalidad ? String(prueba.modalidad).replace(/@/g, 'a') : prueba.modalidad };
  return { ok: true, lado, monto: round2(monto), apuesta, cuota };
}

// Además del monto al final o con "con" ("Juego 3p del 1 2000", "Juego 3p del 1 con 2000"), se acepta el monto pegado al verbo:
// "Juego 2000 3p del 1" = juega 2000 a 3 puestos del caballo 1. Solo se prueba si la forma normal no se entendió.
function interpretarOferta(texto) {
  const r = interpretarOfertaBase(texto);
  if (r === null || r.ok) return r;
  const m = limpiar(texto).match(new RegExp('^(juego|juega|jugar|jugando|jugamos|consigo|consigue)\\s+(' + MONTO_SRC + ')\\s+(\\S.*)$', 'i'));
  if (m) {
    const r2 = interpretarOfertaBase(m[1] + ' ' + m[3] + ' con ' + m[2]);
    if (r2 && r2.ok) return r2;
  }
  return r;
}

// Quién juega y quién da, y cómo queda la apuesta desde el lado del que JUEGA.
// "doy": publicó el jugador. "recibo": publicó el banquero; el que responde juega y, en un cruce, sus caballos son los de la derecha.
function apuestaDesdeElJugador(oferta) {
  const a = oferta.apuesta;
  if (oferta.lado === 'recibo' && a.cruce) return { ...a, cruce: { gruposA: a.cruce.gruposB, gruposB: a.cruce.gruposA } };
  return a;
}

// ---------------------------------------------------------------
// interpretarRespuesta(texto) -> { tipo:'monto', monto } | { tipo:'todo' } | { tipo:'sf' } | null
// ---------------------------------------------------------------
function interpretarRespuesta(texto) {
  const t = limpiar(texto).toLowerCase();
  if (!t) return null;
  if (/^(?:j|jugo|jugado|jugamos|juego|todo|jugo todo|j todo)$/.test(t)) return { tipo: 'todo' };
  // "Sf" / "Se fue" / "Sefue": el jugador retira TODAS sus jugadas abiertas (ya no las va a jugar)
  // (también las erratas comunes: "sedue", "se due", "se fie", "se fye", "s f")
  if (/^(?:s\.? ?f\.?|se ?[fd][uyi]e(?:ron)?(?: todo| todas| todas las jugadas)?)$/.test(t)) return { tipo: 'sf' };
  const m = t.match(/^(?:j(?:ugo)?\s*)?(?:con\s+)?(\d+(?:[.,]\d+)?)$/);
  if (m) { const n = parseMontoChat(m[1]); if (n !== null && n > 0) return { tipo: 'monto', monto: round2(n) }; }
  // "ponte 200" / "ponte": se pone del lado contrario de quien publicó (neutro, como un monto solo).
  const mP = t.match(/^pon(?:te|ete|me)(?:\s+(?:con\s+)?(\d+(?:[.,]\d+)?))?$/);
  if (mP) {
    if (mP[1] === undefined) return { tipo: 'todo' };
    const n = parseMontoChat(mP[1]);
    if (n !== null && n > 0) return { tipo: 'monto', monto: round2(n) };
  }
  // Con el rol dicho en claro: "jugué 200" (quiere JUGAR) / "doy 200", "consigo 200" (quiere DAR = banquear).
  // Sirve para detectar el error de término: los dos quieren jugar o los dos quieren dar.
  const mR = t.match(/^(jugue|jugamos|juego|jugar|doy|damos|consigo|consigue|banqueo)(?:\s+(?:con\s+)?(\d+(?:[.,]\d+)?))?$/);
  if (mR) {
    const rol = /^(?:jug|juego)/.test(mR[1]) ? 'juega' : 'da';
    if (mR[2] === undefined) return rol === 'juega' && !/^jugue$/.test(mR[1]) ? null : { tipo: 'todo', rol };
    const n = parseMontoChat(mR[2]);
    if (n !== null && n > 0) return { tipo: 'monto', monto: round2(n), rol };
  }
  return null;
}

// Mal término: los dos quieren jugar ("Juego 2p del 8 300" / "jugué 200") o los dos quieren dar ("Consigo 3n del 1 200" / "doy 200").
// oferta.lado 'doy' = el que publicó JUEGA; 'recibo' = el que publicó DA (banquea).
function conflictoDeRol(ladoOferta, resp) {
  if (!resp || !resp.rol) return null;
  if (ladoOferta === 'doy' && resp.rol === 'juega') return '❌ Aquí nada, mal término: ambos juegan.';
  if (ladoOferta === 'recibo' && resp.rol === 'da') return '❌ Aquí nada, error de término: ambos dan.';
  return null;
}

// "jhuego 2p del 8 300", "2p del 8 300", "juegoo 3n del 1 200": parece una parada (tiene apuesta y monto) pero no empieza con un verbo
// válido, así que no se sabe si juega o banquea. Se compara la 1ª palabra con los verbos por parecido.
const VERBOS_PARADA = ['juego', 'juega', 'jugar', 'jugo', 'jugue', 'jugamos', 'jugando', 'consigo', 'consigue', 'doy', 'damos', 'recibo', 'banqueo'];
function distancia(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function primeraPalabraEsVerbo(palabra) {
  const w = palabra.toLowerCase();
  if (!/^[a-z]+$/.test(w)) return false;
  return VERBOS_PARADA.some(v => distancia(w, v) <= 2);
}
function pareceParadaMalEscrita(texto) {
  const t = limpiar(texto);
  if (!t || t.length > 120) return false;
  if (interpretarOferta(t) !== null) return false; // ya es una parada (bien o mal escrita): se trata aparte
  if (interpretarRespuesta(t)) return false;
  const intentos = [t];
  const mP = t.match(/^(\S+)\s+(.+)$/);
  if (mP && primeraPalabraEsVerbo(mP[1])) intentos.push(mP[2]);
  return intentos.some(x => { const o = interpretarOferta('juego ' + x); return !!(o && o.ok); });
}
// Texto que alguien escribe para "tomar" una parada (J, un monto, ok, dale…).
const INTENTO_JUGAR_RE = /^(?:j\w*|pon(?:te|ete|me)\b.*|ok(?:ey)?|dale|listo|va|vamos|si|de una|acepto|tomo|tomado|lo tomo|doy\b.*|consigo\b.*|\d+(?:[.,]\d+)?)$/;
const pareceIntentoDeJugar = texto => INTENTO_JUGAR_RE.test(limpiar(texto).toLowerCase());

// ---------------------------------------------------------------
// RIESGO: lo peor que puede perder cada lado por unidad de monto (fracción del monto). Se calcula con el MISMO motor que
// resuelve la jugada (nunca una fórmula aparte): se prueban todos los llegadas posibles.
//   cruce 10a8 -> jugador arriesga 1 (pierde todo si su caballo no gana); banquero arriesga 0,8.
// ---------------------------------------------------------------
function riesgoPorUnidad(apuesta) {
  const pcts = 0;
  const linea = { monto: 1, cruce: apuesta.cruce, grupo: apuesta.grupo, modalidad: apuesta.modalidad };
  const escenarios = [];
  if (apuesta.cruce) {
    const A = apuesta.cruce.gruposA, B = apuesta.cruce.gruposB;
    escenarios.push(h => (A.includes(h) ? 1 : RANK_NO_COLOCO));
    escenarios.push(h => (B.includes(h) ? 1 : RANK_NO_COLOCO));
  } else {
    const g = apuesta.grupo || [];
    for (let p = 1; p <= 20; p++) escenarios.push(h => (g[0] === h ? p : RANK_NO_COLOCO));
    escenarios.push(() => RANK_NO_COLOCO);
    // varios caballos: el mejor de ellos manda; basta con probar cada uno en cada puesto
    g.forEach(c => { for (let p = 1; p <= 20; p++) escenarios.push(h => (h === c ? p : RANK_NO_COLOCO)); });
  }
  let minJ = 0, minB = 0;
  escenarios.forEach(rank => {
    const r = calc.resolverLineaTerciosAdelantada(linea, rank, pcts);
    if (r && r.resultado) { minJ = Math.min(minJ, r.resultado.j); minB = Math.min(minB, r.resultado.b); }
  });
  return { jugador: Math.max(0.0001, -minJ) || 1, banquero: Math.max(0.0001, -minB) || 1 };
}

// ---------------------------------------------------------------
// Reconocer a un administrador que abre/cierra carrera o pide el plano
// ---------------------------------------------------------------
const CARRERA_RE = /^(.+?)\s+(?:carrera\s+)?(\d{1,2})\s*(?:ra|era|da|ta|va|ma|na|er|do|to|vo|mo|no|a)?\.?\s*(?:carrera)?$/i;
const ORDINALES_CARRERA = { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5, sexta: 6, sexto: 6, septima: 7, septimo: 7, octava: 8, octavo: 8, novena: 9, noveno: 9, decima: 10, decimo: 10, undecima: 11, duodecima: 12 };
// "Abierta primera de Churchill", "Abre la 2da carrera de Mountaineer", "Abierta 3ra en La Rinconada"
const ABRIR_VERBO = '(?:abierta|abierto|abiertas|abre|abren|abran|abrir|abrimos|abrio)';
const ABRIR_PALABRAS_RE = new RegExp('^' + ABRIR_VERBO + '[,:.]?\\s+(?:la\\s+)?(?:carrera\\s+)?(\\S+?)(?:\\s+carrera)?(?:\\s+(?:de|del|en))?\\s+(.+)$', 'i');
// "Abierta gulf 8va", "Abierta gulfstream park 8va carrera": el hipódromo primero y el número al final
const ABRIR_PALABRAS_INVERSO_RE = new RegExp('^' + ABRIR_VERBO + '[,:.]?\\s+(?:la\\s+)?(.+?)\\s+(?:de\\s+la\\s+)?(\\S+?)(?:\\s+carrera)?$', 'i');
const numeroDeOrdinal = tok => {
  const t = String(tok).toLowerCase().replace(/[º°.]/g, '');
  if (ORDINALES_CARRERA[t] !== undefined) return ORDINALES_CARRERA[t];
  const mn = t.match(/^(\d{1,2})(?:ra|era|da|ta|va|ma|na|er|do|to|vo|mo|no|a)?$/);
  return mn ? parseInt(mn[1], 10) : null;
};
// "Abierta primera de Churchill", "Abre la 2da carrera de Mountaineer", "Abierta 3ra en La Rinconada", "Abierta 8va gulf", "Abierta gulf 8va"
function interpretarAbrirCarrera(texto) {
  const t = limpiar(texto);
  const limpiaHip = h => String(h).replace(/\bcarrera\b/ig, '').replace(/[.,;:!]+$/g, '').trim();
  const mp = t.match(ABRIR_PALABRAS_RE);
  if (mp) {
    const n = numeroDeOrdinal(mp[1]);
    const hip = limpiaHip(mp[2]);
    if (n && n >= 1 && n <= 30 && hip) return { hipodromo: hip, carrera: n };
  }
  const mi = t.match(ABRIR_PALABRAS_INVERSO_RE);
  if (mi) {
    const n = numeroDeOrdinal(mi[2]);
    const hip = limpiaHip(mi[1]);
    if (n && n >= 1 && n <= 30 && hip) return { hipodromo: hip, carrera: n };
  }
  if (!/carrera/i.test(t)) return null;
  const m = t.match(CARRERA_RE);
  if (!m) return null;
  const hipodromo = m[1].replace(/\bcarrera\b/ig, '').trim();
  const carrera = parseInt(m[2], 10);
  if (!hipodromo || !(carrera >= 1 && carrera <= 30)) return null;
  return { hipodromo, carrera };
}
const ES_CIERRE_RE = /^(?:cierra|cierre|cerrar|cerrada|cerrado|cierra la carrera|cerrar carrera)$/i;
const ES_PLANO_RE = /^(?:plano|planos)$/i;
// "ERROR" (19-11-2026): un cliente dice que su última jugada tiene un error. El bot le pregunta al otro si se la quita (ver marcarError).
const ES_ERROR_RE = /^(?:(?:hay|un|puse|puso|marca|marco|coloco|coloque|tengo)\s+)*(?:erro(?:r|res)?|errro|errror|eror|erorr)(?:\s+(?:en|de|mi|la|su|esa|esta|jugada|parada|monto|plano))*$/i;
const normRespuesta = t => quitarTildes(String(t || '').toLowerCase()).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const SI_QUITAR_RE = /^(?:si+|dale|ok|okey|listo|claro|afirmativo|de una|quitala|borrala|quitarla|borrarla|se la quito|se la quita|se la borro|se la borra|si se la quito|si se la quita|si se la borro|si quitala|si borrala|si senor|si claro)$/;
const NO_QUITAR_RE = /^(?:no+|nop|nope|nel|negativo|no se la quito|no se la quita|no se la borro|no se la borra|no la quito|no la borro|no senor|no gracias|jugando|que juegue|sigue|siga|dejarla|dejala|que siga|va jugando|vamos jugando)$/;
const ESPERA_LLAMADO_ERROR_MS = 35 * 1000;
const MAX_LLAMADOS_ERROR = 3;
// La pizarra (llegada) la escribe el administrador. Acepta, con cualquier separador (espacio, coma, punto, guion o barra) y los puestos que haga falta:
//   "Pizarra 6.10.4.8.2"            -> la carrera abierta (o la del plano que está respondiendo)
//   "llegada 4,5,6,7", "pizarra 4/5/6/7", "pizarra 4-5-6-7 ret 3"
//   "Pizarra 5ta de gulf 4,5,6,7"   -> esa carrera (también "pizarra gulf 5ta 4 5 6 7" o "pizarra 5ta 4 5 6 7")
// y "Ret 3" suelto para anotar retirados. Devuelve { llegada:'6.10.4.8.2', ret:'3, 7', hipodromo?:'gulf', carrera?:5 }.
const PIZARRA_INICIO_RE = /^(?:pizarra|llegada)\s*[:=-]?\s*(.+)$/i;
const RET_COLA_RE = /\s+(?:ret|retirados?)\s*[:=-]?\s*(\d[\d\s.,\-\/y]*)$/i;
const SOLO_NUMEROS_RE = /^\d[\d\s.,\-\/]*$/;
const PIZARRA_CON_CARRERA_RE = /^(.*[a-záéíóúñ])\s*[:=-]?\s*(\d[\d\s.,\-\/]*)$/i;
const RET_RE = /^(?:ret|retirados?|retirado)\s*[:=-]?\s*(\d[\d\s.,\-\/y]*)$/i;
const numerosDe = t => String(t || '').split(/[^0-9]+/).filter(Boolean).map(n => String(parseInt(n, 10)));
// "5ta de gulf" / "gulf 5ta" / "gulfstream park 5ta carrera" / "5ta" / "carrera 5" -> { hipodromo, carrera }
function carreraDePrefijo(pref) {
  const soloNumero = String(pref).match(/^(?:la\s+)?(?:carrera\s+)?(\S+?)(?:\s+carrera)?$/i);
  if (soloNumero) {
    const n = numeroDeOrdinal(soloNumero[1]);
    if (n && n >= 1 && n <= 30) return { hipodromo: '', carrera: n };
  }
  const r = interpretarAbrirCarrera('abierta ' + pref);
  return r ? { hipodromo: r.hipodromo, carrera: r.carrera } : null;
}
function interpretarPizarra(texto) {
  const mi = limpiar(texto).match(PIZARRA_INICIO_RE);
  if (!mi) return null;
  let resto = mi[1].trim();
  let ret = '';
  const mr = resto.match(RET_COLA_RE);
  if (mr) { ret = numerosDe(mr[1]).join(', '); resto = resto.slice(0, mr.index).trim(); }
  let carrera = null;
  let llegada;
  if (SOLO_NUMEROS_RE.test(resto)) llegada = numerosDe(resto);
  else {
    const mc = resto.match(PIZARRA_CON_CARRERA_RE);
    if (!mc) return null;
    carrera = carreraDePrefijo(mc[1].trim().replace(/[:=\-]+$/, '').trim());
    if (!carrera) return null;
    llegada = numerosDe(mc[2]);
  }
  if (llegada.length < 2) return null;
  const out = { llegada: llegada.join('.'), ret };
  if (carrera) { out.carrera = carrera.carrera; if (carrera.hipodromo) out.hipodromo = carrera.hipodromo; }
  return out;
}
// Del texto de un plano que publicó el bot ("Gulfstream Park, 5ta Carrera" + "Lunes, 5 de Octubre de 2026") saca qué carrera es:
// así el administrador puede responder (citar) ese plano con "pizarra 4 5 6 7".
function carreraDePlanoCitado(texto) {
  if (!texto) return null;
  const t = String(texto);
  const mc = t.match(/^[ \t*_]*(.+?),\s*(\d{1,2})[a-zºª°]*\s+carrera\b/im);
  if (!mc) return null;
  const out = { hipodromo: mc[1].trim(), carrera: parseInt(mc[2], 10), fecha: null };
  const md = t.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i);
  if (md) {
    const mes = MESES.findIndex(x => x.toLowerCase() === md[2].toLowerCase());
    if (mes >= 0) out.fecha = md[3] + '-' + String(mes + 1).padStart(2, '0') + '-' + String(parseInt(md[1], 10)).padStart(2, '0');
  }
  return out;
}
function interpretarRetirados(texto) {
  const m = limpiar(texto).match(RET_RE);
  if (!m) return null;
  const n = numerosDe(m[1]);
  return n.length ? n.join(', ') : null;
}
const ES_AUTORIZAR_RE = /^(?:autorizar|autoriza|dar admin|hacer admin|admin)$/i;

// ---------------------------------------------------------------
// PLANO de la carrera
// ---------------------------------------------------------------
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function fechaLarga(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return DIAS[f.getUTCDay()] + ', ' + d + ' de ' + MESES[m - 1] + ' de ' + a;
}
const ORDINAL_CARRERA = n => (n === 1 ? '1era' : ordinalCarrera(n));
const nombreVisible = n => (String(n).trim().length <= 3 ? String(n).trim().toUpperCase() : formatNombre(n));

function armarPlanoChat({ nombreGrupo, fecha, hipodromo, carrera, jugadas }) {
  const lineas = jugadas.map((j, i) => (i + 1) + ') Juega ' + nombreVisible(j.jugadorNombre) + ' ' + apuestaVisible(j.apuesta) + ' con ' + fmt(j.monto) + ' da ' + nombreVisible(j.banqueroNombre));
  return '*🏇 Sistema ' + nombreGrupo + ' 🏇*\n' + fechaLarga(fecha) + '\n' + hipodromo + ', ' + ORDINAL_CARRERA(carrera) + ' Carrera\nRet:\nPizarra: .....\n\n*TERCIOS*\n' +
    (lineas.length ? lineas.join('\n') : '(todavía no hay jugadas)') + '\n------------------------------\nTotal jugadas: ' + jugadas.length;
}

// ---------------------------------------------------------------
// MOTOR
// deps = {
//   hoy(): 'YYYY-MM-DD'
//   nombreGrupo: string
//   identificar(remitente) -> Promise<string|null>        nombre del cliente en el sistema (por su número)
//   resolverHipodromo(texto) -> Promise<string|null>      nombre exacto del hipódromo del grupo
//   disponible(nombreCliente) -> Promise<{limitado:boolean, disponible:number}>
//   guardarJugada(j) -> Promise<id|void>                     j = { fecha, hipodromo, carrera, jugadorNombre, banqueroNombre, apuesta, monto, riesgoJugador, riesgoBanquero, textoLinea }
//   cargarJugadas({fecha,hipodromo,carrera}) -> Promise<[{jugadorNombre,banqueroNombre,apuesta,monto}]>
//   responder(texto, { citarId, mencionar }) -> Promise<void>
//   publicar(texto) -> Promise<void>                      mensaje suelto al grupo (plano)
// }
// mensaje = { texto, id, citadoId, remitente: { jid, nombre }, esAdmin }
// ---------------------------------------------------------------
const CADA_N_JUGADAS_PLANO = 4;
// Una parada publicada vale como máximo 3 minutos: si responden después, "Aquí nada" (por tiempo).
const VIGENCIA_PARADA_MS = 3 * 60 * 1000;
function crearMotor(deps) {
  const ctx = { hipodromo: null, carrera: null, abierta: false, fecha: null, ret: '' };
  const ofertas = new Map();
  let jugadas = [];
  let sinPlano = 0;
  const avisados = new Map(); // clave -> ms del último aviso (evita repetir el mismo reclamo)
  // Jugadas que el bot guardó en la carrera actual con quién las hizo (para el flujo "ERROR") y casos de error en curso.
  let registros = [];
  const casosError = new Map(); // id de la jugada -> caso
  const adminsVistos = new Map(); // dígitos -> jid con el que escribió un administrador
  const esperaError = () => (Number(deps.esperaErrorMs) > 0 ? Number(deps.esperaErrorMs) : ESPERA_LLAMADO_ERROR_MS);

  const nota = t => { try { if (deps.nota) deps.nota(t); } catch (e) { /* solo informativo */ } };
  const tiempoDe = m => (Number(m.ts) > 0 ? Number(m.ts) : Date.now());
  const puedeAvisar = (clave, ms) => {
    const ahora = Date.now();
    if (avisados.has(clave) && ahora - avisados.get(clave) < ms) return false;
    avisados.set(clave, ahora);
    if (avisados.size > 500) avisados.delete(avisados.keys().next().value);
    return true;
  };
  // Si WhatsApp oculta el teléfono (código interno @lid), el administrador puede asociarlo a mano: responde al mensaje de esa persona con "registrar NOMBRE".
  const pistaRegistro = m => (String((m.remitente && (m.remitente.jidReal || m.remitente.jid)) || '').endsWith('@lid')
    ? '\n(Administrador: WhatsApp oculta su teléfono. Responde a ESTE mensaje con *registrar NOMBRE_DEL_CLIENTE*.)' : '');
  async function registrarNumero(m, nombre) {
    if (!deps.registrarNumero) return;
    if (!m.citadoParticipante) { await deps.responder('⚠️ No sé a quién registrar. Responde (cita) el mensaje de esa persona —o mi aviso "no está registrado" para ella— escribiendo: *registrar NOMBRE_DEL_CLIENTE*', { citarId: m.id }); return; }
    const r = await deps.registrarNumero({ jid: m.citadoParticipante, nombre: nombre.trim() });
    if (r && r.ok) await deps.responder('✅ Listo: ese número quedó registrado como *' + r.nombre + '*. Ya puede jugar.', { citarId: m.id });
    else await deps.responder('⚠️ ' + ((r && r.motivo) || 'No se pudo registrar ese número.'), { citarId: m.id });
  }
  // El administrador escribe la pizarra (llegada): el bot calcula las jugadas de la carrera, las guarda en los saldos y publica el resultado.
  // ¿Qué carrera? 1) la que diga el mensaje ("pizarra 5ta de gulf 4,5,6,7"); 2) la del plano que está respondiendo (citando); 3) la carrera actual.
  async function cargarPizarra(m, datos) {
    if (!deps.cargarPizarra) return;
    const citada = carreraDePlanoCitado(m.citadoTexto);
    const hipPedido = datos.hipodromo || (citada && citada.hipodromo) || ctx.hipodromo || '';
    const carreraN = datos.carrera || (citada && citada.carrera) || ctx.carrera;
    if (!hipPedido || !carreraN) {
      await deps.responder('⚠️ No sé a qué carrera ponerle la pizarra. Responde (cita) el plano de esa carrera escribiendo: *pizarra 4 5 6 7*, o escribe la carrera completa: *pizarra 5ta de gulf 4,5,6,7*', { citarId: m.id });
      return;
    }
    let hip = hipPedido;
    if (hipPedido !== ctx.hipodromo && deps.resolverHipodromo) {
      hip = await deps.resolverHipodromo(hipPedido);
      if (!hip) { await deps.responder('⚠️ No encuentro el hipódromo "' + hipPedido + '" entre los de este grupo. Escríbelo como en tus listas (ej.: Gulfstream Park).', { citarId: m.id }); return; }
    }
    const fecha = (citada && citada.fecha) || ctx.fecha || deps.hoy();
    const esActual = hip === ctx.hipodromo && carreraN === ctx.carrera && fecha === ctx.fecha;
    const cuantas = esActual ? jugadas.length : ((await deps.cargarJugadas({ fecha, hipodromo: hip, carrera: carreraN })) || []).length;
    if (!cuantas) { await deps.responder('⚠️ En *' + hip + ', ' + ORDINAL_CARRERA(carreraN) + ' Carrera* no hay jugadas del bot pendientes para calcular (¿ya se cargó su pizarra, o no hubo jugadas?).', { citarId: m.id }); return; }
    if (esActual && ctx.abierta) { ctx.abierta = false; ofertas.clear(); await guardarEstado(); await cerrarCasosError(); } // la pizarra cierra la carrera
    const ret = datos.ret || (esActual ? ctx.ret : '') || '';
    nota('Pizarra ' + datos.llegada + (ret ? ' con retirados ' + ret : '') + ': calculando ' + hip + ' ' + carreraN);
    const r = await deps.cargarPizarra({ hipodromo: hip, carrera: carreraN, fecha, pizarra: datos.llegada, ret });
    if (!r || !r.ok) { await deps.responder('⚠️ No pude cargar la pizarra: ' + ((r && r.motivo) || 'error desconocido'), { citarId: m.id }); return; }
    if (esActual) { ctx.ret = ''; cancelarCasosError(); registros = []; }
    await deps.responder('🏁 Pizarra cargada: *' + hip + ', ' + ORDINAL_CARRERA(carreraN) + ' Carrera* — llegada ' + datos.llegada + (ret ? ' (Ret: ' + ret + ')' : '') + '. Calculé las jugadas y ya quedaron en los saldos de los clientes:', { citarId: m.id });
    if (deps.publicarResultado) await deps.publicarResultado(r); else await deps.publicar(r.texto);
  }
  async function anotarRetirados(m, ret) {
    if (!ctx.hipodromo) { await deps.responder('⚠️ No hay ninguna carrera abierta para anotar retirados.', { citarId: m.id }); return; }
    ctx.ret = ret;
    await deps.responder('✅ Retirados anotados: ' + ret + '. Cuando tengas la llegada escribe: *Pizarra 6.10.4.8.2*', { citarId: m.id });
  }
  // Un administrador autoriza a otra persona (responde a su mensaje o al aviso "no autorizado" del bot con "autorizar"): desde entonces puede usar los comandos de administración internos del bot.
  async function autorizarAdmin(m) {
    if (!deps.autorizarAdmin) return;
    if (!m.citadoParticipante) { await deps.responder('⚠️ No sé a quién autorizar. Responde (cita) el mensaje de esa persona —o mi aviso "no autorizado" para ella— escribiendo: *autorizar*', { citarId: m.id }); return; }
    const r = await deps.autorizarAdmin({ jid: m.citadoParticipante });
    await deps.responder(r && r.ok ? '✅ Listo: ese número ahora es administrador del bot. Para gestionar carreras debe ser administrador del grupo de WhatsApp.' : '⚠️ ' + ((r && r.motivo) || 'No se pudo autorizar.'), { citarId: m.id });
  }
  async function avisarNoAdmin(m, que, requiereAdminWhatsApp = false) {
    if (!puedeAvisar('no-admin|' + m.remitente.jid, 60000)) { nota('Intentó ' + que + ' pero no es administrador (aviso ya dado hace poco)'); return; }
    const jid = String((m.remitente && (m.remitente.jidReal || m.remitente.jid)) || '');
    const dig = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
    const detalle = requiereAdminWhatsApp
      ? '\nSolo pueden hacerlo los administradores de este grupo de WhatsApp.'
      : jid.endsWith('@lid')
      ? '\n(WhatsApp oculta tu teléfono. Un administrador puede autorizarte respondiendo a este mensaje con *autorizar*.)'
      : '\n(Número que veo: +' + dig + '. Un administrador puede autorizarte respondiendo a este mensaje con *autorizar*, o cargarlo en Súper-admin → Comandos por WhatsApp.)';
    nota('Intentó ' + que + ' pero su número no está autorizado como administrador');
    await deps.responder(etiquetaDe(m) + ' tu número no está autorizado para ' + que + '. Solo un administrador puede hacerlo.' + detalle, { ...mencion(m), registroDe: m.remitente.jid });
  }
  // "@@" marca dónde va la mención al jugador (quien conecta con WhatsApp la cambia por @número; ver hipismoJugadasChatBot.js)
  const mencion = m => ({ citarId: m.id, mencionar: m.remitente.jid, nombre: m.remitente.nombre });
  const etiquetaDe = () => '@@';

  // ---------------- "ERROR": quitar una jugada si el otro involucrado acepta ----------------
  function cancelarCasosError() { casosError.forEach(c => { if (c.timer) clearTimeout(c.timer); }); casosError.clear(); }
  const opError = (c, extra) => ({ citarId: c.citarId, ...extra });
  async function llamarError(c) {
    c.llamados++;
    nota('ERROR de ' + c.marcador.nombre + ': llamado ' + c.llamados + ' a ' + c.otro.nombre);
    await deps.responder('*SALUDOS, AQUÍ EL TERCIO @@ MARCA ERROR, ¿SE LA QUITA?* @@2', opError(c, { mencionar: c.marcador.jid, nombre: c.marcador.etiqueta, mencionar2: c.otro.jid, nombre2: c.otro.etiqueta }));
  }
  function programarLlamado(c) {
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(async () => {
      c.timer = null;
      if (!casosError.has(c.id) || c.estado !== 'preguntando') return;
      try {
        if (!ctx.abierta) { await cerrarCasosError(); return; }
        if (c.llamados < MAX_LLAMADOS_ERROR) { await llamarError(c); programarLlamado(c); return; }
        await escalarAdmins(c);
      } catch (e) { console.error('[hipismoChat] Error en el llamado por "error":', e.message); }
    }, esperaError());
    if (c.timer.unref) c.timer.unref();
  }
  async function escalarAdmins(c) {
    c.estado = 'admins';
    const lista = [];
    const vistos = new Set();
    const agregar = (jid, nombre) => { const d = String(jid || '').split('@')[0].split(':')[0]; if (d && !vistos.has(d)) { vistos.add(d); lista.push({ jid, nombre }); } };
    adminsVistos.forEach(jid => agregar(jid, ''));
    try { ((deps.listarAdmins && await deps.listarAdmins()) || []).forEach(a => agregar(a.jid, a.nombre)); } catch (e) { /* solo se etiqueta a los que se conocen */ }
    nota('ERROR de ' + c.marcador.nombre + ': ' + c.otro.nombre + ' no respondió tras ' + c.llamados + ' llamados; se etiqueta a los administradores');
    await deps.responder('*ATENCIÓN ADMINISTRADORES: EL TERCIO @@ MARCÓ ERROR Y @@2 NO RESPONDIÓ. ¿SE LA QUITAN O VAN JUGANDO? (RESPONDAN: QUITAR / VAN JUGANDO)* @@L',
      opError(c, { mencionar: c.marcador.jid, nombre: c.marcador.etiqueta, mencionar2: c.otro.jid, nombre2: c.otro.etiqueta, mencionarLista: lista }));
  }
  // La carrera se cerró (o se cargó la pizarra) con casos sin resolver: la jugada sigue en el plano.
  async function cerrarCasosError() {
    const casos = [...casosError.values()];
    for (const c of casos) {
      if (c.timer) { clearTimeout(c.timer); c.timer = null; }
      casosError.delete(c.id);
      if (c.estado === 'admins') continue; // ya se llamó a los administradores
      try { await deps.responder('*LA CARRERA SE CERRÓ Y @@ NO SE LA BORRÓ, VAN JUGANDO* @@2', opError(c, { mencionar: c.otro.jid, nombre: c.otro.etiqueta, mencionar2: c.marcador.jid, nombre2: c.marcador.etiqueta })); }
      catch (e) { console.error('[hipismoChat] No se pudo avisar el cierre de un caso de error:', e.message); }
    }
  }
  async function marcarError(m) {
    if (!ctx.hipodromo || !registros.length || !deps.eliminarJugada) return false;
    const nombre = await deps.identificar(m.remitente);
    if (!nombre) return false;
    const mias = registros.filter(r => r.jugada.id && (r.jugada.jugadorNombre === nombre || r.jugada.banqueroNombre === nombre));
    if (!mias.length) { nota('Escribió "error" pero el bot no tiene jugadas suyas en esta carrera'); return false; }
    // Si cita el mensaje de la jugada (la parada o la confirmación), es esa; si no, la última suya.
    const citada = m.citadoId ? mias.find(r => r.ofertaId === m.citadoId || r.respId === m.citadoId) : null;
    const reg = citada || mias[mias.length - 1];
    if (casosError.has(reg.jugada.id)) { nota('Ya hay un llamado en curso por esa jugada'); return true; }
    const esAutor = reg.autor.nombre === nombre;
    const c = { id: reg.jugada.id, reg, estado: 'preguntando', llamados: 0, timer: null,
      citarId: reg.ofertaId || reg.respId,
      marcador: esAutor ? reg.autor : reg.resp, otro: esAutor ? reg.resp : reg.autor };
    // el mensaje citado: la parada si el bot todavía la tiene en memoria (el motor de WhatsApp la busca por id); si no, el de quien marcó el error
    casosError.set(c.id, c);
    await llamarError(c);
    programarLlamado(c);
    return true;
  }
  // Respuesta al llamado: el otro involucrado dice sí/no (o un administrador, tras ser llamado). Devuelve true si el mensaje era para un caso.
  async function responderCaso(m, texto) {
    if (!casosError.size) return false;
    const t = normRespuesta(texto);
    if (!t || t.length > 40) return false;
    const si = SI_QUITAR_RE.test(t) || (m.esAdmin && /^(?:quitar|quitarla|borrar|borrarla)$/.test(t));
    const no = !si && (NO_QUITAR_RE.test(t) || (m.esAdmin && /^(?:van jugando|vamos jugando|que juegue|sigue)$/.test(t)));
    if (!si && !no) return false;
    let caso = null, comoAdmin = false;
    for (const c of casosError.values()) if (c.estado === 'preguntando' && c.otro.jid === m.remitente.jid) { caso = c; break; }
    if (!caso) {
      const n = await deps.identificar(m.remitente);
      if (n) for (const c of casosError.values()) if (c.estado === 'preguntando' && c.otro.nombre === n) { caso = c; break; }
    }
    if (!caso && m.esAdmin) { caso = [...casosError.values()].find(c => c.estado === 'admins') || null; comoAdmin = !!caso; }
    if (!caso) return false;
    if (caso.timer) { clearTimeout(caso.timer); caso.timer = null; }
    casosError.delete(caso.id);
    const A = { mencionar: caso.otro.jid, nombre: caso.otro.etiqueta, mencionar2: caso.marcador.jid, nombre2: caso.marcador.etiqueta };
    if (si) {
      const r = await deps.eliminarJugada(caso.id);
      if (!r || !r.ok) { await deps.responder('⚠️ No pude borrar esa jugada (' + ((r && r.motivo) || 'ya no existe o ya fue calculada') + '). Un administrador debe revisarla en JUGADAS BOT IA.', { citarId: m.id }); return true; }
      registros = registros.filter(x => x !== caso.reg);
      jugadas = jugadas.filter(j => j !== caso.reg.jugada);
      nota('ERROR: se borró la jugada de ' + caso.marcador.nombre + ' (' + (comoAdmin ? 'decidió un administrador' : caso.otro.nombre + ' aceptó') + ')');
      await deps.responder(comoAdmin
        ? '*LISTO, UN ADMINISTRADOR AUTORIZÓ BORRAR LA JUGADA DE @@2 CON @@, AQUÍ NADA SE LA BORRARON*'
        : '*MUCHAS GRACIAS ESTIMADO TERCIO @@ QUE SE LA ESTÁ BORRANDO, AQUÍ NADA SE LA BORRARON* @@2', { citarId: m.id, ...A });
    } else {
      nota('ERROR: ' + (comoAdmin ? 'un administrador decidió' : caso.otro.nombre + ' no la borró') + ': la jugada sigue en el plano');
      await deps.responder(comoAdmin ? '*VAN JUGANDO POR DECISIÓN DEL ADMINISTRADOR, LA JUGADA VA AL PLANO* @@ @@2' : '*VAN JUGANDO YA QUE @@ NO SE LA BORRÓ, LA JUGADA VA AL PLANO* @@2', { citarId: m.id, ...A });
    }
    return true;
  }

  async function publicarPlano() {
    sinPlano = 0;
    await deps.publicar(armarPlanoChat({ nombreGrupo: deps.nombreGrupo, fecha: ctx.fecha, hipodromo: ctx.hipodromo, carrera: ctx.carrera, jugadas }));
  }

  async function abrirCarrera(m, datos) {
    const hip = await deps.resolverHipodromo(datos.hipodromo);
    if (!hip) {
      await deps.responder('⚠️ No encontré el hipódromo "' + datos.hipodromo + '" en la lista de este grupo. Revisa el nombre (ej.: Mountaineer 1ra carrera).', { citarId: m.id });
      return;
    }
    ctx.hipodromo = hip; ctx.carrera = datos.carrera; ctx.abierta = true; ctx.fecha = deps.hoy(); ctx.ret = '';
    ofertas.clear(); sinPlano = 0; cancelarCasosError(); registros = [];
    jugadas = await deps.cargarJugadas({ fecha: ctx.fecha, hipodromo: hip, carrera: datos.carrera });
    await guardarEstado();
    await deps.responder('*✅ Carrera abierta: ' + hip + ', ' + ORDINAL_CARRERA(datos.carrera) + ' Carrera.*\n*PARA QUE DINERO , VAMOS PONLE PONLE 🤑🤑*' + (jugadas.length ? '\n(Ya había ' + jugadas.length + ' jugadas guardadas en esta carrera.)' : ''), { citarId: m.id });
  }

  async function cerrarCarrera(m) {
    if (!ctx.hipodromo) { await deps.responder('⚠️ No hay ninguna carrera abierta.', { citarId: m.id }); return; }
    ctx.abierta = false; ofertas.clear();
    await guardarEstado();
    // Todo en MAYÚSCULA, negrita y cursiva (*_LÍNEA_*): WhatsApp lo aplica por línea, así que cada línea lleva sus marcas.
    const bc = t => '*_' + t.toUpperCase() + '_*';
    await deps.responder([
      bc('🔒❌ Carrera cerrada se dio la partida en ' + ctx.hipodromo + ', ' + ORDINAL_CARRERA(ctx.carrera) + ' Carrera. Ya no se reciben mas jugadas,❌🔒'),
      bc('🚫 NO HAY MAS JUGADA🚫'),
      bc('🚫 NO HAY MAS JUGADA🚫'),
      bc('éxitos a todos en sus apuestas, al tener pizarra oficial se enviaran los totales de esta carrera 💰🐎💰🐎'),
      bc('🔒 CARRERA CERRADA🔒'),
      bc('NOS REGIMOS POR EL CHAT📲 Y NUESTROS REGLAMENTOS ‼️'),
      bc('JUEGA GANA Y COBRA SEGURO EN ' + String(deps.nombreGrupo || '').toUpperCase())
    ].join('\n'), { citarId: m.id });
    await cerrarCasosError();
    await publicarPlano();
  }

  // Cuánto se puede jugar por cliente en esta parada: disponible / riesgo por unidad. null = sin tope (cliente libre).
  async function topeDe(nombre, factor) {
    const d = await deps.disponible(nombre);
    if (!d || !d.limitado) return { limitado: false, disponible: null, max: Infinity };
    const disponible = Math.max(0, round2(d.disponible));
    return { limitado: true, disponible, detalle: d.detalle || '', max: Math.floor((disponible / factor) * 100 + 1e-9) / 100 };
  }
  // Quien publica (o responde) con más de lo que puede jugar su saldo: tope = pozo + lo que va ganando - lo que va perdiendo - lo que ya tiene en juego.
  const nombreBonito = n => String(n || '').toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  function textoSinDisponible(m, tope, cliente) {
    return 'Saludos ' + etiquetaDe(m) + (cliente ? ' (' + nombreBonito(cliente) + ')' : '') + ', dispone de un saldo de ' + fmt(tope.disponible) + '. Favor jugar con su saldo disponible o un monto menor, pedimos disculpas.';
  }

  // Paradas mal escritas (id -> ts): si alguien les responde, el bot dice "Aquí nada, parada mal escrita".
  const malas = new Map();
  function marcarMala(m) { malas.set(m.id, tiempoDe(m)); if (malas.size > 400) malas.delete(malas.keys().next().value); }
  const TXT_MALA_RESPUESTA = '❌ Aquí nada, parada mal escrita.';
  const sinSaldoIds = new Map(); // paradas que no se registraron porque quien las publicó no tenía saldo (id -> ts)
  function marcarSinSaldo(m) { sinSaldoIds.set(m.id, tiempoDe(m)); if (sinSaldoIds.size > 400) sinSaldoIds.delete(sinSaldoIds.keys().next().value); }
  async function paradaMalEscrita(m, motivo) {
    marcarMala(m);
    nota('Parada mal escrita' + (motivo ? ' (' + motivo + ')' : '') + ': se le pide que la corrija');
    await deps.responder(etiquetaDe(m) + ' ❌ MALO, debe corregir: su jugada está mal escrita' + (motivo ? ' (' + motivo + ')' : '') + '.', mencion(m));
  }

  function retirarOfertasDe(jid) {
    ofertas.forEach(of => { if (of.autorJid === jid && of.restante > 0.005) of.seFue = true; });
  }

  async function procesarOferta(m, o) {
    if (!ctx.abierta) {
      if (puedeAvisar('sin-carrera', 120000)) await deps.responder('⚠️ Todavía no hay una carrera abierta. Un administrador debe abrirla escribiendo, por ejemplo: *Mountaineer 1ra carrera*.', { citarId: m.id });
      return;
    }
    if (!o.ok) {
      return paradaMalEscrita(m, o.motivo);
    }
    const nombre = await deps.identificar(m.remitente);
    if (!nombre) {
      nota('Jugada publicada, pero quien la escribió no es un cliente registrado: no se guardó');
      if (puedeAvisar('sin-cliente|' + m.remitente.jid, 60000)) await deps.responder(etiquetaDe(m) + ' tu número no está registrado como cliente. Avísale al administrador para que lo registre.' + pistaRegistro(m), { ...mencion(m), registroDe: m.remitente.jid });
      return;
    }
    const r = riesgoPorUnidad(o.apuesta);
    const factor = o.lado === 'doy' ? r.jugador : r.banquero; // quien publica "doy" juega; quien publica "recibo" da
    const tope = await topeDe(nombre, factor);
    if (o.monto > tope.max + 0.005) {
      if (tope.max < 0.01) {
        // Sin nada de saldo: la parada no se registra.
        nota('Jugada publicada por ' + nombre + ' pero no tiene saldo disponible: no se guardó' + (tope.detalle ? '. ' + tope.detalle : ''));
        marcarSinSaldo(m);
        await deps.responder(textoSinDisponible(m, tope, nombre), mencion(m));
        return;
      }
      // Tiene saldo pero menos de lo que puso: se le pide corregir, y la parada queda abierta: al recibir respuestas se juega solo su disponible.
      nota('Jugada publicada por ' + nombre + ' por ' + fmt(o.monto) + ' pero su disponible para esta jugada es ' + fmt(tope.max) + ': se le pidió corregir; si le responden se juega solo su disponible' + (tope.detalle ? '. ' + tope.detalle : ''));
      await deps.responder('*🚨🚨🚨🚨🚨*\n' + etiquetaDe(m) + ' *Favor corregir monto, su monto disponible para jugadas es de ' + fmt(tope.max) + '. En caso de recibir alguna respuesta, jugará solo su disponible.*', mencion(m));
    }
    nota('Jugada publicada por ' + nombre + ' (' + fmt(o.monto) + '): queda abierta 3 minutos esperando respuestas');
    ofertas.set(m.id, { id: m.id, ts: tiempoDe(m), autorJid: m.remitente.jid, autorNombre: nombre, autorEtiqueta: m.remitente.nombre, lado: o.lado, apuesta: o.apuesta, monto: o.monto, restante: o.monto });
    if (ofertas.size > 400) ofertas.delete(ofertas.keys().next().value);
  }

  async function procesarRespuesta(m, resp) {
    const oferta = ofertas.get(m.citadoId);
    if (!ctx.abierta) { nota('Respuesta recibida pero no hay carrera abierta'); return; }
    if (!oferta) {
      // La parada que citó no la conoce el bot (se publicó antes de abrir la carrera, antes de un reinicio del servidor, o no era una jugada).
      const citada = m.citadoTexto ? interpretarOferta(m.citadoTexto) : null;
      if (malas.has(m.citadoId) || (m.citadoTexto && (pareceParadaMalEscrita(m.citadoTexto) || (citada && !citada.ok)))) {
        nota('Respondieron a una parada mal escrita: no se juega');
        await deps.responder(TXT_MALA_RESPUESTA, { citarId: m.id });
        return;
      }
      if (sinSaldoIds.has(m.citadoId)) {
        nota('Respondieron a una parada que no se registró por falta de saldo de quien la publicó');
        await deps.responder('❌ Aquí nada, esa parada no quedó registrada: quien la publicó no tiene saldo disponible para ese monto.', { citarId: m.id });
        return;
      }
      if (citada && citada.ok) {
        const conf = conflictoDeRol(citada.lado, resp);
        if (conf) { nota('Mal término al responder una parada que el bot no tiene en memoria'); await deps.responder(conf, { citarId: m.id }); return; }
      }
      if (citada !== null) {
        nota('Respondieron a una parada que el bot no tiene en memoria (se publicó antes de abrir la carrera o antes de reiniciar el servidor)');
        await deps.responder('❌ Aquí nada, esa parada ya no está activa. Que la publiquen de nuevo.', { citarId: m.id });
      } else nota('Respuesta a un mensaje que no es una parada conocida: se ignora');
      return;
    }
    if (oferta.autorJid === m.remitente.jid) { nota('Respuesta a su propia parada: no hace nada'); return; } // responderse a uno mismo no hace nada
    const conflicto = conflictoDeRol(oferta.lado, resp);
    if (conflicto) { nota('Mal término: ' + conflicto.replace('❌ Aquí nada, ', '')); await deps.responder(conflicto, { citarId: m.id }); return; }
    const nombre = await deps.identificar(m.remitente);
    if (!nombre) {
      nota('Respuesta a una parada, pero quien responde no es un cliente registrado: no se jugó');
      if (puedeAvisar('sin-cliente|' + m.remitente.jid, 60000)) await deps.responder(etiquetaDe(m) + ' tu número no está registrado como cliente. Avísale al administrador para que lo registre.' + pistaRegistro(m), { ...mencion(m), registroDe: m.remitente.jid });
      return;
    }
    if (nombre === oferta.autorNombre) { nota('Respuesta a su propia parada (mismo cliente): no hace nada'); return; }
    if (oferta.restante <= 0.005) { nota(nombre + ' respondió pero la parada ya estaba topada'); await deps.responder('❌ Aquí nada, ya está topada', { citarId: m.id }); return; }
    if (oferta.seFue) { nota(nombre + ' respondió pero quien publicó puso "se fue"'); await deps.responder('*❌ Aquí nada, puso se fue*\n*🚨🚨🚨🚨🚨*', { citarId: m.id }); return; }
    if (tiempoDe(m) - oferta.ts >= VIGENCIA_PARADA_MS) { nota(nombre + ' respondió pasados los 3 minutos de vigencia de la parada'); await deps.responder('❌ Aquí nada, pasaron más de 3 minutos desde que se publicó la parada', { citarId: m.id }); return; }

    const restanteAntes = oferta.restante; // lo que le quedaba a la parada cuando respondieron
    const pedido = resp.tipo === 'todo' ? oferta.restante : resp.monto;
    let monto = round2(Math.min(pedido, oferta.restante));

    const apuestaJug = apuestaDesdeElJugador(oferta);
    const r = riesgoPorUnidad(apuestaJug);
    const juegaElQueResponde = oferta.lado === 'recibo';
    const factorRespondedor = juegaElQueResponde ? r.jugador : r.banquero;
    const factorAutor = juegaElQueResponde ? r.banquero : r.jugador;

    // Si el saldo de quien responde no alcanza para todo, se juega solo lo que su saldo permite ("Aquí solo 300 por saldo de @él").
    let limitadoPor = null; // 'resp' | 'autor'
    const topeResp = await topeDe(nombre, factorRespondedor);
    if (monto > topeResp.max + 0.005) {
      if (topeResp.max < 0.01) {
        nota(nombre + ' respondió pero no tiene saldo disponible: no se jugó' + (topeResp.detalle ? '. ' + topeResp.detalle : ''));
        await deps.responder(textoSinDisponible(m, topeResp, nombre), mencion(m));
        return;
      }
      monto = round2(topeResp.max);
      limitadoPor = 'resp';
    }
    // el que publicó puede haber gastado su pozo en otras paradas desde que publicó
    const topeAutor = await topeDe(oferta.autorNombre, factorAutor);
    if (monto > topeAutor.max + 0.005) {
      monto = round2(Math.max(0, topeAutor.max));
      if (monto <= 0.005) {
        oferta.restante = 0;
        nota('El que publicó ' + oferta.autorNombre + ' ya no tiene disponible: no se jugó');
        await deps.responder('❌ Aquí nada, el que publicó esa parada ya no tiene disponible', { citarId: m.id });
        return;
      }
      limitadoPor = 'autor';
    }

    const jugadorNombre = juegaElQueResponde ? nombre : oferta.autorNombre;
    const banqueroNombre = juegaElQueResponde ? oferta.autorNombre : nombre;
    const jugada = {
      fecha: ctx.fecha, hipodromo: ctx.hipodromo, carrera: ctx.carrera,
      jugadorNombre, banqueroNombre, apuesta: apuestaJug, monto,
      riesgoJugador: round2(monto * r.jugador), riesgoBanquero: round2(monto * r.banquero),
      textoLinea: 'Juega ' + jugadorNombre + ' ' + apuestaSegura(apuestaJug) + ' con ' + montoParaLinea(monto) + ' da ' + banqueroNombre
    };
    const idGuardada = await deps.guardarJugada(jugada);
    if (idGuardada) jugada.id = idGuardada;
    oferta.restante = round2(oferta.restante - monto);
    jugadas.push(jugada);
    registros.push({ jugada, ofertaId: oferta.id, respId: m.id,
      autor: { jid: oferta.autorJid, nombre: oferta.autorNombre, etiqueta: oferta.autorEtiqueta },
      resp: { jid: m.remitente.jid, nombre, etiqueta: m.remitente.nombre } });
    sinPlano++;
    // Se aclara cuánto se jugó cuando es menos de lo pedido ("más de lo que quedaba") o cuando la parada ya había sido tomada en parte
    // y respondieron "J"/"jugo" (juegan solo lo que quedaba): "✅ Aquí jugaron 100,00".
    const parcial = monto + 0.005 < pedido || (resp.tipo === 'todo' && restanteAntes + 0.005 < oferta.monto);
    nota('Se jugó: ' + jugadorNombre + ' con ' + fmt(monto) + ' contra ' + banqueroNombre);
    if (limitadoPor) {
      // "@(el que publicó) Aquí solo 300 por saldo de @(el que respondió)" — se etiqueta a la otra persona y se nombra a la que se quedó sin saldo.
      // "Aquí solo jugaron 1.732,70 por pozo de @(el que se quedó sin saldo)", etiquetando a las dos personas.
      const limitado = limitadoPor === 'resp' ? { jid: m.remitente.jid, nombre: m.remitente.nombre } : { jid: oferta.autorJid, nombre: oferta.autorEtiqueta };
      const op = { citarId: m.id, mencionar: oferta.autorJid, nombre: oferta.autorEtiqueta, mencionar2: m.remitente.jid, nombre2: m.remitente.nombre, mencionar3: limitado.jid, nombre3: limitado.nombre };
      nota('Saldo limitado: se jugó solo ' + fmt(monto) + ' por el pozo de ' + (limitadoPor === 'resp' ? nombre : oferta.autorNombre));
      await deps.responder('✅ @@ @@2 Aquí solo jugaron ' + fmt(monto) + ' por pozo de @@3', op);
    } else await deps.responder('✅ Aquí jugaron' + (parcial ? ' ' + fmt(monto) : ''), { citarId: m.id });
    if (sinPlano >= CADA_N_JUGADAS_PLANO) await publicarPlano();
  }

  // Si el servidor se reinició con una carrera abierta, se retoma desde la base (solo del mismo día). Las jugadas ofrecidas que
  // esperaban respuesta no se recuperan: quien quiera jugar debe volver a publicarlas.
  let estadoCargado = false;
  async function cargarEstadoSiHaceFalta() {
    if (estadoCargado) return;
    estadoCargado = true;
    if (!deps.cargarEstado) return;
    try {
      const e = await deps.cargarEstado();
      if (e && e.hipodromo && e.carrera && e.fecha === deps.hoy()) {
        ctx.hipodromo = e.hipodromo; ctx.carrera = e.carrera; ctx.abierta = !!e.abierta; ctx.fecha = e.fecha;
        jugadas = await deps.cargarJugadas({ fecha: ctx.fecha, hipodromo: ctx.hipodromo, carrera: ctx.carrera });
      }
    } catch (err) { console.error('[hipismoChat] No se pudo retomar la carrera abierta:', err.message); }
  }
  async function guardarEstado() {
    if (!deps.guardarEstado) return;
    try { await deps.guardarEstado({ hipodromo: ctx.hipodromo, carrera: ctx.carrera, abierta: ctx.abierta, fecha: ctx.fecha }); }
    catch (err) { console.error('[hipismoChat] No se pudo guardar el estado de la carrera:', err.message); }
  }

  async function procesarMensaje(m) {
    const texto = limpiar(m.texto);
    if (!texto) return;
    await cargarEstadoSiHaceFalta();
    if (m.esAdmin && m.remitente && m.remitente.jid) { adminsVistos.set(String(m.remitente.jid).split('@')[0].split(':')[0], m.remitente.jid); if (adminsVistos.size > 50) adminsVistos.delete(adminsVistos.keys().next().value); }
    const carrera = interpretarAbrirCarrera(texto);
    const cierre = ES_CIERRE_RE.test(texto);
    const pizarra = interpretarPizarra(texto);
    const plano = ES_PLANO_RE.test(texto);
    if (carrera || cierre || pizarra || plano) {
      const autorizado = m.esAdminCarrera ? await m.esAdminCarrera() : m.esAdmin;
      if (!autorizado) {
        const accion = carrera ? 'abrir carreras' : cierre ? 'cerrar carreras' : pizarra ? 'cargar la pizarra' : 'pedir el plano';
        return avisarNoAdmin(m, accion, !!m.esAdminCarrera);
      }
      if (carrera) return abrirCarrera(m, carrera);
      if (cierre) return cerrarCarrera(m);
      if (pizarra) return cargarPizarra(m, pizarra);
      if (!ctx.hipodromo) return deps.responder('⚠️ Este chat todavía no tiene una carrera seleccionada.', { citarId: m.id });
      return publicarPlano();
    }
    if (m.esAdmin) {
      if (ES_AUTORIZAR_RE.test(texto)) return autorizarAdmin(m);
      const retx = interpretarRetirados(texto);
      if (retx) return anotarRetirados(m, retx);
      const mReg = texto.match(/^(?:registrar|registra|asociar)\s+(.+)$/i);
      if (mReg) return registrarNumero(m, mReg[1]);
    }
    if (ES_ERROR_RE.test(normRespuesta(texto)) && await marcarError(m)) return;
    if (casosError.size && await responderCaso(m, texto)) return;
    const oferta = interpretarOferta(texto);
    if (oferta !== null) return procesarOferta(m, oferta);
    const resp = interpretarRespuesta(texto);
    // "Sf"/"Se fue": sus jugadas abiertas se fueron. Si después alguien le responde (monto o J), el bot dice que no hay nada.
    if (resp && resp.tipo === 'sf') { nota('Puso "se fue": sus paradas abiertas quedan muertas'); retirarOfertasDe(m.remitente.jid); return; }
    // Responder a una parada mal escrita (con "J", un monto, "ok"…): no se juega nada.
    if (m.citadoId && ctx.abierta && (resp || pareceIntentoDeJugar(texto)) && (malas.has(m.citadoId) || (m.citadoTexto && (pareceParadaMalEscrita(m.citadoTexto) || (interpretarOferta(m.citadoTexto) || { ok: true }).ok === false)))) {
      nota('Respondieron a una parada mal escrita: no se juega');
      await deps.responder(TXT_MALA_RESPUESTA, { citarId: m.id });
      return;
    }
    if (resp && m.citadoId) return procesarRespuesta(m, resp);
    // Parece una parada (tiene apuesta y monto) pero no dice si juega o banquea ("jhuego 2p del 8 300"): hay que corregirla.
    if (!resp && ctx.abierta && pareceParadaMalEscrita(texto)) return paradaMalEscrita(m, 'no dice si juega o da');
  }

  return { procesarMensaje, estado: () => ({ ...ctx, jugadas: jugadas.length, ofertas: ofertas.size, sinPlano }), _ofertas: ofertas };
}

module.exports = {
  TEXTO_PLANO_BOT: 'Jugadas del chat de WhatsApp (bot)', crearMotor, interpretarPizarra, carreraDePlanoCitado, interpretarRetirados, interpretarOferta, interpretarRespuesta, conflictoDeRol, pareceParadaMalEscrita, interpretarAbrirCarrera, riesgoPorUnidad, apuestaDesdeElJugador,
  armarPlanoChat, fechaLarga, parseMontoChat, apuestaVisible, apuestaSegura, montoParaLinea, apuestaDesdeElJugador, riesgoPorUnidad, round2, CADA_N_JUGADAS_PLANO, VIGENCIA_PARADA_MS
};
