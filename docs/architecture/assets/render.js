/**
 * render.js — dibuja los diagramas Mermaid de una pestaña y conecta los tooltips.
 *
 * Para cada diagrama tipo flowchart añade automáticamente los colores de estado:
 * los `classDef` de status.js y una línea `class Nodo estado` por cada nodo que
 * la pestaña describe en `nodes`. Así cada archivo de `tabs/` solo declara datos.
 */
(function renderModule(global) {
  'use strict';

  let renderCount = 0;

  /** Configura Mermaid una sola vez con el tema oscuro de BidClean. */
  function initMermaid() {
    global.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      flowchart: { htmlLabels: true, curve: 'basis', padding: 12, nodeSpacing: 40, rankSpacing: 55 },
      sequence: { mirrorActors: false },
      themeVariables: {
        darkMode: true,
        background: '#0B0C10',
        primaryColor: '#1F2833',
        primaryBorderColor: '#00F5D4',
        primaryTextColor: '#FFFFFF',
        secondaryColor: '#16202b',
        tertiaryColor: '#121a24',
        lineColor: '#7d8b99',
        textColor: '#e6edf3',
        clusterBkg: '#11171f',
        clusterBorder: '#2c3a48',
        fontFamily: 'Inter, Segoe UI, system-ui, sans-serif',
        fontSize: '14px',
        actorBkg: '#1F2833',
        actorBorder: '#00F5D4',
        actorTextColor: '#FFFFFF',
        signalColor: '#c9d1d9',
        signalTextColor: '#e6edf3',
        noteBkgColor: '#1d2a44',
        noteTextColor: '#E6EEFF',
      },
    });
  }

  function isFlowchart(code) {
    return /^\s*(flowchart|graph)\b/.test(code);
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Añade classDef + `class Nodo estado` a un flowchart. */
  function withStatusClasses(code, nodes) {
    if (!isFlowchart(code)) {
      return code;
    }
    const lines = [code.trimEnd(), global.BidCleanStatus.mermaidClassDefs()];
    Object.entries(nodes).forEach(([id, info]) => {
      const present = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(id)}([^A-Za-z0-9_]|$)`, 'm').test(code);
      if (present && info.estado) {
        lines.push(`class ${id} ${info.estado}`);
      }
    });
    return lines.join('\n');
  }

  /** Extrae el id del nodo Mermaid desde un <g class="node">. */
  function nodeIdOf(element) {
    if (element.dataset && element.dataset.id) {
      return element.dataset.id;
    }
    const match = /flowchart-(.+)-\d+$/.exec(element.id || '');
    return match ? match[1] : null;
  }

  function bindTooltips(container, nodes) {
    container.querySelectorAll('g.node').forEach((element) => {
      const id = nodeIdOf(element);
      if (id && nodes[id]) {
        global.BidCleanTooltip.attach(element, nodes[id]);
      }
    });
  }

  /** Renderiza un diagrama dentro de `target`; muestra el error si Mermaid falla. */
  async function renderDiagram(target, diagram, nodes) {
    renderCount += 1;
    const id = `arch-diagram-${renderCount}`;
    try {
      const { svg } = await global.mermaid.render(id, withStatusClasses(diagram.code, nodes));
      target.innerHTML = svg;
      bindTooltips(target, nodes);
      target.dataset.rendered = 'ok';
    } catch (error) {
      target.dataset.rendered = 'error';
      target.innerHTML = `<pre class="diagram-error">Error en el diagrama: ${global.BidCleanTooltip.escapeHtml(error.message || error)}</pre>`;
      console.error(`[arch] Diagrama "${diagram.title}"`, error);
      document.getElementById(id)?.remove();
    }
  }

  global.BidCleanRender = { initMermaid, renderDiagram };
})(window);
