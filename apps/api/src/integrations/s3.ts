import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env.js';

export const ALLOWED_DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB
const PRESIGN_TTL_SEC = 300; // 5 min

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: { accessKeyId: env.S3_KEY, secretAccessKey: env.S3_SECRET },
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

function slug(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Build the S3 key for a driver document: drivers/{id}/{type}/{uuid}-{slug}. */
export function buildDocKey(driverId: string, docType: string, uuid: string, filename: string): string {
  return `drivers/${driverId}/${docType}/${uuid}-${slug(filename)}`;
}

/** Presigned PUT URL with content-type, size and encryption pinned. */
export async function presignPut(key: string, contentType: string, sizeBytes: number): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
    ServerSideEncryption: 'AES256',
  });
  return getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_SEC });
}

/** Short-lived presigned GET URL for downloading a document. */
export async function presignGet(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_SEC });
}

/** Move-to-soft-delete by copying isn't supported here; we just delete on purge. */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export function isAllowedDocMime(mime: string): mime is (typeof ALLOWED_DOC_MIME)[number] {
  return (ALLOWED_DOC_MIME as readonly string[]).includes(mime);
}
