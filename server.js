
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());

if (!process.env.ADMIN_USERNAME ||
    !process.env.ADMIN_PASSWORD ||
    !process.env.ADMIN_SESSION_SECRET) {
    throw new Error('Admin environment variables are missing');
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
});

const db = admin.firestore();

function signToken(username) {
  const payload = Buffer.from(JSON.stringify({
    username,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function requireAdmin(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const parts = token.split('.');

    if (parts.length !== 2) throw new Error();

    const expected = crypto.createHmac('sha256',
      process.env.ADMIN_SESSION_SECRET)
      .update(parts[0]).digest();

    const received = Buffer.from(parts[1], 'base64url');

    if (received.length !== expected.length ||
        !crypto.timingSafeEqual(received, expected)) {
      throw new Error();
    }

    const payload = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString()
    );

    if (payload.username !== process.env.ADMIN_USERNAME ||
        payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error();
    }

    next();
  } catch {
    res.status(401).json({
      success: false,
      error: 'غير مصرح لك بالدخول'
    });
  }
}

// تسجيل دخول المدير
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username !== process.env.ADMIN_USERNAME ||
      password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      error: 'اسم المستخدم أو كلمة المرور غير صحيحة'
    });
  }

  res.json({
    success: true,
    token: signToken(username)
  });
});

// جلب المستخدمين
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await admin.auth().listUsers(1000);
    const users = [];

    for (const u of result.users) {
      const doc = await db.collection('users').doc(u.uid).get();
      const data = doc.exists ? doc.data() : {};

      users.push({
        uid: u.uid,
        email: u.email || '',
        displayName: u.displayName || 'بدون اسم',
        balance: Number(data.balance) || 0,
        spotBalance: Number(data.spotBalance) || 0,
        futuresBalance: Number(data.futuresBalance) || 0
      });
    }

    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// تعديل الأرصدة
app.post('/api/admin/update-user', requireAdmin, async (req, res) => {
  try {
    const { uid, balance, spotBalance, futuresBalance } = req.body;

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
        error: 'الأرصدة يجب أن تكون أرقاماً صحيحة غير سالبة'
      });
    }

    await db.collection('users').doc(uid).set({
      balance: values[0],
      spotBalance: values[1],
      futuresBalance: values[2]
    }, { merge: true });

    res.json({ success: true, message: 'تم حفظ الأرصدة' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
