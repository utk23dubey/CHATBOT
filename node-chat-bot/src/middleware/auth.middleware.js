import { verifyToken } from "../services/auth.service.js";

function unauthorized(res, message) {
  return res
    .status(401)
    .set("WWW-Authenticate", "Bearer")
    .json({ error: message });
}

/** Requires `Authorization: Bearer <token>` on protected routes. */
export function authenticateToken(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());

  if (!match) {
    return unauthorized(
      res,
      "Authentication required. Send an Authorization: Bearer <token> header.",
    );
  }

  try {
    req.user = verifyToken(match[1]);
    return next();
  } catch (error) {
    if (error.status === 401) {
      return unauthorized(res, error.message);
    }
    return next(error);
  }
}
