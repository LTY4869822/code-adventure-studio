import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const project = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)))
const source = path.join(project, 'site')
const destination = path.join(project, 'dist')
const sourceInfo = await fs.lstat(source)
if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink() || await fs.realpath(source) !== source) {
  throw new Error('The original site source must be a real directory inside this project')
}
await fs.access(path.join(source, 'index.html'))

async function files(directory) {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Refusing a symlink in the static site: ${target}`)
    if (entry.isDirectory()) result.push(...await files(target))
    else if (entry.isFile()) result.push(target)
  }
  return result
}
const inputs = await files(source)
let existing = null
try { existing = await fs.lstat(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (existing) {
  const resolved = await fs.realpath(destination)
  if (!existing.isDirectory() || existing.isSymbolicLink() || resolved !== destination || path.dirname(resolved) !== project || path.basename(resolved) !== 'dist') {
    throw new Error('Refusing to remove a build directory outside this exact project/dist')
  }
  // The resolved target is checked before this one bounded recursive deletion.
  await fs.rm(resolved, { recursive: true, force: true })
}
await fs.cp(source, destination, { recursive: true, preserveTimestamps: true, dereference: false })
const outputs = await files(destination)
assert.equal(outputs.length, inputs.length, 'Build must contain exactly the original site files plus the link bridge')
for (const input of inputs) {
  const output = path.join(destination, path.relative(source, input))
  assert.ok((await fs.readFile(input)).equals(await fs.readFile(output)), `Copied bytes differ: ${path.relative(source, input)}`)
}
console.log(`Original static site copied without bundling: ${inputs.length} files, every byte verified.`)
