/**
 * app.js — arranque del visor: menú lateral por grupos, navegación por #id,
 * render perezoso de cada pestaña (se dibuja la primera vez que se abre) y
 * tabla automática de componentes a partir de `nodes`.
 */
(function appModule(global) {
  'use strict';

  const { escapeHtml } = global.BidCleanTooltip;
  const rendered = new Set();

  function groupTabs(tabs) {
    const groups = new Map();
    tabs.forEach((tab) => {
      if (!groups.has(tab.group)) {
        groups.set(tab.group, []);
      }
      groups.get(tab.group).push(tab);
    });
    return groups;
  }

  function buildMenu(tabs) {
    const nav = document.getElementById('menu');
    const html = [];
    groupTabs(tabs).forEach((items, group) => {
      html.push(`<div class="menu-group"><div class="menu-group-title">${escapeHtml(group)}</div>`);
      items.forEach((tab) => {
        html.push(`<a class="menu-item" href="#${tab.id}" data-tab="${tab.id}">${escapeHtml(tab.title)}</a>`);
      });
      html.push('</div>');
    });
    nav.innerHTML = html.join('');
  }

  function legendHtml() {
    return Object.values(global.BidCleanStatus.STATUS)
      .map((s) => `<span class="legend-item"><span class="legend-dot" style="background:${s.fill};border-color:${s.stroke}"></span>${s.label}</span>`)
      .join('');
  }

  function componentTable(nodes) {
    const entries = Object.values(nodes);
    if (entries.length === 0) {
      return '';
    }
    const rows = entries
      .map((n) => {
        const s = global.BidCleanStatus.statusInfo(n.estado);
        return `<tr><td>${escapeHtml(n.title || '')}</td><td>${escapeHtml(n.tipo || '')}</td>
          <td><code>${escapeHtml(n.ubicacion || '')}</code></td>
          <td><span class="pill" style="border-color:${s.stroke};color:${s.stroke}">${s.label}</span></td></tr>`;
      })
      .join('');
    return `<section class="card"><h3>Componentes de esta vista</h3>
      <table class="table"><thead><tr><th>Componente</th><th>Tipo</th><th>Ubicación</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody></table></section>`;
  }

  function tabSkeleton(tab) {
    const diagrams = tab.diagrams
      .map((d, i) => `<section class="card">
          <h3>${escapeHtml(d.title)}</h3>
          ${d.description ? `<p class="muted">${d.description}</p>` : ''}
          <div class="diagram" data-index="${i}"><div class="loading">Dibujando diagrama…</div></div>
        </section>`)
      .join('');
    const sections = tab.sections
      .map((s) => `<section class="card"><h3>${escapeHtml(s.title)}</h3>${s.html}</section>`)
      .join('');
    return `<header class="tab-header"><div class="tab-group">${escapeHtml(tab.group)}</div>
        <h2>${escapeHtml(tab.title)}</h2>${tab.summary ? `<p class="summary">${tab.summary}</p>` : ''}
        ${tab.diagrams.length ? `<div class="legend">${legendHtml()}<span class="hint">Pasa el mouse sobre un componente para ver su detalle.</span></div>` : ''}
      </header>${diagrams}${sections}${componentTable(tab.nodes)}`;
  }

  async function renderTab(tab, panel) {
    panel.innerHTML = tabSkeleton(tab);
    const targets = panel.querySelectorAll('.diagram');
    for (const target of targets) {
      const diagram = tab.diagrams[Number(target.dataset.index)];
      // eslint-disable-next-line no-await-in-loop
      await global.BidCleanRender.renderDiagram(target, diagram, tab.nodes);
    }
    rendered.add(tab.id);
  }

  async function showTab(id) {
    const tabs = global.BidCleanArch.listTabs();
    const tab = global.BidCleanArch.findTab(id) || tabs[0];
    if (!tab) {
      return;
    }
    global.BidCleanTooltip.hide();
    document.querySelectorAll('.menu-item').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab.id));
    document.querySelectorAll('.panel').forEach((el) => { el.hidden = el.dataset.tab !== tab.id; });
    let panel = document.querySelector(`.panel[data-tab="${tab.id}"]`);
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'panel';
      panel.dataset.tab = tab.id;
      document.getElementById('content').appendChild(panel);
    }
    panel.hidden = false;
    document.getElementById('content').scrollTop = 0;
    if (!rendered.has(tab.id)) {
      await renderTab(tab, panel);
    }
  }

  function currentHash() {
    return decodeURIComponent(window.location.hash.replace(/^#/, ''));
  }

  function boot() {
    global.BidCleanRender.initMermaid();
    const tabs = global.BidCleanArch.listTabs();
    buildMenu(tabs);
    document.getElementById('tab-count').textContent = `${tabs.length} vistas`;
    window.addEventListener('hashchange', () => showTab(currentHash()));
    showTab(currentHash());
  }

  /** Renderiza todas las pestañas (usado por la validación automática). */
  async function renderAll() {
    for (const tab of global.BidCleanArch.listTabs()) {
      // eslint-disable-next-line no-await-in-loop
      await showTab(tab.id);
    }
  }

  global.BidCleanApp = { renderAll };
  document.addEventListener('DOMContentLoaded', boot);
})(window);
