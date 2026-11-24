import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, Conflict, NotFound } from '../../utils/errors.js';

/**
 * Pembayaran Cicilan / Pelunasan Utang Faktur Kulakan Supplier
 */
export async function bayarUtangKulakan(tokoId, userId, kulakanId, payload) {
  const {
    nominal_bayar,
    metode = 'transfer',
    tgl_bayar,
    foto_bukti = null,
    catatan = null,
  } = payload;

  const nominal = Number(nominal_bayar);
  if (!Number.isFinite(nominal) || nominal <= 0) {
    throw new BadRequest('Nominal pembayaran utang kulakan harus lebih besar dari 0');
  }

  const { data: header, error: headErr } = await supabaseAdmin
    .from('kulakan')
    .select('*, pemasok:pemasok_id(id, nama)')
    .eq('id', kulakanId)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (headErr) throw headErr;
  if (!header) throw new NotFound('Faktur kulakan tidak ditemukan');

  if (header.lunas === true) {
    throw new BadRequest('Faktur kulakan ini sudah berstatus lunas sebelumnya');
  }

  const { data: payments } = await supabaseAdmin
    .from('arus_kas')
    .select('nominal')
    .eq('toko_id', tokoId)
    .eq('ref_id', kulakanId)
    .eq('kategori', 'kulakan')
    .eq('tipe', 'keluar');

  const totalSudahDibayar = (payments || []).reduce((sum, p) => sum + Number(p.nominal || 0), 0);
  const sisaUtangSaatIni = Math.max(0, Number(header.total_beli || 0) - totalSudahDibayar);

  if (nominal > sisaUtangSaatIni) {
    throw new BadRequest(
      `Nominal pembayaran (Rp${nominal.toLocaleString('id-ID')}) melebihi sisa utang faktur (Rp${sisaUtangSaatIni.toLocaleString('id-ID')})`
    );
  }

  const sisaUtangBaru = sisaUtangSaatIni - nominal;
  const isLunasBaru = sisaUtangBaru <= 0;

  if (isLunasBaru) {
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from('kulakan')
      .update({ lunas: true })
      .eq('id', kulakanId)
      .eq('toko_id', tokoId)
      .eq('lunas', false)
      .select('id')
      .maybeSingle();
    if (lockErr) throw lockErr;
    if (!locked) {
      throw new Conflict('Status faktur kulakan baru saja diperbarui oleh proses lain');
    }
  }

  const nowIso = new Date().toISOString();
  const tglKas = tgl_bayar || nowIso.slice(0, 10);

  const { data: kasRecord, error: kasErr } = await supabaseAdmin
    .from('arus_kas')
    .insert({
      toko_id: tokoId,
      tipe: 'keluar',
      kategori: 'kulakan',
      nominal: nominal,
      tgl_kas: tglKas,
      ref_id: kulakanId,
      kasir_id: userId,
      foto_nota: foto_bukti || null,
      catatan:
        catatan ||
        `Pelunasan Utang Faktur ${header.no_faktur} ke ${header.pemasok?.nama || 'Pemasok'} (${metode})`,
    })
    .select()
    .single();

  if (kasErr) throw kasErr;

  return {
    kulakan_id: kulakanId,
    no_faktur: header.no_faktur,
    total_beli: header.total_beli,
    nominal_dibayar: nominal,
    total_sudah_dibayar: totalSudahDibayar + nominal,
    sisa_utang: sisaUtangBaru,
    lunas: isLunasBaru,
    catatan_kas: kasRecord,
  };
}
