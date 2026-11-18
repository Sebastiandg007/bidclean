/**
 * 00-credenciales.js — credenciales expuestas en archivos versionados.
 * Solo nombres de variables y ubicaciones. NUNCA se muestran valores.
 */
BidCleanArch.registerTab({
  id: 'credenciales',
  group: '⚠ Alertas',
  order: 0,
  title: 'Credenciales expuestas',
  summary:
    'Credenciales detectadas en archivos versionados en git. Solo se muestra el <strong>nombre de la variable</strong> y dónde está; '
    + 'el valor nunca se muestra. Fuente: <code>tools/config-inventory</code> (<code>--check</code>: 283 variables, 117 hallazgos, 3 bloqueantes).',
  diagrams: [
    {
      title: 'Dónde está cada credencial',
      description: 'Rojo = expuesta en un archivo versionado. Amarillo = falso positivo (dato de prueba). Azul = guardada fuera del repositorio.',
      code: `flowchart LR
  REPO["Repositorio git<br/>Sebastiandg007/bidclean"]
  MCP[".kiro/settings/mcp.json<br/>(línea 9)"]
  RC_KEY["RevenueCat Secret API Key<br/>header Authorization: Bearer"]
  PROBES["tools/full-audit/__tests__/<br/>probes.property.spec.ts"]
  FAKE_AWS["Patrón AWS (L59)<br/>dato falso de prueba"]
  FAKE_GEN["Patrón genérico (L61)<br/>dato falso de prueba"]
  ENV[".env local<br/>(ignorado por git)"]
  EAS["Variables de entorno EAS<br/>(expo.dev)"]
  EXPO_TOKEN["EXPO_TOKEN"]
  MAPBOX_DL["MAPBOX_DOWNLOAD_TOKEN"]
  MAPBOX_PK["EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN"]
  REPO --> MCP --> RC_KEY
  REPO --> PROBES
  PROBES --> FAKE_AWS
  PROBES --> FAKE_GEN
  ENV --> EXPO_TOKEN
  ENV --> MAPBOX_PK
  EAS --> MAPBOX_DL
  EAS --> MAPBOX_PK`,
    },
  ],
  nodes: {
    REPO: { title: 'Repositorio git', tipo: 'Control de versiones', descripcion: 'Repositorio en GitHub. Hoy es público; se pasará a privado.', ubicacion: 'github.com/Sebastiandg007/bidclean', estado: 'alerta' },
    MCP: { title: '.kiro/settings/mcp.json', tipo: 'Archivo versionado', descripcion: 'Configuración del servidor MCP "revenuecat". El archivo está en git (2 commits).', ubicacion: '.kiro/settings/mcp.json', estado: 'alerta' },
    RC_KEY: { title: 'RevenueCat Secret API Key', tipo: 'Credencial expuesta', descripcion: 'Clave secreta de la API de RevenueCat dentro del header Authorization del servidor MCP. Valor no mostrado.', ubicacion: '.kiro/settings/mcp.json L9', nota: 'Decisión del dueño: se mantiene (repositorio privado).', estado: 'alerta' },
    PROBES: { title: 'probes.property.spec.ts', tipo: 'Test', descripcion: 'Tests de propiedades del escáner de secretos del full-audit.', ubicacion: 'tools/full-audit/__tests__/probes.property.spec.ts', estado: 'parcial' },
    FAKE_AWS: { title: 'Patrón AWS (falso positivo)', tipo: 'Dato de prueba', descripcion: 'Cadena falsa con forma de clave AWS, usada a propósito para probar el detector.', ubicacion: 'probes.property.spec.ts L59', estado: 'parcial' },
    FAKE_GEN: { title: 'Patrón genérico (falso positivo)', tipo: 'Dato de prueba', descripcion: 'Cadena falsa con forma de secreto genérico, usada a propósito para probar el detector.', ubicacion: 'probes.property.spec.ts L61', estado: 'parcial' },
    ENV: { title: '.env local', tipo: 'Archivo no versionado', descripcion: 'Variables locales; está en .gitignore, no se sube al repositorio.', ubicacion: '.env', estado: 'externo' },
    EAS: { title: 'Variables EAS', tipo: 'Secretos del build', descripcion: 'Variables guardadas en Expo (EAS) para los builds en la nube.', ubicacion: 'expo.dev → proyecto bidclean → Environment variables', estado: 'externo' },
    EXPO_TOKEN: { title: 'EXPO_TOKEN', tipo: 'Token de acceso', descripcion: 'Token de la cuenta de Expo usado por el CLI de EAS. No está en archivos versionados.', ubicacion: 'variable de sesión / .env', nota: 'Se compartió por chat: rotarlo cuando sea posible.', estado: 'externo' },
    MAPBOX_DL: { title: 'MAPBOX_DOWNLOAD_TOKEN', tipo: 'Token secreto (sk.*)', descripcion: 'Token para descargar el SDK nativo de Mapbox en el build.', ubicacion: 'EAS env', estado: 'externo' },
    MAPBOX_PK: { title: 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN', tipo: 'Token público (pk.*)', descripcion: 'Token público de Mapbox embebido en la app. No está en archivos versionados.', ubicacion: '.env / EAS env', estado: 'externo' },
  },
  sections: [
    {
      title: 'Resumen',
      html: `<div class="alert-box">
        <p><strong>1 credencial real expuesta</strong> en un archivo versionado: <code>RevenueCat Secret API Key</code> en <code>.kiro/settings/mcp.json</code> (línea 9).</p>
        <p><strong>2 falsos positivos</strong> intencionales en <code>tools/full-audit/__tests__/probes.property.spec.ts</code> (líneas 59 y 61).</p>
        <p>No hay otros tokens (Expo, Mapbox, Stripe, AWS, GitHub) en archivos versionados.</p></div>`,
    },
    {
      title: 'Si el repositorio se comparte',
      html: `<ul>
        <li>Pasar el repositorio a privado antes de compartirlo.</li>
        <li>Rotar la clave de RevenueCat y el <code>EXPO_TOKEN</code> cuando se pase a producción.</li>
        <li>Mover el valor de <code>mcp.json</code> a una variable de entorno o a <code>~/.kiro/settings/mcp.json</code> (fuera del repositorio).</li></ul>`,
    },
  ],
});
