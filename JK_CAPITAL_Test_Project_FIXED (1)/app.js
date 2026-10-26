require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DEMO_MODE = String(process.env.DEMO_MODE || 'false').toLowerCase() === 'true';
const CURRENCY = process.env.APP_CURRENCY || 'EUR';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Create a PostgreSQL database and set DATABASE_URL.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'jkcapital.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.currentUser = req.session.user || null;
  res.locals.demoMode = DEMO_MODE;
  res.locals.currency = CURRENCY;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.formatMoney = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: CURRENCY, maximumFractionDigits: 2 }).format(Number(value || 0));
  res.locals.formatDate = (value) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value));
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Trop de tentatives. Réessaie dans 15 minutes.' });
function csrf(req, res, next) {
  const supplied = req.body && req.body._csrf;
  if (!supplied || !req.session.csrfToken || supplied !== req.session.csrfToken) return res.status(403).render('error', { title: 'Requête refusée', message: 'Le formulaire a expiré. Recharge la page et réessaie.' });
  next();
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.status(403).render('error', { title: 'Accès réservé', message: 'Cette page est réservée à l’administration.' });
  next();
}
function flash(req, type, message) { req.session.flash = { type, message }; }
function validAmount(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1000000 && Math.round(n * 100) === n * 100 ? n : null;
}
async function query(text, params) { return pool.query(text, params); }

async function initDb() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), is_active BOOLEAN NOT NULL DEFAULT TRUE
  )`);
  await query(`CREATE TABLE IF NOT EXISTS deposits (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ, reviewed_by BIGINT REFERENCES users(id)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS withdrawals (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
    payout_reference TEXT, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ, reviewed_by BIGINT REFERENCES users(id)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS ledger (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), entry_type TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL, description TEXT NOT NULL, related_type TEXT, related_id BIGINT,
    actor_id BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query('CREATE INDEX IF NOT EXISTS idx_deposits_status_created ON deposits(status, created_at DESC)');
  await query('CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created ON withdrawals(status, created_at DESC)');
  await query('CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger(user_id, created_at DESC)');

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const exists = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (!exists.rowCount) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await query("INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'admin')", ['Administrateur JK CAPITAL', email, hash]);
      console.log(`Initial admin created: ${email}`);
    }
  }
  if (DEMO_MODE) {
    const exists = await query("SELECT id FROM users WHERE email='client@jkcapital.test'");
    if (!exists.rowCount) {
      const hash = await bcrypt.hash('Demo123!', 12);
      const user = await query("INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'client') RETURNING id", ['Client Démonstration', 'client@jkcapital.test', hash]);
      const uid = user.rows[0].id;
      await query("INSERT INTO ledger(user_id,entry_type,amount,description,actor_id) VALUES($1,'demo_credit',2500,'Solde initial fictif — démonstration',NULL)", [uid]);
      await query("INSERT INTO deposits(user_id,amount,status,note) VALUES($1,150,'pending','Dépôt fictif pour tester le parcours')", [uid]);
      await query("INSERT INTO withdrawals(user_id,amount,status,note) VALUES($1,40,'pending','Retrait fictif pour tester le parcours')", [uid]);
      console.log('Demo client created: client@jkcapital.test / Demo123!');
    }
  }
}

async function getBalances(userId) {
  const result = await query(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS balance FROM ledger WHERE user_id=$1`, [userId]);
  return Number(result.rows[0].balance);
}
async function getReserved(userId) {
  const result = await query("SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS reserved FROM withdrawals WHERE user_id=$1 AND status='pending'", [userId]);
  return Number(result.rows[0].reserved);
}
async function getAvailable(userId) { return Math.round((await getBalances(userId) - await getReserved(userId)) * 100) / 100; }

app.get('/health', async (req, res) => {
  try { await query('SELECT 1'); res.json({ status: 'ok', mode: DEMO_MODE ? 'demo' : 'test-configured', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});
app.get('/', (req, res) => req.session.user ? res.redirect(req.session.user.role === 'admin' ? '/admin' : '/dashboard') : res.render('landing', { title: 'JK CAPITAL' }));
app.get('/register', (req, res) => res.render('register', { title: 'Créer un compte', error: null }));
app.post('/register', loginLimiter, csrf, async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (DEMO_MODE === false && process.env.PUBLIC_REGISTRATION === 'false') return res.status(403).render('error', { title: 'Inscriptions fermées', message: 'Les inscriptions sont temporairement fermées.' });
    if (fullName.length < 2 || fullName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 100) {
      return res.status(400).render('register', { title: 'Créer un compte', error: 'Vérifie ton nom, ton e-mail et utilise un mot de passe d’au moins 10 caractères.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const user = await query("INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'client') RETURNING id,full_name,email,role", [fullName, email, hash]);
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = user.rows[0];
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      flash(req, 'success', 'Compte de test créé. Aucun paiement réel n’est activé.');
      res.redirect('/dashboard');
    });
  } catch (e) {
    if (e.code === '23505') return res.status(400).render('register', { title: 'Créer un compte', error: 'Cette adresse e-mail possède déjà un compte.' });
    next(e);
  }
});
app.get('/login', (req, res) => res.render('login', { title: 'Connexion', error: null }));
app.post('/login', loginLimiter, csrf, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const result = await query('SELECT id,full_name,email,password_hash,role,is_active FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).render('login', { title: 'Connexion', error: 'Adresse e-mail ou mot de passe incorrect.' });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { id: user.id, full_name: user.full_name, email: user.email, role: user.role };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
    });
  } catch (e) { next(e); }
});
app.post('/logout', csrf, (req, res, next) => req.session.destroy(err => err ? next(err) : res.redirect('/')));

app.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    if (req.session.user.role === 'admin') return res.redirect('/admin');
    const uid = req.session.user.id;
    const [balance, reserved, deposits, withdrawals, ledger] = await Promise.all([
      getBalances(uid), getReserved(uid),
      query('SELECT * FROM deposits WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8', [uid]),
      query('SELECT * FROM withdrawals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8', [uid]),
      query('SELECT * FROM ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8', [uid])
    ]);
    res.render('dashboard', { title: 'Mon espace', balance, reserved, available: Math.round((balance-reserved)*100)/100, deposits: deposits.rows, withdrawals: withdrawals.rows, ledger: ledger.rows });
  } catch (e) { next(e); }
});
app.post('/deposits', requireAuth, csrf, async (req, res, next) => {
  try {
    if (req.session.user.role !== 'client') return res.redirect('/admin');
    const amount = validAmount(req.body.amount);
    if (!amount) { flash(req, 'error', 'Montant invalide. Saisis un montant positif.'); return res.redirect('/dashboard'); }
    await query("INSERT INTO deposits(user_id,amount,note) VALUES($1,$2,'Demande fictive — aucun paiement externe')", [req.session.user.id, amount]);
    flash(req, 'success', 'Demande de dépôt de test enregistrée. Aucun paiement n’a été lancé.');
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});
app.post('/withdrawals', requireAuth, csrf, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.session.user.role !== 'client') return res.redirect('/admin');
    const amount = validAmount(req.body.amount);
    if (!amount) { flash(req, 'error', 'Montant invalide.'); return res.redirect('/dashboard'); }
    await client.query('BEGIN');
    const bal = await client.query('SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS balance FROM ledger WHERE user_id=$1', [req.session.user.id]);
    const resv = await client.query("SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS reserved FROM withdrawals WHERE user_id=$1 AND status='pending'", [req.session.user.id]);
    if (Number(bal.rows[0].balance) - Number(resv.rows[0].reserved) < amount) {
      await client.query('ROLLBACK'); flash(req, 'error', 'Solde disponible insuffisant pour cette demande.'); return res.redirect('/dashboard');
    }
    await client.query("INSERT INTO withdrawals(user_id,amount,note) VALUES($1,$2,'Demande fictive — aucun virement ne sera effectué')", [req.session.user.id, amount]);
    await client.query('COMMIT');
    flash(req, 'success', 'Demande de retrait de test enregistrée pour examen par l’administrateur.');
    res.redirect('/dashboard');
  } catch (e) { await client.query('ROLLBACK').catch(()=>{}); next(e); }
  finally { client.release(); }
});

app.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const [stats, clients, deposits, withdrawals, ledger] = await Promise.all([
      query(`SELECT (SELECT COUNT(*) FROM users WHERE role='client')::int AS clients,
        (SELECT COUNT(*) FROM deposits WHERE status='pending')::int AS pending_deposits,
        (SELECT COUNT(*) FROM withdrawals WHERE status='pending')::int AS pending_withdrawals,
        (SELECT COALESCE(SUM(amount),0) FROM ledger)::numeric(14,2) AS ledger_total`),
      query(`SELECT u.id,u.full_name,u.email,u.created_at,COALESCE(l.balance,0)::numeric(14,2) AS balance,
        COALESCE(w.reserved,0)::numeric(14,2) AS reserved FROM users u
        LEFT JOIN (SELECT user_id,SUM(amount) balance FROM ledger GROUP BY user_id) l ON l.user_id=u.id
        LEFT JOIN (SELECT user_id,SUM(amount) reserved FROM withdrawals WHERE status='pending' GROUP BY user_id) w ON w.user_id=u.id
        WHERE u.role='client' ORDER BY u.created_at DESC LIMIT 100`),
      query('SELECT d.*,u.full_name,u.email FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY CASE WHEN d.status=\'pending\' THEN 0 ELSE 1 END,d.created_at DESC LIMIT 100'),
      query('SELECT w.*,u.full_name,u.email FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY CASE WHEN w.status=\'pending\' THEN 0 ELSE 1 END,w.created_at DESC LIMIT 100'),
      query('SELECT l.*,u.full_name,u.email FROM ledger l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 100')
    ]);
    res.render('admin', { title: 'Administration', stats: stats.rows[0], clients: clients.rows, deposits: deposits.rows, withdrawals: withdrawals.rows, ledger: ledger.rows });
  } catch (e) { next(e); }
});
app.post('/admin/deposits/:id/:action', requireAdmin, csrf, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id, action } = req.params;
    if (!['approve','reject'].includes(action)) return res.status(400).send('Action invalide');
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount || found.rows[0].status !== 'pending') { await client.query('ROLLBACK'); flash(req,'error','Cette demande a déjà été traitée.'); return res.redirect('/admin'); }
    const d = found.rows[0];
    const status = action === 'approve' ? 'approved' : 'rejected';
    await client.query('UPDATE deposits SET status=$1,reviewed_at=NOW(),reviewed_by=$2 WHERE id=$3', [status, req.session.user.id, id]);
    if (action === 'approve') await client.query("INSERT INTO ledger(user_id,entry_type,amount,description,related_type,related_id,actor_id) VALUES($1,'demo_deposit',$2,$3,'deposit',$4,$5)", [d.user_id, d.amount, `Crédit de démonstration — dépôt #${id}`, id, req.session.user.id]);
    await client.query('COMMIT');
    flash(req,'success', action === 'approve' ? 'Dépôt de test approuvé et crédité au solde fictif.' : 'Demande de dépôt rejetée.');
    res.redirect('/admin');
  } catch (e) { await client.query('ROLLBACK').catch(()=>{}); next(e); }
  finally { client.release(); }
});
app.post('/admin/withdrawals/:id/:action', requireAdmin, csrf, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id, action } = req.params;
    if (!['paid','reject'].includes(action)) return res.status(400).send('Action invalide');
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount || found.rows[0].status !== 'pending') { await client.query('ROLLBACK'); flash(req,'error','Cette demande a déjà été traitée.'); return res.redirect('/admin'); }
    const w = found.rows[0];
    if (action === 'paid') {
      const reference = String(req.body.reference || '').trim();
      if (reference.length < 3 || reference.length > 120) { await client.query('ROLLBACK'); flash(req,'error','Pour ce test, indique une référence fictive de 3 à 120 caractères.'); return res.redirect('/admin'); }
      const bal = await client.query('SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS balance FROM ledger WHERE user_id=$1', [w.user_id]);
      if (Number(bal.rows[0].balance) < Number(w.amount)) { await client.query('ROLLBACK'); flash(req,'error','Solde insuffisant : retrait non traité.'); return res.redirect('/admin'); }
      await client.query("UPDATE withdrawals SET status='paid',payout_reference=$1,note='Marqué comme payé en simulation — aucun virement réel',reviewed_at=NOW(),reviewed_by=$2 WHERE id=$3", [reference, req.session.user.id, id]);
      await client.query("INSERT INTO ledger(user_id,entry_type,amount,description,related_type,related_id,actor_id) VALUES($1,'demo_withdrawal',-$2,$3,'withdrawal',$4,$5)", [w.user_id, w.amount, `Débit fictif du retrait #${id} — référence ${reference}`, id, req.session.user.id]);
    } else {
      await client.query("UPDATE withdrawals SET status='rejected',note='Demande rejetée en simulation',reviewed_at=NOW(),reviewed_by=$1 WHERE id=$2", [req.session.user.id, id]);
    }
    await client.query('COMMIT');
    flash(req,'success', action === 'paid' ? 'Retrait marqué comme payé en simulation. Aucun virement réel n’a été effectué.' : 'Demande de retrait rejetée.');
    res.redirect('/admin');
  } catch (e) { await client.query('ROLLBACK').catch(()=>{}); next(e); }
  finally { client.release(); }
});
app.post('/admin/clients/:id/adjust', requireAdmin, csrf, async (req, res, next) => {
  try {
    const amount = validAmount(req.body.amount);
    const direction = req.body.direction === 'debit' ? -1 : 1;
    const reason = String(req.body.reason || '').trim();
    if (!amount || reason.length < 5 || reason.length > 200) { flash(req,'error','Montant invalide ou motif trop court (5 caractères minimum).'); return res.redirect('/admin'); }
    const user = await query("SELECT id FROM users WHERE id=$1 AND role='client'", [req.params.id]);
    if (!user.rowCount) { flash(req,'error','Client introuvable.'); return res.redirect('/admin'); }
    if (direction < 0 && await getAvailable(req.params.id) < amount) { flash(req,'error','Solde disponible insuffisant après prise en compte des retraits en attente.'); return res.redirect('/admin'); }
    await query('INSERT INTO ledger(user_id,entry_type,amount,description,actor_id) VALUES($1,$2,$3,$4,$5)', [req.params.id, direction < 0 ? 'admin_debit' : 'admin_credit', amount * direction, `Ajustement manuel de test : ${reason}`, req.session.user.id]);
    flash(req,'success','Ajustement fictif enregistré dans le journal comptable.'); res.redirect('/admin');
  } catch (e) { next(e); }
});
app.post('/admin/demo-daily-credit', requireAdmin, csrf, async (req, res, next) => {
  try {
    if (!DEMO_MODE) { flash(req,'error','Cette fonction est désactivée hors mode démo.'); return res.redirect('/admin'); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const users = await client.query("SELECT u.id,COALESCE(SUM(l.amount),0)::numeric(14,2) AS balance FROM users u LEFT JOIN ledger l ON l.user_id=u.id WHERE u.role='client' GROUP BY u.id");
      for (const u of users.rows) {
        const base = Number(u.balance);
        const credit = Math.round(base * 0.01 * 100) / 100;
        if (credit > 0) await client.query("INSERT INTO ledger(user_id,entry_type,amount,description,actor_id) VALUES($1,'demo_simulated_return',$2,'Rendement simulé de 1 % — test uniquement',$3)", [u.id, credit, req.session.user.id]);
      }
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    flash(req,'success','Simulation terminée : crédit fictif de 1 % ajouté aux soldes de test. Aucun rendement réel n’existe.'); res.redirect('/admin');
  } catch (e) { next(e); }
});
app.get('/privacy', (req,res)=>res.render('privacy',{title:'Confidentialité et limites'}));
app.use((req,res)=>res.status(404).render('error',{title:'Page introuvable',message:'Cette page n’existe pas.'}));
app.use((err,req,res,next)=>{
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error',{title:'Erreur technique',message:'Une erreur est survenue. Réessaie ou consulte les journaux du serveur.'});
});

initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`JK CAPITAL test app listening on ${PORT}; DEMO_MODE=${DEMO_MODE}`));
}).catch(err => { console.error('Database initialization failed:', err); process.exit(1); });
