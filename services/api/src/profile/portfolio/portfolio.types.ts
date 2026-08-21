/**
 * Portfolio types.
 */

/** Portfolio photo with signed URL for display */
export interface PortfolioPhotoWithUrl {
  readonly id: string;
  readonly url: string;
  readonly displayOrder: number;
  readonly caption: string | null;
  readonly createdAt: Date;
}

/** Result of a successful portfolio photo upload */
export interface PortfolioUploadResult {
  readonly id: string;
  readonly url: string;
  readonly displayOrder: number;
  readonly caption: string | null;
  readonly createdAt: Date;
}
