import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(path.join(project, 'package-lock.json'), 'utf8'))
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'The restored studio must have zero npm runtime dependencies')
assert.equal(Object.keys(lock.packages[''].dependencies ?? {}).length, 0, 'The lockfile root must have no runtime dependencies')
assert.deepEqual(Object.keys(pkg.devDependencies ?? {}), ['vite'], 'Only Vite is needed for the local dev/preview server')
assert.match(pkg.devDependencies.vite, /^\d+\.\d+\.\d+$/, 'Keep the local server version pinned')
for (const name of ['three', 'gsap', 'postprocessing', '@react-three/fiber', 'react', 'react-dom', 'lucide', 'lucide-react', 'motion', 'motion-dom', 'framer-motion', 'zustand']) {
  const locations = Object.keys(lock.packages).filter(location => location === `node_modules/${name}` || location.endsWith(`/node_modules/${name}`))
  assert.equal(locations.length, 0, `${name} must not be installed beside the original static frontend`)
}
function javascript(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? javascript(file) : entry.isFile() && /\.[cm]?js$/i.test(file) ? [file] : []
  })
}
const files = javascript(path.join(project, 'site'))
const implementations = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (text.includes('Multiple instances of Three.js being imported.')) implementations.push(file)
  if (path.basename(file) === 'starflow.js') continue
  const imports = [
    ...text.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g),
    ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
  ]
  for (const match of imports) assert.ok(match[1].startsWith('./') || match[1].startsWith('../'), `Static source must use local modules: ${file} imports ${match[1]}`)
}
assert.equal(implementations.length, 1, 'There must be exactly one supplied Three implementation')
assert.equal(path.basename(implementations[0]), 'starflow.js')
const vendor = readFileSync(path.join(project, 'site/starflow.js'))
assert.equal(createHash('sha256').update(vendor).digest('hex'), '27bfebcc063b873aeb64a1ddc3e4d728b5afc0af5b66fc74720b2e0e7dfc6d0d', 'The vendor must match the uploaded original ZIP byte for byte')
assert.match(vendor.toString('utf8'), /^const e="180"/, 'The supplied vendor contains Three r180')
console.log('Dependency policy passed: zero npm runtime dependencies, original vendor bytes, one supplied Three r180 implementation, local static modules only.')
