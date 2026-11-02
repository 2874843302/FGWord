import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

const directory = path.resolve(process.argv[2] || 'release')
const installers = (await fs.readdir(directory)).filter(name => /^WordGlass-Setup-.+-x64\.exe$/.test(name))
if (installers.length !== 1) throw new Error(`Expected one Windows installer, found ${installers.length}`)
for (const name of installers) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk)
  await fs.writeFile(path.join(directory, `${name}.sha256`), `${hash.digest('hex')}  ${name}\n`)
  console.log(`SHA-256 written: ${name}.sha256`)
}
