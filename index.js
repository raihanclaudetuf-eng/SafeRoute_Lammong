// INISIALISASI FIREBASE
const firebaseConfig = {
  databaseURL: "https://safe-cfd6d-default-rtdb.firebaseio.com/",
};
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
// Variabel Global & Listener Live untuk Mode AI & Laporan dari Firebase
let modeAI = "ON";
let kondisiAirLokal = "Kering (Aman)";
let kondisiArusLokal = "Tenang";
// Mendengarkan perubahan status AI dari Firebase secara real-time
db.ref("sistem_ai_mode").on("value", (snapshot) => {
  const val = snapshot.val();
  if (val) {
    modeAI = val;
    console.log("Status AI disinkronkan dari server:", modeAI);
    inisialisasiTeks();
  }
});
const map = L.map("map", { zoomControl: false }).setView(
  [-7.2625, 112.5519],
  12,
);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);
// Mendengarkan laporan kedalaman air dari Firebase secara real-time
db.ref("laporan_terkini").on("value", (snapshot) => {
  const data = snapshot.val();
  if (data) {
    kondisiAirLokal = data.kedalaman || "Kering (Aman)";
    kondisiArusLokal = data.arus || "Tenang";
    inisialisasiTeks();
  }
});
// KONFIGURASI
const GEMINI_API_KEY = "";
const GEMINI_MODEL = "gemini-2.5-flash";
const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

const RUAS_BANJIR = [
  {
    nama: "Poros Morowudi - Benjeng (utama)",
    aktif: true,
    titik: [
      [-7.248258964737196, 112.56859953030484],
      [-7.2629, 112.4984],
    ],
  },
  {
    nama: "Cabang 1 (bwnjwng bp)",
    aktif: true,
    titik: [
      [-7.2629, 112.4984],
      [-7.265508137774267, 112.4721649379155],
    ],
  },
];
const dataTitikEvakuasi = [
  {
    nama: "Puskesmas Cerme",
    lat: -7.235467717803073,
    lng: 112.56425257469698,
    info: "pusat pelayanan medis darurat",
  },
  {
    nama: "Puskesmas Benjeng",
    lat: -7.259237035850619,
    lng: 112.50080162627141,
    info: "Pusat Pelayanan Medis Darurat",
  },
  {
    nama: "Puskesmas Balongpanggang",
    lat: -7.268000825397092,
    lng: 112.4441828532581,
    info: "pusat pelayanan medis darurat",
  },
];

let activeLayerGroup = L.layerGroup().addTo(map);

async function ambilRuteJalan(titik, hindari = null) {
  const coords = titik.map((p) => `${p[1]},${p[0]}`).join(";");
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson${hindari ? "&alternatives=true" : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes || !data.routes.length) {
      throw new Error("OSRM code: " + data.code);
    }

    const semuaRute = data.routes.map((r) =>
      r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    );
    let koordinat = semuaRute[0];

    if (hindari && semuaRute.length > 1) {
      const hindariRingan = hindari.filter((_, i) => i % 5 === 0);
      const skor = (rute) =>
        rute.filter(
          (p, i) =>
            i % 3 === 0 && hindariRingan.some((h) => map.distance(p, h) < 250),
        ).length;

      koordinat = semuaRute.reduce(
        (terbaik, r) => (skor(r) < skor(terbaik) ? r : terbaik),
        semuaRute[0],
      );
    }

    return { koordinat, dariJalan: true };
  } catch (err) {
    console.warn("Routing OSRM gagal, fallback garis lurus:", err);
    return { koordinat: titik, dariJalan: false };
  } finally {
    clearTimeout(timer);
  }
}

let cacheCuaca = { waktu: 0, hasil: null };
const CUACA_TTL = 5 * 60 * 1000; // 5 menit

async function getCuacaHulu() {
  try {
    if (modeAI === "OFF") return "Diabaikan (Mode Offline/Demo)";
    if (cacheCuaca.hasil && Date.now() - cacheCuaca.waktu < CUACA_TTL) {
      return cacheCuaca.hasil;
    }
    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=-7.4225&longitude=112.4358&current_weather=true",
    );
    const data = await response.json();
    const code = data.current_weather.weathercode;
    let hasil = "Aman / Cerah";
    if (code >= 61 && code <= 65) hasil = "Hujan Sedang / Deras";
    else if (code > 65) hasil = "Hujan Badai";
    cacheCuaca = { waktu: Date.now(), hasil };
    return hasil;
  } catch (err) {
    return "Gagal membaca satelit";
  }
}

let teksSeq = 0;
async function inisialisasiTeks() {
  const seq = ++teksSeq;
  const hulu = await getCuacaHulu();
  if (seq !== teksSeq) return; // ada panggilan yang lebih baru
  document.getElementById("label-banjir").innerHTML =
    `Hulu (Satelit): ${hulu} <br>Hilir (Firebase): <b>${kondisiAirLokal}</b>`;
}
inisialisasiTeks();

async function cekJalan() {
  const kendaraan = document.getElementById("kendaraan").value;
  const tujuanVal = document.getElementById("tujuan").value;
  const [destCoords, destName] = tujuanVal.split("|");
  const [destLat, destLng] = destCoords.split(",").map(Number);

  const btn = document.getElementById("btn-cek");
  const loader = document.getElementById("loader");
  const resultBox = document.getElementById("result-box");

  btn.disabled = true;
  loader.style.display = "block";
  loader.innerText = `🔄 Menghitung Rute ke ${destName}...`;
  resultBox.style.display = "none";

  if (!navigator.geolocation) {
    jalankanNavigasi(
      -7.164539,
      112.603332,
      destLat,
      destLng,
      destName,
      kendaraan,
      btn,
      loader,
    );
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      jalankanNavigasi(
        position.coords.latitude,
        position.coords.longitude,
        destLat,
        destLng,
        destName,
        kendaraan,
        btn,
        loader,
      );
    },
    (error) => {
      console.warn("GPS Gagal Terbaca. Memakai lokasi default (Bypass).");
      jalankanNavigasi(
        -7.164539,
        112.603332,
        destLat,
        destLng,
        destName,
        kendaraan,
        btn,
        loader,
      );
    },
    { timeout: 10000, enableHighAccuracy: true },
  );
}

async function jalankanNavigasi(
  userLat,
  userLng,
  destLat,
  destLng,
  destName,
  kendaraan,
  btn,
  loader,
) {
  const cuacaHulu = await getCuacaHulu();
  let status = "AMAN",
    pesan = `Jalur utama menuju ${destName} aman dilalui.`;

  if (modeAI === "OFF") {
    await new Promise((r) => setTimeout(r, 600));
    let k = kondisiAirLokal.toLowerCase();
    if (k.includes("kering") || k.includes("aman")) {
      status = "AMAN";
      pesan = `Perjalanan menuju ${destName} terpantau aman terkendali.`;
    } else if (k.includes("kaki")) {
      status = "AMAN";
      pesan = `Genangan dangkal di jalur utama. Sangat aman dilalui ${kendaraan} tanpa pindah rute.`;
    } else if (
      k.includes("lutut") ||
      k.includes("paha") ||
      k.includes("lumpuh") ||
      k.includes("seban") ||
      k.includes("tenggelam")
    ) {
      if (
        kendaraan.toLowerCase().includes("suv") ||
        kendaraan.toLowerCase().includes("truk")
      ) {
        status = "WASPADA";
        pesan = `Air cukup tinggi (${kondisiAirLokal}). Kendaraan ${kendaraan} masih bisa lewat dengan kecepatan rendah.`;
      } else {
        status = "BAHAYA";
        pesan = `JALUR UTAMA TERHADANG BANJIR! Risiko mogok tinggi untuk ${kendaraan}. Sistem mengalihkan ke rute alternatif.`;
      }
    } else {
      status = "WASPADA";
      pesan = `Kondisi air terpantau: ${kondisiAirLokal}. Harap berhati-hati saat melintas.`;
    }
  } else {
    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = `Navigasi Banjir Gresik-Lamongan. Posisi GPS User: Lat ${userLat}, Lng ${userLng}. Tujuan: ${destName}. Kendaraan: ${kendaraan}. Cuaca Hulu: ${cuacaHulu}. Laporan Firebase: ${kondisiAirLokal}. Jika jalan 'Semata kaki', status WAJIB 'AMAN'. Format JSON: { "status": "AMAN" | "WASPADA" | "BAHAYA", "pesan": "..." }`;

    try {
      const response = await fetch(urlGemini, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      const jsonMatch =
        data.candidates[0].content.parts[0].text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const hasil = JSON.parse(jsonMatch[0]);
        status = String(hasil.status || "AMAN").toUpperCase();
        pesan = hasil.pesan || pesan;
      }
    } catch (err) {
      console.error("Gemini gagal:", err);
    }
  }

  let labelText = `Hulu (Satelit): ${cuacaHulu} <br>Hilir (Firebase): ${kondisiAirLokal}`;
  document.getElementById("label-banjir").innerHTML = labelText;

  try {
    await prosesRuteDinamis(
      userLat,
      userLng,
      destLat,
      destLng,
      destName,
      kendaraan,
      status,
      pesan,
    );
  } catch (err) {
    console.error("Gagal memproses rute:", err);
  } finally {
    btn.disabled = false;
    loader.style.display = "none";
  }
}

async function prosesRuteDinamis(
  userLat,
  userLng,
  destLat,
  destLng,
  destName,
  kendaraan,
  status,
  pesan,
) {
  const box = document.getElementById("result-box");
  const statusEl = document.getElementById("res-status");
  const pesanEl = document.getElementById("res-pesan");

  box.className = "";
  activeLayerGroup.clearLayers();

  L.marker([userLat, userLng], {
    icon: L.divIcon({
      className: "custom-pin",
      html: `<div style="background-color:#38bdf8;width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px #38bdf8;"></div>`,
    }),
  })
    .addTo(activeLayerGroup)
    .bindPopup("<b>Lokasi Anda (GPS/Bypass)</b>")
    .openPopup();
  L.marker([destLat, destLng], {
    icon: L.divIcon({
      className: "custom-pin",
      html: `<div style="background-color:#e63946;width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px #e63946;"></div>`,
    }),
  })
    .addTo(activeLayerGroup)
    .bindPopup(`<b>Tujuan: ${destName}</b>`);

  const normal = await ambilRuteJalan([
    [userLat, userLng],
    [destLat, destLng],
  ]);
  const ruasAktif = RUAS_BANJIR.filter((r) => r.aktif);
  const merahList = await Promise.all(
    ruasAktif.map((r) => ambilRuteJalan(r.titik)),
  );
  const titikBanjir = merahList.flatMap((m) => m.koordinat);

  const cekTabrakanBanjir = (rute) => {
    for (let i = 0; i < rute.length; i += 5) {
      for (let j = 0; j < titikBanjir.length; j += 5) {
        if (map.distance(rute[i], titikBanjir[j]) < 150) return true;
      }
    }
    return false;
  };

  let ruteFinal = normal.koordinat;
  let ruteMenabrak = cekTabrakanBanjir(ruteFinal);
  let pakaiAlternatif = false;
  let catatanRouting = "";

  if (!ruteMenabrak && !status.includes("AMAN")) {
    status = "AMAN";
    pesan = `Jalur menuju ${destName} aman karena tidak melewati titik banjir utama.`;
  }

  if (status.includes("AMAN")) {
    box.classList.add("aman");
    statusEl.innerText = `✅ STATUS: RUTE KE ${destName.toUpperCase()} AMAN`;
    L.polyline(ruteFinal, {
      color: "#0f9d8f",
      weight: 6,
      opacity: 0.9,
    }).addTo(activeLayerGroup);
  } else {
    box.classList.add(status.includes("WASPADA") ? "waspada" : "bahaya");
    statusEl.innerText = status.includes("WASPADA")
      ? "⚠️ STATUS: WASPADA"
      : `🚨 JALUR UTAMA KE ${destName.toUpperCase()} TERHADANG!`;

    if (ruteMenabrak) {
      pakaiAlternatif = true;
      let titikAlt = [[userLat, userLng]];
      let pancinganBanjir = titikBanjir;

      if (destName.includes("Benjeng")) {
        titikAlt.push([-7.235, 112.502]);
      } else if (
        destName.includes("Surabaya") ||
        destName.includes("Cerme") ||
        destName.includes("Lamongan")
      ) {
        titikAlt.push([-7.226, 112.53]);
        pancinganBanjir = null;
      } else if (destName.includes("Mojokerto")) {
        titikAlt.push([-7.325, 112.44]);
      }
      titikAlt.push([destLat, destLng]);

      const alternatif = await ambilRuteJalan(titikAlt, pancinganBanjir);
      ruteFinal = alternatif.koordinat;

      if (!alternatif.dariJalan)
        catatanRouting =
          "<br><small>⚠️ Rute alternatif garis lurus (perkiraan).</small>";
    } else {
      if (!normal.dariJalan)
        catatanRouting = "<br><small>⚠️ Rute garis lurus (perkiraan).</small>";
    }

    L.polyline(ruteFinal, {
      color: "#3a86f0",
      weight: 6,
      opacity: 0.9,
      dashArray: "10, 10",
    })
      .addTo(activeLayerGroup)
      .bindPopup(
        pakaiAlternatif
          ? `<b>Rute Alternatif Menghindari Banjir menuju ${destName}</b>`
          : `<b>Rute Normal (Aman dari Banjir) menuju ${destName}</b>`,
      );

    merahList.forEach((m, i) =>
      L.polyline(m.koordinat, {
        color: "#e63946",
        weight: 8,
        opacity: 0.85,
        dashArray: "5, 5",
      })
        .addTo(activeLayerGroup)
        .bindPopup(
          `<b>⚠️ Ruas Terendam</b><br><small>${ruasAktif[i].nama}</small>`,
        ),
    );

    dataTitikEvakuasi.forEach((titik) => {
      L.marker([titik.lat, titik.lng], {
        icon: L.divIcon({
          className: "custom-pin",
          html: `<div class="pin-evakuasi">✚</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .addTo(activeLayerGroup)
        .bindPopup(`<b>🏥 ${titik.nama}</b><br><small>${titik.info}</small>`);
    });
  }

  const bounds = L.latLngBounds(ruteFinal);
  if (!status.includes("AMAN"))
    merahList.forEach((m) => bounds.extend(L.latLngBounds(m.koordinat)));
  map.fitBounds(bounds, { padding: [50, 50] });

  let estimasiHTML = "";
  if (status.includes("BAHAYA") || status.includes("WASPADA")) {
    let komponen = kendaraan.includes("Motor")
      ? status.includes("BAHAYA")
        ? "Turun mesin, ECU terbakar, CVT masuk lumpur."
        : "Gardan masuk air, rem basah kotor."
      : status.includes("BAHAYA")
        ? "Water hammer, ECU korslet, interior wajib bongkar."
        : "Kelistrikan terganggu, rem blong.";
    let biaya = kendaraan.includes("Motor")
      ? status.includes("BAHAYA")
        ? "Rp 750.000 - Rp 2.500.000"
        : "Rp 150.000 - Rp 400.000"
      : status.includes("BAHAYA")
        ? "Rp 5.000.000 - Rp 25.000.000+"
        : "Rp 500.000 - Rp 1.500.000";
    let risiko = kendaraan.includes("Motor")
      ? status.includes("BAHAYA")
        ? "Tinggi (Motor Mati Total)"
        : "Sedang (Kendala Performa)"
      : status.includes("BAHAYA")
        ? "Sangat Tinggi (Kerusakan Fatal)"
        : "Sedang (Risiko Selip)";

    estimasiHTML = `<div style="margin-top: 15px; padding: 15px; background: rgba(230, 57, 70, 0.08); border: 1.5px dashed #e63946; border-radius: 8px;"><strong style="color: #b91c1c; display: block; margin-bottom: 8px; font-size: 0.95rem;">⚠️ ESTIMASI RISIKO & KERUSAKAN (${kendaraan.toUpperCase()}):</strong><ul style="margin: 0; padding-left: 20px; font-size: 0.85rem; color: #334155; line-height: 1.6;"><li><strong>Kerusakan:</strong> ${komponen}</li><li><strong>Biaya:</strong> <span style="color: #dc2626; font-weight: bold;">${biaya}</span></li><li><strong>Risiko:</strong> ${risiko}</li></ul></div>`;
  }

  pesanEl.innerHTML =
    pesan +
    catatanRouting +
    estimasiHTML +
    `<br><br><span style="font-size:0.75rem; opacity:0.6; color:#94a3b8;">*Tujuan: ${destName} | Sistem: ${modeAI === "OFF" ? "Manual Laporan" : "AI " + GEMINI_MODEL}</span>`;
  box.style.display = "block";
}

// Tombol Refresh / Muat Ulang Halaman
const refreshBtn = document.getElementById("refresh-btn");
refreshBtn.addEventListener("click", () => {
  location.reload();
});

const themeToggle = document.getElementById("theme-toggle");
themeToggle.addEventListener("click", () => {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  if (currentTheme === "dark") {
    document.documentElement.removeAttribute("data-theme");
    themeToggle.innerText = "🌙";
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    themeToggle.innerText = "☀️";
  }
});
