/**
 * Body for `POST /video-verifications/:id/request-upload`.
 *
 * The request-upload endpoint derives everything server-side (the object key is server-generated,
 * the grant is bound to the resolved Cleaner + session), so it takes no client-supplied fields.
 * This empty DTO documents that contract and keeps the whitelisting `ValidationPipe` strict.
 */
export class RequestUploadDto {}
