/**
 * 35-tema.js — sistema de temas oscuro, claro y del sistema: tokens semánticos, proveedor sin parpadeo, cromo nativo y pantalla de apariencia.
 */
BidCleanArch.registerTab({
  id: 'tema',
  group: 'Experiencia',
  order: 350,
  title: 'Tema oscuro y claro',
  summary:
    'Sistema de tema centralizado de la app móvil (ADR-020): modo <b>oscuro</b> por defecto y de referencia, modo <b>claro</b> cálido y la opción <b>Sistema</b>. '
    + 'Cadena primitivos, tokens semánticos, tema, proveedor y pantallas: las pantallas consumen <code>theme.*</code> mediante <code>useTheme()</code> o <code>makeStyles</code> y nunca un valor hexadecimal. <code>primitives.ts</code> es el único lugar con literales de color y <code>scripts/hex-guard.js</code> lo hace cumplir en CI. '
    + 'El <b>modo</b> (DARK, LIGHT, SYSTEM) se persiste en SecureStore; el <b>tema resuelto</b> (DARK o LIGHT) es lo que se dibuja. El proveedor no pinta nada temático hasta resolver modo y esquema del SO (sin parpadeo), con un <b>failsafe de 2 s</b> que abre la compuerta con el tema por defecto. '
    + 'El color de acento se usa solo en acciones y estados activos, nunca como superficie. '
    + 'Estado: implementado y con pruebas; la tipografía de marca aún no se carga y una prueba de useThemedStyles es inestable bajo carga.',
  diagrams: [
    {
      title: 'De los primitivos a la pantalla',
      description: 'Los primitivos alimentan dos temas con la misma forma de tokens. El proveedor resuelve el modo con el esquema del sistema, sostiene el splash, aplica el cromo nativo y expone el tema por contexto a los hooks.',
      code: `flowchart TB
  PRIM_T["primitives.ts<br/>único hogar de los literales de color"]
  TOK_T["tokens.ts<br/>SemanticTokens, ThemeMode, ResolvedTheme"]
  OSCURO_T["dark.theme.ts<br/>mapeo semántico a primitivos, sin hex"]
  CLARO_T["light.theme.ts<br/>mapeo semántico, paridad cálida"]
  TEMAS_T["themes.ts<br/>THEMES y assertTokenParity"]
  CONTRASTE_T["contrast.ts<br/>razón de contraste WCAG 2.1 para pruebas"]
  ALMACEN_T["useThemeStore<br/>Zustand, versión y modo, última escritura gana"]
  SEGURO_T[("expo-secure-store<br/>bidclean.theme.preference")]
  SO_T["useColorScheme<br/>esquema del sistema operativo"]
  RESUELVE_T["resolveTheme<br/>modo y esquema a tema resuelto"]
  PROV_T["ThemeProvider<br/>compuerta, contexto memoizado"]
  GATE_T{"¿Resuelto el modo<br/>y el esquema del SO?"}
  FAIL_T["Failsafe de 2 s<br/>THEME_BOOTSTRAP_TIMEOUT_MS"]
  SPLASH_T["splash.ts<br/>retiene el splash nativo"]
  CHROME_T["useSystemChromeTheme<br/>barra de estado, navegación y teclado"]
  NAV_T["NavigationThemeBridge<br/>tema de React Navigation con fonts"]
  FUENTE_T["Tipografía de marca<br/>Space Grotesk o similar"]
  USETHEME_T["useTheme<br/>theme, mode, resolvedTheme, setMode"]
  ESTILOS_T["useThemedStyles<br/>makeStyles memoizado por tema resuelto"]
  PANTALLAS_T["Pantallas y componentes<br/>solo theme punto token"]
  HEXGUARD_T["hex-guard.js<br/>prohíbe literales fuera de primitives"]

  PRIM_T --> OSCURO_T
  PRIM_T --> CLARO_T
  TOK_T --> OSCURO_T
  TOK_T --> CLARO_T
  OSCURO_T --> TEMAS_T
  CLARO_T --> TEMAS_T
  CONTRASTE_T -.->|verifica AA en pruebas| TEMAS_T
  ALMACEN_T <--> SEGURO_T
  ALMACEN_T --> RESUELVE_T
  SO_T --> RESUELVE_T
  RESUELVE_T --> PROV_T
  TEMAS_T --> PROV_T
  PROV_T --> GATE_T
  GATE_T -->|no| SPLASH_T
  GATE_T -->|sí| CHROME_T
  GATE_T -->|sí| NAV_T
  FAIL_T -->|abre con el tema por defecto| GATE_T
  FUENTE_T -.->|pendiente| NAV_T
  PROV_T --> USETHEME_T
  USETHEME_T --> ESTILOS_T
  USETHEME_T --> PANTALLAS_T
  ESTILOS_T --> PANTALLAS_T
  HEXGUARD_T -.->|CI sobre src| PANTALLAS_T`,
    },
    {
      title: 'Pantalla de apariencia y cambio de modo',
      description: 'El usuario elige Oscuro, Claro o Sistema. El cambio se persiste en el dispositivo y toda la app, incluido el cromo nativo, se vuelve a dibujar sin reiniciar.',
      code: `flowchart LR
  AJUSTES_A["AppearanceSettingsScreen<br/>pantalla de apariencia"]
  SELECTOR_A["ThemeModeSelector<br/>control segmentado Oscuro, Claro, Sistema"]
  I18N_A["i18n appearance<br/>en y es con paridad"]
  SETMODE_A["setMode<br/>ThemeMode.DARK, LIGHT o SYSTEM"]
  PERSISTE_A[("SecureStore<br/>modo persistido")]
  DEC_MODO{"¿El modo es SYSTEM?"}
  USA_SO["Sigue el esquema del SO<br/>cambia con el sistema"]
  FIJO_A["Tema fijo<br/>DARK o LIGHT"]
  RENDER_A["Re-render de la app<br/>y del cromo nativo"]
  PRUEBA_A["useThemedStyles.spec.tsx<br/>prueba inestable bajo carga"]

  AJUSTES_A --> SELECTOR_A
  AJUSTES_A --> I18N_A
  SELECTOR_A -->|toca una opción| SETMODE_A
  SETMODE_A --> PERSISTE_A
  SETMODE_A --> DEC_MODO
  DEC_MODO -->|sí| USA_SO
  DEC_MODO -->|no| FIJO_A
  USA_SO --> RENDER_A
  FIJO_A --> RENDER_A
  PRUEBA_A -.->|cubre el recálculo por modo| RENDER_A`,
    },
  ],
  nodes: {
    PRIM_T: { title: 'primitives.ts', tipo: 'Módulo de tema', descripcion: 'Único lugar con literales de color: semillas de marca y valores por modo. Acento menta #00F5D4, fondo oscuro #0B0C10, tarjetas oscuras #1F2833 y fondo claro cálido #F5F2EB (aprox.).', ubicacion: 'apps/mobile/src/theme/primitives.ts', adr: 'ADR-020', estado: 'hecho' },
    TOK_T: { title: 'tokens.ts', tipo: 'Módulo de tema', descripcion: 'Interfaz SemanticTokens y enums ThemeMode (DARK, LIGHT, SYSTEM) y ResolvedTheme (DARK, LIGHT). SYSTEM es un modo, nunca un tema resuelto. Todo token existe en ambos temas por compilación.', ubicacion: 'apps/mobile/src/theme/tokens.ts', estado: 'hecho' },
    OSCURO_T: { title: 'dark.theme.ts', tipo: 'Módulo de tema', descripcion: 'darkTheme: SemanticTokens. Solo mapea token semántico a primitivo (sin hex). Es el tema por defecto y de referencia (DEFAULT_MODE = DARK).', ubicacion: 'apps/mobile/src/theme/dark.theme.ts', estado: 'hecho' },
    CLARO_T: { title: 'light.theme.ts', tipo: 'Módulo de tema', descripcion: 'lightTheme con paridad cálida respecto al oscuro; el blanco puro se evita a favor de un tono off-white.', ubicacion: 'apps/mobile/src/theme/light.theme.ts', estado: 'hecho' },
    TEMAS_T: { title: 'themes.ts', tipo: 'Módulo de tema', descripcion: 'THEMES: Record de ResolvedTheme a SemanticTokens y assertTokenParity() como guarda en tiempo de ejecución.', ubicacion: 'apps/mobile/src/theme/themes.ts', estado: 'hecho' },
    CONTRASTE_T: { title: 'contrast.ts', tipo: 'Utilidad', descripcion: 'Cálculo puro de razón de contraste WCAG 2.1 usado por las pruebas para exigir AA en pares de texto y UI esencial en ambos modos. Excluido del hex-guard por no definir colores.', ubicacion: 'apps/mobile/src/theme/contrast.ts', estado: 'hecho' },
    ALMACEN_T: { title: 'useThemeStore', tipo: 'Store Zustand', descripcion: 'Carga y persiste { version, mode } con respaldo seguro a DARK, tiempo límite de arranque y semántica de última escritura gana.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/theme/useThemeStore.ts', adr: 'ADR-003', estado: 'hecho' },
    SEGURO_T: { title: 'expo-secure-store', tipo: 'Almacenamiento local', descripcion: 'Persistencia en el dispositivo bajo la clave bidclean.theme.preference (PREFERENCE_VERSION = 1).', tecnologia: 'expo-secure-store', ubicacion: 'apps/mobile/src/theme/theme.constants.ts', estado: 'externo' },
    SO_T: { title: 'useColorScheme', tipo: 'API de React Native', descripcion: 'Esquema claro u oscuro reportado por el sistema operativo.', tecnologia: 'React Native', ubicacion: 'apps/mobile/src/theme/ThemeProvider.tsx', estado: 'externo' },
    RESUELVE_T: { title: 'resolveTheme', tipo: 'Función pura', descripcion: 'resolve(mode, osScheme) devuelve el tema resuelto; con SYSTEM sigue al sistema.', ubicacion: 'apps/mobile/src/theme/resolveTheme.ts', estado: 'hecho' },
    PROV_T: { title: 'ThemeProvider', tipo: 'Proveedor React', descripcion: 'Compuerta de resolución sin parpadeo (FOUC), retención del splash, cromo nativo y contexto memoizado. Fuera de un proveedor, useTheme devuelve el valor DARK por defecto.', ubicacion: 'apps/mobile/src/theme/ThemeProvider.tsx', estado: 'hecho' },
    GATE_T: { title: '¿Resuelto el modo y el esquema?', tipo: 'Decisión', descripcion: 'No se renderiza nada temático hasta resolver (modo persistido, esquema del SO).', ubicacion: 'apps/mobile/src/theme/ThemeProvider.tsx', estado: 'hecho' },
    FAIL_T: { title: 'Failsafe de 2 s', tipo: 'Temporizador', descripcion: 'setTimeout de 2000 ms (THEME_BOOTSTRAP_TIMEOUT_MS): si la resolución no terminó, la compuerta se abre con el tema por defecto para que la app nunca quede en blanco.', ubicacion: 'apps/mobile/src/theme/ThemeProvider.tsx', estado: 'hecho' },
    SPLASH_T: { title: 'splash.ts', tipo: 'Utilidad', descripcion: 'Envoltura defensiva de expo-splash-screen: preventAutoHide y hide, sin efecto si el paquete no está disponible.', tecnologia: 'expo-splash-screen', ubicacion: 'apps/mobile/src/theme/splash.ts', estado: 'hecho' },
    CHROME_T: { title: 'useSystemChromeTheme', tipo: 'Hook móvil', descripcion: 'Aplica el tema resuelto a la barra de estado, la barra de navegación de Android y la apariencia del teclado. expo-navigation-bar se carga con require protegido.', tecnologia: 'expo-status-bar, expo-navigation-bar', ubicacion: 'apps/mobile/src/theme/useSystemChromeTheme.ts', estado: 'hecho' },
    NAV_T: { title: 'NavigationThemeBridge', tipo: 'Componente móvil', descripcion: 'Convierte el tema resuelto al tema de React Navigation 7 y pasa fonts (regular, medium, bold, heavy) con DefaultTheme.fonts o fuentes del sistema. Sin fonts, el render falla con Cannot read property regular of undefined.', tecnologia: 'React Navigation 7', ubicacion: 'apps/mobile/src/theme/NavigationThemeBridge.tsx', estado: 'hecho' },
    FUENTE_T: { title: 'Tipografía de marca', tipo: 'Recurso pendiente', descripcion: 'La identidad define una fuente con personalidad (Space Grotesk, Cabinet Grotesk o Satoshi). Hoy el puente de navegación usa las fuentes del sistema y no hay carga de fuentes personalizadas en la app.', ubicacion: 'apps/mobile/src/theme/NavigationThemeBridge.tsx', estado: 'falta', nota: 'No hay expo-font ni useFonts en la app; la fuente de marca no se carga.' },
    USETHEME_T: { title: 'useTheme', tipo: 'Hook móvil', descripcion: 'Devuelve { theme, mode, resolvedTheme, setMode }; se consume en toda la app.', ubicacion: 'apps/mobile/src/theme/useTheme.ts', estado: 'hecho' },
    ESTILOS_T: { title: 'useThemedStyles', tipo: 'Hook móvil', descripcion: 'makeStyles(factory) devuelve un hook que crea el StyleSheet con useMemo y se recalcula una sola vez por cambio de tema resuelto. Reemplaza el patrón const COLORS más StyleSheet.create.', ubicacion: 'apps/mobile/src/theme/useThemedStyles.ts', estado: 'parcial', nota: 'La prueba useThemedStyles.spec.tsx agota el tiempo límite de forma intermitente bajo carga; el código funciona y la inestabilidad es de la prueba.' },
    PANTALLAS_T: { title: 'Pantallas y componentes', tipo: 'Consumidores', descripcion: 'Usan tokens como theme.background, theme.surface, theme.accent, theme.textPrimary o theme.border; en props en línea leen theme desde useTheme().', ubicacion: 'apps/mobile/src', estado: 'hecho' },
    HEXGUARD_T: { title: 'hex-guard.js', tipo: 'Guarda de CI', descripcion: 'scripts/hex-guard.js (npm run hex-guard y prueba Jest) falla si aparece un literal de color fuera de primitives.ts. Exenciones documentadas: contrast.ts y los estilos de mapa de Mapbox.', ubicacion: 'apps/mobile/scripts/hex-guard.js', estado: 'hecho' },
    AJUSTES_A: { title: 'AppearanceSettingsScreen', tipo: 'Pantalla móvil', descripcion: 'Pantalla de ajustes de apariencia con selector y etiquetas i18n.', ubicacion: 'apps/mobile/src/screens/appearance/AppearanceSettingsScreen.tsx', estado: 'parcial', nota: 'Falta enlazarla desde una fila de SettingsScreen; es un cambio de navegación pendiente del dueño del perfil.' },
    SELECTOR_A: { title: 'ThemeModeSelector', tipo: 'Componente móvil', descripcion: 'Control segmentado ligado a ThemeMode; la opción activa usa el token accent como énfasis, nunca como superficie.', ubicacion: 'apps/mobile/src/screens/appearance/components/ThemeModeSelector.tsx', estado: 'hecho' },
    I18N_A: { title: 'i18n · appearance', tipo: 'Recursos de traducción', descripcion: 'Claves appearance.title y appearance.mode.dark, light y system en en y es (Apariencia, Oscuro, Claro, Sistema). Paridad exigida por una prueba de propiedades.', ubicacion: 'apps/mobile/src/i18n/locales', estado: 'hecho' },
    SETMODE_A: { title: 'setMode', tipo: 'Acción', descripcion: 'Persiste el modo en el dispositivo y vuelve a dibujar la app de inmediato, sin reiniciar.', ubicacion: 'apps/mobile/src/theme/useThemeStore.ts', estado: 'hecho' },
    PERSISTE_A: { title: 'SecureStore · modo', tipo: 'Almacenamiento local', descripcion: 'Preferencia versionada del usuario.', tecnologia: 'expo-secure-store', ubicacion: 'apps/mobile/src/theme/theme.constants.ts', estado: 'externo' },
    DEC_MODO: { title: '¿El modo es SYSTEM?', tipo: 'Decisión', descripcion: 'Distingue seguir al sistema operativo de un tema fijo.', ubicacion: 'apps/mobile/src/theme/resolveTheme.ts', estado: 'hecho' },
    USA_SO: { title: 'Sigue el esquema del SO', tipo: 'Comportamiento', descripcion: 'El tema cambia cuando cambia el esquema del sistema.', estado: 'hecho' },
    FIJO_A: { title: 'Tema fijo', tipo: 'Comportamiento', descripcion: 'El usuario fijó DARK o LIGHT; ignora el sistema.', estado: 'hecho' },
    RENDER_A: { title: 'Re-render de la app y del cromo', tipo: 'Comportamiento', descripcion: 'Los estilos memoizados se recalculan una vez y el cromo nativo se actualiza.', estado: 'hecho' },
    PRUEBA_A: { title: 'useThemedStyles.spec.tsx', tipo: 'Prueba Jest', descripcion: 'Valida que los estilos derivan de tokens y se memoizan por tema resuelto. Presenta tiempo límite intermitente bajo carga.', ubicacion: 'apps/mobile/src/theme/__tests__/useThemedStyles.spec.tsx', estado: 'parcial', nota: 'Prueba inestable: agota el tiempo límite bajo carga; pasa de forma aislada.' },
  },
  sections: [
    {
      title: 'Paleta de marca por modo',
      html: `<table>
<thead><tr><th>Uso</th><th>Modo oscuro</th><th>Modo claro</th></tr></thead>
<tbody>
<tr><td>Acento (solo acciones y estados activos)</td><td><code>#00F5D4</code></td><td>Mismo acento, nunca como superficie</td></tr>
<tr><td>Fondo</td><td><code>#0B0C10</code></td><td><code>#F5F2EB</code> aprox. (off-white cálido)</td></tr>
<tr><td>Tarjetas y contenedores</td><td><code>#1F2833</code></td><td>Superficies claras definidas en primitives.ts</td></tr>
<tr><td>Texto principal</td><td><code>#FFFFFF</code></td><td>Texto oscuro con contraste AA</td></tr>
</tbody></table>
<p>Los valores se definen solo en <code>primitives.ts</code>; el resto del código los usa por nombre de token.</p>`,
    },
    {
      title: 'Reglas del sistema de tema',
      html: `<ul>
<li>Sin hex en pantallas: todo color sale de <code>theme.*</code> (hex-guard en CI).</li>
<li><code>mode</code> es distinto de <code>resolvedTheme</code>: el modo se persiste, el tema resuelto se dibuja.</li>
<li>Oscuro es el valor por defecto y la referencia; claro es paridad aditiva y ambos cumplen WCAG 2.1 AA.</li>
<li>Sin parpadeo: nada temático se dibuja hasta resolver, con un failsafe de 2 s.</li>
<li>Constantes: <code>DEFAULT_MODE</code>, <code>PREFERENCE_STORAGE_KEY</code>, <code>PREFERENCE_VERSION</code> y <code>THEME_BOOTSTRAP_TIMEOUT_MS</code> en <code>theme.constants.ts</code>.</li>
</ul>`,
    },
  ],
});
