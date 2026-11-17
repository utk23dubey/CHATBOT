import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import {
  createUser,
  findUserByEmail,
  setupUserTable,
} from "../models/user.model.js";

const BCRYPT_SALT_ROUNDS = 12;
const DEFAULT_JWT_EXPIRES_IN = "7d";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const error = new Error(
      "JWT_SECRET must be set to sign and verify authentication tokens.",
    );
    error.status = 500;
    throw error;
  }
  return secret;
}

function invalidCredentialsError() {
  const error = new Error("Invalid email or password.");
  error.status = 401;
  return error;
}

function toSafeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mobileNumber: user.mobile_number,
    country: user.country,
  };
}

export async function setupAuthDatabase() {
  await setupUserTable();
}

/** Hashes the password with bcrypt and persists a new user. */
export async function registerUser({
  name,
  email,
  password,
  mobileNumber,
  country,
}) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const user = await createUser({
    name,
    email,
    passwordHash,
    // Defense in depth: public registration can only create regular users,
    // even if a caller bypasses the controller's validation.
    role: "user",
    mobileNumber,
    country,
  });
  return toSafeUser(user);
}

/** Verifies the password with bcrypt and issues a signed JWT. */
export async function loginUser({ email, password }) {
  const user = await findUserByEmail(email);
  if (!user) {
    throw invalidCredentialsError();
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw invalidCredentialsError();
  }

  const expiresIn =
    process.env.JWT_EXPIRES_IN?.trim() || DEFAULT_JWT_EXPIRES_IN;

  let token;
  try {
    token = jwt.sign(
      { email: user.email, role: user.role },
      getJwtSecret(),
      { subject: String(user.id), expiresIn },
    );
  } catch (error) {
    if (error.status === 500) {
      throw error;
    }
    const signError = new Error(
      `Failed to sign authentication token: ${error.message}`,
    );
    signError.status = 500;
    throw signError;
  }

  return { token, user: toSafeUser(user) };
}

/** Verifies a Bearer token. Throws a 401-tagged error when it is not valid. */
export function verifyToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch (error) {
    if (error.status === 500) {
      throw error;
    }
    const authError = new Error("Invalid or expired authentication token.");
    authError.status = 401;
    throw authError;
  }

  if (!decoded || typeof decoded !== "object" || !decoded.sub) {
    const authError = new Error("Invalid or expired authentication token.");
    authError.status = 401;
    throw authError;
  }

  return {
    id: decoded.sub,
    email: decoded.email,
    role: decoded.role,
  };
}
