// Remplace les 6 valeurs ci-dessous par celles de ton projet Firebase.
// Console Firebase > Paramètres du projet > Tes applications > SDK config.
// Ces clés sont publiques (destinées au navigateur) ; la sécurité réelle
// est assurée par Firestore Rules (voir ../firestore.rules).
export const firebaseConfig = {
  apiKey:            "FILL:apiKey",
  authDomain:        "FILL:authDomain",       // ex : color-dice.firebaseapp.com
  projectId:         "FILL:projectId",
  storageBucket:     "FILL:storageBucket",
  messagingSenderId: "FILL:messagingSenderId",
  appId:             "FILL:appId",
};

export const isConfigured = Object.values(firebaseConfig)
  .every(v => typeof v === 'string' && !v.startsWith('FILL:'));
