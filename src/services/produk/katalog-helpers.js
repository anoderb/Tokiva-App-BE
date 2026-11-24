import { supabaseAdmin } from '../../lib/supabase.js';
import { slugifyKodeKelas } from '../ai/helpers.js';
import { uploadBurstSampel } from '../ai/sampel.js';

export function mapProductWithMargin(p) {
  const jual = Number(p.harga_jual || 0);
  const modal = Number(p.harga_modal || 0);
  const marginRp = jual - modal;
  const marginPersen = modal > 0 ? Number(((marginRp / modal) * 100).toFixed(1)) : 0;
  return { ...p, margin_rp: marginRp, margin_persen: marginPersen };
}

export function matchesStockStatus(p, targetStatus) {
  const stok = Number(p.stok || 0);
  const min = Number(p.stok_min ?? 10);
  if (targetStatus === 'habis') return stok <= 0;
  if (targetStatus === 'menipis') return stok > 0 && stok <= min;
  if (targetStatus === 'aman') return stok > min;
  return true;
}

/** Menghitung ringkasan status stok dan valuasi modal untuk seluruh katalog toko. */
export async function computeStoreStockSummary(tokoId) {
  const { data: summaryRows } = await supabaseAdmin
    .from('produk')
    .select('stok, stok_min, harga_modal, aktif')
    .eq('toko_id', tokoId);

  const ringkasanStok = { total_sku: 0, aman: 0, menipis: 0, habis: 0, total_valuasi: 0 };
  for (const r of summaryRows || []) {
    ringkasanStok.total_sku += 1;
    const stokVal = Number(r.stok || 0);
    const minVal = Number(r.stok_min ?? 10);
    const modalVal = Number(r.harga_modal || 0);
    if (stokVal <= 0) ringkasanStok.habis += 1;
    else if (stokVal <= minVal) ringkasanStok.menipis += 1;
    else ringkasanStok.aman += 1;
    if (stokVal > 0 && modalVal > 0) ringkasanStok.total_valuasi += stokVal * modalVal;
  }
  return ringkasanStok;
}

/** Mendaftarkan foto dataset multi-sudut dari produk baru ke kelas AI Vision secara non-blocking. */
export async function registerProductAiDataset({ nama, barcode, kategori_id, master_id, rawDatasetFotos }) {
  try {
    let targetKelas = null;
    if (barcode) {
      const { data: kByBarcode } = await supabaseAdmin
        .from('ai_kelas')
        .select('id, kode_kelas, nama, total_foto, jml_supabase')
        .eq('barcode', barcode)
        .maybeSingle();
      targetKelas = kByBarcode;
    }

    if (!targetKelas) {
      const { data: kByName } = await supabaseAdmin
        .from('ai_kelas')
        .select('id, kode_kelas, nama, total_foto, jml_supabase')
        .ilike('nama', nama.trim())
        .maybeSingle();
      targetKelas = kByName;
    }

    let namaKategori = 'Umum';
    if (kategori_id) {
      const { data: katData } = await supabaseAdmin
        .from('kategori')
        .select('nama')
        .eq('id', kategori_id)
        .maybeSingle();
      if (katData?.nama) namaKategori = katData.nama;
    }

    if (!targetKelas) {
      let baseKode = slugifyKodeKelas(nama).slice(0, 50) || `produk-${Date.now()}`;
      const { data: existingKode } = await supabaseAdmin
        .from('ai_kelas')
        .select('id')
        .eq('kode_kelas', baseKode)
        .maybeSingle();

      const kodeKelas = existingKode ? `${baseKode}-${Date.now().toString().slice(-4)}` : baseKode;
      const { data: newKelas, error: newKErr } = await supabaseAdmin
        .from('ai_kelas')
        .insert({
          kode_kelas: kodeKelas,
          nama: nama.trim(),
          kategori: namaKategori,
          barcode: barcode || null,
          master_id: master_id || null,
          target_foto: 100,
          total_foto: 0,
          jml_supabase: 0,
          jml_hf: 0,
          status: 'Menunggu Verifikasi',
        })
        .select()
        .single();

      if (!newKErr && newKelas) targetKelas = newKelas;
    }

    if (targetKelas) {
      const validFotos = rawDatasetFotos
        .filter((item) => Boolean(item?.base64))
        .map((item) => ({ base64: item.base64, sudut_ambil: item.sudut || '360° Keliling' }));

      if (validFotos.length > 0) {
        await uploadBurstSampel({
          kelas_id: targetKelas.id,
          fotos: validFotos,
          sudut_ambil: '360° Keliling',
          sumber: 'owner_produk',
          terverifikasi: false,
        });
      }
    }
  } catch (aiErr) {
    console.warn('Peringatan: Gagal memproses dataset AI saat tambah produk:', aiErr.message);
  }
}
