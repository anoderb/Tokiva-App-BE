import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config/env.js';
import { authenticate } from '../../plugins/auth.js';
import { kaggleService } from '../../services/ai/kaggle.js';
import { BadRequest, Forbidden, NotFound } from '../../utils/errors.js';
import {
  assertSafeHttpsUrl,
  authenticateMediaRequest,
  fetchUrlBuffer,
  isPrivateOrLoopbackIp,
  verifyMediaSignature,
} from './media-proxy-guard.js';

export { isPrivateOrLoopbackIp, assertSafeHttpsUrl, verifyMediaSignature };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESEARCH_POS_DIR = path.resolve(__dirname, '../../../kaggle/kernel-output/Research_POS');

const mediaQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      url: { type: 'string', maxLength: 1024 },
      path: { type: 'string', maxLength: 512 },
      exp: { type: 'string', maxLength: 32 },
      sig: { type: 'string', maxLength: 128 },
    },
  },
};

const researchPlotSchema = {
  querystring: {
    type: 'object',
    properties: {
      exp: { type: 'string', enum: ['E1_MobileNetV3', 'E2_MobileNetV3_CBAM'] },
      type: { type: 'string', enum: ['confusion_matrix', 'training_history'] },
      run_id: { type: 'string', pattern: '^[a-zA-Z0-9._-]+$' },
    },
  },
};

/**
 * Proxy gambar privat dari repositori dataset Hugging Face & Plot Riset Kaggle (Terproteksi Auth + Anti-SSRF)
 */
export default async function mediaProxyRoutes(app) {
  app.get(
    '/media/hf-proxy',
    { schema: mediaQuerySchema, preHandler: [authenticateMediaRequest] },
    async (req, reply) => {
      const rawUrl = typeof req.query?.url === 'string' ? req.query.url.trim() : '';
      const rawPath = typeof req.query?.path === 'string' ? req.query.path.trim() : '';

      const repo = config.huggingFace.datasetRepo;
      if (!repo) {
        return reply.code(503).send({ success: false, message: 'HUGGINGFACE_DATASET_REPO belum dikonfigurasi' });
      }
      const expectedPrefix = `https://huggingface.co/datasets/${repo}/resolve/`;

      let targetUrl = '';
      let cleanPath = '';
      if (rawUrl) {
        let parsedRaw;
        try {
          parsedRaw = new URL(rawUrl);
        } catch {
          throw new BadRequest('Parameter url tidak valid');
        }
        if (!parsedRaw.href.startsWith(expectedPrefix) || parsedRaw.username || parsedRaw.password) {
          throw new Forbidden('URL media tidak diizinkan oleh proxy');
        }
        targetUrl = parsedRaw.href;
      } else if (rawPath) {
        const decodedPath = decodeURIComponent(rawPath);
        if (decodedPath.includes('..') || decodedPath.includes('\\') || decodedPath.startsWith('http') || decodedPath.includes('\0')) {
          throw new BadRequest('Path dataset tidak valid');
        }
        cleanPath = decodedPath.replace(/^\/+/, '');
        targetUrl = `${expectedPrefix}main/${cleanPath}`;
      } else {
        throw new BadRequest('Parameter query "path" atau "url" wajib disertakan');
      }

      const authHeader = config.huggingFace.token ? `Bearer ${config.huggingFace.token}` : null;
      let upstream = await fetchUrlBuffer(targetUrl, authHeader);

      if (upstream.status === 404 && cleanPath) {
        const altPath = cleanPath.startsWith('dataset/')
          ? cleanPath.replace(/^dataset\//, 'data/')
          : cleanPath.startsWith('data/')
          ? cleanPath.replace(/^data\//, 'dataset/')
          : `data/${cleanPath}`;
        if (altPath) {
          const altUpstream = await fetchUrlBuffer(`${expectedPrefix}main/${altPath}`, authHeader);
          if (altUpstream.status < 400) upstream = altUpstream;
        }
      }

      if (upstream.status >= 400) {
        return reply.code(upstream.status).send({
          success: false,
          message: `Gagal memuat gambar dari Hugging Face (${upstream.status})`,
        });
      }

      return reply.header('Content-Type', upstream.contentType).header('Cache-Control', 'private, max-age=3600').send(upstream.buffer);
    }
  );

  app.get(
    '/media/research-plot',
    { schema: researchPlotSchema, preHandler: [authenticate] },
    async (req, reply) => {
      const exp = req.query?.exp === 'E2_MobileNetV3_CBAM' ? 'E2_MobileNetV3_CBAM' : 'E1_MobileNetV3';
      const type = req.query?.type === 'training_history' ? 'training_history' : 'confusion_matrix';
      const resolved = kaggleService.resolveResearchDir(req.query?.run_id || null);
      const baseDir = path.resolve(resolved?.dir && fs.existsSync(resolved.dir) ? resolved.dir : RESEARCH_POS_DIR);

      const relFile =
        type === 'training_history'
          ? path.join('EXPERIMENT', exp, 'plots', 'training_history.png')
          : path.join('EXPERIMENT', exp, 'confusion_matrix', 'confusion_matrix.png');

      const fullPath = path.resolve(baseDir, relFile);
      if (!fullPath.startsWith(baseDir + path.sep) || !fs.existsSync(fullPath)) {
        throw new NotFound('File plot riset tidak ditemukan');
      }

      return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=300').send(fs.readFileSync(fullPath));
    }
  );
}
