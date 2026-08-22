/**
 * GET /api/certificate — read the certificate currently presented by the public HTTPS endpoint.
 *
 * This deliberately connects to the public hostname with SNI instead of reading a local
 * certificate file, so CDN/reverse-proxy certificates and renewals are reported accurately.
 */
'use strict';

const express = require('express');
const tls = require('tls');
const router = express.Router();

const CERTIFICATE_HOST = process.env.DASHBOARD_PUBLIC_HOST || 'darkhq.indiehacker.fun';
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;

function certificateInfo(cert, host) {
  const expiresAt = new Date(cert.valid_to);
  if (Number.isNaN(expiresAt.getTime())) throw new Error('Certificate did not include a valid expiration date');
  return {
    host,
    subject: cert.subject?.CN || null,
    issuer: cert.issuer?.O || cert.issuer?.CN || null,
    expiresAt: expiresAt.toISOString(),
    checkedAt: new Date().toISOString(),
  };
}

function fetchCertificate(host = CERTIFICATE_HOST) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized: true,
      timeout: 8000,
    }, () => {
      try {
        const result = certificateInfo(socket.getPeerCertificate(), host);
        socket.end();
        resolve(result);
      } catch (err) {
        socket.destroy();
        reject(err);
      }
    });
    socket.once('timeout', () => socket.destroy(new Error('TLS certificate query timed out')));
    socket.once('error', reject);
  });
}

async function getCertificate() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;
  const data = await fetchCertificate();
  cache = { data, fetchedAt: Date.now() };
  return data;
}

router.get('/api/certificate', async (req, res) => {
  try {
    const certificate = await getCertificate();
    res.json({ ok: true, certificate });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: '无法读取公网 HTTPS 证书',
      lastSuccessfulAt: cache?.data?.checkedAt || null,
    });
  }
});

module.exports = router;
module.exports._test = { certificateInfo };
