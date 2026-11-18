/**
 * 50-devops.js — CI, builds, gestor de paquetes, pruebas y decisiones de arquitectura.
 */
BidCleanArch.registerTab({
  id: 'devops',
  group: 'Calidad y DevOps',
  order: 500,
  title: 'DevOps y calidad',
  summary:
    'GitHub Actions ejecuta tres jobs sobre develop y main. Los builds móviles usan EAS; Codemagic está planeado pero no existe. '
    + 'El monorepo usa workspaces de npm (no hay pnpm-workspace.yaml). Hay 22 ADR documentados.',
  diagrams: [
    {
      title: 'Pipeline de integración continua',
      description: 'Push o pull request a develop o main dispara .github/workflows/ci.yml.',
      code: `flowchart LR
  DEV["Desarrollador"]
  GIT["GitHub<br/>develop y main"]
  CI["Workflow CI"]
  J_QUAL["api-quality<br/>tsc y eslint"]
  J_TEST["api-tests<br/>jest"]
  J_AI["ai-tests<br/>pytest"]
  PG_SVC[("Servicio postgis<br/>16-3.4")]
  REDIS_SVC[("Servicio redis 7")]
  CM["Codemagic<br/>builds móviles"]
  EASB["Expo EAS<br/>builds móviles"]
  DEV --> GIT --> CI
  CI --> J_QUAL
  J_QUAL --> J_TEST
  CI --> J_AI
  PG_SVC --> J_TEST
  REDIS_SVC --> J_TEST
  GIT -.->|planeado| CM
  GIT --> EASB`,
    },
    {
      title: 'Herramientas del monorepo',
      description: 'Qué usa cada capa para instalar, validar y documentar.',
      code: `flowchart TB
  NPMW["npm workspaces<br/>apps, services, packages"]
  JEST["Jest<br/>API y app móvil"]
  PYTEST["pytest<br/>servicio IA"]
  LINT["ESLint"]
  PRETTIER["Prettier"]
  TSC["tsc noEmit"]
  ENVEX[".env.example"]
  ADR["ADR 001 a 022<br/>docs/ADR"]
  NPMW --> JEST
  NPMW --> LINT
  NPMW --> TSC
  NPMW --> PRETTIER
  PYTEST --> ENVEX
  JEST --> ENVEX
  ENVEX --> ADR`,
    },
  ],
  nodes: {
    DEV: { title: 'Desarrollador', tipo: 'Actor', descripcion: 'Trabaja en ramas feature y abre pull requests hacia develop.', estado: 'hecho' },
    GIT: { title: 'GitHub', tipo: 'Repositorio', descripcion: 'Git Flow simplificado: main siempre desplegable, develop integra.', ubicacion: '.github', estado: 'hecho' },
    CI: { title: 'Workflow CI', tipo: 'Automatización', descripcion: 'Se dispara en push y pull request hacia develop y main. Cada job instala solo el workspace que necesita para evitar compilar módulos nativos.', tecnologia: 'GitHub Actions', ubicacion: '.github/workflows/ci.yml', estado: 'hecho' },
    J_QUAL: { title: 'Job api-quality', tipo: 'Job de CI', descripcion: 'Node 22. Ejecuta tsc --noEmit en services/api y packages/shared, y eslint con max-warnings 0.', tecnologia: 'tsc + ESLint', ubicacion: '.github/workflows/ci.yml', estado: 'hecho' },
    J_TEST: { title: 'Job api-tests', tipo: 'Job de CI', descripcion: 'Depende de api-quality. Corre jest con servicios postgis y redis. Las pruebas de la app móvil no corren en CI.', tecnologia: 'Jest', ubicacion: '.github/workflows/ci.yml', estado: 'parcial', nota: 'La app móvil no se prueba en GitHub Actions.' },
    J_AI: { title: 'Job ai-tests', tipo: 'Job de CI', descripcion: 'Python 3.11. Instala con Poetry y ejecuta pytest -v en services/ai.', tecnologia: 'pytest + Poetry', ubicacion: '.github/workflows/ci.yml', estado: 'hecho' },
    PG_SVC: { title: 'Servicio postgis en CI', tipo: 'Servicio de CI', descripcion: 'postgis/postgis:16-3.4 con base bidclean_test.', ubicacion: '.github/workflows/ci.yml', estado: 'hecho' },
    REDIS_SVC: { title: 'Servicio redis en CI', tipo: 'Servicio de CI', descripcion: 'redis:7-alpine con healthcheck.', ubicacion: '.github/workflows/ci.yml', estado: 'hecho' },
    CM: { title: 'Codemagic', tipo: 'CI móvil', descripcion: 'Previsto para validar builds nativos. No existe codemagic.yaml en el repositorio.', tecnologia: 'Codemagic', ubicacion: 'pendiente', estado: 'falta' },
    EASB: { title: 'Expo EAS', tipo: 'Build móvil', descripcion: 'Perfiles definidos en eas.json. Es el mecanismo real de build móvil hoy.', tecnologia: 'EAS Build', ubicacion: 'apps/mobile/eas.json', estado: 'externo' },
    NPMW: { title: 'npm workspaces', tipo: 'Gestor de paquetes', descripcion: 'package.json raíz declara apps/*, services/* y packages/*. No existe pnpm-workspace.yaml; el proyecto usa npm 10 y Node 20 o superior.', tecnologia: 'npm', ubicacion: 'package.json', estado: 'hecho', nota: 'La documentación que menciona pnpm no coincide con el repositorio.' },
    JEST: { title: 'Jest', tipo: 'Pruebas', descripcion: 'Pruebas de unidad y de propiedades (fast-check) en API, app móvil y herramientas.', tecnologia: 'Jest + fast-check', ubicacion: 'services/api, apps/mobile, tools', estado: 'hecho' },
    PYTEST: { title: 'pytest', tipo: 'Pruebas', descripcion: 'Pruebas del servicio de IA.', tecnologia: 'pytest', ubicacion: 'services/ai', estado: 'hecho' },
    LINT: { title: 'ESLint', tipo: 'Lint', descripcion: 'Script npm run lint en cada workspace. En CI solo se aplica a la API.', tecnologia: 'ESLint', ubicacion: 'package.json', estado: 'parcial', nota: 'No se ejecuta sobre la app móvil en CI.' },
    PRETTIER: { title: 'Prettier', tipo: 'Formato', descripcion: 'npm run format y format:check con .prettierrc.', tecnologia: 'Prettier', ubicacion: '.prettierrc', estado: 'hecho' },
    TSC: { title: 'Typecheck', tipo: 'Tipos', descripcion: 'npm run typecheck en cada workspace.', tecnologia: 'TypeScript', ubicacion: 'package.json', estado: 'hecho' },
    ENVEX: { title: '.env.example', tipo: 'Configuración', descripcion: 'Catálogo de variables de entorno con valores de ejemplo. Se reconcilia con tools/config-inventory.', ubicacion: '.env.example', estado: 'hecho' },
    ADR: { title: 'ADR 001 a 022', tipo: 'Documentación', descripcion: 'Veintidós decisiones de arquitectura, una por archivo, desde 001-react-native-expo.md.', ubicacion: 'docs/ADR', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Comandos útiles (PowerShell)',
      html: '<pre>npm run lint\nnpm run typecheck\nnpm run test:api\nnpm run format:check</pre>',
    },
  ],
});
