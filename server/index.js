const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = '569303644021-pq09evs992200m4vt65i3c883c69fdfa.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const db = require('./db');

const app = express();

// SURIANA SECURITY HEADERS
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    const allowed = !origin || [
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ].includes(origin);

    callback(null, allowed);
  },
  credentials: true
}));

/* SURIANA_RATE_LIMIT_START */
const rateLimitStore = new Map();

function surianaRateLimit({ windowMs, max, name }) {
  return (req, res, next) => {
    const key = `${name}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    let item = rateLimitStore.get(key);

    if (!item || now - item.start >= windowMs) {
      item = { start: now, count: 0 };
    }

    item.count++;
    rateLimitStore.set(key, item);

    if (item.count > max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((windowMs - (now - item.start)) / 1000)
      );

      res.set('Retry-After', String(retryAfter));

      return res.status(429).json({
        success: false,
        message: 'طلبات كثيرة، حاول لاحقاً'
      });
    }

    next();
  };
}

/* تنظيف تلقائي للعدادات القديمة */
setInterval(() => {
  const now = Date.now();

  for (const [key, item] of rateLimitStore) {
    if (now - item.start > 15 * 60 * 1000) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

/* حماية عامة للـ API */
app.use('/api', surianaRateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  name: 'api'
}));

/* حماية تسجيل الدخول والتسجيل */
app.use([
  '/api/login',
  '/api/register',
  '/api/auth/google',
  '/api/auth/google/register'
], surianaRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  name: 'auth'
}));

/* حماية الرسائل والوسائط */
app.use([
  '/api/messages',
  '/api/messages/media'
], surianaRateLimit({
  windowMs: 60 * 1000,
  max: 120,
  name: 'messages'
}));

/* حماية المكالمات والمحفظة */
app.use([
  '/api/calls',
  '/api/wallet',
  '/api/wallet/charge',
  '/api/wallet/withdraw'
], surianaRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  name: 'money_calls'
}));

app.use(express.json({limit:"1mb"}));

app.use(express.static(require('path').join(__dirname, '../app/dist')));
app.use('/uploads/avatars', express.static(require('path').join(__dirname, 'uploads', 'avatars')));


if (!process.env.JWT_SECRET) {
  console.error('ERROR: JWT_SECRET is missing from .env');
  process.exit(1);
}


async function sendTelegramAdmin(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    console.warn('TELEGRAM: settings missing');
    return false;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true
        })
      }
    );

    const data = await response.json();

    if (!data.ok) {
      console.error('TELEGRAM SEND ERROR:', data.description);
      return false;
    }

    return true;
  } catch (err) {
    console.error('TELEGRAM ERROR:', err.message);
    return false;
  }
}

function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
}

function createAdminToken(payload) {
  const jti = crypto.randomUUID();
  const token = createToken({ ...payload, jti });
  return { token, jti };
}

function getOwnerId(callback) {
  db.get(
    `SELECT id FROM users WHERE role='owner' LIMIT 1`,
    [],
    (err, row) => {
      if (err) return callback(err, null);
      if (!row) return callback(null, null);
      callback(null, row.id);
    }
  );
}

function cleanUser(user) {
  if (!user) return null;

  return {
    id: user.id,
      public_id: user.public_id,
    name: user.name,
    email: user.email,
    age: user.age,
      birth_date: user.birth_date,
    city: user.city,
    gender: user.gender,
    role: user.role,
    points: user.points,
    is_verified: user.is_verified,
    avatar: user.avatar || null,
    created_at: user.created_at
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Suriana API is working'
  });
});


app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'بيانات Google مفقودة'
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({
        success: false,
        message: 'بيانات Google غير صالحة'
      });
    }

    const googleId = String(payload.sub);
    const googleEmail = String(payload.email).trim().toLowerCase();
    const googleName = String(payload.name || '').trim();

    db.get(
      `SELECT * FROM users WHERE google_id = ? LIMIT 1`,
      [googleId],
      (err, user) => {
        if (err) {
          console.error('GOOGLE DB ERROR:', err.message);
          return res.status(500).json({
            success: false,
            message: 'خطأ في قاعدة البيانات'
          });
        }

        if (user) {
          if (user.role === 'owner' || user.role === 'admin') {
            const adminToken = createAdminToken({
              id: user.id,
              email: user.email,
              role: user.role
            });

            db.run(
              `INSERT INTO admin_sessions
               (user_id, jti, ip, user_agent)
               VALUES (?, ?, ?, ?)`,
              [
                user.id,
                adminToken.jti,
                req.ip || null,
                req.get('user-agent') || null
              ],
              (sessionErr) => {
                if (sessionErr) {
                  console.error('GOOGLE EXISTING ADMIN SESSION ERROR:', sessionErr.message);
                  return res.status(500).json({
                    success: false,
                    message: 'تعذر إنشاء جلسة الإدارة'
                  });
                }

                    setAuthCookie(req, res, adminToken.token);
return res.json({
                  success: true,
                  existing: true,
                  user: cleanUser(user)
                });
              }
            );

            return;
          }

          const token = createToken({
            id: user.id,
            email: user.email,
            role: user.role
          });
setAuthCookie(req, res, token);
          return res.json({
            success: true,
            existing: true,
            user: cleanUser(user)
          });
        }

        db.get(
          `SELECT * FROM users WHERE LOWER(email) = ? AND role IN ('owner','admin') LIMIT 1`,
          [googleEmail],
          (ownerErr, ownerUser) => {
            if (ownerErr) {
              console.error('GOOGLE OWNER DB ERROR:', ownerErr.message);
              return res.status(500).json({
                success: false,
                message: 'خطأ في قاعدة البيانات'
              });
            }

            if (ownerUser) {
                db.run(
                  `UPDATE users SET google_id = ? WHERE id = ?`,
                  [googleId, ownerUser.id],
                  (linkErr) => {
                    if (linkErr) {
                      console.error('GOOGLE OWNER LINK ERROR:', linkErr.message);
                      return res.status(500).json({
                        success: false,
                        message: 'تعذر ربط حساب Google'
                      });
                    }

                    const adminToken = createAdminToken({
                      id: ownerUser.id,
                      email: ownerUser.email,
                      role: ownerUser.role
                    });

                    db.run(
                      `INSERT INTO admin_sessions
                        (user_id, jti, ip, user_agent)
                       VALUES (?, ?, ?, ?)`,
                      [
                        ownerUser.id,
                        adminToken.jti,
                        req.ip || null,
                        req.get('user-agent') || null
                      ],
                      (sessionErr) => {
                        if (sessionErr) {
                          console.error('GOOGLE ADMIN SESSION INSERT ERROR:', sessionErr.message);
                          return res.status(500).json({
                            success: false,
                            message: 'تعذر إنشاء جلسة الإدارة'
                          });
                        }

                    setAuthCookie(req, res, adminToken.token);
                        return res.json({
                          success: true,
                          existing: true,
                          user: cleanUser({
                            ...ownerUser,
                            google_id: googleId
                          })
                        });
                      }
                    );
                  }
                );
                return;
              }

              return res.json({
                success: true,
                existing: false,
              google: {
                id: googleId,
                email: googleEmail,
                name: googleName
              }
            });
          }
        );
      }
    );

  } catch (err) {
    console.error('GOOGLE VERIFY ERROR:', err.message);

    return res.status(401).json({
      success: false,
      message: 'تعذر التحقق من حساب Google'
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'البريد الإلكتروني وكلمة المرور مطلوبان'
      });
    }

    // دخول المدير من بيانات السيرفر فقط
    if (false) {
      db.get(
        `SELECT
          COUNT(*) AS users,
          COALESCE(SUM(CASE WHEN role = 'girl' THEN 1 ELSE 0 END), 0) AS girls,
          COALESCE(SUM(points), 0) AS points
         FROM users`,
        [],
        (err, stats) => {
          if (err) {
            console.error(err);
            return res.status(500).json({
              success: false,
              message: 'خطأ في قاعدة البيانات'
            });
          }

          const token = createToken({
            id: 0,
            email,
            role: 'owner'
          });

          return res.json({
            success: true,
            role: 'owner',
            stats
          });
        }
      );

      return;
    }

    db.get(
      `SELECT * FROM users WHERE email = ? LIMIT 1`,
      [email],
      async (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({
            success: false,
            message: 'خطأ في قاعدة البيانات'
          });
        }

        if (!user) {
          return res.status(401).json({
            success: false,
            message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
          });
        }

        let validPassword = false;

        // الحسابات الجديدة ستكون مشفرة بـ bcrypt
        if (
          typeof user.password === 'string' &&
          user.password.startsWith('$2')
        ) {
          validPassword = await bcrypt.compare(password, user.password);
        } else {
          // دعم الحسابات القديمة مؤقتاً
          validPassword = user.password === password;

          // إذا كانت كلمة المرور القديمة صحيحة، نحولها فوراً إلى bcrypt
          if (validPassword) {
            const newHash = await bcrypt.hash(password, 10);

            db.run(
              `UPDATE users SET password = ? WHERE id = ?`,
              [newHash, user.id],
              (updateErr) => {
                if (updateErr) {
                  console.error(
                    'Password upgrade error:',
                    updateErr.message
                  );
                }
              }
            );
          }
        }

        if (!validPassword) {
          return res.status(401).json({
            success: false,
            message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
          });
        }

        if (user.is_banned === 1) {
          return res.status(403).json({
            success: false,
            message: 'الحساب محظور'
          });
        }

        let token;

    if (user.role === 'owner' || user.role === 'admin') {
      const adminToken = createAdminToken({
        id: user.id,
        email: user.email,
        role: user.role
      });

      token = adminToken.token;

      db.run(
        `INSERT INTO admin_sessions
          (user_id, jti, ip, user_agent)
         VALUES (?, ?, ?, ?)`,
        [
          user.id,
          adminToken.jti,
          req.ip || null,
          req.get('user-agent') || null
        ],
        (sessionErr) => {
          if (sessionErr) {
            console.error('ADMIN SESSION INSERT ERROR:', sessionErr);
          }
        }
      );

      getOwnerId((ownerErr, ownerId) => {
        if (ownerErr || !ownerId) {
          if (ownerErr) console.error('OWNER ID LOOKUP ERROR:', ownerErr);
          return;
        }

        db.run(
          `INSERT INTO notifications
           (user_id, title, message, type)
           VALUES (?, ?, ?, ?)`,
          [
            ownerId,
            '⚠️ تنبيه أمني',
            `تم تسجيل دخول إداري جديد: ${user.name || 'غير معروف'} (ID: ${user.id}) — IP: ${req.ip || 'غير معروف'} — الجهاز: ${req.get('user-agent') || 'غير معروف'}`,
            'security'
          ],
          (notificationErr) => {
            if (notificationErr) {
              console.error('ADMIN SECURITY NOTIFICATION ERROR:', notificationErr);
            }
          }
        );
      });
    } else {
      token = createToken({
        id: user.id,
        email: user.email,
        role: user.role
      });
    }

    setAuthCookie(req, res, token);
    return res.json({
      success: true,
      role: user.role,
      user: cleanUser(user)
    });
      }
    );
  } catch (error) {
    console.error('Login error:', error);

    return res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء تسجيل الدخول'
    });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const settings = await new Promise((resolve, reject) => {
      db.get(`SELECT register_open FROM app_settings WHERE id=1`, [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (settings && Number(settings.register_open) === 0) {
      return res.status(403).json({
        success: false,
        message: 'التسجيل مغلق حاليًا من الإدارة'
      });
    }

    const {
      name,
      email,
      password,
      birth_date,
      city,
      gender,
      referral_code
    } = req.body;

    if (!name || !email || !password || !birth_date || !city || !gender) {
      return res.status(400).json({
        success: false,
        message: 'يرجى تعبئة جميع الحقول'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'
      });
    }

      const birthDateObj = new Date(birth_date);
      const today = new Date();

      if (isNaN(birthDateObj.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'تاريخ الميلاد غير صالح'
        });
      }

      let ageNumber = today.getFullYear() - birthDateObj.getFullYear();
      const monthDiff = today.getMonth() - birthDateObj.getMonth();

      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDateObj.getDate())) {
        ageNumber--;
      }

      if (ageNumber < 18) {
        return res.status(400).json({
          success: false,
          message: 'العمر يجب أن يكون 18 سنة أو أكثر'
        });
      }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        [normalizedEmail],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'هذا البريد الإلكتروني مستخدم مسبقاً'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const role =
      gender === 'أنثى' || gender === 'بنت'
        ? 'girl'
        : 'user';

    const startingPoints = role === 'girl' ? 0 : 50;

      const lastPublicId = await new Promise((resolve, reject) => {
        db.get(
          `SELECT MAX(public_id) as max_id FROM users`,
          [],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.max_id || 999);
          }
        );
      });

      const newPublicId = Number(lastPublicId) + 1;

    db.run(
      `INSERT INTO users
       (public_id, name, email, password, age, birth_date, city, gender, role, points, referral_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
[
          newPublicId,
        String(name).trim(),
        normalizedEmail,
        hashedPassword,
        ageNumber,
          birth_date,
        String(city).trim(),
        gender,
        role,
        startingPoints,
      crypto.randomBytes(5).toString("hex").toUpperCase()
      ],
      function (err) {
        if (err) {
          console.error('Register database error:', err);

          if (err.message.includes('UNIQUE')) {
            return res.status(409).json({
              success: false,
              message: 'هذا البريد الإلكتروني مستخدم مسبقاً'
            });
          }

          return res.status(500).json({
            success: false,
            message: 'تعذر إنشاء الحساب'
          });
        }

        const user = {
          id: this.lastID,
          name: String(name).trim(),
          email: normalizedEmail,
          age: ageNumber,
          city: String(city).trim(),
          gender,
          role,
          points: startingPoints,
          is_verified: 0
        };

        // 🎁 نظام الدعوات — مكافأة صاحب كود الدعوة
        if (referral_code) {
          const referralCode = String(referral_code).trim().toUpperCase();

          db.get(
            `SELECT id FROM users WHERE referral_code = ? LIMIT 1`,
            [referralCode],
            (refErr, inviter) => {
              if (refErr || !inviter || Number(inviter.id) === Number(user.id)) return;

              db.get(
                `SELECT id FROM referrals WHERE invited_user_id = ? LIMIT 1`,
                [user.id],
                (dupErr, existingReferral) => {
                  if (dupErr || existingReferral) return;

                  db.run(
                    `UPDATE users SET points = points + 100 WHERE id = ?`,
                    [inviter.id],
                    function (rewardErr) {
                      if (rewardErr || this.changes !== 1) return;

                      db.run(
                        `INSERT INTO referrals
                         (inviter_id, invited_user_id, referral_code, reward_points, rewarded, rewarded_at)
                         VALUES (?, ?, ?, 100, 1, CURRENT_TIMESTAMP)`,
                        [inviter.id, user.id, referralCode],
                        insertErr => {
                          if (insertErr) {
                            console.error('REFERRAL INSERT ERROR:', insertErr);
                            return;
                          }

                          db.run(
                            `INSERT INTO wallet_logs
                             (user_id, type, points, description)
                             VALUES (?, 'referral', 100, 'مكافأة دعوة مستخدم جديد')`,
                            [inviter.id],
                            logErr => {
                              if (logErr) console.error('REFERRAL WALLET LOG ERROR:', logErr);
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
        // 🔔 Telegram — إشعار تسجيل مستخدم جديد
        const telegramText = [
          '👤 تسجيل مستخدم جديد',
          '',
          `🆔 رقم المستخدم: ${user.id}`,
          `👤 الاسم: ${user.name}`,
          `📧 البريد: ${user.email}`,
          `🎂 العمر: ${user.age}`,
          `📍 المدينة: ${user.city}`,
          `⚧️ الجنس: ${user.gender}`,
          `🏷️ النوع: ${user.role}`,
          `💰 الرصيد الابتدائي: ${user.points} نقطة`,
          '',
          '📌 الحالة: الحساب تم إنشاؤه بنجاح'
        ].join('\n');

        sendTelegramAdmin(telegramText).catch(err => {
          console.error('TELEGRAM REGISTER ERROR:', err.message);
        });

        const token = createToken({
          id: user.id,
          email: user.email,
          role: user.role
        });

        setAuthCookie(req, res, token);
        return res.status(201).json({
          success: true,
          message: 'تم إنشاء الحساب بنجاح',
          user
        });
      }
    );
  } catch (error) {
    console.error('Register error:', error);

    return res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء إنشاء الحساب'
    });
  }
});

app.post('/api/auth/google/register', async (req, res) => {
  try {
    const settings = await new Promise((resolve, reject) => {
      db.get(
        `SELECT register_open FROM app_settings WHERE id=1`,
        [],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (settings && Number(settings.register_open) === 0) {
      return res.status(403).json({
        success: false,
        message: 'التسجيل مغلق حاليًا من الإدارة'
      });
    }

    const { credential, name, birth_date, city, gender, referral_code } = req.body;

    if (!credential || !name || !birth_date || !city || !gender) {
      return res.status(400).json({
        success: false,
        message: 'يرجى تعبئة جميع الحقول'
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload?.email) {
      return res.status(401).json({
        success: false,
        message: 'بيانات Google غير صالحة'
      });
    }

    const googleId = String(payload.sub);
    const googleEmail = String(payload.email).trim().toLowerCase();

    const existingGoogle = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM users WHERE google_id = ? LIMIT 1`,
        [googleId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (existingGoogle) {
      return res.status(409).json({
        success: false,
        message: 'حساب Google هذا مرتبط بحساب سوريانا مسبقًا'
      });
    }

    const existingEmail = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        [googleEmail],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'هذا البريد الإلكتروني مستخدم مسبقًا في سوريانا'
      });
    }

    const birthDateObj = new Date(birth_date);
    const today = new Date();

    if (isNaN(birthDateObj.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'تاريخ الميلاد غير صالح'
      });
    }

    let ageNumber =
      today.getFullYear() - birthDateObj.getFullYear();

    const monthDiff =
      today.getMonth() - birthDateObj.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 &&
       today.getDate() < birthDateObj.getDate())
    ) {
      ageNumber--;
    }

    if (ageNumber < 18) {
      return res.status(400).json({
        success: false,
        message: 'العمر يجب أن يكون 18 سنة أو أكثر'
      });
    }

    const role =
      gender === 'أنثى' || gender === 'بنت'
        ? 'girl'
        : 'user';

    const startingPoints = role === 'girl' ? 0 : 50;

    const lastPublicId = await new Promise((resolve, reject) => {
      db.get(
        `SELECT MAX(public_id) as max_id FROM users`,
        [],
        (err, row) => err ? reject(err) : resolve(row?.max_id || 999)
      );
    });

    const newPublicId = Number(lastPublicId) + 1;

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    db.run(
      `INSERT INTO users
       (public_id, name, email, password, age, birth_date, city, gender, role, points, google_id, referral_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newPublicId,
        String(name).trim(),
        googleEmail,
        hashedPassword,
        ageNumber,
        birth_date,
        String(city).trim(),
        gender,
        role,
        startingPoints,
        googleId,
          crypto.randomBytes(5).toString("hex").toUpperCase()
      ],
      function(err) {
        if (err) {
          console.error('Google register database error:', err.message);

          if (String(err.message).includes('UNIQUE')) {
            return res.status(409).json({
              success: false,
              message: 'حساب Google هذا مستخدم مسبقًا'
            });
          }

          return res.status(500).json({
            success: false,
            message: 'تعذر إنشاء الحساب'
          });
        }

        const user = {
          id: this.lastID,
          name: String(name).trim(),
          email: googleEmail,
          age: ageNumber,
          city: String(city).trim(),
          gender,
          role,
          points: startingPoints,
          is_verified: 0
        };

      // 🎁 REFERRAL GOOGLE REWARD
      if (referral_code) {
        const referralCode = String(referral_code).trim().toUpperCase();

        db.get(
          `SELECT id FROM users WHERE referral_code = ? LIMIT 1`,
          [referralCode],
          (refErr, inviter) => {
            if (refErr || !inviter || Number(inviter.id) === Number(user.id)) return;

            db.get(
              `SELECT id FROM referrals WHERE invited_user_id = ? LIMIT 1`,
              [user.id],
              (dupErr, existingReferral) => {
                if (dupErr || existingReferral) return;

                db.run(
                  `UPDATE users SET points = points + 100 WHERE id = ?`,
                  [inviter.id],
                  function (rewardErr) {
                    if (rewardErr || this.changes !== 1) return;

                    db.run(
                      `INSERT INTO referrals
                       (inviter_id, invited_user_id, referral_code, reward_points, rewarded, rewarded_at)
                       VALUES (?, ?, ?, 100, 1, CURRENT_TIMESTAMP)`,
                      [inviter.id, user.id, referralCode],
                      insertErr => {
                        if (insertErr) {
                          console.error('GOOGLE REFERRAL INSERT ERROR:', insertErr);
                          return;
                        }

                        db.run(
                          `INSERT INTO wallet_logs
                           (user_id, type, points, description)
                           VALUES (?, 'referral', 100, 'مكافأة دعوة مستخدم جديد عبر Google')`,
                          [inviter.id],
                          logErr => {
                            if (logErr) console.error('GOOGLE REFERRAL WALLET LOG ERROR:', logErr);
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
        const telegramText = [
          '👤 تسجيل مستخدم جديد عبر Google',
          '',
          `🆔 رقم المستخدم: ${user.id}`,
          `👤 الاسم: ${user.name}`,
          `📧 البريد: ${user.email}`,
          `🎂 العمر: ${user.age}`,
          `📍 المدينة: ${user.city}`,
          `⚧️ الجنس: ${user.gender}`,
          `🏷️ النوع: ${user.role}`,
          `💰 الرصيد الابتدائي: ${user.points} نقطة`,
          '',
          '📌 الحالة: الحساب تم إنشاؤه بنجاح عبر Google'
        ].join('\n');

        sendTelegramAdmin(telegramText).catch(err => {
          console.error('TELEGRAM GOOGLE REGISTER ERROR:', err.message);
        });

        const token = createToken({
          id: user.id,
          email: user.email,
          role: user.role
        });

        setAuthCookie(req, res, token);
        return res.status(201).json({
          success: true,
          message: 'تم إنشاء الحساب بنجاح',
          user
        });
      }
    );

  } catch (error) {
    console.error('Google register error:', error.message);

    return res.status(401).json({
      success: false,
      message: 'تعذر إنشاء الحساب بواسطة Google'
    });
  }
});

app.get('/api/app-status', (req, res) => {
  db.get(
    `SELECT maintenance, announcement FROM app_settings WHERE id=1 LIMIT 1`,
    [],
    (err, settings) => {
      if (err) {
        console.error('APP STATUS ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      res.json({
        success: true,
        maintenance: Number(settings?.maintenance || 0),
        announcement: settings?.announcement || ''
      });
    }
  );
});

/* SURIANA_HTTPONLY_AUTH_COOKIE_START */
const AUTH_COOKIE_NAME = 'suriana_auth';

function authCookieOptions(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = req.secure === true || forwardedProto === 'https';

  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=604800',
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}

function setAuthCookie(req, res, token) {
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; ${authCookieOptions(req)}`
  );
}

function clearAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function getCookieToken(req) {
  const cookieHeader = String(req.headers.cookie || '');
  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(';')) {
    const idx = item.indexOf('=');
    if (idx === -1) continue;

    const name = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();

    if (name === AUTH_COOKIE_NAME) {
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
  }

  return null;
}
/* SURIANA_HTTPONLY_AUTH_COOKIE_END */


app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ success: true });
});

function requireAuth(req, res, next) {
  const token = getCookieToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'غير مصرح'
    });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);

    const isAdminSession =
      req.user &&
      (req.user.role === 'owner' || req.user.role === 'admin');

    if (isAdminSession) {
      if (!req.user.jti) {
        return res.status(403).json({
          success: false,
          message: 'جلسة الإدارة غير صالحة'
        });
      }

      db.get(
        `SELECT id, revoked_at
         FROM admin_sessions
         WHERE user_id = ? AND jti = ?
         LIMIT 1`,
        [req.user.id, req.user.jti],
        (sessionErr, session) => {
          if (sessionErr) {
            return res.status(500).json({
              success: false,
              message: 'خطأ في قاعدة البيانات'
            });
          }

          if (!session || session.revoked_at) {
            return res.status(403).json({
              success: false,
              message: 'تم إنهاء جلسة الإدارة'
            });
          }

          db.run(
            `UPDATE admin_sessions
             SET last_seen = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [session.id],
            (seenErr) => {
              if (seenErr) {
                console.error('ADMIN SESSION LAST_SEEN ERROR:', seenErr);
              }
              checkAuthenticatedUser();
            }
          );
        }
      );
    } else {
      checkAuthenticatedUser();
    }

    function checkAuthenticatedUser() {
      if (req.user.id) {
        db.get(
          `SELECT is_banned FROM users WHERE id = ?`,
          [req.user.id],
          (err, user) => {
            if (err) {
              return res.status(500).json({
                success: false,
                message: 'خطأ في قاعدة البيانات'
              });
            }

            if (user && user.is_banned === 1) {
              return res.status(403).json({
                success: false,
                message: 'الحساب محظور'
              });
            }

              if (
                req.user.role !== 'owner' &&
                req.user.role !== 'admin' &&
                req.path !== '/api/me'
              ) {
                db.get(
                  `SELECT maintenance FROM app_settings WHERE id=1 LIMIT 1`,
                  [],
                  (maintenanceErr, settings) => {
                    if (maintenanceErr) {
                      console.error('MAINTENANCE CHECK ERROR:', maintenanceErr);
                      return res.status(500).json({
                        success: false,
                        message: 'خطأ في قاعدة البيانات'
                      });
                    }

                    if (settings && Number(settings.maintenance) === 1) {
                      return res.status(503).json({
                        success: false,
                        maintenance: true,
                        message: 'التطبيق تحت الصيانة حاليًا'
                      });
                    }

                    next();
                  }
                );
                return;
              }

              next();
          }
        );
      } else {
        next();
      }
    }
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'جلسة الدخول منتهية أو غير صالحة'
    });
  }
}
 

/* PROTECTED CHAT MEDIA */
app.get('/uploads/messages/:fileName', requireAuth, (req, res) => {
  const fileName = String(req.params.fileName || '');

  // منع أي محاولة Path Traversal
  if (
    !fileName ||
    fileName !== require('path').basename(fileName) ||
    fileName.includes('\x00')
  ) {
    return res.status(400).json({
      success: false,
      message: 'اسم الملف غير صالح'
    });
  }

  const mediaUrl = `/uploads/messages/${fileName}`;
  const userId = Number(req.user.id);

  db.get(
    `SELECT id
     FROM messages
     WHERE media_url = ?
       AND (sender_id = ? OR receiver_id = ?)
     LIMIT 1`,
    [mediaUrl, userId, userId],
    (err, message) => {
      if (err) {
        console.error('CHAT MEDIA ACCESS ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'تعذر التحقق من صلاحية الملف'
        });
      }

      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'الملف غير موجود أو غير مصرح لك بالوصول إليه'
        });
      }

      const filePath = require('path').join(
        __dirname,
        'uploads',
        'messages',
        fileName
      );

      return res.sendFile(filePath, (sendErr) => {
        if (sendErr && !res.headersSent) {
          return res.status(404).json({
            success: false,
            message: 'الملف غير موجود'
          });
        }
      });
    }
  );
});

function verifyWebSocketToken(token) {
  if (!token) return null;

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

app.get('/api/referrals/me', requireAuth, (req, res) => {
  const userId = Number(req.user.id);

  db.get(
    `SELECT referral_code FROM users WHERE id = ? LIMIT 1`,
    [userId],
    (err, user) => {
      if (err) {
        console.error('REFERRAL ME ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'تعذر تحميل بيانات الدعوات'
        });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود'
        });
      }

      db.get(
        `SELECT
           COUNT(*) AS invited_count,
           COALESCE(SUM(CASE WHEN rewarded = 1 THEN reward_points ELSE 0 END), 0) AS earned_points
         FROM referrals
         WHERE inviter_id = ?`,
        [userId],
        (statsErr, stats) => {
          if (statsErr) {
            console.error('REFERRAL STATS ERROR:', statsErr);
            return res.status(500).json({
              success: false,
              message: 'تعذر تحميل إحصائيات الدعوات'
            });
          }

          return res.json({
            success: true,
            referral_code: user.referral_code,
            invited_count: Number(stats?.invited_count || 0),
            earned_points: Number(stats?.earned_points || 0)
          });
        }
      );
    }
  );
});


// SURIANA — ADMIN MODERATORS

app.get('/api/admin/moderators', requireAuth, requireOwner, (req, res) => {
  db.all(
    `SELECT id, name, email, role, is_banned, created_at
     FROM users
     WHERE role = 'admin'
     ORDER BY id DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('ADMIN MODERATORS LIST ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      return res.json({
        success: true,
        moderators: rows
      });
    }
  );
});

app.post('/api/admin/moderators/:id/add', requireAuth, requireOwner, (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'معرّف المستخدم غير صالح'
    });
  }

  if (userId === Number(req.user.id)) {
    return res.status(400).json({
      success: false,
      message: 'المالك لا يحتاج إلى إضافة نفسه كمشرف'
    });
  }

  db.run(
    `UPDATE users
     SET role = 'admin'
     WHERE id = ? AND role = 'user'`,
    [userId],
    function(err) {
      if (err) {
        console.error('ADMIN MODERATOR ADD ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      if (this.changes !== 1) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود أو ليس مستخدماً عادياً'
        });
      }

      return res.json({
        success: true,
        message: 'تمت إضافة المشرف'
      });
    }
  );
});

app.post('/api/admin/moderators/:id/remove', requireAuth, requireOwner, (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'معرّف المستخدم غير صالح'
    });
  }

  if (userId === Number(req.user.id)) {
    return res.status(400).json({
      success: false,
      message: 'لا يمكن إزالة صلاحية المالك'
    });
  }

  db.run(
    `UPDATE users
     SET role = 'user'
     WHERE id = ? AND role = 'admin'`,
    [userId],
    function(err) {
      if (err) {
        console.error('ADMIN MODERATOR REMOVE ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      if (this.changes !== 1) {
        return res.status(404).json({
          success: false,
          message: 'المشرف غير موجود'
        });
      }

      db.run(
        `UPDATE admin_sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND revoked_at IS NULL`,
        [userId],
        (sessionErr) => {
          if (sessionErr) {
            console.error('ADMIN MODERATOR SESSION REVOKE ERROR:', sessionErr);
          }

          return res.json({
            success: true,
            message: 'تمت إزالة صلاحية المشرف وإنهاء جلساته'
          });
        }
      );
    }
  );
});

// SURIANA — ADMIN SECURITY SESSIONS

app.get('/api/admin/security/sessions', requireAuth, requireOwner, (req, res) => {
  db.all(
    `SELECT
       s.id,
       s.user_id,
       u.name,
       u.email,
       u.role,
       u.is_banned,
       s.jti,
       s.ip,
       s.user_agent,
       s.created_at,
       s.last_seen,
       s.revoked_at
     FROM admin_sessions s
     JOIN users u ON u.id = s.user_id
     ORDER BY s.id DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('ADMIN SECURITY SESSIONS ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      return res.json({
        success: true,
        sessions: rows
      });
    }
  );
});

app.post('/api/admin/security/sessions/:id/revoke', requireAuth, requireOwner, (req, res) => {
  const sessionId = Number(req.params.id);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'معرّف الجلسة غير صالح'
    });
  }

  db.run(
    `UPDATE admin_sessions
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = ? AND revoked_at IS NULL`,
    [sessionId],
    function(err) {
      if (err) {
        console.error('ADMIN SESSION REVOKE ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      if (this.changes !== 1) {
        return res.status(404).json({
          success: false,
          message: 'الجلسة غير موجودة أو منتهية مسبقاً'
        });
      }

      return res.json({
        success: true,
        message: 'تم طرد الجلسة'
      });
    }
  );
});

app.post('/api/admin/security/users/:id/ban', requireAuth, requireOwner, (req,res)=>{
  const userId = Number(req.params.id);

  if(!Number.isInteger(userId) || userId <= 0){
    return res.status(400).json({
      success:false,
      message:'معرف المستخدم غير صالح'
    });
  }

  if(Number(req.user.id) === userId){
    return res.status(400).json({
      success:false,
      message:'لا يمكنك حظر حساب المالك'
    });
  }

  db.serialize(()=>{
    db.run('BEGIN IMMEDIATE', (beginErr)=>{
      if(beginErr){
        return res.status(500).json({
          success:false,
          message:'تعذر بدء عملية الحظر'
        });
      }

      db.get(
        `SELECT id,name,role,is_banned
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [userId],
        (findErr,user)=>{
          if(findErr || !user){
            return db.run('ROLLBACK', ()=>{
              res.status(findErr ? 500 : 404).json({
                success:false,
                message:findErr ? 'خطأ في قاعدة البيانات' : 'المستخدم غير موجود'
              });
            });
          }

          if(user.role === 'owner'){
            return db.run('ROLLBACK', ()=>{
              res.status(403).json({
                success:false,
                message:'لا يمكن حظر المالك'
              });
            });
          }

          db.run(
            `UPDATE users
             SET is_banned = 1
             WHERE id = ? AND role != 'owner'`,
            [userId],
            (banErr)=>{
              if(banErr){
                return db.run('ROLLBACK', ()=>{
                  res.status(500).json({
                    success:false,
                    message:'فشل حظر الحساب'
                  });
                });
              }

              db.run(
                `UPDATE admin_sessions
                 SET revoked_at = CURRENT_TIMESTAMP
                 WHERE user_id = ? AND revoked_at IS NULL`,
                [userId],
                (sessionErr)=>{
                  if(sessionErr){
                    return db.run('ROLLBACK', ()=>{
                      res.status(500).json({
                        success:false,
                        message:'فشل إنهاء جلسات الحساب'
                      });
                    });
                  }

                  db.run('COMMIT', (commitErr)=>{
                    if(commitErr){
                      return db.run('ROLLBACK', ()=>{
                        res.status(500).json({
                          success:false,
                          message:'فشل تثبيت عملية الحظر'
                        });
                      });
                    }

                    res.json({
                      success:true,
                      message:'تم حظر الحساب وإنهاء جميع جلساته'
                    });
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});


app.post('/api/admin/security/users/:id/unban', requireAuth, requireOwner, (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'معرّف المستخدم غير صالح'
    });
  }

  db.run(
    `UPDATE users
     SET is_banned = 0
     WHERE id = ? AND role != 'owner'`,
    [userId],
    function(err) {
      if (err) {
        console.error('ADMIN SECURITY UNBAN ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      if (this.changes !== 1) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود أو لا يمكن تعديل حسابه'
        });
      }

      return res.json({
        success: true,
        message: 'تم إلغاء حظر الحساب'
      });
    }
  );
});

// SURIANA — ADMIN DIRECT WALLET CHARGE
app.post('/api/admin/wallet/charge', requireAuth, requireAdmin, (req,res)=>{
  const userId = Number(req.body?.user_id);
  const points = Number(req.body?.points);

  if(!Number.isInteger(userId) || userId <= 0){
    return res.status(400).json({
      success:false,
      message:'ID المستخدم غير صالح'
    });
  }

  if(!Number.isInteger(points) || points <= 0){
    return res.status(400).json({
      success:false,
      message:'عدد النقاط يجب أن يكون رقماً صحيحاً موجباً'
    });
  }

  db.get(
    `SELECT id,name,points FROM users WHERE id=?`,
    [userId],
    (err,user)=>{
      if(err){
        console.error('ADMIN DIRECT CHARGE USER ERROR:',err);
        return res.status(500).json({
          success:false,
          message:'تعذر البحث عن المستخدم'
        });
      }

      if(!user){
        return res.status(404).json({
          success:false,
          message:'المستخدم غير موجود'
        });
      }

      db.run(
        `UPDATE users SET points = points + ? WHERE id=?`,
        [points,userId],
        function(updateErr){
          if(updateErr){
            console.error('ADMIN DIRECT CHARGE UPDATE ERROR:',updateErr);
            return res.status(500).json({
              success:false,
              message:'تعذر إضافة النقاط'
            });
          }

          db.run(
            `INSERT INTO wallet_logs
             (user_id,type,points,description)
             VALUES(?,?,?,?)`,
            [
              userId,
              'admin_charge',
              points,
              'شحن مباشر من الإدارة'
            ],
            function(logErr){
              if(logErr){
                console.error('ADMIN DIRECT CHARGE LOG ERROR:',logErr);
                return res.status(500).json({
                  success:false,
                  message:'تم تحديث الرصيد لكن تعذر تسجيل العملية'
                });
              }

              createNotification(
                userId,
                'تم شحن رصيدك ⭐',
                `تمت إضافة ${points} نقطة إلى رصيدك من الإدارة`,
                'charge'
              );

              res.json({
                success:true,
                message:'تم شحن الرصيد بنجاح'
              });
            }
          );
        }
      );
    }
  );
});

// SURIANA — ADMIN DIRECT WALLET WITHDRAW
app.post('/api/admin/wallet/withdraw', requireAuth, requireAdmin, (req,res)=>{
  const userId = Number(req.body?.user_id);
  const points = Number(req.body?.points);

  if(!Number.isInteger(userId) || userId <= 0){
    return res.status(400).json({
      success:false,
      message:'ID المستخدم غير صالح'
    });
  }

  if(!Number.isInteger(points) || points <= 0){
    return res.status(400).json({
      success:false,
      message:'عدد النقاط يجب أن يكون رقماً صحيحاً موجباً'
    });
  }

  db.run('BEGIN IMMEDIATE', (beginErr)=>{
    if(beginErr){
      console.error('ADMIN DIRECT WITHDRAW BEGIN ERROR:',beginErr);
      return res.status(500).json({
        success:false,
        message:'تعذر بدء عملية السحب'
      });
    }

    db.get(
      `SELECT id,name,points FROM users WHERE id=?`,
      [userId],
      (err,user)=>{
        if(err || !user){
          return db.run('ROLLBACK', ()=>{
            res.status(err ? 500 : 404).json({
              success:false,
              message:err ? 'تعذر البحث عن المستخدم' : 'المستخدم غير موجود'
            });
          });
        }

        const currentPoints = Number(user.points || 0);

        if(currentPoints < points){
          return db.run('ROLLBACK', ()=>{
            res.status(400).json({
              success:false,
              message:'رصيد المستخدم غير كافي للسحب'
            });
          });
        }

        db.run(
          `UPDATE users
           SET points = points - ?
           WHERE id=? AND points >= ?`,
          [points,userId,points],
          function(updateErr){
            if(updateErr || this.changes !== 1){
              return db.run('ROLLBACK', ()=>{
                res.status(400).json({
                  success:false,
                  message:'تعذر خصم النقاط'
                });
              });
            }

            db.run(
              `INSERT INTO wallet_logs
               (user_id,type,points,description)
               VALUES(?,?,?,?)`,
              [
                userId,
                'admin_withdraw',
                -points,
                'سحب مباشر من الإدارة'
              ],
              function(logErr){
                if(logErr){
                  console.error('ADMIN DIRECT WITHDRAW LOG ERROR:',logErr);
                  return db.run('ROLLBACK', ()=>{
                    res.status(500).json({
                      success:false,
                      message:'تعذر تسجيل عملية السحب'
                    });
                  });
                }

                db.run('COMMIT',(commitErr)=>{
                  if(commitErr){
                    return db.run('ROLLBACK',()=>{
                      res.status(500).json({
                        success:false,
                        message:'تعذر تثبيت عملية السحب'
                      });
                    });
                  }

                  createNotification(
                    userId,
                    'تم سحب نقاط من رصيدك',
                    `تم سحب ${points} نقطة من رصيدك بواسطة الإدارة`,
                    'withdraw'
                  );

                  db.get(
                    `SELECT points,role FROM users WHERE id=?`,
                    [userId],
                    (balanceErr,row)=>{
                      res.json({
                        success:true,
                        message:'تم سحب النقاط من المستخدم بنجاح',
                        user:{
                          id:user.id,
                          name:user.name,
                          points:Number(row?.points || 0)
                        },
                        withdrawn_points:points
                      });
                    }
                  );
                });
              }
            );
          }
        );
      }
    );
  });
});

// SURIANA — REAL PROFILE NAME EDIT

app.put("/api/profile/avatar", requireAuth, (req, res) => {
  const userId = Number(req.user.id);
  const { avatar } = req.body || {};

  if (!avatar || typeof avatar !== "string") {
    return res.status(400).json({
      success: false,
      message: "صورة البروفايل مطلوبة"
    });
  }

  const match = avatar.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);

  if (!match) {
    return res.status(400).json({
      success: false,
      message: "صيغة صورة البروفايل غير مدعومة"
    });
  }

  const mime = match[1];
  const base64 = match[2];

  let buffer;

  try {
    buffer = Buffer.from(base64, "base64");
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: "تعذر قراءة صورة البروفايل"
    });
  }

  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      message: "حجم صورة البروفايل يجب ألا يتجاوز 8MB"
    });
  }

  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xFF &&
    buffer[1] === 0xD8 &&
    buffer[2] === 0xFF;

  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A;

  const isWebp =
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";

  if (
    (mime === "image/jpeg" && !isJpeg) ||
    (mime === "image/png" && !isPng) ||
    (mime === "image/webp" && !isWebp)
  ) {
    return res.status(400).json({
      success: false,
      message: "ملف البروفايل ليس صورة صالحة"
    });
  }

  const ext =
    mime === "image/png"
      ? "png"
      : mime === "image/webp"
        ? "webp"
        : "jpg";

  const avatarDir = require("path").join(
    __dirname,
    "uploads",
    "avatars"
  );

  try {
    fs.mkdirSync(avatarDir, { recursive: true });
  } catch (err) {
    console.error("AVATAR DIR ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "تعذر تجهيز تخزين صورة البروفايل"
    });
  }

  const fileName =
    `${userId}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${ext}`;

  const filePath = require("path").join(avatarDir, fileName);

  try {
    fs.writeFileSync(filePath, buffer);
  } catch (err) {
    console.error("AVATAR SAVE ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "تعذر حفظ صورة البروفايل"
    });
  }

  const avatarPath = `/uploads/avatars/${fileName}`;

  db.run(
    `UPDATE users SET avatar=? WHERE id=?`,
    [avatarPath, userId],
    function(err) {
      if (err) {
        console.error("AVATAR DB UPDATE ERROR:", err);

        try {
          fs.unlinkSync(filePath);
        } catch (cleanupErr) {
          console.error("AVATAR CLEANUP ERROR:", cleanupErr);
        }

        return res.status(500).json({
          success: false,
          message: "تعذر حفظ صورة البروفايل"
        });
      }

      return res.json({
        success: true,
        avatar: avatarPath
      });
    }
  );
});

app.put("/api/profile/name", requireAuth, (req, res) => {
  const userId = Number(req.user.id);
  const name = String(req.body?.name || "").trim();

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "المستخدم غير صالح"
    });
  }

  if (!name) {
    return res.status(400).json({
      success: false,
      message: "الاسم لا يمكن أن يكون فارغاً"
    });
  }

  if (name.length < 2 || name.length > 40) {
    return res.status(400).json({
      success: false,
      message: "الاسم يجب أن يكون بين حرفين و40 حرفاً"
    });
  }

  db.run(
    `UPDATE users SET name=? WHERE id=?`,
    [name, userId],
    function(err) {
      if (err) {
        console.error("PROFILE NAME UPDATE ERROR:", err);
        return res.status(500).json({
          success: false,
          message: "تعذر تحديث الاسم"
        });
      }

      if (this.changes === 0) {
        return res.status(404).json({
          success: false,
          message: "المستخدم غير موجود"
        });
      }

      res.json({
        success: true,
        message: "تم تحديث الاسم بنجاح",
        name
      });
    }
  );
});

app.get('/api/me', requireAuth, (req, res) => {
  if (req.user.role === 'owner') {
    return res.json({
      success: true,
      role: 'owner',
      user: req.user
    });
  }

  db.get(
    `SELECT * FROM users WHERE id = ? LIMIT 1`,
    [req.user.id],
    (err, user) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود'
        });
      }


      res.json({
        success: true,
        role: user.role,
        user: cleanUser(user)
      });
    }
  );
});




app.get('/api/users/search', requireAuth, (req,res)=>{

  const q = (req.query.q || '').trim();

  let sql = `
    SELECT 
      id,
      public_id,
      name,
      age,
      city,
      gender,
      role,
      is_verified,
      avatar
    FROM users
    WHERE is_banned = 0
      AND id != ?
  `;

  let params=[Number(req.user.id)];

  if(q){
    sql += `
      AND (
        name LIKE ?
        OR CAST(public_id AS TEXT) LIKE ?
      )
    `;
    params.push(
      `%${q}%`,
      `%${q}%`
    );
  }

  sql += " ORDER BY id DESC LIMIT 50";

  db.all(sql,params,(err,rows)=>{
    if(err){
      return res.status(500).json({
        success:false,
        message:"خطأ في البحث"
      });
    }

    const userIds = rows.map(u => Number(u.id)).filter(Boolean);

    if(userIds.length === 0){
      return res.json({
        success:true,
        users:[]
      });
    }

    const placeholders = userIds.map(() => "?").join(",");

    db.all(
      `SELECT
         user_id,
         COALESCE(SUM(
           CASE
             WHEN type IN ('call','gift','message') AND points < 0
             THEN ABS(points)
             ELSE 0
           END
         ),0) AS wealth,

         COALESCE(SUM(
           CASE
             WHEN type='call_income' AND points > 0
             THEN points
             WHEN type='gift'
              AND points > 0
              AND description='استلام أرباح هدية'
             THEN points
             ELSE 0
           END
         ),0) AS attraction

       FROM wallet_logs
       WHERE user_id IN (${placeholders})
       GROUP BY user_id`,
      userIds,
      (statsErr, statsRows)=>{
        if(statsErr){
          return res.status(500).json({
            success:false,
            message:"خطأ في حساب مستويات المستخدمين"
          });
        }

        const statsMap = new Map(
          statsRows.map(x => [Number(x.user_id), x])
        );

        const users = rows.map(u=>{
          const st = statsMap.get(Number(u.id));
          const wealth = Number(st?.wealth) || 0;
          const attraction = Number(st?.attraction) || 0;
          const isFemale =
            String(u.gender || "") === "أنثى" ||
            String(u.gender || "") === "بنت";

          return {
            ...u,
            powerLevel: isFemale
              ? Math.floor(attraction / 1000)
              : Math.floor(wealth / 1000)
          };
        });

        res.json({
          success:true,
          users
        });
      }
    );
  });

});


app.get('/api/users/:id/profile', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({
      success: false,
      message: "معرّف المستخدم غير صالح"
    });
  }

  db.get(
    `SELECT
       id,
       public_id,
       name,
       age,
       city,
       gender,
       role,
       birth_date,
       created_at,
       is_verified,
       avatar
     FROM users
     WHERE id = ? AND is_banned = 0`,
    [targetId],
    (err, user) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "تعذر قراءة البروفايل"
        });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "المستخدم غير موجود"
        });
      }

      db.get(
        `SELECT
           COALESCE(SUM(
             CASE
               WHEN type IN ('call','gift','message') AND points < 0
               THEN ABS(points)
               ELSE 0
             END
           ),0) AS wealth,

           COALESCE(SUM(
             CASE
               WHEN type='call_income' AND points > 0
               THEN points
               WHEN type='gift'
                    AND points > 0
                    AND description='استلام أرباح هدية'
               THEN points
               ELSE 0
             END
           ),0) AS attraction
         FROM wallet_logs
         WHERE user_id = ?`,
        [targetId],
        (statsErr, stats) => {
          if (statsErr) {
            return res.status(500).json({
              success: false,
              message: "تعذر حساب مستوى المستخدم"
            });
          }

          const wealth = Number(stats?.wealth) || 0;
          const attraction = Number(stats?.attraction) || 0;

          const isFemale =
            String(user.gender || "") === "أنثى" ||
            String(user.gender || "") === "بنت";

          const powerValue = isFemale ? attraction : wealth;
          const powerLevel = Math.floor(powerValue / 1000);

          db.get(
            `SELECT COUNT(*) AS likesCount
             FROM profile_likes
             WHERE liked_id = ?`,
            [targetId],
            (likesErr, likesRow) => {
              if (likesErr) {
                return res.status(500).json({
                  success: false,
                  message: "تعذر قراءة الإعجابات"
                });
              }

              return res.json({
                success: true,
                profile: {
                  ...user,
                  wealth,
                  attraction,
                  powerLevel,
                  likesCount: Number(likesRow?.likesCount) || 0
                }
              });
            }
          );
        }
      );
    }
  );
});

app.post('/api/friends/request', requireAuth, (req, res) => {
  const requesterId = Number(req.user.id);
  const addresseeId = Number(req.body.user_id);

  if (!Number.isInteger(addresseeId) || addresseeId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'معرّف المستخدم غير صالح'
    });
  }

  if (requesterId === addresseeId) {
    return res.status(400).json({
      success: false,
      message: 'لا يمكنك إرسال طلب صداقة لنفسك'
    });
  }

  db.get(
    `SELECT id FROM users WHERE id = ? LIMIT 1`,
    [addresseeId],
    (userErr, targetUser) => {
      if (userErr) {
        console.error(userErr);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود'
        });
      }

      db.get(
        `SELECT id, requester_id, addressee_id, status
         FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?)
         LIMIT 1`,
        [requesterId, addresseeId, addresseeId, requesterId],
        (friendErr, existing) => {
          if (friendErr) {
            console.error(friendErr);
            return res.status(500).json({
              success: false,
              message: 'خطأ في قاعدة البيانات'
            });
          }

          if (existing) {
            return res.status(409).json({
              success: false,
              message:
                existing.status === 'accepted'
                  ? 'أنتم أصدقاء بالفعل'
                  : 'يوجد طلب صداقة قائم بالفعل'
            });
          }

          db.run(
            `INSERT INTO friendships
             (requester_id, addressee_id, status)
             VALUES (?, ?, 'pending')`,
            [requesterId, addresseeId],
            function (insertErr) {
              if (insertErr) {
                console.error(insertErr);
                return res.status(500).json({
                  success: false,
                  message: 'تعذر إرسال طلب الصداقة'
                });
              }

              return res.status(201).json({
                success: true,
                message: 'تم إرسال طلب الصداقة',
                friendship_id: this.lastID
              });
            }
          );
        }
      );
    }
  );
});


app.post('/api/friends/accept', requireAuth, (req, res) => {
  const userId = Number(req.user.id);
  const friendshipId = Number(req.body.friendship_id);

  if (!Number.isInteger(friendshipId) || friendshipId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'معرّف طلب الصداقة غير صالح'
    });
  }

  db.get(
    `SELECT id, requester_id, addressee_id, status
     FROM friendships
     WHERE id = ? AND addressee_id = ? AND status = 'pending'
     LIMIT 1`,
    [friendshipId, userId],
    (err, friendship) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      if (!friendship) {
        return res.status(404).json({
          success: false,
          message: 'طلب الصداقة غير موجود أو لا يمكنك قبوله'
        });
      }

      db.run(
        `UPDATE friendships
         SET status = 'accepted',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [friendshipId],
        function (updateErr) {
          if (updateErr) {
            console.error(updateErr);
            return res.status(500).json({
              success: false,
              message: 'تعذر قبول طلب الصداقة'
            });
          }

          return res.json({
            success: true,
            message: 'تم قبول طلب الصداقة',
            friendship_id: friendshipId
          });
        }
      );
    }
  );
});


app.post('/api/friends/reject', requireAuth, (req, res) => {
  const userId = Number(req.user.id);
  const friendshipId = Number(req.body.friendship_id);

  if (!Number.isInteger(friendshipId) || friendshipId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'معرّف طلب الصداقة غير صالح'
    });
  }

  db.get(
    `SELECT id, requester_id, addressee_id, status
     FROM friendships
     WHERE id = ? AND addressee_id = ? AND status = 'pending'
     LIMIT 1`,
    [friendshipId, userId],
    (err, friendship) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      if (!friendship) {
        return res.status(404).json({
          success: false,
          message: 'طلب الصداقة غير موجود أو لا يمكنك رفضه'
        });
      }

      db.run(
        `UPDATE friendships
         SET status = 'rejected',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [friendshipId],
        function (updateErr) {
          if (updateErr) {
            console.error(updateErr);
            return res.status(500).json({
              success: false,
              message: 'تعذر رفض طلب الصداقة'
            });
          }

          return res.json({
            success: true,
            message: 'تم رفض طلب الصداقة',
            friendship_id: friendshipId
          });
        }
      );
    }
  );
});


app.get('/api/friends/requests/incoming', requireAuth, (req, res) => {
  const userId = Number(req.user.id);

  db.all(
    `SELECT
       f.id AS friendship_id,
       f.requester_id,
       u.name,
       u.email,
       f.status,
       f.created_at
     FROM friendships f
     JOIN users u ON u.id = f.requester_id
     WHERE f.addressee_id = ?
       AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      return res.json({
        success: true,
        requests: rows
      });
    }
  );
});


app.get('/api/friends/requests/outgoing', requireAuth, (req, res) => {
  const userId = Number(req.user.id);

  db.all(
    `SELECT
       f.id AS friendship_id,
       f.addressee_id,
       u.name,
       u.email,
       f.status,
       f.created_at
     FROM friendships f
     JOIN users u ON u.id = f.addressee_id
     WHERE f.requester_id = ?
     ORDER BY f.created_at DESC`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      return res.json({
        success: true,
        requests: rows
      });
    }
  );
});


app.get('/api/friends', requireAuth, (req, res) => {
  const userId = Number(req.user.id);

  db.all(
    `SELECT
       f.id AS friendship_id,
       u.id AS user_id,
       u.name,
       u.email,
       u.age,
       u.city,
       u.gender,
       f.created_at
     FROM friendships f
     JOIN users u
       ON (
         CASE
           WHEN f.requester_id = ? THEN u.id = f.addressee_id
           ELSE u.id = f.requester_id
         END
       )
     WHERE (f.requester_id = ? OR f.addressee_id = ?)
       AND f.status = 'accepted'
     ORDER BY f.created_at DESC`,
    [userId, userId, userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      return res.json({
        success: true,
        friends: rows
      });
    }
  );
});


// CHAT_STATUS_DB_READY
const typingStatus=new Map();
function updateLastSeen(id){id=Number(id);if(!Number.isInteger(id)||id<=0)return;db.run("UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?",[id]);}
const PORT = process.env.PORT || 3000;




/* CHAT_BLOCK_API_READY */
function usersBlocked(a,b,cb){
  db.get(
    `SELECT id FROM user_blocks
     WHERE (blocker_id=? AND blocked_id=?)
        OR (blocker_id=? AND blocked_id=?)
     LIMIT 1`,
    [Number(a),Number(b),Number(b),Number(a)],
    (err,row)=>cb(err,!!row)
  );
}

app.post('/api/blocks/:user_id',requireAuth,(req,res)=>{
  const me=Number(req.user.id);
  const other=Number(req.params.user_id);

  if(!Number.isInteger(other)||other<=0||other===me)
    return res.status(400).json({success:false,message:'المستخدم غير صالح'});

  db.get(
    'SELECT id,role FROM users WHERE id=?',
    [other],
    (userErr,target)=>{
      if(userErr){
        console.error('BLOCK USER LOOKUP ERROR:',userErr);
        return res.status(500).json({success:false,message:'خطأ في قاعدة البيانات'});
      }

      if(!target)
        return res.status(404).json({success:false,message:'المستخدم غير موجود'});

      if(target.role === 'owner')
        return res.status(403).json({
          success:false,
          blocked:false,
          message:'لا يمكن حظر المالك'
        });

      db.run(
        'INSERT OR IGNORE INTO user_blocks(blocker_id,blocked_id) VALUES(?,?)',
        [me,other],
        function(err){
          if(err){
            console.error('BLOCK ERROR:',err);
            return res.status(500).json({success:false,message:'تعذر حظر المستخدم'});
          }
          res.json({success:true,blocked:true});
        }
      );
    }
  );
});

app.delete('/api/blocks/:user_id',requireAuth,(req,res)=>{
  const me=Number(req.user.id);
  const other=Number(req.params.user_id);

  db.run(
    'DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?',
    [me,other],
    function(err){
      if(err) return res.status(500).json({success:false});
      res.json({success:true,blocked:false});
    }
  );
});

app.get('/api/blocks/:user_id',requireAuth,(req,res)=>{
  usersBlocked(req.user.id,req.params.user_id,(err,blocked)=>{
    if(err) return res.status(500).json({success:false});
    res.json({success:true,blocked});
  });
});


function chatBlockGuard(req,res,next){
  const me=Number(req.user.id);
  const other=Number(req.body.receiver_id);

  if(!Number.isInteger(other)||other<=0||other===me)return next();

  usersBlocked(me,other,(err,blocked)=>{
    if(err){
      console.error('CHAT BLOCK CHECK ERROR:',err);
      return res.status(500).json({success:false,message:'تعذر التحقق من الحظر'});
    }

    if(blocked){
      return res.status(403).json({
        success:false,
        blocked:true,
        message:'لا يمكنك مراسلة هذا المستخدم لأنه محظور'
      });
    }

    next();
  });
}

/* CHAT_BLOCK_GUARD_READY */
app.post('/api/messages', requireAuth, chatBlockGuard, (req, res) => {
  const senderId = Number(req.user.id);
  const receiverId = Number(req.body.receiver_id);
  const content = req.body.content;

  if (!receiverId || !content) {
    return res.status(400).json({
      success:false,
      message:'بيانات الرسالة ناقصة'
    });
  }

  if (typeof content !== 'string') {
    return res.status(400).json({
      success:false,
      message:'محتوى الرسالة غير صالح'
    });
  }

  if (content.length > 100000) {
    return res.status(413).json({
      success:false,
      message:'الرسالة طويلة جداً'
    });
  }

  const isOwner =
    req.user.role === 'owner';

  // المالك يرسل مجانًا
  if (isOwner) {
    return db.run(
      `INSERT INTO messages
       (sender_id, receiver_id, content, cost, is_paid, is_delivered, delivered_at)
       VALUES (?, ?, ?, 0, 0, 0, NULL)`,
      [senderId, receiverId, content],
      function(insertErr) {
        if (insertErr) {
          return res.status(500).json({
            success:false,
            message:insertErr.message
          });
        }

        createNotification(
          receiverId,
          'رسالة جديدة',
          'لديك رسالة جديدة 💬',
          'message'
        );
        sendTelegramMessageBotAlert(senderId, receiverId, content, this.lastID);

        return res.json({
          success:true,
          message_id:this.lastID,
          paid:false,
          cost:0
        });
      }
    );
  }

  // جلب جنس الطرفين
  db.all(
    `SELECT id, gender FROM users WHERE id IN (?, ?)`,
    [senderId, receiverId],
    (usersErr, users) => {
      if (usersErr) {
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      const sender = users.find(u => Number(u.id) === senderId);
      const receiver = users.find(u => Number(u.id) === receiverId);

      if (!sender || !receiver) {
        return res.status(404).json({
          success:false,
          message:'المستخدم غير موجود'
        });
      }

      const senderGender = String(sender.gender || '');
      const receiverGender = String(receiver.gender || '');

      const senderFemale =
        senderGender === 'أنثى' || senderGender === 'بنت';

      const receiverFemale =
        receiverGender === 'أنثى' || receiverGender === 'بنت';

      const senderMale = senderGender === 'ذكر';
      const receiverMale = receiverGender === 'ذكر';

      // ❤️ إذا كان الإعجاب متبادلًا تصبح المحادثة مجانية
      db.get(
        `SELECT id
         FROM profile_likes
         WHERE liker_id=? AND liked_id=?`,
        [receiverId, senderId],
        (reverseLikeErr, reverseLike) => {
          if (reverseLikeErr) {
            return res.status(500).json({
              success:false,
              message:'تعذر التحقق من الإعجاب المتبادل'
            });
          }

          db.get(
            `SELECT id
             FROM profile_likes
             WHERE liker_id=? AND liked_id=?`,
            [senderId, receiverId],
            (myLikeErr, myLike) => {
              if (myLikeErr) {
                return res.status(500).json({
                  success:false,
                  message:'تعذر التحقق من الإعجاب المتبادل'
                });
              }

              const mutualLike = !!reverseLike && !!myLike;

              // ❤️ إعجاب متبادل = مجاني للطرفين
              if (mutualLike) {
                return db.run(
                  `INSERT INTO messages
                   (sender_id, receiver_id, content, cost, is_paid, is_delivered, delivered_at)
                   VALUES (?, ?, ?, 0, 0, 0, NULL)`,
                  [senderId, receiverId, content],
                  function(insertErr) {
                    if (insertErr) {
                      return res.status(500).json({
                        success:false,
                        message:insertErr.message
                      });
                    }

                    createNotification(
                      receiverId,
                      'رسالة جديدة',
                      'لديك رسالة جديدة 💬',
                      'message'
                    );
        sendTelegramMessageBotAlert(senderId, receiverId, content, this.lastID);

                    return res.json({
                      success:true,
                      message_id:this.lastID,
                      paid:false,
                      cost:0,
                      mutual_like:true
                    });
                  }
                );
              }

              /*
               * قواعد الدفع:
               * ذكر -> أنثى : 5 نقاط
               * أنثى -> ذكر : مجاني
               * ذكر -> ذكر   : 1 نقطة
               * أنثى -> أنثى : 1 نقطة
               */

              let cost = 1;
              let receiverProfit = 0;
              let adminProfit = 1;
              let paidType = 'message';

              if (senderMale && receiverFemale) {
                cost = 5;
                receiverProfit = 0;
                adminProfit = 4;
                paidType = 'message';
              } else if (senderFemale && receiverMale) {
                cost = 0;
                receiverProfit = 0;
                adminProfit = 0;
              } else if (
                (senderMale && receiverMale) ||
                (senderFemale && receiverFemale)
              ) {
                cost = 1;
                receiverProfit = 0;
                adminProfit = 1;
                paidType = 'message';
              }

              // رسالة مجانية
if (cost === 0) {
  return db.run(
    `INSERT INTO messages
     (sender_id, receiver_id, content, cost, is_paid, is_delivered, delivered_at)
     VALUES (?, ?, ?, 0, 0, 0, NULL)`,
    [senderId, receiverId, content],
    function(insertErr) {
      if (insertErr) {
        return res.status(500).json({
          success:false,
          message:insertErr.message
        });
      }

      const newMessageId = this.lastID;

      createNotification(
        receiverId,
        'رسالة جديدة',
        'لديك رسالة جديدة 💬',
        'message'
      );
        sendTelegramMessageBotAlert(senderId, receiverId, content, newMessageId);

      // أنثى -> ذكر:
      // +1 فقط إذا كانت آخر رسالة قبل الرد من الذكر.
      if (senderFemale && receiverMale) {
        return db.get(
          `SELECT sender_id
           FROM messages
           WHERE id < ?
             AND (
               (sender_id=? AND receiver_id=?)
               OR
               (sender_id=? AND receiver_id=?)
             )
           ORDER BY id DESC
           LIMIT 1`,
          [
            newMessageId,
            receiverId, senderId,
            senderId, receiverId
          ],
          (lastErr, lastMessage) => {
            if (lastErr) {
              return res.status(500).json({
                success:false,
                message:'تعذر فحص رسالة الرد'
              });
            }

            const shouldReward =
              lastMessage &&
              Number(lastMessage.sender_id) === receiverId;

            if (!shouldReward) {
              return db.get(
                `SELECT points,role FROM users WHERE id=?`,
                [senderId],
                (balanceErr, row) => {
                  return res.json({
                    success:true,
                    message_id:newMessageId,
                    paid:false,
                    cost:0,
                    receiver_profit:0,
                    remaining_points:
                      balanceErr ? null : Number(row?.points ?? 0)
                  });
                }
              );
            }

            db.run(
              `UPDATE users
               SET points = points + 1
               WHERE id=?`,
              [senderId],
              function(rewardErr) {
                if (rewardErr || this.changes !== 1) {
                  return res.status(500).json({
                    success:false,
                    message:'تعذر إضافة مكافأة الرد'
                  });
                }

                db.run(
                  `INSERT INTO wallet_logs(user_id,type,points,description)
                   VALUES(?,?,?,?)`,
                  [
                    senderId,
                    'message',
                    1,
                    'مكافأة الرد على رسالة'
                  ]
                );

                db.get(
                  `SELECT points FROM users WHERE id=?`,
                  [senderId],
                  (balanceErr, row) => {
                    return res.json({
                      success:true,
                      message_id:newMessageId,
                      paid:false,
                      cost:0,
                      receiver_profit:1,
                      remaining_points:
                        balanceErr ? null : Number(row?.points ?? 0)
                    });
                  }
                );
              }
            );
          }
        );
      }

      return db.get(
        `SELECT points FROM users WHERE id=?`,
        [senderId],
        (balanceErr, row) => {
          return res.json({
            success:true,
            message_id:newMessageId,
            paid:false,
            cost:0,
            receiver_profit:0,
            remaining_points:
              balanceErr ? null : Number(row?.points ?? 0)
          });
        }
      );
    }
  );
}

// العملية المالية للرسالة المدفوعة
  db.run('BEGIN IMMEDIATE', (beginErr) => {
    if (beginErr) {
      return res.status(500).json({
        success:false,
        message:'تعذر بدء العملية المالية'
      });
    }

    const rollback = (status, message, logMessage) => {
      db.run('ROLLBACK', () => {
        if (logMessage) console.error(logMessage);
        return res.status(status).json({
          success:false,
          message
        });
      });
    };

    db.run(
      `UPDATE users
       SET points = points - ?
       WHERE id=? AND points >= ?`,
      [cost, senderId, cost],
      function(deductErr) {
        if (deductErr) {
          return rollback(500, 'خطأ أثناء خصم النقاط',
            'MESSAGE DEDUCT ERROR: ' + deductErr.message);
        }

        if (this.changes !== 1) {
          return rollback(400, 'الرصيد غير كافي');
        }

        const addReceiverProfit = (done) => {
          if (receiverProfit <= 0) return done(null);

          db.run(
            `UPDATE users SET points = points + ? WHERE id=?`,
            [receiverProfit, receiverId],
            function(receiverErr) {
              if (receiverErr || this.changes !== 1) {
                return done(receiverErr || new Error('تعذر تحديث رصيد المستلم'));
              }
              done(null);
            }
          );
        };

        addReceiverProfit((receiverErr) => {
          if (receiverErr) {
            return rollback(500, 'تعذر إضافة أرباح الرسالة',
              'MESSAGE RECEIVER PROFIT ERROR: ' + receiverErr.message);
          }

          db.run(
            `INSERT INTO wallet_logs(user_id,type,points,description)
             VALUES(?,?,?,?)`,
            [
              senderId,
              'message',
              -cost,
              cost === 5 ? 'إرسال رسالة مدفوعة' : 'إرسال رسالة'
            ],
            (senderLogErr) => {
              if (senderLogErr) {
                return rollback(500, 'تعذر تسجيل حركة الرسالة',
                  'MESSAGE SENDER LOG ERROR: ' + senderLogErr.message);
              }

              const insertReceiverLog = (done) => {
                if (receiverProfit <= 0) return done(null);

                db.run(
                  `INSERT INTO wallet_logs(user_id,type,points,description)
                   VALUES(?,?,?,?)`,
                  [
                    receiverId,
                    'message',
                    receiverProfit,
                    'استلام أرباح رسالة'
                  ],
                  (err) => done(err || null)
                );
              };

              insertReceiverLog((receiverLogErr) => {
                if (receiverLogErr) {
                  return rollback(500, 'تعذر تسجيل أرباح المستلم',
                    'MESSAGE RECEIVER LOG ERROR: ' + receiverLogErr.message);
                }

                const insertAdminProfit = (done) => {
                  if (adminProfit <= 0) return done(null);

                  db.run(
                    `INSERT INTO admin_profits(source,points)
                     VALUES('message',?)`,
                    [adminProfit],
                    (adminProfitErr) => {
                      if (adminProfitErr) return done(adminProfitErr);

                      db.run(
                        `INSERT INTO wallet_logs(user_id,type,points,description)
                         VALUES(NULL,'admin_profit',?,?)`,
                        [adminProfit, 'ربح الإدارة من رسالة'],
                        (adminLogErr) => done(adminLogErr || null)
                      );
                    }
                  );
                };

                insertAdminProfit((adminErr) => {
                  if (adminErr) {
                    return rollback(500, 'تعذر تسجيل ربح الإدارة',
                      'MESSAGE ADMIN ERROR: ' + adminErr.message);
                  }

                  db.run(
                    `INSERT INTO messages
                     (sender_id, receiver_id, content, cost, is_paid, is_delivered, delivered_at)
                     VALUES (?, ?, ?, ?, 1, 0, NULL)`,
                    [senderId, receiverId, content, cost],
                    function(insertErr) {
                      if (insertErr) {
                        return rollback(500, 'تعذر حفظ الرسالة',
                          'MESSAGE INSERT ERROR: ' + insertErr.message);
                      }

                      const messageId = this.lastID;

                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                          return db.run('ROLLBACK', () => {
                            return res.status(500).json({
                              success:false,
                              message:'تعذر إتمام العملية المالية'
                            });
                          });
                        }

                        createNotification(
                          receiverId,
                          'رسالة جديدة',
                          'لديك رسالة جديدة 💬',
                          'message'
                        );

                        sendTelegramMessageBotAlert(
                          senderId,
                          receiverId,
                          content,
                          messageId
                        );

                        db.get(
                          `SELECT points FROM users WHERE id=?`,
                          [senderId],
                          (balanceErr, row) => {
                            return res.json({
                              success:true,
                              message_id:messageId,
                              paid:true,
                              cost:cost,
                              remaining_points:
                                balanceErr ? null : Number(row.points),
                              receiver_profit:receiverProfit,
                              admin_profit:adminProfit
                            });
                          }
                        );
                      });
                    }
                  );
                });
              });
            }
          );
        });
      }
    );
  });
});

      });
    });
  });
/* CHAT_MEDIA_SEND_API */
app.post('/api/messages/media', requireAuth, chatBlockGuard, (req, res) => {
  const senderId = Number(req.user.id);
  const receiverId = Number(req.body.receiver_id);
  const messageType = String(req.body.message_type || '').trim();
  const media = req.body.media;

  if (!Number.isInteger(receiverId) || receiverId <= 0 || receiverId === senderId) {
    return res.status(400).json({
      success: false,
      message: 'المستخدم المستلم غير صالح'
    });
  }

  if (!['image', 'audio'].includes(messageType)) {
    return res.status(400).json({
      success: false,
      message: 'نوع الوسائط غير مدعوم'
    });
  }

  if (typeof media !== 'string' || !media.startsWith('data:')) {
    return res.status(400).json({
      success: false,
      message: 'ملف الوسائط مطلوب'
    });
  }

  const imageMatch = media.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/
  );

  const audioMatch = media.match(
    /^data:(audio\/(?:webm|mpeg|mp4|wav|ogg));base64,([A-Za-z0-9+/=\s]+)$/
  );

  let match = null;

  if (messageType === 'image') {
    match = imageMatch;
  } else if (messageType === 'audio') {
    match = audioMatch;
  }

  if (!match) {
    return res.status(400).json({
      success: false,
      message: messageType === 'image'
        ? 'صيغة الصورة غير مدعومة'
        : 'صيغة التسجيل الصوتي غير مدعومة'
    });
  }

  const mime = match[1];
  const base64 = match[2].replace(/\s/g, '');

  let buffer;

  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (decodeErr) {
    return res.status(400).json({
      success: false,
      message: 'تعذر قراءة ملف الوسائط'
    });
  }

  if (!buffer.length) {
    return res.status(400).json({
      success: false,
      message: 'ملف الوسائط فارغ'
    });
  }

  const maxSize = messageType === 'image'
    ? 8 * 1024 * 1024
    : 10 * 1024 * 1024;

  if (buffer.length > maxSize) {
    return res.status(400).json({
      success: false,
      message: messageType === 'image'
        ? 'حجم الصورة يجب ألا يتجاوز 8MB'
        : 'حجم التسجيل يجب ألا يتجاوز 10MB'
    });
  }

  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  const isWebp =
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';

  const isWebm =
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3;

  const isOgg =
    buffer.length >= 4 &&
    buffer.toString('ascii', 0, 4) === 'OggS';

  const isWav =
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE';

  const isMp4 =
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp';

  const isMp3 =
    buffer.length >= 3 &&
    (
      buffer.toString('ascii', 0, 3) === 'ID3' ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    );

  const validImage =
    (mime === 'image/jpeg' && isJpeg) ||
    (mime === 'image/png' && isPng) ||
    (mime === 'image/webp' && isWebp);

  const validAudio =
    (mime === 'audio/webm' && isWebm) ||
    (mime === 'audio/ogg' && isOgg) ||
    (mime === 'audio/wav' && isWav) ||
    (mime === 'audio/mp4' && isMp4) ||
    (mime === 'audio/mpeg' && isMp3);

  if ((messageType === 'image' && !validImage) ||
      (messageType === 'audio' && !validAudio)) {
    return res.status(400).json({
      success: false,
      message: 'محتوى الملف لا يطابق نوعه'
    });
  }

  const extMap = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3'
  };

  const ext = extMap[mime];

  if (!ext) {
    return res.status(400).json({
      success: false,
      message: 'امتداد الملف غير مدعوم'
    });
  }

  const mediaDir = require('path').join(__dirname, 'uploads', 'messages');
  fs.mkdirSync(mediaDir, { recursive: true });

  const fileName =
    `${senderId}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

  const filePath = require('path').join(mediaDir, fileName);
  const mediaUrl = `/uploads/messages/${fileName}`;

  try {
    fs.writeFileSync(filePath, buffer);
  } catch (writeErr) {
    return res.status(500).json({
      success: false,
      message: 'تعذر حفظ ملف الوسائط'
    });
  }

  const cleanupFile = () => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  };

  const isOwner =
    req.user.role === 'owner';

  const finishInsert = (cost, receiverProfit, adminProfit, paid, mutualLike) => {
    const doInsert = (finalCost, finalPaid, callback) => {
      db.run(
        `INSERT INTO messages
         (sender_id, receiver_id, content, cost, is_paid,
          message_type, media_url, is_delivered, is_read,
          delivered_at, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL)`,
        [
          senderId,
          receiverId,
          messageType === 'image' ? '📷 صورة' : '🎙️ تسجيل صوتي',
          finalCost,
          finalPaid,
          messageType,
          mediaUrl
        ],
        function(insertErr) {
          if (insertErr) {
            cleanupFile();
            return callback(insertErr);
          }

          const newMessageId = this.lastID;

          createNotification(
            receiverId,
            messageType === 'image' ? 'صورة جديدة' : 'تسجيل صوتي جديد',
            messageType === 'image'
              ? 'لديك صورة جديدة 🖼️'
              : 'لديك تسجيل صوتي جديد 🎙️',
            'message'
          );

          sendTelegramMessageBotMediaAlert(
            senderId,
            receiverId,
            messageType,
            filePath,
            fileName,
            newMessageId
          ).catch(err => {
            console.error('TELEGRAM MEDIA ALERT ERROR:', err.message);
          });

          db.get(
            `SELECT points FROM users WHERE id=?`,
            [senderId],
            (balanceErr, row) => {
              callback(null, {
                success: true,
                message_id: newMessageId,
                paid: !!finalPaid,
                cost: finalCost,
                receiver_profit: receiverProfit,
                admin_profit: adminProfit,
                mutual_like: !!mutualLike,
                remaining_points:
                  balanceErr ? null : Number(row?.points ?? 0)
              });
            }
          );
        }
      );
    };

    if (cost === 0) {
      return doInsert(0, 0, (err, result) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: err.message
          });
        }

        return res.json(result);
      });
    }

    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) {
        cleanupFile();
        console.error('MEDIA BEGIN ERROR:', beginErr.message);
        return res.status(500).json({
          success: false,
          message: 'تعذر بدء العملية المالية'
        });
      }

      const rollback = (status, message, logMessage) => {
        db.run('ROLLBACK', () => {
          cleanupFile();
          if (logMessage) console.error(logMessage);
          return res.status(status).json({
            success: false,
            message
          });
        });
      };

      db.run(
        `UPDATE users
         SET points = points - ?
         WHERE id=? AND points >= ?`,
        [cost, senderId, cost],
        function(deductErr) {
          if (deductErr) {
            return rollback(
              500,
              'خطأ أثناء خصم النقاط',
              'MEDIA DEDUCT ERROR: ' + deductErr.message
            );
          }

          if (this.changes !== 1) {
            return rollback(400, 'الرصيد غير كافي');
          }

          const addReceiverProfit = (done) => {
            if (receiverProfit <= 0) {
              return done(null);
            }

            db.run(
              `UPDATE users SET points = points + ? WHERE id=?`,
              [receiverProfit, receiverId],
              function(err) {
                if (err) return done(err);
                done(null);
              }
            );
          };

          addReceiverProfit((receiverErr) => {
            if (receiverErr) {
              return rollback(
                500,
                'تعذر إضافة أرباح الرسالة',
                'MEDIA RECEIVER ERROR: ' + receiverErr.message
              );
            }

            db.run(
              `INSERT INTO wallet_logs(user_id,type,points,description)
               VALUES(?,?,?,?)`,
              [
                senderId,
                'message',
                -cost,
                cost === 5 ? 'إرسال رسالة مدفوعة' : 'إرسال رسالة'
              ],
              (senderLogErr) => {
                if (senderLogErr) {
                  return rollback(
                    500,
                    'تعذر تسجيل خصم الرسالة',
                    'MEDIA SENDER LOG ERROR: ' + senderLogErr.message
                  );
                }

                const insertReceiverLog = (done) => {
                  if (receiverProfit <= 0) {
                    return done(null);
                  }

                  db.run(
                    `INSERT INTO wallet_logs(user_id,type,points,description)
                     VALUES(?,?,?,?)`,
                    [
                      receiverId,
                      'message',
                      receiverProfit,
                      'استلام أرباح رسالة'
                    ],
                    (receiverLogErr) => done(receiverLogErr || null)
                  );
                };

                insertReceiverLog((receiverLogErr) => {
                  if (receiverLogErr) {
                    return rollback(
                      500,
                      'تعذر تسجيل أرباح الرسالة',
                      'MEDIA RECEIVER LOG ERROR: ' + receiverLogErr.message
                    );
                  }

                  const insertAdminProfit = (done) => {
                    if (adminProfit <= 0) {
                      return done(null);
                    }

                    db.run(
                      `INSERT INTO admin_profits(source,points)
                       VALUES('message',?)`,
                      [adminProfit],
                      (adminProfitErr) => {
                        if (adminProfitErr) return done(adminProfitErr);

                        db.run(
                          `INSERT INTO wallet_logs(user_id,type,points,description)
                           VALUES(NULL,'admin_profit',?,?)`,
                          [
                            adminProfit,
                            'ربح الإدارة من رسالة'
                          ],
                          (adminLogErr) => done(adminLogErr || null)
                        );
                      }
                    );
                  };

                  insertAdminProfit((adminErr) => {
                    if (adminErr) {
                      return rollback(
                        500,
                        'تعذر تسجيل ربح الإدارة',
                        'MEDIA ADMIN ERROR: ' + adminErr.message
                      );
                    }

                    doInsert(cost, 1, (insertErr, result) => {
                      if (insertErr) {
                        return rollback(
                          500,
                          'تعذر حفظ الرسالة',
                          'MEDIA MESSAGE ERROR: ' + insertErr.message
                        );
                      }

                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                          return db.run('ROLLBACK', () => {
                            cleanupFile();
                            console.error(
                              'MEDIA COMMIT ERROR:',
                              commitErr.message
                            );
                            return res.status(500).json({
                              success: false,
                              message: 'تعذر إتمام العملية المالية'
                            });
                          });
                        }

                        return res.json(result);
                      });
                    });
                  });
                });
              }
            );
          });
        }
      );
    });
  };

  if (isOwner) {
    return finishInsert(0, 0, 0, false, false);
  }

  db.all(
    `SELECT id, gender FROM users WHERE id IN (?, ?)`,
    [senderId, receiverId],
    (usersErr, users) => {
      if (usersErr) {
        cleanupFile();
        return res.status(500).json({
          success: false,
          message: 'خطأ في قاعدة البيانات'
        });
      }

      const sender = users.find(u => Number(u.id) === senderId);
      const receiver = users.find(u => Number(u.id) === receiverId);

      if (!sender || !receiver) {
        cleanupFile();
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود'
        });
      }

      const senderGender = String(sender.gender || '');
      const receiverGender = String(receiver.gender || '');

      const senderFemale =
        senderGender === 'أنثى' || senderGender === 'بنت';

      const receiverFemale =
        receiverGender === 'أنثى' || receiverGender === 'بنت';

      const senderMale =
        senderGender === 'ذكر';

      const receiverMale =
        receiverGender === 'ذكر';

      db.get(
        `SELECT id
         FROM profile_likes
         WHERE liker_id=? AND liked_id=?`,
        [receiverId, senderId],
        (reverseLikeErr, reverseLike) => {
          if (reverseLikeErr) {
            cleanupFile();
            return res.status(500).json({
              success: false,
              message: 'تعذر التحقق من الإعجاب المتبادل'
            });
          }

          db.get(
            `SELECT id
             FROM profile_likes
             WHERE liker_id=? AND liked_id=?`,
            [senderId, receiverId],
            (myLikeErr, myLike) => {
              if (myLikeErr) {
                cleanupFile();
                return res.status(500).json({
                  success: false,
                  message: 'تعذر التحقق من الإعجاب المتبادل'
                });
              }

              const mutualLike = !!reverseLike && !!myLike;

              if (mutualLike) {
                return finishInsert(0, 0, 0, false, true);
              }

              /*
               * نفس قواعد الرسائل النصية:
               * ذكر -> أنثى : 5 نقاط
               * أنثى -> ذكر : مجاني
               * ذكر -> ذكر   : 1 نقطة
               * أنثى -> أنثى : 1 نقطة
               */
              let cost = 1;
              let receiverProfit = 0;
              let adminProfit = 1;

              if (senderMale && receiverFemale) {
                cost = 5;
                receiverProfit = 0;
                adminProfit = 4;
              } else if (senderFemale && receiverMale) {
                cost = 0;
                receiverProfit = 0;
                adminProfit = 0;
              } else if (
                (senderMale && receiverMale) ||
                (senderFemale && receiverFemale)
              ) {
                cost = 1;
                receiverProfit = 0;
                adminProfit = 1;
              }

              return finishInsert(
                cost,
                receiverProfit,
                adminProfit,
                cost > 0,
                false
              );
            }
          );
        }
      );
    }
  );
});


/* CHAT_GIFT_BLOCK_MIDDLEWARE */

function chatGiftBlockGuard(req,res,next){
  const me=Number(req.user.id);
  const other=Number(req.body.receiver_id);

  if(!Number.isInteger(other)||other<=0||other===me)return next();

  usersBlocked(me,other,(err,blocked)=>{
    if(err){
      console.error('GIFT BLOCK CHECK ERROR:',err);
      return res.status(500).json({
        success:false,
        message:'تعذر التحقق من الحظر'
      });
    }

    if(blocked){
      return res.status(403).json({
        success:false,
        blocked:true,
        message:'لا يمكنك إرسال هدية لهذا المستخدم لأنه محظور'
      });
    }

    next();
  });
}

app.post('/api/gifts', requireAuth, chatGiftBlockGuard, (req,res)=>{

  const senderId = Number(req.user.id);
  const receiverId = Number(req.body.receiver_id);
  const points = Number(req.body.points);

  if(!Number.isInteger(receiverId) || receiverId <= 0 || receiverId === senderId){
    return res.status(400).json({success:false,message:'المستقبل غير صالح'});
  }

  if(!Number.isInteger(points) || points <= 0){
    return res.status(400).json({success:false,message:'قيمة الهدية غير صالحة'});
  }

  db.get(`SELECT id FROM users WHERE id=?`, [receiverId], (err,receiver)=>{
    if(err){
      return res.status(500).json({success:false,message:'خطأ في قاعدة البيانات'});
    }

    if(!receiver){
      return res.status(404).json({success:false,message:'المستخدم غير موجود'});
    }

    // المالك لا يُخصم منه
    if(req.user.role === 'owner'){
      db.run(
        `INSERT INTO messages
         (sender_id,receiver_id,content,cost,is_paid,is_delivered,delivered_at)
         VALUES(?,?,?,0,0,0,NULL)`,
        [senderId,receiverId,`🎁 هدية بقيمة ${points} نقطة`],
        (messageErr)=>{
          if(messageErr){
            console.error('OWNER GIFT MESSAGE ERROR:',messageErr);
            return res.status(500).json({
              success:false,
              message:'تعذر حفظ الهدية في المحادثة'
            });
          }

          return res.json({
            success:true,
            paid:false,
            remaining_points:null,
            admin_share:0,
            receiver_share:0
          });
        }
      );
      return;
    }

    const adminShare = Math.floor(points * 0.8);
    const receiverShare = points - adminShare;

    db.run('BEGIN IMMEDIATE', (beginErr)=>{
      if(beginErr){
        console.error('GIFT BEGIN ERROR:', beginErr);
        return res.status(500).json({
          success:false,
          message:'تعذر بدء العملية المالية'
        });
      }

      const rollback = (status, message, logMessage)=>{
        db.run('ROLLBACK', ()=>{
          if(logMessage) console.error(logMessage);
          return res.status(status).json({success:false,message});
        });
      };

      db.run(
        `UPDATE users SET points = points - ?
         WHERE id=? AND points >= ?`,
        [points, senderId, points],
        function(deductErr){
          if(deductErr){
            return rollback(500,'خطأ أثناء خصم النقاط','GIFT DEDUCT ERROR: '+deductErr.message);
          }

          if(this.changes !== 1){
            return rollback(400,'الرصيد غير كافي');
          }

          db.run(
            `UPDATE users SET points = points + ? WHERE id=?`,
            [receiverShare, receiverId],
            function(receiverErr){
              if(receiverErr){
                return rollback(500,'تعذر إضافة أرباح الهدية','GIFT RECEIVER ERROR: '+receiverErr.message);
              }

              db.run(
                `INSERT INTO wallet_logs(user_id,type,points,description)
                 VALUES(?,?,?,?)`,
                [senderId,'gift',-points,'إرسال هدية'],
                (senderLogErr)=>{
                  if(senderLogErr){
                    return rollback(500,'تعذر تسجيل خصم الهدية','GIFT SENDER LOG ERROR: '+senderLogErr.message);
                  }

                  db.run(
                    `INSERT INTO wallet_logs(user_id,type,points,description)
                     VALUES(?,?,?,?)`,
                    [receiverId,'gift',receiverShare,'استلام أرباح هدية'],
                    (receiverLogErr)=>{
                      if(receiverLogErr){
                        return rollback(500,'تعذر تسجيل أرباح الهدية','GIFT RECEIVER LOG ERROR: '+receiverLogErr.message);
                      }

                      db.run(
                        `INSERT INTO admin_profits(source,points)
                         VALUES('gift',?)`,
                        [adminShare],
                        (adminProfitErr)=>{
                          if(adminProfitErr){
                            return rollback(500,'تعذر تسجيل ربح الإدارة','GIFT ADMIN PROFIT ERROR: '+adminProfitErr.message);
                          }

                          db.run(
                            `INSERT INTO wallet_logs(user_id,type,points,description)
                             VALUES(NULL,'admin_profit',?,'ربح الإدارة من هدية')`,
                            [adminShare],
                            (adminLogErr)=>{
                              if(adminLogErr){
                                return rollback(500,'تعذر تسجيل ربح الإدارة في السجل','GIFT ADMIN LOG ERROR: '+adminLogErr.message);
                              }

                              db.get(
                                `SELECT points FROM users WHERE id=?`,
                                [senderId],
                                (balanceErr,row)=>{
                                  if(balanceErr || !row){
                                    return rollback(500,'تعذر قراءة الرصيد الجديد','GIFT BALANCE ERROR: '+(balanceErr ? balanceErr.message : 'sender not found'));
                                  }

                                  db.run(
                                    `INSERT INTO messages
                                     (sender_id,receiver_id,content,cost,is_paid,is_delivered,delivered_at)
                                     VALUES(?,?,?,0,1,0,NULL)`,
                                    [senderId,receiverId,`🎁 هدية بقيمة ${points} نقطة`],
                                    (messageErr)=>{
                                      if(messageErr){
                                        return rollback(500,'تعذر حفظ الهدية في المحادثة','GIFT MESSAGE ERROR: '+messageErr.message);
                                      }

                                      db.run('COMMIT', (commitErr)=>{
                                        if(commitErr){
                                          return rollback(500,'تعذر إتمام العملية المالية','GIFT COMMIT ERROR: '+commitErr.message);
                                        }

                                        createNotification(
                                          receiverId,
                                          'هدية جديدة',
                                          'وصلتك هدية جديدة 🎁',
                                          'gift'
                                        );

                                        return res.json({
                                          success:true,
                                          paid:true,
                                          remaining_points:Number(row.points || 0),
                                          admin_share:adminShare,
                                          receiver_share:receiverShare
                                        });
                                      });
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});

/* HIDE_CHAT_API_READY */
app.post('/api/messages/conversations/hide/:user_id', requireAuth, (req,res)=>{
  const me=Number(req.user.id);
  const other=Number(req.params.user_id);

  if(!Number.isInteger(other)||other<=0||other===me){
    return res.status(400).json({success:false,message:'المستخدم غير صالح'});
  }

  db.run(
    'INSERT OR IGNORE INTO hidden_conversations(user_id,other_user_id) VALUES(?,?)',
    [me,other],
    function(err){
      if(err){
        console.error('HIDE CHAT ERROR:',err);
        return res.status(500).json({success:false,message:'تعذر حذف المحادثة'});
      }
      res.json({success:true,hidden:true});
    }
  );
});

app.get('/api/messages/conversations', requireAuth, (req, res) => {
  const myId = Number(req.user.id);

  db.all(
    `SELECT
       u.id,
       u.public_id,
       u.name,
       u.age,
       u.city,
       u.gender,
       u.is_verified,
       u.last_seen,
       u.avatar,
       (
         SELECT m.content
         FROM messages m
         WHERE
           (m.sender_id = ? AND m.receiver_id = u.id)
           OR
           (m.sender_id = u.id AND m.receiver_id = ?)
         ORDER BY m.id DESC
         LIMIT 1
       ) AS lastMsg,
       (
         SELECT m.created_at
         FROM messages m
         WHERE
           (m.sender_id = ? AND m.receiver_id = u.id)
           OR
           (m.sender_id = u.id AND m.receiver_id = ?)
         ORDER BY m.id DESC
         LIMIT 1
       ) AS lastTime,
       (
         SELECT COUNT(*)
         FROM messages m
         WHERE
           m.sender_id = u.id
           AND m.receiver_id = ?
           AND COALESCE(m.is_read, 0) = 0
       ) AS unread
     FROM users u
     WHERE u.id IN (
       SELECT DISTINCT
         CASE
           WHEN sender_id = ? THEN receiver_id
           ELSE sender_id
         END
       FROM messages
       WHERE sender_id = ? OR receiver_id = ?
     )
     AND u.id != ?
     AND u.is_banned = 0
     AND NOT EXISTS (
       SELECT 1
       FROM hidden_conversations h
       WHERE h.user_id = ? AND h.other_user_id = u.id
     )
     ORDER BY lastTime DESC`,
    [myId, myId, myId, myId, myId, myId, myId, myId, myId, myId],
    (err, rows) => {
      if (err) {
        console.error("REAL CONVERSATIONS ERROR:", err);
        return res.status(500).json({
          success:false,
          message:"تعذر تحميل المحادثات"
        });
      }

      const conversations = (rows || []).map(row => ({
        ...row,
        online: isUserOnline(row.last_seen)
      }));

      res.json({
        success:true,
        conversations
      });
    }
  );
});

// CHAT_PRESENCE_API_READY
function isUserOnline(lastSeen){if(!lastSeen)return false;const raw=String(lastSeen);const t=new Date(raw.includes("T")||raw.endsWith("Z")?raw:raw.replace(" ","T")+"Z").getTime();return Number.isFinite(t)&&(Date.now()-t)<=15000;}
app.post("/api/presence/heartbeat",requireAuth,(req,res)=>{updateLastSeen(req.user.id);db.run("UPDATE messages SET is_delivered=1,delivered_at=CURRENT_TIMESTAMP WHERE receiver_id=? AND COALESCE(is_delivered,0)=0",[req.user.id],()=>{});res.json({success:true});});
app.get("/api/presence/:user_id",requireAuth,(req,res)=>{const id=Number(req.params.user_id);if(!Number.isInteger(id)||id<=0)return res.status(400).json({success:false,message:"المستخدم غير صالح"});db.get("SELECT id,name,last_seen FROM users WHERE id=? AND is_banned=0",[id],(e,row)=>{if(e)return res.status(500).json({success:false,message:"تعذر قراءة الحالة"});if(!row)return res.status(404).json({success:false,message:"المستخدم غير موجود"});res.json({success:true,user_id:Number(row.id),name:row.name,last_seen:row.last_seen,online:isUserOnline(row.last_seen)});});});
app.get('/api/messages/:user_id', requireAuth, (req, res) => {
  const myId = Number(req.user.id);
  const otherId = Number(req.params.user_id);

  db.all(
    `SELECT
       id,
       sender_id,
       receiver_id,
       content,
       cost,
       is_paid,
       message_type,
       media_url,
       is_delivered,
       is_read,
       delivered_at,
       read_at,
       created_at
     FROM messages
     WHERE (sender_id=? AND receiver_id=?)
        OR (sender_id=? AND receiver_id=?)
     ORDER BY created_at ASC`,
    [myId, otherId, otherId, myId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({
          success:false,
          message:err.message
        });
      }

      res.json({
        success:true,
        messages:rows
      });
    }
  );
});

// تعليم رسائل محادثة معيّنة كمقروءة
// تعليم رسائل محادثة معيّنة كمُسلّمة
app.post('/api/messages/:user_id/delivered', requireAuth, (req, res) => {
  const myId = Number(req.user.id);
  const otherId = Number(req.params.user_id);

  if (!Number.isInteger(otherId) || otherId <= 0) {
    return res.status(400).json({
      success:false,
      message:'المستخدم غير صالح'
    });
  }

  db.run(
    `UPDATE messages
     SET is_delivered=1,
         delivered_at=CURRENT_TIMESTAMP
     WHERE sender_id=?
       AND receiver_id=?
       AND COALESCE(is_delivered,0)=0`,
    [otherId, myId],
    function(err) {
      if (err) {
        console.error('MARK DELIVERED ERROR:', err);
        return res.status(500).json({
          success:false,
          message:'تعذر تحديث الرسائل'
        });
      }

      res.json({
        success:true,
        marked_delivered:this.changes
      });
    }
  );
});

app.post('/api/messages/:user_id/read', requireAuth, (req, res) => {
  const myId = Number(req.user.id);
  const otherId = Number(req.params.user_id);

  if (!Number.isInteger(otherId) || otherId <= 0) {
    return res.status(400).json({
      success:false,
      message:'المستخدم غير صالح'
    });
  }

  db.run(
    `UPDATE messages
     SET is_read=1,
         read_at=CURRENT_TIMESTAMP
     WHERE sender_id=?
       AND receiver_id=?
       AND is_read=0`,
    [otherId, myId],
    function(err) {
      if (err) {
        return res.status(500).json({
          success:false,
          message:'تعذر تحديث الرسائل'
        });
      }

      res.json({
        success:true,
        marked_read:this.changes
      });
    }
  );
});

// عدد الرسائل غير المقروءة الحقيقي
app.get('/api/messages/unread/count', requireAuth, (req, res) => {
  const myId = Number(req.user.id);

  db.get(
    `SELECT COUNT(*) AS count
     FROM messages
     WHERE receiver_id=?
       AND is_read=0`,
    [myId],
    (err, row) => {
      if (err) {
        return res.status(500).json({
          success:false,
          message:'تعذر قراءة عدد الرسائل غير المقروءة'
        });
      }

      res.json({
        success:true,
        count:Number(row && row.count || 0)
      });
    }
  );
});

// 💰 جلب محفظة المستخدم
app.get('/api/wallet', requireAuth, (req,res)=>{
  const userId = Number(req.user.id);

  db.get(
    `SELECT id,name,points FROM users WHERE id=?`,
    [userId],
    (err,user)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:err.message
        });
      }

      if(!user){
        return res.status(404).json({
          success:false,
          message:'المستخدم غير موجود'
        });
      }

      db.all(
        `SELECT
           id,
           type,
           points,
           description,
           created_at,
           NULL AS request_status
         FROM wallet_logs
         WHERE user_id=?

         UNION ALL

         SELECT
           -id AS id,
           'charge_request' AS type,
           points,
           'طلب شحن قيد مراجعة الإدارة' AS description,
           created_at,
           status AS request_status
         FROM charge_requests
         WHERE user_id=? AND status='pending'

         ORDER BY created_at DESC
         LIMIT 50`,
        [userId,userId],
        (logsErr,logs)=>{

          if(logsErr){
            return res.status(500).json({
              success:false,
              message:logsErr.message
            });
          }

          db.get(
            `SELECT
               COALESCE(SUM(
                 CASE
                   WHEN type IN ('call','gift','message') AND points < 0
                   THEN ABS(points)
                   ELSE 0
                 END
               ),0) AS wealth,

               COALESCE(SUM(
                 CASE
                   WHEN type='call_income' AND points > 0
                   THEN points
                   WHEN type='gift'
                    AND points > 0
                    AND description='استلام أرباح هدية'
                   THEN points
                   ELSE 0
                 END
               ),0) AS attraction

             FROM wallet_logs
             WHERE user_id=?`,
            [userId],
            (statsErr,stats)=>{

              if(statsErr){
                return res.status(500).json({
                  success:false,
                  message:statsErr.message
                });
              }

              const wealth = Number(stats?.wealth) || 0;
              const attraction = Number(stats?.attraction) || 0;

              res.json({
                success:true,
                wallet:{
                  points:user.points,
                  logs:logs || [],
                  wealth,
                  wealthLevel:Math.floor(wealth / 1000),
                  attraction,
                  attractionLevel:Math.floor(attraction / 1000)
                }
              });

            }
          );

        }
      );

    }
  );
});

// 💳 طلب شحن نقاط للشب

// 💳 طلب شحن نقاط — شحن حقيقي مع إيصال
app.post('/api/wallet/charge', requireAuth, (req,res)=>{
  const userId = Number(req.user.id);

  const points = Number(req.body?.points);
  const amount_syr = Number(req.body?.amount_syr);
  const method = String(req.body?.method || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const receipt = String(req.body?.receipt || '').trim();

  const allowedPackages = {
    500: 50000,
    1200: 100000,
    3000: 250000
  };

  if(!Number.isInteger(userId) || userId <= 0){
    return res.status(401).json({
      success:false,
      message:'المستخدم غير صالح'
    });
  }

  if(!Object.prototype.hasOwnProperty.call(allowedPackages, points)){
    return res.status(400).json({
      success:false,
      message:'باقة الشحن غير متاحة'
    });
  }

  if(amount_syr !== allowedPackages[points]){
    return res.status(400).json({
      success:false,
      message:'قيمة الشحن غير مطابقة للباقة'
    });
  }

  if(!['sham','syriatel'].includes(method)){
    return res.status(400).json({
      success:false,
      message:'طريقة الدفع غير متاحة'
    });
  }

  if(!phone || phone.length < 5 || phone.length > 40){
    return res.status(400).json({
      success:false,
      message:'رقم الهاتف غير صالح'
    });
  }

  if(!receipt){
    return res.status(400).json({
      success:false,
      message:'إيصال الدفع مطلوب'
    });
  }

  // receipt بصيغة Data URL:
  // data:image/jpeg;base64,...
  const match = receipt.match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/
  );

  if(!match){
    return res.status(400).json({
      success:false,
      message:'صيغة صورة الإيصال غير صالحة'
    });
  }

  const mime = match[1] === 'image/jpg'
    ? 'image/jpeg'
    : match[1];

  const base64 = match[2].replace(/\s/g,'');

  let buffer;

  try{
    buffer = Buffer.from(base64,'base64');
  }catch(err){
    return res.status(400).json({
      success:false,
      message:'تعذر قراءة صورة الإيصال'
    });
  }

  // حد أقصى 8MB للصورة
  if(!buffer.length || buffer.length > 8 * 1024 * 1024){
    return res.status(400).json({
      success:false,
      message:'حجم صورة الإيصال يجب ألا يتجاوز 8MB'
    });
  }

  // فحص ترويسة الملف حتى لا نعتمد على MIME المرسل فقط
  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xFF &&
    buffer[1] === 0xD8 &&
    buffer[2] === 0xFF;

  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A;

  const isWebp =
    buffer.length >= 12 &&
    buffer.toString('ascii',0,4) === 'RIFF' &&
    buffer.toString('ascii',8,12) === 'WEBP';

  if(
    (mime === 'image/jpeg' && !isJpeg) ||
    (mime === 'image/png' && !isPng) ||
    (mime === 'image/webp' && !isWebp)
  ){
    return res.status(400).json({
      success:false,
      message:'ملف الإيصال ليس صورة صالحة'
    });
  }

  const ext =
    mime === 'image/png'
      ? 'png'
      : mime === 'image/webp'
      ? 'webp'
      : 'jpg';

  const receiptDir = require('path').join(
    __dirname,
    'uploads',
    'receipts'
  );

  try{
    fs.mkdirSync(receiptDir,{recursive:true});
  }catch(err){
    console.error('RECEIPT DIR ERROR:',err);
    return res.status(500).json({
      success:false,
      message:'تعذر تجهيز تخزين الإيصال'
    });
  }

  const fileName =
    `${userId}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

  const filePath = require('path').join(receiptDir,fileName);

  try{
    fs.writeFileSync(filePath,buffer);
  }catch(err){
    console.error('RECEIPT SAVE ERROR:',err);
    return res.status(500).json({
      success:false,
      message:'تعذر حفظ صورة الإيصال'
    });
  }

  // المسار الذي سنخزنه في DB فقط
  const receiptPath = `/uploads/receipts/${fileName}`;

  db.run(
    `INSERT INTO charge_requests
     (user_id,points,amount_syr,method,phone,receipt,status)
     VALUES (?,?,?,?,?,?, 'pending')`,
    [
      userId,
      points,
      amount_syr,
      method,
      phone,
      receiptPath
    ],
    function(err){
      if(err){
        console.error('CHARGE REQUEST INSERT ERROR:',err);

        try{
          fs.unlinkSync(filePath);
        }catch(cleanErr){
          console.error('RECEIPT CLEANUP ERROR:',cleanErr);
        }

        return res.status(500).json({
          success:false,
          message:'تعذر إنشاء طلب الشحن'
        });
      }

      // إشعار الإدارة
      const chargeRequestId = this.lastID;

      getOwnerId((ownerErr, ownerId) => {
          if (ownerErr || !ownerId) {
            if (ownerErr) console.error('OWNER ID LOOKUP ERROR:', ownerErr);
            return;
          }

          createNotification(
            ownerId,
            'طلب شحن جديد 💳',
            `لديك طلب شحن جديد بقيمة ${points} نقطة للمراجعة`,
            'charge'
          );
        });

      // 🔔 Telegram — إشعار مفصل للإدارة
      db.get(
        `SELECT name, email FROM users WHERE id=? LIMIT 1`,
        [userId],
        (userErr, user) => {
          if (userErr) {
            console.error('TELEGRAM CHARGE USER ERROR:', userErr);
            return;
          }

          const methodName =
            method === 'sham' ? 'شام كاش' :
            method === 'syriatel' ? 'سيرياتيل كاش' :
            method;

          const requestId = chargeRequestId;

          const telegramText = [
            '💳 طلب شحن جديد',
            '',
            `👤 المستخدم: ${user?.name || 'غير معروف'}`,
            `🆔 رقم المستخدم: ${userId}`,
            `📧 البريد: ${user?.email || 'غير معروف'}`,
            '',
            `💰 النقاط: ${points}`,
            `💵 المبلغ: ${amount_syr.toLocaleString('en-US')} ل.س`,
            `💳 طريقة الدفع: ${methodName}`,
            `📱 رقم الدفع: ${phone}`,
            '',
            '🧾 الإيصال: موجود',
            `🆔 رقم الطلب: ${requestId}`,
            '📌 الحالة: بانتظار المراجعة',
            '',
            '⚠️ يحتاج الطلب إلى مراجعة الإدارة.'
          ].join('\n');

          sendTelegramAdmin(telegramText).catch(err => {
            console.error('TELEGRAM CHARGE ERROR:', err.message);
          });
        }
      );

      res.json({
        success:true,
        request_id:this.lastID,
        status:'pending',
        message:'تم إرسال طلب الشحن والإيصال للمراجعة'
      });
    }
  );
});

// 👑 الإدارة: عرض طلبات الشحن المعلقة
app.get('/api/admin/charges', requireAuth, requireAdmin, (req,res)=>{

  db.all(
    `SELECT 
      charge_requests.*,
      users.name,
      users.email
     FROM charge_requests
     JOIN users ON users.id = charge_requests.user_id
     ORDER BY charge_requests.id DESC`,
    [],
    (err,rows)=>{

      if(err){
        return res.status(500).json({
          success:false,
          message:err.message
        });
      }

      res.json({
        success:true,
        requests:rows
      });

    }
  );

});




// 👑 الإدارة: رفض طلب شحن
app.get('/api/admin/charges/:id/receipt', requireAuth, requireAdmin, (req,res)=>{
  const id = Number(req.params.id);

  if(!Number.isInteger(id) || id <= 0){
    return res.status(400).json({
      success:false,
      message:'رقم طلب الشحن غير صالح'
    });
  }

  db.get(
    `SELECT receipt FROM charge_requests WHERE id=? LIMIT 1`,
    [id],
    (err,row)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:'تعذر قراءة بيانات الإيصال'
        });
      }

      if(!row || !row.receipt){
        return res.status(404).json({
          success:false,
          message:'الإيصال غير موجود'
        });
      }

      const prefix = '/uploads/receipts/';
      const receiptPath = String(row.receipt);

      if(!receiptPath.startsWith(prefix)){
        return res.status(400).json({
          success:false,
          message:'مسار الإيصال غير صالح'
        });
      }

      const fileName = receiptPath.slice(prefix.length);

      if(
        !fileName ||
        fileName.includes('/') ||
        fileName.includes('\\') ||
        fileName.includes('..')
      ){
        return res.status(400).json({
          success:false,
          message:'اسم ملف الإيصال غير صالح'
        });
      }

      const filePath = require('path').join(
        __dirname,
        'uploads',
        'receipts',
        fileName
      );

      if(!require('fs').existsSync(filePath)){
        return res.status(404).json({
          success:false,
          message:'ملف الإيصال غير موجود'
        });
      }

      return res.sendFile(filePath);
    }
  );
});

app.post('/api/admin/charge/reject/:id', requireAuth, requireAdmin, (req,res)=>{
  const id = Number(req.params.id);

  if(!Number.isInteger(id) || id <= 0){
    return res.status(400).json({
      success:false,
      message:'رقم طلب الشحن غير صالح'
    });
  }

  db.run('BEGIN IMMEDIATE', (beginErr)=>{
    if(beginErr){
      console.error('CHARGE REJECT BEGIN ERROR:',beginErr);
      return res.status(500).json({
        success:false,
        message:'تعذر بدء عملية رفض الشحن'
      });
    }

    db.get(
      `SELECT * FROM charge_requests
       WHERE id=? AND status='pending'`,
      [id],
      (err,charge)=>{
        if(err || !charge){
          return db.run('ROLLBACK',()=>{
            res.status(400).json({
              success:false,
              message:'طلب الشحن غير موجود أو تمت معالجته مسبقاً'
            });
          });
        }

        db.run(
          `UPDATE charge_requests
           SET status='rejected'
           WHERE id=? AND status='pending'`,
          [id],
          function(statusErr){
            if(statusErr || this.changes !== 1){
              return db.run('ROLLBACK',()=>{
                console.error('CHARGE REJECT STATUS ERROR:',statusErr);
                res.status(500).json({
                  success:false,
                  message:'تعذر تثبيت رفض طلب الشحن'
                });
              });
            }

            db.run('COMMIT',(commitErr)=>{
              if(commitErr){
                return db.run('ROLLBACK',()=>{
                  console.error('CHARGE REJECT COMMIT ERROR:',commitErr);
                  res.status(500).json({
                    success:false,
                    message:'تعذر تثبيت عملية رفض الشحن'
                  });
                });
              }

              createNotification(
                charge.user_id,
                'تم رفض الشحن',
                `تم رفض طلب شحن ${Number(charge.points || 0).toLocaleString('ar-SY')} نقطة ❌`,
                'charge'
              );

              res.json({
                success:true,
                message:'تم رفض طلب الشحن'
              });
            });
          }
        );
      }
    );
  });
});

// 👑 الإدارة: قبول طلب شحن
app.post('/api/admin/charge/approve/:id', requireAuth, requireAdmin, (req,res)=>{
  const id = Number(req.params.id);

  if(!Number.isInteger(id) || id <= 0){
    return res.status(400).json({
      success:false,
      message:'رقم طلب الشحن غير صالح'
    });
  }

  db.run('BEGIN IMMEDIATE', (beginErr)=>{
    if(beginErr){
      console.error('CHARGE APPROVE BEGIN ERROR:',beginErr);
      return res.status(500).json({
        success:false,
        message:'تعذر بدء عملية قبول الشحن'
      });
    }

    db.get(
      `SELECT * FROM charge_requests
       WHERE id=? AND status='pending'`,
      [id],
      (err,charge)=>{
        if(err || !charge){
          return db.run('ROLLBACK',()=>{
            res.status(400).json({
              success:false,
              message:'طلب الشحن غير موجود أو تمت معالجته مسبقاً'
            });
          });
        }

        db.run(
          `UPDATE users
           SET points = points + ?
           WHERE id=?`,
          [Number(charge.points),charge.user_id],
          function(userErr){
            if(userErr || this.changes !== 1){
              return db.run('ROLLBACK',()=>{
                console.error('CHARGE APPROVE USER ERROR:',userErr);
                res.status(500).json({
                  success:false,
                  message:'تعذر إضافة النقاط للمستخدم'
                });
              });
            }

            db.run(
              `UPDATE charge_requests
               SET status='approved'
               WHERE id=? AND status='pending'`,
              [id],
              function(statusErr){
                if(statusErr || this.changes !== 1){
                  return db.run('ROLLBACK',()=>{
                    res.status(500).json({
                      success:false,
                      message:'تعذر تثبيت قبول طلب الشحن'
                    });
                  });
                }

                db.run(
                  `INSERT INTO wallet_logs
                   (user_id,type,points,description)
                   VALUES(?,?,?,?)`,
                  [
                    charge.user_id,
                    'charge',
                    Number(charge.points),
                    'تم قبول طلب شحن'
                  ],
                  function(logErr){
                    if(logErr){
                      return db.run('ROLLBACK',()=>{
                        console.error('CHARGE APPROVE LOG ERROR:',logErr);
                        res.status(500).json({
                          success:false,
                          message:'تعذر تسجيل عملية الشحن'
                        });
                      });
                    }

                    db.run('COMMIT',(commitErr)=>{
                      if(commitErr){
                        return db.run('ROLLBACK',()=>{
                          console.error('CHARGE APPROVE COMMIT ERROR:',commitErr);
                          res.status(500).json({
                            success:false,
                            message:'تعذر تثبيت عملية الشحن'
                          });
                        });
                      }

                      createNotification(
                        charge.user_id,
                        'تم قبول الشحن',
                        `تمت إضافة ${Number(charge.points || 0).toLocaleString('ar-SY')} نقطة إلى رصيدك ⭐`,
                        'charge'
                      );

                      res.json({
                        success:true,
                        message:'تم قبول الشحن وإضافة النقاط'
                      });
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

// 💰 طلب سحب أرباح — نظام حجز النقاط
app.post('/api/wallet/withdraw', requireAuth, (req,res)=>{
  const userId = Number(req.user.id);
  const points = Number(req.body?.points);
  const method = String(req.body?.method || '').trim();
  const wallet_num = String(req.body?.wallet_num || '').trim();
  const notes = String(req.body?.notes || '').trim();

  const allowedWithdraws = [5000,15000,30000,50000];

  if(!allowedWithdraws.includes(points)){
    return res.status(400).json({
      success:false,
      message:'قيمة السحب غير متاحة'
    });
  }

  if(!method || !wallet_num){
    return res.status(400).json({
      success:false,
      message:'بيانات السحب ناقصة'
    });
  }

  if(!Number.isInteger(userId) || userId <= 0){
    return res.status(401).json({
      success:false,
      message:'المستخدم غير صالح'
    });
  }

  db.run('BEGIN IMMEDIATE', (beginErr)=>{
    if(beginErr){
      console.error('WITHDRAW BEGIN ERROR:', beginErr);
      return res.status(500).json({
        success:false,
        message:'تعذر بدء عملية السحب'
      });
    }

    db.get(
      `SELECT id,points,is_verified
       FROM users
       WHERE id=?`,
      [userId],
      (err,user)=>{
        if(err || !user){
          return db.run('ROLLBACK', ()=>{
            res.status(400).json({
              success:false,
              message:'المستخدم غير موجود'
            });
          });
        }

        if(!user.is_verified){
          return db.run('ROLLBACK', ()=>{
            res.status(400).json({
              success:false,
              message:'يجب توثيق الحساب بصورة سيلفي قبل طلب السحب'
            });
          });
        }

        // النقاط المتاحة = الرصيد الحالي - النقاط المحجوزة في الطلبات المعلقة
        db.get(
          `SELECT COALESCE(SUM(points),0) AS pending_points
           FROM withdraw_requests
           WHERE user_id=? AND status='pending'`,
          [userId],
          (pendingErr,pendingRow)=>{
            if(pendingErr){
              return db.run('ROLLBACK', ()=>{
                res.status(500).json({
                  success:false,
                  message:'تعذر التحقق من طلبات السحب المعلقة'
                });
              });
            }

            const pendingPoints = Number(pendingRow?.pending_points || 0);
            // النقاط المحجوزة مخصومة فعلياً من users.points،
            // لذلك الرصيد الحالي هو الرصيد المتاح مباشرة.
            const availablePoints = Number(user.points || 0);

            if(availablePoints < points){
              return db.run('ROLLBACK', ()=>{
                res.status(400).json({
                  success:false,
                  message:'الرصيد المتاح للسحب غير كافي'
                });
              });
            }

            // حجز النقاط فوراً
            db.run(
              `UPDATE users
               SET points = points - ?
               WHERE id=? AND points >= ?`,
              [points,userId,points],
              function(updateErr){
                if(updateErr || this.changes === 0){
                  return db.run('ROLLBACK', ()=>{
                    res.status(400).json({
                      success:false,
                      message:'الرصيد غير كافي'
                    });
                  });
                }

                db.run(
                  `INSERT INTO withdraw_requests
                   (user_id,points,method,wallet_num,notes,status)
                   VALUES(?,?,?,?,?,'pending')`,
                  [userId,points,method,wallet_num,notes],
                  function(insertErr){
                    if(insertErr){
                      return db.run('ROLLBACK', ()=>{
                        console.error('WITHDRAW INSERT ERROR:', insertErr);
                        res.status(500).json({
                          success:false,
                          message:'تعذر إنشاء طلب السحب'
                        });
                      });
                    }

                    const requestId = this.lastID;

                    db.run(
                      'COMMIT',
                      (commitErr)=>{
                        if(commitErr){
                          return db.run('ROLLBACK', ()=>{
                            console.error('WITHDRAW COMMIT ERROR:', commitErr);
                            res.status(500).json({
                              success:false,
                              message:'تعذر تثبيت طلب السحب'
                            });
                          });
                        }

                        getOwnerId((ownerErr, ownerId) => {
                            if (ownerErr || !ownerId) {
                              if (ownerErr) console.error('OWNER ID LOOKUP ERROR:', ownerErr);
                              return;
                            }

                            createNotification(
                              ownerId,
                              'طلب سحب جديد',
                              `لديك طلب سحب جديد بقيمة ${points} نقطة للمراجعة 💸`,
                              'withdraw'
                            );
                          });

                        res.json({
                          success:true,
                          request_id:requestId,
                          reserved_points:points,
                          available_points:Number(user.points || 0) - points,
                          message:'تم إرسال طلب السحب وحجز النقاط للمراجعة'
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

// 👑 الإدارة: قبول طلب سحب — النقاط محجوزة مسبقاً
app.post('/api/admin/withdraw/approve/:id', requireAuth, requireAdmin, (req,res)=>{
  const id = Number(req.params.id);

  if(!Number.isInteger(id) || id <= 0){
    return res.status(400).json({
      success:false,
      message:'رقم طلب السحب غير صالح'
    });
  }

  db.run('BEGIN IMMEDIATE', (beginErr)=>{
    if(beginErr){
      console.error('WITHDRAW APPROVE BEGIN ERROR:', beginErr);
      return res.status(500).json({
        success:false,
        message:'تعذر بدء عملية الموافقة'
      });
    }

    db.get(
      `SELECT *
       FROM withdraw_requests
       WHERE id=? AND status='pending'`,
      [id],
      (err,row)=>{
        if(err || !row){
          return db.run('ROLLBACK', ()=>{
            res.status(400).json({
              success:false,
              message:'طلب السحب غير موجود أو تمت معالجته مسبقاً'
            });
          });
        }

        db.run(
          `UPDATE withdraw_requests
           SET status='approved'
           WHERE id=? AND status='pending'`,
          [id],
          function(updateErr){
            if(updateErr || this.changes !== 1){
              return db.run('ROLLBACK', ()=>{
                res.status(500).json({
                  success:false,
                  message:'تعذر قبول طلب السحب'
                });
              });
            }

            db.run(
              `INSERT INTO wallet_logs
               (user_id,type,points,description)
               VALUES(?,?,?,?)`,
              [
                row.user_id,
                'withdraw',
                -Number(row.points),
                'تم قبول طلب السحب'
              ],
              function(logErr){
                if(logErr){
                  return db.run('ROLLBACK', ()=>{
                    console.error('WITHDRAW APPROVE LOG ERROR:', logErr);
                    res.status(500).json({
                      success:false,
                      message:'تعذر تسجيل عملية السحب'
                    });
                  });
                }

                db.run('COMMIT', (commitErr)=>{
                  if(commitErr){
                    return db.run('ROLLBACK', ()=>{
                      res.status(500).json({
                        success:false,
                        message:'تعذر تثبيت عملية السحب'
                      });
                    });
                  }

                  createNotification(
                    row.user_id,
                    'تم قبول السحب',
                    'تم قبول طلب السحب الخاص بك 📥',
                    'withdraw'
                  );

                  res.json({
                    success:true,
                    message:'تم قبول السحب وتثبيت النقاط المحجوزة'
                  });
                });
              }
            );
          }
        );
      }
    );
  });
});

// 👑 الإدارة: رفض طلب سحب — فك الحجز وإرجاع النقاط
app.post('/api/admin/withdraw/reject/:id', requireAuth, requireAdmin, (req,res)=>{
  const id = Number(req.params.id);

  if(!Number.isInteger(id) || id <= 0){
    return res.status(400).json({
      success:false,
      message:'رقم طلب السحب غير صالح'
    });
  }

  db.run('BEGIN IMMEDIATE', (beginErr)=>{
    if(beginErr){
      console.error('WITHDRAW REJECT BEGIN ERROR:', beginErr);
      return res.status(500).json({
        success:false,
        message:'تعذر بدء عملية الرفض'
      });
    }

    db.get(
      `SELECT *
       FROM withdraw_requests
       WHERE id=? AND status='pending'`,
      [id],
      (err,row)=>{
        if(err || !row){
          return db.run('ROLLBACK', ()=>{
            res.status(400).json({
              success:false,
              message:'طلب السحب غير موجود أو تمت معالجته مسبقاً'
            });
          });
        }

        db.run(
          `UPDATE users
           SET points = points + ?
           WHERE id=?`,
          [Number(row.points),row.user_id],
          function(refundErr){
            if(refundErr || this.changes !== 1){
              return db.run('ROLLBACK', ()=>{
                res.status(500).json({
                  success:false,
                  message:'تعذر فك حجز النقاط'
                });
              });
            }

            db.run(
              `UPDATE withdraw_requests
               SET status='rejected'
               WHERE id=? AND status='pending'`,
              [id],
              function(statusErr){
                if(statusErr || this.changes !== 1){
                  return db.run('ROLLBACK', ()=>{
                    res.status(500).json({
                      success:false,
                      message:'تعذر رفض طلب السحب'
                    });
                  });
                }

                db.run(
                  `INSERT INTO wallet_logs
                   (user_id,type,points,description)
                   VALUES(?,?,?,?)`,
                  [
                    row.user_id,
                    'withdraw_refund',
                    Number(row.points),
                    'تم رفض طلب السحب وفك حجز النقاط'
                  ],
                  function(logErr){
                    if(logErr){
                      return db.run('ROLLBACK', ()=>{
                        console.error('WITHDRAW REJECT LOG ERROR:', logErr);
                        res.status(500).json({
                          success:false,
                          message:'تعذر تسجيل إرجاع النقاط'
                        });
                      });
                    }

                    db.run('COMMIT', (commitErr)=>{
                      if(commitErr){
                        return db.run('ROLLBACK', ()=>{
                          res.status(500).json({
                            success:false,
                            message:'تعذر تثبيت رفض السحب'
                          });
                        });
                      }

                      createNotification(
                        row.user_id,
                        'تم رفض السحب',
                        'تم رفض طلب السحب وإرجاع النقاط المحجوزة إلى رصيدك ❌',
                        'withdraw'
                      );

                      res.json({
                        success:true,
                        refunded_points:Number(row.points),
                        message:'تم رفض السحب وفك حجز النقاط وإرجاعها'
                      });
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

function requireAdmin(req,res,next){
  if(!req.user || !['owner','admin'].includes(req.user.role)){
    return res.status(403).json({
      success:false,
      message:'صلاحيات الإدارة مطلوبة'
    });
  }
  next();
}

function requireOwner(req, res, next) {
  if(!req.user || req.user.role !== 'owner'){
    return res.status(403).json({
      success:false,
      message:'صلاحيات المالك مطلوبة'
    });
  }
  next();
}




app.get('/api/admin/users', requireAuth, requireAdmin, (req,res)=>{
  db.all(
    `SELECT id,name,email,age,city,gender,role,points,is_verified,is_banned,created_at
     FROM users
     ORDER BY id DESC`,
    [],
    (err,rows)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      res.json({
        success:true,
        users:rows
      });
    }
  );
});


app.get('/api/admin/users/:id', requireAuth, requireAdmin, (req,res)=>{
  const userId = Number(req.params.id);

  if(!Number.isInteger(userId) || userId <= 0){
    return res.status(400).json({
      success:false,
      message:'ID المستخدم غير صالح'
    });
  }

  db.get(
    `SELECT id,name,points FROM users WHERE id=?`,
    [userId],
    (err,user)=>{
      if(err){
        console.error('ADMIN USER LOOKUP ERROR:',err);
        return res.status(500).json({
          success:false,
          message:'تعذر جلب بيانات المستخدم'
        });
      }

      if(!user){
        return res.status(404).json({
          success:false,
          message:'المستخدم غير موجود'
        });
      }

      res.json({
        success:true,
        user:{
          id:user.id,
          name:user.name,
          points:Number(user.points || 0)
        }
      });
    }
  );
});

app.post('/api/admin/users/ban/:id', requireAuth, requireAdmin, (req,res)=>{
  const id=req.params.id;

  db.run(
    `UPDATE users SET is_banned=1 WHERE id=? AND role!='owner'`,
    [id],
    function(err){
      if(err){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      res.json({
        success:true,
        message:'تم حظر المستخدم'
      });
    }
  );
});


app.post('/api/admin/users/unban/:id', requireAuth, requireAdmin, (req,res)=>{
  const id=req.params.id;

  db.run(
    `UPDATE users SET is_banned=0 WHERE id=? AND role!='owner'`,
    [id],
    function(err){
      if(err){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      res.json({
        success:true,
        message:'تم فك حظر المستخدم'
      });
    }
  );
});





app.get('/api/verification/status', requireAuth, (req,res)=>{
  db.get(
    `SELECT status FROM verification_requests 
     WHERE user_id=? 
     ORDER BY id DESC LIMIT 1`,
    [req.user.id],
    (err,row)=>{
      if(err){
        return res.status(500).json({success:false,message:'database error'});
      }

      if(!row){
        return res.json({success:true,status:'none'});
      }

      res.json({success:true,status:row.status});
    }
  );
});




app.post('/api/verification/request',
  surianaRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    name: 'verification_upload'
  }),
  requireAuth,
  (req,res)=>{
  const userId = req.user.id;
  const { video } = req.body;

  if(!video){
    return res.status(400).json({
      success:false,
      message:'فيديو التوثيق مطلوب'
    });
  }

  const maxVerificationVideoBytes = 50 * 1024 * 1024;
  const base64Marker = ';base64,';
  const base64Index = typeof video === 'string' ? video.indexOf(base64Marker) : -1;
  if(base64Index !== -1){
    const base64Data = video.slice(base64Index + base64Marker.length);
    const decodedBytes = Math.floor((base64Data.length * 3) / 4);
    if(decodedBytes > maxVerificationVideoBytes){
      return res.status(413).json({
        success:false,
        message:'حجم فيديو التوثيق يجب ألا يتجاوز 50MB'
      });
    }
  }

  db.get(
    `SELECT * FROM verification_requests 
     WHERE user_id=? AND status='pending'`,
    [userId],
    (err,row)=>{
      if(row){
        return res.json({
          success:false,
          message:'لديك طلب توثيق قيد المراجعة'
        });
      }

      db.run(
        `INSERT INTO verification_requests
        (user_id,video,status)
        VALUES(?,?, 'pending')`,
        [userId,video],
        function(err){
          if(err){
            return res.status(500).json({
              success:false,
              message:'خطأ في قاعدة البيانات'
            });
          }

          
          getOwnerId((ownerErr, ownerId) => {
              if (ownerErr || !ownerId) {
                if (ownerErr) console.error('OWNER ID LOOKUP ERROR:', ownerErr);
                return;
              }

              createNotification(
                ownerId,
                'طلب توثيق جديد',
                'لديك طلب توثيق جديد للمراجعة 🪪',
                'verification'
              );
            });

res.json({
            success:true,
            request_id:this.lastID,
            message:'تم إرسال طلب التوثيق للمراجعة'
          });
        }
      );
    }
  );
});





app.post('/api/admin/verification/delete/:id', requireAuth, requireAdmin, (req,res)=>{
  const id=req.params.id;

  db.run(
    `DELETE FROM verification_requests WHERE id=?`,
    [id],
    function(err){
      if(err){
        return res.status(500).json({success:false,message:err.message});
      }

      res.json({
        success:true,
        deleted:this.changes
      });
    }
  );
});

app.get('/api/admin/verification', requireAuth, requireAdmin, (req,res)=>{

  db.all(
    `
    SELECT 
      verification_requests.id,
      verification_requests.user_id,
      verification_requests.video,
      verification_requests.status,
      verification_requests.created_at,
      users.name,
      users.email
    FROM verification_requests
    JOIN users ON users.id = verification_requests.user_id
    ORDER BY verification_requests.id DESC
    `,
    [],
    (err,rows)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      res.json({
        success:true,
        requests:rows
      });
    }
  );

});




app.post('/api/admin/verification/approve/:id', requireAuth, requireAdmin, (req,res)=>{
  const id=req.params.id;

  db.get(
    `SELECT * FROM verification_requests WHERE id=?`,
    [id],
    (err,row)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      if(!row){
        return res.status(404).json({
          success:false,
          message:'طلب التوثيق غير موجود'
        });
      }

      db.run('BEGIN IMMEDIATE', (beginErr)=>{
        if(beginErr){
          return res.status(500).json({
            success:false,
            message:'تعذر بدء العملية'
          });
        }

        db.run(
          `UPDATE verification_requests
           SET status='approved'
           WHERE id=? AND status='pending'`,
          [id],
          function(updateErr){
            if(updateErr || this.changes !== 1){
              return db.run('ROLLBACK', ()=>{
                res.status(updateErr ? 500 : 409).json({
                  success:false,
                  message:updateErr ? 'خطأ في قاعدة البيانات' : 'طلب التوثيق لم يعد قيد المراجعة'
                });
              });
            }

            db.run(
              `UPDATE users
               SET is_verified=1
               WHERE id=?`,
              [row.user_id],
              function(userErr){
                if(userErr || this.changes !== 1){
                  return db.run('ROLLBACK', ()=>{
                    res.status(userErr ? 500 : 404).json({
                      success:false,
                      message:userErr ? 'خطأ في قاعدة البيانات' : 'المستخدم غير موجود'
                    });
                  });
                }

                db.run('COMMIT', (commitErr)=>{
                  if(commitErr){
                    return db.run('ROLLBACK', ()=>{
                      res.status(500).json({
                        success:false,
                        message:'فشل حفظ عملية التوثيق'
                      });
                    });
                  }

                  createNotification(
                    row.user_id,
                    'تم توثيق الحساب',
                    'تم قبول توثيق حسابك ✅',
                    'verification'
                  );

                  res.json({
                    success:true,
                    message:'تم قبول التوثيق'
                  });
                });
              }
            );
          }
        );
      });
    }
  );
});

app.post('/api/admin/verification/reject/:id', requireAuth, requireAdmin, (req,res)=>{
  const id=req.params.id;

  db.get(
    `SELECT user_id FROM verification_requests WHERE id=?`,
    [id],
    (findErr,row)=>{
      if(findErr){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      if(!row){
        return res.status(404).json({
          success:false,
          message:'طلب التوثيق غير موجود'
        });
      }

      db.run(
        `UPDATE verification_requests
         SET status='rejected'
         WHERE id=?`,
        [id],
        function(err){
          if(err){
            return res.status(500).json({
              success:false,
              message:'خطأ في قاعدة البيانات'
            });
          }

          if(this.changes !== 1){
            return res.status(404).json({
              success:false,
              message:'لم يتم العثور على طلب التوثيق'
            });
          }

          createNotification(
            Number(row.user_id),
            'تم رفض التوثيق',
            'تم رفض طلب توثيق حسابك',
            'verification'
          );

          res.json({
            success:true,
            message:'تم رفض التوثيق'
          });
        }
      );
    }
  );
});
app.post('/api/reports', requireAuth, (req,res)=>{
  const { target_user_id, reason, details } = req.body;

  if(!target_user_id || !reason){
    return res.status(400).json({
      success:false,
      message:'المستخدم والسبب مطلوبان'
    });
  }

  if(Number(target_user_id) === Number(req.user.id)){
    return res.status(400).json({
      success:false,
      message:'لا يمكنك الإبلاغ عن نفسك'
    });
  }

  db.run(
    `
    INSERT INTO reports
    (reporter_id,target_user_id,reason,details)
    VALUES(?,?,?,?)
    `,
    [
      req.user.id,
      target_user_id,
      reason,
      details || null
    ],
    function(err){
      if(err){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      const reportId = this.lastID;

      // 🔔 Telegram — إشعار بلاغ جديد
      db.all(
        `SELECT id, name, email FROM users WHERE id IN (?, ?)`,
        [req.user.id, target_user_id],
        (userErr, users) => {
          if (userErr) {
            console.error('TELEGRAM REPORT USERS ERROR:', userErr);
            return;
          }

          const reporter = (users || []).find(
            u => Number(u.id) === Number(req.user.id)
          );

          const target = (users || []).find(
            u => Number(u.id) === Number(target_user_id)
          );

          const telegramText = [
            '🚨 بلاغ جديد',
            '',
            `🆔 رقم البلاغ: ${reportId}`,
            '',
            `👤 المُبلِّغ: ${reporter?.name || 'غير معروف'}`,
            `🆔 رقم المُبلِّغ: ${req.user.id}`,
            `📧 بريد المُبلِّغ: ${reporter?.email || 'غير معروف'}`,
            '',
            `🎯 المُبلَّغ عليه: ${target?.name || 'غير معروف'}`,
            `🆔 رقم المُبلَّغ عليه: ${target_user_id}`,
            `📧 بريد المُبلَّغ عليه: ${target?.email || 'غير معروف'}`,
            '',
            `⚠️ السبب: ${reason}`,
            `📝 التفاصيل: ${details || 'لا توجد تفاصيل'}`,
            '',
            '📌 الحالة: بانتظار المراجعة',
            '⚠️ يحتاج البلاغ إلى مراجعة الإدارة.'
          ].join('\n');

          sendTelegramAdmin(telegramText).catch(err => {
            console.error('TELEGRAM REPORT ERROR:', err.message);
          });
        }
      );

      res.json({
        success:true,
        report_id:reportId,
        message:'تم إرسال البلاغ للمراجعة'
      });
    }
  );

});




app.get('/api/admin/reports', requireAuth, requireAdmin, (req,res)=>{

  db.all(
    `
    SELECT
      reports.id,
      reports.reason,
      reports.details,
      reports.status,
      reports.created_at,

      reporter.id AS reporter_id,
      reporter.name AS reporter_name,

      target.id AS target_user_id,
      target.name AS target_name

    FROM reports

    JOIN users reporter
    ON reporter.id = reports.reporter_id

    JOIN users target
    ON target.id = reports.target_user_id

    ORDER BY reports.id DESC
    `,
    [],
    (err,rows)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      res.json({
        success:true,
        reports:rows
      });
    }
  );

});




app.post('/api/admin/reports/resolve/:id', requireAuth, requireAdmin, (req,res)=>{
  const id = Number(req.params.id);

  if(!Number.isInteger(id) || id <= 0){
    return res.status(400).json({
      success:false,
      message:'رقم البلاغ غير صالح'
    });
  }

  db.run('BEGIN IMMEDIATE',(beginErr)=>{
    if(beginErr){
      console.error('REPORT RESOLVE BEGIN ERROR:',beginErr);
      return res.status(500).json({
        success:false,
        message:'تعذر بدء معالجة البلاغ'
      });
    }

    db.get(
      `SELECT * FROM reports
       WHERE id=? AND status='pending'`,
      [id],
      (err,report)=>{
        if(err || !report){
          return db.run('ROLLBACK',()=>{
            res.status(400).json({
              success:false,
              message:'البلاغ غير موجود أو تمت معالجته مسبقاً'
            });
          });
        }

        db.run(
          `UPDATE users
           SET is_banned=1
           WHERE id=? AND role!='owner'`,
          [report.target_user_id],
          function(banErr){
            if(banErr || this.changes !== 1){
              return db.run('ROLLBACK',()=>{
                console.error('REPORT RESOLVE BAN ERROR:',banErr);
                res.status(400).json({
                  success:false,
                  message:'تعذر حظر المستخدم المستهدف'
                });
              });
            }

            db.run(
              `UPDATE reports
               SET status='resolved'
               WHERE id=? AND status='pending'`,
              [id],
              function(statusErr){
                if(statusErr || this.changes !== 1){
                  return db.run('ROLLBACK',()=>{
                    console.error('REPORT RESOLVE STATUS ERROR:',statusErr);
                    res.status(500).json({
                      success:false,
                      message:'تعذر تثبيت معالجة البلاغ'
                    });
                  });
                }

                db.run('COMMIT',(commitErr)=>{
                  if(commitErr){
                    return db.run('ROLLBACK',()=>{
                      console.error('REPORT RESOLVE COMMIT ERROR:',commitErr);
                      res.status(500).json({
                        success:false,
                        message:'تعذر حفظ معالجة البلاغ'
                      });
                    });
                  }

                  res.json({
                    success:true,
                    message:'تم قبول البلاغ وحظر المستخدم'
                  });
                });
              }
            );
          }
        );
      }
    );
  });
});

app.post('/api/admin/reports/reject/:id', requireAuth, requireAdmin, (req,res)=>{
  const id = Number(req.params.id);

  if(!Number.isInteger(id) || id <= 0){
    return res.status(400).json({
      success:false,
      message:'رقم البلاغ غير صالح'
    });
  }

  db.run('BEGIN IMMEDIATE',(beginErr)=>{
    if(beginErr){
      console.error('REPORT REJECT BEGIN ERROR:',beginErr);
      return res.status(500).json({
        success:false,
        message:'تعذر بدء معالجة البلاغ'
      });
    }

    db.run(
      `UPDATE reports
       SET status='rejected'
       WHERE id=? AND status='pending'`,
      [id],
      function(statusErr){
        if(statusErr){
          return db.run('ROLLBACK',()=>{
            console.error('REPORT REJECT STATUS ERROR:',statusErr);
            res.status(500).json({
              success:false,
              message:'تعذر رفض البلاغ'
            });
          });
        }

        if(this.changes !== 1){
          return db.run('ROLLBACK',()=>{
            res.status(400).json({
              success:false,
              message:'البلاغ غير موجود أو تمت معالجته مسبقاً'
            });
          });
        }

        db.run('COMMIT',(commitErr)=>{
          if(commitErr){
            return db.run('ROLLBACK',()=>{
              console.error('REPORT REJECT COMMIT ERROR:',commitErr);
              res.status(500).json({
                success:false,
                message:'تعذر حفظ رفض البلاغ'
              });
            });
          }

          res.json({
            success:true,
            message:'تم رفض البلاغ'
          });
        });
      }
    );
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Suriana API running on port ${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

const wsServer = new WebSocketServer({ server });

const wsClients = new Map();

wsServer.on('connection', (socket, req) => {
  const token = getCookieToken(req);
  const user = verifyWebSocketToken(token);

  if (!user || !user.id) {
    socket.close(1008, 'Unauthorized');
    return;
  }

  const userId = String(user.id);
  wsClients.set(userId, socket);

  // SURIANA WS BAN CHECK
  const wsBanCheck = setInterval(() => {
    db.get(
      `SELECT is_banned FROM users WHERE id = ?`,
      [userId],
      (err, row) => {
        if (err) {
          console.error('WS BAN CHECK ERROR:', err.message);
          return;
        }

        if (!row || row.is_banned === 1) {
          clearInterval(wsBanCheck);
          if (wsClients.get(userId) === socket) {
            wsClients.delete(userId);
          }
          if (socket.readyState === 1) {
            socket.close(1008, 'Account blocked');
          }
        }
      }
    );
  }, 10000);

  socket.on('message', (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'بيانات الإشارة غير صالحة'
      }));
      return;
    }

    const callId = Number(message.call_id);
    const targetUserId = Number(message.target_user_id);
    const allowedTypes = new Set([
      'offer',
      'answer',
      'ice-candidate'
    ]);

    if (
      !Number.isInteger(callId) ||
      callId <= 0 ||
      !Number.isInteger(targetUserId) ||
      targetUserId <= 0 ||
      !allowedTypes.has(message.type)
    ) {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'بيانات الإشارة غير مكتملة'
      }));
      return;
    }

    db.get(
      `SELECT id, caller_id, receiver_id, status
       FROM calls
       WHERE id=?`,
      [callId],
      (err, call) => {
        if (err || !call) {
          socket.send(JSON.stringify({
            type: 'error',
            message: 'المكالمة غير موجودة'
          }));
          return;
        }

        const me = Number(userId);
        const callerId = Number(call.caller_id);
        const receiverId = Number(call.receiver_id);

        if (
          (me !== callerId && me !== receiverId) ||
          (targetUserId !== callerId && targetUserId !== receiverId) ||
          targetUserId === me
        ) {
          socket.send(JSON.stringify({
            type: 'error',
            message: 'لا يمكنك إرسال إشارة لهذه المكالمة'
          }));
          return;
        }

        if (call.status !== 'ringing' && call.status !== 'started') {
          socket.send(JSON.stringify({
            type: 'error',
            message: 'المكالمة ليست فعالة'
          }));
          return;
        }

        const targetSocket = wsClients.get(String(targetUserId));

        if (!targetSocket || targetSocket.readyState !== 1) {
          socket.send(JSON.stringify({
            type: 'peer-offline',
            call_id: callId,
            target_user_id: targetUserId
          }));
          return;
        }

        targetSocket.send(JSON.stringify({
          type: message.type,
          call_id: callId,
          from_user_id: me,
          data: message.data ?? null
        }));
      }
    );
  });

  socket.on('close', () => {
    clearInterval(wsBanCheck);
    if (wsClients.get(userId) === socket) {
      wsClients.delete(userId);
    }
  });

  socket.on('error', () => {
    clearInterval(wsBanCheck);
    if (wsClients.get(userId) === socket) {
      wsClients.delete(userId);
    }
  });
});


// تحديث إعدادات الإدارة
app.put('/api/admin/settings', requireAuth, requireOwner, async (req,res)=>{
  try {
    const { email, password } = req.body;

    if (!email && !password) {
      return res.status(400).json({
        success:false,
        message:'لم يتم إرسال بيانات جديدة'
      });
    }

    const bcrypt = require('bcrypt');

    db.get(
      `SELECT id FROM users WHERE role='owner' LIMIT 1`,
      [],
      async (err, admin)=>{
        if(err) return res.status(500).json({success:false,message:'خطأ قاعدة البيانات'});
        if(!admin) return res.status(404).json({success:false,message:'لا يوجد مدير'});

        let fields=[];
        let values=[];

        if(email){
          fields.push("email=?");
          values.push(email);
        }

        if(password){
          const hash = await bcrypt.hash(password,10);
          fields.push("password=?");
          values.push(hash);
        }

        values.push(admin.id);

          db.run(
            `UPDATE users SET ${fields.join(", ")} WHERE id=? AND role='owner'`,
            values,
            function(updateErr){
              if(updateErr)
                return res.status(500).json({success:false,message:'فشل التحديث'});

              db.run(
                `UPDATE admin_sessions
                 SET revoked_at=CURRENT_TIMESTAMP
                 WHERE user_id=? AND revoked_at IS NULL`,
                [admin.id]
              );

              res.json({
                success:true,
                message:'تم تحديث إعدادات الإدارة وتم إلغاء الجلسات القديمة'
              });
            }
          );
      }
    );

  } catch(e){
    res.status(500).json({success:false,message:e.message});
  }
});



// 👑 الإدارة: جلب طلبات السحب
app.get('/api/admin/withdraw', requireAuth, requireAdmin, (req,res)=>{
  db.all(
    `
    SELECT
      withdraw_requests.*,
      users.name,
      users.email
    FROM withdraw_requests
    JOIN users ON users.id = withdraw_requests.user_id
    ORDER BY withdraw_requests.id DESC
    `,
    [],
    (err,rows)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:'خطأ في قاعدة البيانات'
        });
      }

      res.json({
        success:true,
        requests:rows
      });
    }
  );
});


function createNotification(userId,title,message,type){
 db.run(`INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)`,
 [userId,title,message,type || "system"]);
}


// 🤖 Telegram — بوت الرسائل الثاني
async function sendTelegramMessageBotAlert(senderId, receiverId, content, messageId = null) {
  const token = process.env.TELEGRAM_MESSAGES_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    console.warn('TELEGRAM MESSAGES: settings missing');
    return false;
  }

  try {
    const users = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, name, email FROM users WHERE id IN (?, ?)`,
        [senderId, receiverId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    const sender = users.find(u => Number(u.id) === Number(senderId));
    const receiver = users.find(u => Number(u.id) === Number(receiverId));

    const telegramText = [
      '💬 رسالة جديدة في سوريانا',
      '',
      `🆔 رقم الرسالة: ${messageId ?? 'غير متوفر'}`,
      '',
      `👤 المرسل: ${sender?.name || 'غير معروف'}`,
      `🆔 رقم المرسل: ${senderId}`,
      `📧 بريد المرسل: ${sender?.email || 'غير معروف'}`,
      '',
      `👤 المستلم: ${receiver?.name || 'غير معروف'}`,
      `🆔 رقم المستلم: ${receiverId}`,
      `📧 بريد المستلم: ${receiver?.email || 'غير معروف'}`,
      '',
      '📝 نص الرسالة:',
      String(content ?? ''),
      '',
      '📌 الحالة: تم إرسال الرسالة بنجاح'
    ].join('\n');

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: telegramText,
          disable_web_page_preview: true
        })
      }
    );

    const data = await response.json();

    if (!data.ok) {
      console.error('TELEGRAM MESSAGES SEND ERROR:', data.description);
      return false;
    }

    return true;
  } catch (err) {
    console.error('TELEGRAM MESSAGES ERROR:', err.message);
    return false;
  }
}


/* TELEGRAM_MEDIA_ALERT */
async function sendTelegramMessageBotMediaAlert(senderId, receiverId, messageType, filePath, fileName, messageId = null) {
  const token = process.env.TELEGRAM_MESSAGES_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    console.warn('TELEGRAM MEDIA: settings missing');
    return false;
  }

  try {
    const users = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, name, email FROM users WHERE id IN (?, ?)`,
        [senderId, receiverId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    const sender = users.find(u => Number(u.id) === Number(senderId));
    const receiver = users.find(u => Number(u.id) === Number(receiverId));

    const caption = [
      messageType === 'image'
        ? '🖼️ صورة جديدة في سوريانا'
        : '🎙️ تسجيل صوتي جديد في سوريانا',
      '',
      `🆔 رقم الرسالة: ${messageId ?? 'غير متوفر'}`,
      '',
      `👤 المرسل: ${sender?.name || 'غير معروف'}`,
      `🆔 رقم المرسل: ${senderId}`,
      `📧 بريد المرسل: ${sender?.email || 'غير معروف'}`,
      '',
      `👤 المستلم: ${receiver?.name || 'غير معروف'}`,
      `🆔 رقم المستلم: ${receiverId}`,
      `📧 بريد المستلم: ${receiver?.email || 'غير معروف'}`
    ].join('\n');

    const buffer = fs.readFileSync(filePath);

    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append(
      messageType === 'image' ? 'photo' : 'audio',
      new Blob([buffer]),
      fileName
    );
    form.append('caption', caption);

    const method = messageType === 'image' ? 'sendPhoto' : 'sendAudio';

    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: 'POST',
        body: form
      }
    );

    const data = await response.json();

    if (data.ok) return true;

    // إذا رفض Telegram WebM كـ audio، نرسله كملف قابل للفتح
    if (messageType === 'audio') {
      const fallbackForm = new FormData();
      fallbackForm.append('chat_id', String(chatId));
      fallbackForm.append('document', new Blob([buffer]), fileName);
      fallbackForm.append('caption', caption);

      const fallbackResponse = await fetch(
        `https://api.telegram.org/bot${token}/sendDocument`,
        {
          method: 'POST',
          body: fallbackForm
        }
      );

      const fallbackData = await fallbackResponse.json();

      if (fallbackData.ok) return true;

      console.error(
        'TELEGRAM MEDIA AUDIO ERROR:',
        fallbackData.description || data.description
      );
      return false;
    }

    console.error('TELEGRAM MEDIA SEND ERROR:', data.description);
    return false;
  } catch (err) {
    console.error('TELEGRAM MEDIA ERROR:', err.message);
    return false;
  }
}

/* REAL_PROFILE_LIKES_SYSTEM */

// عدد الإعجابات على الملف الشخصي
app.get("/api/profile-likes/:user_id/count", requireAuth, (req,res)=>{
  const userId = Number(req.params.user_id);

  if(!Number.isInteger(userId) || userId <= 0){
    return res.status(400).json({
      success:false,
      message:"المستخدم غير صالح"
    });
  }

  db.get(
    `SELECT COUNT(*) AS likes
     FROM profile_likes
     WHERE liked_id=?`,
    [userId],
    (err,row)=>{
      if(err){
        console.error("PROFILE LIKES COUNT ERROR:",err);
        return res.status(500).json({
          success:false,
          message:"خطأ في حساب الإعجابات"
        });
      }

      res.json({
        success:true,
        likes:Number(row?.likes || 0)
      });
    }
  );
});



// معرفة حالة الإعجاب
app.get("/api/profile-likes/:user_id", requireAuth, (req,res)=>{
  const liker_id = Number(req.user.id);
  const liked_id = Number(req.params.user_id);

  if(!Number.isInteger(liked_id) || liked_id <= 0){
    return res.status(400).json({
      success:false,
      message:"المستخدم غير صالح"
    });
  }

  db.get(
    `SELECT id FROM profile_likes WHERE liker_id=? AND liked_id=?`,
    [liker_id, liked_id],
    (err,row)=>{
      if(err){
        console.error("PROFILE LIKE STATUS ERROR:",err);
        return res.status(500).json({success:false});
      }

      res.json({
        success:true,
        liked:!!row
      });
    }
  );
});

// إضافة إعجاب
app.post("/api/profile-likes/:user_id", requireAuth, (req,res)=>{
  const liker_id = Number(req.user.id);
  const liked_id = Number(req.params.user_id);

  if(!Number.isInteger(liked_id) || liked_id <= 0){
    return res.status(400).json({
      success:false,
      message:"المستخدم غير صالح"
    });
  }

  if(liker_id === liked_id){
    return res.status(400).json({
      success:false,
      message:"لا يمكنك الإعجاب بملفك"
    });
  }

  db.get(
    `SELECT id,name FROM users WHERE id=? AND is_banned=0`,
    [liked_id],
    (userErr,target)=>{
      if(userErr){
        return res.status(500).json({success:false});
      }

      if(!target){
        return res.status(404).json({
          success:false,
          message:"المستخدم غير موجود"
        });
      }

      db.get(
        `SELECT id FROM profile_likes WHERE liker_id=? AND liked_id=?`,
        [liker_id,liked_id],
        (checkErr,existing)=>{
          if(checkErr){
            return res.status(500).json({success:false});
          }

          if(existing){
            return res.json({
              success:true,
              liked:true,
              already_liked:true
            });
          }

          db.run(
            `INSERT INTO profile_likes(liker_id,liked_id) VALUES(?,?)`,
            [liker_id,liked_id],
            function(insertErr){
              if(insertErr){
                console.error("PROFILE LIKE INSERT ERROR:",insertErr);
                return res.status(500).json({success:false});
              }

              db.get(
                `SELECT name FROM users WHERE id=?`,
                [liker_id],
                (nameErr,liker)=>{
                  const likerName =
                    !nameErr && liker && liker.name
                      ? liker.name
                      : "مستخدم";

                  createNotification(
                    liked_id,
                    "إعجاب جديد ❤️",
                    `${likerName} معجب بملفك ❤️`,
                    "like"
                  );

                  res.json({
                    success:true,
                    liked:true,
                    like_id:this.lastID
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// إلغاء الإعجاب
app.delete("/api/profile-likes/:user_id", requireAuth, (req,res)=>{
  const liker_id = Number(req.user.id);
  const liked_id = Number(req.params.user_id);

  if(!Number.isInteger(liked_id) || liked_id <= 0){
    return res.status(400).json({
      success:false,
      message:"المستخدم غير صالح"
    });
  }

  db.run(
    `DELETE FROM profile_likes WHERE liker_id=? AND liked_id=?`,
    [liker_id,liked_id],
    function(err){
      if(err){
        console.error("PROFILE UNLIKE ERROR:",err);
        return res.status(500).json({success:false});
      }

      res.json({
        success:true,
        liked:false,
        deleted:this.changes || 0
      });
    }
  );
});

app.get("/api/notifications", requireAuth, (req,res)=>{
 const userId = req.user.id;
 db.all(`SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50`,[userId],(err,rows)=>{
  if(err) return res.status(500).json({success:false});
  res.json({success:true,notifications:rows});
 });
});

app.post("/api/notifications/read/:id", requireAuth, (req,res)=>{
 db.run(`UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`,[req.params.id,req.user.id],function(err){
  if(err) return res.status(500).json({success:false});
  res.json({success:true});
 });
});

app.get('/api/admin/stats', requireAuth, requireAdmin, (req,res)=>{
  const stats = {};

  db.serialize(()=>{

    db.get("SELECT COUNT(*) AS count FROM users", (e,r)=>{
      stats.users = r ? r.count : 0;
    });

    db.get("SELECT COUNT(*) AS count FROM users WHERE is_verified=1", (e,r)=>{
      stats.verified = r ? r.count : 0;
    });

    db.get("SELECT COUNT(*) AS count FROM messages", (e,r)=>{
      stats.messages = r ? r.count : 0;
    });

    db.get("SELECT COUNT(*) AS count FROM charge_requests", (e,r)=>{
      stats.charges = r ? r.count : 0;
    });

    db.get("SELECT COUNT(*) AS count FROM withdraw_requests", (e,r)=>{
      stats.withdraws = r ? r.count : 0;
    });

    db.get("SELECT COALESCE(SUM(points),0) AS total FROM users", (e,r)=>{
      stats.points = r ? r.total : 0;
    });

    db.get("SELECT COALESCE(SUM(points),0) AS total FROM admin_profits", (e,r)=>{
      stats.profits = r ? r.total : 0;
    });

    db.get("SELECT COALESCE(SUM(amount_syr),0) AS total FROM charge_requests WHERE status='approved'", (e,r)=>{
      stats.charge_money = r ? r.total : 0;
    });

    db.get("SELECT COALESCE(SUM(points),0) AS total FROM withdraw_requests WHERE status='approved'", (e,r)=>{
      stats.withdraw_points = r ? r.total : 0;

      res.json({
        success:true,
        stats
      });
    });

  });
});


app.get('/api/payment-settings', (req,res)=>{
  db.get(`SELECT sham_cash, syriatel_cash, mtn_cash FROM payment_settings WHERE id=1`, [], (err,row)=>{
    if(err){
      return res.status(500).json({success:false});
    }
    res.json({
      success:true,
      settings:row || {sham_cash:"", syriatel_cash:"", mtn_cash:""}
    });
  });
});

app.get('/api/admin/payment-settings', requireAuth, requireOwner, (req,res)=>{
  db.get(`SELECT * FROM payment_settings LIMIT 1`, [], (err,row)=>{
    if(err){
      return res.status(500).json({success:false});
    }
    res.json({
      success:true,
      settings:row || {}
    });
  });
});

app.put('/api/admin/payment-settings', requireAuth, requireOwner, (req,res)=>{
  const {sham_cash, syriatel_cash, mtn_cash, point_price}=req.body;

  db.run(
    `UPDATE payment_settings SET sham_cash=?, syriatel_cash=?, mtn_cash=?, point_price=? WHERE id=1`,
    [sham_cash, syriatel_cash, mtn_cash, point_price],
    function(err){
      if(err){
        return res.status(500).json({success:false});
      }
      if(this.changes !== 1){
        return res.status(404).json({
          success:false,
          message:'إعدادات الدفع غير موجودة'
        });
      }
      res.json({success:true});
    }
  );
});


app.get('/api/admin/app-settings', requireAuth, requireOwner, (req,res)=>{
  db.get(`SELECT * FROM app_settings LIMIT 1`, [], (err,row)=>{
    if(err){
      return res.status(500).json({success:false});
    }
    res.json({
      success:true,
      settings:row || {}
    });
  });
});

app.put('/api/admin/app-settings', requireAuth, requireOwner, (req,res)=>{
  const {maintenance, register_open, announcement, message_cost} = req.body;

  db.run(
    `UPDATE app_settings SET maintenance=?, register_open=?, announcement=?, message_cost=? WHERE id=1`,
    [maintenance, register_open, announcement, message_cost],
    function(err){
      if(err){
        return res.status(500).json({success:false});
      }
      res.json({success:true});
    }
  );
});


function chatCallBlockGuard(req,res,next){
  const callerId=Number(req.user.id);
  const receiverId=Number(req.body.receiver_id);

  if(!Number.isInteger(receiverId)||receiverId<=0||receiverId===callerId)
    return next();

  usersBlocked(callerId,receiverId,(err,blocked)=>{
    if(err)return res.status(500).json({success:false,message:'تعذر التحقق من الحظر'});
    if(blocked)return res.status(403).json({success:false,blocked:true,message:'لا يمكنك الاتصال بهذا المستخدم لأنه محظور'});
    next();
  });
}

/* CHAT_CALL_BLOCK_MIDDLEWARE */

/* REAL_INCOMING_CALL_SYSTEM */

// بدء اتصال: Ringing فقط — لا يبدأ العداد ولا الخصم.
app.post('/api/calls', requireAuth, chatCallBlockGuard, (req,res)=>{
  const caller_id = Number(req.user.id);
  const receiver_id = Number(req.body.receiver_id);

  if(!Number.isInteger(receiver_id) || receiver_id <= 0){
    return res.status(400).json({
      success:false,
      message:"المستقبل مطلوب"
    });
  }

  if(receiver_id === caller_id){
    return res.status(400).json({
      success:false,
      message:"لا يمكنك الاتصال بنفسك"
    });
  }

  db.get(
    `SELECT id FROM users WHERE id=?`,
    [receiver_id],
    (receiverErr,receiver)=>{
      if(receiverErr){
        return res.status(500).json({
          success:false,
          message:"خطأ في قاعدة البيانات"
        });
      }

      if(!receiver){
        return res.status(404).json({
          success:false,
          message:"المستخدم المطلوب غير موجود"
        });
      }

      db.get(
        `SELECT points,role FROM users WHERE id=?`,
        [caller_id],
        (err,user)=>{
          if(err || !user){
            return res.status(500).json({
              success:false,
              message:"خطأ بالحساب"
            });
          }

          const balance = Number(user.points) || 0;

          if(user.role !== 'owner' && balance < 25){
            return res.status(400).json({
              success:false,
              message:"رصيدك غير كافي"
            });
          }

          const max_seconds = user.role === 'owner'
            ? null
            : Math.floor((balance * 60) / 25);

          db.run(
            `INSERT INTO calls
             (caller_id,receiver_id,status,max_seconds,started_at)
             VALUES(?,?,?, ?,NULL)`,
            [caller_id,receiver_id,'ringing',max_seconds],
            function(insertErr){
              if(insertErr){
                console.error("CALL RINGING INSERT ERROR:",insertErr);
                return res.status(500).json({
                  success:false,
                  message:"تعذر إنشاء طلب المكالمة"
                });
              }

              res.json({
                success:true,
                call_id:this.lastID,
                status:"ringing",
                max_seconds,
                points:balance
              });
            }
          );
        }
      );
    }
  );
});

/* جلب آخر مكالمة واردة قيد الرنين */
app.get('/api/calls/incoming', requireAuth, (req,res)=>{
  const receiver_id = Number(req.user.id);

  db.get(
    `SELECT
       id,
       caller_id,
       receiver_id,
       status,
       created_at,
       started_at,
       max_seconds
     FROM calls
     WHERE receiver_id=?
       AND status='ringing'
     ORDER BY id DESC
     LIMIT 1`,
    [receiver_id],
    (err,call)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:"تعذر قراءة المكالمات الواردة"
        });
      }

      if(!call){
        return res.json({
          success:true,
          call:null
        });
      }

      db.get(
        `SELECT id,name,username,avatar FROM users WHERE id=?`,
        [call.caller_id],
        (userErr,caller)=>{
          if(userErr){
            return res.status(500).json({
              success:false,
              message:"تعذر قراءة بيانات المتصل"
            });
          }

          res.json({
            success:true,
            call:{
              ...call,
              caller:caller || null
            }
          });
        }
      );
    }
  );
});

/* حالة مكالمة محددة — المتصل أو المستقبل يستطيع رؤيتها */
app.get('/api/calls/:call_id/status', requireAuth, (req,res)=>{
  const call_id = Number(req.params.call_id);
  const me = Number(req.user.id);

  if(!Number.isInteger(call_id) || call_id <= 0){
    return res.status(400).json({
      success:false,
      message:"رقم المكالمة غير صالح"
    });
  }

  db.get(
    `SELECT
       id,
       caller_id,
       receiver_id,
       status,
       points,
       admin_share,
       girl_share,
       created_at,
       started_at,
       duration_seconds,
       ended_at,
       max_seconds
     FROM calls
     WHERE id=?`,
    [call_id],
    (err,call)=>{
      if(err){
        return res.status(500).json({success:false});
      }

      if(!call){
        return res.status(404).json({
          success:false,
          message:"المكالمة غير موجودة"
        });
      }

      if(me !== Number(call.caller_id) && me !== Number(call.receiver_id)){
        return res.status(403).json({
          success:false,
          message:"لا يمكنك مشاهدة هذه المكالمة"
        });
      }

      res.json({
        success:true,
        call
      });
    }
  );
});

/* قبول المكالمة — هنا فقط يبدأ العداد */
app.post('/api/calls/:call_id/accept', requireAuth, (req,res)=>{
  const call_id = Number(req.params.call_id);
  const receiver_id = Number(req.user.id);

  if(!Number.isInteger(call_id) || call_id <= 0){
    return res.status(400).json({
      success:false,
      message:"رقم المكالمة غير صالح"
    });
  }

  db.run(
    `UPDATE calls
     SET status='started',
         started_at=CURRENT_TIMESTAMP
     WHERE id=?
       AND receiver_id=?
       AND status='ringing'`,
    [call_id,receiver_id],
    function(err){
      if(err){
        console.error("CALL ACCEPT ERROR:",err);
        return res.status(500).json({
          success:false,
          message:"تعذر قبول المكالمة"
        });
      }

      if(this.changes !== 1){
        return res.status(409).json({
          success:false,
          message:"المكالمة لم تعد متاحة"
        });
      }

      db.get(
        `SELECT * FROM calls WHERE id=?`,
        [call_id],
        (getErr,call)=>{
          if(getErr || !call){
            return res.status(500).json({
              success:false,
              message:"تعذر قراءة المكالمة"
            });
          }

          res.json({
            success:true,
            status:"started",
            call_id,
            started_at:call.started_at,
            max_seconds:call.max_seconds
          });
        }
      );
    }
  );
});

/* رفض المكالمة — لا يوجد خصم */
app.post('/api/calls/:call_id/reject', requireAuth, (req,res)=>{
  const call_id = Number(req.params.call_id);
  const receiver_id = Number(req.user.id);

  db.run(
    `UPDATE calls
     SET status='rejected',
         ended_at=CURRENT_TIMESTAMP
     WHERE id=?
       AND receiver_id=?
       AND status='ringing'`,
    [call_id,receiver_id],
    function(err){
      if(err){
        return res.status(500).json({
          success:false,
          message:"تعذر رفض المكالمة"
        });
      }

      if(this.changes !== 1){
        return res.status(409).json({
          success:false,
          message:"المكالمة لم تعد قيد الانتظار"
        });
      }

      res.json({
        success:true,
        status:"rejected"
      });
    }
  );
});

/* إلغاء الاتصال من المتصل أثناء الرنين */
app.post('/api/calls/:call_id/cancel', requireAuth, (req,res)=>{
  const call_id = Number(req.params.call_id);
  const caller_id = Number(req.user.id);

  db.run(
    `UPDATE calls
     SET status='cancelled',
         ended_at=CURRENT_TIMESTAMP
     WHERE id=?
       AND caller_id=?
       AND status='ringing'`,
    [call_id,caller_id],
    function(err){
      if(err){
        return res.status(500).json({
          success:false,
          message:"تعذر إلغاء الاتصال"
        });
      }

      if(this.changes !== 1){
        return res.status(409).json({
          success:false,
          message:"لا يمكن إلغاء هذه المكالمة"
        });
      }

      res.json({
        success:true,
        status:"cancelled"
      });
    }
  );
});

app.post('/api/calls/end', requireAuth, (req,res)=>{
  const call_id = Number(req.body.call_id);

  if(!Number.isInteger(call_id) || call_id <= 0){
    return res.status(400).json({
      success:false,
      message:"رقم المكالمة غير صالح"
    });
  }

  db.get(
    `SELECT * FROM calls WHERE id=?`,
    [call_id],
    (err,call)=>{
      if(err){
        return res.status(500).json({
          success:false,
          message:"خطأ في قاعدة البيانات"
        });
      }

      if(!call){
        return res.status(404).json({
          success:false,
          message:"المكالمة غير موجودة"
        });
      }

      if(Number(call.caller_id) !== Number(req.user.id)){
        return res.status(403).json({
          success:false,
          message:"لا يمكنك إنهاء هذه المكالمة"
        });
      }

      if(call.status !== 'started'){
        return res.status(409).json({
          success:false,
          message:"المكالمة ليست جارية حالياً"
        });
      }

      if(!call.started_at){
        return res.status(409).json({
          success:false,
          message:"وقت بدء المكالمة غير موجود"
        });
      }

      const elapsed_seconds = Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(String(call.started_at).replace(' ', 'T') + 'Z').getTime()) / 1000
        )
      );


      db.run("BEGIN TRANSACTION", (beginErr)=>{
        if(beginErr){
          return res.status(500).json({
            success:false,
            message:"انتهت المكالمة"
          });
        }

        const rollback = (status,message)=>{
          db.run("ROLLBACK", ()=>{
            res.status(status).json({
              success:false,
              message
            });
          });
        };

        // نقرأ الرصيد داخل نفس التسوية حتى لا يسمح الخصم بتجاوز الرصيد.
        db.get(
          `SELECT points,role FROM users WHERE id=?`,
          [call.caller_id],
          (balanceErr,user)=>{
            if(balanceErr || !user){
              return rollback(500,"تعذر قراءة رصيد المتصل");
            }

            const balance = Math.max(0, Number(user.points) || 0);
            const ownerCall = user.role === 'owner';

            // أقصى ثواني يستطيع الرصيد دفعها.
      // مدة المكالمة المدفوعة مثبتة لحظة البداية، وليس حسب رصيد النهاية.
      const max_seconds = ownerCall
        ? elapsed_seconds
        : Math.max(1, Number(call.max_seconds) || 1);

      // السيرفر نفسه يفرض الحد الأقصى حتى لو الواجهة تأخرت بإنهاء المكالمة.
      const billable_seconds = ownerCall
        ? elapsed_seconds
        : Math.min(elapsed_seconds, max_seconds);

            // السعر الحقيقي بالثواني:
            // 25 نقطة / 60 ثانية
            // أول دقيقة = 25 نقطة كاملة، وبعدها الحساب بالثانية.
            const raw_total = ownerCall
              ? 0
              : billable_seconds < 60
                ? 25
                : (billable_seconds * 25) / 60;

            // نخزن الكسور بدقة عملية، بدون تقريب للأعلى.
            const total = ownerCall
              ? 0
              : Math.round(raw_total * 1000000) / 1000000;

            // توزيع ثابت حسب الاتفاق: 5 للبنت + 20 للإدارة من كل 25.
      // البنت تحصل فقط على 5 نقاط عن كل دقيقة مكتملة.
      // أي ثوانٍ إضافية تذهب بالكامل للإدارة.
      const full_minutes = Math.floor(billable_seconds / 60);

      const girl_share = ownerCall
        ? 0
        : Math.round((full_minutes * 5) * 1000000) / 1000000;

      const admin_share = ownerCall
        ? 0
        : Math.round((total - girl_share) * 1000000) / 1000000;

            // منع تسوية المكالمة مرتين.
            db.run(
              `UPDATE calls
               SET points=?,
                   admin_share=?,
                   girl_share=?,
                   duration_seconds=?,
                   ended_at=CURRENT_TIMESTAMP,
                   status='ended'
               WHERE id=? AND status='started'`,
              [
                total,
                admin_share,
                girl_share,
                billable_seconds,
                call_id
              ],
              function(updateErr){
                if(updateErr){
                  return rollback(500,"تعذر إنهاء المكالمة");
                }

                if(this.changes !== 1){
                  return rollback(409,"انتهت المكالمة");
                }

                if(ownerCall){
                  return db.run("COMMIT", (commitErr)=>{
                    if(commitErr){
                      return rollback(500,"تعذر حفظ المكالمة");
                    }

                    db.run(
  `INSERT INTO messages
   (sender_id,receiver_id,content,cost,is_paid,is_delivered,delivered_at)
   VALUES(?,?,?,0,1,0,NULL)`,
  [
    call.caller_id,
    call.receiver_id,
    `📞 مكالمة صوتية — المدة: ${(billable_seconds / 60).toFixed(2)} دقيقة`
  ],
  (messageErr)=>{
    if(messageErr) console.error('OWNER CALL MESSAGE ERROR:',messageErr);
  }
);

res.json({
                      success:true,
                      seconds:billable_seconds,
                      minutes: billable_seconds / 60,
                      total:0,
                      admin_share:0,
                      girl_share:0,
                      remaining_points:balance
                    });
                  });
                }

                // الخصم لا يمكن أن يجعل الرصيد سالباً.
                db.run(
                  `UPDATE users
                   SET points=points-?
                   WHERE id=? AND points>=?`,
                  [total,call.caller_id,total],
                  function(deductErr){
                    if(deductErr){
                      return rollback(
                        500,
                        "تعذر خصم رصيد المكالمة: "+deductErr.message
                      );
                    }

                    if(this.changes !== 1){
                      return rollback(409,"الرصيد تغير، أعد إنهاء المكالمة");
                    }

                    // إضافة حصة البنت فقط عن الدقائق المكتملة.
                    if(girl_share > 0){
                      db.run(
                        `UPDATE users
                         SET points=points+?
                         WHERE id=?`,
                        [girl_share,call.receiver_id],
                        function(incomeErr){
                          if(incomeErr){
                            return rollback(500,"تعذر تسجيل أرباح المكالمة");
                          }

                          if(this.changes !== 1){
                            return rollback(404,"المستخدم المستقبل غير موجود");
                          }

                          continueLogs();
                        }
                      );
                    } else {
                      continueLogs();
                    }

                    function continueLogs(){
                      db.run(
                        `INSERT INTO wallet_logs
                         (user_id,type,points,description)
                         VALUES(?,?,?,?)`,
                        [
                          call.caller_id,
                          'call',
                          -total,
                          'مكالمة صوتية'
                        ],
                        (logCallerErr)=>{
                          if(logCallerErr){
                            return rollback(500,"تعذر تسجيل خصم المكالمة");
                          }

                          if(girl_share > 0){
                            db.run(
                              `INSERT INTO wallet_logs
                               (user_id,type,points,description)
                               VALUES(?,?,?,?)`,
                              [
                                call.receiver_id,
                                'call_income',
                                girl_share,
                                'أرباح مكالمة صوتية'
                              ],
                              (logGirlErr)=>{
                                if(logGirlErr){
                                  return rollback(
                                    500,
                                    "تعذر تسجيل أرباح المكالمة"
                                  );
                                }

                                continueAdmin();
                              }
                            );
                          } else {
                            continueAdmin();
                          }
                        }
                      );
                    }

                    function continueAdmin(){
                      db.run(
                        `INSERT INTO admin_profits(source,points)
                         VALUES(?,?)`,
                        ['call',admin_share],
                        (profitErr)=>{
                          if(profitErr){
                            return rollback(
                              500,
                              "تعذر تسجيل ربح الإدارة"
                            );
                          }

                          db.run("COMMIT",(commitErr)=>{
                            if(commitErr){
                              return rollback(
                                500,
                                "تعذر حفظ تسوية المكالمة"
                              );
                            }

                            const minutes = billable_seconds / 60;

        const remaining_points =
                              Math.max(
                                0,
                                balance-total
                              );

                            db.run(
  `INSERT INTO messages
   (sender_id,receiver_id,content,cost,is_paid,is_delivered,delivered_at)
   VALUES(?,?,?,?,1,0,NULL)`,
  [
    call.caller_id,
    call.receiver_id,
    `📞 مكالمة صوتية — المدة: ${(billable_seconds / 60).toFixed(2)} دقيقة`,
    total
  ],
  (messageErr)=>{
    if(messageErr) console.error('CALL MESSAGE ERROR:',messageErr);
  }
);

res.json({
                              success:true,
                              seconds:billable_seconds,
                              minutes,
                              total,
                              admin_share,
                              girl_share,
                              remaining_points
                            });
                          });
                        }
                      );
                    }
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});

// SERVER_CALL_AUTO_END_WATCHDOG
// يراقب المكالمات المفتوحة ويفرض الإنهاء من السيرفر.
// لا يغيّر أي شيء من نظام التسعير أو توزيع النقاط.
const http = require("http");

setInterval(() => {
  db.all(
    `SELECT id, caller_id, started_at, max_seconds
     FROM calls
     WHERE status='started'
       AND max_seconds IS NOT NULL
       AND max_seconds > 0`,
    [],
    (err, calls) => {
      if (err || !Array.isArray(calls)) return;

      const now = Date.now();

      for (const call of calls) {
        const started = new Date(
          String(call.started_at).replace(" ", "T") + "Z"
        ).getTime();

        if (!Number.isFinite(started)) continue;

        const elapsed = Math.floor((now - started) / 1000);
        const limit = Number(call.max_seconds);

        if (!Number.isFinite(limit) || limit <= 0 || elapsed < limit) {
          continue;
        }

        try {
          const token = createToken({ id: Number(call.caller_id) });

          const body = JSON.stringify({
            call_id: Number(call.id)
          });

          const request = http.request(
            {
              hostname: "127.0.0.1",
              port: 3000,
              path: "/api/calls/end",
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                "Cookie": "suriana_auth=" + encodeURIComponent(token)
              },
              timeout: 5000
            },
            (response) => {
              response.resume();
            }
          );

          request.on("error", (e) => {
            console.error(
              "SERVER AUTO CALL END ERROR:",
              e.message
            );
          });

          request.write(body);
          request.end();

        } catch (e) {
          console.error(
            "SERVER AUTO CALL WATCHDOG ERROR:",
            e.message
          );
        }
      }
    }
  );
}, 1000);




// DELETE ALL NOTIFICATIONS FOR CURRENT USER
app.delete("/api/notifications", requireAuth, (req,res)=>{
  db.run(
    `DELETE FROM notifications WHERE user_id=?`,
    [req.user.id],
    function(err){
      if(err){
        console.error("DELETE NOTIFICATIONS ERROR:", err);
        return res.status(500).json({
          success:false,
          message:"تعذر مسح سجل الإشعارات"
        });
      }

      res.json({
        success:true,
        deleted:this.changes || 0
      });
    }
  );
});

/* REAL_INCOMING_CALL_SYSTEM */
