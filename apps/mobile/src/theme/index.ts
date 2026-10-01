/**
 * theme/index.ts — the app-wide theming contract (explicit exports).
 *
 * Every mobile screen/component consumes theming through this barrel: the provider, the `useTheme`
 * hook, the `makeStyles`/`useThemedStyles` migration primitive, the navigation bridge, and the
 * token/enum TYPES. Consumers import types only — never raw palette values (colors flow through
 * `useTheme()` / `useThemedStyles`).
 */

export { ThemeProvider } from './ThemeProvider';
export { useTheme } from './useTheme';
export { makeStyles } from './useThemedStyles';
export { NavigationThemeBridge, toNavigationTheme } from './NavigationThemeBridge';
export { useSystemChromeTheme, keyboardAppearanceForTheme } from './useSystemChromeTheme';
export { useThemeStore } from './useThemeStore';
export { resolve } from './resolveTheme';
export { THEMES, assertTokenParity } from './themes';
export { contrastRatio, WCAG_AA_NORMAL, WCAG_AA_LARGE } from './contrast';
export {
  DEFAULT_MODE,
  PREFERENCE_STORAGE_KEY,
  PREFERENCE_VERSION,
  THEME_BOOTSTRAP_TIMEOUT_MS,
} from './theme.constants';

export type { ThemeContextValue } from './ThemeContext';
export type { NavigationTheme } from './NavigationThemeBridge';
export type { SemanticTokens } from './tokens';
export { ThemeMode, ResolvedTheme } from './tokens';
