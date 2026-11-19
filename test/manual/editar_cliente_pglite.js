// =================================================================
// COMPROBACIÓN MANUAL (19-11-2026): editar un cliente (nombre y %) contra un Postgres REAL (PGlite) con el esquema completo.
// Uso:  PGLITE_DIR=$HOME/pgl node test/manual/editar_cliente_pglite.js
// Prueba: (1) cambiar el % recalcula "Comisiones devueltas" de TODAS sus carreras (de hoy y de días anteriores);
//         (2) renombrar mueve el nombre en tickets, jugadas de oficina (JSON), pendientes, winners, ajustes, textos, chat y pozos excluidos;
//         (3) un nombre ya usado se rechaza y no cambia nada; (4) un nombre que es parte de otro cliente no toca los textos.
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
  const ins = async (n, pozo, extra) => (await q(`insert into jugadores (grupo_id,nombre,tipo_cuenta,pozo_inicial) values ($1,$2,'avalado',$3) returning id`, [g, n, pozo])).rows[0].id;
  const idPedro = await ins('PEDRO', 1000), idMaria = await ins('MARIA', 1000), idPLuis = await ins('PEDRO LUIS', 1000), idOtro = await ins('ZEUS', 1000);
  const hoy = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 28 * 3600e3).toISOString().slice(0, 10);
  const plano = async (fecha, carrera, texto, oficina) => {
    const p = (await q(`insert into hipismo_planos (grupo_id,hipodromo_nombre,carrera_numero,fecha,pizarra,texto_original,texto_resultado,comision_total,jugadas_oficina) values ($1,'Belmont Park',$2,$3,'1.2.3',$4,$4,0,$5) returning id`, [g, carrera, fecha, texto, oficina ? JSON.stringify(oficina) : null])).rows[0].id;
    await q(`insert into hipismo_tickets (plano_id,grupo_id,cliente_nombre,banquero_nombre,modalidad,caballo,monto,resultado_jugador,resultado_banquero) values ($1,$2,'PEDRO','MARIA','1p','3',100,-100,100)`, [p, g]);
    await q(`insert into hipismo_tickets (plano_id,grupo_id,cliente_nombre,banquero_nombre,modalidad,caballo,monto,resultado_jugador,resultado_banquero) values ($1,$2,'ZEUS','PEDRO','1p','4',50,50,-50)`, [p, g]);
    return p;
  };
  await plano(hoy, 3, 'Juega PEDRO 1P (3) con 100 da MARIA\nJuega ZEUS 1P (4) con 50 da PEDRO\nJuega PEDRO LUIS 1P (5) con 10 da MARIA', [{ jugador: 'PEDRO', lado: 'jugo', tipo: '1p', caballo: '3', monto: 100 }, { jugador: 'MARIA', lado: 'dio', tipo: '1p', caballo: '3', monto: 100 }]);
  await plano(ayer, 6, 'Juega PEDRO 1P (3) con 100 da MARIA', [{ jugador: 'PEDRO', lado: 'jugo', tipo: '1p', caballo: '3', monto: 100 }]);
  await q(`insert into hipismo_oficinas_pendientes (grupo_id,hipodromo_nombre,carrera_numero,fecha,jugadas) values ($1,'Belmont Park',8,$2,$3)`, [g, hoy, JSON.stringify([{ jugador: 'PEDRO', lado: 'jugo', tipo: '1p', caballo: '1', monto: 20 }, { jugador: 'ZEUS', lado: 'dio', tipo: '1p', caballo: '1', monto: 20 }])]);
  await q(`insert into hipismo_comisiones_ajustes (grupo_id,cliente_nombre,monto,fecha) values ($1,'PEDRO',25,$2)`, [g, hoy]);
  await q(`insert into hipismo_pozos_excluidos (grupo_id,nombre) values ($1,'PEDRO')`, [g]);
  await q(`insert into hipismo_chat_numeros (grupo_id,digitos,jugador_nombre) values ($1,'584141234567','PEDRO')`, [g]);

  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.superadminGrupoId = g; next(); });
  app.use('/j', require(REPO + '/src/routes/jugadores'));
  app.use('/h', require(REPO + '/src/routes/hipismo'));
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const api = async (m, u, body) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const cuerpo = (nombre, pct, extra) => Object.assign({ nombre, telefono: '', notas: '', activo: true, tipoCuenta: 'avalado', pozoInicial: 1000, comisionPropia: pct, incluirPorcentajeEnJugadas: true, comisionPropiaFicha: '', avalesPorcentaje: [], moneda: 'USD', modeloComision: null, modulosAnclados: false }, extra || {});
  // Total devuelto de un cliente en un rango (la misma ruta que usan los reportes de Oficinas).
  const devuelto = async (nombre) => {
    const r = await api('GET', '/h/comisiones-devueltas?desde=' + ayer + '&hasta=' + hoy);
    const txt = JSON.stringify(r.j);
    const lista = (r.j && (r.j.clientes || r.j.filas || r.j.items)) || [];
    const f = lista.find(x => (x.cliente || x.nombre) === nombre);
    return { r, f, txt };
  };

  let d = await devuelto('PEDRO');
  check(d.r.s === 200, 'comisiones-devueltas responde (' + d.r.s + ')');
  check(!d.f, 'sin % configurado, PEDRO no devuelve nada');

  // (1) Agregar un % recalcula todas sus carreras (las de hoy y la de ayer).
  let r = await api('PUT', '/j/' + idPedro, cuerpo('Pedro', 1));
  check(r.s === 200 && r.j.renombrado === false, 'PUT con el mismo nombre (Pedro -> PEDRO) no renombra nada');
  d = await devuelto('PEDRO');
  const total1 = d.f ? Number(d.f.total ?? d.f.devuelto ?? d.f.monto) : null;
  console.log('   devuelto 1% =', d.f && JSON.stringify(d.f).slice(0, 200));
  check(d.f && total1 === 3, 'con 1% PEDRO devuelve 3.00: 1% de (100 + 50 de hoy en dos carreras... ) = lo apostado en las 2 carreras');
  r = await api('PUT', '/j/' + idPedro, cuerpo('PEDRO', 2));
  d = await devuelto('PEDRO');
  const total2 = d.f ? Number(d.f.total ?? d.f.devuelto ?? d.f.monto) : null;
  check(total2 === 6, 'al subir a 2% se recalculan TODAS sus carreras sin tocar nada más: 6.00 (era 3.00)');
  r = await api('PUT', '/j/' + idPedro, cuerpo('PEDRO', 0));
  d = await devuelto('PEDRO');
  check(!d.f, 'al quitarle el % desaparece lo que devolvía');
  await api('PUT', '/j/' + idPedro, cuerpo('PEDRO', 2));

  // (3) Nombre repetido: se rechaza y no cambia nada.
  r = await api('PUT', '/j/' + idPedro, cuerpo('MARIA', 2));
  check(r.s === 409, 'renombrar a un nombre que ya existe da 409');
  let n = (await q(`select count(*)::int c from hipismo_tickets where grupo_id=$1 and (cliente_nombre='PEDRO' or banquero_nombre='PEDRO')`, [g])).rows[0].c;
  check(n === 4, 'tras el rechazo, los tickets siguen con el nombre PEDRO (4 líneas)');

  // (2)+(4) Renombrar PEDRO -> PEDRITO con % nuevo. "PEDRO LUIS" es otro cliente: sus datos NO se tocan.
  await q(`insert into hipismo_tickets (plano_id,grupo_id,cliente_nombre,banquero_nombre,modalidad,caballo,monto,resultado_jugador,resultado_banquero) select id,grupo_id,'PEDRO LUIS','MARIA','1p','5',10,10,-10 from hipismo_planos where grupo_id=$1 and carrera_numero=3`, [g]);
  r = await api('PUT', '/j/' + idPedro, cuerpo('Pedrito', 2));
  check(r.s === 200 && r.j.nombre === 'PEDRITO' && r.j.renombrado === true && r.j.carrerasRenombradas === 2, 'renombrar a PEDRITO responde ok y dice que tocó 2 carreras');
  const cnt = async (sql) => (await q(sql, [g])).rows[0].c;
  check(await cnt(`select count(*)::int c from hipismo_tickets where grupo_id=$1 and (cliente_nombre='PEDRO' or banquero_nombre='PEDRO')`) === 0, 'ya no quedan tickets con PEDRO');
  check(await cnt(`select count(*)::int c from hipismo_tickets where grupo_id=$1 and (cliente_nombre='PEDRITO' or banquero_nombre='PEDRITO')`) === 4, 'los 4 tickets ahora son de PEDRITO (2 como jugador y 2 como banquero)');
  check(await cnt(`select count(*)::int c from hipismo_tickets where grupo_id=$1 and cliente_nombre='PEDRO LUIS'`) === 1, 'los tickets de PEDRO LUIS no se tocaron');
  const jo = (await q(`select jugadas_oficina from hipismo_planos where grupo_id=$1 order by carrera_numero`, [g])).rows.map(x => typeof x.jugadas_oficina === 'string' ? JSON.parse(x.jugadas_oficina) : x.jugadas_oficina);
  check(jo[0][0].jugador === 'PEDRITO' && jo[0][1].jugador === 'MARIA' && jo[1][0].jugador === 'PEDRITO', 'las jugadas de oficina guardadas (JSON) llevan PEDRITO y conservan el resto');
  const pe = (await q(`select jugadas from hipismo_oficinas_pendientes where grupo_id=$1`, [g])).rows[0].jugadas;
  const pj = typeof pe === 'string' ? JSON.parse(pe) : pe;
  check(pj[0].jugador === 'PEDRITO' && pj[1].jugador === 'ZEUS', 'la carrera pendiente de llegada también');
  check(await cnt(`select count(*)::int c from hipismo_comisiones_ajustes where grupo_id=$1 and cliente_nombre='PEDRITO'`) === 1, 'su ajuste de comisión sigue siendo suyo');
  check(await cnt(`select count(*)::int c from hipismo_pozos_excluidos where grupo_id=$1 and nombre='PEDRITO'`) === 1, 'sigue excluido del plano de pozos con su nombre nuevo');
  check(await cnt(`select count(*)::int c from hipismo_chat_numeros where grupo_id=$1 and jugador_nombre='PEDRITO'`) === 1, 'su número de WhatsApp del bot sigue asociado a él');
  const tx = (await q(`select texto_resultado from hipismo_planos where grupo_id=$1 and carrera_numero=3`, [g])).rows[0].texto_resultado;
  check(/Juega PEDRO LUIS 1P/.test(tx) && /Juega PEDRO 1P/.test(tx), 'con PEDRO LUIS existiendo, los textos libres NO se tocan (sería ambiguo)');
  d = await devuelto('PEDRITO');
  check(d.f && Number(d.f.total ?? d.f.devuelto ?? d.f.monto) === 6, 'PEDRITO conserva su historial y su 2%: 6.00 (no se perdió nada con el cambio de nombre)');
  d = await devuelto('PEDRO');
  check(!d.f, 'no quedó ningún cliente fantasma PEDRO en el reporte');

  // Sin cliente parecido: los textos sí se actualizan (palabra completa).
  r = await api('PUT', '/j/' + idOtro, cuerpo('Zeus II', 0));
  const tx2 = (await q(`select texto_resultado from hipismo_planos where grupo_id=$1 and carrera_numero=3`, [g])).rows[0].texto_resultado;
  check(r.s === 200 && /Juega ZEUS II 1P \(4\) con 50 da PEDRO/.test(tx2), 'sin otro cliente parecido, los textos del plano también cambian (palabra completa)');
  check(/Juega PEDRO LUIS 1P/.test(tx2), '...y el resto del texto queda intacto');

  console.log(mal ? '\n' + mal + ' FALLARON' : '\nTODO OK (' + ok + ')');
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
