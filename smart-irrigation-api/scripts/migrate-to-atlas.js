/**
 * One-time migration: copy EVERY collection from the local MongoDB into Atlas.
 *
 *   node scripts/migrate-to-atlas.js
 *
 * Reads the source/target URIs from the constants below. Safe to re-run: it
 * upserts by _id, so existing documents are overwritten, never duplicated.
 * Requires only the backend's own mongodb driver (no mongodump needed).
 */
const { MongoClient } = require('mongodb');

const LOCAL_URI = 'mongodb://localhost:27017/smart_irrigation';
const ATLAS_URI = process.env.ATLAS_URI ||
  'mongodb+srv://dridimeding15_db_user:VplvNV4hHlEUnKQL@aquaversedb.c0lbgdb.mongodb.net/smart_irrigation?retryWrites=true&w=majority&appName=AquaVerseDB';

(async () => {
  console.log('→ connecting to local…');
  const local = await MongoClient.connect(LOCAL_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('→ connecting to Atlas…');
  const atlas = await MongoClient.connect(ATLAS_URI, { serverSelectionTimeoutMS: 15000 });

  const src = local.db();
  const dst = atlas.db();
  const cols = (await src.listCollections().toArray()).filter(c => !c.name.startsWith('system.'));

  let grand = 0;
  for (const { name } of cols) {
    const docs = await src.collection(name).find().toArray();
    if (!docs.length) { console.log(`  ${name}: empty — skipped`); continue; }
    // sensorreadings is a time-series collection → insert (no _id upserts allowed)
    let done = 0;
    try {
      const ops = docs.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }));
      const r = await dst.collection(name).bulkWrite(ops, { ordered: false });
      done = r.upsertedCount + r.modifiedCount + r.matchedCount;
    } catch (e) {
      // fallback for time-series / unsupported upserts: plain insert, ignore dupes
      try {
        const r = await dst.collection(name).insertMany(docs, { ordered: false });
        done = r.insertedCount;
      } catch (e2) { done = e2.result?.insertedCount ?? 0; }
    }
    grand += done;
    console.log(`  ${name}: ${done}/${docs.length} migrated`);
  }

  console.log(`✓ done — ${grand} documents now in Atlas (${dst.databaseName})`);
  await local.close(); await atlas.close();
})().catch((e) => { console.error('✗ migration failed:', e.message); process.exit(1); });
