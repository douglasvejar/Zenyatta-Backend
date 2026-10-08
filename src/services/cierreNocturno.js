// =================================================================
// cierreNocturno.js (08-10-2026) — CIERRE AUTOMÁTICO DE TODOS LOS GRUPOS.
// Pedido del usuario: "al comprobar la sabana que ya no tengan mas jugadas por resolver y ya sean
// pasadas las 12:00am del dia siguiente, quiere decir que ya no se van a agregar mas jugadas...
// ve cerrando todos los grupos con sabanas activas, me vas a pasar en orden por grupo: su sabana
// con todos los juegos resueltos, sus totales del dia, totales semana de jugadores activos y la
// foto... cuando ya no tengas mas grupos que resolver me envias un mensaje, todos los grupos
// resueltos, con un mensaje motivado, hasta mañana".
//
// Cómo funciona: pasada la medianoche de Venezuela, "ayer" ya no recibe jugadas nuevas. En cada
// chequeo (el mismo reloj del resumen automático de Telegram) se recorren, en orden alfabético,
// los grupos con sábana de ayer. A cada uno cuyos juegos ya están TODOS resueltos se le manda el
// cierre completo (whatsappBot.cerrarDiaCompleto: listado final, totales del día, corte de la
// semana y foto). Al que todavía tiene juegos pendientes se le deja para el próximo chequeo. Cuando
// ya no queda ningún grupo pendiente se manda UN solo mensaje final.
//
// Un grupo nunca recibe el cierre dos veces: cerrarDiaCompleto "reclama" el día en la base antes de
// mandar (whatsapp_dia_estado.cierre_nocturno_en).
//
// Solo grupos con Telegram activo: el envío automático por WhatsApp se sacó a propósito el
// 18-09-2026 (riesgo de baneo) y no se retoma acá.
// =================================================================
const whatsappDiaEstado = require('./whatsappDiaEstado');
const { fechaVenezuelaHoy } = require('./fechaVenezuela');

const UN_DIA_MS = 24 * 60 * 60 * 1000;
let ejecutando = false;

// 'YYYY-MM-DD' de AYER en Venezuela (UTC-4 fijo, ver fechaVenezuela.js).
function fechaVenezuelaAyer() {
  const hoy = new Date(fechaVenezuelaHoy() + 'T00:00:00Z');
  return new Date(hoy.getTime() - UN_DIA_MS).toISOString().split('T')[0];
}

function fechaLegible(iso) {
  const [a, m, d] = String(iso).split('-');
  return `${d}/${m}/${a}`;
}

// El mensaje final, cuando ya no queda ningún grupo por resolver.
function textoTodosResueltos(fecha, nombres) {
  const lista = nombres.map(n => String(n).toUpperCase()).join(', ');
  return [
    '✅ *TODOS LOS GRUPOS RESUELTOS*',
    '',
    `Cerramos el día *${fechaLegible(fecha)}*: la sábana final, los totales del día, el corte de la semana y la foto del balance de cada grupo ya salieron.`,
    '',
    `📍 Grupos cerrados: ${lista}`,
    '',
    'Gran trabajo hoy 💪 Los números quedaron claros y cuadrados. Descansa, recarga energías y mañana volvemos con todo.',
    '¡Hasta mañana! 🌙'
  ].join('\n');
}

// opciones:
//   fecha         día a cerrar (por defecto, ayer en Venezuela)
//   destinoDe     (grupo) => { sock, jid } | null — dónde se manda el cierre de ese grupo
//   enviarFinal   (texto) => Promise — manda el mensaje final
//   cerrarDia     (sock, grupoId, jid, fecha) => resultado — por defecto whatsappBot.cerrarDiaCompleto
//   avisarProblema ({ grupoNombre, fecha, resultado }) => Promise — se llama por cada grupo que NO se
//                  pudo cerrar (juegos sin resolver o error) para avisarle al dueño qué pasa y con qué grupo
async function revisarCierreNocturno({ fecha, destinoDe, enviarFinal, cerrarDia, avisarProblema } = {}) {
  if (ejecutando) return { omitido: true, motivo: 'Ya hay un cierre nocturno en curso.' };
  ejecutando = true;
  try {
    const dia = fecha || fechaVenezuelaAyer();
    const cerrar = cerrarDia || ((...a) => require('./whatsappBot').cerrarDiaCompleto(...a));
    const grupos = await whatsappDiaEstado.listarDiasParaCierreNocturno(dia);
    const cerradosAhora = [];
    const pendientes = [];
    const elegibles = [];

    for (const g of grupos) {
      const destino = destinoDe ? destinoDe(g) : null;
      if (!destino) continue; // sin chat donde mandarlo: no cuenta ni como pendiente
      elegibles.push(g.nombre);
      if (g.cerrado) continue;
      try {
        const r = await cerrar(destino.sock, g.grupoId, destino.jid, dia);
        if (r.accion === 'CERRADO') cerradosAhora.push(g.nombre);
        else if (r.accion === 'FALTAN_JUEGOS' || r.accion === 'ERROR') {
          pendientes.push({ nombre: g.nombre, motivo: r.accion, pendientes: r.pendientes });
          if (avisarProblema) {
            try { await avisarProblema({ grupoNombre: g.nombre, grupoId: g.grupoId, fecha: dia, resultado: r }); } catch (e) { console.error('[cierreNocturno] No se pudo avisar el problema:', e.message); }
          }
        }
        // SIN_SABANA / YA_CERRADO: no hay nada más que hacer con este grupo.
      } catch (e) {
        console.error('[cierreNocturno] Falló el cierre del grupo ' + g.grupoId + ':', e.message);
        pendientes.push({ nombre: g.nombre, motivo: 'ERROR' });
        if (avisarProblema) {
          try { await avisarProblema({ grupoNombre: g.nombre, grupoId: g.grupoId, fecha: dia, resultado: { accion: 'ERROR', error: e.message } }); } catch (e2) { /* un aviso que falla no frena nada */ }
        }
      }
    }

    // Ya no queda nadie por resolver y en este chequeo se cerró al menos uno: el mensaje final.
    let finalEnviado = false;
    if (pendientes.length === 0 && cerradosAhora.length > 0 && enviarFinal) {
      try {
        await enviarFinal(textoTodosResueltos(dia, elegibles));
        finalEnviado = true;
      } catch (e) {
        console.error('[cierreNocturno] No se pudo mandar el mensaje final:', e.message);
      }
    }
    if (cerradosAhora.length || pendientes.length) {
      console.log('[cierreNocturno] ' + dia + ': cerrados ahora = ' + (cerradosAhora.join(', ') || 'ninguno') + '; pendientes = ' + (pendientes.map(p => p.nombre).join(', ') || 'ninguno') + '.');
    }
    return { fecha: dia, cerrados: cerradosAhora, pendientes, finalEnviado };
  } finally {
    ejecutando = false;
  }
}

const ABREVIAR = 90;
function resumirJugadas(jugadas) {
  const t = (jugadas || []).map(j => String(j).trim()).filter(Boolean).join(' / ');
  return t.length > ABREVIAR ? t.slice(0, ABREVIAR - 1).trimEnd() + '…' : t;
}

// El aviso al dueño cuando un grupo NO se pudo cerrar: qué pasa y con qué grupo.
function textoProblemaCierre({ grupoNombre, fecha, resultado }) {
  const cab = `⚠️ *PROBLEMA — ${String(grupoNombre).toUpperCase()}*\nDía ${fechaLegible(fecha)}.`;
  if (resultado.accion === 'ERROR') {
    return cab + `\nNo pude revisar la sábana de ese día: ${resultado.error || 'error desconocido'}.\nLo vuelvo a intentar solo en el próximo chequeo; si se repite, hay que revisar la sábana en el panel.`;
  }
  const lista = (resultado.detalle || []).slice(0, 15).map(d => `• ${d.cliente || '?'} — ticket ${d.ticket || '?'} · ${d.estado}` + (d.jugadas && d.jugadas.length ? ` · ${resumirJugadas(d.jugadas)}` : ''));
  const resto = (resultado.detalle || []).length - lista.length;
  return [
    cab,
    `Ya pasó la medianoche y no puedo cerrar el grupo: ${resultado.pendientes} ${resultado.pendientes === 1 ? 'jugada sigue' : 'jugadas siguen'} sin resolver.`,
    ...lista,
    ...(resto > 0 ? [`… y ${resto} más.`] : []),
    'Qué hacer: revísalas en el panel del grupo (resolverlas a mano o corregir la sábana). Apenas queden resueltas, el cierre sale solo.'
  ].join('\n');
}

module.exports = { revisarCierreNocturno, fechaVenezuelaAyer, textoTodosResueltos, textoProblemaCierre };
