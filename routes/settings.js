/**
 * routes/settings.js
 * POST /api/settings/bots
 * POST /api/settings/avatar/:botId  (multer, optional)
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

let multer = null;
try { multer = require('multer'); } catch (e) { /* avatar 上传可选 */ }

const AVATARS_DIR = path.join(__dirname, '..', 'public', 'avatars');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

// ─── POST /api/settings/bots ──────────────────────────────
router.post('/api/settings/bots', (req, res) => {
  try {
    const { bots } = req.body || {};
    if (!Array.isArray(bots)) return res.status(400).json({ ok: false, error: 'invalid payload' });
    fs.writeFileSync(
      path.join(__dirname, '..', 'public', 'bot-settings.json'),
      JSON.stringify({ bots }, null, 2),
      'utf8'
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── POST /api/settings/avatar/:botId ─────────────────────
if (multer) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATARS_DIR),
    filename: (req, _file, cb) => cb(null, `bot-${req.params.botId}.png`),
  });
  const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
  router.post('/api/settings/avatar/:botId', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
    res.json({ ok: true, path: `/avatars/bot-${req.params.botId}.png` });
  });
}

module.exports = router;
