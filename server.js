const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
  })
});

const db = admin.firestore();
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/admin/users', async (req, res) => {
  try {
    const listUsersResult = await admin.auth().listUsers(1000);
    const authUsers = listUsersResult.users;
    const usersData = [];

    for (let authUser of authUsers) {
      const uid = authUser.uid;
      let firestoreData = {};

      const docRef = db.collection('users').doc(uid);
      const doc = await docRef.get();
      if (doc.exists) {
        firestoreData = doc.data();
      }

      usersData.push({
        uid: uid,
        email: authUser.email || 'لا يوجد بريد',
        displayName: authUser.displayName || firestoreData.name || 'بدون اسم',
        disabled: authUser.disabled,
        spotBalance: firestoreData.spotBalance || 0,
        futuresBalance: firestoreData.futuresBalance || 0,
        balance: firestoreData.balance || 0
      });
    }

    res.json({ success: true, users: usersData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
