// Cifrado REVERSIBLE de la clave de acceso de un Grupo (25-09-2026, a
// pedido del usuario: "esa clave la cambien cuantas veces quieran siempre
// desde super admin la debo poder ver").
//
// grupos.password_hash sigue siendo un hash de un solo sentido (bcrypt) —
// ESO es lo que de verdad valida el login, y esta ronda no lo toca. Este
// módulo es aparte, solo para grupos.password_visible_cifrada: guarda la
// MISMA clave en texto plano, pero cifrada, para que el Súper-admin la
// pueda pedir de vuelta cuando la necesite (ver GET
// /api/superadmin/grupos/:id/detalle) — nunca se usa para validar ningún
// login.
//
// Es una decisión de negocio explícita del usuario, con esta contrapartida
// real y a propósito documentada: a diferencia de password_hash (que ni
// filtrando la base de datos completa se puede revertir), esta clave SÍ
// se podría recuperar si alguien consiguiera, a la vez, la base de datos Y
// la variable de entorno JWT_SECRET del servidor. Se cifra con
// AES-256-GCM (autenticado, no solo ofuscado) derivando la llave de
// JWT_SECRET con SHA-256 — así no hace falta ninguna variable de entorno
// nueva en Railway, y nunca queda en texto plano dentro de la base de
// datos en reposo.
const crypto = require('crypto');

function llave() {
  return crypto.createHash('sha256').update(String(process.env.JWT_SECRET || '')).digest();
}

// Devuelve "iv.tag.datos" (los 3 en base64) — un solo string, listo para
// guardar tal cual en la columna de texto.
function cifrarClave(textoPlano) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const cifrado = Buffer.concat([cipher.update(String(textoPlano), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), cifrado.toString('base64')].join('.');
}

// Devuelve el texto plano de vuelta, o null si no hay nada guardado
// todavía (grupo viejo, ver la nota grande en sql/schema.sql) o si el
// valor guardado no se pudo descifrar (dato corrupto, o cifrado con un
// JWT_SECRET distinto al de ahora) — nunca revienta la pantalla de
// detalle de Súper-admin por esto, simplemente no muestra la clave.
function descifrarClave(valorCifrado) {
  if (!valorCifrado) return null;
  try {
    const partes = String(valorCifrado).split('.');
    if (partes.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = partes;
    const decipher = crypto.createDecipheriv('aes-256-gcm', llave(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const texto = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return texto.toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { cifrarClave, descifrarClave };
