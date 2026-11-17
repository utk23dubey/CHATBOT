import { loginUser, registerUser } from "../services/auth.service.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function requiredString(body, field, maxLength) {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`The '${field}' field must be a non-empty string.`);
  }
  if (value.trim().length > maxLength) {
    throw badRequest(
      `The '${field}' field must be at most ${maxLength} characters.`,
    );
  }
  return value.trim();
}

function requiredPassword(body) {
  const password = body.password;
  if (typeof password !== "string" || password.length === 0) {
    throw badRequest("The 'password' field must be a non-empty string.");
  }
  if (password.length < 8 || password.length > 128) {
    throw badRequest(
      "The 'password' field must be between 8 and 128 characters.",
    );
  }
  return password;
}

function normalizeEmail(body) {
  const email = requiredString(body, "email", 254);
  if (!EMAIL_PATTERN.test(email)) {
    throw badRequest("The 'email' field must be a valid email address.");
  }
  return email.toLowerCase();
}

export async function register(req, res, next) {
  try {
    const body = req.body ?? {};
    const name = requiredString(body, "name", 150);
    const email = normalizeEmail(body);
    const password = requiredPassword(body);
    const mobileNumber = requiredString(body, "mobileNumber", 50);
    const country = requiredString(body, "country", 100);

    // Registration is a public endpoint: ignore any client-supplied role so
    // users cannot grant themselves elevated privileges (e.g. "admin").
    // Elevated roles must be assigned through a separate administrative process.
    const user = await registerUser({
      name,
      email,
      password,
      mobileNumber,
      country,
    });

    return res.status(201).json({ user });
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  try {
    const body = req.body ?? {};
    const email = normalizeEmail(body);
    const password = requiredPassword(body);

    const result = await loginUser({ email, password });
    return res.status(200).json({
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    return next(error);
  }
}
