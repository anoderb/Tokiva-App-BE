-- Migrasi AI v2 Hybrid Dual-Output (Softmax + Visual Embedding per Toko)
-- Aman & idempoten: hanya bersifat additive terhadap skema v1 yang sudah berjalan.
-- Jalankan di Supabase SQL Editor pada database PostgreSQL Tokiva POS.

-- 1. Tambah kolom pendukung track v1 / v2 pada public.ai_model
ALTER TABLE IF EXISTS public.ai_model
  ADD COLUMN IF NOT EXISTS model_family VARCHAR(10) NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS mendukung_embedding BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dimensi_embedding INT,
  ADD COLUMN IF NOT EXISTS path_centroids TEXT,
  ADD COLUMN IF NOT EXISTS path_embedding_meta TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_family'
  ) THEN
    ALTER TABLE public.ai_model
      ADD CONSTRAINT chk_ai_model_family CHECK (model_family IN ('v1', 'v2'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_dimensi_embedding'
  ) THEN
    ALTER TABLE public.ai_model
      ADD CONSTRAINT chk_ai_model_dimensi_embedding
      CHECK (dimensi_embedding IS NULL OR (dimensi_embedding > 0 AND dimensi_embedding <= 2048));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_model_family_aktif
  ON public.ai_model (model_family, aktif, tgl_rilis DESC);

-- 2. Tambah kolom pelacakan metode deteksi pada log inferensi POS (Softmax vs Embedding)
ALTER TABLE IF EXISTS public.ai_log_inferensi
  ADD COLUMN IF NOT EXISTS metode_deteksi VARCHAR(20) NOT NULL DEFAULT 'softmax';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_log_metode_deteksi'
  ) THEN
    ALTER TABLE public.ai_log_inferensi
      ADD CONSTRAINT chk_ai_log_metode_deteksi
      CHECK (metode_deteksi IN ('softmax', 'embedding'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_log_inferensi_metode
  ON public.ai_log_inferensi (metode_deteksi, waktu DESC);

-- 3. Tabel prototipe embedding sementara per toko (dibuat oleh Owner saat cold-start produk baru)
-- Struktur JSONB embedding: {"centroid": [float...], "prototypes": [[float...], ...]} (vektor L2-normalized)
CREATE TABLE IF NOT EXISTS public.ai_kelas_embedding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  toko_id UUID NOT NULL REFERENCES public.toko(id) ON DELETE CASCADE,
  produk_id UUID REFERENCES public.produk(id) ON DELETE CASCADE,
  kelas_id UUID NOT NULL REFERENCES public.ai_kelas(id) ON DELETE CASCADE,
  model_versi VARCHAR(30) NOT NULL REFERENCES public.ai_model(versi) ON DELETE CASCADE,
  embedding JSONB NOT NULL,
  dimensi INT NOT NULL DEFAULT 256 CHECK (dimensi > 0 AND dimensi <= 2048),
  jml_sampel INT NOT NULL DEFAULT 1 CHECK (jml_sampel >= 1),
  sumber VARCHAR(30) NOT NULL DEFAULT 'owner_produk'
    CHECK (sumber IN ('owner_produk', 'kasir_konfirmasi', 'recompute_admin')),
  status VARCHAR(20) NOT NULL DEFAULT 'aktif'
    CHECK (status IN ('aktif', 'terlatih', 'nonaktif')),
  dibuat_oleh UUID REFERENCES public.pengguna(id) ON DELETE SET NULL,
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  diubah_pada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ai_kelas_embedding_toko_kelas_versi UNIQUE (toko_id, kelas_id, model_versi)
);

CREATE INDEX IF NOT EXISTS idx_ai_kelas_embedding_pos_lookup
  ON public.ai_kelas_embedding (toko_id, model_versi, status)
  WHERE status = 'aktif';

CREATE INDEX IF NOT EXISTS idx_ai_kelas_embedding_admin_monitor
  ON public.ai_kelas_embedding (model_versi, status, diubah_pada DESC);

CREATE INDEX IF NOT EXISTS idx_ai_kelas_embedding_kelas
  ON public.ai_kelas_embedding (kelas_id);

CREATE INDEX IF NOT EXISTS idx_ai_kelas_embedding_produk
  ON public.ai_kelas_embedding (produk_id)
  WHERE produk_id IS NOT NULL;

ALTER TABLE public.ai_kelas_embedding ENABLE ROW LEVEL SECURITY;

-- Kebijakan default tertutup: hanya role server (service_role) yang dapat mengakses langsung
DROP POLICY IF EXISTS ai_kelas_embedding_deny_all ON public.ai_kelas_embedding;
CREATE POLICY ai_kelas_embedding_deny_all
  ON public.ai_kelas_embedding
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- 4. Fungsi RPC promosi otomatis embedding sementara -> 'terlatih' setelah model v2 baru selesai training
CREATE OR REPLACE FUNCTION public.promote_trained_ai_embeddings(
  p_model_versi VARCHAR,
  p_trained_kode_kelas TEXT[]
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT := 0;
BEGIN
  IF p_trained_kode_kelas IS NULL OR array_length(p_trained_kode_kelas, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.ai_kelas_embedding AS emb
  SET status = 'terlatih',
      diubah_pada = NOW()
  FROM public.ai_kelas AS k
  WHERE emb.kelas_id = k.id
    AND emb.status = 'aktif'
    AND (p_model_versi IS NULL OR emb.model_versi = p_model_versi OR emb.model_versi LIKE 'v2.%')
    AND k.kode_kelas = ANY (p_trained_kode_kelas);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
