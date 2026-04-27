const metrics = require('../metrics');

function getStats(req, res) {
  res.json(metrics.getStats());
}

module.exports = { getStats };
