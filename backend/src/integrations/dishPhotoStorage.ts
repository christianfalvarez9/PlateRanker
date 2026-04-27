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
const DISH_PHOTO_UPLOAD_FAILED_MESSAGE = 'Failed to upload dish photo to cloud storage';

type StorageApiError = Error & {
  code?: number | string;
  details?: string;
  errors?: Array<{
    reason?: string;
    message?: string;
  }>;
};

function toStorageApiError(error: unknown): StorageApiError {
  if (error instanceof Error) {
    return error as StorageApiError;
  }

  return new Error(typeof error === 'string' ? error : 'Unknown storage upload error') as StorageApiError;
}

function normalizeStorageErrorCode(error: StorageApiError): number | undefined {
  if (typeof error.code === 'number' && Number.isFinite(error.code)) {
    return error.code;
  }

  if (typeof error.code === 'string') {
    const parsed = Number(error.code);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function extractStorageErrorReason(error: StorageApiError): string {
  const nestedReasons =
    error.errors
      ?.map((item) => {
        const reason = item.reason?.trim() ?? '';
        const message = item.message?.trim() ?? '';
        if (reason && message) {
          return `${reason}: ${message}`;
        }

        return reason || message;
      })
      .filter((value): value is string => Boolean(value))
      .join('; ') ?? '';

  return [error.message?.trim(), error.details?.trim(), nestedReasons].filter(Boolean).join(' | ');
}

function normalizeBucketName(rawBucketName: string): string {
  const trimmed = rawBucketName.trim();
  if (!trimmed) {
    return '';
  }

  const withoutScheme = trimmed.replace(/^gs:\/\//i, '');
  const withoutSlashes = withoutScheme.replace(/^\/+|\/+$/g, '');
  if (!withoutSlashes) {
    return '';
  }

  return withoutSlashes.split('/')[0] ?? '';
}

function isLikelySafePublicStorageError(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes('bucket') ||
    normalized.includes('credential') ||
    normalized.includes('permission') ||
    normalized.includes('forbidden') ||
    normalized.includes('not found')
  );
}

function isMissingGoogleCredentials(error: StorageApiError): boolean {
  const combinedMessage = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return (
    combinedMessage.includes('could not load the default credentials') ||
    combinedMessage.includes('could not load credentials from any providers')
  );
}

function resolveUploadFailureMessage(error: StorageApiError): string {
  const statusCode = normalizeStorageErrorCode(error);
  const reason = extractStorageErrorReason(error);

  if (isMissingGoogleCredentials(error)) {
    return `${DISH_PHOTO_UPLOAD_FAILED_MESSAGE}: cloud credentials are not configured`;
  }

  if (statusCode === 403) {
    return `${DISH_PHOTO_UPLOAD_FAILED_MESSAGE}: storage permission denied`;
  }

  if (statusCode === 404) {
    return `${DISH_PHOTO_UPLOAD_FAILED_MESSAGE}: storage bucket not found`;
  }

  if (statusCode === 400 && reason.toLowerCase().includes('bucket')) {
    return `${DISH_PHOTO_UPLOAD_FAILED_MESSAGE}: invalid storage bucket configuration`;
  }

  if (env.isProduction) {
    if (reason && isLikelySafePublicStorageError(reason)) {
      return `${DISH_PHOTO_UPLOAD_FAILED_MESSAGE}: ${reason}`;
    }

    return DISH_PHOTO_UPLOAD_FAILED_MESSAGE;
  }

  if (!reason) {
    return DISH_PHOTO_UPLOAD_FAILED_MESSAGE;
  }

  return `${DISH_PHOTO_UPLOAD_FAILED_MESSAGE}: ${reason}`;
}

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
  const bucketName = normalizeBucketName(env.dishPhotoBucketName);
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
  } catch (error) {
    const storageError = toStorageApiError(error);
    const statusCode = normalizeStorageErrorCode(storageError);

    console.error('Dish photo upload failed', {
      bucketName,
      objectPath,
      statusCode: statusCode ?? 'unknown',
      message: storageError.message,
      details: storageError.details,
      errors: storageError.errors,
    });

    throw new HttpError(500, resolveUploadFailureMessage(storageError));
  }

  return {
    imageUrl: resolvePublicUrl(bucketName, objectPath),
    objectPath,
  };
}
