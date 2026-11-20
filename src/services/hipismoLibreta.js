// =================================================================
// LIBRETA DE CONTACTOS (20-11-2026, a pedido del usuario: "que el teléfono que se guarda en la ficha sea como la libreta de contactos
// del teléfono: al guardar un número el bot sabe quién es, con qué nombre lo guardé y cómo llamarlo, y no me pida 'registrar' en el chat").
//
// Problema: WhatsApp muchas veces entrega al remitente como un código interno (@lid) y no como su teléfono. El bot comparaba ese código
// contra los teléfonos de las fichas y no coincidía, así que pedía "registrar NOMBRE" a mano.
//
// Solución: por cada ficha con teléfono se le pregunta a WhatsApp (sock.onWhatsApp) a qué cuenta pertenece ese número; la respuesta trae
// el jid real y el código interno (lid). Con eso se arma, en memoria, "dígitos (teléfono o lid) -> nombre de la ficha" y "nombre -> jid"
// (este último sirve para etiquetar a un cliente aunque aún no haya escrito nada). Lo asociado a mano con "registrar" sigue mandando.
// No se guarda nada en la base: la libreta es la propia ficha, se vuelve a leer sola (al cambiar un teléfono se invalida de inmediato).
// =================================================================

const libretas = new Map(); // grupoId -> { hasta, desde, porDigitos: Map(dígitos -> nombre), jidDe: Map(nombre -> jid), sincronizando: Promise|null }

const VIGENCIA_MS = 10 * 60 * 1000;       // cada cuánto se refresca sola
const ESPERA_MIN_MS = 60 * 1000;           // si llega alguien que no se encuentra, no se vuelve a preguntar antes de esto
const TOPE_NUMEROS = 400;                  // un grupo no tiene tantos clientes; evita abusos

function soloDigitos(t) { return String(t === null || t === undefined ? '' : t).replace(/\D/g, ''); }

// Teléfono de la ficha -> candidatos en formato internacional (solo dígitos). Venezuela por defecto: "0414-1234567" / "4141234567" -> 58414…
function candidatosInternacionales(telefono) {
  let d = soloDigitos(telefono);
  if (d.length < 7) return [];
  const out = new Set();
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) out.add('58' + d.slice(1));          // 04141234567
  else if (d.length === 10 && /^4\d{9}$/.test(d)) out.add('58' + d);             // 4141234567
  else out.add(d);                                                               // ya viene con código de país
  return [...out];
}

function nuevaLibreta() {
  return { hasta: 0, desde: 0, porDigitos: new Map(), jidDe: new Map(), sincronizando: null };
}

function digitosDeJid(jid) {
  if (typeof jid !== 'string') return '';
  return soloDigitos(jid.split('@')[0].split(':')[0]);
}

// Lee las fichas con teléfono y le pregunta a WhatsApp quién es cada uno. `fichas` = [{ nombre, telefono }].
async function sincronizar(grupoId, sock, fichas) {
  const L = libretas.get(grupoId) || nuevaLibreta();
  libretas.set(grupoId, L);
  if (L.sincronizando) return L.sincronizando;
  L.sincronizando = (async () => {
    const porDigitos = new Map();
    const jidDe = new Map();
    const pendientes = []; // { nombre, numero }
    for (const f of (fichas || []).slice(0, TOPE_NUMEROS)) {
      const nombre = f && f.nombre;
      if (!nombre) continue;
      for (const numero of candidatosInternacionales(f.telefono)) {
        porDigitos.set(numero, nombre);
        if (!jidDe.has(nombre)) jidDe.set(nombre, numero + '@s.whatsapp.net');
        pendientes.push({ nombre, numero });
      }
    }
    if (sock && typeof sock.onWhatsApp === 'function' && pendientes.length) {
      try {
        const respuesta = await sock.onWhatsApp(...pendientes.map(p => p.numero));
        for (const r of (respuesta || [])) {
          if (!r || r.exists === false) continue;
          const jid = typeof r.jid === 'string' ? r.jid : '';
          const dJid = digitosDeJid(jid);
          const p = pendientes.find(x => x.numero === dJid) || pendientes.find(x => dJid && (x.numero.endsWith(dJid.slice(-10)) || dJid.endsWith(x.numero.slice(-10))));
          if (!p) continue;
          porDigitos.set(dJid, p.nombre);
          jidDe.set(p.nombre, jid);
          const dLid = digitosDeJid(typeof r.lid === 'string' ? r.lid : '');
          if (dLid) porDigitos.set(dLid, p.nombre);
        }
      } catch (e) {
        console.warn('[libreta] No se pudo consultar a WhatsApp por los teléfonos de las fichas (grupo ' + grupoId + '):', e && e.message);
      }
    }
    L.porDigitos = porDigitos; L.jidDe = jidDe;
    L.desde = Date.now(); L.hasta = L.desde + VIGENCIA_MS;
  })().finally(() => { L.sincronizando = null; });
  return L.sincronizando;
}

// ¿Quién es esta persona según la libreta? `jids` = el jid real y el crudo (se prueban todos). null si no se sabe.
function nombreDe(grupoId, jids) {
  const L = libretas.get(grupoId);
  if (!L) return null;
  const todos = [].concat(jids || []).map(digitosDeJid).filter((d, i, a) => d && a.indexOf(d) === i);
  for (const d of todos) if (L.porDigitos.has(d)) return L.porDigitos.get(d);
  const ult = s => s.slice(-10);
  for (const d of todos) {
    if (d.length < 10) continue;
    for (const [k, nombre] of L.porDigitos) if (k.length >= 10 && ult(k) === ult(d)) return nombre;
  }
  return null;
}

// jid con el que se puede etiquetar a un cliente por su nombre (aunque no haya escrito nada todavía).
function jidDe(grupoId, nombre) {
  const L = libretas.get(grupoId);
  return (L && L.jidDe.get(nombre)) || null;
}

// ¿Toca (re)sincronizar? Nunca se hizo, venció, o (forzar) llegó alguien desconocido y pasó el mínimo de espera.
function conviene(grupoId, forzar) {
  const L = libretas.get(grupoId);
  if (!L || !L.desde) return true;
  if (forzar) return Date.now() - L.desde > ESPERA_MIN_MS;
  return Date.now() > L.hasta;
}

function invalidar(grupoId) { libretas.delete(grupoId); }
function invalidarTodas() { libretas.clear(); }

module.exports = { sincronizar, nombreDe, jidDe, conviene, invalidar, invalidarTodas, _candidatos: candidatosInternacionales, _libretas: libretas };
