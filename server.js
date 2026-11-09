const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

app.use(cors());
app.use(express.json());

const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY
} = process.env;

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error('Missing environment variables in Render');
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

const db = admin.firestore();

// فحص الخادم
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Arolx Backend is Running'
  });
});

// جلب المستخدمين (مفتوح بدون حماية لسهولة الاستخدام)
app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await admin.auth().listUsers(1000);
    const users = [];

    for (const user of result.users) {
      const doc = await db.collection('users').doc(user.uid).get();
      const data = doc.exists ? doc.data() : {};

      users.push({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || 'بدون اسم',
        balance: Number(data.balance) || 0,
        spotBalance: Number(data.spotBalance) || 0,
        futuresBalance: Number(data.futuresBalance) || 0
      });
    }

    res.json({ success: true, users });

  } catch (error) {
    console.error('Load users error:', error);
    res.status(500).json({
      success: false,
      error: 'فشل جلب المستخدمين'
    });
  }
});

// تعديل أرصدة المستخدم (مفتوح ومباشر)
app.post('/api/admin/update-user', async (req, res) => {
  try {
    const { uid, balance, spotBalance, futuresBalance } = req.body || {};

    if (typeof uid !== 'string' || !uid.trim()) {
      return res.status(400).json({
        success: false,
        error: 'معرف المستخدم مطلوب'
      });
    }

    const values = [balance, spotBalance, futuresBalance].map(Number);

    if (values.some(v => !Number.isFinite(v) || v < 0)) {
      return res.status(400).json({
        success: false,
        error: 'الأرصدة غير صحيحة'
      });
    }

    await db.collection('users').doc(uid).set({
      balance: values[0],
      spotBalance: values[1],
      futuresBalance: values[2]
    }, { merge: true });

    res.json({
      success: true,
      message: 'تم حفظ الأرصدة بنجاح'
    });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      error: 'فشل تحديث الأرصدة'
    });
  }
});

// معالجة الروابط غير الموجودة
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'المسار غير موجود'
  });
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    error: 'خطأ داخلي في الخادم'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Arolx Backend running on port ' + PORT);
});
