// Check whether a process has any listening TCP sockets (Linux /proc).
import fs from 'node:fs';

export function listeningSockets(pid) {
  const inodes = new Set();
  try {
    const fds = fs.readdirSync(`/proc/${pid}/fd`);
    for (const fd of fds) {
      try {
        const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
        const m = /^socket:\[(\d+)\]$/.exec(link);
        if (m) inodes.add(m[1]);
      } catch {}
    }
  } catch {
    return [];
  }
  const listening = [];
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        if (parts[3] === '0A' && inodes.has(parts[9])) {
          listening.push({ inode: parts[9], local: parts[1] });
        }
      }
    } catch {}
  }
  return listening;
}
