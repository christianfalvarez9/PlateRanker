import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';
import { env } from '../config/env';
import { uploadDishPhotoToStorage } from '../integrations/dishPhotoStorage';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.dishPhotoUploadMaxBytes,
  },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new HttpError(400, 'Only image files can be uploaded'));
      return;
    }

    callback(null, true);
  },
});

export const uploadsRouter = Router();

uploadsRouter.post(
  '/dish-photo',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, 'No image file provided');
    }

    const uploaded = await uploadDishPhotoToStorage({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    });

    res.status(201).json({
      imageUrl: uploaded.imageUrl,
      objectPath: uploaded.objectPath,
    });
  }),
);
