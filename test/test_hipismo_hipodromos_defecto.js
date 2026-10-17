// =================================================================
// PRUEBA: hipódromos predeterminados (15-10-2026). Todos los grupos arrancan con 3 de Venezuela y 48 de USA, una sola vez por
// grupo, sin pisar los que ya tenían ni resucitar los que borraron; el SQL coincide con la lista del código.
// =================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const m = require(path.join(__dirname, '..', 'src', 'services', 'hipismoHipodromosDefecto'));

let pasaron = 0, fallaron = 0;
function check(c, msg) { if (c) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

// Base de datos falsa mínima: grupos (con la marca) e hipódromos (único por grupo + nombre sin mayúsculas).
function crearDb({ sinColumna = false } = {}) {
  const grupos = new Map(); // id -> { marca }
  const hip = []; // { grupo_id, nombre, pais }
  const insertar = (gid, nombre, pais) => { if (!hip.some(h => h.grupo_id === gid && h.nombre.toLowerCase() === nombre.toLowerCase()) && !m.yaTieneEquivalente(hip.filter(h => h.grupo_id === gid).map(h => h.nombre), nombre)) hip.push({ grupo_id: gid, nombre, pais }); };
  // (el SQL real evalúa el "ya tiene equivalente" contra lo que había ANTES de la consulta, no contra lo que inserta la misma consulta)
  const db = {
    grupos, hip,
    async query(text, params) {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (/^ALTER TABLE grupos ADD COLUMN IF NOT EXISTS hipismo_hipodromos_iniciales/i.test(sql)) return { rows: [] };
      if (/^create or replace function hipismo_norm_hipodromo/i.test(sql)) return { rows: [] };
      if (/^INSERT INTO hipismo_hipodromos \(grupo_id, nombre, pais\) SELECT \$1::uuid, h\.nombre, h\.pais FROM unnest/i.test(sql)) {
        const antes = hip.filter(h => h.grupo_id === params[0]).map(h => h.nombre);
        params[1].forEach((n, i) => { if (!m.yaTieneEquivalente(antes, n)) insertar(params[0], n, params[2][i]); }); return { rows: [] };
      }
      if (/^INSERT INTO hipismo_hipodromos \(grupo_id, nombre, pais\) SELECT g\.id, h\.nombre, h\.pais FROM grupos g CROSS JOIN unnest/i.test(sql)) {
        for (const [id, g] of grupos) if (!g.marca) { const antes = hip.filter(h => h.grupo_id === id).map(h => h.nombre); params[0].forEach((n, i) => { if (!m.yaTieneEquivalente(antes, n)) insertar(id, n, params[1][i]); }); } return { rows: [] };
      }
      if (/^UPDATE grupos SET hipismo_hipodromos_iniciales = true WHERE id = \$1/i.test(sql)) {
        if (sinColumna) { const e = new Error('column does not exist'); e.code = '42703'; throw e; }
        grupos.get(params[0]).marca = true; return { rows: [] };
      }
      if (/^UPDATE grupos SET hipismo_hipodromos_iniciales = true WHERE NOT hipismo_hipodromos_iniciales/i.test(sql)) {
        for (const g of grupos.values()) g.marca = true; return { rows: [] };
      }
      throw new Error('La base de datos falsa no sabe responder: ' + sql);
    }
  };
  return db;
}

(async function () {
  const L = m.HIPODROMOS_DEFECTO;
  check(m.VENEZUELA.join('|') === 'La Rinconada|Valencia|Rancho Alegre', '1) Venezuela: La Rinconada, Valencia y Rancho Alegre');
  check(m.USA.length === 48 && L.length === 51, '2) 48 de USA + 3 de Venezuela = 51');
  check(new Set(L.map(h => h.nombre.toLowerCase())).size === 51, '3) ningún nombre repetido (sin importar mayúsculas)');
  check(L.filter(h => h.pais === 'VE').length === 3 && L.filter(h => h.pais === 'US').length === 48, '4) cada uno con su país (VE / US)');
  ['Belmont Park', 'Remington Park', 'Saratoga Race Course', 'Saratoga Raceway', 'Yonkers Raceway'].forEach(n => check(m.USA.includes(n), `5) incluye ${n}`));

  // No duplicar: nombres que el grupo ya tenía creados a su manera
  const eq = (ex, n) => m.yaTieneEquivalente(ex, n);
  check(eq(['Remington'], 'Remington Park') && eq(['remington park'], 'Remington Park') && eq(['REMINGTON  PARK'], 'Remington Park'), '5b) "Remington", "remington park" y "REMINGTON  PARK" cubren a Remington Park');
  check(eq(['Rinconada'], 'La Rinconada') && eq(['LA RINCONADA'], 'La Rinconada') && eq(['la-rinconada'], 'La Rinconada'), '5c) "Rinconada" / "LA RINCONADA" / "la-rinconada" cubren a La Rinconada');
  check(eq(['Belmont'], 'Belmont Park') && eq(['Santa Anita'], 'Santa Anita Park') && eq(['Gulfstream'], 'Gulfstream Park') && eq(['Churchill'], 'Churchill Downs'), '5d) nombres cortos conocidos cubren al de la lista (Belmont, Santa Anita, Gulfstream, Churchill)');
  check(eq(['Balmont'], 'Belmont Park') === false && eq(['Park'], 'Belmont Park') === false && eq(['Sara'], 'Saratoga Raceway') === false, '5e) no confunde nombres distintos ni cubre por letras sueltas (Sara no cubre Saratoga)');
  check(eq(['Saratoga Race Course'], 'Saratoga Raceway') === false && eq(['Saratoga Raceway'], 'Saratoga Race Course') === false, '5f) Saratoga Race Course y Saratoga Raceway son distintos entre sí');
  check(eq(['Valencia'], 'Valencia') && eq(['Rancho Alegre'], 'Rancho Alegre') && eq(['Ñandú'], 'Nandu') && eq([''], 'Del Mar') === false, '5g) Valencia y Rancho Alegre exactos; acentos y vacíos bien tratados');

  // Grupo nuevo
  let db = crearDb();
  db.grupos.set('g1', { marca: false });
  await m.sembrarHipodromosDefecto(db, 'g1');
  check(db.hip.filter(h => h.grupo_id === 'g1').length === 51 && db.grupos.get('g1').marca === true, '6) un grupo nuevo recibe los 51 y queda marcado');

  // Grupos existentes: respeta lo suyo, una sola vez, no resucita lo borrado, otro grupo no se mezcla
  db = crearDb();
  db.grupos.set('a', { marca: false }); db.grupos.set('b', { marca: false });
  db.hip.push({ grupo_id: 'a', nombre: 'LA RINCONADA', pais: 'VE' }, { grupo_id: 'a', nombre: 'Mi Pista Propia', pais: 'VE' });
  await m.sembrarGruposExistentes(db);
  const deA = db.hip.filter(h => h.grupo_id === 'a'), deB = db.hip.filter(h => h.grupo_id === 'b');
  check(deA.length === 52 && deB.length === 51, '7) grupos existentes: A conserva sus 2 y recibe el resto (52); B recibe 51');
  // grupo con nombres propios equivalentes: no se duplican
  db.grupos.set('e', { marca: false });
  db.hip.push({ grupo_id: 'e', nombre: 'Remington', pais: 'US' }, { grupo_id: 'e', nombre: 'Rinconada', pais: 'VE' }, { grupo_id: 'e', nombre: 'Belmont', pais: 'US' });
  await m.sembrarGruposExistentes(db);
  const deE = db.hip.filter(h => h.grupo_id === 'e').map(h => h.nombre);
  check(deE.length === 51 && deE.includes('Remington') && !deE.includes('Remington Park') && !deE.includes('La Rinconada') && !deE.includes('Belmont Park'), '7b) un grupo con "Remington", "Rinconada" y "Belmont" ya creados NO recibe duplicados (51 en total, con los suyos)');
  check(deA.filter(h => h.nombre.toLowerCase() === 'la rinconada').length === 1 && deA.some(h => h.nombre === 'LA RINCONADA'), '8) si ya tenían "La Rinconada" se respeta la suya, sin duplicar');
  db.hip.splice(db.hip.findIndex(h => h.grupo_id === 'b' && h.nombre === 'Del Mar'), 1); // B borra uno a propósito
  await m.sembrarGruposExistentes(db);
  check(db.hip.filter(h => h.grupo_id === 'b').length === 50, '9) correrlo otra vez NO resucita el hipódromo que el grupo borró');
  db.grupos.set('c', { marca: false });
  await m.sembrarGruposExistentes(db);
  check(db.hip.filter(h => h.grupo_id === 'c').length === 51 && db.hip.filter(h => h.grupo_id === 'b').length === 50, '10) un grupo que aparece después sí la recibe y los demás no cambian');

  // Sin la columna (falta el SQL): igual quedan cargados
  db = crearDb({ sinColumna: true }); db.grupos.set('z', { marca: false });
  await m.sembrarHipodromosDefecto(db, 'z');
  check(db.hip.filter(h => h.grupo_id === 'z').length === 51, '11) sin la columna igual se cargan (solo no queda la marca)');

  // Si la base falla al arrancar, no lanza error
  let aviso = 0; const w = console.warn; console.warn = () => { aviso++; };
  await m.sembrarGruposExistentes({ query: async () => { throw new Error('sin tabla'); } });
  console.warn = w;
  check(aviso === 1, '12) si la base falla al arrancar solo avisa en el log, no rompe');

  // El SQL de schema.sql contiene exactamente la lista del código
  const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  check(schema.includes(m.sqlHipodromosDefecto()), '13) sql/schema.sql tiene el bloque de hipódromos idéntico al del código');
  const enSql = [...schema.slice(schema.indexOf('hipismo_hipodromos_iniciales')).matchAll(/\('([^']+)', '(VE|US)'\)/g)].map(x => x[1] + '/' + x[2]);
  check(enSql.length === 51 && enSql.join() === L.map(h => h.nombre + '/' + h.pais).join(), '14) el SQL trae los mismos 51 con el mismo país y orden');
  console.log(`\n${pasaron} OK, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
