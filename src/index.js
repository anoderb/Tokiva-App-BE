import dns from 'node:dns';
import net from 'node:net';

// Pastikan koneksi ke Supabase Cloud & Hugging Face mengutamakan IPv4
// agar tidak terkena ConnectTimeoutError (10s) pada Node v22 Happy Eyeballs di Windows.
dns.setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}

import { buildApp } from './app.js';
import { config } from './config/env.js';
import { initKaggleStatesFromCloud } from './services/ai/kaggle-config.js';
import { initAiAutomationScheduler } from './services/ai/scheduler.js';

async function startServer() {
  try {
    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: config.host,
    });

    await initKaggleStatesFromCloud().catch((err) => {
      app.log.warn({ err }, 'Gagal inisialisasi state Kaggle dari cloud storage');
    });
    await initAiAutomationScheduler().catch((err) => {
      app.log.warn({ err }, 'Gagal inisialisasi AI Automation Scheduler');
    });

    console.log('\n========================================================');
    console.log(`🚀 Tokiva Backend API Server aktif di: http://localhost:${config.port}`);
    console.log(`📚 Swagger UI API Docs tersedia di  : http://localhost:${config.port}/docs`);
    console.log(`📡 Supabase terhubung ke            : ${config.supabase.url}`);
    console.log('========================================================\n');
  } catch (err) {
    console.error('❌ Gagal menjalankan server backend:', err);
    process.exit(1);
  }
}

startServer();
