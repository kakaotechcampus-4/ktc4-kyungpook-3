import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const frontend = join(import.meta.dirname, '..', '..', '..')
export const cache = join(frontend, 'node_modules', '.cache', 'font-bench')
mkdirSync(join(cache, 'shots'), { recursive: true })

export const variants = ['A', 'B', 'C', 'C2', 'D', 'E']
export const h1Ports = { A: 43521, B: 43522, C: 43523, C2: 43524, D: 43525, E: 43526 }
export const h2Ports = { A: 43531, B: 43532, C: 43533, C2: 43534, D: 43535, E: 43536 }
