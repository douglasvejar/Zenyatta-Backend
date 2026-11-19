// =================================================================
// COMPROBACIÓN MANUAL (19-11-2026): Traspasos de Hipismo Oficinas contra un Postgres REAL (PGlite).
// Uso:  PGLITE_DIR=$HOME/pgl node test/manual/traspaso_oficinas_pglite.js
// Prueba: RAUL -50 / LUIS +50 sin 5%, la comisión de la oficina NO cambia, los totales siguen sumando 0, sale como ítem TRASPASO
// (con la contraparte) en la ficha de cada uno y se puede anular.
// =================================================================
const REPO = require('path').join(__dirname, '..', '..');
const PGD = process.env.PGLITE_DIR || process.cwd();
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/x';
process.env.JWT_SECRET = 'x';
const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: [PGD] }));
const { pgcrypto } = require(require.resolve('@electric-sql/pglite/contrib/pgcrypto', { paths: [PGD] }));
const fs = require('fs');
let ok = 0, mal = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK:', m); } else { mal++; console.error('FALLÓ:', m); } };
(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(fs.readFileSync(REPO + '/sql/schema.sql', 'utf8'));
  const q = async (t, p) => { const r = await db.query(t, p || []); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  const fake = { query: q, transaccion: async fn => { await db.exec('BEGIN'); try { const r = await fn({ query: q, release() {} }); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; } } };
  fake.pool = { query: q, on() {}, connect: async () => ({ query: q, release() {} }) };
  const dbPath = require.resolve(REPO + '/src/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };
  process.chdir(REPO);

  const g = (await q(`insert into grupos (nombre,email,password_hash,activo,modulo_hipismo_habilitado,modulo_hipismo_oficinas_habilitado) values ('Prueba','g@x.com','x',true,true,true) returning id`)).rows[0].id;
  for (const n of ['RAUL', 'LUIS', 'ZEUS']) await q(`insert into jugadores (grupo_id,nombre,tipo_cuenta,pozo_inicial) values ($1,$2,'libre',0)`, [g, n]);
  const hoy = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
  // Una carrera real: ZEUS gana 95 (100 menos el 5%) a RAUL; LUIS no jugó. Comisión de la oficina = 5.
  const p = (await q(`insert into hipismo_planos (grupo_id,hipodromo_nombre,carrera_numero,fecha,pizarra,texto_original,texto_resultado,comision_total) values ($1,'Belmont Park',3,$2,'1.2.3','x','x',5) returning id`, [g, hoy])).rows[0].id;
  await q(`insert into hipismo_tickets (plano_id,grupo_id,cliente_nombre,banquero_nombre,modalidad,caballo,monto,resultado_jugador,resultado_banquero) values ($1,$2,'ZEUS','RAUL','1p','3',100,95,-100)`, [p, g]);

  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.superadminGrupoId = g; next(); });
  app.use('/h', require(REPO + '/src/routes/hipismo'));
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const api = async (m, u, body) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const cierre = async () => { const r = await api('GET', '/h/cierre-final?desde=' + hoy + '&hasta=' + hoy); return r.j; };
  const saldo = (c, n) => { const f = (c.clientes || []).find(x => x.nombre === n); return f ? Math.round(f.saldo * 100) / 100 : 0; };

  const antes = await cierre();
  console.log('   cierre antes:', JSON.stringify({ comision: antes.comisionSemana, RAUL: saldo(antes, 'RAUL'), LUIS: saldo(antes, 'LUIS'), ZEUS: saldo(antes, 'ZEUS') }));
  check(saldo(antes, 'RAUL') === -100 && saldo(antes, 'ZEUS') === 95, 'antes: RAUL -100, ZEUS +95 (la carrera real con su 5% de comisión)');

  let r = await api('POST', '/h/comisiones/traspaso', { clienteOrigen: 'raul', clienteDestino: 'Luis', monto: 50, fecha: hoy, nota: '' });
  check(r.s === 200, 'traspaso de RAUL a LUIS por 50 se registra');
  const desp = await cierre();
  console.log('   cierre después:', JSON.stringify({ comision: desp.comisionSemana, RAUL: saldo(desp, 'RAUL'), LUIS: saldo(desp, 'LUIS'), ZEUS: saldo(desp, 'ZEUS') }));
  check(saldo(desp, 'RAUL') === saldo(antes, 'RAUL') - 50, 'RAUL queda −50 respecto a antes');
  check(saldo(desp, 'LUIS') === saldo(antes, 'LUIS') + 50, 'LUIS queda +50 respecto a antes (sin 5%: el monto exacto)');
  check(saldo(desp, 'ZEUS') === saldo(antes, 'ZEUS'), 'los demás clientes no cambian');
  check(Number(desp.comisionSemana) === Number(antes.comisionSemana), 'la comisión de la oficina NO cambia (' + antes.comisionSemana + ' → ' + desp.comisionSemana + ')');
  const suma = (c) => Math.round(((c.clientes || []).reduce((s, x) => s + x.saldo, 0) + Number(c.comisionSemana)) * 100) / 100;
  check(suma(antes) === 0 && suma(desp) === 0, 'saldo de todos los clientes + comisión sigue dando 0 antes y después');

  const det = async (n) => (await api('GET', '/h/clientes/' + encodeURIComponent(n) + '/detalle-semana?formato=oficinas&desde=' + hoy + '&hasta=' + hoy)).j;
  const lineasTras = (d) => (d.dias || []).flatMap(x => x.hipodromos || []).flatMap(h => h.carreras || []).filter(l => l.tipo === 'traspaso');
  const dl = await det('LUIS'), dr = await det('RAUL');
  const ll = lineasTras(dl), lr = lineasTras(dr);
  check(ll.length === 1 && ll[0].resultado === 50 && ll[0].contraparte === 'RAUL', 'ficha de LUIS: ítem traspaso +50 con contraparte RAUL');
  check(lr.length === 1 && lr[0].resultado === -50 && lr[0].contraparte === 'LUIS', 'ficha de RAUL: ítem traspaso −50 con contraparte LUIS');

  // Lo mismo que hace la pantalla para escribir el ítem.
  global.window = {}; global.document = {};
  const INF = (function () { try { require(REPO + '/public/oficinas-informes.js'); } catch (e) {} return global.window.OficinasInformes; })();
  if (INF) {
    const a = INF.armarDetalleCliente(dl), b = INF.armarDetalleCliente(dr);
    const txt = (x) => JSON.stringify(x);
    check(/TRASPASO de Raul/.test(txt(a)) && /TRASPASO a Luis/.test(txt(b)), 'la pantalla lo escribe "TRASPASO de Raul" en LUIS y "TRASPASO a Luis" en RAUL');
  }

  const lista = (await api('GET', '/h/traspasos-saldo')).j.traspasos;
  check(lista.length === 1 && lista[0].origen === 'RAUL' && lista[0].destino === 'LUIS' && lista[0].monto === 50, 'el historial lo muestra RAUL → LUIS por 50');
  r = await api('POST', '/h/comisiones/traspaso', { clienteOrigen: 'RAUL', clienteDestino: 'RAUL', monto: 5 });
  check(r.s === 400, 'no se puede traspasar a sí mismo');
  r = await api('POST', '/h/comisiones/traspaso', { clienteOrigen: 'RAUL', clienteDestino: 'NADIE', monto: 5 });
  check([400, 404, 422].includes(r.s), 'un destino que no existe se rechaza (' + r.s + ')');
  r = await api('DELETE', '/h/traspasos-saldo/' + lista[0].id);
  const fin = await cierre();
  check(r.s === 200 && saldo(fin, 'RAUL') === saldo(antes, 'RAUL') && saldo(fin, 'LUIS') === saldo(antes, 'LUIS'), 'al anular, los saldos vuelven a como estaban');

  console.log(mal ? '\n' + mal + ' FALLARON' : '\nTODO OK (' + ok + ')');
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
