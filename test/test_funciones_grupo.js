// =================================================================
// PRUEBA: FUNCIONES POR SECCIÓN DE CADA GRUPO (13-10-2026). Catálogo (services/funcionesGrupo.js), candado de rutas de
// Hipismo, requierePermiso() con el grupo, y que TODA pantalla del menú de Hipismo esté en una sección (o declarada libre a
// propósito) — para que una pantalla nueva no quede fuera del panel sin que nadie se dé cuenta.
// =================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'pg') return { Pool: function () { this.query = async () => ({ rows: [] }); this.connect = async () => ({ query: async () => ({ rows: [] }), release() {} }); this.on = () => {}; } };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({}) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';
const F = require('../src/services/funcionesGrupo');
const { requierePermiso, requiereAlgunoDe } = require('../src/middleware/auth');
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

// 1) catálogo coherente
const claves = F.FUNCIONES.map(f => f.clave);
check(new Set(claves).size === claves.length, '1a) no hay claves repetidas en el catálogo');
const { PERMISOS_VALIDOS } = require('../src/middleware/auth');
check(F.CLAVES_DEPORTES.every(c => PERMISOS_VALIDOS.includes(c)), '1b) cada sección de Deportes es una clave de permiso real (así requierePermiso sirve para las dos cosas)');
check(!F.CLAVES_VALIDAS.includes('pagos') && !F.CLAVES_VALIDAS.includes('hipismo'), '1c) "pagos" y el permiso "hipismo" no se pueden apagar desde el catálogo');
check(Object.values(F.PAQUETES).every(p => p.claves.every(c => claves.includes(c))), '1d) todo paquete usa solo claves del catálogo');

// 2) todas las pantallas del menú de Hipismo caen en una sección (salvo las libres a propósito)
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
const vistas = Array.from(new Set(Array.from(html.matchAll(/class="nav-item[^"]*"[^>]*data-vista="([A-Za-z]+)"/g)).map(m => m[1])));
const LIBRES = ['usuarios', 'seguridad'];
const sinSeccion = vistas.filter(v => !F.seccionDeVistaHipismo(v) && !LIBRES.includes(v));
check(vistas.length > 40, `2a) se leyeron ${vistas.length} pantallas del menú de Hipismo`);
check(sinSeccion.length === 0, `2b) toda pantalla del menú tiene sección (o es libre a propósito) — sin sección: ${sinSeccion.join(', ') || 'ninguna'}`);
const sobrantes = F.FUNCIONES_HIPISMO.flatMap(f => f.vistas || []).filter(v => !vistas.includes(v));
check(sobrantes.length === 0, `2c) el catálogo no menciona pantallas que ya no existen — sobran: ${sobrantes.join(', ') || 'ninguna'}`);

// 2d) el mapa vista->sección que lleva hipismo-mockup.html es EXACTAMENTE el del catálogo (se genera de él)
const mm = html.match(/const SECCION_DE_VISTA_HIP = (\{[^;]*\});/);
const esperado = {};
F.FUNCIONES_HIPISMO.forEach(f => (f.vistas || []).forEach(v => { esperado[v] = f.clave; }));
check(!!mm && JSON.stringify(JSON.parse(mm[1])) === JSON.stringify(esperado), '2d) SECCION_DE_VISTA_HIP de la pantalla coincide con el catálogo (si falla: regenerarlo)');
// 2e) las secciones de Deportes apagables de app.js coinciden con el catálogo
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const ma = app.match(/const SECCIONES_DEPORTES_APAGABLES = (\[[^\]]*\]);/);
check(!!ma && JSON.stringify(eval(ma[1]).sort()) === JSON.stringify(F.CLAVES_DEPORTES.slice().sort()), '2e) SECCIONES_DEPORTES_APAGABLES de app.js coincide con el catálogo');

// 3) normalizar / estado
check(F.normalizarFunciones(null) === null && F.normalizarFunciones(undefined) === null, '3a) sin valor guardado = todas (grupos existentes no cambian)');
check(JSON.stringify(F.normalizarFunciones(['hip_pozos', 'basura', 'hip_pozos'])) === JSON.stringify(['hip_pozos']), '3b) se descartan claves inventadas y repetidas');
check(F.funcionHabilitada({ funciones_habilitadas: null }, 'hip_pozos') === true, '3c) grupo con NULL tiene todo');
check(F.funcionHabilitada({ funciones_habilitadas: ['hip_planos'] }, 'hip_pozos') === false && F.funcionHabilitada({ funciones_habilitadas: ['hip_planos'] }, 'hip_planos') === true, '3d) grupo con lista solo tiene lo marcado');
check(F.funcionHabilitada({ funciones_habilitadas: [] }, 'sabana') === false, '3e) lista vacía = nada encendido');
check(F.funcionHabilitada({ funciones_habilitadas: [] }, 'pagos') === true && F.funcionHabilitada({ funciones_habilitadas: [] }, 'hipismo') === true, '3f) lo que no está en el catálogo nunca se restringe');
check(F.funcionesEfectivas({ funciones_habilitadas: null }).length === claves.length, '3g) efectivas con NULL = todo el catálogo');

// 4) candado de rutas de Hipismo
const soloPlanos = { funciones_habilitadas: ['hip_planos'] };
const ok = (g, m, r) => F.rutaHipismoPermitida(g, m, r);
check(ok(soloPlanos, 'POST', '/planos/calcular') && ok(soloPlanos, 'DELETE', '/planos/abc'), '4a) con Cargar Planos puede calcular y borrar planos');
check(!ok(soloPlanos, 'POST', '/winners') && !ok(soloPlanos, 'GET', '/winners'), '4b) sin Winners no entra a /winners (ni leer ni escribir)');
check(!ok(soloPlanos, 'POST', '/adelantadas') && !ok(soloPlanos, 'PUT', '/tercios-adelantadas/jugadas/1'), '4c) sin Adelantadas no puede guardar adelantadas ni tercios adelantadas');
check(ok(soloPlanos, 'GET', '/adelantadas/pendientes') && ok(soloPlanos, 'GET', '/adelantadas/banqueadores'), '4d) las lecturas de alertas flotantes quedan libres');
check(ok(soloPlanos, 'GET', '/cierre-final') && ok(soloPlanos, 'GET', '/hipodromos') && ok(soloPlanos, 'GET', '/planos'), '4e) lecturas compartidas (cierre final, hipódromos, lista de planos) quedan libres');
check(!ok(soloPlanos, 'PUT', '/pozos-plano-excluidos') && ok({ funciones_habilitadas: ['hip_pozos'] }, 'PUT', '/pozos-plano-excluidos'), '4f) Pozos: solo con la sección Pozos');
check(!ok(soloPlanos, 'GET', '/comisiones-devueltas') && ok({ funciones_habilitadas: ['hip_comisiones'] }, 'GET', '/comisiones-devueltas'), '4g) Comisiones: solo con la sección Comisiones');
check(ok({ funciones_habilitadas: ['hip_saldos'] }, 'GET', '/saldo-comisiones'), '4h) Saldos también puede leer saldo de comisiones (lo usa el cierre)');
check(!ok(soloPlanos, 'POST', '/jornada/eliminar') && ok({ funciones_habilitadas: ['hip_mantenimiento'] }, 'POST', '/jornada/eliminar'), '4i) Eliminar Jornada: solo con su sección');
check(!ok(soloPlanos, 'POST', '/remates') && !ok(soloPlanos, 'POST', '/cargas-especiales'), '4j) Remates y Carga Masiva: cada una con su sección');
check(ok({ funciones_habilitadas: null }, 'POST', '/winners'), '4k) un grupo sin personalizar sigue pasando todo');
check(ok(soloPlanos, 'GET', '/oficinas/registro') && ok(soloPlanos, 'GET', '/chat'), '4l) Oficinas y chat interno no dependen de las secciones');
check(ok(soloPlanos, 'PUT', '/pizarras/adelantadas') === true, '4m) editar pizarras sirve a varias secciones (Cargar Planos incluida)');

// 5) requierePermiso con el grupo (Deportes)
function correr(mw, req) {
  let status = 200, salio = false;
  mw(req, { status(c) { status = c; return this; }, json() { salio = true; } }, () => { salio = 'next'; });
  return { status, next: salio === 'next' };
}
check(correr(requierePermiso('polla'), { rol: 'administrador', permisos: null, grupo: { funciones_habilitadas: ['sabana'] } }).status === 403, '5a) un Administrador sin la sección Polla contratada recibe 403');
check(correr(requierePermiso('polla'), { rol: 'administrador', permisos: null, grupo: { funciones_habilitadas: ['polla'] } }).next, '5b) con Polla contratada el Administrador pasa');
check(correr(requierePermiso('polla'), { rol: 'empleado', permisos: ['polla'], grupo: { funciones_habilitadas: ['sabana'] } }).status === 403, '5c) un empleado con permiso, pero sin la sección contratada, no pasa');
check(correr(requierePermiso('polla'), { rol: 'empleado', permisos: [], grupo: { funciones_habilitadas: ['polla'] } }).status === 403, '5d) con la sección pero sin permiso de empleado tampoco');
check(correr(requierePermiso('polla'), { rol: 'administrador', permisos: null, grupo: { funciones_habilitadas: null } }).next, '5e) grupo sin personalizar: igual que antes');
check(correr(requierePermiso('pagos'), { rol: 'administrador', permisos: null, grupo: { funciones_habilitadas: [] } }).next, '5f) Pagos nunca se bloquea por secciones');
check(correr(requierePermiso('polla'), { rol: 'administrador', permisos: null }).next, '5g) sin req.grupo (pruebas viejas) no se rompe');
check(correr(requierePermiso('polla'), { rol: 'administrador', permisos: null, superadminGrupoId: 'x', grupo: { funciones_habilitadas: [] } }).next, '5h) el Súper-admin operando un grupo no queda bloqueado');
check(correr(requiereAlgunoDe('balanceGeneral', 'jugador'), { rol: 'administrador', permisos: null, grupo: { funciones_habilitadas: ['jugador'] } }).next, '5i) requiereAlgunoDe pasa si el grupo tiene al menos una');
check(correr(requiereAlgunoDe('balanceGeneral', 'jugador'), { rol: 'administrador', permisos: null, grupo: { funciones_habilitadas: ['polla'] } }).status === 403, '5j) requiereAlgunoDe bloquea si no tiene ninguna');

console.log(`\n${pasaron} OK, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
