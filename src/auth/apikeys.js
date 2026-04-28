const logger = require('../utils/logger')
const {
  checkApiKey,
  createApiKey,
  deleteApiKey,
  listApiKeys
} = require('../settings/store')

function createKey (name, quotaPerMinute = 60) {
  const created = createApiKey({ name, quotaPerMinute })
  logger.info(`Created new API key for ${name}`)
  return created
}

function listKeys () {
  return listApiKeys()
}

function deleteKey (id) {
  const deleted = deleteApiKey(id)
  if (deleted) logger.info(`Deleted API key ${id}`)
  return deleted
}

function checkRateLimit (key) {
  return checkApiKey(key)
}

module.exports = {
  createKey,
  listKeys,
  deleteKey,
  checkRateLimit
}
