#!/usr/bin/env node
'use strict'

const http = require('http')

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
  })
}

function postPermissionRequest(body) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 18923,
      path: '/permission-request',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 300000,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve({ decision: 'allow' })
        }
      })
    })
    req.on('error', () => resolve({ decision: 'allow' }))
    req.on('timeout', () => { req.destroy(); resolve({ decision: 'allow' }) })
    req.write(body)
    req.end()
  })
}

async function main() {
  const input = await readStdin()
  const response = await postPermissionRequest(input)
  process.stdout.write(JSON.stringify(response))
}

main()
