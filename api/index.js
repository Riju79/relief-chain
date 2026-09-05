import app from '../server.js';

export default function handler(req, res) {
  // Normalize URL prefix for Express routes when invoked via Vercel serverless rewrites
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
}
