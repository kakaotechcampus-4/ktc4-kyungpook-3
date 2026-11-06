const r = require(require('path').resolve(process.argv[2]))
console.log('node', r.node, 'rounds', r.rounds)
for (const [k, v] of Object.entries(r)) {
  if (!v.results) continue
  console.log(`\n${k} (tasks ${v.tasks}, approvals ${v.approvals}, meetings ${v.meetings})`)
  for (const [n, s] of Object.entries(v.results))
    console.log(`  ${n.padEnd(24)} ${(s.median / 1000).toFixed(3).padStart(8)} ms  [${(s.min / 1000).toFixed(3)} - ${(s.max / 1000).toFixed(3)}]  x${s.iterations}`)
}
