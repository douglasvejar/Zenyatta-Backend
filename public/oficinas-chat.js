// =================================================================
// oficinas-chat.js (12-11-2026) — BANDEJA DE MENSAJES CON EL SÚPER-ADMIN en Hipismo Oficinas.
// Pedido del usuario: "agrégales a las oficinas la bandeja de mensajes para que se comuniquen con Súper-admin como pueden hacerlo
// los grupos". Es la MISMA bandeja flotante (💬) de Deportes y de Hipismo Grupos Hípicos: mismas rutas (/api/hipismo/chat…), misma tabla
// mensajes_chat por grupo_id, así que el Súper-admin (y Telegram) ven y responden estos mensajes igual que los de cualquier grupo.
// Sin tablas ni rutas nuevas. Consumo de Supabase: cuando la pestaña está a la vista, 1 consulta liviana (conteo de no leídos) cada 25 s
// (igual que Grupos); con el chat abierto, la lista cada 8 s; con la pestaña oculta no consulta nada. Los adjuntos solo se piden al verlos.
// Todo el HTML y el CSS se crean desde aquí: hipismo-oficinas.html solo carga este archivo.
// =================================================================
(function () {
  'use strict';
  if (window.OficinasChat) return;

  const TOPE_ADJUNTO = 8 * 1024 * 1024;   // mismo tope (~8 MB) que valida services/chat.js
  let abierto = false, pollAbierto = null, ultimoNoLeidos = 0, adjuntoPendiente = null, recorder = null, chunks = [];
  let ultimaFirma = null, ultimosMensajes = null, audioCtx = null, iniciado = false;
  const adjCache = {}, adjPidiendo = {}, adjFallo = {};

  const $ = id => document.getElementById(id);
  function esc(t) { const d = document.createElement('div'); d.textContent = t === undefined || t === null ? '' : String(t); return d.innerHTML; }
  function fechaHora(iso) {
    try { return new Date(iso).toLocaleString('es-ES', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return iso; }
  }
  // Usa el api() de la pantalla (token, sesión vencida…); si no está, un fetch simple con el token guardado.
  async function llamar(ruta, opciones) {
    if (typeof window.api === 'function') return window.api(ruta, opciones);
    const cab = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('zenyatta_token') || '') };
    const r = await fetch(ruta, Object.assign({}, opciones || {}, { headers: cab }));
    if (r.status === 204) return null;
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error((d && d.error) || ('Error ' + r.status));
    return d;
  }

  function poner() {
    const st = document.createElement('style');
    st.textContent = `
.ochat{position:fixed;right:22px;bottom:22px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:12px;font-family:inherit}
.ochat-burbuja{position:relative;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(100deg,var(--accent-grass,#3f8a85),var(--accent-lime,#5fa39b) 60%);color:#fff;font-size:26px;box-shadow:0 4px 16px rgba(30,60,58,.28);display:flex;align-items:center;justify-content:center}
.ochat-burbuja.parpadea{animation:ochatParpadeo 1s ease-in-out infinite}
@keyframes ochatParpadeo{0%,100%{transform:scale(1)}50%{transform:scale(1.14);box-shadow:0 4px 26px rgba(220,38,38,.65)}}
.ochat-badge{position:absolute;top:-4px;right:-4px;background:var(--danger,#dc2626);color:#fff;border-radius:10px;min-width:20px;height:20px;line-height:20px;font-size:11px;font-weight:700;padding:0 4px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.ochat-panel{width:340px;max-width:calc(100vw - 44px);background:var(--card,#fffdf9);border:1px solid var(--card-border,rgba(70,55,30,.12));border-radius:14px;box-shadow:0 10px 32px rgba(30,60,58,.25);overflow:hidden;display:none;flex-direction:column}
.ochat-cab{background:linear-gradient(100deg,var(--accent-grass,#3f8a85),var(--accent-lime,#5fa39b) 60%);color:#fff;padding:13px 14px;display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700}
.ochat-cab button{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:0 4px}
.ochat-msgs{max-height:340px;min-height:200px;padding:12px;background:var(--card-2,#f3efe8);overflow-y:auto;display:flex;flex-direction:column;gap:8px}
.ochat-vacio{color:var(--text-dim,#766f64);font-size:13px;text-align:center;margin:auto 0}
.ochat-bur{max-width:78%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap}
.ochat-bur.propio{align-self:flex-end;background:linear-gradient(100deg,var(--accent-grass,#3f8a85),var(--accent-lime,#5fa39b) 60%);color:#fff;border-bottom-right-radius:3px}
.ochat-bur.otro{align-self:flex-start;background:#fff;border:1px solid var(--card-border,rgba(70,55,30,.12));color:var(--text,#2c2a26);border-bottom-left-radius:3px}
.ochat-hora{display:block;font-size:10px;opacity:.75;margin-top:4px}
.ochat-env{display:flex;gap:8px;padding:10px;border-top:1px solid var(--card-border,rgba(70,55,30,.12));align-items:flex-end}
.ochat-env textarea{flex:1;height:44px;resize:none;font-family:inherit;font-size:13px;border:1px solid var(--border-light,rgba(70,55,30,.18));border-radius:8px;padding:8px 10px;background:#fff;color:var(--text,#2c2a26)}
.ochat-env .ochat-ico,.ochat-env .ochat-send{flex:none;height:44px;border-radius:8px;border:1px solid var(--border-light,rgba(70,55,30,.18));background:var(--card-2,#f3efe8);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
.ochat-env .ochat-ico{width:38px}
.ochat-env .ochat-ico.grabando{background:#e5484d;color:#fff;animation:ochatGrab 1s infinite}
@keyframes ochatGrab{0%,100%{opacity:1}50%{opacity:.45}}
.ochat-env .ochat-send{padding:0 14px;background:var(--accent-grass,#3f8a85);border-color:var(--accent-grass,#3f8a85);color:#fff;font-weight:700}
.ochat-adjprev{display:none;align-items:center;gap:8px;padding:6px 10px;margin:0 10px 6px;background:rgba(0,0,0,.06);border:1px solid var(--card-border,rgba(70,55,30,.12));border-radius:8px;font-size:12px;justify-content:space-between}
.ochat-adjprev button{background:none;border:none;color:#e5484d;cursor:pointer;font-size:15px;padding:0 4px}
.ochat-img{max-width:200px;max-height:200px;border-radius:8px;display:block;margin-top:6px;cursor:pointer}
.ochat-vid{max-width:220px;border-radius:8px;display:block;margin-top:6px}
.ochat-aud{display:block;margin-top:6px;max-width:220px}
.ochat-arch{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:6px 10px;background:rgba(0,0,0,.08);border-radius:8px;font-size:12px;text-decoration:none;color:inherit}
@media (max-width:640px){.ochat{right:12px;bottom:12px}.ochat-burbuja{width:52px;height:52px;font-size:22px}}`;
    document.head.appendChild(st);
    const w = document.createElement('div');
    w.className = 'ochat'; w.id = 'ochat'; w.style.display = 'none';
    w.innerHTML = `
  <div id="ochatPanel" class="ochat-panel">
    <div class="ochat-cab"><span>💬 Soporte — Súper-admin</span><button type="button" id="ochatMin" aria-label="Minimizar">–</button></div>
    <div id="ochatMsgs" class="ochat-msgs"></div>
    <div id="ochatPrev" class="ochat-adjprev"></div>
    <div class="ochat-env">
      <input type="file" id="ochatArchivo" accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" style="display:none">
      <button type="button" class="ochat-ico" id="ochatClip" title="Adjuntar archivo">📎</button>
      <button type="button" class="ochat-ico" id="ochatMic" title="Nota de voz">🎤</button>
      <textarea id="ochatTexto" placeholder="Escribe tu mensaje…"></textarea>
      <button type="button" class="ochat-send" id="ochatEnviar" title="Enviar">➤</button>
    </div>
  </div>
  <button type="button" id="ochatBurbuja" class="ochat-burbuja" aria-label="Abrir chat de soporte">💬<span id="ochatBadge" class="ochat-badge" style="display:none">0</span></button>`;
    document.body.appendChild(w);
    $('ochatBurbuja').addEventListener('click', alternar);
    $('ochatMin').addEventListener('click', alternar);
    $('ochatClip').addEventListener('click', () => $('ochatArchivo').click());
    $('ochatArchivo').addEventListener('change', e => elegirArchivo(e.target));
    $('ochatMic').addEventListener('click', alternarVoz);
    $('ochatEnviar').addEventListener('click', enviar);
    $('ochatTexto').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
  }

  function alternar() {
    abierto = !abierto;
    $('ochatPanel').style.display = abierto ? 'flex' : 'none';
    if (abierto) {
      cargar();
      if (pollAbierto) clearInterval(pollAbierto);
      pollAbierto = setInterval(() => { if (!document.hidden) cargar(); }, 8000);
      setTimeout(() => { const t = $('ochatTexto'); if (t) t.focus(); }, 50);
    } else if (pollAbierto) { clearInterval(pollAbierto); pollAbierto = null; }
  }

  async function actualizarBadge() {
    try {
      const { total } = await llamar('/api/hipismo/chat/conteo-no-leidos');
      const badge = $('ochatBadge'), bur = $('ochatBurbuja');
      if (!badge || !bur) return true;
      if (total > ultimoNoLeidos) sonido();
      ultimoNoLeidos = total;
      if (total > 0 && !abierto) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = 'inline-block'; bur.classList.add('parpadea'); }
      else { badge.style.display = 'none'; bur.classList.remove('parpadea'); }
      return true;
    } catch (e) { return false; }
  }

  async function cargar() {
    try {
      const mensajes = await llamar('/api/hipismo/chat');
      pintar(mensajes);
      if (mensajes.some(m => m.remitente !== 'grupo') || ultimoNoLeidos > 0) await llamar('/api/hipismo/chat/marcar-leidos', { method: 'POST' });
      ultimoNoLeidos = 0;
      actualizarBadge();
    } catch (e) { /* no crítico: el chat queda como estaba */ }
  }

  function pintar(mensajes, forzar) {
    const cont = $('ochatMsgs'); if (!cont) return;
    ultimosMensajes = mensajes;
    const firma = mensajes.map(m => m.id).join(',') + '|' + Object.keys(adjCache).length;
    if (!forzar && firma === ultimaFirma) return;
    ultimaFirma = firma;
    cont.innerHTML = mensajes.length
      ? mensajes.map(m => `<div class="ochat-bur ${m.remitente === 'grupo' ? 'propio' : 'otro'}">${m.texto ? esc(m.texto) : ''}${adjunto(m)}<span class="ochat-hora">${m.remitente === 'grupo' ? 'Tú' : 'Súper-admin'} — ${esc(fechaHora(m.creado_en))}</span></div>`).join('')
      : '<p class="ochat-vacio">Todavía no hay mensajes. Escríbele al Súper-admin abajo.</p>';
    cont.scrollTop = cont.scrollHeight;
  }

  // El archivo adjunto (hasta 8 MB) NO viene en la lista: se pide una sola vez (las imágenes solas; lo demás al tocarlo).
  function pedirAdjunto(id) {
    if (adjCache[id] || adjPidiendo[id]) return;
    adjPidiendo[id] = true;
    llamar('/api/hipismo/chat/' + id + '/adjunto').then(a => { adjCache[id] = a; delete adjFallo[id]; })
      .catch(() => { adjFallo[id] = true; })
      .finally(() => { delete adjPidiendo[id]; if (ultimosMensajes) pintar(ultimosMensajes, true); });
  }
  function adjunto(m) {
    if (!m.adjunto_datos && !m.tiene_adjunto) return '';
    const tipo = m.adjunto_tipo || '', nombre = esc(m.adjunto_nombre || 'archivo');
    const datos = m.adjunto_datos || (adjCache[m.id] && adjCache[m.id].datos);
    if (!datos) {
      if (adjFallo[m.id]) return `<a href="#" class="ochat-arch" data-reint="${esc(m.id)}">⚠️ No se pudo cargar ${nombre} — tocar para reintentar</a>`;
      if (tipo.startsWith('image/')) { pedirAdjunto(m.id); return '<span class="ochat-arch">🖼️ cargando imagen…</span>'; }
      return `<a href="#" class="ochat-arch" data-cargar="${esc(m.id)}">📎 ${nombre} — tocar para cargar</a>`;
    }
    if (tipo.startsWith('image/')) return `<img src="${datos}" class="ochat-img" alt="${nombre}" data-abrir="1">`;
    if (tipo.startsWith('video/')) return `<video src="${datos}" class="ochat-vid" controls></video>`;
    if (tipo.startsWith('audio/')) return `<audio src="${datos}" class="ochat-aud" controls></audio>`;
    return `<a href="${datos}" download="${nombre}" class="ochat-arch">📄 ${nombre}</a>`;
  }

  function elegirArchivo(input) {
    const a = input.files && input.files[0]; input.value = '';
    if (!a) return;
    if (a.size > TOPE_ADJUNTO) { alert('Ese archivo pesa más de 8MB — elige uno más liviano.'); return; }
    const l = new FileReader();
    l.onload = () => { adjuntoPendiente = { datos: l.result, tipo: a.type || 'application/octet-stream', nombre: a.name }; previa(); };
    l.onerror = () => alert('No se pudo leer ese archivo.');
    l.readAsDataURL(a);
  }
  function previa() {
    const c = $('ochatPrev'); if (!c || !adjuntoPendiente) return;
    const { tipo, nombre } = adjuntoPendiente;
    const ico = tipo.startsWith('image/') ? '🖼️' : tipo.startsWith('video/') ? '🎬' : tipo.startsWith('audio/') ? '🎤' : '📄';
    c.innerHTML = `<span>${ico} ${esc(nombre)}</span><button type="button" id="ochatQuitar">✕</button>`;
    c.style.display = 'flex';
    $('ochatQuitar').addEventListener('click', quitarAdjunto);
  }
  function quitarAdjunto() { adjuntoPendiente = null; const c = $('ochatPrev'); if (c) { c.style.display = 'none'; c.innerHTML = ''; } }

  async function alternarVoz() {
    const b = $('ochatMic');
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = []; recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop()); b.classList.remove('grabando');
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size > TOPE_ADJUNTO) { alert('La nota de voz quedó muy larga (más de 8MB) — intenta una más corta.'); return; }
        const l = new FileReader();
        l.onload = () => { adjuntoPendiente = { datos: l.result, tipo: 'audio/webm', nombre: 'nota-de-voz.webm' }; previa(); };
        l.readAsDataURL(blob);
      };
      recorder.start(); b.classList.add('grabando');
    } catch (e) { alert('No se pudo acceder al micrófono: ' + e.message); }
  }

  async function enviar() {
    const t = $('ochatTexto'), texto = t.value.trim();
    if (!texto && !adjuntoPendiente) return;
    const btn = $('ochatEnviar'); btn.disabled = true;
    try {
      const cuerpo = { texto };
      if (adjuntoPendiente) cuerpo.adjunto = adjuntoPendiente;
      await llamar('/api/hipismo/chat', { method: 'POST', body: JSON.stringify(cuerpo) });
      t.value = ''; quitarAdjunto(); await cargar();
    } catch (e) { alert('No se pudo enviar el mensaje: ' + e.message); }
    finally { btn.disabled = false; }
  }

  // "Ding" de 2 notas con Web Audio (sin archivos de audio); si el navegador aún no deja sonar, no pasa nada: el badge y el parpadeo avisan.
  function sonido() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx; if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;
      [880, 1174.66].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const ini = t0 + i * 0.14;
        g.gain.setValueAtTime(0, ini); g.gain.linearRampToValueAtTime(0.22, ini + 0.015); g.gain.exponentialRampToValueAtTime(0.001, ini + 0.32);
        o.connect(g).connect(ctx.destination); o.start(ini); o.stop(ini + 0.34);
      });
    } catch (e) { /* no crítico */ }
  }

  async function iniciar() {
    if (iniciado) return; iniciado = true;
    if (!localStorage.getItem('zenyatta_token')) return;      // sin sesión no hay bandeja (la pantalla manda al inicio)
    poner();
    // Primera consulta: si el usuario no tiene permiso de mensajes (empleado sin Hipismo) la bandeja no se muestra.
    const ok = await actualizarBadge();
    if (!ok) { const w = $('ochat'); if (w) w.remove(); return; }
    $('ochat').style.display = 'flex';
    $('ochatMsgs').addEventListener('click', e => {
      const img = e.target.closest('img[data-abrir]'); if (img) { window.open(img.src, '_blank'); return; }
      const re = e.target.closest('a[data-reint]'); if (re) { e.preventDefault(); delete adjFallo[re.dataset.reint]; pedirAdjunto(re.dataset.reint); return; }
      const ca = e.target.closest('a[data-cargar]'); if (ca) { e.preventDefault(); pedirAdjunto(ca.dataset.cargar); }
    });
    // Chequeo de fondo cada 25 s (como Grupos), solo con la pestaña a la vista.
    setInterval(() => { if (!document.hidden) actualizarBadge(); }, 25000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizarBadge(); });
  }

  window.OficinasChat = { iniciar, esc };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
