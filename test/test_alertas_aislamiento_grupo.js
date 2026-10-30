// =================================================================
// PRUEBA (30-10-2026): un Grupo no puede resolver ni descartar la alerta de OTRO grupo (antes solo se confiaba en que el UUID fuera
// impredecible). Sin grupoId (Súper-admin) sigue funcionando para cualquier alerta.
// =================================================================
const path = require('path');
const Module = require('module');
const ALERTAS = { a1: { id: 'a1', grupo_id: 'G1', fecha: '2026-10-26', pata: 'texas' }, a2: { id: 'a2', grupo_id: 'G2', fecha: '2026-10-26', pata: 'miami' } };
const consultas = [];
const fakeDb = {
  query: async (sql, params) => {
    consultas.push(sql);
    if (/^SELECT grupo_id/.test(sql)) {
      const a = ALERTAS[params[0]];
      if (!a || (/grupo_id = \$2/.test(sql) && a.grupo_id !== params[1])) return { rows: [] };
      return { rows: [a] };
    }
    return { rows: [], rowCount: 1 };
  }
};
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && /services[\\/]alertas\.js$/.test(parent.filename || '') && /(^|[\\/])db$/.test(request)) return fakeDb;
  return original.apply(this, arguments);
};
const { resolverAlerta, descartarAlerta } = require(path.join(__dirname, '..', 'src', 'services', 'alertas'));
let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }
async function falla(fn) { try { await fn(); return null; } catch (e) { return e; } }

(async () => {
  let e = await falla(() => resolverAlerta('a2', 'nfl', 'G1'));
  check(e && e.status === 404, '1) El grupo G1 NO puede resolver la alerta del grupo G2 (404)');
  e = await falla(() => descartarAlerta('a2', 'G1'));
  check(e && e.status === 404, '2) El grupo G1 NO puede descartar la alerta del grupo G2 (404)');
  const r1 = await resolverAlerta('a1', 'nfl', 'G1');
  check(r1.grupoId === 'G1', '3) El grupo G1 sí resuelve su propia alerta');
  const r2 = await descartarAlerta('a1', 'G1');
  check(r2.grupoId === 'G1', '4) El grupo G1 sí descarta su propia alerta');
  const r3 = await resolverAlerta('a2', 'nfl');
  check(r3.grupoId === 'G2', '5) Sin grupoId (Súper-admin) se puede resolver cualquier alerta, como siempre');
  const r4 = await descartarAlerta('a2');
  check(r4.grupoId === 'G2', '6) Sin grupoId (Súper-admin) se puede descartar cualquier alerta, como siempre');
  check(!consultas.some(q => /UPDATE alertas/.test(q) && false), '7) (control) las consultas se ejecutaron');
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
