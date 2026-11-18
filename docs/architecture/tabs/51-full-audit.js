/**
 * 51-full-audit.js — herramientas tools/full-audit y tools/config-inventory.
 */
BidCleanArch.registerTab({
  id: 'full-audit',
  group: 'Calidad y DevOps',
  order: 510,
  title: 'Auditoría y config-inventory',
  summary:
    'Dos herramientas de verificación. full-audit sondea el sistema en ejecución contra un registro de 50 componentes (65 hallazgos abiertos). '
    + 'config-inventory cataloga 283 variables de configuración (117 hallazgos, 3 bloqueantes). Ninguna corrige nada: solo observa y reporta.',
  diagrams: [
    {
      title: 'full-audit: del registro al veredicto',
      description: 'Cadena de autoridad: registro, sondas contra el sistema vivo, checklist y veredicto.',
      code: `flowchart LR
  REG["Registro de componentes<br/>component-registry.yaml<br/>50 componentes"]
  RECON["Reconciliación<br/>REGISTRY_STALE"]
  BUILDER["Constructor del checklist"]
  PROBES["Sondas"]
  LIVEFETCH["live-fetch<br/>HTTP y TCP"]
  RUNSYS["Sistema en ejecución<br/>local o VPS"]
  EVAL["Evaluador de preparación"]
  FINDINGS["Hallazgos<br/>65 abiertos"]
  REPORT["READINESS-CHECKLIST.md<br/>y veredicto"]
  REG --> RECON --> BUILDER --> PROBES
  PROBES --> LIVEFETCH --> RUNSYS
  PROBES --> EVAL
  EVAL --> FINDINGS
  EVAL --> REPORT`,
    },
    {
      title: 'config-inventory: de las fuentes al .env.example',
      description: 'Seis escáneres alimentan el modelo canónico. El .env.example es solo una proyección.',
      code: `flowchart LR
  SCAN_APP["application-scanner<br/>busca app.config.ts"]
  SCAN_BUILD["build-scanner"]
  SCAN_INFRA["infra-scanner"]
  SCAN_CI["ci-scanner"]
  SCAN_DEPLOY["deploy-scanner"]
  SCAN_RUNTIME["runtime-scanner"]
  APPCFG["apps/mobile/app.config.js<br/>archivo real"]
  MERGE["merge<br/>modelo canónico<br/>283 variables"]
  CLASSIFY["classify<br/>secreto, config o público"]
  RECONC["reconcile"]
  ENVEX[".env.example"]
  EXPOSURE["exposure-scanner<br/>git y patrones"]
  INVREP["Informe<br/>117 hallazgos, 3 bloqueantes"]
  SCAN_APP -.->|no lo encuentra| APPCFG
  SCAN_APP --> MERGE
  SCAN_BUILD --> MERGE
  SCAN_INFRA --> MERGE
  SCAN_CI --> MERGE
  SCAN_DEPLOY --> MERGE
  SCAN_RUNTIME --> MERGE
  MERGE --> CLASSIFY --> RECONC
  ENVEX --> RECONC
  EXPOSURE --> INVREP
  RECONC --> INVREP`,
    },
  ],
  nodes: {
    REG: { title: 'Registro de componentes', tipo: 'Datos de entrada', descripcion: 'YAML versionado con 50 componentes: servicios, módulos Nest, workers, consumidores de outbox, webhooks, endpoints de IA y módulos móviles. Solo lo declarado ahí se considera real.', ubicacion: 'tools/full-audit/registry/component-registry.yaml', estado: 'hecho' },
    RECON: { title: 'Reconciliación del registro', tipo: 'Validación', descripcion: 'Cualquier diferencia entre lo declarado y el registro genera un hallazgo bloqueante REGISTRY_STALE antes de construir el checklist.', ubicacion: 'tools/full-audit/registry/registry-reconcile.ts', estado: 'hecho' },
    BUILDER: { title: 'Constructor del checklist', tipo: 'Generador', descripcion: 'Crea un ítem de presencia y uno de integración por componente, con sonda y responsable definidos.', ubicacion: 'tools/full-audit/checklist/checklist.builder.ts', estado: 'hecho' },
    PROBES: { title: 'Sondas', tipo: 'Verificación', descripcion: 'Presencia, salud, bordes entre servicios, integraciones externas, recorridos E2E, tienda y DevOps. Un health 200 solo prueba que está vivo, nunca la integración.', ubicacion: 'tools/full-audit/probes', estado: 'parcial', nota: 'Con el stack real apagado los resultados son mayormente fallos o no aplicables.' },
    LIVEFETCH: { title: 'live-fetch', tipo: 'Observación en vivo', descripcion: 'Con FULL_AUDIT_LIVE_STACK=1 hace GET HTTP, conexión TCP a Postgres y Redis y llamadas autenticadas por borde. Nunca lanza errores ni lleva credenciales.', ubicacion: 'tools/full-audit/probes/live-fetch.ts', estado: 'hecho' },
    RUNSYS: { title: 'Sistema en ejecución', tipo: 'Sujeto auditado', descripcion: 'Docker local primero y luego el VPS con Traefik, dominios y SSL.', estado: 'parcial', nota: 'Solo existe el compose local con seis servicios.' },
    EVAL: { title: 'Evaluador de preparación', tipo: 'Lógica pura', descripcion: 'Combina el estado de ambos entornos, la bandera de tienda y los hallazgos para emitir el veredicto.', ubicacion: 'tools/full-audit/evaluate/readiness-evaluator.ts', estado: 'hecho' },
    FINDINGS: { title: 'Hallazgos de full-audit', tipo: 'Resultado', descripcion: 'Un hallazgo por condición violada, con responsable. Hay 65 abiertos.', ubicacion: 'tools/full-audit/evaluate/findings-reporter.ts', estado: 'alerta', nota: '65 hallazgos abiertos.' },
    REPORT: { title: 'Checklist y veredicto', tipo: 'Informe', descripcion: 'Documento legible con checklist, hallazgos y veredicto de preparación.', ubicacion: 'docs/deployment/READINESS-CHECKLIST.md', estado: 'parcial', nota: 'El veredicto no será positivo mientras haya hallazgos abiertos.' },
    SCAN_APP: { title: 'application-scanner', tipo: 'Escáner', descripcion: 'Lee constantes de la API, ajustes pydantic, la configuración de Expo y EXPO_PUBLIC_*. Busca apps/mobile/app.config.ts, pero el archivo real es app.config.js, así que valores como MAPBOX_DOWNLOAD_TOKEN no se descubren.', ubicacion: 'tools/config-inventory/sources/application-scanner.ts', estado: 'parcial', nota: 'Corregir la ruta a app.config.js.' },
    APPCFG: { title: 'app.config.js', tipo: 'Archivo real', descripcion: 'Configuración real de Expo de la app móvil.', ubicacion: 'apps/mobile/app.config.js', estado: 'hecho' },
    SCAN_BUILD: { title: 'build-scanner', tipo: 'Escáner', descripcion: 'Perfiles de eas.json y tokens de build.', ubicacion: 'tools/config-inventory/sources/build-scanner.ts', estado: 'hecho' },
    SCAN_INFRA: { title: 'infra-scanner', tipo: 'Escáner', descripcion: 'Variables de los docker-compose bajo infra, resolviendo interpolación.', ubicacion: 'tools/config-inventory/sources/infra-scanner.ts', estado: 'hecho' },
    SCAN_CI: { title: 'ci-scanner', tipo: 'Escáner', descripcion: 'Bloques env de .github/workflows. codemagic.yaml se escanea solo si existe, y hoy no existe.', ubicacion: 'tools/config-inventory/sources/ci-scanner.ts', estado: 'hecho' },
    SCAN_DEPLOY: { title: 'deploy-scanner', tipo: 'Escáner', descripcion: 'Scripts de despliegue y Traefik bajo infra. Hoy no hay archivos, así que no aporta variables.', ubicacion: 'tools/config-inventory/sources/deploy-scanner.ts', estado: 'falta', nota: 'No hay scripts de despliegue que escanear.' },
    SCAN_RUNTIME: { title: 'runtime-scanner', tipo: 'Escáner', descripcion: 'Lecturas dinámicas: process.env con corchetes, os.environ y os.getenv.', ubicacion: 'tools/config-inventory/sources/runtime-scanner.ts', estado: 'hecho' },
    MERGE: { title: 'Modelo canónico', tipo: 'Catálogo', descripcion: 'Une las fuentes por nombre de variable. Contiene 283 variables con su procedencia.', ubicacion: 'tools/config-inventory/merge.ts', estado: 'hecho' },
    CLASSIFY: { title: 'Clasificador', tipo: 'Lógica', descripcion: 'Asigna tipo SECRET, CONFIG o PUBLIC, alcance requerido y verifica la frontera público/secreto. El prefijo EXPO_PUBLIC_ por sí solo no prueba seguridad.', ubicacion: 'tools/config-inventory/classify.ts', estado: 'hecho' },
    RECONC: { title: 'Reconciliación con .env.example', tipo: 'Lógica', descripcion: 'Detecta variables faltantes, huérfanas y con valores distintos.', ubicacion: 'tools/config-inventory/reconcile.ts', estado: 'hecho' },
    ENVEX: { title: '.env.example', tipo: 'Proyección', descripcion: 'Presentación derivada del modelo. Nunca alimenta de vuelta al catálogo.', ubicacion: '.env.example', estado: 'hecho' },
    EXPOSURE: { title: 'Escáner de exposición', tipo: 'Seguridad', descripcion: 'Usa git check-ignore y git ls-files y busca patrones de secretos. Reporta archivo y línea, nunca el valor, y no rota nada. Una corrida limpia solo significa que ningún patrón conocido coincidió.', ubicacion: 'tools/config-inventory/exposure-scanner.ts', estado: 'alerta', nota: 'Una clave conocida en mcp.json aparece como hallazgo bloqueante SECRET_EXPOSURE.' },
    INVREP: { title: 'Informe de inventario', tipo: 'Resultado', descripcion: '117 hallazgos, de ellos 3 bloqueantes. El CLI sale con error ante cualquier bloqueante.', ubicacion: 'tools/config-inventory/inventory.cli.ts', estado: 'alerta', nota: '3 hallazgos bloqueantes abiertos.' },
  },
  sections: [
    {
      title: 'Qué no hacen',
      html: `<ul>
        <li>No corrigen configuración ni código: reportan hallazgos al dueño de cada spec.</li>
        <li>No rotan secretos ni disparan dinero real de forma automática.</li>
        <li>full-audit no repite las pruebas de la spec 25.</li></ul>`,
    },
  ],
});
