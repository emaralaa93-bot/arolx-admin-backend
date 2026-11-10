const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    const allowed = (
      process.env.ADMIN_ALLOWED_ORIGINS ||
      'https://sites.google.com'
    ).split(',').map(x => x.trim());

    if (!origin || allowed.includes(origin)) {
      return callback(null, true);
    }

    console.log('Blocked CORS origin:', origin);
    callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '20kb' }));

const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  ADMIN_SESSION_SECRET
} = process.env;

const required = [
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  ADMIN_SESSION_SECRET
];

if (required.some(value => !value)) {
  throw new Error('Missing environment variables in Render');
}

if (ADMIN_SESSION_SECRET.length < 32) {
  throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters');
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .trim()
  })
});

const db = admin.firestore();

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function createToken() {
  const payload = Buffer.from(JSON.stringify({
    sub: 'admin',
    exp: Math.floor(Date.now() / 1000) + 7200
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return payload + '.' + signature;
}

function verifyToken(token) {
  const parts = token.split('.');

  if (parts.length !== 2) return false;

  const [payload, signature] = parts;

  const expected = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  if (!safeEqual(signature, expected)) return false;

  try {
    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString()
    );

    return data.sub === 'admin' &&
      data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  if (!token || !verifyToken(token)) {
    return res.status(401).json({
      success: false,
      error: 'غير مصرح. سجل دخول المدير أولاً'
    });
  }

  next();
}

// فحص الخادم
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Arolx Backend is Running'
  });
});

// تسجيل دخول المدير
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (
    !safeEqual(username || '', ADMIN_USERNAME) ||
    !safeEqual(password || '', ADMIN_PASSWORD)
  ) {
    return res.status(401).json({
      success: false,
      error: 'اسم المستخدم أو كلمة المرور غير صحيحة'
    });
  }

  res.json({
    success: true,
    token: createToken(),
    message: 'تم تسجيل الدخول بنجاح'
  });
});

// جلب المستخدمين - محمي
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await admin.auth().listUsers(1000);

    const users = await Promise.all(
      result.users.map(async user => {
        const doc = await db.collection('users')
          .doc(user.uid).get();

        const data = doc.exists ? doc.data() : {};

        return {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'بدون اسم',
          balance: Number(data.balance) || 0,
          spotBalance: Number(data.spotBalance) || 0,
          futuresBalance: Number(data.futuresBalance) || 0
        };
      })
    );

    res.json({ success: true, users });

  } catch (error) {
    console.error('Load users error:', error);

    res.status(500).json({
      success: false,
      error: 'فشل جلب المستخدمين'
    });
  }
});

// تعديل الأرصدة - محمي
app.post('/api/admin/update-user', requireAdmin, async (req, res) => {
  try {
    const {
      uid,
      balance,
      spotBalance,
      futuresBalance
    } = req.body || {};

    if (typeof uid !== 'string' || !uid.trim()) {
      return res.status(400).json({
        success: false,
        error: 'معرف المستخدم مطلوب'
      });
    }

    const raw = [balance, spotBalance, futuresBalance];

    if (raw.some(v => v === undefined || v === null || String(v).trim() === '')) {
      return res.status(400).json({
        success: false,
        error: 'يجب إدخال جميع الأرصدة'
      });
    }

    const values = raw.map(Number);

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

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'المسار غير موجود'
  });
});

app.use((err, req, res, next) => {
  console.error(err.message);

  res.status(500).json({
    success: false,
    error: 'خطأ داخلي في الخادم'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Arolx Backend running on port ' + PORT);
});
