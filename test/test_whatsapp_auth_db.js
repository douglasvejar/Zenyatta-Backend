// =================================================================
// PRUEBA: sesión de WhatsApp guardada en la base de datos (17-11-2026) — con las piezas REALES de Baileys (BufferJSON, initAuthCreds)
// y una base falsa en memoria. Revisa que lo guardado se lea igual (incluidos los Buffer), que se separe por grupo y que se pueda borrar.
// =================================================================
const path = require('path');
const baileys = require('@whiskeysockets/baileys');
const { authEnBaseDeDatos, borrarSesion } = require(path.join(__dirname, '..', 'src', 'services', 'whatsappAuthDb'));

let pasaron = 0, fallaron = 0;
const check = (c, m) => { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } };

const filas = new Map(); // "scope|clave" -> valor
let lecturasClaves = 0;
const db = {
  async query(text, params) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (/^SELECT valor FROM whatsapp_sesion_datos WHERE scope = \$1 AND clave = \$2/.test(sql)) { const v = filas.get(params[0] + '|' + params[1]); return { rows: v === undefined ? [] : [{ valor: v }] }; }
    if (/^SELECT clave, valor FROM whatsapp_sesion_datos WHERE scope = \$1 AND clave = ANY\(\$2\)/.test(sql)) { lecturasClaves++; return { rows: params[1].filter(k => filas.has(params[0] + '|' + k)).map(k => ({ clave: k, valor: filas.get(params[0] + '|' + k) })) }; }
    if (/^INSERT INTO whatsapp_sesion_datos \(scope, clave, valor, actualizado_en\) SELECT/.test(sql)) { params[1].forEach((k, i) => filas.set(params[0] + '|' + k, params[2][i])); return { rows: [] }; }
    if (/^INSERT INTO whatsapp_sesion_datos \(scope, clave, valor, actualizado_en\) VALUES/.test(sql)) { filas.set(params[0] + '|creds', params[1]); return { rows: [] }; }
    if (/^DELETE FROM whatsapp_sesion_datos WHERE scope = \$1 AND clave = ANY/.test(sql)) { params[1].forEach(k => filas.delete(params[0] + '|' + k)); return { rows: [] }; }
    if (/^DELETE FROM whatsapp_sesion_datos WHERE scope = \$1$/.test(sql)) { [...filas.keys()].filter(k => k.startsWith(params[0] + '|')).forEach(k => filas.delete(k)); return { rows: [] }; }
    throw new Error('BD falsa: consulta no prevista: ' + sql.slice(0, 120));
  }
};

(async function main() {
  const a1 = await authEnBaseDeDatos(db, 'grupo-1', baileys);
  check(a1.state.creds && a1.state.creds.noiseKey && Buffer.isBuffer(a1.state.creds.noiseKey.private || a1.state.creds.noiseKey.public), 'sin nada guardado: se crean credenciales nuevas (con sus llaves)');
  await a1.saveCreds();
  const a2 = await authEnBaseDeDatos(db, 'grupo-1', baileys);
  check(Buffer.compare(a1.state.creds.noiseKey.private, a2.state.creds.noiseKey.private) === 0 && a2.state.creds.registrationId === a1.state.creds.registrationId, 'tras un "reinicio" las credenciales guardadas se leen idénticas (los Buffer vuelven como Buffer)');

  const llave = { public: Buffer.from([1, 2, 3, 4]), private: Buffer.from([9, 8, 7]) };
  await a2.state.keys.set({ 'pre-key': { 1: llave, 2: { public: Buffer.from([5]), private: Buffer.from([6]) } }, session: { 'abc.0': Buffer.from('sesion') } });
  const leidas = await a2.state.keys.get('pre-key', ['1', '2', '3']);
  check(Buffer.compare(leidas['1'].public, llave.public) === 0 && Buffer.compare(leidas['1'].private, llave.private) === 0 && leidas['2'] && leidas['3'] === undefined, 'las llaves guardadas se leen (Buffer incluidos) y las que no existen no aparecen');
  const ses = await a2.state.keys.get('session', ['abc.0']);
  check(Buffer.isBuffer(ses['abc.0']) && ses['abc.0'].toString() === 'sesion', 'una sesión guardada como Buffer vuelve como Buffer');
  await a2.state.keys.set({ 'pre-key': { 1: null } });
  const tras = await a2.state.keys.get('pre-key', ['1', '2']);
  check(tras['1'] === undefined && tras['2'] !== undefined, 'un valor null borra esa llave');

  const reconexion = await authEnBaseDeDatos(db, 'grupo-1', baileys);
  const antes = lecturasClaves;
  const guardada = await reconexion.state.keys.get('pre-key', ['2']);
  guardada['2'].public[0] = 99;
  const repetida = await reconexion.state.keys.get('pre-key', ['2']);
  check(lecturasClaves === antes + 1 && repetida['2'].public[0] === 5, 'una conexión nueva lee de la base una vez y las lecturas repetidas devuelven copias');
  const actualizar = reconexion.state.keys.set({ 'pre-key': { 2: { public: Buffer.from([8]) } } });
  const leerDurante = reconexion.state.keys.get('pre-key', ['2']);
  await actualizar;
  check((await leerDurante)['2'].public[0] === 8 && lecturasClaves === antes + 1, 'una lectura concurrente espera la escritura y reutiliza el valor persistido');

  const otro = await authEnBaseDeDatos(db, 'grupo-2', baileys);
  check(Buffer.compare(otro.state.creds.noiseKey.private, a1.state.creds.noiseKey.private) !== 0 && Object.keys(await otro.state.keys.get('pre-key', ['2'])).length === 0, 'cada grupo tiene su propia sesión (no se mezclan)');

  await borrarSesion(db, 'grupo-1');
  const vacio = await authEnBaseDeDatos(db, 'grupo-1', baileys);
  check(Buffer.compare(vacio.state.creds.noiseKey.private, a1.state.creds.noiseKey.private) !== 0, 'al desvincular se borra la sesión guardada (queda como nueva)');

  // si la tabla no existe, quien llama usa archivos: authEnBaseDeDatos deja pasar el error
  const dbSinTabla = { query: async () => { const e = new Error('no existe'); e.code = '42P01'; throw e; } };
  let fallo = false;
  try { await authEnBaseDeDatos(dbSinTabla, 'g', baileys); } catch (e) { fallo = true; }
  check(fallo, 'sin la tabla, el error sube para que se use la carpeta de archivos como respaldo');
  await borrarSesion(dbSinTabla, 'g');
  check(true, 'borrar sin tabla no falla');

  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
