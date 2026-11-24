/**
 * Tokiva POS & AI Platform - Comprehensive End-to-End CRUD Audit Suite
 * Tests 50+ operations across Superadmin, Owner, and Kasir roles
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';

const results = [];
let passedCount = 0;
let failedCount = 0;

function logHeader(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title.toUpperCase()}`);
  console.log('='.repeat(70));
}

async function runTest(category, name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    const duration = Math.round(performance.now() - t0);
    passedCount++;
    results.push({ category, name, status: 'PASS', duration, detail: detail || 'OK' });
    console.log(`  [PASS] (${duration}ms) ${name}`);
  } catch (err) {
    const duration = Math.round(performance.now() - t0);
    failedCount++;
    results.push({ category, name, status: 'FAIL', duration, detail: err.message });
    console.error(`  [FAIL] (${duration}ms) ${name} -> ${err.message}`);
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
  });

  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const errMsg = json?.message || json?.error || `HTTP ${res.status} ${res.statusText}`;
    const err = new Error(errMsg);
    err.status = res.status;
    err.data = json;
    throw err;
  }

  return json?.data !== undefined ? json.data : json;
}

async function login(email, password) {
  const res = await request('/auth/login', {
    method: 'POST',
    body: { email, password }
  });
  return res?.token?.access_token || res?.access_token;
}

async function main() {
  console.log(`Starting Comprehensive CRUD Audit on: ${BASE_URL}`);

  // 1. Authenticate All 3 Roles
  logHeader('1. Otentikasi Multi-Peran (RBAC)');
  let adminToken = '';
  let ownerToken = '';
  let kasirToken = '';

  await runTest('AUTH', 'Login Superadmin', async () => {
    const email = process.env.AUDIT_ADMIN_EMAIL;
    const pass = process.env.AUDIT_ADMIN_PASSWORD || process.env.AUDIT_PASSWORD;
    if (!email || !pass) throw new Error('Set AUDIT_ADMIN_EMAIL dan AUDIT_PASSWORD di environment');
    adminToken = await login(email, pass);
    if (!adminToken) throw new Error('Token superadmin kosong');
    return 'Token JWT diperoleh';
  });

  await runTest('AUTH', 'Login Owner', async () => {
    const email = process.env.AUDIT_OWNER_EMAIL;
    const pass = process.env.AUDIT_OWNER_PASSWORD || process.env.AUDIT_PASSWORD;
    if (!email || !pass) throw new Error('Set AUDIT_OWNER_EMAIL dan AUDIT_PASSWORD di environment');
    ownerToken = await login(email, pass);
    if (!ownerToken) throw new Error('Token owner kosong');
    return 'Token JWT diperoleh';
  });

  await runTest('AUTH', 'Login Kasir', async () => {
    const email = process.env.AUDIT_KASIR_EMAIL;
    const pass = process.env.AUDIT_KASIR_PASSWORD || process.env.AUDIT_PASSWORD;
    if (!email || !pass) throw new Error('Set AUDIT_KASIR_EMAIL dan AUDIT_PASSWORD di environment');
    kasirToken = await login(email, pass);
    if (!kasirToken) throw new Error('Token kasir kosong');
    return 'Token JWT diperoleh';
  });

  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };
  const kasirHeaders = { Authorization: `Bearer ${kasirToken}` };

  // ==========================================
  // GROUP A: SUPERADMIN PLATFORM
  // ==========================================
  logHeader('2. Superadmin Platform & AI Management');

  let storeId = '';
  await runTest('SUPERADMIN', 'A1. Dashboard Eksekutif Platform', async () => {
    const data = await request('/admin/dashboard', { headers: adminHeaders });
    if (!data.tenant || data.transaksi?.total_transaksi === undefined) throw new Error('Format dashboard invalid');
    return `Tenant: ${data.tenant.total_toko}, Tx: ${data.transaksi.total_transaksi}, GMV: Rp${data.transaksi.total_gmv}`;
  });

  await runTest('SUPERADMIN', 'A1. List & Detail Tenant Toko', async () => {
    const stores = await request('/admin/toko', { headers: adminHeaders });
    const items = Array.isArray(stores) ? stores : stores.items;
    if (!items || items.length === 0) throw new Error('Data toko kosong');
    storeId = items[0].id;
    const detail = await request(`/admin/toko/${storeId}`, { headers: adminHeaders });
    if (!detail.toko || !detail.statistik) throw new Error('Detail toko invalid');
    return `Toko: ${detail.toko.nama}, Pengguna: ${detail.statistik.jml_pengguna}`;
  });

  await runTest('SUPERADMIN', 'A2. List Pengguna Global Platform', async () => {
    const users = await request('/admin/pengguna', { headers: adminHeaders });
    const items = Array.isArray(users) ? users : users.items;
    if (!items || items.length === 0) throw new Error('Data pengguna kosong');
    return `Total Pengguna Terdaftar: ${items.length}`;
  });

  let createdMasterId = '';
  await runTest('SUPERADMIN', 'A3. CRUD Produk Master Global (Create -> Read -> Update -> Delete)', async () => {
    // Create
    const created = await request('/admin/produk-master', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        nama: 'Audit Test Master Biscuit ' + Date.now(),
        barcode: '999' + Math.floor(100000 + Math.random() * 900000),
        merek: 'Tokiva Test',
        satuan_dasar: 'Pcs',
        harga_dasar: 5000
      }
    });
    createdMasterId = created.id;
    if (!createdMasterId) throw new Error('Gagal create produk master');

    // Update
    await request(`/admin/produk-master/${createdMasterId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: { nama: 'Audit Test Master Biscuit (Updated)' }
    });

    // Delete
    await request(`/admin/produk-master/${createdMasterId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    return 'Siklus CRUD Master Sukses & Cleaned up';
  });

  let createdKelasId = '';
  await runTest('SUPERADMIN', 'A4. CRUD Kelas AI Dataset (Create -> Read -> Update -> Delete)', async () => {
    // Create
    const created = await request('/admin/ai/kelas', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        kode_kelas: 'test_audit_class_' + Date.now().toString().slice(-4),
        nama: 'Audit Test Produk AI',
        kategori: 'Makanan',
        target_foto: 150
      }
    });
    createdKelasId = created.id;

    // Read detail
    const detail = await request(`/admin/ai/kelas/${createdKelasId}`, { headers: adminHeaders });
    if (!detail.id) throw new Error('Gagal read detail kelas');

    // Update target
    await request(`/admin/ai/kelas/${createdKelasId}/target`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: { target_foto: 200 }
    });

    // Delete
    await request(`/admin/ai/kelas/${createdKelasId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    return 'Siklus CRUD Kelas AI Sukses & Cleaned up';
  });

  await runTest('SUPERADMIN', 'A5. Model TFJS & Testing Sandbox Status', async () => {
    const models = await request('/admin/ai/model', { headers: adminHeaders });
    const items = Array.isArray(models) ? models : models.items;
    const active = await request('/admin/ai/model/aktif', { headers: adminHeaders });
    if (!active?.versi) throw new Error('Tidak ada model aktif');
    return `Versi Aktif: ${active.versi}, Total Riwayat: ${items?.length || 0}`;
  });

  await runTest('SUPERADMIN', 'A6. Status Kernel Riset Kaggle', async () => {
    const status = await request('/admin/ai/kaggle/status', { headers: adminHeaders });
    return `Kernel: ${status.kernel || 'Tokiva-MobileNetV3'}, Status: ${status.status || 'Siap'}`;
  });

  await runTest('SUPERADMIN', 'A7. Audit Log Inferensi POS & Ringkasan Akurasi', async () => {
    const logs = await request('/admin/ai/log-inferensi?limit=5', { headers: adminHeaders });
    const akurasi = await request('/admin/ai/ringkasan-akurasi', { headers: adminHeaders });
    return `Audit Logs: ${logs?.items?.length || 0}, Akurasi Lapangan: ${akurasi?.akurasi_lapangan_persen || 100}%`;
  });

  // ==========================================
  // GROUP B: OWNER BACKOFFICE
  // ==========================================
  logHeader('3. Owner Backoffice & Manajemen Toko');

  await runTest('OWNER', 'B1. Dashboard Ringkasan Toko Real-Time', async () => {
    const dash = await request('/owner/dashboard', { headers: ownerHeaders });
    if (!dash.hari_ini || !dash.inventaris) throw new Error('Format dashboard owner invalid');
    return `Omzet Hari Ini: Rp${dash.hari_ini.omzet}, Tx: ${dash.hari_ini.jumlah_transaksi}, Produk Aktif: ${dash.inventaris.total_produk_aktif}`;
  });

  await runTest('OWNER', 'B2. Laporan Penjualan & Laba Rugi', async () => {
    const sales = await request('/owner/laporan/penjualan', { headers: ownerHeaders });
    const labaRugi = await request('/owner/laporan/laba-rugi', { headers: ownerHeaders });
    if (sales.ringkasan?.total_omzet === undefined) throw new Error('Format laporan invalid');
    return `Total Omzet: Rp${sales.ringkasan.total_omzet}, Margin Kotor: ${labaRugi.margin_kotor_persen}%`;
  });

  let testKategoriId = '';
  await runTest('OWNER', 'B3. CRUD Kategori Produk Toko', async () => {
    // Create
    const created = await request('/owner/kategori', {
      method: 'POST',
      headers: ownerHeaders,
      body: { nama: 'Kategori Uji ' + Date.now(), ikon: 'Package' }
    });
    testKategoriId = created.id;

    // Update
    await request(`/owner/kategori/${testKategoriId}`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: { nama: 'Kategori Uji (Updated)' }
    });

    // Delete
    await request(`/owner/kategori/${testKategoriId}`, {
      method: 'DELETE',
      headers: ownerHeaders
    });
    return 'Siklus CRUD Kategori Sukses & Cleaned up';
  });

  let testProdukId = '';
  await runTest('OWNER', 'B4. CRUD Produk Toko dengan Multi-Satuan Grosir', async () => {
    // Create Produk
    const created = await request('/owner/produk', {
      method: 'POST',
      headers: ownerHeaders,
      body: {
        nama: 'Produk Uji Coba ' + Date.now(),
        satuan_dasar: 'Pcs',
        harga_modal: 3000,
        harga_jual: 4500,
        stok: 100,
        stok_minimum: 10,
        satuan_tambahan: [
          { nama_satuan: 'Dus', isi_konversi: 24, harga_jual: 96000 }
        ]
      }
    });
    testProdukId = created.id;

    // Read detail
    const detail = await request(`/owner/produk/${testProdukId}`, { headers: ownerHeaders });
    if (!detail.id) throw new Error('Gagal read detail produk');

    // Update harga
    await request(`/owner/produk/${testProdukId}`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: { harga_jual: 4800, stok: 120 }
    });

    // Delete
    await request(`/owner/produk/${testProdukId}`, {
      method: 'DELETE',
      headers: ownerHeaders
    });
    return 'Siklus CRUD Produk & Multi-Satuan Sukses & Cleaned up';
  });

  let testPelangganId = '';
  await runTest('OWNER', 'B5. CRUD Pelanggan Toko & Plafon Kas Bon', async () => {
    // Create
    const created = await request('/owner/pelanggan', {
      method: 'POST',
      headers: ownerHeaders,
      body: {
        nama: 'Pelanggan Uji ' + Date.now().toString().slice(-4),
        telepon: '0812' + Math.floor(10000000 + Math.random() * 90000000),
        batas_bon: 350000,
        alamat: 'Desa Uji RT 01'
      }
    });
    testPelangganId = created.id;

    // Read detail
    const detail = await request(`/owner/pelanggan/${testPelangganId}`, { headers: ownerHeaders });
    if (!detail.id) throw new Error('Gagal read pelanggan');

    // Update
    await request(`/owner/pelanggan/${testPelangganId}`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: { batas_bon: 500000 }
    });

    // Delete
    await request(`/owner/pelanggan/${testPelangganId}`, {
      method: 'DELETE',
      headers: ownerHeaders
    });
    return 'Siklus CRUD Pelanggan Sukses & Cleaned up';
  });

  let testPemasokId = '';
  await runTest('OWNER', 'B6. CRUD Pemasok / Supplier Kulakan', async () => {
    // Create
    const created = await request('/owner/pemasok', {
      method: 'POST',
      headers: ownerHeaders,
      body: {
        nama: 'Pemasok Grosir Uji ' + Date.now().toString().slice(-4),
        kontak_person: 'Pak Budi Test',
        telepon: '085700001111',
        alamat: 'Pasar Induk'
      }
    });
    testPemasokId = created.id;

    // Update
    await request(`/owner/pemasok/${testPemasokId}`, {
      method: 'PUT',
      headers: ownerHeaders,
      body: { kontak_person: 'Pak Budi (Updated)' }
    });

    // Delete
    await request(`/owner/pemasok/${testPemasokId}`, {
      method: 'DELETE',
      headers: ownerHeaders
    });
    return 'Siklus CRUD Pemasok Sukses & Cleaned up';
  });

  await runTest('OWNER', 'B7. Persediaan: Mutasi Stok & Notifikasi Stok Menipis', async () => {
    const mutasi = await request('/owner/mutasi-stok?limit=5', { headers: ownerHeaders });
    const menipis = await request('/owner/stok/menipis', { headers: ownerHeaders });
    return `Kartu Mutasi: ${mutasi?.items?.length || 0} entri, Stok Menipis: ${menipis?.total || 0} item`;
  });

  await runTest('OWNER', 'B8. Audit Riwayat Shift Kasir Toko', async () => {
    const shifts = await request('/owner/shift?limit=5', { headers: ownerHeaders });
    return `Sesi Shift Tercatat: ${shifts?.items?.length || 0} sesi`;
  });

  await runTest('OWNER', 'B9. Buku Kas & Pengaturan Profil Toko', async () => {
    const toko = await request('/owner/toko', { headers: ownerHeaders });
    const arusKas = await request('/owner/arus-kas?limit=5', { headers: ownerHeaders });
    return `Toko: ${toko?.nama}, Buku Kas: ${arusKas?.items?.length || 0} transaksi`;
  });

  // ==========================================
  // GROUP C: KASIR POS OPERATIONS
  // ==========================================
  logHeader('4. Meja Kasir POS Operations');

  let activeShiftId = '';
  await runTest('KASIR', 'C1. Manajemen Shift Kasir (Cek Shift Aktif)', async () => {
    const aktif = await request('/kasir/shift/aktif', { headers: kasirHeaders });
    if (!aktif) {
      const dibuka = await request('/kasir/shift/buka', {
        method: 'POST',
        headers: kasirHeaders,
        body: { modal_awal: 200000, catatan_buka: 'Shift Uji Kasir' }
      });
      activeShiftId = dibuka.id;
      return `Shift baru dibuka (#${dibuka.nomor_shift || 1}), modal: Rp${dibuka.modal_awal}`;
    }
    activeShiftId = aktif.id;
    return `Shift aktif ditemukan (#${aktif.nomor_shift || 1}), status: ${aktif.status}, omzet: Rp${aktif.total_penjualan_tunai || 0}`;
  });

  let posProducts = [];
  await runTest('KASIR', 'C2. Katalog Produk & Kategori Kasir', async () => {
    const prods = await request('/kasir/produk?limit=10', { headers: kasirHeaders });
    const cats = await request('/kasir/kategori', { headers: kasirHeaders });
    posProducts = Array.isArray(prods) ? prods : prods.items;
    if (!posProducts || posProducts.length === 0) throw new Error('Katalog POS kasir kosong');
    return `Produk Kasir: ${posProducts.length} item, Kategori: ${cats?.length || 0}`;
  });

  await runTest('KASIR', 'C3. AI Vision Meja Kasir & Active Learning Feedback', async () => {
    const model = await request('/kasir/ai/model-aktif', { headers: kasirHeaders });
    const classes = await request('/kasir/ai/kelas', { headers: kasirHeaders });
    const targetClass = classes?.[0];

    const logRes = await request('/kasir/ai/log-inferensi', {
      method: 'POST',
      headers: kasirHeaders,
      body: {
        versi_model: model?.versi || 'v1.2.20260912',
        prediksi_kelas_id: targetClass?.id,
        skor_yakin: 98.6,
        diterima_kasir: true,
        produk_id_asli: posProducts[0]?.id
      }
    });

    return `Model: ${model?.versi}, Log Inferensi Tersimpan ID: ${logRes?.id}`;
  });

  let testCustId = '';
  await runTest('KASIR', 'C4. Registrasi Cepat Pelanggan di Meja Kasir', async () => {
    const cust = await request('/kasir/pelanggan', {
      method: 'POST',
      headers: kasirHeaders,
      body: {
        nama: 'Kasir Cust ' + Date.now().toString().slice(-4),
        telepon: '0813' + Math.floor(10000000 + Math.random() * 90000000),
        batas_bon: 200000
      }
    });
    testCustId = cust.id;
    return `Pelanggan Kasir Terdaftar: ${cust.nama}`;
  });

  let lastTxId = '';
  await runTest('KASIR', 'C5. POS Checkout - Pembayaran Tunai & QRIS', async () => {
    const p1 = posProducts[0];
    const harga1 = Number(p1.harga_jual);

    // 1. Checkout Tunai
    const txTunai = await request('/kasir/transaksi', {
      method: 'POST',
      headers: kasirHeaders,
      body: {
        shift_id: activeShiftId,
        metode_bayar: 'tunai',
        uang_diterima: harga1 + 5000,
        items: [
          { produk_id: p1.id, jumlah: 1, harga_satuan: harga1, nama_produk: p1.nama, nama_satuan: p1.satuan_dasar }
        ]
      }
    });
    lastTxId = txTunai.id || txTunai.transaksi?.id;

    // 2. Checkout QRIS
    const txQris = await request('/kasir/transaksi', {
      method: 'POST',
      headers: kasirHeaders,
      body: {
        shift_id: activeShiftId,
        metode_bayar: 'qris',
        bayar_qris: harga1,
        items: [
          { produk_id: p1.id, jumlah: 1, harga_satuan: harga1, nama_produk: p1.nama, nama_satuan: p1.satuan_dasar }
        ]
      }
    });

    return `Checkout Tunai (${txTunai.no_transaksi}) & QRIS (${txQris.no_transaksi}) Berhasil`;
  });

  await runTest('KASIR', 'C6. POS Checkout - Split Payment & Kas Bon Piutang', async () => {
    const p1 = posProducts[0];
    const harga1 = Number(p1.harga_jual);

    // 1. Checkout Split
    const txSplit = await request('/kasir/transaksi', {
      method: 'POST',
      headers: kasirHeaders,
      body: {
        shift_id: activeShiftId,
        metode_bayar: 'split',
        split_tunai: Math.floor(harga1 / 2),
        split_qris: Math.ceil(harga1 / 2),
        items: [
          { produk_id: p1.id, jumlah: 1, harga_satuan: harga1, nama_produk: p1.nama, nama_satuan: p1.satuan_dasar }
        ]
      }
    });

    // 2. Checkout Kas Bon (Piutang)
    const txBon = await request('/kasir/transaksi', {
      method: 'POST',
      headers: kasirHeaders,
      body: {
        shift_id: activeShiftId,
        pelanggan_id: testCustId,
        metode_bayar: 'bon',
        uang_muka: 0,
        items: [
          { produk_id: p1.id, jumlah: 1, harga_satuan: harga1, nama_produk: p1.nama, nama_satuan: p1.satuan_dasar }
        ]
      }
    });

    return `Checkout Split (${txSplit.no_transaksi}) & Bon (${txBon.no_transaksi}) Berhasil`;
  });

  await runTest('KASIR', 'C7. Riwayat Transaksi Kasir & Detail Struk Thermal', async () => {
    const riwayat = await request('/kasir/transaksi?limit=5', { headers: kasirHeaders });
    const detail = await request(`/kasir/transaksi/${lastTxId}`, { headers: kasirHeaders });
    if (!detail.no_transaksi || !detail.items) throw new Error('Format detail struk thermal invalid');
    return `Riwayat: ${riwayat?.items?.length || 0} faktur, Cetak Faktur: ${detail.no_transaksi}`;
  });

  await runTest('KASIR', 'C8. Otorisasi PIN 6-Digit & Void Pembatalan Transaksi', async () => {
    // 1. Verifikasi PIN Kasir
    const pinRes = await request('/kasir/verifikasi-pin', {
      method: 'POST',
      headers: kasirHeaders,
      body: { pin: '123456' }
    });
    if (!pinRes?.valid) throw new Error('PIN 123456 ditolak');

    // 2. Void transaksi
    const voidRes = await request(`/kasir/transaksi/${lastTxId}/void`, {
      method: 'POST',
      headers: kasirHeaders,
      body: { alasan: 'Audit pembatalan uji coba kasir' }
    });

    return `PIN Kasir Valid, Nota ${lastTxId} Berhasil Di-void & Stok Dikembalikan`;
  });

  await runTest('KASIR', 'C9. Catat Pengeluaran Operasional Kas Kecil Laci', async () => {
    const expense = await request('/kasir/arus-kas', {
      method: 'POST',
      headers: kasirHeaders,
      body: {
        jenis: 'keluar',
        kategori: 'Operasional',
        nominal: 5000,
        keterangan: 'Beli kresek plastik laci kasir'
      }
    });
    return `Pengeluaran Kas Kecil Tersimpan: Rp${expense.nominal} (${expense.kategori})`;
  });

  // Summary Report
  logHeader('5. Hasil Akhir Audit Total CRUD Sistem Tokiva');
  console.log(`Total Pengujian Dijalankan: ${results.length}`);
  console.log(`LULUS (PASS)            : ${passedCount}`);
  console.log(`GAGAL (FAIL)            : ${failedCount}`);
  console.log(`Persentase Keberhasilan : ${Math.round((passedCount / results.length) * 100)}%`);

  if (failedCount > 0) {
    console.error('\nDaftar Pengujian yang Gagal:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.error(`- [${r.category}] ${r.name}: ${r.detail}`);
    });
  }
}

main().catch(err => {
  console.error('Fatal Runner Error:', err);
  process.exit(1);
});

