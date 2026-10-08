-- =================================================================
-- Deportes Zenyatta — Esquema de base de datos (Fase 0)
-- =================================================================
-- Pensado para correr tal cual en el editor SQL de Supabase (Postgres).
-- Aísla los datos por GRUPO (grupo_id) en cada tabla — esa es la pieza
-- central del diseño multi-tenant: cada Grupo (empresa de apuestas) solo
-- puede ver y tocar sus propias filas.
--
-- Seguridad: se habilita Row Level Security en todas las tablas de datos
-- de un grupo, SIN definir ninguna política de acceso. Eso significa que,
-- por defecto, absolutamente nadie puede leer ni escribir esas tablas
-- usando la clave pública (anon) o de usuario autenticado de Supabase —
-- solo la clave de servicio (service_role), que es la que usa el backend
-- (Node en Railway/tu PC) para conectarse. Como en este diseño el
-- navegador NUNCA habla directo con Supabase (todo pasa por el backend),
-- esto ya es seguro tal cual. El día que se quiera además dejar entrar al
-- navegador directo a Supabase (con la clave anon), ahí sí habría que
-- agregar políticas específicas por grupo — por ahora no hace falta.

create extension if not exists pgcrypto; -- para gen_random_uuid()

-- =================================================================
-- GRUPOS — cada empresa/grupo de apuestas que usa la plataforma.
-- =================================================================
-- El "Súper-admin" (vos) crea la fila y la activa/desactiva a mano
-- (interruptor manual, sin cobro automático — ver columna "activo").
create table if not exists grupos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  email         text not null unique,
  password_hash text not null,          -- login del Grupo (admin del negocio)
  activo        boolean not null default false,
  creado_en     timestamptz not null default now()
);

-- Columnas de "último inicio de sesión" (para la pantalla de detalle de
-- Súper-admin — ver superadmin.html). Se agregan con ALTER TABLE aparte
-- (en vez de meterlas directo en el CREATE TABLE de arriba) para que,
-- si ya tenías la tabla "grupos" creada de una entrega anterior, correr
-- este archivo de nuevo te las sume sin tocar nada de lo que ya existía
-- — "add column if not exists" es seguro de re-correr las veces que
-- hagan falta.
alter table grupos add column if not exists ultimo_login_en timestamptz;
alter table grupos add column if not exists ultimo_login_ip text;
alter table grupos add column if not exists ultimo_login_user_agent text; -- navegador/SO reportado por el navegador — no es un modelo exacto de dispositivo, ver nota en superadmin.js

-- Logo del Grupo (01-09-2026, a pedido del usuario, "para que sea algo más
-- personalizado"): originalmente se guardaba SOLO como URL a una imagen ya
-- subida a algún lado (no como archivo en el servidor) — a propósito, para
-- no depender del disco del servidor (en Railway, el hosting elegido para
-- la Fase 2, el disco no es persistente entre despliegues sin configurar
-- un volumen aparte). Solo el Súper-admin puede ponerla/cambiarla (PATCH
-- /api/superadmin/grupos/:id/logo, ver superadmin.js/superadmin.html) — el
-- propio Grupo no tiene ningún botón para tocarla. Se muestra en
-- cliente.html (la vista pública del Cliente).
--
-- REVISADO 29-09-2026, a pedido del usuario: "quiero subir el logo del
-- grupo, no por url si no cargar la imagen del grupo desde super admin,
-- queda cargada para cada grupo en su pagina" — ahora se puede subir el
-- ARCHIVO directo desde Súper-admin (logo_base64/logo_mime abajo), en vez
-- de tener que pegar un link a una imagen ya subida a algún otro lado.
-- Sigue sin depender del disco del servidor: el archivo se guarda como
-- base64 adentro de esta misma fila de Postgres (Supabase), EXACTO mismo
-- patrón ya usado por pagos_grupo.captura_base64 (ver la nota grande junto
-- a esa tabla, más abajo en este archivo) — esta app no tiene ninguna
-- integración de storage de archivos (S3, Supabase Storage, etc.), así que
-- esto es consistente con el resto del proyecto, no un atajo nuevo. Tope
-- de 4MB decodificados validado en la ruta (PATCH .../logo), mismo tope
-- que pagos_grupo.
--
-- logo_url queda como columna LEGACY: ya no hay forma de cargar una URL
-- nueva desde la UI (se reemplazó por el archivo subido), pero se deja sin
-- borrar por si algún grupo viejo todavía la tiene puesta desde antes de
-- este cambio — GET /api/imagenes/logo-grupo/:grupoId sirve logo_base64
-- si existe, y si no, cae a proxyar logo_url como hacía siempre.
alter table grupos add column if not exists logo_url text;
alter table grupos add column if not exists logo_base64 text;
alter table grupos add column if not exists logo_mime text;

-- Color del link del Cliente de Hipismo (29-09-2026, a pedido del
-- usuario: "colocame una ventana en logos que diga colores reportes
-- cliente... y desde alli pueda escoger el tema o colores en que se
-- veran los reportes de los clientes desde su link..... asi cada grupo
-- lo puedo personalizar segun sus logos"). Solo pinta el degradado de la
-- tarjeta "Total de la semana" que ve el Cliente en su link
-- (hipismo-cliente-portal.html, la misma tarjeta donde ya va el logo
-- desde la sección 14-16 de las actualizaciones) — el resto de la
-- página (fondo, títulos de sección) se queda igual para todos los
-- grupos, a pedido explícito del usuario ("solo la tarjeta verde
-- principal"). NO aplica al link de Deportes (cliente.html) ni a los
-- reportes del propio Administrador (Balance General/Cierre Final) —
-- esos se quedan con el verde de siempre.
--
-- Ambas columnas van SIEMPRE juntas: o las 2 tienen un color (hex de 6
-- dígitos, ej. "#16a34a"), o las 2 quedan en null (vuelve al verde
-- clásico por defecto) — nunca una sola, para no dejar armado un
-- degradado a medias. Validado en PATCH /api/superadmin/grupos/:id/
-- tema-cliente (ver superadmin.js). Súper-admin ofrece más de 70 temas
-- prediseñados (con buen contraste ya probado contra texto blanco) más
-- un selector de color libre para el que quiera afinar el tono exacto
-- del logo de su grupo (ver superadmin.html, pestaña "🖼️ Logo").
alter table grupos add column if not exists tema_color_primario text;
alter table grupos add column if not exists tema_color_secundario text;

-- Vínculo con el grupo de WhatsApp (03-09-2026, a pedido del usuario:
-- "existe alguna manera de que en mi chat de whatssap yo actualice la
-- sabana y se cargue automatico en el sistema?"). Es el "JID" (identificador
-- interno de WhatsApp para ese grupo, algo como "1203630...@g.us") del
-- grupo de WhatsApp DESDE DONDE se van a leer los mensajes que empiecen
-- con "SABANA DE JUGADAS". Si queda en blanco, el bot simplemente ignora
-- todos los mensajes (no sabe a qué grupo/tenant pertenecen).
--
-- REVISADO 04-09-2026, a pedido del usuario: "el codigo para activar el
-- bot con el grupo de whatsaap solo lo puede activar, editar o eliminar
-- desde super admin... si lo dejamos asi ellos podrian cambiar para que
-- grupo trabaja la aplicacion". Antes lo pegaba el propio Grupo a mano
-- desde su panel (PUT /api/whatsapp/grupo-jid) — eso se sacó. Ahora SOLO
-- el Súper-admin puede poner/editar/borrar este JID (PATCH
-- /api/superadmin/grupos/:id/whatsapp-jid, ver superadmin.js/.html), como
-- parte de darle de alta el servicio a un cliente que lo compró.
alter table grupos add column if not exists whatsapp_grupo_jid text;

-- "Sábana automática por WhatsApp" como servicio contratable aparte
-- (04-09-2026, a pedido del usuario: "este servicio sera un plus para
-- los grupos que compren el servicio, pueden comprarlo con este servicio
-- de whatsapp automatico o, manual como veniamos haciendolo... quiero
-- desde super admin poder habilitar esta opcion o no a los grupos").
-- Interruptor manual (igual que "activo", sin cobro automático) que SOLO
-- el Súper-admin puede prender/apagar (PATCH
-- /api/superadmin/grupos/:id/whatsapp-habilitado) — un Grupo con esto en
-- false sigue trabajando 100% manual (pegar la sábana a mano, como
-- siempre), aunque el bot esté prendido a nivel servidor y aunque ya
-- tenga un whatsapp_grupo_jid cargado de antes: whatsappBot.js exige
-- AMBAS cosas (JID vinculado Y habilitado=true) antes de aceptar
-- mensajes de ese grupo (ver grupoIdPorJid() en
-- sabanasPendientesWhatsapp.js) — así alcanza con apagar este interruptor
-- para cortar el servicio sin tener que borrar el JID guardado.
alter table grupos add column if not exists whatsapp_habilitado boolean not null default false;

-- "Sábana de muestra" (05-09-2026, a pedido del usuario, después de
-- discutir cómo manejar varios grupos con estilos de sábana distintos:
-- "hay mucho grupos que varian en la forma de escribir sus sabanas,
-- tickets y en como diferencian cada uno de sus tickets"). Es SOLO un
-- campo de referencia/documentación para el Súper-admin: un texto real
-- de ejemplo de cómo ESE grupo escribe su sábana (pegado a mano al dar
-- de alta el grupo, o después). NO lo lee ni lo usa ninguna lógica de
-- procesamiento/parser — parser.js sigue siendo el mismo motor tolerante
-- único para todos los grupos (ver la nota grande en parser.js sobre por
-- qué NO se hace un "tipo de sábana" por grupo). Sirve para que, al dar
-- de alta un grupo nuevo, el Súper-admin pueda guardar ahí un mensaje
-- real de muestra y probarlo ANTES de que haya plata real en juego, y
-- para tener siempre a mano cómo escribe ese grupo en particular si hace
-- falta ajustar el parser más adelante. Editable solo desde Súper-admin
-- (PATCH /api/superadmin/grupos/:id/sabana-muestra) — el propio Grupo no
-- tiene ningún botón para tocarla.
alter table grupos add column if not exists sabana_muestra text;

-- =================================================================
-- MODELO DE COMISIÓN POR GRUPO (08-09-2026, a pedido del usuario: "hay
-- grupos que manejan de distintas maneras los %... por lo menos tengo un
-- grupo que el % es de lo arriesgado pero por tipo de jugadas... las
-- directas es un 2% de lo arriesgado, dos logros es el 3%... y 3 logros
-- es el 5%... y despues esos resultados se suman y dan el total").
--
-- Hasta ahora TODOS los grupos calculaban la comisión de cada cliente
-- igual: un único % fijo (jugadores.comision_propia) sobre TODO lo
-- arriesgado comisionable de ese cliente en el rango, sin importar si
-- jugó directas o parleys. Algunos grupos siguen queriendo exactamente
-- eso ('plano', el default — CERO cambio de comportamiento para todos los
-- grupos existentes). Otros grupos cobran un % DISTINTO según cuántas
-- "patas"/"logros" tiene cada ticket (1 = jugada directa, 2 = parley de 2
-- logros, 3 = parley de 3 logros, ...) y suman la comisión de cada ticket
-- por separado — ese es 'por_tipo_jugada'.
--
-- A pedido EXPLÍCITO del usuario (no todos los grupos necesitan esto, y
-- cuando lo necesitan, es UN SOLO juego de % para todo el grupo, no por
-- cliente): esto es EXCLUSIVO del Súper-admin, mismo espíritu que
-- whatsapp_habilitado — el propio Grupo no tiene ningún botón para
-- cambiar su propio modelo ni sus tiers (si en algún momento hiciera
-- falta que cada Grupo lo autogestione, sería un cambio de UI, no de
-- esquema).
--
-- comision_tiers: un array de { "logros": N, "porcentaje": P } (P en
-- unidades de %, ej. 3 = 3%), UNO por cada cantidad de logros que se
-- quiera distinguir — NO hace falta que sean exactamente 3 tiers ni que
-- terminen en "3": el usuario ya avisó que va a querer agregar un cuarto
-- nivel (o más) para parleys de 4+ logros más adelante, así que la regla
-- de coincidencia (ver porcentajePorTipoJugada() en comisiones.js) usa el
-- tier con el "logros" más alto que sea <= a los logros reales del
-- ticket — el tier más alto configurado actúa como "techo abierto" para
-- cualquier parley más grande, sin volver a tocar la base de datos cada
-- vez que se agregue un nivel nuevo. Ejemplo para el grupo que describió
-- el usuario: '[{"logros":1,"porcentaje":2},{"logros":2,"porcentaje":3},{"logros":3,"porcentaje":5}]'.
alter table grupos add column if not exists modelo_comision text not null default 'plano'
  check (modelo_comision in ('plano', 'por_tipo_jugada'));
alter table grupos add column if not exists comision_tiers jsonb not null default '[]';

-- =================================================================
-- NÚMERO AUTORIZADO PARA LOS COMANDOS DE CHAT DE WHATSAPP (09-09-2026, a
-- pedido del usuario: "los comandos lo puede mandar el mismo que manda
-- el comando sabana jugada, pero aparte en super admin yo puedo agregar
-- un numero y activarle o desactivarle, la funcion de enviar comandos").
--
-- OJO, esto NO restringe quién puede mandar "SABANA DE JUGADAS" (eso
-- sigue siendo cualquiera en el grupo de WhatsApp vinculado con el
-- servicio contratado, sin cambios) — es una segunda capa, EXCLUSIVA de
-- los 4 comandos de chat nuevos ("act"/"saldo final"/"corte semana"/
-- "saldo total semana <nombre>", ver whatsappTrigger.detectarComando()):
-- un único número de teléfono por grupo, que el Súper-admin carga y
-- puede prender/apagar, mismo espíritu que whatsapp_habilitado. Sin
-- comandos_whatsapp_habilitado=true Y un comandos_whatsapp_numero
-- cargado, ningún mensaje dispara ninguno de los 4 comandos, sin
-- importar quién lo mande (ver estaAutorizadoParaComandos() en
-- whatsappBot.js).
--
-- comandos_whatsapp_numero se guarda tal cual lo escriba el Súper-admin
-- (con o sin "+", espacios, guiones) — la comparación contra el número
-- real de WhatsApp del remitente se hace normalizando ambos lados a solo
-- dígitos (ver normalizarTelefono()/telefonoDeParticipante() en
-- whatsappTrigger.js), así que el formato exacto no importa.
alter table grupos add column if not exists comandos_whatsapp_habilitado boolean not null default false;
alter table grupos add column if not exists comandos_whatsapp_numero text;

-- =================================================================
-- MÓDULOS CONTRATADOS POR GRUPO — Deportes / Hipismo (22-09-2026, a
-- pedido del usuario: "donde le coloco si el grupo tiene deportes o
-- hipismo? a los grupos que ya estan creados se le puede colocar?").
-- Ver la arquitectura completa en claude/plan-modulo-hipismo.md (el
-- documento del Proyecto "DEPORTES", no vive en este repo) — resumen:
-- Deportes e Hipismo conviven en UNA sola cuenta/login por grupo (no hay
-- 2 portales), pero cada grupo puede haber contratado uno de los dos
-- productos o los dos, y eso lo decide y factura el Súper-admin, no el
-- propio Grupo. Mismo espíritu que whatsapp_habilitado más arriba:
-- interruptor manual, sin cobro automático, EXCLUSIVO del Súper-admin
-- (PATCH /api/superadmin/grupos/:id/modulo-deportes y
-- .../modulo-hipismo, ver superadmin.js/superadmin.html, pestaña
-- "🎯 Módulos"). El propio Grupo no tiene ningún botón para tocar estas
-- 2 columnas.
--
-- Default modulo_deportes_habilitado = TRUE y modulo_hipismo_habilitado
-- = FALSE a propósito: así, correr este ALTER TABLE sobre la base de
-- datos real (con todos los grupos ya creados hasta hoy, todos
-- trabajando en Deportes) no le cambia nada a ninguno — todos quedan
-- exactamente como ya estaban (Deportes prendido, Hipismo apagado) sin
-- tocarlos a mano uno por uno. Para sumarle Hipismo a un grupo que ya
-- existe, el Súper-admin simplemente prende su interruptor
-- "modulo_hipismo_habilitado" desde esa pestaña, igual que con uno
-- nuevo.
--
-- OJO — alcance real a esta fecha: estas 2 columnas y sus rutas ya
-- quedan funcionando de verdad (se guardan y se leen de la base de
-- datos), pero por ahora es solo el "interruptor administrativo" — el
-- selector "⚽ Deportes"/"🐎 Hipismo" que el plan describe DENTRO del
-- panel del propio Grupo (grupo.html) todavía NO está construido, porque
-- Hipismo en sí sigue siendo un mockup de front-end (hipismo-mockup.html)
-- sin rutas ni tablas reales — no hay, todavía, nada real que ese
-- selector deba mostrar del lado de Hipismo. Eso es el siguiente paso
-- pendiente del plan.
alter table grupos add column if not exists modulo_deportes_habilitado boolean not null default true;
alter table grupos add column if not exists modulo_hipismo_habilitado boolean not null default false;

-- "Cruzar jugadas" de Hipismo, exclusivo del Súper-admin (24-09-2026, a
-- pedido del usuario: "el boton de cruzar jugadas o no debe activarse o
-- desactivarse desde super admin, ya que no todos los grupos cruzan las
-- jugadas"). Hasta ahora el checkbox "Cruzar jugadas" de Cargar Planos
-- (hipismo-mockup.html) era 100% libre: cualquier operador del Grupo lo
-- prendía/apagaba en cada cálculo, sin ninguna restricción — el propio
-- HTML ya tenía puesto un tooltip ("Se activa/desactiva por grupo desde
-- Súper-admin") que describía esta columna, pero nunca se había
-- construido de verdad. Mismo patrón EXACTO que modulo_hipismo_habilitado
-- arriba: interruptor manual (PATCH /api/superadmin/grupos/:id/
-- hipismo-cruzar, ver superadmin.js/superadmin.html pestaña "🎯 Módulos"
-- > 🐎 Módulo Hipismo). Cuando está en false, hipismo-mockup.html oculta
-- el checkbox y manda cruzaJugadas=false SIEMPRE al servidor, sin
-- importar nada que quede en el DOM.
--
-- Default TRUE a propósito: hasta ahora el checkbox arrancaba "checked"
-- para TODOS los grupos sin excepción — este ALTER TABLE preserva
-- exactamente ese comportamiento para todos los grupos que ya existen
-- (nadie pierde su "cruzar jugadas" de un día para otro); el Súper-admin
-- apaga el interruptor a mano solo en los grupos que de verdad no cruzan.
alter table grupos add column if not exists hipismo_cruzar_habilitado boolean not null default true;

-- (25-09-2026) Acá hubo por un momento una columna `password_visible_cifrada`
-- (clave cifrada de forma reversible, para que Súper-admin pudiera "ver"
-- la clave de cualquier grupo). El usuario, tras pensarlo, decidió que por
-- seguridad es mejor NO tener guardada en ningún lado una clave que se
-- pueda recuperar, ni siquiera cifrada — así que se revirtió esa misma
-- ronda, antes de que llegara a usarse en producción. La única forma de
-- ayudar a un grupo con su clave sigue siendo RESTABLECERLA (Súper-admin
-- fija una nueva, sin necesitar la vieja) — ver PATCH /grupos/:id/password
-- en superadmin.js. Si en algún momento llegaste a correr esta línea en
-- Supabase, la columna quedó ahí sin usarse (no hace falta borrarla a
-- mano, pero se puede con `alter table grupos drop column if exists
-- password_visible_cifrada;` si lo prefieres).

-- =================================================================
-- HIPISMO — backend real (22-09-2026, a pedido del usuario: "conecta el
-- modulo real al backend ya quiero trabajar y hacer pruebas"). Primera
-- rebanada real del módulo, la que todo lo demás del plan depende de que
-- exista (ver claude/plan-modulo-hipismo.md / claude/spec-modulo-hipismo.md,
-- que viven en el Proyecto "DEPORTES", no en este repo): guardar un plano
-- ya calculado ("Cargar Planos", spec sección 4.1-8) de verdad en la base
-- de datos, en vez de solo calcularlo en memoria del navegador como hacía
-- hipismo-mockup.html hasta ahora. El resto del plan (Pozos con
-- histórico real, Cierre Final agregado real, Comisiones Devueltas/Saldo
-- Comisiones —dependen de una fórmula todavía sin confirmar—, portal
-- público del cliente con datos reales, WhatsApp por módulo) sigue
-- pendiente — ver la nota en cada pantalla del mockup que todavía usa
-- datos de ejemplo.
--
-- HIPÓDROMOS por grupo (Administración > Hipódromos, spec sección 3).
create table if not exists hipismo_hipodromos (
  id            uuid primary key default gen_random_uuid(),
  grupo_id      uuid not null references grupos(id) on delete cascade,
  nombre        text not null,
  pais          text not null default 'VE', -- 'VE' (🇻🇪 nacional) | 'US' (🇺🇸 americano) — ver spec sección 3
  carreras_max  integer not null default 25,
  creado_en     timestamptz not null default now()
);
-- Único por grupo, sin importar mayúsculas/minúsculas (evita "La Rinconada"
-- y "la rinconada" como 2 hipódromos distintos por accidente).
create unique index if not exists idx_hipismo_hipodromos_grupo_nombre on hipismo_hipodromos(grupo_id, lower(nombre));

-- PLANOS — cabecera de cada plano de Hipismo ya calculado y guardado
-- (spec secciones 1, 5, 6, 7). texto_resultado es el bloque ✅GANAN/❌PIERDEN
-- ya armado (spec sección 7.1), listo para copiar y pegar al grupo de
-- WhatsApp tal cual, sin comisión — la comisión sí se guarda aparte en
-- comision_total, para Balance General/Cierre Final (uso interno).
create table if not exists hipismo_planos (
  id                uuid primary key default gen_random_uuid(),
  grupo_id          uuid not null references grupos(id) on delete cascade,
  hipodromo_id      uuid references hipismo_hipodromos(id) on delete set null,
  hipodromo_nombre  text not null, -- copia del nombre al momento de calcular, por si el hipódromo se renombra/borra después
  carrera_numero    integer not null,
  fecha             date not null,
  ret               text,
  pizarra           text not null, -- ej. "6.10.4.8.2", tal cual se escribió
  cruza_jugadas     boolean not null default false,
  texto_original    text not null, -- el plano tal como lo pegó el administrador
  texto_resultado   text not null, -- encabezado + líneas resueltas + GANAN/PIERDEN + pie, listo para copiar
  comision_total    numeric not null default 0,
  creado_en         timestamptz not null default now()
);
create index if not exists idx_hipismo_planos_grupo_fecha on hipismo_planos(grupo_id, fecha);

-- TICKETS — una fila por línea del plano ya resuelta (spec sección 5):
-- quién jugó/banqueó qué modalidad y caballo, y el resultado de ESA línea
-- puntual ya con el 5% de comisión aplicado al lado que ganó (spec
-- sección 6) — esto es el detalle que se guarda SIEMPRE, cruce o no.
-- Cuando el grupo cruza jugadas (spec sección 7), el saldo final por
-- cliente que se usa en Balance General se recalcula sumando el BRUTO
-- (sin comisión) de todas sus líneas y aplicando el 5% una sola vez al
-- final si ese neto es positivo — hipismo_planos.texto_resultado ya trae
-- ese resultado final armado, este detalle línea por línea queda para
-- auditoría/Traspasos de Jugadas más adelante.
create table if not exists hipismo_tickets (
  id                  uuid primary key default gen_random_uuid(),
  plano_id            uuid not null references hipismo_planos(id) on delete cascade,
  grupo_id            uuid not null references grupos(id) on delete cascade,
  cliente_nombre      text not null, -- quien jugó (el "jugador" de la línea)
  banquero_nombre     text not null, -- quien banqueó/cubrió esa línea
  modalidad           text not null, -- '1p'..'10p', '1/2', '2n', '2y2', '2y3', '3n', 'pp', '10/N'
                                      -- ("a premio" — 24-09-2026: también admite "10@N"/"aN"/"a N",
                                      -- ver DECIMOS_RE en services/hipismoCalc.js), y combos de 2 a
                                      -- la vez guardados SIEMPRE con guion pegado, ej. '1/2-1p',
                                      -- '2n-1y2' (24-09-2026, ver resolverModalidadCompuesta())
  caballo             text,          -- número de caballo tal cual se escribió ("10", "9x2" para pp,
                                      -- o "6,10" para una "morocha" — varios caballos con la MISMA
                                      -- modalidad, "o uno o el otro" — 2 o más, guardados SIEMPRE
                                      -- separados por coma aunque el operador los haya escrito con
                                      -- "y" o guion, 24-09-2026, ver resolverModalidadMultiCaballo())
  monto               numeric not null,
  resultado_jugador   numeric not null default 0,  -- ya con comisión aplicada si ganó esta línea puntual
                                                     -- (salvo sin_comision=true, ver abajo)
  resultado_banquero  numeric not null default 0,
  sin_comision        boolean not null default false, -- 24-09-2026: esta línea es una jugada "a
                                      -- premio" que el operador marcó, ANTES de calcular esa carrera,
                                      -- para que el 5% NO se descuente al ganador (ver
                                      -- esModalidadSinComision()/montoMostrado() en hipismoCalc.js) —
                                      -- queda guardado por ticket para que editar OTRO ticket del
                                      -- mismo plano (recalcularTotalesPlano) no le aplique/quite la
                                      -- comisión por error.
  creado_en           timestamptz not null default now()
);
create index if not exists idx_hipismo_tickets_plano on hipismo_tickets(plano_id);
create index if not exists idx_hipismo_tickets_grupo_cliente on hipismo_tickets(grupo_id, cliente_nombre);

-- 24-09-2026: columna nueva para una base que YA tenía hipismo_tickets
-- creada antes de esta ronda (el "create table if not exists" de arriba
-- no la agrega sola en ese caso) — función de "sin comisión" para
-- jugadas "a premio", ver la nota grande junto a la definición de la
-- columna más arriba.
alter table hipismo_tickets add column if not exists sin_comision boolean not null default false;

-- =================================================================
-- REMATE (23-09-2026, "sección cargar remate" — a pedido del usuario, con
-- un formato real de ejemplo: "🇻🇪🐴REMATE ADELANTADO ZENYATTA🐴🇻🇪" +
-- una línea por caballo con su monto y cliente + "PAGANDO/GARANTIZA/PAGA
-- $X"). Un remate es un pozo aparte de los Tercios normales: cada cliente
-- le apuesta a UN caballo puntual de la carrera; si ESE caballo gana la
-- carrera, ese cliente se gana el pozo completo (menos la comisión de la
-- casa, o el monto garantizado si el pozo no alcanza para sacar esa
-- comisión) — todos los demás pierden lo que apostaron. Es un modelo de
-- pago totalmente distinto al de "Cargar Planos" (que paga posición por
-- posición, línea por línea), así que se guarda en sus propias tablas en
-- vez de reusar hipismo_planos/hipismo_tickets.
--
-- La regla de pago (confirmada con el usuario, 23-09-2026):
--   - Si el número de caballo que ganó la carrera SÍ está entre los
--     jugados en el remate: pago_ganador = MAX(pool_total * (1 - %comisión),
--     garantía) — o sea, se le saca el % de comisión normalmente, salvo
--     que eso deje al ganador por debajo de lo garantizado/pagando/pagado
--     en el anuncio, en cuyo caso se le paga esa garantía completa (la
--     comisión de la casa baja, o hasta se pierde, para cumplirla).
--     comision_total = pool_total - pago_ganador.
--   - Si el número de caballo que ganó la carrera NO fue jugado por
--     nadie en el remate ("quedó para la banca"): nadie gana nada, TODOS
--     pierden lo que apostaron, no se saca ningún % (ya es el 100% del
--     pool) y comision_total = pool_total completo.
-- El % de comisión es un campo aparte porque "no todos los remates cobran
-- igual porcentaje" (a diferencia del 5% fijo de los Tercios).
create table if not exists hipismo_remates (
  id                    uuid primary key default gen_random_uuid(),
  grupo_id              uuid not null references grupos(id) on delete cascade,
  hipodromo_id          uuid references hipismo_hipodromos(id) on delete set null,
  hipodromo_nombre      text not null,
  carrera_numero        integer not null,
  fecha                 date not null,
  texto_original        text not null, -- el remate tal como lo pegó el administrador
  comision_porcentaje   numeric not null default 0, -- ej. 20 = 20% (solo aplica en modo "REMATE GARANTIZA" o sin garantía/pago fijo; en "REMATE PAGA" no se usa)
  garantia              numeric, -- "REMATE GARANTIZA $X" del texto o escrito a mano — piso mínimo que se paga, combinado con comision_porcentaje (26-09-2026, ver la nota grande en services/hipismoRemateCalc.js)
  pool_total            numeric not null default 0, -- suma de todos los montos jugados
  pizarra               text not null, -- llegada usada para saber quién ganó (de un plano ya cargado, o cargada a mano acá)
  numero_ganador        integer not null, -- número de ejemplar que ganó la carrera (1er lugar de la pizarra)
  hubo_ganador          boolean not null default false, -- false = "quedó para la banca" (nadie jugó ese número)
  caballo_ganador       text,
  cliente_ganador       text,
  pago_ganador          numeric not null default 0,
  comision_total        numeric not null default 0, -- pool_total - pago_ganador (= pool_total completo si no hubo ganador). 26-09-2026, a pedido del usuario ("SOLUCIONA ESO... no lo estás colocando en su ítem llamado remate, sino que lo estás sumando en la comisión"): a pesar del nombre de esta columna (que no se renombra para no romper datos ya guardados), esto YA NO es "comisión" — es el resultado (ganancia o pérdida) de este remate puntual, que en los balances se muestra como su propio ítem "REMATE" (ver GET /cierre-final y construirResumenRemateHipismo en services/hipismoResumenCliente.js), nunca sumado a la comisión de Tercios/Adelantadas ni al % devuelto de los clientes.
  texto_resultado       text not null, -- mensaje ya armado, listo para copiar a WhatsApp
  creado_en             timestamptz not null default now()
);
create index if not exists idx_hipismo_remates_grupo_fecha on hipismo_remates(grupo_id, fecha);

-- Una fila por línea/caballo del remate (spec: número de ejemplar,
-- caballo, monto, cliente) — mismo criterio que hipismo_tickets: se
-- guarda el detalle completo, con el resultado NETO de esa línea ya
-- resuelto (pago_ganador - monto si esa línea ganó, -monto si perdió).
create table if not exists hipismo_remate_apuestas (
  id                uuid primary key default gen_random_uuid(),
  remate_id         uuid not null references hipismo_remates(id) on delete cascade,
  grupo_id          uuid not null references grupos(id) on delete cascade,
  numero_ejemplar   integer not null,
  caballo           text not null,
  cliente_nombre    text not null,
  monto             numeric not null,
  resultado         numeric not null default 0,
  creado_en         timestamptz not null default now()
);
create index if not exists idx_hipismo_remate_apuestas_remate on hipismo_remate_apuestas(remate_id);
create index if not exists idx_hipismo_remate_apuestas_grupo_cliente on hipismo_remate_apuestas(grupo_id, cliente_nombre);

-- =================================================================
-- JUGADAS ADELANTADAS — "Tablas Fijas y Marcas" (23-09-2026, nueva
-- pestaña "Apuestas > Jugadas Adelantadas", a pedido del usuario, con un
-- formato real de ejemplo: "PLANOS MARCAS Y TABLAS ADELANTADAS ZENYATTA"
-- + bloques "JUGANDO <cliente>" + líneas "N) 5TF DEL X A Y ,monto/pago$"
-- o "N) AxB monto$"). Ver la nota grande al principio de
-- src/services/hipismoAdelantadasCalc.js para la fórmula completa de
-- cada tipo de jugada — acá solo el porqué del esquema.
--
-- Un cliente pega ESTAS jugadas ANTES de que corra la carrera (de ahí
-- "adelantadas") — pueden pasar días hasta que la carrera puntual de
-- cada línea se corra de verdad y llegue su pizarra. Por eso se separan
-- en 2 tablas (cabecera del plano pegado + cada línea/jugada suelta,
-- mismo criterio que hipismo_planos/hipismo_tickets), y cada línea vive
-- su propio ciclo de vida en `estado`:
--   'pendiente'      -> todavía no llegó la pizarra de esa carrera.
--   'resuelto'       -> ya se sabe el resultado final de TODOS (cliente,
--                       y si es marca, también cada banquero).
--   'falta_banqueo'  -> SOLO marcas: ya se sabe si acertó y cuánto le
--                       toca al cliente, pero todavía no se asignó quién
--                       banquea la marca (paso manual aparte, ver
--                       POST /adelantadas/jugadas/:id/banquear).
--   'sin_decidir'    -> SOLO marcas de hipódromos nacionales cuya
--                       pizarra nunca llegó a tener 5 puestos — se dio
--                       por resuelta con 0 para todos en vez de quedar
--                       pendiente para siempre (confirmado con el
--                       usuario, ver la nota grande en el .js de arriba).
create table if not exists hipismo_adelantadas_planos (
  id                uuid primary key default gen_random_uuid(),
  grupo_id          uuid not null references grupos(id) on delete cascade,
  hipodromo_id      uuid references hipismo_hipodromos(id) on delete set null,
  hipodromo_nombre  text not null,
  fecha             date not null, -- el día que se JUEGAN las carreras, no el día que se pegó el plano
  texto_original    text not null,
  creado_en         timestamptz not null default now()
);
create index if not exists idx_hipismo_adelantadas_planos_grupo_fecha on hipismo_adelantadas_planos(grupo_id, fecha);

create table if not exists hipismo_adelantadas_jugadas (
  id                    uuid primary key default gen_random_uuid(),
  plano_id              uuid not null references hipismo_adelantadas_planos(id) on delete cascade,
  grupo_id              uuid not null references grupos(id) on delete cascade,
  cliente_nombre        text not null,
  carrera_numero        integer not null,
  tipo                  text not null check (tipo in ('tf','marca')),
  -- Tablas Fijas
  cantidad_tf           integer,
  numero_ejemplar       integer,
  precio_por_tf         numeric,
  ganancia_potencial    numeric,
  -- Marcas (1er y 2do lugar exactos)
  numero1               integer,
  numero2               integer,
  -- común a los 2 tipos
  monto                 numeric not null,
  comision_porcentaje   numeric not null default 2.5, -- configurable al cargar el plano ("permiteme colocar cuanto es el %")
  texto_original        text not null,
  error_calculo         boolean not null default false, -- la multiplicación (cantidad×precio, o cantidad×100) no calzó con lo escrito en el plano
  detalle_error         text,
  estado                text not null default 'pendiente' check (estado in ('pendiente','resuelto','falta_banqueo','sin_decidir')),
  gano                  boolean, -- tf: ganó la tabla fija | marca: acertó el 1ro-2do exacto
  resultado_cliente     numeric, -- neto del cliente que jugó (ya resuelto en cuanto sale de 'pendiente')
  comision              numeric, -- tf: comisión de esa línea | marca: total de "Comisión Marcas" ya sumado entre los banqueros que cobran
  banqueadores          jsonb, -- solo marcas ya banqueadas: [{ nombre, porcentaje, pagaComision, comisionPorcentaje, monto }]
  pizarra_usada         text,
  resuelto_en           timestamptz,
  creado_en             timestamptz not null default now()
);
-- 07-10-2026: jugada "sin comisión" (se edita desde Revisar Jugadas): se resuelve igual con la pizarra pero
-- con 0% para todos (contraparte exacta, sin comisión de grupo, sin % devuelto). Es como un traspaso con monto ya neto.
alter table hipismo_adelantadas_jugadas add column if not exists sin_comision boolean not null default false;
-- 07-10-2026: con "sin comisión" el usuario puede escribir a mano el resultado del cliente y el monto de cada
-- ítem de la contraparte (suman 0). Quedan FIJOS: la pizarra no los vuelve a calcular.
alter table hipismo_adelantadas_jugadas add column if not exists montos_manuales boolean not null default false;
create index if not exists idx_hipismo_adelantadas_jugadas_plano on hipismo_adelantadas_jugadas(plano_id);
create index if not exists idx_hipismo_adelantadas_jugadas_grupo_cliente on hipismo_adelantadas_jugadas(grupo_id, cliente_nombre);
create index if not exists idx_hipismo_adelantadas_jugadas_pendientes on hipismo_adelantadas_jugadas(grupo_id, estado);

-- =================================================================
-- HIPISMO_TERCIOS_ADELANTADAS_* (04-10-2026) — nueva pestaña "Jugadas
-- entre Tercios Adelantadas", arquitectura hermana de
-- hipismo_adelantadas_planos/jugadas de arriba (ahora renombrada en la
-- UI a "Tablas Fijas y Marcas") pero con la gramática de Tercios en vez
-- de Tablas Fijas/Marcas (ver services/hipismoTerciosAdelantadasCalc.js
-- para el motor de cálculo puro). A pedido del usuario: "crea una
-- pestaña nueva que diga jugadas entre tercios adelantadas, y la
-- pestaña que tenemos como jugadas adelantadas actualmente ponle el
-- nombre de tablas fijas y marcas, asi no chocan... ambas pestañas se
-- jalan al plano cuando los calcule y le ponga su pizarra y saldran en
-- el apartado de jugadas adelantadas con su configuracion".
--
-- A diferencia de Tablas Fijas/Marcas (cliente contra "la banca"), acá
-- CADA jugada tiene un jugador Y un banquero explícitos (igual que
-- Tercios en vivo) -- por eso no hace falta una cuenta "espejo" como
-- "TABLAS FIJAS": jugador + banquero + comisión del grupo ya suman 0
-- solos (ver mezclarTerciosAdelantadasEnBalance en routes/hipismo.js).
create table if not exists hipismo_tercios_adelantadas_planos (
  id                  uuid primary key default gen_random_uuid(),
  grupo_id            uuid not null references grupos(id) on delete cascade,
  hipodromo_id        uuid references hipismo_hipodromos(id) on delete set null,
  hipodromo_nombre    text not null,
  fecha               date not null, -- el día que se JUEGAN las carreras
  comision_porcentaje numeric not null default 5, -- configurable al cargar el plano (reemplaza el 5% fijo de Tercios normal)
  texto_original      text not null,
  creado_en           timestamptz not null default now()
);
create index if not exists idx_hipismo_tercios_adelantadas_planos_grupo_fecha on hipismo_tercios_adelantadas_planos(grupo_id, fecha);

create table if not exists hipismo_tercios_adelantadas_jugadas (
  id                    uuid primary key default gen_random_uuid(),
  plano_id              uuid not null references hipismo_tercios_adelantadas_planos(id) on delete cascade,
  grupo_id              uuid not null references grupos(id) on delete cascade,
  jugador_nombre        text not null default '',
  banquero_nombre       text not null default '',
  carrera_numero        integer,
  es_cruce              boolean not null default false,
  grupo_caballos        jsonb, -- [n,...] cuando NO es cruce (resolverModalidadMultiCaballo)
  cruce_grupo_a         jsonb, -- [n,...] caballo(s) del lado jugador, cuando es_cruce
  cruce_grupo_b         jsonb, -- [n,...] caballo(s) del lado banquero, cuando es_cruce
  modalidad             text,  -- tal cual ("1p","10a8",...); NULL = default ("1p" en grupo, "pelo a pelo" en cruce)
  monto                 numeric,
  comision_porcentaje   numeric not null default 5,
  texto_original        text not null,
  falta_monto           boolean not null default false,
  falta_jugador         boolean not null default false,
  falta_banquero        boolean not null default false,
  estado                text not null default 'pendiente' check (estado in ('pendiente','resuelto','sin_decidir')),
  resultado_jugador     numeric, -- ya con el % aplicado (montoJugadorMostrado)
  resultado_banquero    numeric, -- ya con el % aplicado (montoBanqueroMostrado)
  comision_grupo        numeric,
  pizarra_usada         text,
  resuelto_en           timestamptz,
  creado_en             timestamptz not null default now()
);
create index if not exists idx_hipismo_tercios_adelantadas_jugadas_plano on hipismo_tercios_adelantadas_jugadas(plano_id);
create index if not exists idx_hipismo_tercios_adelantadas_jugadas_pendientes on hipismo_tercios_adelantadas_jugadas(grupo_id, estado);
create index if not exists idx_hipismo_tercios_adelantadas_jugadas_errores on hipismo_tercios_adelantadas_jugadas(grupo_id) where (falta_monto or falta_jugador or falta_banquero);

-- =================================================================
-- HIPISMO_PLANOS_PAPELERA — "papelera recuperable" para "Eliminar Planos"
-- (23-09-2026, a pedido del usuario: "en apuestas crea un boton de
-- eliminar planos, alli me saldran todos los planos, yo seleccionare la
-- fecha... y despues se desplegaran ordenados por hipodromos por carrera
-- todos los planos"). MISMO criterio ya usado para Deportes
-- (sabana_papelera, ver la nota grande de esa tabla más abajo — "papelera
-- recuperable... más seguro para un sistema contable", respuesta textual
-- del usuario en esa ronda): antes de borrar un plano de verdad
-- (DELETE /planos/:id) se guarda una COPIA completa acá (el plano entero
-- + todos sus tickets, con sus mismos ids) para poder deshacer el borrado
-- con "♻️ Restaurar" (pantalla "🗑️ Planos Eliminados", Administración)
-- mientras la fila siga acá — se purgan solas pasados 30 días (mismo
-- plazo que sabana_papelera), tanto restauradas como no.
--
-- OJO: borrar un plano de Tercios NO deshace ninguna Jugada Adelantada
-- que ese plano haya resuelto (esas jugadas ya quedaron 'resuelto'/
-- 'falta_banqueo'/'sin_decidir' en hipismo_adelantadas_jugadas de forma
-- independiente) — restaurar el plano solo trae de vuelta el plano y sus
-- tickets de Tercios, no vuelve a dejar las adelantadas en 'pendiente'.
-- Esto es una limitación aceptada a propósito (no confirmada con el
-- usuario) para no complicar el borrado con una cascada de estados de
-- otra tabla — si hace falta lo contrario, es un cambio aparte.
create table if not exists hipismo_planos_papelera (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  fecha          date not null,
  hipodromo_nombre text not null,
  carrera_numero integer not null,
  plano_json     jsonb not null,       -- copia completa de la fila de hipismo_planos
  tickets_json   jsonb not null default '[]', -- copia completa de sus hipismo_tickets
  eliminado_en   timestamptz not null default now(),
  restaurado_en  timestamptz
);
create index if not exists idx_hipismo_planos_papelera_grupo on hipismo_planos_papelera(grupo_id, eliminado_en);

-- =================================================================
-- HIPISMO_ALERTAS (23-09-2026, duodécima-tercera ronda, a pedido del
-- usuario: "se genera una alerta en una pestaña que diga alertas que
-- este debajo de administracion, indicando que se edito y que usuario
-- se edito..... si el plano lo eliminan se genera la alerta igual
-- mente"). Registro de auditoría de ediciones/eliminaciones de dinero
-- real en Hipismo (planos de Tercios y jugadas de Tablas Fijas/Marcas) —
-- quién lo hizo (req.nombreActor: el Administrador o el nombre del
-- Empleado) y qué cambió.
--
-- A PROPÓSITO una tabla PROPIA de Hipismo en vez de reusar la tabla
-- "alertas" ya existente (arriba): esa tabla está armada específicamente
-- para el flujo de AMBIGUA_DEPORTE/SIN_LOGRO de Deportes (candidatos
-- jsonb para elegir un deporte, resoluciones_ambiguas enlazada, un
-- índice único parcial que exige "pata" no nulo para des-duplicar
-- reprocesos de sábana) — nada de eso aplica acá. Mismo criterio ya
-- usado en el resto del módulo: hipismo_planos_papelera en vez de
-- reusar sabana_papelera, hipismo_hipodromos en vez de reusar nada de
-- Deportes, etc.
create table if not exists hipismo_alertas (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null references grupos(id) on delete cascade,
  tipo         text not null check (tipo in ('PLANO_EDITADO','PLANO_ELIMINADO','ADELANTADA_EDITADA','ADELANTADA_ELIMINADA')),
  usuario      text not null,     -- req.nombreActor: nombre del Administrador o del Empleado que hizo el cambio
  hipodromo_nombre text,
  carrera_numero   integer,
  fecha        date,
  mensaje      text not null,     -- detalle legible ("Editó el ticket de MUJICA: monto 100 -> 120", etc.)
  creado_en    timestamptz not null default now()
);
create index if not exists idx_hipismo_alertas_grupo on hipismo_alertas(grupo_id, creado_en desc);

-- JORNADA_ELIMINADA (24-09-2026) — se agrega un 5to tipo al check de
-- arriba, para "Eliminar Jornada" (Administración): a pedido del usuario
-- ("crea un boton que diga eliminar jornada... al seleccionar un dia
-- borra todo lo que este ese dia, todas las jugadas, remate, ganadores,
-- jugadas entre tercios, todo absolutamente todo del dia"). A diferencia
-- de los otros 4 tipos (que son sobre UN plano/jugada puntual), este es
-- sobre TODA una fecha de una — ver routes/hipismo.js, POST /jornada/
-- eliminar. El usuario pidió explícitamente que fuera un borrado
-- PERMANENTE (no recuperable como "Eliminar Planos"), protegido con su
-- propia clave de acceso ("PIDEME LA CLAVE DE ACCESO PARA VERIFICAR QUE
-- QUIERO ELIMINARLO, AL ELIMINARLO SE BORRA PARA SIEMPRE") — se valida
-- contra la MISMA contraseña con la que esa sesión inició sesión
-- (grupos.password_hash o empleados.password_hash, bcrypt.compare, igual
-- que /api/auth/login), no un PIN aparte.
--
-- WINNER_EDITADO / WINNER_ELIMINADO (28-09-2026) — se agregan 2 tipos más,
-- para "Eliminar Winners" (ver routes/hipismo.js, PUT/DELETE /winners/:id),
-- a pedido del usuario ("crea un boton debajo de cargar winners... que se
-- llame eliminar winners... alli podre ver editar y eliminar todas las
-- jugadas de winners").
--
-- 29-09-2026: este archivo ORIGINALMENTE traía el ensanche de este check
-- en 2 pasos separados (primero JORNADA_ELIMINADA sola, después
-- WINNER_EDITADO/WINNER_ELIMINADO en un segundo DROP+ADD) — cada uno
-- reflejaba el orden histórico en que se pidieron. El problema: correr
-- este archivo COMPLETO de nuevo contra una base de datos que YA tiene
-- filas con tipo='WINNER_EDITADO'/'WINNER_ELIMINADO' (cualquier grupo que
-- ya haya usado "Eliminar Winners" en producción) hace que el PRIMER
-- DROP+ADD (con la lista vieja de 5 tipos, sin los 2 de Winners) reviene
-- con "check constraint... violated by some row" — el archivo nunca
-- llegaba a la versión final de abajo. Se deja UN SOLO DROP+ADD con la
-- lista completa, para que re-correr este archivo en cualquier momento
-- (con cualquier historial de alertas ya guardado) sea siempre seguro.
--
-- PIZARRA_EDITADA / PIZARRA_ELIMINADA (01-10-2026) — se agregan 2 tipos
-- más, para la nueva pantalla "Pizarras" (ver routes/hipismo.js, PUT/
-- DELETE /pizarras/tercios/:id y /pizarras/remate/:id), a pedido del
-- usuario ("crea un boton debajo de hipodromos que diga pizarras...
-- alli puedo ver, editar, eliminar... las llegadas de las carreras").
-- Mismo criterio de UN SOLO DROP+ADD consolidado explicado arriba.
--
-- TERCIOS_ADELANTADA_EDITADA / TERCIOS_ADELANTADA_ELIMINADA (04-10-2026)
-- — 2 tipos más, para "Jugadas entre Tercios Adelantadas" (ver
-- routes/hipismo.js, PUT/DELETE /tercios-adelantadas/jugadas/:id) —
-- mismo criterio de auditoría que ADELANTADA_EDITADA/ADELANTADA_ELIMINADA
-- de arriba, tabla aparte porque es una pestaña distinta.
--
-- REMATE_MANUAL_ELIMINADO (04-10-2026) — 1 tipo más, para el borrado
-- permanente de un Remate Manual (ver DELETE /remates/manual/:id en
-- routes/hipismo.js) — a diferencia de PIZARRA_ELIMINADA (que solo deja
-- la carrera pendiente), esto SÍ borra la fila entera, así que queda su
-- propio tipo de alerta.
alter table hipismo_alertas drop constraint if exists hipismo_alertas_tipo_check;
alter table hipismo_alertas add constraint hipismo_alertas_tipo_check
  check (tipo in ('PLANO_EDITADO','PLANO_ELIMINADO','ADELANTADA_EDITADA','ADELANTADA_ELIMINADA','JORNADA_ELIMINADA','WINNER_EDITADO','WINNER_ELIMINADO','PIZARRA_EDITADA','PIZARRA_ELIMINADA','TERCIOS_ADELANTADA_EDITADA','TERCIOS_ADELANTADA_ELIMINADA','REMATE_MANUAL_ELIMINADO')) not valid;

-- =================================================================
-- (18-09-2026) Acá vivió un tiempo corto el interruptor por-grupo
-- "modo cuidadoso" (whatsapp_modo_cuidadoso) — la idea original, tras el
-- cierre de cuenta de WhatsApp del usuario, era que cada Grupo pudiera
-- prender/apagar el envío automático del bot. El usuario después pidió
-- sacar la opción entera: "desactiva el otro modo de sabana automatica,
-- deja solo este que es mas cuidadoso, asi no tenemos tantas funciones
-- inutiles en el programa" — el comportamiento cuidadoso (el bot NUNCA
-- manda nada al grupo por su cuenta, solo por botón manual o comando de
-- chat) pasó a ser el único, permanente, para todos los Grupos, sin
-- interruptor. Ver la advertencia grande al principio de whatsappBot.js.
-- Una base de datos que ya corrió la versión vieja de este archivo puede
-- tener la columna whatsapp_modo_cuidadoso todavía ahí, sin uso — no
-- hace falta borrarla a mano, ningún código la lee ni la escribe más.
--
-- =================================================================
-- JUGADORES — el registro de "clientes" de cada grupo (Administración >
-- Jugador de la app actual). También es la tabla que le da al CLIENTE su
-- link individual: cada jugador tiene un "token" único e impredecible que
-- funciona como su acceso de solo lectura, sin contraseña.
-- =================================================================
create table if not exists jugadores (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  nombre         text not null,                 -- igual a como aparece en la sábana
  telefono       text,
  notas          text,
  activo         boolean not null default true,
  tipo_cuenta    text not null default 'libre' check (tipo_cuenta in ('libre','avalado')),
  pozo_inicial   numeric not null default 0,     -- solo aplica si tipo_cuenta = 'avalado'
  comision_propia numeric not null default 0,    -- % que gana sobre lo que ÉL arriesga
  auto_creado    boolean not null default false, -- true si se dio de alta solo al procesar una sábana
  token          uuid not null unique default gen_random_uuid(), -- link individual del cliente
  creado_en      timestamptz not null default now(),
  unique (grupo_id, nombre)
);

create index if not exists idx_jugadores_grupo on jugadores(grupo_id);
create index if not exists idx_jugadores_token on jugadores(token);

-- =================================================================
-- POZO_AJUSTES (23-09-2026, a pedido del usuario: "desde pozo necesito
-- seleccionar el cliente y editar el pozo, aumentarlo diminuirlo etc").
-- Registro de CADA ajuste manual al pozo de un jugador (+ para aumentar,
-- - para disminuir), con motivo opcional — mismo criterio de
-- "información contable" ya aplicado en el resto del sistema (Papelera
-- de Sábanas, Papelera de Planos): nunca se pisa el pozo sin dejar
-- rastro de cuánto cambió y por qué. jugadores.pozo_inicial sigue
-- siendo el número vigente (se sigue leyendo tal cual en el resto del
-- sistema, sin tocar ningún otro cálculo) — esta tabla es el HISTORIAL
-- de cómo se llegó a ese número. Compartida entre Deportes e Hipismo
-- (misma tabla jugadores, mismo concepto de pozo en los 2 módulos).
create table if not exists pozo_ajustes (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null references grupos(id) on delete cascade,
  jugador_id   uuid not null references jugadores(id) on delete cascade,
  monto        numeric not null,   -- positivo = aumento, negativo = disminución
  motivo       text,
  pozo_resultante numeric not null, -- pozo_inicial YA con este ajuste aplicado, para mostrar el historial sin recalcular
  usuario      text not null,      -- req.nombreActor
  creado_en    timestamptz not null default now()
);
create index if not exists idx_pozo_ajustes_jugador on pozo_ajustes(jugador_id, creado_en desc);

-- =================================================================
-- MODELO DE COMISIÓN INDIVIDUAL POR JUGADOR (09-09-2026, "grupo mixto" —
-- a pedido del usuario: "se puede tener un modelo de % en un grupo
-- mixto... es decir clientes que se le regrese % variados dependiendo de
-- las patas de las jugadas... o establecerle % fijo por cualquier tipo de
-- jugada etc" / "puedo elegir cualquier tipo de % o sin %").
--
-- Hasta acá (08-09-2026) el modelo de comisión ('plano' o
-- 'por_tipo_jugada', ver grupos.modelo_comision/comision_tiers más
-- arriba) era UNO SOLO para TODO el grupo — todos los clientes usaban el
-- mismo. Esta columna permite una EXCEPCIÓN puntual por jugador:
--   * NULL (default)         -> hereda el modelo DEFAULT del grupo, sin
--                                cambios de comportamiento para cualquier
--                                jugador que nunca toque esto.
--   * 'plano'                -> este jugador SIEMPRE usa su propio
--                                jugadores.comision_propia (que puede ser
--                                0 = "sin %"), sin importar en qué modelo
--                                esté el grupo — así un grupo que por
--                                defecto está en 'por_tipo_jugada' puede
--                                tener a un cliente puntual en % fijo (o
--                                sin comisión).
--   * 'por_tipo_jugada'      -> este jugador SIEMPRE usa los niveles del
--                                GRUPO (grupos.comision_tiers — un solo
--                                juego de niveles compartido, no hay
--                                niveles individuales por jugador todavía),
--                                sin importar en qué modelo esté el grupo
--                                — así un grupo que por defecto está en
--                                'plano' puede tener a un cliente puntual
--                                cobrando variable según cuántos logros
--                                tenga cada ticket.
-- Lo carga/edita el propio GRUPO, junto con comision_propia, desde
-- Administración > Jugador (routes/jugadores.js) — NO es exclusivo de
-- Súper-admin (a diferencia del modelo/niveles DEFAULT del grupo, que sí
-- lo sigue siendo) — es una decisión operativa día a día ("este cliente
-- puntual cobra distinto"), igual que ya lo es cargarle su % propio.
-- Ver comisiones.js (calcularComisionTotalCliente) para la regla exacta
-- de qué modelo "gana" para cada cliente.
alter table jugadores add column if not exists modelo_comision text check (modelo_comision is null or modelo_comision in ('plano','por_tipo_jugada'));

-- =================================================================
-- "Anclar/vincular módulos" (23-09-2026, a pedido del usuario: "hazlo
-- tambien al revez, pero solo sucedera si yo anclo o lo avctivo esa
-- funcion al cliente. si no cada pantalla es independiente") — un
-- cliente que juega Deportes E Hipismo es la MISMA fila acá (mismo
-- grupo_id + nombre), pero por defecto sus 2 links públicos (Deportes:
-- routes/cliente.js, Hipismo: routes/hipismoCliente.js) siguen siendo
-- 100% independientes, cada uno solo con los datos de su propio módulo
-- — igual que hoy. Si el Administrador prende este interruptor para ese
-- cliente puntual (PATCH /api/jugadores/:id/modulos-anclados, o desde el
-- propio formulario de Jugador), los 2 links pasan a mostrar TAMBIÉN los
-- datos del otro módulo, separados visualmente pero sumados al total.
-- Default false: ningún cliente existente cambia de comportamiento solo
-- por correr este ALTER.
alter table jugadores add column if not exists modulos_anclados boolean not null default false;

-- =================================================================
-- AVALES — "Avalados por": un jugador (avalador) gana un % adicional
-- sobre lo que arriesguen sus avalados, aparte de su propia comisión.
-- =================================================================
create table if not exists avales (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null references grupos(id) on delete cascade,
  avalador_id  uuid not null references jugadores(id) on delete cascade,
  avalado_id   uuid not null references jugadores(id) on delete cascade,
  porcentaje   numeric not null,
  creado_en    timestamptz not null default now(),
  unique (avalador_id, avalado_id),
  check (avalador_id <> avalado_id)
);

create index if not exists idx_avales_grupo on avales(grupo_id);

-- =================================================================
-- TICKETS_HISTORIAL — equivalente al "historial" que hoy vive en
-- localStorage (zenyatta_historial). Guarda cada ticket ya evaluado, por
-- fecha. Al reprocesar una fecha, el backend borra las filas viejas de esa
-- fecha+grupo antes de insertar las nuevas (mismo comportamiento que
-- guardarEnHistorial en la app actual) — así el usuario puede reenviar la
-- sábana varias veces en el día sin duplicar nada.
-- =================================================================
create table if not exists tickets_historial (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  fecha          date not null,
  cliente_nombre text not null,           -- nombre tal como se detectó en la sábana
  jugador_id     uuid references jugadores(id) on delete set null,
  ticket_label   text,                    -- ej. "Ticket #29"
  detalle        text,                    -- texto de las jugadas, para referencia
  arriesga       numeric not null default 0,
  gana           numeric not null default 0,  -- ganancia NETA (no el pago bruto)
  estado         text not null,           -- GANADA / PERDIDA / PENDIENTE / ANULADA / SUSPENDIDA / etc.
  creado_en      timestamptz not null default now()
);

create index if not exists idx_historial_grupo_fecha on tickets_historial(grupo_id, fecha);
create index if not exists idx_historial_grupo_cliente on tickets_historial(grupo_id, cliente_nombre);

-- "logros" (08-09-2026, junto con el modelo de comisión "por_tipo_jugada"
-- de arriba): cuántas "patas" tenía ese ticket (1 = directa, 2 = parley
-- de 2 logros, etc.) — se guarda para que Balance General y % Devueltos
-- puedan RECONSTRUIR la comisión correcta de un rango histórico sin tener
-- que reprocesar la sábana original de cada día. Nullable a propósito:
-- los tickets guardados ANTES de este cambio no tienen este dato — para
-- esos, porcentajePorTipoJugada() (comisiones.js) los trata como "0
-- logros" (ningún tier calza, comisión $0 de esa fila) en vez de
-- adivinar; es una limitación conocida y documentada, no un bug — un
-- grupo que recién ahora pasa a 'por_tipo_jugada' solo pierde precisión
-- en el historial VIEJO, nunca en tickets nuevos hacia adelante.
alter table tickets_historial add column if not exists logros integer;

-- =================================================================
-- TRANSFERENCIAS — mover saldo de un cliente a otro (Administración >
-- Transferencias).
-- =================================================================
create table if not exists transferencias (
  id              uuid primary key default gen_random_uuid(),
  grupo_id        uuid not null references grupos(id) on delete cascade,
  fecha           date not null,
  cliente_origen  text not null,
  cliente_destino text not null,
  monto           numeric not null check (monto > 0),
  nota            text,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_transferencias_grupo_fecha on transferencias(grupo_id, fecha);

-- =================================================================
-- POLLA_HISTORIAL — "Polla" (02-09-2026, a pedido del usuario): un
-- juego APARTE de la sábana. El admin del grupo pega a mano, ya
-- calculado, el resultado final de cada cliente (positivo = ganó ese
-- monto, negativo = perdió ese monto) — ver src/services/polla.js para
-- el formato de texto exacto y la fórmula. Igual que tickets_historial,
-- reprocesar la MISMA fecha reemplaza (borra+inserta) en vez de
-- acumular. A diferencia de la sábana, un nombre que no matchea ningún
-- jugador activo NO se auto-registra solo — se devuelve como
-- "noEncontrados" para que el admin corrija el texto.
-- =================================================================
create table if not exists polla_historial (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  fecha          date not null,
  cliente_nombre text not null,           -- nombre tal como está en "jugadores" (MAYÚSCULAS)
  jugador_id     uuid references jugadores(id) on delete set null,
  monto          numeric not null,        -- + = el cliente ganó ese monto, - = lo perdió
  nota           text,
  creado_en      timestamptz not null default now()
);

create index if not exists idx_polla_grupo_fecha on polla_historial(grupo_id, fecha);
create index if not exists idx_polla_grupo_cliente on polla_historial(grupo_id, cliente_nombre);

-- =================================================================
-- EQUIPOS_PERSONALIZADOS — overrides del diccionario de equipos por
-- grupo (equivalente a "Registrar Equipo o Apodo Nuevo" de la app
-- actual). El diccionario BASE (los 30 equipos de MLB) vive en el código
-- del backend, no en la base de datos — esta tabla solo guarda los apodos
-- extra que cada grupo vaya agregando a mano.
-- =================================================================
create table if not exists equipos_personalizados (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  apodo          text not null,
  nombre_oficial text not null,
  deporte        text not null default 'mlb',
  creado_en      timestamptz not null default now(),
  unique (grupo_id, apodo)
);

-- =================================================================
-- EQUIPOS_GLOBALES — diccionario "capa del medio": apodos compartidos
-- por TODOS los grupos, pero administrados a mano por vos (Súper-admin)
-- desde superadmin.html — no por cada grupo. Es distinto de
-- equipos_personalizados (privado de cada grupo): esta tabla NO tiene
-- grupo_id a propósito, porque es la misma fila para todos.
--
-- Orden final del diccionario de un grupo (ver diccionarioEquipos.js):
--   Base (código, fijo)
--     -> Global (esta tabla — la administras vos, vale para todos)
--       -> Personalizado del grupo (equipos_personalizados — privado,
--          tiene la última palabra si un grupo quiere pisar algo)
-- =================================================================
create table if not exists equipos_globales (
  id             uuid primary key default gen_random_uuid(),
  apodo          text not null unique,
  nombre_oficial text not null,
  deporte        text not null default 'mlb',
  creado_en      timestamptz not null default now()
);

-- =================================================================
-- RESOLUCIONES_AMBIGUAS — cuando una jugada queda AMBIGUA (VARIOS
-- DEPORTES) (ver evaluador.js: un apodo con 2+ candidatos que ni el
-- marcador por-jugada, ni el calendario, ni el número, ni el marcador de
-- sección pudieron desempatar) y alguien la resuelve a mano desde la
-- pestaña "Alertas", la elección queda acá — así la PRÓXIMA vez que se
-- reprocese esa misma sábana (misma fecha, mismo grupo, mismo texto de
-- jugada ya normalizado), evaluarJugada() la usa directo sin volver a
-- preguntar. Ver src/services/alertas.js.
-- =================================================================
create table if not exists resoluciones_ambiguas (
  id              uuid primary key default gen_random_uuid(),
  grupo_id        uuid not null references grupos(id) on delete cascade,
  fecha           date not null,
  pata_texto      text not null,   -- jugada YA normalizada (mismo texto que evalúa evaluarJugada)
  deporte_elegido text not null,
  creado_en       timestamptz not null default now(),
  unique (grupo_id, fecha, pata_texto)
);

create index if not exists idx_resoluciones_ambiguas_grupo_fecha on resoluciones_ambiguas(grupo_id, fecha);

-- =================================================================
-- ALERTAS — registro de cada jugada que quedó AMBIGUA (VARIOS DEPORTES)
-- sin que el sistema pudiera resolverla solo. Se generan desde
-- procesarSabana.js y se ven tanto en la pestaña "Alertas" del Grupo
-- (solo las suyas) como en la del Súper-admin (de todos los grupos) — con
-- un selector para resolverlas a mano (ver resoluciones_ambiguas arriba).
-- Sirve además como constancia de que el sistema SÍ avisó del problema
-- (leida_grupo/leida_superadmin, aparte de resuelta) — ver el pedido
-- original del 28-08-2026.
-- =================================================================
create table if not exists alertas (
  id                uuid primary key default gen_random_uuid(),
  grupo_id          uuid not null references grupos(id) on delete cascade,
  fecha             date not null,
  tipo              text not null default 'AMBIGUA_DEPORTE',
  cliente_nombre    text,
  ticket_label      text,
  pata              text not null,   -- jugada YA normalizada (mismo texto que resoluciones_ambiguas.pata_texto)
  mensaje           text not null,
  candidatos        jsonb not null default '[]',  -- [{ nombre, deporte }, ...] — para armar el selector
  resuelta          boolean not null default false,
  deporte_resuelto  text,
  leida_superadmin  boolean not null default false,
  leida_grupo       boolean not null default false,
  creado_en         timestamptz not null default now(),
  resuelto_en       timestamptz
);

create index if not exists idx_alertas_grupo_fecha on alertas(grupo_id, fecha);
create index if not exists idx_alertas_leida_superadmin on alertas(leida_superadmin);
-- Anti-duplicados: reprocesar la MISMA sábana varias veces (normal, ver
-- historial.js) no debe crear una alerta nueva por cada reproceso mientras
-- la jugada siga sin resolver — una vez que se resuelve (resuelta = true),
-- una ambigüedad FUTURA con el mismo texto sí puede volver a alertar.
create unique index if not exists idx_alertas_unica_pendiente on alertas(grupo_id, fecha, pata) where resuelta = false;

-- =================================================================
-- MENSAJES_CHAT — chat de soporte de cada Grupo con el Súper-admin. Un
-- solo hilo por grupo_id (no hay chats entre grupos, ni varios hilos por
-- grupo) — ver src/services/chat.js.
-- =================================================================
create table if not exists mensajes_chat (
  id                uuid primary key default gen_random_uuid(),
  grupo_id          uuid not null references grupos(id) on delete cascade,
  remitente         text not null check (remitente in ('grupo','superadmin')),
  texto             text not null,
  leido_superadmin  boolean not null default false,  -- solo aplica a mensajes con remitente='grupo'
  leido_grupo       boolean not null default false,  -- solo aplica a mensajes con remitente='superadmin'
  creado_en         timestamptz not null default now()
);

create index if not exists idx_mensajes_chat_grupo on mensajes_chat(grupo_id, creado_en);

-- =================================================================
-- DIAS_CONFIRMADOS — botón "💾 Guardar Día" (31-08-2026, a pedido del
-- usuario): como una misma fecha se puede reprocesar varias veces en el
-- día (a medida que van cerrando más juegos), tickets_historial por sí
-- solo no distingue "esto es un reproceso a medio camino" de "esto es la
-- sábana FINAL del día, con los saldos definitivos". Esta tabla es
-- justamente esa marca: 1 fila por grupo+fecha significa "el usuario ya
-- revisó esta fecha y la confirmó como la versión oficial". Se borra (no
-- se marca falsa) cada vez que se vuelve a procesar esa fecha —
-- reprocesar SIEMPRE deja el día "sin confirmar" de nuevo, hasta que el
-- usuario presione "Guardar Día" otra vez sobre la versión nueva — así
-- nunca queda una fecha marcada como confirmada con datos que en
-- realidad ya cambiaron por debajo. Ver src/services/historial.js
-- (confirmarDia/desconfirmarDia/estadoDia) y src/routes/sabana.js.
-- =================================================================
create table if not exists dias_confirmados (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  fecha          date not null,
  confirmado_en  timestamptz not null default now(),
  unique (grupo_id, fecha)
);

create index if not exists idx_dias_confirmados_grupo_fecha on dias_confirmados(grupo_id, fecha);

-- =================================================================
-- GRUPO_TELEFONOS — números de WhatsApp del grupo (02-09-2026, a pedido
-- del usuario: "crea un boton en super admin, que al seleccionar
-- determinado grupo pueda agregarle dos o tres numeros de telefonos con
-- su apodo"). Solo se agregan/editan/borran desde Súper-admin — el mismo
-- patrón que logo_url en "grupos" (el propio Grupo no tiene botón para
-- tocarlos). Se usan para el link "Tengo diferencia" del Cliente: se abre
-- WhatsApp hacia el PRIMER número cargado (orden = creado_en), a pedido
-- del usuario ("Siempre el primero cargado"). Ver src/services/
-- telefonos.js y src/routes/superadmin.js.
-- =================================================================
create table if not exists grupo_telefonos (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null references grupos(id) on delete cascade,
  telefono     text not null,   -- con código de país, ej. "584121234567" (formato listo para wa.me)
  apodo        text not null,   -- ej. "Carlos - Soporte"
  creado_en    timestamptz not null default now()
);

create index if not exists idx_grupo_telefonos_grupo on grupo_telefonos(grupo_id, creado_en);

-- =================================================================
-- CONFIRMACIONES_CLIENTE — botones "Estamos cuadrados" / "Tengo
-- diferencia" (02-09-2026, a pedido del usuario) en el link público del
-- Cliente. A pedido explícito del usuario, esto es "un plus": NUNCA
-- bloquea ni afecta el funcionamiento normal del grupo, solo registra la
-- acción y dispara una alerta informativa. Usable UNA VEZ POR DÍA
-- CALENDARIO DE VENEZUELA por jugador (a pedido del usuario: "el boton lo
-- pueden usar una sola vez por dia") — el "unique (jugador_id, fecha)" de
-- abajo es lo que hace cumplir esa regla a nivel de base de datos: un
-- segundo intento el mismo día simplemente falla el insert y la ruta
-- responde que ya se usó hoy. "fecha" es SIEMPRE la fecha de Venezuela
-- (America/Caracas, UTC-4 fijo, ver src/services/fechaVenezuela.js), no
-- la fecha del servidor. Ver src/services/confirmaciones.js y
-- src/routes/cliente.js.
-- =================================================================
create table if not exists confirmaciones_cliente (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null references grupos(id) on delete cascade,
  jugador_id   uuid not null references jugadores(id) on delete cascade,
  fecha        date not null,          -- fecha de Venezuela del día en que se usó el botón
  tipo         text not null check (tipo in ('CUADRADO','DIFERENCIA')),
  creado_en    timestamptz not null default now(),
  unique (jugador_id, fecha)
);

create index if not exists idx_confirmaciones_grupo_fecha on confirmaciones_cliente(grupo_id, fecha);

-- =================================================================
-- SABANA_PAPELERA — "papelera recuperable" (03-09-2026, a pedido del
-- usuario: "crea un boton para eliminar toda la sabana de dicho dia, o
-- de los dias que yo quiera seleccionar" + respuesta a la pregunta de
-- aclaración: "papelera recuperable... más seguro para un sistema
-- contable"). Antes de borrar de verdad los tickets/polla de una fecha
-- (ver src/services/papeleraSabana.js), se guarda una COPIA completa acá
-- (tickets_json/polla_json, con el mismo shape que las tablas
-- originales, id incluido) — así un borrado por error, o de mala fe por
-- parte de un empleado, se puede deshacer con "♻️ Restaurar" mientras la
-- fila siga acá. Se purgan solas (ver purgarVencidas() en el service) las
-- filas de más de 30 días, tanto restauradas como no — pasado ese
-- tiempo, el único rastro que queda es la alerta SABANA_ELIMINADA /
-- SABANA_RESTAURADA (ver tabla "alertas"), que no se borra nunca.
-- =================================================================
create table if not exists sabana_papelera (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  fecha          date not null,
  tickets_json   jsonb not null default '[]',
  polla_json     jsonb not null default '[]',
  eliminado_en   timestamptz not null default now(),
  restaurado_en  timestamptz
);

create index if not exists idx_sabana_papelera_grupo on sabana_papelera(grupo_id, eliminado_en);

-- =================================================================
-- SABANAS_PENDIENTES_WHATSAPP — bandeja de sábanas recibidas por el bot
-- de WhatsApp (03-09-2026, a pedido del usuario: "existe alguna manera
-- de que en mi chat de whatssap yo actualice la sabana y se cargue
-- automatico en el sistema?"). El bot (ver src/services/whatsappBot.js,
-- NO se instala/activa solo — es 100% opcional, ver WHATSAPP_BOT_ACTIVADO
-- en .env.example) escucha el grupo de WhatsApp configurado en
-- grupos.whatsapp_grupo_jid; cuando alguien escribe un mensaje que
-- empieza con "SABANA" (ver whatsappTrigger.js), el texto completo se
-- guarda ACÁ tal cual llegó — todavía NO se procesa ni se mete en
-- tickets_historial/polla_historial. El Grupo (el dueño del negocio,
-- desde la pestaña Sábana) revisa la bandeja, confirma/corrige la fecha
-- si hace falta, y le da "📥 Importar" — eso es lo que realmente corre
-- procesarSabana() (el mismo camino que copiar/pegar a mano). Así un
-- mensaje con un error de tipeo, o que no era una sábana real, nunca
-- entra solo al sistema sin que un humano lo revise primero.
-- =================================================================
create table if not exists sabanas_pendientes_whatsapp (
  id                 uuid primary key default gen_random_uuid(),
  grupo_id           uuid not null references grupos(id) on delete cascade,
  fecha_detectada    date,              -- fecha que whatsappTrigger.js pudo leer del mensaje, si la escribieron
  texto              text not null,     -- el mensaje tal cual llegó por WhatsApp, sin tocar
  remitente           text,             -- número de WhatsApp de quien escribió (formato "5804121234567@s.whatsapp.net")
  remitente_nombre    text,             -- nombre/alias que muestra WhatsApp para ese número, si está disponible
  recibido_en        timestamptz not null default now(),
  estado             text not null default 'pendiente' check (estado in ('pendiente','importada','descartada')),
  procesado_en       timestamptz
);

create index if not exists idx_sabanas_pendientes_whatsapp_grupo on sabanas_pendientes_whatsapp(grupo_id, estado, recibido_en);

-- "nota" (03-09-2026, más tarde todavía): por qué un mensaje quedó
-- 'descartada' (ej. "el día ya se había cerrado con SABANA FINAL") o
-- 'error' (el mensaje del error de procesarSabana) — visible en el panel
-- para que el Grupo entienda qué pasó sin tener que mirar el log del
-- servidor. 'error' también se suma al check de "estado" ya existente.
alter table sabanas_pendientes_whatsapp add column if not exists nota text;
alter table sabanas_pendientes_whatsapp drop constraint if exists sabanas_pendientes_whatsapp_estado_check;
alter table sabanas_pendientes_whatsapp add constraint sabanas_pendientes_whatsapp_estado_check
  check (estado in ('pendiente','importada','descartada','error'));

-- =================================================================
-- WHATSAPP_DIA_ESTADO — un renglón por cada día (grupo_id + fecha) que
-- el bot de WhatsApp ya empezó a seguir (03-09-2026, más tarde todavía,
-- a pedido del usuario: "que la nueva sabana que se envie sustituya la
-- vieja... el programa envie la sabana a medida de que se vaya teniendo
-- resultados... al enviar sabana final... enviar la sabana y despues
-- otro mensaje con todos los totales del dia"). Es el estado que usa el
-- "reloj" de cada día para decidir CUÁNDO volver a revisar resultados y
-- mandar un aviso al grupo, y si ese día ya está CERRADO (no acepta más
-- actualizaciones) — ver src/services/whatsappResumenDia.js.
--   ultimo_texto/ultimo_texto_en: el texto de la ÚLTIMA sábana recibida
--     por WhatsApp para ese día (la que se re-procesa cada hora contra
--     los resultados en vivo — reprocesar con el MISMO texto es
--     exactamente cómo ya se actualizan los resultados en este sistema,
--     ver procesarSabana.js).
--   sabana_final_en: cuándo llegó "SABANA FINAL" para este día (null =
--     todavía no, se pueden seguir mandando actualizaciones).
--   ultima_verificacion_en: la última vez que el bot reprocesó este día
--     contra resultados en vivo (haya cambiado algo o no) — el "reloj"
--     de 1 hora se cuenta desde acá.
--   ultimo_envio_resumen_en/ultimo_hash_resumen: cuándo se mandó al
--     grupo el último listado de la sábana, y una huella del estado de
--     los tickets en ese momento — para saber si "cambió algo" antes de
--     mandar otro (no se manda un mensaje nuevo si nada cambió en la
--     última hora).
--   cierre_enviado_en: cuándo se mandó el CIERRE (listado final + total
--     del día) — una vez puesto, este día deja de revisarse (ya terminó).
-- =================================================================
create table if not exists whatsapp_dia_estado (
  grupo_id                uuid not null references grupos(id) on delete cascade,
  fecha                   date not null,
  ultimo_texto            text,
  ultimo_texto_en         timestamptz,
  sabana_final_en         timestamptz,
  ultima_verificacion_en  timestamptz,
  ultimo_envio_resumen_en timestamptz,
  ultimo_hash_resumen     text,
  cierre_enviado_en       timestamptz,
  primary key (grupo_id, fecha)
);

create index if not exists idx_whatsapp_dia_estado_abiertos on whatsapp_dia_estado(fecha) where cierre_enviado_en is null;

-- =================================================================
-- MENSAJES DE CONTACTO (15-09-2026): la pantalla de bienvenida pública
-- (public/index.html, portal nuevo) tiene un botón "Contacto" con un
-- formulario que cualquiera puede mandar SIN login (ruta pública POST
-- /api/contacto, ver src/routes/contacto.js) — esta tabla es la bandeja
-- que después lee Súper-admin (GET /api/superadmin/mensajes-contacto).
-- No tiene grupo_id: no es de ningún Grupo todavía, es gente interesada
-- en CONTRATAR el servicio.
-- =================================================================
create table if not exists mensajes_contacto (
  id         serial primary key,
  nombre     text,
  contacto   text not null,
  mensaje    text not null,
  leido      boolean not null default false,
  creado_en  timestamptz not null default now()
);

create index if not exists idx_mensajes_contacto_no_leidos on mensajes_contacto(creado_en) where leido = false;

-- =================================================================
-- PAGOS DEL GRUPO A LUDOX (15-09-2026, a pedido del usuario: "cada
-- grupo debe pagar el servicio, el pago es semanal" — esto NO es la
-- plata que un cliente le debe a un Grupo (eso sigue siendo toda la
-- lógica de tickets/Balance General de siempre), es la SUSCRIPCIÓN:
-- cada Grupo (cliente de esta plataforma, el que entra por
-- grupo.html) le paga semanalmente a Ludox (el dueño de la
-- plataforma) por usar el servicio. Un Grupo reporta acá un pago
-- (fecha, método, referencia opcional y una captura como prueba) y
-- Súper-admin lo revisa marcándolo confirmado/rechazado (ver GET/POST
-- .../pagos en src/routes/superadmin.js) — confirmar/rechazar NO
-- toca ningún saldo/ticket/Balance General, es un flujo de revisión
-- aparte, en espejo de mensajes_contacto de arriba pero del lado del
-- Grupo ya logueado (ver src/routes/pagos.js).
--   captura_base64/captura_mime: la captura del pago guardada como
--     base64 en la propia fila — esta app no tiene ninguna
--     integración de storage de archivos (S3, Supabase Storage, etc.)
--     así que esto es consistente con el resto del proyecto, no un
--     atajo nuevo. Con tope de 4MB decodificados validado en la ruta
--     (routes/pagos.js) — acá en la tabla "text" no tiene límite duro,
--     pero nadie tiene que mandar una foto de cámara sin comprimir.
--   estado: pendiente (recién reportado) / confirmado / rechazado —
--     lo decide Súper-admin.
--   nota_admin: motivo cuando se rechaza (o cualquier aclaración al
--     confirmar) — opcional, Súper-admin puede rechazar sin nota y
--     avisar el motivo después por WhatsApp/chat.
--   revisado_en: cuándo Súper-admin confirmó o rechazó (null mientras
--     sigue pendiente).
-- =================================================================
create table if not exists pagos_grupo (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  fecha_pago     date not null,
  metodo         text not null check (metodo in ('pago_movil', 'binance', 'zelle', 'banesco_panama')),
  referencia     text,
  captura_base64 text not null,
  captura_mime   text not null default 'image/png',
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'confirmado', 'rechazado')),
  nota_admin     text,
  creado_en      timestamptz not null default now(),
  revisado_en    timestamptz
);

create index if not exists idx_pagos_grupo_grupo on pagos_grupo(grupo_id, creado_en desc);
create index if not exists idx_pagos_grupo_pendientes on pagos_grupo(creado_en) where estado = 'pendiente';

-- =================================================================
-- MONEDA DEL GRUPO (18-09-2026, a pedido del usuario: "permiteme elegir
-- si el grupo trabaja en dolares, bolivares o mixto, si elijo mixto al
-- momento de crear los clientes se le elige la moneda y el grupo
-- tendria entonces dos reportes, bolivares y dolares").
--
-- OJO: esto es un concepto TOTALMENTE APARTE del "modelo de comisión"
-- que en otras partes de este archivo/código también se llama alguna
-- vez "grupo mixto" (grupos.modelo_comision = 'por_tipo_jugada', ver
-- más arriba) — ese es sobre CUÁNTO % cobra cada cliente, este es sobre
-- en QUÉ MONEDA se registra cada cliente. Que las dos cosas se llamen
-- "mixto" es una coincidencia de palabras, no están relacionadas.
--
-- 'usd' o 'bs' = el grupo entero trabaja en una sola moneda fija (el
-- comportamiento de siempre, "usd" por default para no romper ningún
-- grupo ya cargado). 'mixto' = el Grupo elige, cliente por cliente, en
-- cuál de las dos monedas trabaja cada uno (columna jugadores.moneda de
-- abajo) — Sábana, Balance General y % Devueltos entonces se muestran
-- separados en dos bloques (uno por moneda) en vez de un solo total,
-- para no sumar dólares con bolívares en el mismo número. Lo elige el
-- propio Grupo (administrador, ver routes/grupo.js) — no es un
-- interruptor de Súper-admin como el modelo de comisión.
alter table grupos add column if not exists moneda_modo text not null default 'usd' check (moneda_modo in ('usd', 'bs', 'mixto'));

-- Moneda de ESTE cliente puntual. Solo se puede elegir/cambiar de
-- verdad cuando el grupo está en modo 'mixto' (routes/jugadores.js lo
-- valida); si el grupo está fijo en 'usd' o 'bs', esta columna se deja
-- siempre igual a ese valor fijo automáticamente, para que el resto del
-- código (procesarSabana.js, sabanaDia.js, reportes.js) pueda leer
-- SIEMPRE jugadores.moneda sin tener que mirar antes el modo del grupo.
alter table jugadores add column if not exists moneda text not null default 'USD' check (moneda in ('USD', 'BS'));

-- =================================================================
-- "AVALADO POR" + destino del "% devuelto" (23-09-2026, a pedido del
-- usuario: "quiero... quien lo avala, su pozo, si se le devuelve
-- porcentaje, si el porcentaje que se le devuelve no es para el si no
-- para su aval, cuanto se le da de %" — pantalla Clientes de Hipismo).
--
-- avalado_por_id: a qué OTRO jugador del mismo grupo responde este
-- cliente — un simple puntero informativo. A PROPÓSITO no es la tabla
-- "avales" que ya existe arriba (avalador_id/avalado_id/porcentaje): esa
-- tabla es un concepto DISTINTO y ya en uso por Deportes (el avalador
-- gana un % EXTRA propio sobre lo que arriesga su avalado, aparte de su
-- propia comisión — ver services/comisiones.js). Mezclar los 2 conceptos
-- en la misma fila haría que marcar "quién avala a Pedro" desde Hipismo
-- disparara sin querer esa lógica de comisión extra de Deportes, que no
-- tiene nada que ver con esto.
--
-- porcentaje_devuelto_destino: a quién se le suma el ítem "{nombre} -
-- PORCENTAJE" que ya arma agregarPorcentajeDevuelto() en routes/hipismo.js
-- (el % de jugadores.comision_propia sobre lo que este cliente apuesta,
-- carrera a carrera) — 'cliente' (default, sin cambios de comportamiento
-- para nadie que no toque esto) o 'aval' (se le suma, en cambio, a la
-- cuenta de avalado_por_id — el jugador arriesga y pierde/gana normal
-- en SU balance, pero el "premio" del % lo cobra su aval).
alter table jugadores add column if not exists avalado_por_id uuid references jugadores(id) on delete set null;
alter table jugadores add column if not exists porcentaje_devuelto_destino text not null default 'cliente' check (porcentaje_devuelto_destino in ('cliente','aval'));

-- =================================================================
-- "% DEVUELTO ADICIONAL PARA EL AVAL" (24-09-2026, a pedido del usuario:
-- "hay clientes que generan % para el mismo y aparte le generan % a su
-- avalador....." — respuesta confirmada por AskUserQuestion: "Dos %
-- independientes y simultáneos"). Hasta esta ronda, comision_propia +
-- porcentaje_devuelto_destino solo permitían UN destino a la vez, o
-- para el cliente o para su aval (nunca los dos). Este cliente puede
-- necesitar los DOS al mismo tiempo, con % distintos: uno para él mismo
-- (o para su aval, si así lo dejaste arriba con destino='aval' — eso NO
-- cambia) Y, APARTE, otro % que se le suma a su aval — DOS ítems
-- "{destino} - PORCENTAJE" distintos por el mismo ticket, no uno solo.
--
-- porcentaje_devuelto_aval: % adicional, 100% INDEPENDIENTE de
-- comision_propia/porcentaje_devuelto_destino de arriba (nunca los
-- reemplaza ni los toca — todo cliente ya configurado sigue funcionando
-- exactamente igual, default 0 = "sin cambios para nadie que no toque
-- esto"). Solo tiene efecto si además avalado_por_id está configurado —
-- ver obtenerComisionesPropias() en routes/hipismo.js, que ahora puede
-- devolver hasta 2 entradas por cliente (la de comision_propia y esta)
-- en vez de una sola.
--
-- A PROPÓSITO sigue sin tocar la tabla "avales" (avalador_id/avalado_id/
-- porcentaje) de arriba, por la misma razón ya explicada en la nota de
-- avalado_por_id: esa tabla alimenta la comisión propia de DEPORTES
-- (services/comisiones.js) y no tiene nada que ver con el "% devuelto"
-- de Hipismo — reusarla acá dispararía sin querer esa lógica de
-- Deportes para cualquier grupo que solo quiera esto en Hipismo.
alter table jugadores add column if not exists porcentaje_devuelto_aval numeric not null default 0;

-- =================================================================
-- VARIOS AVALADORES CON % CADA UNO (28-09-2026, a pedido del usuario: "en
-- cliente la parte donde coloco el % que le genera a otro cliente dejame
-- elegir varios ya que un cliente le puede generar % a varios... a
-- medida que seleccione uno me aparece otra lista despegable y asi
-- sucesivamente"). Reemplaza el modelo de arriba (avalado_por_id +
-- porcentaje_devuelto_aval, UN solo aval con UN solo %) por una tabla de
-- muchas filas: un cliente puede generarle % a VARIOS avaladores
-- distintos a la vez (ej. "2% repartido entre 2 personas").
--
-- De paso, el usuario pidió simplificar "% que se le devuelve"
-- (comision_propia): a partir de ahora SIEMPRE es para el propio cliente
-- (ya no existe la opción de mandarlo al aval) — porcentaje_devuelto_
-- destino queda SIN USO desde el código (se deja la columna tal cual,
-- sin romper ni borrar nada, por si hace falta consultar cómo estaba
-- configurado un cliente viejo).
--
-- avalado_por_id/porcentaje_devuelto_aval (arriba) también quedan SIN USO
-- desde el código a partir de esta ronda — se migran una sola vez a la
-- tabla nueva (ver el INSERT de abajo) y se dejan las columnas viejas
-- tal cual, sin dropearlas, mismo criterio.
--
-- A PROPÓSITO sigue sin tocar la tabla "avales" (avalador_id/avalado_id/
-- porcentaje) de mucho más arriba — esa es la de Deportes, concepto
-- distinto, ver la nota grande de avalado_por_id un poco más arriba.
create table if not exists jugadores_avales_porcentaje (
  id          uuid primary key default gen_random_uuid(),
  grupo_id    uuid not null references grupos(id) on delete cascade,
  jugador_id  uuid not null references jugadores(id) on delete cascade,   -- quien GENERA el %
  avalador_id uuid not null references jugadores(id) on delete cascade,   -- quien lo RECIBE (el avalador)
  porcentaje  numeric not null check (porcentaje > 0),
  creado_en   timestamptz not null default now(),
  unique (jugador_id, avalador_id),
  check (jugador_id <> avalador_id)
);
create index if not exists idx_jugadores_avales_pct_jugador on jugadores_avales_porcentaje(jugador_id);
create index if not exists idx_jugadores_avales_pct_grupo on jugadores_avales_porcentaje(grupo_id);

-- Migración única de los datos que ya existían en el modelo viejo (1 aval,
-- 1 %) hacia la tabla nueva — segura de re-correr, "on conflict do
-- nothing" evita duplicar si esta migración ya se corrió antes.
insert into jugadores_avales_porcentaje (grupo_id, jugador_id, avalador_id, porcentaje)
select grupo_id, id, avalado_por_id, porcentaje_devuelto_aval
  from jugadores
 where avalado_por_id is not null and porcentaje_devuelto_aval > 0
on conflict (jugador_id, avalador_id) do nothing;

-- =================================================================
-- CUENTAS POR EMPLEADO DENTRO DE UN GRUPO (18-09-2026, a pedido del
-- usuario: "soluciona la cuentas separas por empleado dentro de un
-- grupo... un administrador que tiene acceso 100% y los empleados
-- puedes elegir que pueden o no hacer, ya que quizas hay empleados de
-- mas confianza con acceso a mas cosas que otro").
--
-- El "Administrador" sigue siendo la fila de "grupos" de siempre (el
-- dueño, con la clave que ya usaba) — no tiene fila en esta tabla y
-- SIEMPRE tiene acceso al 100% de las funciones, sin excepción (incluye
-- crear/editar/borrar empleados y ver Pagos a Ludox; eso NUNCA se le
-- puede dar a un empleado, para que un empleado no se pueda dar a sí
-- mismo más permisos). Cada fila de "empleados" es una cuenta de acceso
-- LIMITADO al panel de ESE grupo, con su propio email+clave para entrar
-- por el mismo login de siempre (ver routes/auth.js) — "permisos" es la
-- lista de secciones del panel a las que puede entrar (ver
-- PERMISOS_VALIDOS en middleware/auth.js); un empleado sin una sección
-- en su lista recibe 403 al intentar tocar esas rutas, y el panel
-- (grupo.html) le oculta ese botón del menú directamente.
create table if not exists empleados (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  nombre         text not null,
  email          text not null unique,
  password_hash  text not null,
  activo         boolean not null default true,
  permisos       jsonb not null default '[]',
  creado_en      timestamptz not null default now(),
  ultimo_login_en         timestamptz,
  ultimo_login_ip         text,
  ultimo_login_user_agent text
);

create index if not exists idx_empleados_grupo on empleados(grupo_id);

-- =================================================================
-- Row Level Security — ver nota grande al inicio del archivo.
-- =================================================================
alter table grupos enable row level security;
alter table jugadores enable row level security;
alter table avales enable row level security;
alter table tickets_historial enable row level security;
alter table polla_historial enable row level security;
alter table transferencias enable row level security;
alter table equipos_personalizados enable row level security;
alter table equipos_globales enable row level security;
alter table resoluciones_ambiguas enable row level security;
alter table alertas enable row level security;
alter table mensajes_chat enable row level security;
alter table dias_confirmados enable row level security;
alter table grupo_telefonos enable row level security;
alter table confirmaciones_cliente enable row level security;
alter table sabana_papelera enable row level security;
alter table sabanas_pendientes_whatsapp enable row level security;
alter table whatsapp_dia_estado enable row level security;
alter table mensajes_contacto enable row level security;
alter table pagos_grupo enable row level security;
alter table empleados enable row level security;
alter table hipismo_planos_papelera enable row level security;
alter table hipismo_alertas enable row level security;
alter table pozo_ajustes enable row level security;
-- Sin políticas = acceso denegado por defecto para las claves anon/
-- authenticated. Solo la clave service_role (la que usa el backend)
-- puede leer/escribir. Ver nota al inicio del archivo.
-- =================================================================
-- SOCIOS (26-09-2026, a pedido del usuario): "Saldos de Socios y sus
-- Avalados" — pestaña nueva DENTRO de "📅 Saldos Semana" (Administración
-- > Descargar) que agrupa el saldo semanal de varios clientes bajo el
-- nombre de un Socio (ej. el saldo de varios códigos juntos bajo
-- "AVILA"). Un cliente pertenece A LO SUMO a un socio (jugadores.
-- socio_id) — el que no está en ningún socio simplemente NO aparece en
-- este reporte agrupado (sigue viéndose normal en la vista por
-- cliente de siempre). Ver services/saldosSemana.js y routes/socios.js.
create table if not exists socios (
  id        uuid primary key default gen_random_uuid(),
  grupo_id  uuid not null references grupos(id) on delete cascade,
  nombre    text not null,
  creado_en timestamptz not null default now(),
  unique (grupo_id, nombre)
);

create index if not exists idx_socios_grupo on socios(grupo_id);

alter table jugadores add column if not exists socio_id uuid references socios(id) on delete set null;
create index if not exists idx_jugadores_socio on jugadores(socio_id);

alter table socios enable row level security;

-- =================================================================
-- CUENTA DE COMISIÓN "PORCENTAJE" COMO CLIENTE REAL (26-09-2026, a
-- pedido del usuario, que mandó una captura de "Balance General" con
-- ítems anidados "Mujica - porcentaje"/"North - porcentaje"/"Agg ferro
-- - porcentaje": "quiero que me lo coloques como si fuera un codigo
-- mas... un cliente mas... cambiarle el nombre... hacerle traspaso...
-- quitarle... todo como si fuera otro cliente, solo que se alimenta de
-- los porcentajes"). Hasta ahora ese ítem era 100% virtual: el nombre
-- se armaba de nuevo en cada reporte concatenando texto
-- (`${destino} - PORCENTAJE`, ver obtenerComisionesPropias en
-- routes/hipismo.js), sin ningún jugador propio detrás.
--
-- jugadores.cuenta_comision_id: en un jugador NORMAL (ej. "North"),
-- apunta al jugador REAL que le cobra su "% devuelto" — se crea solo
-- la PRIMERA VEZ que ese % genera comisión de verdad (al confirmar un
-- Plano o un Remate, ver asegurarCuentaComision() en routes/hipismo.js)
-- y desde ahí en adelante TODOS los reportes (Balance General/Cierre
-- Final, Comisiones Devueltas, Comisiones por Hipódromo, Saldo
-- Comisiones, y las vistas previas de Plano/Remate) resuelven el
-- nombre a mostrar leyendo el NOMBRE ACTUAL de esa cuenta — así que
-- renombrarla desde Administración > Clientes (mismo PUT de siempre)
-- se queda pegado en todos lados para siempre. Eliminarla usa el
-- DELETE de jugadores de siempre; el ON DELETE SET NULL de acá abajo
-- deslinka al jugador de origen automáticamente, así que la próxima
-- vez que ese % genere comisión se crea una cuenta nueva.
--
-- jugadores.es_cuenta_comision: marca esta fila COMO la cuenta de
-- comisión de otro jugador (en vez de un cliente que apuesta) — se usa
-- para excluirla de los selectores de "quién apostó" en Cargar Planos/
-- Remates (no tendría sentido registrarle una jugada propia), aunque sí
-- aparece normal en Administración > Clientes para poder renombrarla/
-- eliminarla, y en Balance General como un cliente más (ya no anidada).
--
-- Empieza a funcionar así desde HOY para adelante — a pedido explícito
-- del usuario (AskUserQuestion: "Desde hoy en adelante") las semanas ya
-- cerradas (anterior, hace 2) se siguen viendo exactamente igual que
-- antes, sin tocar ni traducir ningún dato viejo.
alter table jugadores add column if not exists cuenta_comision_id uuid references jugadores(id) on delete set null;
alter table jugadores add column if not exists es_cuenta_comision boolean not null default false;
create index if not exists idx_jugadores_cuenta_comision on jugadores(cuenta_comision_id) where cuenta_comision_id is not null;

-- "TRASPASO DE COMISIÓN" (26-09-2026): el traspaso de jugadas de
-- siempre mueve una fila puntual (UPDATE cliente_nombre WHERE id = X),
-- pero una cuenta de comisión no tiene "jugadas" propias — su saldo se
-- calcula en vivo sumando el % de lo que apostó el jugador de origen.
-- Este traspaso es un AJUSTE aparte (puede ser negativo o positivo),
-- que cada reporte suma encima de ese cálculo en vivo de siempre (ver
-- acumularAjustesComision() en routes/hipismo.js) — nunca reemplaza ni
-- recalcula el % en sí. Empieza vacía: no afecta ninguna semana ya
-- cerrada, solo aplica desde el primer traspaso que se haga.
create table if not exists hipismo_comisiones_ajustes (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  cliente_nombre text not null,
  monto          numeric(12,2) not null,
  fecha          date not null,
  nota           text,
  creado_en      timestamptz not null default now()
);
create index if not exists idx_hipismo_comisiones_ajustes_grupo_cliente on hipismo_comisiones_ajustes(grupo_id, cliente_nombre);
create index if not exists idx_hipismo_comisiones_ajustes_grupo_fecha on hipismo_comisiones_ajustes(grupo_id, fecha);
alter table hipismo_comisiones_ajustes enable row level security;

-- =================================================================
-- ADJUNTOS EN EL CHAT DE SOPORTE (26-09-2026, a pedido del usuario:
-- "desde la bandeja de mensajes puede adjuntar archivos, fotos, videos e
-- incluso mandar notas de voz") — se guardan como base64 en la propia
-- fila de mensajes_chat (mismo criterio que ya usa "💳 Pagos" para la
-- captura del comprobante: este proyecto no tiene ningún servicio de
-- almacenamiento de archivos aparte, ver la nota grande de Pagos en
-- claude/despliegue-dominio-y-marca-ludox.md). adjunto_datos guarda el
-- Data URL COMPLETO tal cual lo entrega el navegador (FileReader.
-- readAsDataURL(), con el prefijo "data:image/jpeg;base64,..." incluido)
-- — así el frontend lo usa directo como src de <img>/<video>/<audio> o
-- href de descarga, sin tener que reconstruirlo. adjunto_tipo es el mime
-- type real del archivo (ej. "image/jpeg", "video/mp4", "audio/webm",
-- "application/pdf") y adjunto_nombre es el nombre de archivo original
-- (o uno generado para notas de voz, ej. "nota-de-voz.webm") — los 3
-- viajan juntos o ninguno. texto puede quedar vacío ('') cuando el
-- mensaje es SOLO un adjunto, sin bajar el "not null" de la columna
-- (una fila con adjunto y sin texto simplemente guarda texto = '').
alter table mensajes_chat add column if not exists adjunto_datos text;
alter table mensajes_chat add column if not exists adjunto_tipo text;
alter table mensajes_chat add column if not exists adjunto_nombre text;

-- "REMATE PAGA" (26-09-2026, a pedido del usuario: "colca un [campo]
-- donde coloco actualmente garantia pagando... cambiale el nombre a esa
-- celda y colocale ahora (REMATE PAGA)... aparte crea otra celda al lado
-- de remate paga y coloca remate garantiza"). Antes de esta ronda solo
-- existía "garantia" (un piso mínimo combinado con comision_porcentaje,
-- ahora "REMATE GARANTIZA"). pago_fijo es el monto EXACTO y manual que
-- paga el remate, sin ningún % de por medio — si se llena esta columna,
-- garantia/comision_porcentaje no se usan para calcular pago_ganador (ver
-- calcularRemate en services/hipismoRemateCalc.js). Un remate usa
-- pago_fijo O garantia, nunca los 2 a la vez.
alter table hipismo_remates add column if not exists pago_fijo numeric;

-- =================================================================
-- CARGAR WINNERS (26-09-2026, a pedido del usuario, confirmando el
-- formato pendiente desde la duodécima-tercera ronda: "en cargar
-- winners se selecciona el cliente... con el hipodromo y la carrera, el
-- numero del caballo... y al lado una columna que diga monto... alli se
-- coloca monto negativo o positivo en caso de que gane o pierda... al
-- pulsar cargar winners alli si se le agrega a cada cliente en su
-- ficha, es como si fuera una jugada mas, se le suma o se le resta...
-- eso mueve su balance y su pozo ya que es una jugada"). A diferencia de
-- Tercios ("Cargar Planos")/Remate/Adelantadas, acá NO hay ningún
-- cálculo del lado del servidor: el operador ya trae el resultado NETO
-- de cada cliente (monto positivo si ganó, negativo si perdió) y esta
-- pantalla solo lo guarda tal cual — una fila por cliente/caballo. Por
-- eso no hace falta ni % de comisión ni "pool" — no aplica, no hay
-- monto apostado aparte del resultado en sí.
--
-- A PROPÓSITO esta tabla NO entra en "Montos Apostados"/"Comisiones
-- Devueltas"/"Saldo Comisiones" (esas necesitan un monto APOSTADO, que
-- acá no existe) — pero SÍ entra en Cierre Final, Semana por Días, el
-- pozo del cliente (services/hipismoPozo.js) y su detalle de jugadas
-- propio (services/hipismoLineasCliente.js), exactamente como pidió el
-- usuario: "es como si fuera una jugada más".
create table if not exists hipismo_winners (
  id                uuid primary key default gen_random_uuid(),
  grupo_id          uuid not null references grupos(id) on delete cascade,
  hipodromo_id      uuid references hipismo_hipodromos(id) on delete set null,
  hipodromo_nombre  text not null,
  carrera_numero    integer not null,
  fecha             date not null,
  cliente_nombre    text not null,
  caballo           text not null, -- número de ejemplar tal cual se eligió en el formulario
  monto             numeric not null, -- resultado neto YA con signo: positivo ganó, negativo perdió
  creado_en         timestamptz not null default now()
);
create index if not exists idx_hipismo_winners_grupo_fecha on hipismo_winners(grupo_id, fecha);
create index if not exists idx_hipismo_winners_grupo_cliente on hipismo_winners(grupo_id, cliente_nombre);

-- =================================================================
-- "INCLUIR % EN SUS JUGADAS" (29-09-2026, a pedido del usuario: "los
-- clientes cuando tienen comision propia... si pierde, pierde 300 -1%,
-- le debe salir en su ficha entonces en su balance -297... en los planos
-- va a salir todo normal... recuerda que todo esto de los % son interno
-- en los balances" / "creame un boton que diga incluir porcentaje con
-- especie de on off... si esta en on el tercio queda con su % incluido
-- en sus jugadas y no necesitara un item aparte para su %, lo unico que
-- le saldra aparte en un item con su nombre y % seria los % que se gane
-- por sus avalados... y si lo coloco en off en su ficha de cliente de
-- sus jugadas le saldra la jugada normal, es decir si pierde pierde
-- completo y si gana ganaria -5% y en la ficha NOMBRE - PORCENTAJE le
-- saldra el % de todas sus jugadas mas el % que se gane por sus
-- avalados").
--
-- Este toggle es SOLO de presentación/agregación — jamás toca las filas
-- crudas de hipismo_tickets/hipismo_planos ni el texto del plano que se
-- comparte en el grupo de WhatsApp (eso siempre sale "normal", sin
-- ningún % restado/sumado, tal como pide el usuario).
--
-- - OFF (default, retrocompatible con TODO lo que ya existía antes de
--   esta columna): sin cambios. La jugada del cliente en su ficha
--   aparece cruda (si pierde, pierde completo; si gana, gana lo que la
--   modalidad calcule). Su comisión propia (jugadores.comision_propia)
--   sigue acreditándose en una cuenta aparte "{NOMBRE} - PORCENTAJE",
--   junto con lo que gane por ser avalador de otros clientes (tabla
--   jugadores_avales_porcentaje) — ambas cosas sumadas en esa misma
--   cuenta, exactamente como ya funcionaba.
-- - ON: la comisión propia de este cliente se resta/suma DIRECTO en el
--   resultado de cada una de sus propias jugadas (rol = jugador, nunca
--   banquero) al armar su ficha/balance — ya no genera ningún monto en
--   una cuenta "{NOMBRE} - PORCENTAJE" aparte para SU PROPIA comisión.
--   Lo único que sigue apareciendo en esa cuenta aparte es lo que este
--   cliente gane por ser avalador DE OTROS clientes (relación
--   completamente independiente de este toggle, sigue funcionando
--   igual). Ver services/hipismoComisionPropia.js (obtenerComisionesPropias,
--   asegurarCuentasComisionParaNombres) y services/hipismoResumenCliente.js
--   (construirResumenClienteHipismo, construirResumenCuentaComisionHipismo).
alter table jugadores add column if not exists incluir_porcentaje_en_jugadas boolean not null default false;

-- =================================================================
-- GRUPO DE CLIENTES (30-09-2026, a pedido del usuario: "en saldos crea
-- un nuevo boton llamado... Grupo de Clientes, alli se va a seleccionar
-- un cliente, y a su vez todos los item, nombres o clientes que
-- pertenecen a su grupo... arriba muestra el nombre de quien pertenece
-- ese grupo de clientes, y abajo ordenado el nombre de las personas que
-- seleccione y al lado su saldo total semana, estos saldos lo jalas de
-- balance general, no duplican nada solo es para llevar un control
-- extra con nuevos filtros... esos grupos tambien llevan link que al
-- abrirlo se vea ese cuadro... al crear un grupo ya queda predeterminado
-- para todas las semanas, se pueden eliminar o agregar nuevos miembros").
--
-- DISTINTO de "socios" (arriba): un Socio es una relación 1-a-1 (un
-- cliente pertenece A LO SUMO a un socio, jugadores.socio_id), sin link
-- público propio. Un "Grupo de Clientes" es N-a-N (un mismo cliente
-- puede aparecer en varios grupos distintos, y un grupo tiene cualquier
-- cantidad de miembros elegidos a mano), CON su propio link público
-- (mismo patrón que jugadores.token, pero un UUID propio de este grupo),
-- y NUNCA calcula nada nuevo — solo arma una vista filtrada/reordenada
-- de saldos que YA calcula Balance General (services/balanceGeneral.js
-- en Deportes, construirCierreFinalHipismo en
-- services/hipismoResumenCliente.js en Hipismo).
--
-- "titular_id" es el cliente elegido como dueño/título del grupo (el
-- nombre que se muestra arriba, ej. "TYKHE" en el ejemplo que mandó el
-- usuario) — confirmado con el usuario que el titular SIEMPRE aparece
-- también como un renglón más de la tabla de abajo, con su propio saldo
-- (igual que en su captura, donde "TYKHE" es el título Y también una
-- fila de la tabla) — services/gruposClientes.js arma esa unión
-- (titular + tabla grupos_clientes_miembros) cada vez que se pide la
-- tarjeta, nunca hace falta insertar al titular dos veces.
--
-- "modulo" (30-09-2026, confirmado con el usuario: "crealo en el modulo
-- de hipismo... aparte tambien crealo en el modulo de deportes pero son
-- cuadros independientes por modulo"): un grupo vive en UN SOLO módulo
-- — un grupo de Deportes y uno de Hipismo son filas completamente
-- aparte, aunque compartan el mismo jugador como titular o miembro (la
-- fila de jugadores es la misma para los 2 módulos, ver la nota grande
-- en la definición de "jugadores" más arriba) — nunca se suman entre sí.
create table if not exists grupos_clientes (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null references grupos(id) on delete cascade,
  modulo     text not null check (modulo in ('deportes', 'hipismo')),
  titular_id uuid not null references jugadores(id) on delete cascade,
  -- Link público (30-09-2026, "esos grupos tambien llevan link que al
  -- abrirlo se vea ese cuadro"): mismo patrón que jugadores.token, pero
  -- un UUID propio de ESTE grupo — ver GET /api/grupos-clientes/:token
  -- (routes/gruposClientesPublico.js), la ÚNICA ruta pública, sirve para
  -- los 2 módulos (resuelve solo con la propia fila de "modulo").
  token      uuid not null unique default gen_random_uuid(),
  creado_en  timestamptz not null default now()
);

create index if not exists idx_grupos_clientes_grupo on grupos_clientes(grupo_id, modulo);
create index if not exists idx_grupos_clientes_titular on grupos_clientes(titular_id);

-- Miembros del grupo, aparte del titular (30-09-2026, "se pueden
-- eliminar o agregar nuevos miembros" — a diferencia de socios.PUT
-- /:id/clientes, que reemplaza TODA la membresía de un socio de una vez,
-- acá se agrega/quita un miembro a la vez, ver POST/DELETE
-- /api/.../grupos-clientes/:id/miembros en services/gruposClientes.js).
create table if not exists grupos_clientes_miembros (
  grupo_cliente_id uuid not null references grupos_clientes(id) on delete cascade,
  jugador_id       uuid not null references jugadores(id) on delete cascade,
  agregado_en      timestamptz not null default now(),
  primary key (grupo_cliente_id, jugador_id)
);

create index if not exists idx_grupos_clientes_miembros_jugador on grupos_clientes_miembros(jugador_id);

alter table grupos_clientes enable row level security;
alter table grupos_clientes_miembros enable row level security;

-- =================================================================
-- CALCULADORA PARLEY — LOGROS AUTOMÁTICOS (01-10-2026, a pedido del
-- usuario: "existe manera de cargar logros de apuestas, a la pagina?
-- para que jueguen parley" — y luego, al preguntarle: "me gustaria
-- conectarla a un proveedor que me cargue y actualice los logros
-- automatico" + "en el servidor"). Un job del servidor (ver
-- services/parleyLogros.js) consulta un proveedor externo de momios
-- (The Odds API, the-odds-api.com) cada cierto tiempo y REEMPLAZA por
-- completo el contenido de parley_juegos — no se guarda historial, cada
-- corrida borra todo e inserta de nuevo (mismo criterio que "SABANA DE
-- JUGADAS... siempre sustituye a la anterior" del bot de WhatsApp: acá
-- tampoco interesa guardar lo viejo, solo lo vigente).
--
-- A diferencia de CASI toda otra tabla de este sistema, estas dos son
-- GLOBALES (no tienen grupo_id): la Calculadora Parley es la página
-- pública de mercadeo (public/calculadora-parley.html, sin login,
-- abierta a cualquiera), no una herramienta de un Grupo en particular.
--
-- Una fila de parley_juegos = UNA selección elegible de UN juego (no una
-- fila por juego): un partido de fútbol con mercado "head to head" trae
-- 3 filas (gana local / empate / gana visitante), uno de MLB/NFL/NBA
-- trae 2 (gana local / gana visitante) — así la Calculadora Parley arma
-- cada opción ya lista para usar con la fórmula de favorito/contendor
-- que ya tenía (ver cpCalcular() en calculadora-parley.html), sin tener
-- que adivinar cuántas opciones trae cada deporte.
--
-- "evento_id" agrupa las filas de un mismo partido (viene del
-- proveedor, NO se genera acá) para que el frontend las muestre juntas
-- bajo el mismo encabezado "Equipo Local vs Equipo Visitante".
create table if not exists parley_juegos (
  id                uuid primary key default gen_random_uuid(),
  deporte           text not null,       -- agrupador genérico ('baseball','americanfootball','basketball','soccer',...) — se arma solo del "sport_key" del proveedor (texto antes del primer "_"), nunca una lista fija a propósito: agregar una liga nueva es solo cambiar ODDS_API_DEPORTES (.env), sin tocar código.
  liga              text,                -- nombre visible de la liga/competencia tal como lo manda el proveedor (ej. "MLB", "NFL", "Premier League")
  evento_id         text not null,       -- id del proveedor para ESE partido — agrupa las filas de un mismo juego
  equipo_local      text not null,
  equipo_visitante  text not null,
  hora_inicio       timestamptz,
  seleccion         text not null,       -- 'local' | 'visitante' | 'empate'
  nombre_seleccion  text not null,       -- nombre a mostrar para esta opción (nombre del equipo, o "Empate")
  logro             numeric not null,    -- momio americano de ESTA selección puntual (negativo = favorito, positivo = contendor) — mismo formato que ya usa la Calculadora Parley
  actualizado_en    timestamptz not null default now()
);

create index if not exists idx_parley_juegos_evento on parley_juegos(evento_id);
create index if not exists idx_parley_juegos_deporte on parley_juegos(deporte);
create index if not exists idx_parley_juegos_hora on parley_juegos(hora_inicio);

-- Fila única (patrón singleton, "id" fijo en true) con el estado de la
-- ÚLTIMA corrida del job — para que la propia página pueda avisar "logros
-- actualizados hace X minutos" o "no disponibles ahora mismo" sin tener
-- que adivinarlo a partir de parley_juegos (que puede estar vacía tanto
-- por "nunca corrió" como por "corrió y el proveedor no tenía juegos hoy").
create table if not exists parley_estado (
  id                 boolean primary key default true check (id),
  ultima_corrida_en  timestamptz,
  exitosa            boolean,
  mensaje            text,
  juegos_cargados    integer
);

alter table parley_juegos enable row level security;
alter table parley_estado enable row level security;

-- =================================================================
-- PARLEY_JUEGOS — RL/Alta-Baja/1er Tiempo + logos de equipo (01-10-2026,
-- a pedido del usuario: "agrega a cada equipo su logo igual que en el
-- modulo de deportes... en los logros coloca el rl la alta y la baja, si
-- tienes logros a medio juego o 5to o 1h agregalos tambien").
--
-- GENERALIZACIÓN DEL MODELO: hasta acá, una fila de parley_juegos era
-- siempre "1 selección elegible del mercado head-to-head (ganador)" —
-- ahora puede ser la selección de CUALQUIER mercado pedido (ver
-- MERCADOS_POR_GRUPO_DEPORTE en services/oddsApiProvider.js), así que se
-- agregan 2 columnas nuevas en vez de tocar las que ya existían:
--   - mercado: la clave del mercado del proveedor ('h2h' = Ganador,
--     'spreads' = RL/Línea, 'totals' = Alta/Baja, y sus 3 equivalentes
--     de 1er Tiempo/Medio Juego: 'h2h_h1', 'spreads_h1', 'totals_h1').
--     Default 'h2h' para que una fila ya guardada ANTES de este cambio
--     (de cuando esta tabla solo tenía moneyline) siga leyéndose como lo
--     que siempre fue, sin tener que reprocesarla.
--   - punto: el número de la línea/total de ESTA selección puntual (ej.
--     -1.5 para el favorito en "spreads", 8.5 para "Alta"/"Baja" en
--     "totals") — NULL en 'h2h'/'h2h_h1' (el ganador no tiene punto).
--
-- "seleccion" (columna ya existente) se sigue usando igual para
-- 'spreads'/'spreads_h1' (sigue siendo 'local'/'visitante', un EQUIPO
-- con un punto encima) — solo 'totals'/'totals_h1' usa los 2 valores
-- nuevos 'alta'/'baja' (Over/Under, sin equipo). Ver interpretarOutcome()
-- en oddsApiProvider.js.
--
-- NO se agregó el mercado "5to" (1st 5 innings de MLB) que también pidió
-- el usuario: la propia documentación oficial de The Odds API confirma
-- que ESE mercado puntual exige el endpoint "por evento" (costo en
-- créditos = partidos × mercados × regiones, muy por encima del resto de
-- mercados de acá, que viajan todos juntos en 1 solo pedido por liga) —
-- se dejó afuera a propósito para no disparar el consumo de créditos del
-- plan gratis/pagado del usuario sin avisarle antes. Ver la nota grande
-- al principio de oddsApiProvider.js.
alter table parley_juegos add column if not exists mercado text not null default 'h2h';
alter table parley_juegos add column if not exists punto numeric;

-- Logos de equipo (01-10-2026): URL directa del escudo tal como la dan
-- los proveedores GRATIS ya usados en el módulo de Deportes —
-- mlbstatic.com (MLB, vía su directorio de equipos) o a.espncdn.com
-- (NFL/NBA/fútbol, vía el scoreboard de ESPN) — ver
-- services/logosEquiposParley.js. Nullable a propósito: si el proveedor
-- de logos no tiene el equipo ese día (nombre distinto, liga sin mapear
-- a ESPN todavía, etc.), la fila se guarda igual, solo sin logo — el
-- frontend ya oculta el <img> si la URL viene vacía o si la imagen no
-- carga (mismo criterio "onerror" que ya usa el resto del sistema).
-- Mismas 2 URLs para TODAS las filas de un mismo evento_id (el logo es
-- del PARTIDO, no de la selección puntual).
alter table parley_juegos add column if not exists logo_local text;
alter table parley_juegos add column if not exists logo_visitante text;

-- =================================================================
-- PIZARRAS — pantalla para ver/editar/eliminar la llegada (pizarra) de
-- una carrera ya cargada, por día > hipódromo > carrera (01-10-2026, a
-- pedido del usuario: "crea un boton debajo de hipodromos que diga
-- pizarras / alli puedo ver, editar, eliminar... por dia por hipodromo
-- ordenado, las llegadas de las carreras").
--
-- "Eliminar" acá NO borra el plano/remate completo (eso ya lo hace
-- "Eliminar Planos" / "Eliminar Winners") — el usuario, preguntado
-- explícitamente, pidió que la carrera quede "sin pizarra (pendiente)":
-- todos sus tickets/apuestas vuelven al estado "sin decidir" (mismo
-- patrón 0/0 que ya usa decidida/gano en Montos Apostados) y queda
-- esperando que se cargue una pizarra de nuevo — ver DELETE
-- /pizarras/tercios/:id y DELETE /pizarras/remate/:id. Por eso ambas
-- columnas "pizarra" (que hasta ahora eran NOT NULL, porque un plano/
-- remate siempre nacía con su llegada ya puesta) pasan a admitir NULL.
--
-- hipismo_remates.numero_ganador también pasa a admitir NULL por la
-- misma razón: sin pizarra todavía no hay ganador. hubo_ganador se
-- deja con su default (false) — una carrera pendiente no es lo mismo
-- que "quedó para la banca" (ver services/hipismoRemateCalc.js), pero
-- el código que lee estas filas ya distingue ambos casos por
-- numero_ganador IS NULL primero (ver obtenerApuestasDelRango arriba
-- en este mismo cambio).
alter table hipismo_planos alter column pizarra drop not null;
alter table hipismo_remates alter column pizarra drop not null;
alter table hipismo_remates alter column numero_ganador drop not null;

-- =================================================================
-- "REMATE MANUAL" EN MODO NETO DIRECTO (04-10-2026, a pedido del
-- usuario: "aqui en remate manual, no quiero colcoar pizarra ni comision
-- ni anda solo sleccionar el dia el hipodromo y la carrerra, elegir
-- caballo el jugador y te voy a colocar el monto neto de cuanto se gana
-- cada uno o cuanto pierde"). Esta columna distingue un remate armado
-- con el motor de pool/comisión/garantía/pago-fijo de siempre ('pool',
-- el default — no rompe ningún remate ya guardado) de uno cargado con
-- el monto neto de cada cliente escrito directo por el operador
-- ('manual', ver POST /remates/manual en routes/hipismo.js). Se sigue
-- guardando en estas mismas 2 tablas (nunca una tabla aparte) para que
-- el ítem "REMATE" de Balance General/Cierre Final y su detalle
-- carrera-a-carrera (construirResumenRemateHipismo) sigan funcionando
-- igual sin tocarlos — un remate manual no tiene pizarra, garantía, pago
-- fijo, pool ni número ganador (todos quedan NULL/0/false), así que
-- "modo" es la única forma de saber que a este remate NO hay que
-- recalcularlo con PUT /pizarras/remate/:id (ese motor asume un pool con
-- comisión, que acá no existe) y que no debe ofrecerse como "pendiente
-- de pizarra" en la pantalla "Pizarras" (ver GET /pizarras más arriba).
alter table hipismo_remates add column if not exists modo text not null default 'pool';

-- =================================================================
-- "CARGA MASIVA ESPECIAL" (05-10-2026, a pedido del usuario: una pestaña
-- debajo de Cargar Planos donde se escriben líneas "CLIENTE +monto" /
-- "CLIENTE -monto" eligiendo un hipódromo, una ACCIÓN (Remate, Marcas,
-- Winners, Tablas Fijas...), una fecha y (opcional) un número de carrera —
-- la suma de TODAS las líneas debe dar 0 y cada nombre debe existir como
-- cliente). Cada línea es un movimiento de saldo directo (como un Winner,
-- pero sin caballo): Balance General, Cierre Final, Semana por Días y el
-- link de cada cliente la suman tal cual, etiquetada con su acción.
--   hipismo_codigos_especiales: ya no se usa (la versión inicial elegía un
--     "código"); se deja la tabla para no tocar nada ya creado.
--   hipismo_cargas_especiales: la cabecera de cada carga (fecha, carrera,
--     hipódromo; codigo_nombre guarda la ACCIÓN elegida).
--   hipismo_cargas_especiales_lineas: una fila por cliente con su monto
--     con signo (positivo = gana, negativo = pierde).
-- Empiezan vacías: no afectan ningún dato ya guardado.
-- =================================================================
create table if not exists hipismo_codigos_especiales (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null references grupos(id) on delete cascade,
  nombre     text not null,
  creado_en  timestamptz not null default now(),
  unique (grupo_id, nombre)
);
create table if not exists hipismo_cargas_especiales (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  fecha          date not null,
  carrera        text,
  codigo_nombre  text not null,
  hipodromo_nombre text,
  creado_en      timestamptz not null default now()
);
-- Para una base que ya había creado la tabla antes de esta ronda:
alter table hipismo_cargas_especiales add column if not exists hipodromo_nombre text;
create index if not exists idx_hipismo_cargas_especiales_grupo_fecha on hipismo_cargas_especiales(grupo_id, fecha);
create table if not exists hipismo_cargas_especiales_lineas (
  id              uuid primary key default gen_random_uuid(),
  carga_id        uuid not null references hipismo_cargas_especiales(id) on delete cascade,
  grupo_id        uuid not null references grupos(id) on delete cascade,
  cliente_nombre  text not null,
  monto           numeric(12,2) not null,
  orden           integer not null default 0
);
create index if not exists idx_hipismo_cargas_especiales_lineas_carga on hipismo_cargas_especiales_lineas(carga_id);
create index if not exists idx_hipismo_cargas_especiales_lineas_grupo_cliente on hipismo_cargas_especiales_lineas(grupo_id, cliente_nombre);
alter table hipismo_codigos_especiales enable row level security;
alter table hipismo_cargas_especiales enable row level security;
alter table hipismo_cargas_especiales_lineas enable row level security;

-- =================================================================
-- "FECHA DE SEMANA" ACTIVA (05-10-2026, a pedido del usuario: "activame
-- esta pantalla, no funciona"): cada grupo puede definir en qué día empieza
-- y en qué día cierra su semana de Hipismo (ej. Lunes -> Lunes cuando el
-- lunes hay carreras en EE.UU.). Ver la nota grande de
-- services/hipismoSemana.js. NULL en las columnas = la semana de siempre
-- (lunes a domingo): no afecta ningún dato ya guardado.
--   hipismo_semana_inicio / hipismo_semana_cierre: día de la semana (0 =
--     domingo ... 6 = sábado).
--   hipismo_semana_desde: fecha ancla — el primer día de la primera semana
--     con esta configuración (las semanas siguientes se encadenan desde ahí).
--   hipismo_semana_hasta: (rango personalizado del calendario) último día de
--     esa primera semana; NULL = se calcula con el día de cierre.
-- =================================================================
alter table grupos add column if not exists hipismo_semana_inicio smallint;
alter table grupos add column if not exists hipismo_semana_cierre smallint;
alter table grupos add column if not exists hipismo_semana_desde date;
alter table grupos add column if not exists hipismo_semana_hasta date;


-- ---------------------------------------------------------------
-- 06-10-2026 — BANQUEO DE MARCAS POR GRUPO. Quién banquea por defecto las
-- Marcas de Jugadas Adelantadas de cada grupo (cada grupo banquea distinto,
-- no hay nombres fijos): array jsonb de hasta 4 objetos
-- { nombre, porcentaje, pagaComision } cuyos % suman 100. NULL = sin
-- banqueo automático (la Marca queda 'falta_banqueo' y se banquea a mano).
-- Seguro de re-correr.
alter table grupos add column if not exists hipismo_marcas_banqueo jsonb;

-- ---------------------------------------------------------------
-- 06-10-2026 — BANQUEO DE TABLAS FIJAS POR GRUPO (mismo formato que
-- hipismo_marcas_banqueo): array jsonb de hasta 4 objetos
-- { nombre, porcentaje, pagaComision } cuyos % suman 100. NULL = las Tablas
-- Fijas juegan contra el ítem "TABLAS FIJAS" de siempre. Seguro de re-correr.
alter table grupos add column if not exists hipismo_tf_banqueo jsonb;

-- ---------------------------------------------------------------
-- 07-10-2026 — ALERTAS NUEVAS, CUADRE NOCTURNO Y REGISTRO DE ERRORES.
--
-- (08-10-2026) "not valid": el check vale para las filas NUEVAS pero no revisa las viejas, así que
-- una alerta antigua con un tipo ya fuera de la lista no impide correr este archivo.
-- 1) Dos tipos nuevos en hipismo_alertas:
--    APUESTA_SOBRE_POZO: un cliente con pozo apostó más de lo que le queda.
--    CUADRE_DESCUADRADO: la revisión automática de la noche encontró algo que
--    no cuadra (un cliente con grilla distinta al link, o el balance no suma 0).
alter table hipismo_alertas drop constraint if exists hipismo_alertas_tipo_check;
alter table hipismo_alertas add constraint hipismo_alertas_tipo_check
  check (tipo in ('PLANO_EDITADO','PLANO_ELIMINADO','ADELANTADA_EDITADA','ADELANTADA_ELIMINADA','JORNADA_ELIMINADA','WINNER_EDITADO','WINNER_ELIMINADO','PIZARRA_EDITADA','PIZARRA_ELIMINADA','TERCIOS_ADELANTADA_EDITADA','TERCIOS_ADELANTADA_ELIMINADA','REMATE_MANUAL_ELIMINADO','APUESTA_SOBRE_POZO','CUADRE_DESCUADRADO')) not valid;

-- 2) Bitácora de la revisión de cuadre automática: una fila por grupo y por día
--    (unique), así el servidor no repite la revisión si se reinicia, y el
--    Administrador ve "anoche: todo cuadra / tantas diferencias".
create table if not exists hipismo_cuadre_nocturno (
  id          uuid primary key default gen_random_uuid(),
  grupo_id    uuid not null references grupos(id) on delete cascade,
  fecha       date not null,           -- día (hora de Venezuela) en que corrió la revisión
  estado      text not null check (estado in ('ok','descuadre','error')),
  detalle     jsonb,                   -- { semanas: [...], discrepancias: [...], sumaBalance: [...] }
  creado_en   timestamptz not null default now(),
  unique (grupo_id, fecha)
);
create index if not exists idx_hipismo_cuadre_nocturno_grupo on hipismo_cuadre_nocturno(grupo_id, fecha desc);
alter table hipismo_cuadre_nocturno enable row level security;

-- 3) Registro de errores del servidor: todo error 500/503 queda guardado con
--    la ruta y el grupo, para enterarse sin que un usuario tenga que reportarlo.
--    Súper-admin ve todos; cada grupo ve los suyos. Se limpia solo (30 días).
create table if not exists errores_servidor (
  id          uuid primary key default gen_random_uuid(),
  grupo_id    uuid references grupos(id) on delete cascade,   -- NULL si no se sabe de qué grupo fue
  usuario     text,
  metodo      text,
  ruta        text,
  estado      integer,
  mensaje     text not null,
  detalle     text,                    -- primeras líneas del stack
  creado_en   timestamptz not null default now()
);
create index if not exists idx_errores_servidor_creado on errores_servidor(creado_en desc);
create index if not exists idx_errores_servidor_grupo on errores_servidor(grupo_id, creado_en desc);
alter table errores_servidor enable row level security;

-- =================================================================
-- SÁBANA AUTOMÁTICA POR TELEGRAM (08-10-2026, a pedido del usuario: "vamos a
-- conectar el módulo de deportes a un Telegram para que me saque las sábanas
-- automáticas y me calcule todo... Telegram sí podemos trabajar mejor que
-- WhatsApp"). Mismo espíritu que whatsapp_habilitado / whatsapp_grupo_jid:
-- TODO EXCLUSIVO del Súper-admin.
--   - telegram_habilitado: "este grupo contrató el servicio por Telegram".
--   - telegram_chat_id: el grupo de Telegram al que está vinculado (se llena
--     SOLO: el bot lo guarda cuando alguien administrador escribe en ese grupo
--     "/vincular CODIGO"; no hay que buscar ningún ID a mano).
--   - telegram_codigo_vinculo: código de un solo uso que genera el Súper-admin.
-- =================================================================
alter table grupos add column if not exists telegram_habilitado boolean not null default false;
alter table grupos add column if not exists telegram_chat_id text;
alter table grupos add column if not exists telegram_codigo_vinculo text;
create index if not exists idx_grupos_telegram_chat on grupos(telegram_chat_id) where telegram_chat_id is not null;

-- =================================================================
-- CIERRE NOCTURNO (08-10-2026): pasada la medianoche de Venezuela, el bot de Telegram cierra cada
-- grupo cuya sábana de ayer ya tiene todos los juegos resueltos (listado final, totales del día,
-- corte de la semana y foto) y, al terminar con todos, manda un mensaje final. Esta columna marca
-- "ya se cerró ese día" para que un grupo nunca reciba el cierre dos veces (ni con reinicios).
-- =================================================================
alter table whatsapp_dia_estado add column if not exists cierre_nocturno_en timestamptz;
