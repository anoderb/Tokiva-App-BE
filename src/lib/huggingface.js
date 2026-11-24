import { config } from '../config/env.js';

/**
 * Konfigurasi & Utilitas Hugging Face Hub
 */
export const hfConfig = {
  token: config.huggingFace.token,
  repo: config.huggingFace.datasetRepo,
  baseUrl: 'https://huggingface.co/api/datasets',
};

