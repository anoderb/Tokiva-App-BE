import adminAiModelRoutes from './ai-models.js';
import adminAiTrainingRoutes from './ai-training.js';
import adminAiDatasetRoutes from './ai-dataset.js';

/** Aggregator route modul AI Superadmin */
export default async function adminAiRoutes(app) {
  await app.register(adminAiModelRoutes);
  await app.register(adminAiTrainingRoutes);
  await app.register(adminAiDatasetRoutes);
}
