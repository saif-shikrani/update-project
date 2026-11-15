import { spawn, type ChildProcess } from 'node:child_process'

const children: ChildProcess[] = []

function run(args: string[]) {
  const child = spawn('npx', args, { stdio: 'inherit', shell: true })
  children.push(child)
  child.on('exit', (code) => {
    if (code && code !== 0) stop(code)
  })
}

function stop(code = 0) {
  for (const child of children) child.kill()
  process.exit(code)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

run(['tsx', 'watch', 'src/server/index.ts'])
run(['vite'])
