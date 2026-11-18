/**
 * status.js — catálogo de estados de un componente (etiqueta, color, clase Mermaid).
 *
 * Es la única fuente de los colores de estado: la leyenda, los tooltips y las
 * clases que se aplican a los nodos de los diagramas salen de aquí.
 */
(function statusModule(global) {
  'use strict';

  const STATUS = {
    hecho: { label: 'Implementado', fill: '#0f3d36', stroke: '#00F5D4', text: '#E8FFFB' },
    parcial: { label: 'Parcial / requiere configuración', fill: '#3d3410', stroke: '#F5C400', text: '#FFF8DC' },
    falta: { label: 'Pendiente', fill: '#3d1416', stroke: '#FF5C6C', text: '#FFE8EA' },
    externo: { label: 'Servicio externo', fill: '#1d2a44', stroke: '#6EA8FE', text: '#E6EEFF' },
    alerta: { label: 'Alerta de seguridad', fill: '#4a0f14', stroke: '#FF2E4A', text: '#FFFFFF' },
  };

  /** Datos de un estado; cae en 'hecho' si el valor es desconocido. */
  function statusInfo(key) {
    return STATUS[key] || STATUS.hecho;
  }

  /** Líneas `classDef` de Mermaid para todos los estados. */
  function mermaidClassDefs() {
    return Object.entries(STATUS)
      .map(([key, s]) => `classDef ${key} fill:${s.fill},stroke:${s.stroke},color:${s.text},stroke-width:2px`)
      .join('\n');
  }

  global.BidCleanStatus = { STATUS, statusInfo, mermaidClassDefs };
})(window);
