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
-- personalizado"): se guarda como URL a una imagen ya subida a algún lado
-- (no como archivo en el servidor) — a propósito, para no depender del
-- disco del servidor (en Railway, el hosting elegido para la Fase 2, el
-- disco no es persistente entre despliegues sin configurar un volumen
-- aparte). Solo el Súper-admin puede ponerla/cambiarla (PATCH
-- /api/superadmin/grupos/:id/logo, ver superadmin.js/superadmin.html) — el
-- propio Grupo no tiene ningún botón para tocarla. Se muestra en
-- cliente.html (la vista pública del Cliente).
alter table grupos add column if not exists logo_url text;

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
  comision_porcentaje   numeric not null default 0, -- ej. 20 = 20%
  garantia              numeric, -- el monto de "PAGANDO/GARANTIZA/PAGA $X" del texto, null si no vino
  pool_total            numeric not null default 0, -- suma de todos los montos jugados
  pizarra               text not null, -- llegada usada para saber quién ganó (de un plano ya cargado, o cargada a mano acá)
  numero_ganador        integer not null, -- número de ejemplar que ganó la carrera (1er lugar de la pizarra)
  hubo_ganador          boolean not null default false, -- false = "quedó para la banca" (nadie jugó ese número)
  caballo_ganador       text,
  cliente_ganador       text,
  pago_ganador          numeric not null default 0,
  comision_total        numeric not null default 0, -- pool_total - pago_ganador (= pool_total completo si no hubo ganador)
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
create index if not exists idx_hipismo_adelantadas_jugadas_plano on hipismo_adelantadas_jugadas(plano_id);
create index if not exists idx_hipismo_adelantadas_jugadas_grupo_cliente on hipismo_adelantadas_jugadas(grupo_id, cliente_nombre);
create index if not exists idx_hipismo_adelantadas_jugadas_pendientes on hipismo_adelantadas_jugadas(grupo_id, estado);

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
alter table hipismo_alertas drop constraint if exists hipismo_alertas_tipo_check;
alter table hipismo_alertas add constraint hipismo_alertas_tipo_check
  check (tipo in ('PLANO_EDITADO','PLANO_ELIMINADO','ADELANTADA_EDITADA','ADELANTADA_ELIMINADA','JORNADA_ELIMINADA'));

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
