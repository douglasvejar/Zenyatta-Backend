// =================================================================
// SESIÓN DE WHATSAPP GUARDADA EN LA BASE DE DATOS (17-11-2026)
// Hasta ahora cada número propio de un grupo guardaba su sesión en archivos (carpeta WHATSAPP_SESSION_DIR). En Railway, sin un
// Volume montado, esos archivos se borran en cada reinicio/despliegue y hay que volver a escanear el QR (y mientras tanto el
// bot no responde nada). Esto guarda lo mismo (credenciales + llaves de Baileys) en la tabla whatsapp_sesion_datos, igual
// que hace useMultiFileAuthState pero con filas en vez de archivos. `scope` separa a cada grupo ("grupo-<id>").
// Recibe `db` (con .query) y las piezas de Baileys, así se prueba sin WhatsApp ni base real.
// =================================================================
const MAX_CLAVES_CACHE = 512;
const VIGENCIA_CACHE_MS = 60_000;

async function authEnBaseDeDatos(db, scope, { initAuthCreds, BufferJSON, proto }) {
  const leer = valor => JSON.parse(valor, BufferJSON.reviver);
  const escribir = valor => JSON.stringify(valor, BufferJSON.replacer);

  const rc = await db.query('SELECT valor FROM whatsapp_sesion_datos WHERE scope = $1 AND clave = $2', [scope, 'creds']); // si la tabla no existe, falla acá y quien llama usa archivos
  const creds = rc.rows[0] ? leer(rc.rows[0].valor) : initAuthCreds();

  // Cada conexión empieza con su propia caché. Se guardan los JSON para
  // que Baileys siempre reciba objetos nuevos, incluso en lecturas repetidas.
  const cache = new Map();
  let cola = Promise.resolve();
  function enOrden(operacion) {
    const resultado = cola.then(operacion);
    cola = resultado.catch(() => {});
    return resultado;
  }

  function guardarEnCache(clave, valor) {
    cache.delete(clave);
    cache.set(clave, { valor, vence: Date.now() + VIGENCIA_CACHE_MS });
    if (cache.size > MAX_CLAVES_CACHE) cache.delete(cache.keys().next().value);
  }

  return {
    state: {
      creds,
      keys: {
        get: (tipo, ids) => enOrden(async () => {
          const salida = {};
          if (!ids || !ids.length) return salida;
          const porClave = new Map();
          const faltantes = new Set();
          const ahora = Date.now();
          for (const id of ids) {
            const clave = tipo + '-' + id;
            const entrada = cache.get(clave);
            if (entrada && entrada.vence > ahora) {
              cache.delete(clave);
              cache.set(clave, entrada);
              porClave.set(clave, entrada.valor);
            } else {
              cache.delete(clave);
              faltantes.add(clave);
            }
          }
          if (faltantes.size) {
            const r = await db.query('SELECT clave, valor FROM whatsapp_sesion_datos WHERE scope = $1 AND clave = ANY($2)', [scope, [...faltantes]]);
            for (const { clave, valor } of r.rows) {
              guardarEnCache(clave, valor);
              porClave.set(clave, valor);
            }
          }
          ids.forEach(id => {
            const v = porClave.get(tipo + '-' + id);
            if (v === undefined) return;
            let valor = leer(v);
            if (tipo === 'app-state-sync-key' && valor && proto && proto.Message && proto.Message.AppStateSyncKeyData) valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
            salida[id] = valor;
          });
          return salida;
        }),
        set: (datos) => enOrden(async () => {
          const claves = [], valores = [], borrar = [];
          for (const tipo of Object.keys(datos || {})) {
            for (const id of Object.keys(datos[tipo] || {})) {
              const v = datos[tipo][id];
              if (v === null || v === undefined) borrar.push(tipo + '-' + id);
              else { claves.push(tipo + '-' + id); valores.push(escribir(v)); }
            }
          }
          for (const clave of claves) cache.delete(clave);
          for (const clave of borrar) cache.delete(clave);
          if (claves.length) {
            await db.query(
              `INSERT INTO whatsapp_sesion_datos (scope, clave, valor, actualizado_en)
               SELECT $1, k, v, now() FROM unnest($2::text[], $3::text[]) AS t(k, v)
               ON CONFLICT (scope, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
              [scope, claves, valores]
            );
          }
          if (borrar.length) await db.query('DELETE FROM whatsapp_sesion_datos WHERE scope = $1 AND clave = ANY($2)', [scope, borrar]);
          claves.forEach((clave, i) => guardarEnCache(clave, valores[i]));
        })
      }
    },
    saveCreds: async () => {
      await db.query(
        `INSERT INTO whatsapp_sesion_datos (scope, clave, valor, actualizado_en) VALUES ($1,'creds',$2,now())
         ON CONFLICT (scope, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
        [scope, escribir(creds)]
      );
    }
  };
}

async function borrarSesion(db, scope) {
  try { await db.query('DELETE FROM whatsapp_sesion_datos WHERE scope = $1', [scope]); }
  catch (e) { if (!e || e.code !== '42P01') throw e; }
}

module.exports = { authEnBaseDeDatos, borrarSesion };
