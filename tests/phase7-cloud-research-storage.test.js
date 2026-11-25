import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-for-unit-tests-only';

const {
  KAGGLE_TEMP_ROOT,
  cleanupTempDir,
} = await import('../src/services/ai/kaggle-config.js');
const { injectNotebookNonSecretConfig } = await import('../src/services/ai/kaggle-cli.js');
const {
  extractHfFolderFromPath,
  pickDominantHfFolder,
  resolveCanonicalHfFolderForClass,
} = await import('../src/services/ai/helpers.js');
const {
  RESEARCH_INDEX_PATH,
  uploadResearchBundleToCloud,
  listCloudResearchRuns,
  fetchCloudResearchSummary,
  invalidateCloudResearchCache,
} = await import('../src/services/ai/kaggle-research-cloud.js');

function createMockStorage() {
  const store = new Map();
  return {
    store,
    from(bucket) {
      return {
        async upload(filePath, body) {
          store.set(`${bucket}/${filePath}`, Buffer.isBuffer(body) ? body : Buffer.from(body));
          return { data: { path: filePath }, error: null };
        },
        async download(filePath) {
          const buf = store.get(`${bucket}/${filePath}`);
          if (!buf) return { data: null, error: { message: 'Not found' } };
          return {
            data: { text: async () => buf.toString('utf-8') },
            error: null,
          };
        },
        getPublicUrl(filePath) {
          return { data: { publicUrl: `https://cdn.example.supabase.co/storage/v1/object/public/${bucket}/${filePath}` } };
        },
      };
    },
  };
}

let tempFixtures = [];
afterEach(() => {
  invalidateCloudResearchCache();
  for (const dir of tempFixtures) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempFixtures = [];
});

describe('Phase 7 Cloud Research Storage & Stateless Temp Cleanup', () => {
  it('uploadResearchBundleToCloud uploads summary JSON (without raw dataset_split rows) and PNG plots, then reads via cache', async () => {
    const tmpResearch = fs.mkdtempSync(path.join(os.tmpdir(), 'tokiva-research-test-'));
    tempFixtures.push(tmpResearch);

    fs.mkdirSync(path.join(tmpResearch, 'FINAL_MODEL'), { recursive: true });
    fs.mkdirSync(path.join(tmpResearch, 'DATA_REPORT'), { recursive: true });
    fs.mkdirSync(path.join(tmpResearch, 'COMPARISON'), { recursive: true });
    fs.mkdirSync(path.join(tmpResearch, 'EXPERIMENT', 'E1_MobileNetV3', 'confusion_matrix'), { recursive: true });
    fs.mkdirSync(path.join(tmpResearch, 'EXPERIMENT', 'E2_MobileNetV3_CBAM', 'plots'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpResearch, 'FINAL_MODEL', 'training_summary.json'),
      JSON.stringify({ best_experiment: 'E2_MobileNetV3_CBAM', num_classes: 2, generated_at: '2026-11-24T10:00:00Z' })
    );
    fs.writeFileSync(
      path.join(tmpResearch, 'DATA_REPORT', 'dataset_split.csv'),
      'filepath,split\na.jpg,train\nb.jpg,val\nc.jpg,test\n'
    );
    fs.writeFileSync(
      path.join(tmpResearch, 'COMPARISON', 'comparison_table.csv'),
      'experiment,accuracy,f1_macro\nE1_MobileNetV3,0.95,0.94\nE2_MobileNetV3_CBAM,0.98,0.97\n'
    );
    fs.writeFileSync(
      path.join(tmpResearch, 'EXPERIMENT', 'E1_MobileNetV3', 'confusion_matrix', 'confusion_matrix.png'),
      Buffer.from('PNG_E1_CM')
    );
    fs.writeFileSync(
      path.join(tmpResearch, 'EXPERIMENT', 'E2_MobileNetV3_CBAM', 'plots', 'training_history.png'),
      Buffer.from('PNG_E2_HIST')
    );

    const mockStorage = createMockStorage();
    const res = await uploadResearchBundleToCloud(tmpResearch, {
      runId: 'RUN-001',
      label: 'v1.6.test',
      storageClient: mockStorage,
    });

    assert.equal(res.run_id, 'RUN-001');
    assert.ok(res.plot_urls.E1_MobileNetV3.confusion_matrix.includes('/_research/RUN-001/plots/E1_MobileNetV3_confusion_matrix.png'));
    assert.ok(res.plot_urls.E2_MobileNetV3_CBAM.training_history.includes('/_research/RUN-001/plots/E2_MobileNetV3_CBAM_training_history.png'));
    assert.ok(mockStorage.store.has(`ai-models/${RESEARCH_INDEX_PATH}`));

    // Upload ulang runId sama tidak membuat duplikat di index
    await uploadResearchBundleToCloud(tmpResearch, {
      runId: 'RUN-001',
      label: 'v1.6.test',
      storageClient: mockStorage,
    });

    const runs = await listCloudResearchRuns({ forceRefresh: true, storageClient: mockStorage });
    assert.equal(runs.length, 1);

    const summary = await fetchCloudResearchSummary('RUN-001', { storageClient: mockStorage });
    assert.equal(summary.comparison.length, 2);
    assert.deepEqual(summary.dataset_split, { train: 1, val: 1, test: 1, total: 3 });
  });

  it('cleanupTempDir deletes paths inside KAGGLE_TEMP_ROOT and refuses paths outside it', () => {
    fs.mkdirSync(KAGGLE_TEMP_ROOT, { recursive: true });
    const insideDir = fs.mkdtempSync(path.join(KAGGLE_TEMP_ROOT, 'unit-clean-'));
    fs.writeFileSync(path.join(insideDir, 'dummy.txt'), 'temp');
    assert.equal(cleanupTempDir(insideDir), true);
    assert.equal(fs.existsSync(insideDir), false);

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokiva-outside-'));
    tempFixtures.push(outsideDir);
    assert.equal(cleanupTempDir(outsideDir), false);
    assert.equal(fs.existsSync(outsideDir), true);
  });

  it('injectNotebookNonSecretConfig injects KAGGLE_USERNAME and HF_REPO_ID while blocking secrets', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokiva-nb-test-'));
    tempFixtures.push(tmpDir);
    const nbPath = path.join(tmpDir, 'sync.ipynb');
    fs.writeFileSync(
      nbPath,
      JSON.stringify({
        cells: [
          {
            cell_type: 'code',
            source: [
              'HF_REPO_ID = os.environ.get("HF_REPO_ID", "")\n',
              'HF_TOKEN = os.environ.get("HF_TOKEN", "")\n',
              'KAGGLE_USERNAME = os.environ.get("KAGGLE_USERNAME", "")\n',
              'KAGGLE_KEY = os.environ.get("KAGGLE_KEY", "")\n',
            ],
          },
        ],
      })
    );

    injectNotebookNonSecretConfig(nbPath, {
      HF_REPO_ID: 'org/repo',
      HF_TOKEN: 'hf_secret_should_not_inject',
      KAGGLE_USERNAME: 'myuser',
      KAGGLE_KEY: 'kgat_secret_should_not_inject',
    });

    const out = JSON.parse(fs.readFileSync(nbPath, 'utf-8'));
    const joined = out.cells[0].source.join('');
    assert.ok(joined.includes('HF_REPO_ID = "org/repo"'));
    assert.ok(joined.includes('KAGGLE_USERNAME = "myuser"'));
    assert.ok(joined.includes('HF_TOKEN = os.environ.get("HF_TOKEN", "")'));
    assert.ok(joined.includes('KAGGLE_KEY = os.environ.get("KAGGLE_KEY", "")'));
  });

  it('resolveCanonicalHfFolderForClass prefers existing slug folder over legacy CLS-xxx kode_kelas', async () => {
    assert.equal(extractHfFolderFromPath('data/soffell-unggu-13lt/img_01.jpg'), 'soffell-unggu-13lt');
    assert.equal(
      pickDominantHfFolder(
        [
          'data/soffell-unggu-13lt/1.jpg',
          'data/soffell-unggu-13lt/2.jpg',
          'data/CLS-004/pos_log.jpg',
        ],
        'CLS-004'
      ),
      'soffell-unggu-13lt'
    );

    const mockDb = {
      from() {
        return {
          select() { return this; },
          eq(_col, val) { this.val = val; return this; },
          not() { return this; },
          async limit() {
            if (this.val === 'k-legacy') {
              return {
                data: [
                  { hf_path: 'data/soffell-kuning13lt/a.jpg' },
                  { hf_path: 'data/CLS-025/b.jpg' },
                ],
              };
            }
            return { data: [] };
          },
        };
      },
    };

    assert.equal(
      await resolveCanonicalHfFolderForClass('k-legacy', 'CLS-025', { dbClient: mockDb }),
      'soffell-kuning13lt'
    );
    assert.equal(
      await resolveCanonicalHfFolderForClass('k-new', 'Produk Baru 123', { dbClient: mockDb }),
      'produk-baru-123'
    );
  });
});
