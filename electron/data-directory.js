'use strict'

const fs = require('fs')
const path = require('path')

function initializeDataDirectory({ override, packaged, projectDir, userDataDir, defaultsDir, primary = true }) {
  let directory = override ? path.resolve(override) : packaged ? path.join(userDataDir, 'word-glass-data') : path.join(projectDir, 'data')
  try { fs.mkdirSync(directory, { recursive: true }) }
  catch (error) {
    if (override || packaged) throw error
    directory = path.join(userDataDir, 'word-glass-data')
    fs.mkdirSync(directory, { recursive: true })
  }
  const words = path.join(directory, 'words.json')
  if (primary && packaged && !fs.existsSync(words)) {
    fs.copyFileSync(path.join(defaultsDir, 'words.json'), words, fs.constants.COPYFILE_EXCL)
  }
  return directory
}

module.exports = { initializeDataDirectory }
