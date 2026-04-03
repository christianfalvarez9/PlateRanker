import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { HttpError } from '../utils/http';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof Error && err.message === 'CORS origin not allowed') {
    res.status(403).json({ message: 'CORS origin not allowed' });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      message: 'Validation failed',
      errors: err.flatten(),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: 'Uploaded image is too large' });
      return;
    }

    res.status(400).json({ message: 'Invalid upload request' });
    return;
  }

  if (!env.isProduction) {
    console.error(err);
  }

  res.status(500).json({
    message: 'Internal server error',
    ...(env.isProduction
      ? {}
      : {
          details: err instanceof Error ? err.message : String(err),
        }),
  });
}
