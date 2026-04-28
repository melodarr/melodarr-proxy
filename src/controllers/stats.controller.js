const metrics = require('../metrics')

function getStats (req, res) {
  res.json(metrics.getStats())
}

function getHistory (req, res) {
  res.json({ history: metrics.getHistory() })
}

module.exports = { getStats, getHistory }
