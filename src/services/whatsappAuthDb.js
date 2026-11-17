// =================================================================
// SESIÓN DE WHATSAPP GUARDADA EN LA BASE DE DATOS (17-11-2026)
// Hasta ahora cada número propio de un grupo guardaba su sesión en archivos (carpeta WHATSAPP_SESSION_DIR). En Railway, sin un
// Volume montado, esos archivos se borran en cada reinicio/despliegue y hay que volver a escanear el QR (y mientras tanto el
// bot no responde nada). Esto guarda lo mismo (credenciales + llaves de Baileys) en la tabla whatsapp_sesion_datos, igual
// que hace useMultiFileAuthState pero con filas en vez de archivos. `scope` separa a cada grupo ("grupo-<id>").
// Recibe `db` (con .query) y las piezas de Baileys, así se prueba sin WhatsApp ni base real.
// =================================================================
async function authEnBaseDeDatos(db, scope, { initAuthCreds, BufferJSON, proto }) {
  const leer = valor => JSON.parse(valor, BufferJSON.reviver);
  const escribir = valor => JSON.stringify(valor, BufferJSON.replacer);

  const rc = await db.query('SELECT valor FROM whatsapp_sesion_datos WHERE scope = $1 AND clave = $2', [scope, 'creds']); // si la tabla no existe, falla acá y quien llama usa archivos
  const creds = rc.rows[0] ? leer(rc.rows[0].valor) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (tipo, ids) => {
          const salida = {};
          if (!ids || !ids.length) return salida;
          const claves = ids.map(id => tipo + '-' + id);
          const r = await db.query('SELECT clave, valor FROM whatsapp_sesion_datos WHERE scope = $1 AND clave = ANY($2)', [scope, claves]);
          const porClave = new Map(r.rows.map(f => [f.clave, f.valor]));
          ids.forEach(id => {
            const v = porClave.get(tipo + '-' + id);
            if (v === undefined) return;
            let valor = leer(v);
            if (tipo === 'app-state-sync-key' && valor && proto && proto.Message && proto.Message.AppStateSyncKeyData) valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
            salida[id] = valor;
          });
          return salida;
        },
        set: async (datos) => {
          const claves = [], valores = [], borrar = [];
          for (const tipo of Object.keys(datos || {})) {
            for (const id of Object.keys(datos[tipo] || {})) {
              const v = datos[tipo][id];
              if (v === null || v === undefined) borrar.push(tipo + '-' + id);
              else { claves.push(tipo + '-' + id); valores.push(escribir(v)); }
            }
          }
          if (claves.length) {
            await db.query(
              `INSERT INTO whatsapp_sesion_datos (scope, clave, valor, actualizado_en)
               SELECT $1, k, v, now() FROM unnest($2::text[], $3::text[]) AS t(k, v)
               ON CONFLICT (scope, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
              [scope, claves, valores]
            );
          }
          if (borrar.length) await db.query('DELETE FROM whatsapp_sesion_datos WHERE scope = $1 AND clave = ANY($2)', [scope, borrar]);
        }
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
