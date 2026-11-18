/**
 * usePhotoCapture — Cleaner photo capture for checklist evidence (Spec 19).
 *
 * Wraps `expo-image-picker` camera capture with a client-side max-size pre-check (UX only; the
 * server is authoritative). Camera-permission denial is handled gracefully: it surfaces an i18n
 * explanation key and never crashes, and it never hard-blocks completing tasks that don't require a
 * photo. Returns a captured asset (uri + advisory size/mime/dimensions) or a reason key on failure.
 */

import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';

import { CHECKLIST_I18N_KEYS, CHECKLIST_PHOTO_MAX_SIZE_BYTES } from './checklist.constants';
import type { CapturedPhoto } from './checklist.types';

/** The outcome of a capture attempt. */
export type CaptureResult =
  | { readonly status: 'captured'; readonly photo: CapturedPhoto }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly reasonKey: string };

/** Hook state + the capture trigger. */
export interface PhotoCapture {
  readonly isCapturing: boolean;
  readonly errorKey: string | null;
  readonly capture: () => Promise<CaptureResult>;
}

/** Build a captured-photo record from a picker asset (advisory metadata only). */
function toCapturedPhoto(asset: ImagePicker.ImagePickerAsset): CapturedPhoto {
  return {
    uri: asset.uri,
    sizeBytes: typeof asset.fileSize === 'number' ? asset.fileSize : 0,
    mimeType: asset.mimeType ?? 'image/jpeg',
    width: typeof asset.width === 'number' ? asset.width : null,
    height: typeof asset.height === 'number' ? asset.height : null,
  };
}

/** Capture a checklist evidence photo with permission + size guarding. */
export function usePhotoCapture(): PhotoCapture {
  const [isCapturing, setIsCapturing] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const capture = useCallback(async (): Promise<CaptureResult> => {
    setErrorKey(null);
    setIsCapturing(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setErrorKey(CHECKLIST_I18N_KEYS.PERMISSION_DENIED);
        return { status: 'error', reasonKey: CHECKLIST_I18N_KEYS.PERMISSION_DENIED };
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) {
        return { status: 'cancelled' };
      }
      const photo = toCapturedPhoto(asset);
      if (photo.sizeBytes > CHECKLIST_PHOTO_MAX_SIZE_BYTES) {
        setErrorKey(CHECKLIST_I18N_KEYS.PHOTO_TOO_LARGE);
        return { status: 'error', reasonKey: CHECKLIST_I18N_KEYS.PHOTO_TOO_LARGE };
      }
      return { status: 'captured', photo };
    } catch {
      setErrorKey(CHECKLIST_I18N_KEYS.LOAD_ERROR);
      return { status: 'error', reasonKey: CHECKLIST_I18N_KEYS.LOAD_ERROR };
    } finally {
      setIsCapturing(false);
    }
  }, []);

  return { isCapturing, errorKey, capture };
}
