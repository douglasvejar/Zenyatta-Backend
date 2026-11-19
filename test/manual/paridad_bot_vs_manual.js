// =================================================================
// COMPROBACIÓN MANUAL (19-11-2026): "el bot registra y calcula" vs "se carga a mano", contra un Postgres REAL (PGlite) con el
// esquema completo (sql/schema.sql). Carga las mismas 3 jugadas de las dos formas, resuelve la carrera con la misma pizarra y
// compara fila por fila TODAS las tablas. Diferencias esperadas: el texto del plano (el bot muestra las jugadas en TERCIOS), la
// marca del plano de adelantadas y la tabla hipismo_chat_jugadas (solo del bot). Todo lo demás debe ser idéntico.
// No es parte de `npm test` (necesita @electric-sql/pglite, que no es dependencia del proyecto). Uso:
//   mkdir /tmp/pgl && cd /tmp/pgl && npm init -y && npm i @electric-sql/pglite
//   PGLITE_DIR=/tmp/pgl node test/manual/paridad_bot_vs_manual.js
// =================================================================
// Compara "cargar a mano" vs "el bot registra" contra Postgres real (PGlite) con el esquema completo.
const REPO = require('path').join(__dirname, '..', '..');
const PGD = process.env.PGLITE_DIR || process.cwd();
const OUT = require('os').tmpdir();
const modo = process.argv[2]; // 'manual' | 'bot' (sin argumento: corre los dos y compara)
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/x';
const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: [PGD] }));
const { pgcrypto } = require(require.resolve('@electric-sql/pglite/contrib/pgcrypto', { paths: [PGD] }));
const fs = require('fs');

if (!process.argv[2]) {
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  for (const m of ['manual', 'bot']) { const r = spawnSync(process.execPath, [__filename, m], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env }); if (r.status) process.exit(r.status); }
  const a = JSON.parse(fs.readFileSync(require('os').tmpdir() + '/dump_manual.json')), b = JSON.parse(fs.readFileSync(require('os').tmpdir() + '/dump_bot.json'));
  const esperadas = ['hipismo_planos', 'hipismo_tercios_adelantadas_planos', 'hipismo_chat_jugadas', 'hipismo_alertas'];
  let mal = 0;
  for (const t of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (JSON.stringify(a[t]) === JSON.stringify(b[t])) continue;
    console.log((esperadas.includes(t) ? 'diferencia esperada: ' : 'DIFERENCIA INESPERADA: ') + t);
    if (!esperadas.includes(t)) mal++;
  }
  console.log(mal ? 'HAY DIFERENCIAS INESPERADAS' : 'OK: el bot y la carga a mano dejan los mismos datos (tickets, adelantadas, saldos).');
  process.exit(mal ? 1 : 0);
}
(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(fs.readFileSync(REPO + '/sql/schema.sql', 'utf8'));
  const q = async (t, p) => { const r = await db.query(t, p || []); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  const fake = { query: q, transaccion: async fn => { await db.exec('BEGIN'); try { const r = await fn({ query: q, release() {} }); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; } } };
  fake.pool = { query: q, on() {}, connect: async () => ({ query: q, release() {} }) };
  const dbPath = require.resolve(REPO + '/src/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };
  process.chdir(REPO);

  // --- datos base ---
  const g = (await q(`insert into grupos (nombre,email,password_hash,activo) values ('Prueba Sabanas','g@x.com','x',true) returning id`)).rows[0].id;
  for (const [n, pz] of [['TYKHE', 230], ['GOKU', 2000], ['LUIS', 2000]]) await q(`insert into jugadores (grupo_id,nombre,tipo_cuenta,pozo_inicial) values ($1,$2,'avalado',$3)`, [g, n, pz]);
  await q(`insert into hipismo_hipodromos (grupo_id,nombre,pais) values ($1,'Belmont Park','US')`, [g]);

  const motor = require(REPO + '/src/services/hipismoJugadasChat');
  const apuestaReal = t => motor.interpretarOferta(t).apuesta;
  const FECHA = '2026-11-18', HIP = 'Belmont Park', CARRERA = 6;
  const JUGADAS = [
    { j: 'TYKHE', b: 'GOKU', texto: 'TYKHE JUEGA 3N DEL 8 200 DA GOKU', apuesta: apuestaReal('Juego 3n del 8 con 200'), monto: 200 },
    { j: 'LUIS', b: 'TYKHE', texto: 'LUIS JUEGA 2P DEL 5 300 DA TYKHE', apuesta: apuestaReal('Juego 2p del 5 con 300'), monto: 300 },
    { j: 'GOKU', b: 'LUIS', texto: 'GOKU JUEGA 4X1 10A8 100 DA LUIS', apuesta: apuestaReal('Juego 4x1 con 100 doy a8'), monto: 100 }
  ];
  const router = require(REPO + '/src/routes/hipismo');

  if (modo === 'manual') {
    const layer = router.stack.find(l => l.route && l.route.path === '/tercios-adelantadas' && l.route.methods.post);
    const h = layer.route.stack[layer.route.stack.length - 1].handle;
    const texto = '*JUGADAS ADELANTADAS ' + HIP.toUpperCase() + '*\n\n*' + CARRERA + 'TA CARRERA*\n' + JUGADAS.map(x => '*' + x.texto + '*').join('\n') + '\n';
    let out = null;
    await new Promise((ok, no) => {
      const res = { status(c) { this.c = c; return this; }, json(b) { out = { c: this.c, b }; ok(); return this; } };
      h({ grupoId: g, grupo: { nombre: 'Prueba Sabanas' }, nombreActor: 'Operador', rol: 'admin', body: { texto, hipodromoNombre: HIP, fecha: FECHA, comisionPorcentaje: '' }, query: {}, params: {} }, res, no);
    });
    console.error('manual save:', JSON.stringify(out).slice(0, 400));
  } else {
    const bot = require(REPO + '/src/services/hipismoJugadasChatBot');
    for (const x of JUGADAS) {
      const r = { jugador: 1, banquero: 1 };
      await bot.guardarJugada(g, { fecha: FECHA, hipodromo: HIP, carrera: CARRERA, jugadorNombre: x.j, banqueroNombre: x.b, apuesta: x.apuesta, monto: x.monto, riesgoJugador: x.monto, riesgoBanquero: x.monto, textoLinea: x.texto });
    }
  }
  // --- cargar la pizarra (igual en los dos) ---
  const out = await router.guardarPlanoParaBot(g, { texto: '', pizarra: '8.5.1.4', hipodromoNombre: HIP, carreraNumero: CARRERA, fecha: FECHA, ret: '' });
  console.error('plano status', out.status, out.body && out.body.error ? out.body.error : '');

  // --- volcado normalizado ---
  const tablas = (await q(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)).rows.map(r => r.table_name);
  const dump = {};
  for (const t of tablas) {
    const rows = (await q(`select * from "${t}"`)).rows;
    if (!rows.length) continue;
    dump[t] = rows.map(r => { const o = {}; for (const k of Object.keys(r)) { if (/(^|_)id$|_en$|^token$|^creado|^actualizado/.test(k)) continue; let v = r[k]; if (v instanceof Date) v = v.toISOString().slice(0, 10); o[k] = v; } return JSON.stringify(o); }).sort();
  }
  fs.writeFileSync(OUT + '/dump_' + modo + '.json', JSON.stringify(dump, null, 1));
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
