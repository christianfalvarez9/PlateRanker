import { randomUUID } from 'crypto';
import { Storage } from '@google-cloud/storage';
import { env } from '../config/env';
import { HttpError } from '../utils/http';

type UploadDishPhotoInput = {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
};

const storage = new Storage();

function assertImageMimeType(mimeType: string): void {
  if (!mimeType.startsWith('image/')) {
    throw new HttpError(400, 'Only image uploads are allowed');
  }
}

function extensionFromMimeType(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.toLowerCase() ?? 'jpg';
  if (!subtype) {
    return 'jpg';
  }

  if (subtype === 'jpeg') {
    return 'jpg';
  }

  return subtype.replace(/[^a-z0-9]/g, '') || 'jpg';
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 24) || 'dish';
}

function resolvePublicUrl(bucketName: string, objectPath: string): string {
  if (env.dishPhotoPublicBaseUrl) {
    return `${env.dishPhotoPublicBaseUrl.replace(/\/$/, '')}/${objectPath}`;
  }

  return `https://storage.googleapis.com/${bucketName}/${objectPath}`;
}

export async function uploadDishPhotoToStorage(input: UploadDishPhotoInput): Promise<{
  imageUrl: string;
  objectPath: string;
}> {
  const bucketName = env.dishPhotoBucketName;
  if (!bucketName) {
    throw new HttpError(500, 'Dish photo storage bucket is not configured');
  }

  assertImageMimeType(input.mimeType);

  const extension = extensionFromMimeType(input.mimeType);
  const namePart = sanitizeSegment(input.originalName.split('.')[0] ?? 'dish-photo');
  const objectPath = `dish-reviews/${new Date().toISOString().slice(0, 10)}/${namePart}-${randomUUID()}.${extension}`;

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectPath);

  try {
    await file.save(input.buffer, {
      resumable: false,
      contentType: input.mimeType,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    throw new HttpError(500, 'Failed to upload dish photo to cloud storage');
  }

  return {
    imageUrl: resolvePublicUrl(bucketName, objectPath),
    objectPath,
  };
}
