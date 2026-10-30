// =================================================================
// PRUEBA (30-10-2026): sesión POR PESTAÑA (public/sesion-pestana.js). Caso real: Largavita en una pestaña y Zenyatta en otra del mismo
// navegador; al dar F5 en la de Largavita pasaba a ser Zenyatta. Se simulan varias pestañas (cada una con su propio sessionStorage y
// el mismo localStorage compartido).
// =================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'sesion-pestana.js'), 'utf8');

let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

// Un "navegador": localStorage compartido por todas las pestañas.
function navegador() {
  const compartido = {};
  return {
    nuevaPestana(sessionCopiada) {
      class Storage {} // cada pestaña es su propio "realm": su propio Storage.prototype
      const mapa = (obj) => { const s = new Storage(); s._m = obj; return s; };
      Storage.prototype.getItem = function (k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; };
      Storage.prototype.setItem = function (k, v) { this._m[k] = String(v); };
      Storage.prototype.removeItem = function (k) { delete this._m[k]; };
      const ls = mapa(compartido), ss = mapa(Object.assign({}, sessionCopiada || {}));
      const win = { localStorage: ls, sessionStorage: ss, Storage };
      vm.runInNewContext(CODIGO, { window: win });
      return { ls, ss, lee: k => ls.getItem(k), escribe: (k, v) => ls.setItem(k, v), borra: k => ls.removeItem(k), compartido };
    }
  };
}
const login = (t, nombre) => { t.escribe('zenyatta_token', 'tok-' + nombre); t.escribe('zenyatta_grupo', JSON.stringify({ id: nombre, nombre })); t.escribe('zenyatta_ultima_actividad', '1000'); };
const grupoDe = t => JSON.parse(t.lee('zenyatta_grupo') || 'null');

// 1) El caso real: A = Largavita, B = Zenyatta. "F5" en A (lee de nuevo) sigue siendo Largavita.
let nav = navegador();
const A = nav.nuevaPestana(); login(A, 'Largavita');
const B = nav.nuevaPestana(); // pestaña nueva: adopta la última sesión usada
check(grupoDe(B).nombre === 'Largavita', '1a) Una pestaña nueva abre con la última sesión usada (no hay que volver a entrar)');
login(B, 'Zenyatta'); // B inicia sesión como otro grupo
check(grupoDe(A).nombre === 'Largavita' && A.lee('zenyatta_token') === 'tok-Largavita', '1b) A (Largavita) NO cambia cuando B inicia sesión como Zenyatta');
check(grupoDe(B).nombre === 'Zenyatta' && B.lee('zenyatta_token') === 'tok-Zenyatta', '1c) B sigue siendo Zenyatta');

// 2) Una pestaña nueva toma el par completo y coherente de la última que inició sesión
const C = nav.nuevaPestana();
check(C.lee('zenyatta_token') === 'tok-Zenyatta' && grupoDe(C).nombre === 'Zenyatta', '2) Pestaña nueva: token y grupo de la MISMA sesión (nunca mezclados)');

// 3) El refresco del grupo en A (guarda zenyatta_grupo) no mezcla el par para las pestañas nuevas
A.escribe('zenyatta_grupo', JSON.stringify({ id: 'Largavita', nombre: 'Largavita', funcionesHabilitadas: ['x'] }));
const D = nav.nuevaPestana();
check(D.lee('zenyatta_token') === 'tok-Largavita' && grupoDe(D).nombre === 'Largavita', '3) Tras refrescar el grupo en A, una pestaña nueva toma token y grupo de A juntos');
check(A.lee('zenyatta_token') === 'tok-Largavita' && grupoDe(B).nombre === 'Zenyatta' && B.lee('zenyatta_token') === 'tok-Zenyatta', '3b) A y B siguen cada una con la suya');

// 4) Cerrar sesión en B no tumba la de A, y B no "adopta" la de otro al recargar
nav = navegador();
const A2 = nav.nuevaPestana(); login(A2, 'Largavita');
const B2 = nav.nuevaPestana(); login(B2, 'Zenyatta');
A2.escribe('zenyatta_grupo', JSON.stringify({ id: 'Largavita', nombre: 'Largavita' })); // A2 pasa a ser la "última usada"
['zenyatta_token', 'zenyatta_grupo', 'zenyatta_ultima_actividad'].forEach(k => B2.borra(k)); // B2 cierra sesión
check(A2.lee('zenyatta_token') === 'tok-Largavita' && grupoDe(A2).nombre === 'Largavita', '4a) Si B cierra sesión, A (otro grupo) sigue con la suya');
check(B2.lee('zenyatta_token') === null && B2.lee('zenyatta_grupo') === null, '4b) La pestaña que cerró sesión no "adopta" la sesión de otra al recargar');
check(nav.nuevaPestana().lee('zenyatta_token') === 'tok-Largavita', '4c) Una pestaña nueva sigue encontrando la sesión de A');

// 5) Cerrar la sesión de la pestaña que es la "última usada" limpia la copia compartida
nav = navegador();
const A3 = nav.nuevaPestana(); login(A3, 'Largavita');
['zenyatta_token', 'zenyatta_grupo', 'zenyatta_ultima_actividad'].forEach(k => A3.borra(k));
const E = nav.nuevaPestana();
check(E.lee('zenyatta_token') === null && E.lee('zenyatta_grupo') === null && E.lee('zenyatta_ultima_actividad') === null, '5) Tras cerrar sesión, una pestaña nueva pide iniciar sesión');
login(B2, 'Otro'); // volver a iniciar sesión en una pestaña que había cerrado
check(B2.lee('zenyatta_token') === 'tok-Otro', '5b) Una pestaña que cerró sesión puede iniciar una nueva');

// 6) Otras claves no se tocan; la actividad es por pestaña
nav = navegador();
const F = nav.nuevaPestana(); F.escribe('ludox_hipismo_tema_1', 'club');
const G = nav.nuevaPestana();
check(G.lee('ludox_hipismo_tema_1') === 'club', '6a) Las claves que no son de sesión (tema, etc.) siguen compartidas como siempre');
login(F, 'Largavita'); const H = nav.nuevaPestana(); H.lee('zenyatta_ultima_actividad'); // H adopta la sesión (actividad 1000)
F.escribe('zenyatta_ultima_actividad', '5000');
check(H.lee('zenyatta_ultima_actividad') === '1000' && F.lee('zenyatta_ultima_actividad') === '5000', '6b) La última actividad es de cada pestaña (una pestaña inactiva no se mantiene viva por otra)');

// 7) Sin almacenamiento disponible no rompe nada
const win = { get localStorage() { throw new Error('bloqueado'); }, get sessionStorage() { throw new Error('bloqueado'); }, Storage: function () {} };
let rompio = false; try { vm.runInNewContext(CODIGO, { window: win }); } catch (e) { rompio = true; }
check(!rompio, '7) Si el navegador bloquea el almacenamiento, el archivo no lanza errores');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron ? 1 : 0);
