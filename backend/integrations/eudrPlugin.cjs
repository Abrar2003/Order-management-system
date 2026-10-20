const crypto = require('node:crypto');
const stable = v => v instanceof Date ? v.toISOString() : v?.toHexString ? v.toHexString() : Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const pick = (row, keys) => Object.fromEntries(['_id', ...keys].filter(k => row[k] !== undefined).map(k => [k, row[k]]));
const allowed = u => ['admin','super_admin','manager'].includes(String(u?.role || '').trim().toLowerCase().replace(/[ -]/g, '_'));
const userFields = { name: 1, email: 1, role: 1, allowed_brands: 1, allowed_vendors: 1, brand_scope: 1, is_active: 1, deleted_at: 1 };
function mount(app, { mongoose, auth, express }) {
  const db = () => mongoose.connection.db;
  async function publicUser(raw,scope='all') {
    if(!raw)return null;
    const ids=(raw.allowed_brands||[]).map(b=>b?._id||b);
    const entries=ids.length?await db().collection('brands').find({_id:{$in:ids}},{projection:{name:1}}).toArray():[];
    if(entries.length!==ids.length)throw new Error('A restricted brand identity is unresolved');
    return {...raw,allowed_brands:entries,brand_scope:ids.length||(raw.allowed_vendors||[]).some(v=>v!=='all')?'all':['all','dutch','giga'].includes(scope)?scope:'all'};
  }
  const run = fn => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('EUDR bridge:', e.message); res.status(e.statusCode || 503).json({ code: 'OMS_BRIDGE_FAILED', message: 'OMS integration is temporarily unavailable' }); } };
  const secretAuth = (req, res, next) => {
    const want = process.env.EUDR_BRIDGE_SECRET || '', got = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (want.length < 32 || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return res.status(401).json({ message: 'Invalid bridge authentication' });
    next();
  };
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.get('/launch', (req,res,next)=>{
    const json=res.json.bind(res);
    res.json=value=>{if(res.statusCode!==401)return json(value);const signin=new URL(process.env.OMS_SIGNIN_URL||'https://oms.ghouse-sourcing.com/signin');signin.searchParams.set('continue','eudr');return res.redirect(302,signin.href);};
    return auth(req,res,next);
  }, run(async (req, res) => {
    if (!allowed(req.user)) return res.status(403).send('EUDR is restricted to administrators and managers.');
    const code = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const plugin = new URL(process.env.EUDR_PLUGIN_PUBLIC_URL || 'https://oms.ghouse-sourcing.com/eudr-tool/');
    const state=String(req.query.state||'');
    if(!/^[a-f0-9]{48}$/.test(state))return res.status(400).send('Open the EUDR tool first to start a sign-in session.');
    await db().collection('eudr_login_codes').insertOne({ _id: hash(code), state, user_id: String(req.user._id || req.user.id), brand_scope:req.user.brand_scope||'all', expires_at: new Date(Date.now() + 60000) });
    // POST the code so it never becomes a browser-history or reverse-proxy query string.
    res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${plugin.origin}`);
    res.set('Referrer-Policy', 'no-referrer').type('html').send(`<form method="post" action="${plugin.href.replace(/\/$/,'')}/api/auth/callback"><input type="hidden" name="code" value="${code}"><input type="hidden" name="state" value="${state}"><button>Continue to EUDR</button></form><script nonce="${nonce}">document.forms[0].submit()</script>`);
  }));
  router.use(secretAuth);
  router.post('/redeem', run(async (req, res) => {
    const code = String(req.body.code || '');
    if (!/^[a-f0-9]{64}$/.test(code)) return res.status(401).json({ message: 'Invalid sign-in code' });
    const record = await db().collection('eudr_login_codes').findOneAndDelete({ _id: hash(code),state:String(req.body.state||''), expires_at: { $gt: new Date() } });
    if (!record) return res.status(401).json({ message: 'Sign-in code expired or was already used' });
    const user = await db().collection('users').findOne({ _id: new mongoose.Types.ObjectId(record.user_id) }, { projection: userFields });
    if (!allowed(user) || user.is_active === false || user.deleted_at) return res.status(403).json({ message: 'EUDR access denied' });
    res.json({ user:await publicUser(user,record.brand_scope) });
  }));
  router.get('/users/:id', run(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user' });
    const user = await db().collection('users').findOne({ _id: new mongoose.Types.ObjectId(req.params.id) }, { projection: userFields });
    if (!allowed(user) || user.is_active === false || user.deleted_at) return res.status(403).json({ message: 'EUDR access denied' });
    res.json({ user:await publicUser(user,req.query.scope) });
  }));
  router.get('/discover', run(async (req, res) => {
    const pattern = new RegExp(String(req.query.search || '').slice(0,80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rows = [];
    for (const collection of ['orders','samples']) {
      const docs = await db().collection(collection).find({ $or: [{ 'shipment.invoice_number': pattern }, { 'shipment.container': pattern }] }, { projection: { vendor: 1, brand: 1, shipment: 1, order_id: 1, code: 1 } }).limit(501).toArray();
      if (docs.length > 500) return res.status(400).json({ code: 'SEARCH_TOO_BROAD', message: 'Narrow the invoice or container search' });
      for (const doc of docs) for (const s of doc.shipment || []) if (Number(s.quantity) > 0 && (pattern.test(s.invoice_number || '') || pattern.test(s.container || ''))) rows.push({ source: collection === 'orders' ? 'order' : 'sample', source_id: doc._id, shipment_id: s._id, invoice_number: s.invoice_number, container: s.container, stuffing_date: s.stuffing_date, vendor: doc.vendor, brand: doc.brand });
    }
    res.json({ rows });
  }));
  router.get('/snapshot', run(async (req, res) => {
    const container = String(req.query.container || '').trim();
    if (!container || container.length > 80) return res.status(400).json({ message: 'Container is required' });
    const exact = new RegExp(`^${container.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const session = await mongoose.startSession();
    let data;
    try { await session.withTransaction(async () => {
      const orders = await db().collection('orders').find({ 'shipment.container': exact }, { session, projection: { vendor: 1, brand: 1, item: 1, order_id: 1, shipment: 1 } }).limit(5001).toArray();
      const samples = await db().collection('samples').find({ 'shipment.container': exact }, { session }).limit(5001).toArray();
      if (orders.length > 5000 || samples.length > 5000) throw new Error('Container exceeds snapshot limit');
      const codes = [...new Set(orders.map(o => o.item?.item_code).filter(Boolean))];
      const items = await db().collection('items').find({ code: { $in: codes } }, { session }).toArray();
      // Vendor directory entries are deliberately limited to fields required by EUDR.
      const vendors = await db().collection('vendors').find({ deleted_at: null }, { session, projection: { name: 1, gst: 1, pan: 1, is_active: 1 } }).limit(10001).toArray();
      if (vendors.length > 10000) throw new Error('Vendor directory exceeds snapshot limit');
      const metadata = ['code','name','description','brand','timber_cft','hs_code','species_composition','timber_cft_history'];
      data = { orders, samples: samples.map(s => pick(s, [...metadata,'vendor','shipment','item_sizes'])), items: items.map(i => pick(i, [...metadata,'pis_item_sizes'])), vendors };
    }, { readConcern: { level: 'snapshot' } }); } finally { await session.endSession(); }
    res.json({ data, hash: hash(data), revision: hash(data), fetched_at: new Date() });
  }));
  router.get('/changes', run(async (req, res) => {
    const after = mongoose.isValidObjectId(req.query.after) ? new mongoose.Types.ObjectId(req.query.after) : new mongoose.Types.ObjectId('000000000000000000000000');
    res.json({ changes: await db().collection('eudr_source_changes').find({ _id: { $gt: after } }).sort({ _id: 1 }).limit(500).toArray() });
  }));
  router.put('/metadata/:source/:id',run(async(req,res)=>{
    const collection={order:'items',sample:'samples'}[req.params.source];
    if(!collection||!mongoose.isValidObjectId(req.params.id)||!mongoose.isValidObjectId(req.body.actor))return res.status(400).json({message:'Invalid source reference'});
    const actor=await db().collection('users').findOne({_id:new mongoose.Types.ObjectId(req.body.actor)},{projection:userFields});
    if(!actor||!['admin','super_admin'].includes(String(actor.role).replace(/[ -]/g,'_').toLowerCase()))return res.status(403).json({message:'SKU metadata changes require an administrator'});
    const row=await db().collection(collection).findOne({_id:new mongoose.Types.ObjectId(req.params.id)});
    if(!row)return res.status(404).json({message:'OMS item was not found'});
    if(hash(pick(row,['timber_cft','hs_code','species_composition','pis_item_sizes','item_sizes']))!==req.body.previous_hash)return res.status(409).json({code:'METADATA_CHANGED',message:'OMS item changed; refresh before saving metadata'});
    const values=req.body.values||{},shares=values.species_composition;
    if(!/^\d{4,8}$/.test(values.hs_code||'')||!Array.isArray(shares)||!shares.length||shares.length>100||shares.some(s=>!mongoose.isValidObjectId(s.species)||!Number.isInteger(s.share_bp)||s.share_bp<1)||shares.reduce((n,s)=>n+s.share_bp,0)!==10000||new Set(shares.map(s=>s.species)).size!==shares.length)return res.status(400).json({message:'Valid HS code and species shares totaling 100% are required'});
    const set={hs_code:values.hs_code,species_composition:shares.map(s=>({species:new mongoose.Types.ObjectId(s.species),share_bp:s.share_bp})),updatedAt:new Date()},push={};
    if(values.timber_cft!=null){const cft=Number(values.timber_cft);if(!Number.isFinite(cft)||cft<0||!Number.isSafeInteger(cft*1000))return res.status(400).json({message:'CFT requires at most three decimal places'});set.timber_cft=cft;if(cft!==row.timber_cft)push.timber_cft_history={from:row.timber_cft??null,to:cft,at:new Date(),by:actor._id};}
    const sizes=collection==='items'?'pis_item_sizes':'item_sizes';
    if(values.net_weights){if(!Array.isArray(values.net_weights)||values.net_weights.length!==row[sizes]?.length||values.net_weights.some(v=>!Number.isFinite(v)||v<=0))return res.status(400).json({message:'Supply one positive net weight for each existing package'});values.net_weights.forEach((v,i)=>{set[`${sizes}.${i}.net_weight`]=v;});}
    const outcome=await db().collection(collection).updateOne({_id:row._id,updatedAt:row.updatedAt},{$set:set,...(Object.keys(push).length?{$push:push}:{})});
    if(outcome.matchedCount!==1)return res.status(409).json({message:'OMS item changed concurrently; reload'});
    await db().collection('eudr_source_changes').insertOne({collection,source_id:String(row._id),at:new Date(),actor:actor._id,event:'eudr_metadata_changed'});
    res.json({saved:true});
  }));
  app.use('/integrations/eudr', router);
  app.use('/eudr', async (req, res, next) => {
    try {
      if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
      const state = await db().collection('eudr_plugin_ownership').findOne({ _id: 'global' });
      if (!state || state.owner !== 'standalone') return next();
      res.status(409).json({ code: 'EUDR_MOVED', message: 'EUDR is now managed in the standalone tool. No changes were saved.' });
    } catch { res.status(503).json({message:'EUDR ownership could not be checked; no changes were saved'}); }
  });
  // Resume-token checkpoint and invalidation log survive OMS restarts.
  let stopped = false;
  async function watch() {
    while (!stopped) {
      try {
        const checkpoint = await db().collection('eudr_bridge_state').findOne({ _id: 'source-watch' });
        const stream = db().watch([{ $match: { 'ns.coll': { $in: ['orders','samples','items','vendors','users'] } } }], checkpoint?.token ? { resumeAfter: checkpoint.token } : {});
        for await (const change of stream) {
          await db().collection('eudr_source_changes').insertOne({ collection: change.ns.coll, source_id: String(change.documentKey._id), at: new Date() });
          await db().collection('eudr_bridge_state').updateOne({ _id: 'source-watch' }, { $set: { token: change._id } }, { upsert: true });
        }
      } catch (e) {
        if ([260,286].includes(e.code)) { await db().collection('eudr_bridge_state').deleteOne({ _id: 'source-watch' }); await db().collection('eudr_source_changes').insertOne({ collection: 'all', at: new Date() }); }
        console.error('EUDR source watcher unavailable:', e.code || e.name);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }
  mongoose.connection.once('open', () => {
    db().collection('eudr_login_codes').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }).catch(console.error);
    watch().catch(console.error);
  });
  return { stop: () => { stopped = true; } };
}
module.exports = { mount, hash, stable, allowed, pick };
