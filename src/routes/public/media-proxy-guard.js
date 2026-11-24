import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import crypto from 'node:crypto';
import { config } from '../../config/env.js';
import { authenticate } from '../../plugins/auth.js';
import { BadRequest, Forbidden } from '../../utils/errors.js';

const MAX_PROXY_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Memeriksa apakah sebuah IPv4/IPv6 merupakan alamat loopback, privat, CGNAT, atau link-local. */
export function isPrivateOrLoopbackIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (['fe8', 'fe9', 'fea', 'feb'].some((p) => normalized.startsWith(p))) return true;
    if (normalized.startsWith('::ffff:')) return isPrivateOrLoopbackIp(normalized.slice(7));
    return false;
  }
  return true;
}

/** Validasi Anti-SSRF untuk URL target HTTPS eksternal beserta hasil resolusi DNS-nya. */
export async function assertSafeHttpsUrl(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new BadRequest('URL target proxy tidak valid');
  }

  if (parsed.protocol !== 'https:') {
    throw new Forbidden('Proxy media hanya mengizinkan protokol HTTPS');
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Forbidden('Host lokal/internal dilarang pada proxy media');
  }

  if (net.isIP(host)) {
    if (isPrivateOrLoopbackIp(host)) throw new Forbidden('Alamat IP privat/loopback dilarang pada proxy media');
    return parsed;
  }

  const resolved = await dns.promises.lookup(host, { all: true });
  if (!resolved || resolved.length === 0) throw new BadRequest('Gagal melakukan resolusi DNS target proxy');
  for (const entry of resolved) {
    if (isPrivateOrLoopbackIp(entry.address)) throw new Forbidden('Tujuan redirect menuju IP internal/privat diblokir');
  }
  return parsed;
}

function isTrustedHuggingFaceHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'huggingface.co' || host.endsWith('.huggingface.co');
}

function createMediaSignature(resourceKey, exp) {
  return crypto.createHmac('sha256', config.jwt.secret).update(`${resourceKey}:${exp}`).digest('hex');
}

/** Verifikasi tanda tangan HMAC berjangka waktu untuk URL akses media terautentikasi. */
export function verifyMediaSignature(resourceKey, exp, sig) {
  if (!resourceKey || !exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = createMediaSignature(resourceKey, expNum);
  const sigStr = String(sig);
  if (sigStr.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sigStr, 'hex'));
}

export async function authenticateMediaRequest(req, reply) {
  const key = req.query?.url || req.query?.path || '';
  if (key && verifyMediaSignature(String(key), req.query?.exp, req.query?.sig)) return;
  return authenticate(req, reply);
}

/** Mengunduh konten media HTTPS secara aman dengan batas ukuran dan redirect maksimum. */
export async function fetchUrlBuffer(targetUrl, authHeader = null, depth = 0) {
  if (depth > MAX_REDIRECTS) throw new BadRequest('Terlalu banyak pengalihan URL (redirect)');
  const parsed = await assertSafeHttpsUrl(targetUrl);

  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'Tokiva-Media-Proxy/1.0' };
    if (authHeader && isTrustedHuggingFaceHost(parsed.hostname)) headers.Authorization = authHeader;

    const req = https.request(
      { hostname: parsed.hostname, port: parsed.port || undefined, path: parsed.pathname + parsed.search, method: 'GET', family: 4, headers },
      (res) => {
        const status = res.statusCode || 500;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve(fetchUrlBuffer(new URL(res.headers.location, targetUrl).toString(), authHeader, depth + 1));
          return;
        }
        const contentLength = Number(res.headers['content-length'] || 0);
        if (contentLength > MAX_PROXY_BYTES) {
          res.destroy();
          reject(new BadRequest('Ukuran berkas media melebihi batas 10 MB'));
          return;
        }

        const chunks = [];
        let receivedBytes = 0;
        let aborted = false;

        res.on('data', (chunk) => {
          if (aborted) return;
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_PROXY_BYTES) {
            aborted = true;
            res.destroy();
            reject(new BadRequest('Ukuran respons media melebihi batas maksimal 10 MB'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (!aborted) resolve({ status, contentType: res.headers['content-type'] || 'image/jpeg', buffer: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      }
    );

    req.setTimeout(20000, () => req.destroy(new Error('Timeout mengambil gambar dari Hugging Face')));
    req.on('error', reject);
    req.end();
  });
}
