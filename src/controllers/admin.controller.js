const { createKey, listKeys, deleteKey } = require('../auth/apikeys')

function generateKey (req, res) {
  const { name, quota } = req.body
  if (!name) {
    return res.status(400).json({ error: 'Name is required to generate API key.' })
  }

  const created = createKey(name, quota || 60)
  // Key is only returned once
  return res.json({
    id: created.id,
    key: created.key,
    message: 'API key generated successfully. Please store it safely as it will not be shown again.'
  })
}

function getAllKeys (req, res) {
  const keys = listKeys()
  return res.json({ keys })
}

function revokeKey (req, res) {
  const { key } = req.params
  if (!key) {
    return res.status(400).json({ error: 'Key identifier is required.' })
  }

  const deleted = deleteKey(key)
  if (deleted) {
    return res.json({ message: 'API key revoked successfully.' })
  } else {
    return res.status(404).json({ error: 'API key not found.' })
  }
}

module.exports = {
  generateKey,
  getAllKeys,
  revokeKey
}
