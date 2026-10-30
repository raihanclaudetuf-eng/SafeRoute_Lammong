// Inisialisasi Firebase Realtime Database
const firebaseConfig = {
  databaseURL: "https://safe-cfd6d-default-rtdb.firebaseio.com/",
};
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

function simpanLaporan() {
  const kedalaman = document.getElementById("input-kedalaman").value;
  const arus = document.getElementById("input-arus").value;

  // Kirim data secara online ke Firebase Realtime Database
  db.ref("laporan_terkini").set(
    {
      kedalaman: kedalaman,
      arus: arus,
      waktu: new Date().toLocaleTimeString(),
    },
    (error) => {
      if (error) {
        alert("Gagal mengirim laporan!");
      } else {
        alert(
          `Laporan Berhasil Terkirim Secara Real-Time!\nKedalaman: ${kedalaman}\nArus: ${arus}`,
        );
        window.location.replace("index.html");
      }
    },
  );
}
