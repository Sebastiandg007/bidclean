/**
 * 11-build-movil.js — pipeline de build con EAS: configuración, variables de entorno y estado del APK.
 */
BidCleanArch.registerTab({
  id: 'build-movil',
  group: 'Frontend',
  order: 110,
  title: 'Build móvil (EAS)',
  summary:
    'La app usa módulos nativos, así que no corre en Expo Go. El APK se compila en la nube con EAS Build a partir de app.config.js, eas.json y variables de entorno. '
    + 'El build #13 (commit f81c440) terminó bien; falta probarlo en un teléfono real.',
  diagrams: [
    {
      title: 'Pipeline de build',
      description: 'Del código fuente al APK instalable.',
      code: `flowchart LR
  SRC["Código<br/>apps/mobile"]
  APPCFG["app.config.js<br/>config dinámica Expo"]
  EASJSON["eas.json<br/>perfiles de build"]
  BUILDMD["BUILD.md<br/>guía de pasos"]
  METRO["metro.config.js<br/>monorepo"]
  BABEL["babel.config.js<br/>rutas Expo Router"]
  ENVVARS["Variables de entorno EAS<br/>secretos y EXPO_PUBLIC"]
  EASCLI["eas build<br/>--profile preview"]
  EASCLOUD["EAS Build<br/>nube de Expo"]
  GRADLE["Gradle<br/>SDK nativo Mapbox"]
  APK["APK<br/>build 13"]
  PHONE["Teléfono real"]
  SRC --> EASCLI
  APPCFG --> EASCLI
  EASJSON --> EASCLI
  BUILDMD -.->|documenta| EASCLI
  ENVVARS --> EASCLOUD
  EASCLI --> EASCLOUD
  METRO --> EASCLOUD
  BABEL --> EASCLOUD
  EASCLOUD --> GRADLE --> APK
  APK -->|instalar| PHONE`,
    },
    {
      title: 'Perfiles, variables y estado de pruebas',
      description: 'Qué variable alimenta cada parte y qué se ha comprobado del APK.',
      code: `flowchart TB
  subgraph PERFILES["Perfiles de eas.json"]
    P_DEV["development<br/>dev client, APK interno"]
    P_PREVIEW["preview<br/>APK interno"]
    P_PROD["production<br/>AAB, autoIncrement"]
  end
  subgraph VARIABLES["Variables de entorno"]
    V_DLTOKEN["MAPBOX_DOWNLOAD_TOKEN<br/>sk.* solo build"]
    V_MAPTOKEN["EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN<br/>pk.* runtime"]
    V_API["EXPO_PUBLIC_API_URL"]
    V_KC["EXPO_PUBLIC_KEYCLOAK_URL<br/>REALM, CLIENT_ID"]
  end
  subgraph RESULTADOS["Estado del APK"]
    R_BUILD13["Build 13<br/>commit f81c440 exitoso"]
    R_EMU["Emulador<br/>cierre gráfico EGL"]
    R_PHONE["Prueba en teléfono real"]
    R_NEWARCH["Nueva Arquitectura<br/>desactivada"]
  end
  V_DLTOKEN -->|Gradle| P_PREVIEW
  V_MAPTOKEN --> P_PREVIEW
  V_API --> P_PREVIEW
  V_KC --> P_PREVIEW
  P_PREVIEW --> R_BUILD13
  R_BUILD13 --> R_EMU
  R_BUILD13 --> R_PHONE
  R_NEWARCH -.->|evita pantalla en blanco| R_BUILD13
  P_DEV -.-> P_PROD`,
    },
  ],
  nodes: {
    SRC: { title: 'Código de la app', tipo: 'Fuente', descripcion: 'Proyecto Expo dentro del monorepo.', tecnologia: 'React Native 0.76 + Expo SDK 52', ubicacion: 'apps/mobile', estado: 'hecho' },
    APPCFG: { title: 'app.config.js', tipo: 'Configuración', descripcion: 'Config dinámica de Expo: nombre, slug, bundle id tech.bidclean.app, plugins nativos (Mapbox, AdMob, Stripe, cámara, ubicación, biometría) y newArchEnabled en false.', tecnologia: 'Expo config', ubicacion: 'apps/mobile/app.config.js', consume: ['MAPBOX_DOWNLOAD_TOKEN', 'EXPO_PUBLIC_*'], estado: 'hecho' },
    EASJSON: { title: 'eas.json', tipo: 'Configuración', descripcion: 'Perfiles development, preview y production. El perfil preview fija EXPO_PUBLIC_API_URL y EXPO_ROUTER_APP_ROOT.', tecnologia: 'EAS CLI', ubicacion: 'apps/mobile/eas.json', estado: 'hecho' },
    BUILDMD: { title: 'BUILD.md', tipo: 'Documentación', descripcion: 'Guía en español: requisitos, variables y pasos para generar el APK.', ubicacion: 'apps/mobile/BUILD.md', estado: 'hecho' },
    METRO: { title: 'metro.config.js', tipo: 'Configuración', descripcion: 'Monorepo watchFolders y resolución de una sola copia de react, react-native, safe-area-context, screens y reanimated. Evita el cierre por RNCSafeAreaProvider duplicado.', ubicacion: 'apps/mobile/metro.config.js', estado: 'hecho' },
    BABEL: { title: 'babel.config.js', tipo: 'Configuración', descripcion: 'Plugin propio que sustituye las variables EXPO_ROUTER_* con rutas relativas, porque expo-router no está hoisted en el monorepo.', ubicacion: 'apps/mobile/babel.config.js', estado: 'hecho' },
    ENVVARS: { title: 'Variables de entorno EAS', tipo: 'Secretos y variables', descripcion: 'MAPBOX_DOWNLOAD_TOKEN, EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN, EXPO_PUBLIC_API_URL y EXPO_PUBLIC_KEYCLOAK_URL, REALM y CLIENT_ID.', tecnologia: 'EAS secrets', ubicacion: 'expo.dev (proyecto)', estado: 'parcial', nota: 'BUILD.md no documenta aún las variables de Keycloak.' },
    EASCLI: { title: 'eas build', tipo: 'Comando', descripcion: 'eas build --platform android --profile preview, ejecutado desde apps/mobile.', tecnologia: 'eas-cli', ubicacion: 'apps/mobile', estado: 'hecho' },
    EASCLOUD: { title: 'EAS Build', tipo: 'Servicio externo', descripcion: 'Compila en la nube de Expo en unos 10 a 20 minutos y entrega enlace y QR.', tecnologia: 'Expo EAS', ubicacion: 'expo.dev', estado: 'externo' },
    GRADLE: { title: 'Gradle', tipo: 'Compilación nativa', descripcion: 'Descarga el SDK nativo de Mapbox; sin el token sk.* falla con HTTP 401.', tecnologia: 'Gradle', ubicacion: 'EAS Build', consume: ['MAPBOX_DOWNLOAD_TOKEN'], estado: 'externo' },
    APK: { title: 'APK', tipo: 'Artefacto', descripcion: 'APK instalable del perfil preview, build número 13.', ubicacion: 'expo.dev', estado: 'hecho' },
    PHONE: { title: 'Teléfono real', tipo: 'Dispositivo', descripcion: 'Instalación del APK en Android o Samsung Galaxy.', estado: 'parcial', nota: 'Prueba pendiente.' },
    P_DEV: { title: 'Perfil development', tipo: 'Perfil EAS', descripcion: 'Dev client con APK interno para desarrollo con recarga en caliente.', ubicacion: 'apps/mobile/eas.json', estado: 'hecho' },
    P_PREVIEW: { title: 'Perfil preview', tipo: 'Perfil EAS', descripcion: 'APK interno para ver la app sin pasar por una tienda.', ubicacion: 'apps/mobile/eas.json', estado: 'hecho' },
    P_PROD: { title: 'Perfil production', tipo: 'Perfil EAS', descripcion: 'AAB para Google Play y Samsung Store con autoIncrement.', ubicacion: 'apps/mobile/eas.json', estado: 'parcial', nota: 'La sección submit está vacía.' },
    V_DLTOKEN: { title: 'MAPBOX_DOWNLOAD_TOKEN', tipo: 'Secreto de build', descripcion: 'Token secreto sk.* con scope DOWNLOADS:READ. Único bloqueante real del build.', ubicacion: 'EAS secrets', estado: 'hecho' },
    V_MAPTOKEN: { title: 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN', tipo: 'Variable de runtime', descripcion: 'Token público pk.* para que el mapa se vea en la app.', ubicacion: 'EAS env', estado: 'parcial', nota: 'Vacío por defecto.' },
    V_API: { title: 'EXPO_PUBLIC_API_URL', tipo: 'Variable de runtime', descripcion: 'Backend que consume la app. Por defecto https://api.bidclean.tech.', ubicacion: 'apps/mobile/eas.json (preview)', estado: 'hecho' },
    V_KC: { title: 'Variables de Keycloak', tipo: 'Variable de runtime', descripcion: 'EXPO_PUBLIC_KEYCLOAK_URL, EXPO_PUBLIC_KEYCLOAK_REALM y EXPO_PUBLIC_KEYCLOAK_CLIENT_ID para el login OIDC.', ubicacion: 'EAS env', estado: 'parcial', nota: 'No aparecen en BUILD.md.' },
    R_BUILD13: { title: 'Build 13 exitoso', tipo: 'Resultado', descripcion: 'Build #13 del commit f81c440 terminó correctamente.', estado: 'hecho' },
    R_EMU: { title: 'Prueba en emulador', tipo: 'Resultado', descripcion: 'La app se cerró por un fallo gráfico del emulador (EGL_KHR_swap_buffers_with_damage). No hubo errores de JavaScript.', estado: 'alerta', nota: 'Causa gráfica del emulador, no del código.' },
    R_PHONE: { title: 'Prueba en teléfono real', tipo: 'Resultado', descripcion: 'Pendiente: confirmar que la app arranca y muestra la pantalla de login en un dispositivo físico.', estado: 'parcial', nota: 'Pendiente.' },
    R_NEWARCH: { title: 'Nueva Arquitectura desactivada', tipo: 'Decisión', descripcion: 'En RN 0.76 fallaba en silencio al arrancar con LiveKit/WebRTC y Mapbox. Se reactiva cuando todas las dependencias nativas la soporten.', ubicacion: 'apps/mobile/app.config.js', estado: 'parcial', nota: 'Desactivada de forma temporal.' },
  },
  sections: [
    {
      title: 'Comando de build',
      html: '<pre><code>cd apps/mobile\neas build --platform android --profile preview</code></pre>'
        + '<p>Requiere cuenta Expo, <code>eas login</code>, <code>eas init</code> y el secreto <code>MAPBOX_DOWNLOAD_TOKEN</code>.</p>',
    },
  ],
});
