require('dotenv').config();
const http = require('http');
const app  = require('./app');
const { connectMongo }  = require('./config/database');
const { initMQTT }      = require('./mqtt/mqttClient');
const { initSocket }    = require('./socket/socketServer');
const { startJobs }     = require('./jobs');
const logger            = require('./utils/logger');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

(async () => {
  try {
    await connectMongo();   // MongoDB (primary + time-series)
    initMQTT();
    initSocket(server);
    startJobs();
    server.listen(PORT, () =>
      logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV}]`)
    );
  } catch (err) {
    logger.error('Startup failed:', err);
    process.exit(1);
  }
})();

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err);
  if (process.env.NODE_ENV === 'production') {
    server.close(() => process.exit(1));
  }
  // in development, just log and keep running
});
