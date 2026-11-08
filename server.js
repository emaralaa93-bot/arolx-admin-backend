const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// تهيئة Firebase Admin باستخدام متغيرات البيئة أو ملف الاعتماد
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

// مسار جلب المستخدمين
app.get('/api/admin/users', async (req, res) => {
  try {
    const listUsersResult = await admin.auth().listUsers(1000);
    const users = [];

    for (const userRecord of listUsersResult.users) {
      const uid = userRecord.uid;
      const email = userRecord.email || '';
      const displayName = userRecord.displayName || email.split('@')[0] || 'مستخدم';
      
      // جلب الأرصدة من Firestore
      const userDoc = await db.collection('users').doc(uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};

      users.push({
        uid,
        email,
        displayName,
        balance: userData.balance || 0,
        spotBalance: userData.spotBalance || 0,
        futuresBalance: userData.futuresBalance || 0
      });
    }

    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// مسار تحديث أرصدة المستخدم
app.post('/api/admin/update-user', async (req, res) => {
  try {
    const { uid, balance, spotBalance, futuresBalance } = req.body;

    if (!uid) {
      return res.status(400).json({ success: false, error: 'معرف المستخدم (uid) مطلوب' });
    }

    const userRef = db.collection('users').doc(uid);
    await userRef.set({
      balance: Number(balance) || 0,
      spotBalance: Number(spotBalance) || 0,
      futuresBalance: Number(futuresBalance) || 0
    }, { merge: true });

    res.json({ success: true, message: 'تم تحديث البيانات بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
