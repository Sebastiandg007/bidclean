/**
 * Type declarations for expo-image-picker.
 * Stub until the package is installed as a dependency.
 */
declare module 'expo-image-picker' {
  export interface ImagePickerResult {
    canceled: boolean;
    assets?: ImagePickerAsset[];
  }

  export interface ImagePickerAsset {
    uri: string;
    width: number;
    height: number;
    type?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  }

  export interface ImagePickerOptions {
    mediaTypes?: MediaTypeOptions;
    allowsEditing?: boolean;
    aspect?: [number, number];
    quality?: number;
    allowsMultipleSelection?: boolean;
    selectionLimit?: number;
  }

  export enum MediaTypeOptions {
    All = 'All',
    Images = 'Images',
    Videos = 'Videos',
  }

  export function launchImageLibraryAsync(
    options?: ImagePickerOptions,
  ): Promise<ImagePickerResult>;

  export function launchCameraAsync(
    options?: ImagePickerOptions,
  ): Promise<ImagePickerResult>;

  export function requestMediaLibraryPermissionsAsync(): Promise<{
    status: string;
    granted: boolean;
  }>;

  export function requestCameraPermissionsAsync(): Promise<{
    status: string;
    granted: boolean;
  }>;
}
