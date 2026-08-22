/**
 * Type declarations for expo-constants.
 * Stub until the package is installed as a dependency.
 */
declare module 'expo-constants' {
  interface ExpoConfig {
    extra?: Record<string, unknown>;
    name?: string;
    slug?: string;
    version?: string;
  }

  interface Constants {
    expoConfig?: ExpoConfig;
    appOwnership?: string;
    executionEnvironment?: string;
    isDevice?: boolean;
    platform?: {
      ios?: Record<string, unknown>;
      android?: Record<string, unknown>;
    };
    systemFonts?: string[];
    statusBarHeight?: number;
  }

  const constants: Constants;
  export default constants;
}
