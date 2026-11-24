import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound, BadRequest } from '../../utils/errors.js';
import { validateQRIS, parseQRIS, convertQRIS } from '../../utils/qris-utils.js';
import QRCode from 'qrcode';

/**
 * Ambil Informasi Profil Lengkap Toko
 */
export async function getProfilToko(tokoId) {
  const { data: toko, error } = await supabaseAdmin
    .from('toko')
    .select('*')
    .eq('id', tokoId)
    .maybeSingle();

  if (error) throw error;
  if (!toko) throw new NotFound('Data toko tidak ditemukan');

  return toko;
}

/**
 * Perbarui Profil Toko (Nama, Alamat, Telepon, Pemilik)
 */
export async function updateProfilToko(tokoId, payload) {
  const { data: exist } = await supabaseAdmin
    .from('toko')
    .select('id')
    .eq('id', tokoId)
    .maybeSingle();

  if (!exist) throw new NotFound('Data toko tidak ditemukan');

  const updateFields = {
    diubah_pada: new Date().toISOString(),
  };

  if (payload.nama !== undefined) updateFields.nama = payload.nama.trim();
  if (payload.pemilik !== undefined) updateFields.pemilik = payload.pemilik.trim();
  if (payload.telepon !== undefined) updateFields.telepon = payload.telepon.trim();
  if (payload.alamat !== undefined) updateFields.alamat = payload.alamat.trim();
  if (payload.kota !== undefined) updateFields.kota = payload.kota.trim();
  if (payload.logo_url !== undefined) updateFields.logo_url = payload.logo_url;

  const { data, error } = await supabaseAdmin
    .from('toko')
    .update(updateFields)
    .eq('id', tokoId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Perbarui Pengaturan Struk Cetak Thermal (58mm / 80mm)
 */
export async function updatePengaturanStruk(tokoId, payload) {
  const { data: exist } = await supabaseAdmin
    .from('toko')
    .select('id')
    .eq('id', tokoId)
    .maybeSingle();

  if (!exist) throw new NotFound('Data toko tidak ditemukan');

  const updateFields = {
    diubah_pada: new Date().toISOString(),
  };

  if (payload.struk_header !== undefined) updateFields.struk_header = payload.struk_header;
  if (payload.struk_footer !== undefined) updateFields.struk_footer = payload.struk_footer;
  if (payload.lebar_kertas !== undefined) {
    if (!['58mm', '80mm'].includes(payload.lebar_kertas)) {
      throw new BadRequest("Lebar kertas printer harus '58mm' atau '80mm'");
    }
    updateFields.lebar_kertas = payload.lebar_kertas;
  }
  if (payload.logo_url !== undefined) updateFields.logo_url = payload.logo_url;

  const { data, error } = await supabaseAdmin
    .from('toko')
    .update(updateFields)
    .eq('id', tokoId)
    .select('id, nama, struk_header, struk_footer, lebar_kertas, logo_url')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Status Konfigurasi QRIS Toko
 */
export async function getQrisStatus(tokoId) {
  const { data: toko, error } = await supabaseAdmin
    .from('toko')
    .select('id, nama, qris_string, qris_status, qris_info, qris_aktif, qris_foto_url, qris_mid')
    .eq('id', tokoId)
    .maybeSingle();

  if (error) throw error;
  if (!toko) throw new NotFound('Data toko tidak ditemukan');

  return {
    qris_status: toko.qris_status || (toko.qris_string ? 'valid' : 'empty'),
    qris_aktif: Boolean(toko.qris_aktif),
    qris_info: toko.qris_info || null,
    qris_string: toko.qris_string || null,
    qris_foto_url: toko.qris_foto_url || null,
    qris_mid: toko.qris_mid || null,
    merchant_name: toko.qris_info?.merchant_name || toko.nama,
    merchant_city: toko.qris_info?.merchant_city || '',
  };
}

/**
 * Perbarui Pengaturan QRIS Statis Toko & Validasi EMVCo
 */
export async function updatePengaturanQRIS(tokoId, payload) {
  const { data: exist } = await supabaseAdmin
    .from('toko')
    .select('id, nama, qris_mid, qris_foto_url')
    .eq('id', tokoId)
    .maybeSingle();

  if (!exist) throw new NotFound('Data toko tidak ditemukan');

  const updateFields = {
    diubah_pada: new Date().toISOString(),
  };

  let infoRingkas = null;

  // Jika owner mengirim string QRIS statis (hasil scan atau unggah)
  if (payload.qris_string !== undefined) {
    const clean = String(payload.qris_string || '').trim();

    if (!clean) {
      // Hapus QRIS
      updateFields.qris_string = null;
      updateFields.qris_status = 'empty';
      updateFields.qris_info = null;
      updateFields.qris_aktif = false;
    } else {
      // Validasi ketat format EMVCo MPM
      const val = validateQRIS(clean, {
        requireStatic: true,
        requireIdr: true,
        requireMerchantDetails: true,
      });

      if (!val.valid) {
        throw new BadRequest('QRIS tidak valid: ' + val.errors.join('; '));
      }

      const info = parseQRIS(clean);
      infoRingkas = {
        merchant_name: info.merchantName || exist.nama,
        merchant_city: info.merchantCity || '',
        merchant_id: info.merchantAccountInfo?.[0]?.merchantId || payload.qris_mid || '',
        currency: info.currency,
        country: info.countryCode,
        method: info.method,
      };

      updateFields.qris_string = clean;
      updateFields.qris_status = 'valid';
      updateFields.qris_info = infoRingkas;
      updateFields.qris_aktif = true;
      if (!payload.qris_mid && infoRingkas.merchant_id) {
        updateFields.qris_mid = infoRingkas.merchant_id;
      }
    }
  }

  if (payload.qris_foto_url !== undefined) updateFields.qris_foto_url = payload.qris_foto_url;
  if (payload.qris_mid !== undefined) updateFields.qris_mid = payload.qris_mid ? payload.qris_mid.trim() : null;

  const { data, error } = await supabaseAdmin
    .from('toko')
    .update(updateFields)
    .eq('id', tokoId)
    .select('id, nama, qris_string, qris_status, qris_info, qris_aktif, qris_foto_url, qris_mid')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Generate Dynamic QRIS ber-nominal on-the-fly untuk Transaksi Kasir POS
 */
export async function generateDynamicQris(tokoId, amount) {
  const nominal = Math.round(Number(amount));
  if (!Number.isSafeInteger(nominal) || nominal <= 0) {
    throw new BadRequest('Nominal pembayaran QRIS harus berupa bilangan bulat positif lebih dari 0');
  }

  const { data: toko, error } = await supabaseAdmin
    .from('toko')
    .select('id, nama, qris_string, qris_aktif, qris_status, qris_info')
    .eq('id', tokoId)
    .maybeSingle();

  if (error) throw error;
  if (!toko) throw new NotFound('Data toko tidak ditemukan');

  if (!toko.qris_string || !toko.qris_aktif) {
    throw new BadRequest(
      'QRIS toko belum diatur atau dinonaktifkan. Silakan hubungi Owner untuk mengunggah QRIS statis toko di Pengaturan.'
    );
  }

  try {
    // 1. Konversi EMVCo: ubah Tag 01 ke '12', suntik Tag 54 nominal, hitung ulang CRC16
    const dynamicQris = convertQRIS(toko.qris_string, { amount: nominal });

    // 2. Render QR Image PNG Data URL
    const qrImage = await QRCode.toDataURL(dynamicQris, {
      margin: 1,
      scale: 8,
      errorCorrectionLevel: 'M',
    });

    const refId = `QRIS-${Date.now().toString().slice(-6)}`;
    const merchantName = toko.qris_info?.merchant_name || toko.nama;
    const merchantCity = toko.qris_info?.merchant_city || '';

    return {
      qris_dinamis: dynamicQris,
      qr_image: qrImage,
      nominal,
      merchant_name: merchantName,
      merchant_city: merchantCity,
      ref_id: refId,
      expires_in_seconds: 300,
    };
  } catch (err) {
    throw new BadRequest(err.message || 'Gagal mengubah QRIS menjadi QR dinamis');
  }
}
