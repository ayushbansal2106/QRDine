import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/**
 * Lazily resolves the JWT secret to avoid crashing at module-import time.
 * Throws only when signJWT or verifyJWT is actually called without a configured secret.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set. '
      + 'Set a strong, unique secret in your .env file or production environment.'
    );
  }
  return secret;
}

export interface JWTPayload {
  id: string;
  email?: string;
  role: string;
}

export function signJWT(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN as any });
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JWTPayload;
  } catch {
    return null;
  }
}

export async function getAdminFromSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;
  if (!token) return null;
  return verifyJWT(token);
}

