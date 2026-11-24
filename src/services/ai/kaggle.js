import {
  getDatasetInfo,
  checkKaggleDatasetExists,
  triggerDatasetSync,
  getDatasetSyncStatus,
  resetDatasetSync,
} from './kaggle-dataset.js';
import {
  downloadAndRegister,
  ensureExperimentModelsRegistered,
  listResearchRuns,
  resolveResearchDir,
} from './kaggle-artifacts.js';
import { getResearchSummary, getHistory } from './kaggle-research.js';
import {
  triggerTraining,
  getStatus,
  fetchAndRegisterKaggleOutput,
  resetTraining,
} from './kaggle-training.js';

/** Facade terpadu layanan orkestrasi Kaggle AI Training & Research Telemetry */
export const kaggleService = {
  getDatasetInfo,
  checkKaggleDatasetExists,
  triggerDatasetSync,
  getDatasetSyncStatus,
  resetDatasetSync,
  triggerTraining,
  getStatus,
  downloadAndRegister,
  fetchAndRegisterKaggleOutput,
  ensureExperimentModelsRegistered,
  getHistory,
  resetTraining,
  listResearchRuns,
  resolveResearchDir,
  getResearchSummary,
};
