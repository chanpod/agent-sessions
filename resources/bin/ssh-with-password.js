#!/usr/bin/env node
/**
 * Simple wrapper to pass password to SSH on Windows
 * Usage: node ssh-with-password.js <password> <ssh-args...>
 */

const { spawn } = require('child_process');

const [,, password, ...sshArgs] = process.argv;

if (!password || sshArgs.length === 0) {
  console.error('Usage: ssh-with-password.js <password> <ssh-args...>');
  process.exit(1);
}

const ssh = spawn('ssh.exe', sshArgs, {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Send password followed by newline
ssh.stdin.write(password + '\n');
ssh.stdin.end();

ssh.stdout.on('data', (data) => {
  process.stdout.write(data);
});

ssh.stderr.on('data', (data) => {
  process.stderr.write(data);
});

ssh.on('close', (code) => {
  process.exit(code);
});
