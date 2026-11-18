/**
 * tooltip.js — recuadro de información al pasar el mouse sobre un nodo.
 *
 * Aparece al entrar en el nodo, sigue al cursor y desaparece al salir.
 * El contenido se arma solo con texto escapado (sin HTML de los datos).
 */
(function tooltipModule(global) {
  'use strict';

  const OFFSET_PX = 16;
  let box = null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function row(label, value) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      return '';
    }
    const content = Array.isArray(value)
      ? `<ul>${value.map((v) => `<li><code>${escapeHtml(v)}</code></li>`).join('')}</ul>`
      : escapeHtml(value);
    return `<div class="tt-row"><span class="tt-label">${label}</span><div class="tt-value">${content}</div></div>`;
  }

  /** HTML del recuadro para la info de un nodo. */
  function render(info) {
    const status = global.BidCleanStatus.statusInfo(info.estado);
    return `
      <div class="tt-head">
        <span class="tt-title">${escapeHtml(info.title || '')}</span>
        <span class="tt-badge" style="border-color:${status.stroke};color:${status.stroke}">${status.label}</span>
      </div>
      ${info.tipo ? `<div class="tt-type">${escapeHtml(info.tipo)}</div>` : ''}
      ${info.descripcion ? `<p class="tt-desc">${escapeHtml(info.descripcion)}</p>` : ''}
      ${row('Tecnología', info.tecnologia)}
      ${row('Ubicación', info.ubicacion)}
      ${row('Consume', info.consume)}
      ${row('Produce', info.produce)}
      ${row('ADR', info.adr)}
      ${row('Nota', info.nota)}`;
  }

  function ensureBox() {
    if (!box) {
      box = document.getElementById('tooltip');
    }
    return box;
  }

  function position(event) {
    const el = ensureBox();
    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();
    let left = event.clientX + OFFSET_PX;
    let top = event.clientY + OFFSET_PX;
    if (left + rect.width > innerWidth - 8) {
      left = event.clientX - rect.width - OFFSET_PX;
    }
    if (top + rect.height > innerHeight - 8) {
      top = Math.max(8, innerHeight - rect.height - 8);
    }
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${top}px`;
  }

  function show(info, event) {
    const el = ensureBox();
    el.innerHTML = render(info);
    el.classList.add('visible');
    position(event);
  }

  function hide() {
    ensureBox().classList.remove('visible');
  }

  /** Conecta mouseenter/move/leave de un elemento SVG con la info del nodo. */
  function attach(element, info) {
    element.classList.add('has-tooltip');
    element.addEventListener('mouseenter', (event) => show(info, event));
    element.addEventListener('mousemove', position);
    element.addEventListener('mouseleave', hide);
  }

  global.BidCleanTooltip = { attach, hide, escapeHtml };
})(window);
