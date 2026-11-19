// =================================================================
// COMPROBACIÓN MANUAL (19-11-2026): API de la pestaña JUGADAS BOT IA contra un Postgres REAL (PGlite) con el esquema completo.
// Uso:  mkdir /tmp/pgl && cd /tmp/pgl && npm init -y && npm i @electric-sql/pglite
//       PGLITE_DIR=/tmp/pgl node test/manual/api_jugadas_bot_pglite.js
// =================================================================
const REPO = require('path').join(__dirname, '..', '..');
const PGD = process.env.PGLITE_DIR || process.cwd();
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/x';
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

  const g = (await q(`insert into grupos (nombre,email,password_hash,activo,hipismo_chat_habilitado) values ('Prueba','g@x.com','x',true,true) returning id`)).rows[0].id;
  for (const [n, pz] of [['TYKHE', 2000], ['GOKU', 2000], ['LUIS', 2000]]) await q(`insert into jugadores (grupo_id,nombre,tipo_cuenta,pozo_inicial) values ($1,$2,'avalado',$3)`, [g, n, pz]);
  await q(`insert into hipismo_hipodromos (grupo_id,nombre,pais) values ($1,'Belmont Park','US')`, [g]);

  const express = require('express');
  const hipismo = require(REPO + '/src/routes/hipismo'); // ya trae montado /bot (y el manejador de Cargar Planos)
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.grupoId = g; req.nombreActor = 'Prueba'; req.grupo = { id: g, modulo_hipismo_habilitado: true }; next(); });
  const crear = require(REPO + '/src/routes/hipismoJugadasBot');
  app.use('/bot', crear({ registrarAlerta: async () => {}, hipismoPlanosPapelera: require(REPO + '/src/services/hipismoPlanosPapelera') }));
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port + '/bot';
  const api = async (m, u, body) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const FECHA = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), HIP = 'Belmont Park';
  const Q = '?fecha=' + FECHA + '&hipodromo=' + encodeURIComponent(HIP) + '&carrera=5';

  let r = await api('GET', '/estado');
  check(r.s === 200 && r.j.habilitado === true && r.j.faltanPizarra === 0, 'estado: el grupo tiene el bot y no falta ninguna pizarra');

  r = await api('POST', '/jugadas', { fecha: FECHA, hipodromo: HIP, carrera: 5, jugador: 'tykhe', banquero: 'goku', apuesta: '3n del 8', monto: 200 });
  check(r.s === 201 && r.j.id, 'agregar una jugada que faltó: Tykhe 3N (8) con 200 da Goku');
  const idA = r.j.id;
  r = await api('POST', '/jugadas', { fecha: FECHA, hipodromo: HIP, carrera: 5, jugador: 'LUIS', banquero: 'TYKHE', apuesta: '4x1 doy a8', monto: 100 });
  check(r.s === 201, 'agregar Luis 4x1 10a8 con 100 da Tykhe');
  const idB = r.j.id;
  r = await api('POST', '/jugadas', { fecha: FECHA, hipodromo: HIP, carrera: 5, jugador: 'nadie', banquero: 'GOKU', apuesta: '3n del 8', monto: 10 });
  check(r.s === 400 && /No encontré al cliente que juega/.test(r.j.error), 'un cliente que no existe se rechaza con explicación');
  r = await api('POST', '/jugadas', { fecha: FECHA, hipodromo: HIP, carrera: 5, jugador: 'LUIS', banquero: 'GOKU', apuesta: 'cosa rara', monto: 10 });
  check(r.s === 400 && /No entendí la apuesta/.test(r.j.error), 'una apuesta mal escrita se rechaza con explicación');

  r = await api('GET', '/planos');
  let f = r.j.planos[0];
  check(r.s === 200 && r.j.planos.length === 1 && f.jugadas === 2 && f.total === 300 && f.estado === 'abierta' && f.carrera === 5, 'lista de planos: 1 carrera, 2 jugadas, 300 en total, carrera abierta (sin alerta todavía)');
  await q(`update hipismo_chat_jugadas set cerrada_en = now() - interval '15 minutes'`);
  r = await api('GET', '/planos');
  f = r.j.planos[0];
  check(f.estado === 'falta_pizarra' && f.minutosSinPizarra === 15 && r.j.faltanPizarra === 1, 'cerrada hace 15 min y sin pizarra: estado FALTA PIZARRA (15 min) y cuenta en la alerta');
  r = await api('GET', '/estado');
  check(r.j.faltanPizarra === 1, 'el estado del menú avisa 1 carrera esperando pizarra');

  r = await api('GET', '/planos/jugadas' + Q);
  check(r.j.jugadas.length === 2 && r.j.jugadas[0].apuestaTexto === '3n del 8' && r.j.jugadas[1].apuestaTexto === '4x1 doy a8' && r.j.jugadas.every(x => x.editable), 'detalle: jugadas con la apuesta en texto editable, todas editables');
  r = await api('PUT', '/jugadas/' + idA, { jugador: 'TYKHE', banquero: 'GOKU', apuesta: '2p del 8', monto: 250 });
  check(r.s === 200, 'editar la jugada A: ahora 2p del 8 con 250');
  const fila = (await q('select monto::float m, apuesta, riesgo_jugador::float rj from hipismo_chat_jugadas where id = $1', [idA])).rows[0];
  check(fila.m === 250 && (typeof fila.apuesta === 'string' ? JSON.parse(fila.apuesta) : fila.apuesta).modalidad === '2p' && fila.rj === 250, 'la jugada quedó con el monto y la apuesta nuevos');
  r = await api('DELETE', '/jugadas/' + idB);
  check(r.s === 200 && (await q('select count(*)::int n from hipismo_chat_jugadas')).rows[0].n === 1, 'eliminar la jugada B');
  r = await api('POST', '/jugadas', { fecha: FECHA, hipodromo: HIP, carrera: 5, jugador: 'LUIS', banquero: 'TYKHE', apuesta: '4x1 doy a8', monto: 100 });
  check(r.s === 201, 'volver a agregarla');

  r = await api('POST', '/pizarra', { fecha: FECHA, hipodromo: HIP, carrera: 5, pizarra: '8 5 1 4' });
  check(r.s === 200 && r.j.ok && /Belmont Park/.test(r.j.texto), 'poner la pizarra 8 5 1 4: calcula igual que Cargar Planos');
  const t = (await q('select count(*)::int n from hipismo_tickets')).rows[0].n;
  check(t === 2 && (await q('select count(*)::int n from hipismo_planos')).rows[0].n === 1 && (await q('select count(*)::int n from hipismo_tercios_adelantadas_jugadas')).rows[0].n === 0, 'quedó 1 plano con 2 tickets y nada en adelantadas');
  r = await api('GET', '/planos');
  f = r.j.planos[0];
  check(f.estado === 'calculado' && f.pizarra === '8.5.1.4' && f.pendientes === 0 && r.j.faltanPizarra === 0, 'la carrera pasa a CALCULADO con su pizarra y se quita la alerta');
  r = await api('PUT', '/jugadas/' + idA, { jugador: 'TYKHE', banquero: 'GOKU', apuesta: '3n del 8', monto: 100 });
  check(r.s === 409 && /ya fue calculada/.test(r.j.error), 'una jugada calculada ya no se edita (hay que reabrir)');
  r = await api('POST', '/jugadas', { fecha: FECHA, hipodromo: HIP, carrera: 5, jugador: 'LUIS', banquero: 'GOKU', apuesta: '3n del 8', monto: 10 });
  check(r.s === 409 && /Reábrela primero/.test(r.j.error), 'agregar a una carrera calculada se rechaza');
  r = await api('POST', '/pizarra', { fecha: FECHA, hipodromo: HIP, carrera: 5, pizarra: '1 2 3 4' });
  check(r.s === 400, 'poner otra pizarra a una carrera ya calculada se rechaza');

  // saldos antes de reabrir
  const saldoAntes = (await q('select count(*)::int n from hipismo_tickets')).rows[0].n;
  r = await api('POST', '/reabrir', { fecha: FECHA, hipodromo: HIP, carrera: 5 });
  check(r.s === 200, 'reabrir la carrera calculada');
  check((await q('select count(*)::int n from hipismo_planos')).rows[0].n === 0 && (await q('select count(*)::int n from hipismo_tickets')).rows[0].n === 0 && saldoAntes === 2, 'el plano se fue a la papelera: sin plano ni tickets');
  r = await api('GET', '/planos');
  check(r.j.planos[0].estado === 'falta_pizarra' && r.j.planos[0].pendientes === 2, 'las 2 jugadas vuelven a estar en espera (falta pizarra)');
  r = await api('PUT', '/jugadas/' + idA, { jugador: 'TYKHE', banquero: 'GOKU', apuesta: '3n del 8', monto: 100 });
  check(r.s === 200, 'ahora sí se puede editar otra vez');
  r = await api('POST', '/pizarra', { fecha: FECHA, hipodromo: HIP, carrera: 5, pizarra: '5 8 1 4', ret: '' });
  check(r.s === 200, 'y se vuelve a poner la pizarra (otra llegada)');
  const plano = (await q('select pizarra from hipismo_planos')).rows;
  check(plano.length === 1 && plano[0].pizarra === '5.8.1.4', 'queda un solo plano, con la pizarra nueva');

  await q('update grupos set hipismo_chat_habilitado = false');
  r = await api('GET', '/planos');
  check(r.s === 403, 'un grupo sin el bot contratado no puede usar la pestaña (403)');
  r = await api('GET', '/estado');
  check(r.s === 200 && r.j.habilitado === false, 'y el estado dice habilitado = false (la pestaña no aparece)');

  console.log('\n' + ok + ' OK, ' + mal + ' fallaron.');
  srv.close(); process.exit(mal ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
