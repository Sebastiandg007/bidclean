/**
 * registry.js — registro de pestañas del visor de arquitectura.
 *
 * Cada archivo de `tabs/` llama a `BidCleanArch.registerTab({...})` al cargarse.
 * Este módulo solo guarda y ordena las definiciones; no renderiza nada.
 *
 * Esquema de una pestaña:
 *   {
 *     id:       'sistema',                 // único, usado en la URL (#sistema)
 *     group:    'Visión general',          // grupo del menú lateral
 *     order:    10,                        // orden dentro de todo el menú
 *     title:    'Sistema completo',
 *     summary:  'Texto introductorio (HTML permitido).',
 *     diagrams: [{ title, description, code }],   // código Mermaid (flowchart recomendado)
 *     nodes:    { NodoId: { title, tipo, descripcion, tecnologia, ubicacion,
 *                           consume: [], produce: [], adr, estado } },
 *     sections: [{ title, html }],         // contenido extra opcional (tablas, notas)
 *   }
 *
 * `estado` admite: 'hecho' | 'parcial' | 'falta' | 'externo' | 'alerta'.
 */
(function registryModule(global) {
  'use strict';

  const tabs = [];

  /** Registra una pestaña; ignora ids duplicados para no romper el menú. */
  function registerTab(definition) {
    if (!definition || !definition.id) {
      console.error('[arch] Pestaña sin id', definition);
      return;
    }
    if (tabs.some((tab) => tab.id === definition.id)) {
      console.error(`[arch] Pestaña duplicada: ${definition.id}`);
      return;
    }
    tabs.push({
      order: 999,
      group: 'Otros',
      summary: '',
      diagrams: [],
      nodes: {},
      sections: [],
      ...definition,
    });
  }

  /** Devuelve las pestañas ordenadas por `order`. */
  function listTabs() {
    return [...tabs].sort((a, b) => a.order - b.order);
  }

  /** Busca una pestaña por id. */
  function findTab(id) {
    return tabs.find((tab) => tab.id === id) || null;
  }

  global.BidCleanArch = { registerTab, listTabs, findTab };
})(window);
