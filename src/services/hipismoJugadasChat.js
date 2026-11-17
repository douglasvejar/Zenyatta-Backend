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
const VERBO_OFERTA_RE = /^(?:juego|juega|jugar|jugando|jugamos)\b\s*/i;
function interpretarOferta(texto) {
  let t = limpiar(texto);
  if (!VERBO_OFERTA_RE.test(t)) return null;
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
  if (/^(?:sf|s\.f\.?|se ?fue(?:ron)?(?: todo| todas| todas las jugadas)?)$/.test(t)) return { tipo: 'sf' };
  const m = t.match(/^(?:j(?:ugo)?\s*)?(?:con\s+)?(\d+(?:[.,]\d+)?)$/);
  if (m) { const n = parseMontoChat(m[1]); if (n !== null && n > 0) return { tipo: 'monto', monto: round2(n) }; }
  return null;
}

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
const ABRIR_PALABRAS_RE = /^(?:abierta|abierto|abiertas|abre|abren|abran|abrir|abrimos|abrio)\s+(?:la\s+)?(?:carrera\s+)?(\S+?)(?:\s+carrera)?\s+(?:de|del|en)\s+(.+)$/i;
function interpretarAbrirCarrera(texto) {
  const t = limpiar(texto);
  const mp = t.match(ABRIR_PALABRAS_RE);
  if (mp) {
    const tok = mp[1].toLowerCase().replace(/[º°.]/g, '');
    let n = ORDINALES_CARRERA[tok];
    if (n === undefined) { const mn = tok.match(/^(\d{1,2})(?:ra|era|da|ta|va|ma|na|er|do|to|vo|mo|no|a)?$/); n = mn ? parseInt(mn[1], 10) : null; }
    const hip = mp[2].replace(/\bcarrera\b/ig, '').trim();
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
//   guardarJugada(j) -> Promise<void>                     j = { fecha, hipodromo, carrera, jugadorNombre, banqueroNombre, apuesta, monto, riesgoJugador, riesgoBanquero, textoLinea }
//   cargarJugadas({fecha,hipodromo,carrera}) -> Promise<[{jugadorNombre,banqueroNombre,apuesta,monto}]>
//   responder(texto, { citarId, mencionar }) -> Promise<void>
//   publicar(texto) -> Promise<void>                      mensaje suelto al grupo (plano)
// }
// mensaje = { texto, id, citadoId, remitente: { jid, nombre }, esAdmin }
// ---------------------------------------------------------------
const CADA_N_JUGADAS_PLANO = 4;
function crearMotor(deps) {
  const ctx = { hipodromo: null, carrera: null, abierta: false, fecha: null };
  const ofertas = new Map();
  let jugadas = [];
  let sinPlano = 0;
  const avisados = new Map(); // clave -> ms del último aviso (evita repetir el mismo reclamo)

  const puedeAvisar = (clave, ms) => {
    const ahora = Date.now();
    if (avisados.has(clave) && ahora - avisados.get(clave) < ms) return false;
    avisados.set(clave, ahora);
    if (avisados.size > 500) avisados.delete(avisados.keys().next().value);
    return true;
  };
  // "@@" marca dónde va la mención al jugador (quien conecta con WhatsApp la cambia por @número; ver hipismoJugadasChatBot.js)
  const mencion = m => ({ citarId: m.id, mencionar: m.remitente.jid, nombre: m.remitente.nombre });
  const etiquetaDe = () => '@@';

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
    ctx.hipodromo = hip; ctx.carrera = datos.carrera; ctx.abierta = true; ctx.fecha = deps.hoy();
    ofertas.clear(); sinPlano = 0;
    jugadas = await deps.cargarJugadas({ fecha: ctx.fecha, hipodromo: hip, carrera: datos.carrera });
    await deps.responder('✅ Carrera abierta: *' + hip + ', ' + ORDINAL_CARRERA(datos.carrera) + ' Carrera*. Ya recibo jugadas.' + (jugadas.length ? '\n(Ya había ' + jugadas.length + ' jugadas guardadas en esta carrera.)' : ''), { citarId: m.id });
  }

  async function cerrarCarrera(m) {
    if (!ctx.hipodromo) { await deps.responder('⚠️ No hay ninguna carrera abierta.', { citarId: m.id }); return; }
    ctx.abierta = false; ofertas.clear();
    await deps.responder('🔒 Carrera cerrada: *' + ctx.hipodromo + ', ' + ORDINAL_CARRERA(ctx.carrera) + ' Carrera*. Ya no recibo jugadas. Plano final (queda esperando la pizarra):', { citarId: m.id });
    await publicarPlano();
  }

  // Cuánto se puede jugar por cliente en esta parada: disponible / riesgo por unidad. null = sin tope (cliente libre).
  async function topeDe(nombre, factor) {
    const d = await deps.disponible(nombre);
    if (!d || !d.limitado) return { limitado: false, disponible: null, max: Infinity };
    const disponible = Math.max(0, round2(d.disponible));
    return { limitado: true, disponible, max: Math.floor((disponible / factor) * 100 + 1e-9) / 100 };
  }
  function textoSinDisponible(m, tope, factor) {
    if (tope.disponible <= 0.005) return etiquetaDe(m) + ' no tienes disponible para jugar. Habla con el administrador para recargar tu pozo.';
    if (Math.abs(factor - 1) < 0.0001) return etiquetaDe(m) + ' solo tienes ' + fmt(tope.disponible) + ' disponible para jugar. Por favor coloca la parada por ese monto o menos.';
    return etiquetaDe(m) + ' en esta parada tu disponible alcanza para ' + fmt(tope.max) + ' (ahí arriesgas ' + fmt(tope.disponible) + '). Por favor colócala por ese monto o menos.';
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
      await deps.responder(etiquetaDe(m) + ' no entendí tu jugada (' + o.motivo + '). Escríbela así: *Juego 4x1 con 75 doy a8*', mencion(m));
      return;
    }
    const nombre = await deps.identificar(m.remitente);
    if (!nombre) {
      if (puedeAvisar('sin-cliente|' + m.remitente.jid, 600000)) await deps.responder(etiquetaDe(m) + ' tu número no está registrado como cliente. Avísale al administrador para que lo registre.', mencion(m));
      return;
    }
    const r = riesgoPorUnidad(o.apuesta);
    const factor = o.lado === 'doy' ? r.jugador : r.banquero; // quien publica "doy" juega; quien publica "recibo" da
    const tope = await topeDe(nombre, factor);
    if (o.monto > tope.max + 0.005) {
      await deps.responder(textoSinDisponible(m, tope, factor), mencion(m));
      return;
    }
    ofertas.set(m.id, { id: m.id, autorJid: m.remitente.jid, autorNombre: nombre, autorEtiqueta: m.remitente.nombre, lado: o.lado, apuesta: o.apuesta, monto: o.monto, restante: o.monto });
    if (ofertas.size > 400) ofertas.delete(ofertas.keys().next().value);
  }

  async function procesarRespuesta(m, resp) {
    const oferta = ofertas.get(m.citadoId);
    if (!oferta || !ctx.abierta) return;
    if (oferta.autorJid === m.remitente.jid) return; // responderse a uno mismo no hace nada
    const nombre = await deps.identificar(m.remitente);
    if (!nombre) {
      if (puedeAvisar('sin-cliente|' + m.remitente.jid, 600000)) await deps.responder(etiquetaDe(m) + ' tu número no está registrado como cliente. Avísale al administrador para que lo registre.', mencion(m));
      return;
    }
    if (nombre === oferta.autorNombre) return;
    if (oferta.restante <= 0.005) { await deps.responder('❌ Nada, ya topada', { citarId: m.id }); return; }
    if (oferta.seFue) { await deps.responder('❌ Aquí nada, puso se fue', { citarId: m.id }); return; }

    const pedido = resp.tipo === 'todo' ? oferta.restante : resp.monto;
    let monto = round2(Math.min(pedido, oferta.restante));

    const apuestaJug = apuestaDesdeElJugador(oferta);
    const r = riesgoPorUnidad(apuestaJug);
    const juegaElQueResponde = oferta.lado === 'recibo';
    const factorRespondedor = juegaElQueResponde ? r.jugador : r.banquero;
    const factorAutor = juegaElQueResponde ? r.banquero : r.jugador;

    const topeResp = await topeDe(nombre, factorRespondedor);
    if (monto > topeResp.max + 0.005) {
      await deps.responder(textoSinDisponible(m, topeResp, factorRespondedor), mencion(m));
      return;
    }
    // el que publicó puede haber gastado su pozo en otras paradas desde que publicó
    const topeAutor = await topeDe(oferta.autorNombre, factorAutor);
    if (monto > topeAutor.max + 0.005) {
      monto = round2(Math.max(0, topeAutor.max));
      if (monto <= 0.005) {
        oferta.restante = 0;
        await deps.responder('❌ Nada, el que publicó esa parada ya no tiene disponible', { citarId: m.id });
        return;
      }
    }

    const jugadorNombre = juegaElQueResponde ? nombre : oferta.autorNombre;
    const banqueroNombre = juegaElQueResponde ? oferta.autorNombre : nombre;
    const jugada = {
      fecha: ctx.fecha, hipodromo: ctx.hipodromo, carrera: ctx.carrera,
      jugadorNombre, banqueroNombre, apuesta: apuestaJug, monto,
      riesgoJugador: round2(monto * r.jugador), riesgoBanquero: round2(monto * r.banquero),
      textoLinea: 'Juega ' + jugadorNombre + ' ' + apuestaSegura(apuestaJug) + ' con ' + montoParaLinea(monto) + ' da ' + banqueroNombre
    };
    await deps.guardarJugada(jugada);
    oferta.restante = round2(oferta.restante - monto);
    jugadas.push(jugada);
    sinPlano++;
    const parcial = monto + 0.005 < pedido;
    await deps.responder('✅ Aquí jugaron' + (parcial ? ' ' + fmt(monto) + ' (era lo que quedaba)' : ''), { citarId: m.id });
    if (sinPlano >= CADA_N_JUGADAS_PLANO) await publicarPlano();
  }

  async function procesarMensaje(m) {
    const texto = limpiar(m.texto);
    if (!texto) return;
    if (m.esAdmin) {
      const carr = interpretarAbrirCarrera(texto);
      if (carr) return abrirCarrera(m, carr);
      if (ES_CIERRE_RE.test(texto)) return cerrarCarrera(m);
      if (ES_PLANO_RE.test(texto)) {
        if (!ctx.hipodromo) { await deps.responder('⚠️ No hay ninguna carrera abierta.', { citarId: m.id }); return; }
        return publicarPlano();
      }
    }
    const oferta = interpretarOferta(texto);
    if (oferta !== null) return procesarOferta(m, oferta);
    const resp = interpretarRespuesta(texto);
    // "Sf"/"Se fue": sus jugadas abiertas se fueron. Si después alguien le responde (monto o J), el bot dice que no hay nada.
    if (resp && resp.tipo === 'sf') { retirarOfertasDe(m.remitente.jid); return; }
    if (resp && m.citadoId) return procesarRespuesta(m, resp);
  }

  return { procesarMensaje, estado: () => ({ ...ctx, jugadas: jugadas.length, ofertas: ofertas.size, sinPlano }), _ofertas: ofertas };
}

module.exports = {
  crearMotor, interpretarOferta, interpretarRespuesta, interpretarAbrirCarrera, riesgoPorUnidad, apuestaDesdeElJugador,
  armarPlanoChat, fechaLarga, parseMontoChat, apuestaVisible, apuestaSegura, CADA_N_JUGADAS_PLANO
};
