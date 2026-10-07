// =================================================================
// hipismoCuadreNocturno.js (07-10-2026) — REVISIÓN AUTOMÁTICA DE CUADRE.
// Pedido del usuario: "haz el 3" (que el cuadre se revise solo cada noche
// y avise si algo no suma, en vez de esperar a que alguien lo note).
//
// Cada noche (a partir de las 3:00 a. m. hora de Venezuela, una sola vez por
// día y por grupo) revisa la semana actual y la anterior de cada grupo con
// el módulo de Hipismo activo:
//   1) diagnosticarSaldosHipismo: que el total de CADA cliente en la grilla
//      (Cierre Final/Balance General) sea el mismo que ve en su link.
//   2) Que el balance sume 0: todos los saldos (incluidos ítems como
//      WINNERS, TABLAS FIJAS, REMATE) + COMISIÓN GRUPO tienen que dar 0,
//      porque cada ganancia de alguien tiene su contraparte en otro renglón.
// Si algo no cuadra deja una alerta (hipismo_alertas, CUADRE_DESCUADRADO,
// usuario "SISTEMA") y guarda la bitácora en hipismo_cuadre_nocturno (una
// fila por grupo y día, que además evita repetir la revisión si el servidor
// se reinicia). Solo LEE y avisa: nunca corrige ni cambia ningún monto.
// El mismo cálculo se puede correr a mano (ejecutarCuadreGrupo) desde la
// pestaña Alertas.
// =================================================================
const db = require('../db');
const { rangoSemanaGrupo } = require('./hipismoSemana');
const { construirCierreFinalHipismo, diagnosticarSaldosHipismo } = require('./hipismoResumenCliente');
const { round2 } = require('./hipismoAdelantadasCalc');

const TOLERANCIA_SUMA = 0.02; // centavos de ruido de redondeo entre renglones
const HORA_INICIO_VE = 3;     // 3:00 a. m. hora de Venezuela
const CADA_MS = 15 * 60 * 1000;

function hoyVenezuela() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }
function isoFecha(d) { return d.toISOString().slice(0, 10); }

// Suma de todos los renglones del balance + COMISIÓN GRUPO. Debe dar 0.
async function revisarSumaBalance(grupoId, desde, hasta) {
  const cierre = await construirCierreFinalHipismo(grupoId, desde, hasta);
  const sumaClientes = (cierre.clientes || []).reduce((acc, c) => acc + Number(c.saldo || 0), 0);
  const diferencia = round2(sumaClientes + Number(cierre.comisionSemana || 0));
  return { desde, hasta, sumaClientes: round2(sumaClientes), comisionGrupo: round2(cierre.comisionSemana || 0), diferencia, cuadra: Math.abs(diferencia) <= TOLERANCIA_SUMA };
}

// Revisa UN grupo en las semanas indicadas (por defecto: actual y anterior).
// No guarda nada: devuelve { ok, semanas: [...], discrepancias: [...], sumaBalance: [...] }.
async function revisarCuadreGrupo(grupo, { semanas = [0, -1], hoy } = {}) {
  const hoyVe = hoy || hoyVenezuela();
  const rangos = [];
  for (const off of semanas) {
    const r = await rangoSemanaGrupo(grupo.id, hoyVe, off);
    rangos.push({ desde: r.desde, hasta: r.hasta });
  }
  const discrepancias = [];
  const sumaBalance = [];
  let clientesRevisados = 0;
  for (const rg of rangos) {
    const d = await diagnosticarSaldosHipismo(grupo.id, grupo, rg.desde, rg.hasta);
    clientesRevisados = Math.max(clientesRevisados, d.totalClientesRevisados);
    d.discrepancias.forEach(x => discrepancias.push({ ...x, desde: rg.desde, hasta: rg.hasta }));
    sumaBalance.push(await revisarSumaBalance(grupo.id, rg.desde, rg.hasta));
  }
  const sumasMal = sumaBalance.filter(s => !s.cuadra);
  return { ok: discrepancias.length === 0 && sumasMal.length === 0, semanas: rangos, clientesRevisados, discrepancias, sumaBalance };
}

function fmt(n) { return Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function mensajeDescuadre(r) {
  const partes = [];
  if (r.discrepancias.length) {
    const lista = r.discrepancias.slice(0, 5).map(d => `${d.nombre} (grilla ${fmt(d.totalGrid)} vs link ${fmt(d.totalLink)})`).join('; ');
    partes.push(`${r.discrepancias.length} cliente(s) con la grilla distinta a su link: ${lista}${r.discrepancias.length > 5 ? '…' : ''}`);
  }
  r.sumaBalance.filter(s => !s.cuadra).forEach(s => {
    partes.push(`el balance del ${s.desde} al ${s.hasta} no suma 0 (diferencia ${fmt(s.diferencia)})`);
  });
  return 'Revisión automática de cuadre: ' + partes.join(' | ') + '.';
}

// Corre y GUARDA la revisión de un grupo para la fecha de hoy (Venezuela):
// bitácora (upsert por grupo+fecha) y, si no cuadra, una alerta. `req` es
// opcional: si viene (corrida manual) se usa su nombreActor.
async function ejecutarCuadreGrupo(grupo, { hoy, usuario } = {}) {
  const hoyVe = hoy || hoyVenezuela();
  const fecha = isoFecha(hoyVe);
  let estado = 'ok';
  let detalle;
  try {
    const r = await revisarCuadreGrupo(grupo, { hoy: hoyVe });
    detalle = r;
    if (!r.ok) {
      estado = 'descuadre';
      await db.query(
        `INSERT INTO hipismo_alertas (grupo_id, tipo, usuario, fecha, mensaje) VALUES ($1, 'CUADRE_DESCUADRADO', $2, $3, $4)`,
        [grupo.id, usuario || 'SISTEMA', fecha, mensajeDescuadre(r)]
      );
    }
  } catch (e) {
    estado = 'error';
    detalle = { error: e.message };
  }
  await db.query(
    `INSERT INTO hipismo_cuadre_nocturno (grupo_id, fecha, estado, detalle) VALUES ($1, $2, $3, $4)
     ON CONFLICT (grupo_id, fecha) DO UPDATE SET estado = EXCLUDED.estado, detalle = EXCLUDED.detalle, creado_en = now()`,
    [grupo.id, fecha, estado, JSON.stringify(detalle)]
  );
  return { fecha, estado, detalle };
}

// Una pasada del programador: si ya son las 3:00 a. m. (VE) o más, corre los
// grupos con Hipismo activo que todavía no tengan revisión de hoy. También
// limpia los errores del servidor de más de 30 días.
async function pasadaNocturna({ hoy } = {}) {
  const hoyVe = hoy || hoyVenezuela();
  if (hoyVe.getUTCHours() < HORA_INICIO_VE) return { corridos: 0 };
  const fecha = isoFecha(hoyVe);
  const rGrupos = await db.query('SELECT * FROM grupos WHERE modulo_hipismo_habilitado = true');
  const rHechos = await db.query('SELECT grupo_id FROM hipismo_cuadre_nocturno WHERE fecha = $1', [fecha]);
  const hechos = new Set(rHechos.rows.map(r => r.grupo_id));
  let corridos = 0;
  for (const grupo of rGrupos.rows) {
    if (hechos.has(grupo.id)) continue;
    await ejecutarCuadreGrupo(grupo, { hoy: hoyVe });
    corridos++;
  }
  try { await db.query(`DELETE FROM errores_servidor WHERE creado_en < now() - interval '30 days'`); } catch (e) { /* limpieza opcional */ }
  return { corridos };
}

let temporizador = null;
function iniciarCuadreNocturno() {
  if (temporizador) return;
  let corriendo = false;
  const tick = () => {
    if (corriendo) return;
    corriendo = true;
    pasadaNocturna()
      .catch(err => console.error('[cuadre nocturno] falló la pasada (se reintenta sola):', err.message))
      .finally(() => { corriendo = false; });
  };
  temporizador = setInterval(tick, CADA_MS);
  if (temporizador.unref) temporizador.unref();
  setTimeout(tick, 60 * 1000).unref?.();
}

module.exports = { revisarCuadreGrupo, revisarSumaBalance, ejecutarCuadreGrupo, pasadaNocturna, iniciarCuadreNocturno, mensajeDescuadre, TOLERANCIA_SUMA };
