const mongoose = require('mongoose');
const logger   = require('../utils/logger');

exports.connectMongo = async () => {
  mongoose.set('strictQuery', true);

  // Retry rather than die. A momentary DNS or routing hiccup should not leave
  // the API permanently down waiting for someone to notice and restart it —
  // especially with nodemon, which does not restart a crashed process.
  const attempts = 5;
  for (let i = 1; i <= attempts; i++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        // Force IPv4. Node may resolve Atlas to a NAT64 IPv6 address
        // (64:ff9b::…) on networks that cannot route it, producing
        // ENETUNREACH alongside a timeout even while IPv4 works fine.
        family: 4,
      });
      break;
    } catch (e) {
      if (i === attempts) throw e;
      const wait = i * 3000;
      logger.warn(`MongoDB connect failed (${i}/${attempts}): ${e.message} — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  logger.info('MongoDB connected');
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (e) => logger.error('MongoDB error:', e));

  // Create MongoDB time-series collection for sensor readings (once)
  await ensureTimeSeriesCollection();
};

async function ensureTimeSeriesCollection() {
  const db = mongoose.connection.db;
  const collections = await db.listCollections({ name: 'sensor_readings' }).toArray();
  if (!collections.length) {
    await db.createCollection('sensor_readings', {
      timeseries: {
        timeField:   'ts',
        metaField:   'meta',
        granularity: 'seconds',
      },
      expireAfterSeconds: 60 * 60 * 24 * 365, // auto-delete after 1 year
    });
    logger.info('MongoDB time-series collection "sensor_readings" created');
  }
}
