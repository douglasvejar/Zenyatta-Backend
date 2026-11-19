// Editar cliente (19-11-2026): el renombrado mueve el nombre en todas las tablas de Hipismo y la pantalla de Oficinas tiene el botón Editar.
// La prueba contra un Postgres real está en test/manual/editar_cliente_pglite.js.
const fs = require('fs');
const path = require('path');
const { renombrarClienteEnHipismo, COLUMNAS_NOMBRE, _esAmbiguoEnTextos } = require('../src/services/hipismoRenombrarCliente');
let ok = 0, mal = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK:', m); } else { mal++; console.error('FALLÓ:', m); } };

(async () => {
  const log = [];
  const cliente = (opts) => ({ query: async (sql, p) => {
    const s = sql.replace(/\s+/g, ' ').trim(); log.push({ s, p });
    if (opts && opts.sinTabla && /hipismo_winners/.test(s) && /^UPDATE/.test(s)) { const e = new Error('no existe'); e.code = '42P01'; throw e; }
    if (/^SELECT \(SELECT COUNT/.test(s)) return { rows: [{ n: '3' }] };
    return { rows: [] };
  } });

  let r = await renombrarClienteEnHipismo(cliente(), 'g1', 'pedro', 'Pedrito', ['MARIA']);
  check(r.renombrado === true && r.carreras === 3, 'renombra y cuenta las carreras que toca (' + r.carreras + ')');
  const ups = log.filter(x => /^UPDATE hipismo_\w+ SET (\w+) = \$3 WHERE grupo_id = \$1 AND \1 = \$2$/.test(x.s));
  check(ups.length === COLUMNAS_NOMBRE.length + 1, 'una actualización por cada tabla/columna con nombre de cliente, más la lista de excluidos del plano de pozos (' + ups.length + ')');
  check(ups.every(x => x.p[0] === 'g1' && x.p[1] === 'PEDRO' && x.p[2] === 'PEDRITO'), 'siempre dentro del grupo y con el nombre normalizado en mayúscula');
  ['hipismo_tickets', 'hipismo_winners', 'hipismo_comisiones_ajustes', 'hipismo_adelantadas_jugadas', 'hipismo_tercios_adelantadas_jugadas', 'hipismo_remate_apuestas', 'hipismo_chat_jugadas', 'hipismo_chat_numeros', 'hipismo_cargas_especiales_lineas'].forEach(t =>
    check(ups.some(x => x.s.includes('UPDATE ' + t + ' ')), 'cubre ' + t));
  check(log.some(x => /UPDATE hipismo_planos SET jugadas_oficina/.test(x.s)) && log.some(x => /UPDATE hipismo_oficinas_pendientes SET jugadas/.test(x.s)), 'cubre las jugadas de oficina guardadas como JSON');
  check(log.some(x => /regexp_replace\(texto_resultado/.test(x.s)), 'actualiza los textos de los planos cuando el nombre no es ambiguo');

  log.length = 0;
  await renombrarClienteEnHipismo(cliente(), 'g1', 'PEDRO', 'PEDRITO', ['PEDRO LUIS']);
  check(!log.some(x => /regexp_replace/.test(x.s)) && log.some(x => /UPDATE hipismo_tickets SET cliente_nombre/.test(x.s)), 'si hay otro cliente "PEDRO LUIS", los textos no se tocan pero los datos sí');
  check(_esAmbiguoEnTextos('PEDRO', ['MARIA PEDRO GOMEZ']) && !_esAmbiguoEnTextos('PEDRO', ['PEDROZA', 'MARIA']), 'ambigüedad por palabras completas (PEDROZA no cuenta)');

  log.length = 0;
  r = await renombrarClienteEnHipismo(cliente({ sinTabla: true }), 'g1', 'A', 'B', []);
  check(r.renombrado && log.some(x => /ROLLBACK TO SAVEPOINT/.test(x.s)), 'una tabla que no existe en una base vieja se salta sin romper el resto');

  log.length = 0;
  r = await renombrarClienteEnHipismo(cliente(), 'g1', 'Pedro', ' PEDRO ', []);
  check(r.renombrado === false && log.length === 0, 'mismo nombre (solo cambia mayúsculas/espacios): no hace nada');

  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-oficinas.html'), 'utf8');
  check(/onclick="editarClienteOficina\('\$\{esc\(c\.id\)\}'\)">✏️ Editar<\/button>/.test(html), 'Oficinas: cada cliente de la lista tiene el botón ✏️ Editar');
  check(/function editarClienteOficina\(id\)/.test(html) && /method: 'PUT', body: JSON\.stringify\(cuerpo\)/.test(html), 'Oficinas: Editar guarda con PUT /api/jugadores/:id');
  check(/cuerpo\.modeloComision = editando\.modelo_comision/.test(html) && /cuerpo\.modulosAnclados = !!editando\.modulos_anclados/.test(html), 'Oficinas: al editar se conservan modelo de comisión, moneda y anclado (el PUT reemplaza la ficha completa)');
  check(/cancelarEdicionCliente\(\)/.test(html) && /id="cBtnCancelar"/.test(html), 'Oficinas: hay botón para cancelar la edición');
  check(/\$\('cPozo'\)\.readOnly = conPozo/.test(html), 'Oficinas: el monto del pozo no se pisa desde Editar (se ajusta con "± Pozo", con historial)');
  const jug = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'jugadores.js'), 'utf8');
  check(/renombrarClienteEnHipismo\(client, req\.grupoId, nombrePrevio, actualizado\.nombre/.test(jug) && /FOR UPDATE/.test(jug), 'PUT /api/jugadores/:id renombra dentro de la misma transacción (Oficinas y Grupos Hípicos comparten esta ruta)');

  console.log('\n' + ok + ' OK, ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
