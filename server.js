/**
 * 老巢控制台 · server
 * ─────────────────────────────────────────────────────────
 * 本地开发：MOCK=1 npm run dev
 * 服务器部署：NODE_ENV=production npm start
 * 详见 PROJECT.md
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const compression = require('compression');
const PKG_VERSION = require('./package.json').version;

// ── 手动加载 .env（不依赖 dotenv 包）─────────────────────
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  }
} catch (e) { /* .env 不存在也无所谓 */ }

// ── Mock 开关 ─────────────────────────────────────────────
const USE_MOCK = process.env.MOCK === '1'
  || (process.env.NODE_ENV !== 'production' && !fs.existsSync('/home/openclaw/.openclaw'));
const mockData = USE_MOCK ? require('./mock-data') : null;
if (USE_MOCK) console.log('🧪  MOCK mode ON — 本地开发数据生效（线上请设置 NODE_ENV=production）');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT ? Number(process.env.PORT) : 9700;
const HOST = '0.0.0.0';

// 把 USE_MOCK / mockData 挂到 app.locals，供 routes/ 直接访问
app.locals.USE_MOCK  = USE_MOCK;
app.locals.mockData  = mockData;

// ── 鉴权配置（早于所有中间件声明）──────────────────────────
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || null;

// ── 手动 Cookie 解析工具函数 ─────────────────────────────
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

// ── 中间件 ─────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// ── 页面鉴权中间件（在 express.static 之前）──────────────────
// 白名单：/auth 路径、/avatars/logo.png（login 页需要）
// 若 DASHBOARD_TOKEN 未设置，跳过鉴权（向后兼容）
app.use((req, res, next) => {
  if (!DASHBOARD_TOKEN) return next();
  // 放行 /auth 路径和登录页所需资源
  if (req.path.startsWith('/auth') || req.path === '/avatars/logo.png') return next();
  // 放行 API（由 API 鉴权中间件处理）
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  // 检查 session cookie
  const cookies = parseCookies(req);
  if (cookies.dh_session === DASHBOARD_TOKEN) return next();
  return res.redirect('/auth/login');
});

// ── Auth 路由（在静态文件之前注册，优先匹配）────────────────
const loginHtmlPath = path.resolve(__dirname, 'public', 'login.html');
app.get('/auth/login', (req, res) => {
  try {
    const html = fs.readFileSync(loginHtmlPath, 'utf8');
    res.type('html').send(html);
  } catch (e) {
    res.status(500).send('Login page unavailable');
  }
});
app.post('/auth/login', (req, res) => {
  if (!DASHBOARD_TOKEN) return res.redirect('/');
  const provided = (req.body && req.body.password) || '';
  if (provided === DASHBOARD_TOKEN) {
    const maxAge = 7 * 24 * 3600;
    res.setHeader('Set-Cookie', `dh_session=${encodeURIComponent(DASHBOARD_TOKEN)}; Path=/; HttpOnly; Max-Age=${maxAge}; SameSite=Lax`);
    return res.redirect('/');
  }
  return res.redirect('/auth/login?error=1');
});
app.get('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'dh_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
  return res.redirect('/auth/login');
});

// ── 静态文件（auth 路由后面）──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  // 控制台部署后应立即看到新页面；入口 HTML/JS/CSS 完全禁止浏览器持久缓存。
  // 图片等静态媒体仍可使用 ETag 重新验证。
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\.(?:html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
  }
}));

// ── API 鉴权中间件（仅当设置了 DASHBOARD_TOKEN 才启用）────
app.use('/api', (req, res, next) => {
  if (!DASHBOARD_TOKEN) return next();  // 未配置则放行（向后兼容）
  const authHeader = req.headers.authorization || '';
  const queryToken = req.query.token || '';
  const cookies = parseCookies(req);
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  if (provided === DASHBOARD_TOKEN || cookies.dh_session === DASHBOARD_TOKEN) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
});

// ── 路由挂载 ───────────────────────────────────────────────
app.use(require('./routes/bots'));
app.use(require('./routes/cron'));
app.use(require('./routes/task-runs'));
app.use(require('./routes/signals'));
app.use(require('./routes/sources'));
app.use(require('./routes/wewe'));
app.use(require('./routes/headroom'));
app.use(require('./routes/status'));
app.use(require('./routes/certificate'));
app.use(require('./routes/usage'));
app.use(require('./routes/docs'));
app.use(require('./routes/settings'));

// ── 内置短路由（保留在 server.js）────────────────────────
app.get('/health',      (req, res) => res.json({ ok: true, mock: USE_MOCK }));
app.get('/api/version', (req, res) => res.json({ ok: true, version: PKG_VERSION }));

app.listen(PORT, HOST, () => {
  console.log(`🏴☠️  老巢控制台 running at http://${HOST}:${PORT}`);
});
