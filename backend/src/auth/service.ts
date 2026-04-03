import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';

type AuthResponse = {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    recipeMatchEnabled: boolean;
  };
};

function signToken(user: Pick<User, 'id' | 'email'>): string {
  const signOptions: jwt.SignOptions = {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  };

  return jwt.sign({ sub: user.id, email: user.email }, env.jwtSecret, signOptions);
}

function formatAuthResponse(user: Pick<User, 'id' | 'name' | 'email' | 'recipeMatchEnabled'>): AuthResponse {
  return {
    token: signToken(user),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      recipeMatchEnabled: user.recipeMatchEnabled,
    },
  };
}

export async function registerUser(input: { name: string; email: string; password: string }): Promise<AuthResponse> {
  const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (existing) {
    throw new HttpError(409, 'Email is already in use');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
    },
    select: {
      id: true,
      name: true,
      email: true,
      recipeMatchEnabled: true,
    },
  });

  return formatAuthResponse(user);
}

export async function loginUser(input: { email: string; password: string }): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (!user) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const isValid = await bcrypt.compare(input.password, user.passwordHash);
  if (!isValid) {
    throw new HttpError(401, 'Invalid email or password');
  }

  return formatAuthResponse(user);
}
