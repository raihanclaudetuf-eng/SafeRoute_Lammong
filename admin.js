// Inisialisasi Firebase
const firebaseConfig = {
  databaseURL: "https://safe-cfd6d-default-rtdb.firebaseio.com/",
};
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

// ATUR PASSWORD ADMIN DI SINI (Silakan ganti sesuai keinginanmu)
const PASSWORD_ADMIN = "lamongsaferai";

// Ambil status saat halaman dimuat dari Firebase
db.ref("sistem_ai_mode").once("value", (snapshot) => {
  const mode = snapshot.val();
  if (mode) {
    document.getElementById("input-mode").value = mode;
  }
});

function simpanMode() {
  const passwordInput = document.getElementById("input-password").value;
  const mode = document.getElementById("input-mode").value;

  // Cek apakah password cocok
  if (passwordInput !== PASSWORD_ADMIN) {
    alert("❌ Password admin salah! Anda tidak memiliki akses.");
    return;
  }

  // Jika password benar, simpan ke Firebase
  db.ref("sistem_ai_mode").set(mode, (error) => {
    if (error) {
      alert("Gagal memperbarui pengaturan server!");
    } else {
      alert(
        `✅ Pengaturan Berhasil Disimpan!\nStatus AI saat ini: ${mode}`,
      );
      window.location.href = "index.html";
    }
  });
}
