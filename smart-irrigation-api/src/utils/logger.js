const { createLogger, format, transports } = require('winston');
const { combine, timestamp, colorize, printf, errors } = format;
const fmt = printf(({ level, message, timestamp, stack }) =>
  stack ? `${timestamp} [${level}]: ${message}\n${stack}`
        : `${timestamp} [${level}]: ${message}`);

module.exports = createLogger({
  // production shows info+ (boot confirmations, broker connects, commands) but
  // NOT debug (per-packet telemetry/heartbeat chatter). Override with LOG_LEVEL.
  level:  process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  silent: process.env.NODE_ENV === 'test',
  format: combine(errors({ stack:true }), timestamp({ format:'HH:mm:ss' }), fmt),
  transports: [
    new transports.Console({ format: combine(colorize(), timestamp({ format:'HH:mm:ss' }), fmt) }),
    new transports.File({ filename:'logs/error.log',    level:'error' }),
    new transports.File({ filename:'logs/combined.log' }),
  ],
});
