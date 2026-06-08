/**
 * SSD Studio — Amazon S3 Helper
 * Wraps the AWS SDK v3 client and exposes presigned URL generation
 * for time-limited media delivery (raw: 12h, final: 72h by default).
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger';

const region = process.env.AWS_REGION || 'us-east-1';
const bucket = process.env.S3_BUCKET_NAME || '';

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  cachedClient = new S3Client({
    region,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}), // fall back to IAM role / instance profile when unset
  });
  return cachedClient;
}

/**
 * Generate a time-limited presigned download URL for an object.
 * @param objectKey  S3 key of the object
 * @param ttlSeconds URL lifetime in seconds
 */
export async function generatePresignedUrl(
  objectKey: string,
  ttlSeconds: number
): Promise<string> {
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not configured');
  }
  const command = new GetObjectCommand({ Bucket: bucket, Key: objectKey });
  const url = await getSignedUrl(getClient(), command, { expiresIn: ttlSeconds });
  logger.debug(`Generated presigned GET url for ${objectKey} (ttl=${ttlSeconds}s)`);
  return url;
}

/**
 * Generate a presigned upload URL (used by the booking flow to let
 * the studio upload media directly to S3 from the browser/desktop).
 */
export async function generateUploadUrl(
  objectKey: string,
  contentType: string,
  ttlSeconds = 900
): Promise<string> {
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not configured');
  }
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn: ttlSeconds });
}

export const s3 = { generatePresignedUrl, generateUploadUrl };
export default s3;
