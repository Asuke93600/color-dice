// Config Firebase (publique, destinée au navigateur).
// La sécurité réelle est assurée côté serveur via firebase-admin + vérification d'ID token.
export const firebaseConfig = {
  apiKey:            "AIzaSyBdMOcvKvpnlvWhm1QDFVZu065K5VcxgyA",
  authDomain:        "color-dice-59b9a.firebaseapp.com",
  projectId:         "color-dice-59b9a",
  storageBucket:     "color-dice-59b9a.firebasestorage.app",
  messagingSenderId: "174475483164",
  appId:             "1:174475483164:web:5dff0da90c720b4a41a7d9",
};

export const isConfigured = Object.values(firebaseConfig)
  .every(v => typeof v === 'string' && !v.startsWith('FILL:'));
