#!/usr/bin/env node
const { spawn, execFileSync } = require('node:child_process')
const { createServer, connect } = require('node:net')
const { mkdirSync, writeFileSync, readFileSync, appendFileSync } = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')

const root = path.resolve(__dirname, '../../../..')
const frontend = path.join(root, 'frontend')
const frontendRequire = createRequire(path.join(frontend, 'package.json'))
const features = {
  auth: { files: ['signup-onboarding.e2e.ts', 'select-switch.e2e.ts', 'onboarding-start.e2e.ts', 'onboarding-design.e2e.ts', 'restore.e2e.ts', 'password-reset.e2e.ts', 'login-return.e2e.ts', 'auth-limits.e2e.ts'] },
  meetings: { files: ['meeting-flow.e2e.ts'] },
  tasks: { files: ['tasks-approval.e2e.ts'], grep: '회의록의 확인 필요 항목|일반 팀원이 승인 URL|키보드 — 목록 탭' },
  dashboard: { files: ['dashboard.e2e.ts'] },
  connections: { files: ['settings-team.e2e.ts'], grep: 'PM 이 설정에서 Discord' },
  notifications: { files: ['settings-notifications.e2e.ts'] },
  messages: { files: ['messages-reminder.e2e.ts', 'messages-reply.e2e.ts', 'messages-approve.e2e.ts', 'reply-judgment.e2e.ts'] },
}

async function unusedPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function portOpen(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}

async function main() {
  const [command, feature, option, grep] = process.argv.slice(2)
  if (command === 'list' && !feature) {
    console.log(JSON.stringify(features, null, 2))
    return
  }
  if (command === 'doctor' && feature && !option) {
    if (!/^[\w-]+$/.test(feature)) throw new Error('Use the run ID printed by run.')
    const evidence = path.join(root, '.verify', 'managers-manager', feature)
    const metadata = JSON.parse(readFileSync(path.join(evidence, 'run.json'), 'utf8'))
    process.kill(metadata.runnerPid, 0)
    await require('./doctor.cjs').inspect(metadata.baseURL, evidence)
    return
  }
  if (command !== 'run' || !Object.hasOwn(features, feature) ||
      (option !== undefined && (option !== '--grep' || !grep)) || process.argv.length > 6) {
    throw new Error('Usage: node verify.cjs list | run <auth|meetings|tasks|dashboard|connections|notifications|messages> [--grep <regex>] | doctor <run-id>')
  }
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Frontend requires Node 24.x.')
  const cli = frontendRequire.resolve('@playwright/test/cli')
  const port = await unusedPort()
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${feature}-${randomUUID().slice(0, 8)}`
  const evidence = path.join(root, '.verify', 'managers-manager', runId)
  mkdirSync(evidence, { recursive: true })
  const selection = features[feature]
  const filter = grep ?? selection.grep
  const args = [cli, 'test', '--config', path.join(__dirname, 'playwright.config.cjs'), ...selection.files]
  if (filter) args.push('--grep', filter)
  const metadata = {
    runId, feature, files: selection.files, grep: filter ?? null,
    baseURL: `http://127.0.0.1:${port}`, port, runnerPid: process.pid,
    root, node: process.version, mode: 'MSW',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }),
    command: [process.execPath, ...args],
  }
  writeFileSync(path.join(evidence, 'run.json'), JSON.stringify(metadata, null, 2))
  console.log(`Run ID: ${runId}\nEvidence: ${evidence}`)
  const child = spawn(process.execPath, args, {
    cwd: frontend,
    env: { ...process.env, E2E_PORT: String(port), VERIFY_EVIDENCE: evidence, CI: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  const log = path.join(evidence, 'console.log')
  for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', chunk => { appendFileSync(log, chunk); destination.write(chunk) })
  }
  // Windows cannot forward POSIX signals. Stop only this owned process tree there.
  // On POSIX, the dedicated process group includes Vite and Chromium descendants.
  let interrupted = false
  let killTimer
  let termination = Promise.resolve()
  const interrupt = () => {
    if (interrupted || child.exitCode !== null || child.signalCode !== null) return
    interrupted = true
    if (process.platform === 'win32') {
      termination = new Promise((resolve, reject) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.once('error', reject)
        killer.once('exit', resolve)
      })
      return
    }
    process.kill(-child.pid, 'SIGINT')
    killTimer ??= setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return
      process.kill(-child.pid, 'SIGKILL')
    }, 10000)
  }
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  let code
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', value => resolve(value ?? 1))
    })
  } finally {
    await termination
    clearTimeout(killTimer)
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
    const cleanup = { checkedAt: new Date().toISOString(), port, portOpen: await portOpen(port) }
    writeFileSync(path.join(evidence, 'cleanup.json'), JSON.stringify(cleanup, null, 2))
    if (cleanup.portOpen) throw new Error(`Port ${port} is still open. Inspect console.log and the owned terminal; do not kill by process name.`)
  }
  if (code === 0 && !interrupted) {
    const report = JSON.parse(readFileSync(path.join(evidence, 'results.json'), 'utf8'))
    if (report.stats.expected < 1 || report.stats.unexpected || report.stats.skipped || report.stats.flaky) {
      throw new Error('Proof requires at least one passed test, no skipped/flaky/failed tests.')
    }
  }
  process.exitCode = interrupted ? 130 : code
}

main().catch(error => { console.error(error); process.exitCode = 1 })
