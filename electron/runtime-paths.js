'use strict'

const path = require('path')

// Native subprocesses cannot read files inside Electron's ASAR archive.
function unpackedPath(file) {
  return file.replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2')
}

function scriptPath(filename) {
  return unpackedPath(path.resolve(__dirname, '../scripts', filename))
}

module.exports = { unpackedPath, scriptPath }
