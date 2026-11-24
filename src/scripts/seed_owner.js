import { supabaseAdmin } from '../lib/supabase.js';
import { hashPinKasir } from '../services/auth/pin.js';

async function seedOwner() {
  const email = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;
  const namaLengkap = process.env.SEED_OWNER_NAME || 'Owner Toko';
  if (!email || !password) {
    throw new Error('Wajib set SEED_OWNER_EMAIL dan SEED_OWNER_PASSWORD di environment (.env)');
  }
  const telepon = process.env.SEED_OWNER_PHONE || '0812-0000-0000';
  const tokoId = process.env.TOKO_ID || 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

  console.log(`Menginisialisasi akun Owner demo (${email})...`);

  try {
    // 1. Cek apakah pengguna sudah ada di auth.users
    const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    let authUser = listData?.users?.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!authUser) {
      console.log('Membuat akun baru di Supabase auth.users...');
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nama: namaLengkap, peran: 'owner' },
      });

      if (createError) {
        throw createError;
      }

      authUser = createData.user;
      console.log(`✅ Akun auth.users dibuat. ID: ${authUser.id}`);
    } else {
      console.log(`ℹ️ Akun auth.users sudah ada sebelumnya. ID: ${authUser.id}`);
      // Sinkronkan password sesuai SEED_OWNER_PASSWORD
      await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password, email_confirm: true });
    }

    // 2. Hubungkan ke tabel public.pengguna
    const { data: existingProfile } = await supabaseAdmin
      .from('pengguna')
      .select('id')
      .eq('id', authUser.id)
      .maybeSingle();

    const pinHash = await hashPinKasir('123456');

    if (!existingProfile) {
      console.log('Menambahkan profil ke public.pengguna...');
      const { error: insertError } = await supabaseAdmin
        .from('pengguna')
        .insert({
          id: authUser.id,
          toko_id: tokoId,
          nama_lengkap: namaLengkap,
          email,
          telepon,
          peran: 'owner',
          pin_kasir: pinHash,
          aktif: true,
        });

      if (insertError) {
        throw insertError;
      }
      console.log('✅ Profil public.pengguna berhasil disimpan!');
    } else {
      console.log('Menyinkronkan data profil di public.pengguna...');
      await supabaseAdmin
        .from('pengguna')
        .update({
          toko_id: tokoId,
          nama_lengkap: namaLengkap,
          peran: 'owner',
          pin_kasir: pinHash,
          aktif: true,
        })
        .eq('id', authUser.id);
      console.log('✅ Profil public.pengguna disinkronkan!');
    }

    console.log('\n======================================================');
    console.log('🎉 AKUN DEMO OWNER BERHASIL DISIAPKAN:');
    console.log(`Email    : ${email}`);
    console.log(`Password : ${password}`);
    console.log(`Peran    : owner`);
    console.log(`PIN Kasir: 123456`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Gagal menyiapkan akun demo:', err.message);
    process.exit(1);
  }
}

seedOwner();

