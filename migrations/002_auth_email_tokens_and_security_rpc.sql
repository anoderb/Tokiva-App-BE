-- Migrasi Keamanan, Verifikasi Email Resend, dan Operasi Stok/Akuntansi Atomik
-- Jalankan di Supabase SQL Editor pada database PostgreSQL Tokiva POS.

-- 1. Perbesar kolom pin_kasir agar menampung hash bcrypt (sebelumnya VARCHAR(6))
ALTER TABLE IF EXISTS public.pengguna
  ALTER COLUMN pin_kasir TYPE TEXT;

-- 2. Tabel token verifikasi email, reset password, dan undangan kasir (Resend)
CREATE TABLE IF NOT EXISTS public.auth_email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  toko_id UUID REFERENCES public.toko(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'invite_kasir')),
  token_hash TEXT NOT NULL,
  otp_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_token_hash
  ON public.auth_email_tokens (token_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_email_purpose
  ON public.auth_email_tokens (email, purpose, dibuat_pada DESC);

ALTER TABLE public.auth_email_tokens ENABLE ROW LEVEL SECURITY;

-- Kebijakan default tertutup: hanya role server (service_role) yang dapat mengakses
DROP POLICY IF EXISTS auth_email_tokens_deny_all ON public.auth_email_tokens;
CREATE POLICY auth_email_tokens_deny_all
  ON public.auth_email_tokens
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- 3. Hilangkan trigger lama pemotongan stok agar tidak terjadi double-deduct
-- (Pemotongan stok sekarang diproses secara atomik & teragregasi via RPC)
DROP TRIGGER IF EXISTS trg_potong_stok_setelah_transaksi_detail ON public.transaksi_detail;

-- 4. RPC Atomik Penyesuaian Stok + Pencatatan Mutasi Stok
CREATE OR REPLACE FUNCTION public.adjust_produk_stok_atomic(
  p_toko_id UUID,
  p_produk_id UUID,
  p_delta NUMERIC,
  p_jenis VARCHAR DEFAULT 'penyesuaian',
  p_ref_id UUID DEFAULT NULL,
  p_catatan VARCHAR DEFAULT NULL,
  p_allow_negative BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  produk_id UUID,
  stok_sebelum NUMERIC,
  stok_sesudah NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stok_sebelum NUMERIC(12, 2);
  v_stok_sesudah NUMERIC(12, 2);
BEGIN
  SELECT stok INTO v_stok_sebelum
  FROM public.produk
  WHERE id = p_produk_id AND toko_id = p_toko_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan pada toko ini' USING ERRCODE = 'P0002';
  END IF;

  v_stok_sesudah := COALESCE(v_stok_sebelum, 0) + COALESCE(p_delta, 0);

  IF NOT p_allow_negative AND v_stok_sesudah < 0 THEN
    RAISE EXCEPTION 'Stok produk tidak mencukupi (tersedia %, dibutuhkan %)', v_stok_sebelum, ABS(p_delta)
      USING ERRCODE = 'P0001';
  END IF;

  IF p_allow_negative AND v_stok_sesudah < 0 THEN
    v_stok_sesudah := 0;
  END IF;

  UPDATE public.produk
  SET stok = v_stok_sesudah,
      diubah_pada = NOW()
  WHERE id = p_produk_id AND toko_id = p_toko_id;

  INSERT INTO public.mutasi_stok (
    toko_id, produk_id, jenis, ref_id, perubahan, stok_sebelum, stok_sesudah, catatan
  ) VALUES (
    p_toko_id, p_produk_id, p_jenis, p_ref_id, p_delta, v_stok_sebelum, v_stok_sesudah, p_catatan
  );

  RETURN QUERY SELECT p_produk_id, v_stok_sebelum, v_stok_sesudah;
END;
$$;

-- 5. RPC Atomik Penyesuaian Total Piutang Pelanggan
CREATE OR REPLACE FUNCTION public.adjust_pelanggan_piutang_atomic(
  p_toko_id UUID,
  p_pelanggan_id UUID,
  p_delta NUMERIC
)
RETURNS TABLE (
  pelanggan_id UUID,
  piutang_sebelum NUMERIC,
  piutang_sesudah NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sebelum NUMERIC(15, 2);
  v_sesudah NUMERIC(15, 2);
BEGIN
  SELECT COALESCE(total_piutang, 0) INTO v_sebelum
  FROM public.pelanggan
  WHERE id = p_pelanggan_id AND toko_id = p_toko_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pelanggan tidak ditemukan pada toko ini' USING ERRCODE = 'P0002';
  END IF;

  v_sesudah := GREATEST(0, v_sebelum + COALESCE(p_delta, 0));

  UPDATE public.pelanggan
  SET total_piutang = v_sesudah
  WHERE id = p_pelanggan_id AND toko_id = p_toko_id;

  RETURN QUERY SELECT p_pelanggan_id, v_sebelum, v_sesudah;
END;
$$;

-- 6. RPC Atomik Pembaruan Akumulasi Shift Kasir (Checkout, Void, Bayar Piutang)
CREATE OR REPLACE FUNCTION public.adjust_shift_counters_atomic(
  p_toko_id UUID,
  p_shift_id UUID,
  p_delta_transaksi INT DEFAULT 0,
  p_delta_tunai NUMERIC DEFAULT 0,
  p_delta_qris NUMERIC DEFAULT 0,
  p_delta_split NUMERIC DEFAULT 0,
  p_delta_bon NUMERIC DEFAULT 0
)
RETURNS TABLE (
  shift_id UUID,
  total_transaksi INT,
  total_tunai NUMERIC,
  total_qris NUMERIC,
  total_split NUMERIC,
  total_bon NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.shift_kasir s
  SET
    total_transaksi = GREATEST(0, COALESCE(s.total_transaksi, 0) + COALESCE(p_delta_transaksi, 0)),
    total_tunai = GREATEST(0, COALESCE(s.total_tunai, 0) + COALESCE(p_delta_tunai, 0)),
    total_qris = GREATEST(0, COALESCE(s.total_qris, 0) + COALESCE(p_delta_qris, 0)),
    total_split = GREATEST(0, COALESCE(s.total_split, 0) + COALESCE(p_delta_split, 0)),
    total_bon = GREATEST(0, COALESCE(s.total_bon, 0) + COALESCE(p_delta_bon, 0))
  WHERE s.id = p_shift_id AND s.toko_id = p_toko_id
  RETURNING s.id, s.total_transaksi, s.total_tunai, s.total_qris, s.total_split, s.total_bon;
END;
$$;
