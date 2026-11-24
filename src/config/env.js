import dotenv from 'dotenv';
dotenv.config();

const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ [ENV ERROR] Variabel lingkungan wajib '${envVar}' belum didefinisikan di .env`);
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
    region: process.env.SUPABASE_REGION || 'ap-southeast-2',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },
  
  huggingFace: {
    token: process.env.HUGGINGFACE_TOKEN || '',
    datasetRepo: process.env.HUGGINGFACE_DATASET_REPO || '',
  },

  kaggle: {
    username: process.env.KAGGLE_USERNAME || '',
    key: process.env.KAGGLE_KEY || '',
    kernelSlug: process.env.KAGGLE_KERNEL_SLUG || 'tokiva-training-mobilenetv3-cbam',
    syncKernelSlug: process.env.KAGGLE_SYNC_KERNEL_SLUG || 'tokiva-sync-hf-dataset',
    datasetSlug: process.env.KAGGLE_DATASET_SLUG || 'tokiva-pos-dataset',
  },

  automation: {
    cronSecret: process.env.AI_CRON_SECRET || '',
  },

  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || 'Tokiva POS <noreply@example.com>',
    appUrl: (process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')[0]
      .trim()
      .replace(/\/+$/, ''),
  },
};

