const formatMessage = (level, message, meta = {}) => {
  const logObj = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...meta
  };
  return JSON.stringify(logObj);
};

const logger = {
  info: (message, meta) => console.log(formatMessage('info', message, meta)),
  warn: (message, meta) => console.warn(formatMessage('warn', message, meta)),
  error: (message, meta) => console.error(formatMessage('error', message, meta)),
  debug: (message, meta) => {
    if (process.env.DEBUG) {
      console.debug(formatMessage('debug', message, meta));
    }
  }
};

module.exports = logger;
