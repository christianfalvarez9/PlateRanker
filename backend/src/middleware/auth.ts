import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { asyncHandler, HttpError } from '../utils/http';

type JwtPayload = {
  sub: string;
  email: string;
};

export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing authorization token');
  }

  const token = header.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, defaultSearchLocation: true, recipeMatchEnabled: true },
  });

  if (!user) {
    throw new HttpError(401, 'User not found');
  }

  req.user = user;
  next();
});

export const requireMenuAdmin = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const user = req.user;
  if (!user) {
    throw new HttpError(401, 'Missing authorization token');
  }

  if (!env.menuAdminEmails.includes(user.email.toLowerCase())) {
    throw new HttpError(403, 'Admin permissions are required for this action');
  }

  next();
});
