const axios = require('axios');

const { logger } = require('@study-partner/shared');

const requireOwnedUser = (req, res, next) => {
  const targetUserId = req.params.userId;
  const isAdmin = req.user?.role === 'admin' || req.user?.isAdmin === true;
  if (String(req.user?.userId) === String(targetUserId) || isAdmin) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden: cannot access another user's data" });
};

function createProxy(options) {
  const {
    method = 'POST',
    path,
    targetUrl,
    timeout = 30000,
    schema,
    tier,
    requireOwnership = false,
    userIdField = false,
    forwardQuery = false,
    forwardAuth = false,
    mapBody,
    mapResponse,
    validateBody
  } = options;

  const middlewares = [];
  if (tier) {
    const { tierGate } = require('@study-partner/shared/tierGate');
    middlewares.push(tierGate(...tier));
  }
  if (requireOwnership) {
    middlewares.push(requireOwnedUser);
  }

  const handler = async (req, res) => {
    const targetPath = typeof path === 'function' ? path(req) : path;
    const url = `${targetUrl}${targetPath}`;
    try {
      let validatedBody = req.body;
      if (schema) {
        const { error, value } = schema.validate(req.body || {});
        if (error) {
          return res.status(400).json({ error: error.details[0].message });
        }
        validatedBody = value;
      }

      let body;
      if (mapBody) {
        body = mapBody(req, validatedBody);
      } else if (userIdField) {
        body = { ...validatedBody, [userIdField]: req.user?.userId };
      } else {
        body = validatedBody;
      }

      if (validateBody) {
        const msg = validateBody(body);
        if (msg) return res.status(400).json({ error: msg });
      }

      const config = { timeout };
      if (forwardQuery) config.params = req.query;
      if (forwardAuth) config.headers = { Authorization: req.headers.authorization };

      const httpMethod = method.toUpperCase();
      let response;
      if (httpMethod === 'GET' || httpMethod === 'DELETE') {
        response = await axios[httpMethod.toLowerCase()](url, config);
      } else {
        response = await axios[httpMethod.toLowerCase()](url, body, config);
      }

      if (mapResponse) {
        return res.json(mapResponse(response.data, req));
      }
      return res.json(response.data);
    } catch (err) {
      // SEC-08: never leak upstream status bodies, stack traces, or internal
      // error details to the client. Log the full error server-side and return
      // generic statuses only.
      try {
        logger.error('AI proxy upstream error', {
          method: req.method,
          url: `${targetUrl}${targetPath}`,
          upstreamStatus: err.response?.status,
          upstreamBody: err.response?.data,
          message: err.message,
          stack: err.stack
        });
      } catch (_) {
        // Logging must never break the request path.
      }

      if (err.response) {
        return res.status(502).json({ error: 'Upstream service error' });
      }
      if (err.request) {
        return res.status(503).json({ error: 'AI service unavailable' });
      }
      return res.status(500).json({ error: 'Request failed' });
    }
  };

  return [...middlewares, handler];
}

module.exports = { createProxy, requireOwnedUser };
