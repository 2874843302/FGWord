const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Fresh checkouts have no personal files. Absence is part of the snapshot too:
// a fixture unexpectedly creating one will fail the before/after comparison.
function hashFile(file) {
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
}

function snapshotProductionData(root) {
  return ['words.json', 'settings.json'].map(name => hashFile(path.join(root, 'data', name)))
}

module.exports = { hashFile, snapshotProductionData }
