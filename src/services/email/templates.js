/**
 * Helper escape HTML untuk mencegah injeksi HTML/XSS pada template email
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmailLayout({ title, preheader, bodyHtml }) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || title);
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1E293B;">
  <span style="display:none;color:transparent;height:0;width:0;opacity:0;overflow:hidden;">${safePreheader}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#FFFFFF;border:2px solid #1E293B;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="background:#0CAF60;padding:18px 24px;border-bottom:2px solid #1E293B;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="width:34px;height:34px;background:#FFFFFF;border:2px solid #1E293B;border-radius:8px;text-align:center;vertical-align:middle;font-weight:800;font-size:18px;color:#0CAF60;">T</td>
                  <td style="padding-left:10px;font-weight:800;font-size:18px;color:#FFFFFF;">Tokiva POS</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;font-size:14px;line-height:1.6;color:#334155;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#F1F5F9;border-top:1px solid #CBD5E1;font-size:12px;color:#64748B;">
              Email ini dikirim otomatis oleh sistem <strong>Tokiva POS</strong>. Jika Anda tidak merasa melakukan permintaan ini, abaikan email ini dengan aman.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildVerificationEmail({ nama, namaToko, verifyUrl, otp, expiresMinutes = 30 }) {
  const safeNama = escapeHtml(nama || 'Pemilik Toko');
  const safeToko = escapeHtml(namaToko || 'Toko Anda');
  const safeUrl = escapeHtml(verifyUrl);
  const safeOtp = escapeHtml(otp);

  const subject = `[Tokiva POS] Verifikasi Email Pendaftaran ${namaToko || 'Toko Anda'}`;
  const html = renderEmailLayout({
    title: subject,
    preheader: `Kode verifikasi Tokiva Anda: ${otp}`,
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#0F172A;">Halo, ${safeNama}</h2>
      <p style="margin:0 0 14px;">Terima kasih telah mendaftarkan <strong>${safeToko}</strong> di Tokiva POS. Klik tombol di bawah ini atau masukkan kode OTP untuk mengaktifkan akun Anda:</p>
      <div style="margin:18px 0;text-align:center;">
        <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#0CAF60;color:#FFFFFF;text-decoration:none;font-weight:700;border:2px solid #1E293B;border-radius:999px;">Verifikasi Email Sekarang</a>
      </div>
      <div style="margin:18px 0;padding:14px;background:#F8FAFC;border:2px dashed #94A3B8;border-radius:10px;text-align:center;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748B;margin-bottom:4px;">Kode Verifikasi (OTP)</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:6px;color:#0F172A;font-family:monospace;">${safeOtp}</div>
      </div>
      <p style="margin:0;font-size:12px;color:#64748B;">Tautan dan kode berlaku selama <strong>${expiresMinutes} menit</strong> dan hanya dapat dipakai satu kali.</p>
    `,
  });

  const text = `Halo ${nama || 'Pemilik Toko'},\n\nAktifkan akun ${namaToko || 'Toko Anda'} di Tokiva POS melalui tautan berikut:\n${verifyUrl}\n\nAtau masukkan kode OTP: ${otp}\nBerlaku selama ${expiresMinutes} menit.`;

  return { subject, html, text };
}

export function buildResetPasswordEmail({ nama, resetUrl, otp, expiresMinutes = 15 }) {
  const safeNama = escapeHtml(nama || 'Pengguna Tokiva');
  const safeUrl = escapeHtml(resetUrl);
  const safeOtp = escapeHtml(otp);

  const subject = '[Tokiva POS] Instruksi Reset Kata Sandi Akun';
  const html = renderEmailLayout({
    title: subject,
    preheader: `Kode reset kata sandi Tokiva Anda: ${otp}`,
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#0F172A;">Permintaan Reset Kata Sandi</h2>
      <p style="margin:0 0 14px;">Halo <strong>${safeNama}</strong>, kami menerima permintaan untuk mengatur ulang kata sandi akun Tokiva POS Anda.</p>
      <div style="margin:18px 0;text-align:center;">
        <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#0CAF60;color:#FFFFFF;text-decoration:none;font-weight:700;border:2px solid #1E293B;border-radius:999px;">Atur Ulang Kata Sandi</a>
      </div>
      <div style="margin:18px 0;padding:14px;background:#F8FAFC;border:2px dashed #94A3B8;border-radius:10px;text-align:center;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748B;margin-bottom:4px;">Kode Reset (OTP)</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:6px;color:#0F172A;font-family:monospace;">${safeOtp}</div>
      </div>
      <p style="margin:0;font-size:12px;color:#64748B;">Berlaku selama <strong>${expiresMinutes} menit</strong>. Jika Anda tidak meminta reset kata sandi, abaikan email ini.</p>
    `,
  });

  const text = `Halo ${nama || 'Pengguna Tokiva'},\n\nAtur ulang kata sandi akun Tokiva Anda melalui tautan berikut:\n${resetUrl}\n\nAtau masukkan kode OTP: ${otp}\nBerlaku selama ${expiresMinutes} menit.`;

  return { subject, html, text };
}

export function buildKasirInviteEmail({ nama, namaToko, inviteUrl, expiresHours = 24 }) {
  const safeNama = escapeHtml(nama || 'Rekan Kasir');
  const safeToko = escapeHtml(namaToko || 'Toko Tokiva');
  const safeUrl = escapeHtml(inviteUrl);

  const subject = `[Tokiva POS] Undangan Bergabung sebagai Kasir di ${namaToko || 'Toko Tokiva'}`;
  const html = renderEmailLayout({
    title: subject,
    preheader: `Aktivasi akun kasir Anda untuk ${namaToko || 'Toko Tokiva'}`,
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#0F172A;">Selamat Bergabung, ${safeNama}!</h2>
      <p style="margin:0 0 14px;">Pemilik toko <strong>${safeToko}</strong> telah mengundang Anda sebagai staf kasir di <strong>Tokiva POS</strong>.</p>
      <p style="margin:0 0 14px;">Klik tombol di bawah ini untuk memverifikasi email sekaligus mengatur kata sandi dan PIN otorisasi 6-digit pribadi Anda:</p>
      <div style="margin:18px 0;text-align:center;">
        <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#0CAF60;color:#FFFFFF;text-decoration:none;font-weight:700;border:2px solid #1E293B;border-radius:999px;">Aktifkan Akun Kasir</a>
      </div>
      <p style="margin:0;font-size:12px;color:#64748B;">Tautan undangan berlaku selama <strong>${expiresHours} jam</strong> dan hanya dapat dipakai satu kali.</p>
    `,
  });

  const text = `Selamat bergabung ${nama || 'Rekan Kasir'}!\n\nPemilik toko ${namaToko || 'Toko Tokiva'} mengundang Anda sebagai kasir.\nBuka tautan berikut untuk mengatur kata sandi dan PIN kasir Anda:\n${inviteUrl}\n\nTautan berlaku ${expiresHours} jam.`;

  return { subject, html, text };
}
