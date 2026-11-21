const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }

let threshold = LEVELS.info

export function setLevel(level) {
  if (LEVELS[level] !== undefined) threshold = LEVELS[level]
}

function emit(level, msg, meta) {
  if (LEVELS[level] > threshold) return
  const line = {
    t: new Date().toISOString(),
    lvl: level,
    msg,
    ...(meta && typeof meta === 'object' ? meta : meta ? { detail: meta } : {}),
  }
  const out = JSON.stringify(line)
  if (level === 'error') process.stderr.write(out + '\n')
  else process.stdout.write(out + '\n')
}

export const log = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
}
