// navidad.js — franja navideña arriba de todos los módulos (temporada de Navidad y Año Nuevo 2027).
// Pedido del usuario (12-11-2026): "a todos los módulos agregarle arriba objetos de Navidad y un mensaje: Feliz Navidad y próspero
// Año 2027 te desea LudoxApp". Es temporal: en enero se quita borrando la línea <script src="navidad.js"> de cada página
// (o simplemente poniendo NAVIDAD_ACTIVA = false aquí abajo) y todo vuelve a como estaba. No toca ninguna otra cosa de la página.
// Cada usuario puede ocultarla con la × (queda oculta mientras dure su sesión del navegador).
(function () {
  'use strict';
  const NAVIDAD_ACTIVA = true;
  if (!NAVIDAD_ACTIVA || window.__navidad) return; window.__navidad = true;
  try { if (sessionStorage.getItem('ludox_navidad_oculta') === '1') return; } catch (e) { /* sin almacenamiento: se muestra */ }
  const COL = ['#e63946', '#f4b942', '#2a9d8f', '#3a86ff', '#ff7aa2'];
  const st = document.createElement('style');
  st.textContent = `
.nav-franja{position:relative;z-index:50;box-sizing:border-box;flex:none;align-self:stretch;width:100%;height:66px;overflow:hidden;color:#fff7e0;background:linear-gradient(180deg,#0f4a3c 0%,#165c49 55%,#1b6b55 100%);border-bottom:3px solid #f4b942;box-shadow:0 4px 14px rgba(15,74,60,.28);display:flex;align-items:center;justify-content:center;font-family:'Outfit','Inter',sans-serif}
.nav-luces{position:absolute;left:0;top:0;width:100%;height:26px;pointer-events:none}
.nav-fest{position:absolute;top:-8px;height:22px;border-bottom:1.6px solid #0a2f26;border-radius:0 0 50% 50%;box-sizing:border-box}
.nav-bulbo{position:absolute;width:8px;height:11px;margin-left:-4px;border-radius:50% 50% 55% 55%;box-shadow:0 0 8px 1px currentColor;animation:navTit 1.8s ease-in-out infinite}
@keyframes navTit{0%,100%{opacity:1}50%{opacity:.35}}
.nav-msg{position:relative;z-index:2;text-align:center;line-height:1.2;padding:12px 90px 0;max-width:100%}
.nav-msg b{font-size:19px;font-weight:800;letter-spacing:.01em;color:#fff7e0;text-shadow:0 1px 0 rgba(0,0,0,.3)}
.nav-msg b em{font-style:normal;color:#ffd166}
.nav-msg span{display:block;font-size:12.5px;color:#cfe9dc;margin-top:2px;letter-spacing:.04em}
.nav-deco{position:absolute;top:0;bottom:0;display:flex;align-items:flex-end;pointer-events:none}
.nav-deco.izq{left:10px}.nav-deco.der{right:44px}
.nav-deco svg{height:60px;width:auto;display:block;overflow:visible}
.nav-col{transform-origin:50% 0;animation:navBal 3.2s ease-in-out infinite}
@keyframes navBal{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
.nav-nieve{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.nav-nieve i{position:absolute;top:-8px;width:5px;height:5px;border-radius:50%;background:#fff;opacity:.85;animation:navCae linear infinite}
@keyframes navCae{to{transform:translateY(80px) translateX(14px)}}
.nav-x{position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:3;width:26px;height:26px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff7e0;font-size:15px;line-height:26px;cursor:pointer}
.nav-x:hover{background:rgba(255,255,255,.28)}
@media (max-width:760px){.nav-franja{height:64px}.nav-msg{padding:14px 40px 0 14px}.nav-msg b{font-size:14.5px}.nav-msg span{font-size:11.5px;margin-top:1px}.nav-deco{display:none}}
html.nav-activa .marca-esquina{top:78px!important}
@media (max-width:760px){html.nav-activa .marca-esquina{top:72px!important}}
@media (prefers-reduced-motion:reduce){.nav-bulbo,.nav-col,.nav-nieve i{animation:none}}`;
  (document.head || document.documentElement).appendChild(st);

  // guirnalda: cable en festones + bombillos que siguen la curva
  const SEG = 7, PER = 7; let luces = '';
  for (let k = 0; k < SEG; k++) luces += `<div class="nav-fest" style="left:${k * 100 / SEG}%;width:${100 / SEG}%"></div>`;
  for (let k = 0; k < SEG; k++) for (let j = 0; j < PER; j++) {
    const t = (j + 0.5) / PER, x = (k + t) * 100 / SEG, y = 2 + Math.sin(t * Math.PI) * 13, i = k * PER + j;
    luces += `<span class="nav-bulbo" style="left:${x}%;top:${y}px;background:${COL[i % COL.length]};color:${COL[i % COL.length]};animation-delay:${(i % 5) * .35}s"></span>`;
  }
  const cable = '';
  const arbol = c => `<svg viewBox="0 0 60 64"><g>
    <polygon points="30,4 36,16 24,16" fill="#1f8f4f"/><polygon points="30,12 42,32 18,32" fill="#23a05a"/><polygon points="30,26 48,50 12,50" fill="#2cb867"/>
    <rect x="26" y="50" width="8" height="10" rx="1.5" fill="#8a5a2b"/>
    <polygon points="30,0 31.8,4.6 36.6,4.8 32.8,7.7 34.2,12.4 30,9.7 25.8,12.4 27.2,7.7 23.4,4.8 28.2,4.6" fill="#ffd166"/>
    <circle cx="28" cy="24" r="2.4" fill="#e63946"/><circle cx="35" cy="38" r="2.6" fill="#f4b942"/><circle cx="23" cy="42" r="2.4" fill="#3a86ff"/><circle cx="38" cy="45" r="2.2" fill="#ff7aa2"/><circle cx="30" cy="35" r="2.2" fill="#fff"/></g></svg>`;
  const bola = (c, d) => `<svg viewBox="0 0 24 64" class="nav-col" style="animation-delay:${d}s"><line x1="12" y1="0" x2="12" y2="26" stroke="#d9c58a" stroke-width="1.3"/><rect x="9.5" y="24" width="5" height="4" rx="1" fill="#ffd166"/><circle cx="12" cy="38" r="11" fill="${c}"/><ellipse cx="8.5" cy="33" rx="3" ry="4.4" fill="#fff" opacity=".35"/><path d="M3 38 Q12 44 21 38" stroke="#fff" stroke-width="1.5" fill="none" opacity=".6"/></svg>`;
  const baston = `<svg viewBox="0 0 34 64"><path d="M10 62 L10 24 Q10 8 22 8 Q30 8 30 18" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M10 62 L10 24 Q10 8 22 8 Q30 8 30 18" fill="none" stroke="#e63946" stroke-width="7" stroke-linecap="round" stroke-dasharray="5 7"/></svg>`;
  const regalo = `<svg viewBox="0 0 40 64"><rect x="4" y="34" width="32" height="26" rx="3" fill="#e63946"/><rect x="17" y="34" width="6" height="26" fill="#ffd166"/><rect x="2" y="28" width="36" height="9" rx="3" fill="#f05a67"/><rect x="17" y="28" width="6" height="9" fill="#ffd166"/><path d="M20 28 Q10 14 14 20 Q18 24 20 28 Q22 24 26 20 Q30 14 20 28" fill="#ffd166"/></svg>`;

  const f = document.createElement('div');
  f.className = 'nav-franja'; f.setAttribute('role', 'note');
  let nieve = ''; for (let i = 0; i < 26; i++) nieve += `<i style="left:${(i * 37) % 100}%;animation-duration:${3 + (i % 5) * .9}s;animation-delay:${-(i % 7) * .8}s;width:${3 + i % 3}px;height:${3 + i % 3}px"></i>`;
  f.innerHTML = `
  <div class="nav-nieve">${nieve}</div>
  <div class="nav-luces">${luces}</div>
  <div class="nav-deco izq">${arbol()}${bola('#e63946', 0)}${regalo}${bola('#3a86ff', .6)}</div>
  <div class="nav-msg"><b>🎄 ¡Feliz Navidad y próspero <em>Año 2027</em>!</b><span>te desea LudoxApp</span></div>
  <div class="nav-deco der">${bola('#f4b942', .3)}${baston}${bola('#ff7aa2', .9)}${regalo}${arbol()}</div>
  <button type="button" class="nav-x" aria-label="Ocultar felicitación" title="Ocultar">×</button>`;
  f.querySelector('.nav-x').addEventListener('click', () => { f.remove(); document.documentElement.classList.remove('nav-activa'); try { sessionStorage.setItem('ludox_navidad_oculta', '1'); } catch (e) { /* no crítico */ } });
  // A pantalla completa: si la página le pone relleno al <body> (20 px en varios módulos), la franja lo compensa para pegarse a los bordes.
  const ajustar = () => { try { const c = getComputedStyle(document.body); f.style.margin = `-${c.paddingTop} -${c.paddingRight} 0 -${c.paddingLeft}`; f.style.width = `calc(100% + ${parseFloat(c.paddingLeft) + parseFloat(c.paddingRight)}px)`; } catch (e) { /* no crítico */ } };
  const poner = () => { document.body.insertBefore(f, document.body.firstChild); document.documentElement.classList.add('nav-activa'); ajustar(); window.addEventListener('resize', ajustar); };
  if (document.body) poner(); else document.addEventListener('DOMContentLoaded', poner);
})();
