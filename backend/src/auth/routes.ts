import { Router } from 'express';
import { loginUser, registerUser } from './service';
import { loginSchema, registerSchema } from './validators';
import { asyncHandler } from '../utils/http';

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await registerUser(input);
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await loginUser(input);
    res.json(result);
  }),
);
