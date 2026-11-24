/**
 * Verification Test: Owner Tambah Produk dengan Dataset AI & Verifikasi Admin
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';

// 10x10 dummy JPEG base64
const DUMMY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAAKAAoBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

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

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const errMsg = json?.message || json?.error || `HTTP ${res.status}`;
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

async function run() {
  console.log('=== TEST ALUR TAMBAH PRODUK OWNER & VERIFIKASI AI ADMIN ===\n');

  // 1. Auth
  const ownerEmail = process.env.AUDIT_OWNER_EMAIL;
  const adminEmail = process.env.AUDIT_ADMIN_EMAIL;
  const auditPass = process.env.AUDIT_PASSWORD;
  if (!ownerEmail || !adminEmail || !auditPass) {
    throw new Error('Set AUDIT_OWNER_EMAIL, AUDIT_ADMIN_EMAIL, dan AUDIT_PASSWORD di environment');
  }
  const ownerToken = await login(ownerEmail, auditPass);
  console.log('✓ Owner logged in');

  const adminToken = await login(adminEmail, auditPass);
  console.log('✓ Admin logged in');

  const testBarcode = `899${Date.now().toString().slice(-9)}`;
  const testProductName = `Biskuit Uji AI ${Date.now().toString().slice(-4)}`;

  console.log(`\nMenambahkan produk baru: "${testProductName}" (Barcode: ${testBarcode})...`);

  // 2. Owner adds product with dataset
  const createdProd = await request('/owner/produk', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: {
      nama: testProductName,
      barcode: testBarcode,
      harga_modal: 5000,
      harga_jual: 7500,
      satuan_dasar: 'pcs',
      stok: 50,
      dataset_fotos: [
        { nama_file: 'front.jpg', base64: DUMMY_JPEG, sudut: 'Depan (Front)' },
        { nama_file: 'back.jpg', base64: DUMMY_JPEG, sudut: 'Belakang (Back)' },
        { nama_file: 'angle360.jpg', base64: DUMMY_JPEG, sudut: '360° Keliling' }
      ]
    }
  });

  console.log('✓ Produk berhasil dibuat ID:', createdProd.id);
  console.log('  Foto URL Sampul Katalog:', createdProd.foto_url ? '✓ Terupload otomatis dari dataset' : 'x Kosong');

  // 3. Superadmin checks AI classes
  const aiClassesRes = await request('/admin/ai/kelas', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const classList = Array.isArray(aiClassesRes) ? aiClassesRes : (aiClassesRes.items || []);
  const matchingClass = classList.find(k => k.nama === testProductName || k.barcode === testBarcode);
  if (!matchingClass) {
    throw new Error('Kelas AI untuk produk baru tidak ditemukan di ai_kelas!');
  }
  console.log('✓ Kelas AI otomatis terdaftar di admin:');
  console.log(`  Kode: ${matchingClass.kode_kelas}, Status: ${matchingClass.status}`);

  // 4. Superadmin checks unverified samples from Owner
  const ownerSamples = await request('/admin/ai/sampel?sumber=owner', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  const matchingSamples = ownerSamples.items ? ownerSamples.items.filter(s => s.kelas_id === matchingClass.id) : [];
  console.log(`✓ Admin menemukan ${matchingSamples.length} sampel foto yang dikirim Owner:`);
  for (const s of matchingSamples) {
    console.log(`  - Sampel ID: ${s.id}, Sudut: ${s.sudut}, Sumber: ${s.sumber}, Terverifikasi: ${s.terverifikasi}`);
  }

  if (matchingSamples.length < 3) {
    throw new Error(`Diharapkan minimal 3 sampel terunggah, tetapi ditemukan ${matchingSamples.length}`);
  }

  // 5. Superadmin Verifies the samples
  const sampleIds = matchingSamples.map(s => s.id);
  const verifyRes = await request('/admin/ai/sampel/verifikasi', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      sampel_ids: sampleIds,
      terverifikasi: true
    }
  });
  console.log('✓ Admin berhasil memverifikasi sampel secara batch:', verifyRes);

  // 6. Cleanup
  console.log('\nMembersihkan data uji...');
  await request(`/owner/produk/${createdProd.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  console.log('✓ Produk uji dinonaktifkan.');

  await request('/admin/ai/sampel/hapus-batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      sampel_ids: sampleIds
    }
  }).catch(() => {});
  console.log('✓ Sampel uji dibersihkan.');

  await request(`/admin/ai/kelas/${matchingClass.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  }).catch(() => {});
  console.log('✓ Kelas AI uji dibersihkan.');

  console.log('\n======================================================');
  console.log('  SEMUA TAHAPAN ALUR DATASET AI OWNER & ADMIN BERHASIL (100% PASS)');
  console.log('======================================================');
}

run().catch(err => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});
