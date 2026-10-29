/**
 * SmartProctor AI - Background Application & Process Monitor Agent
 * Continuously audits operating system running processes to detect unauthorized
 * applications (Discord, WhatsApp, Telegram, AnyDesk, TeamViewer, OBS, ChatGPT, etc.)
 * and reports infractions in real-time to the SmartProctor AI Proctor Dashboard.
 */

const { exec } = require('child_process');
const http = require('http');

// Configuration
const SERVER_URL = process.env.PROCTOR_SERVER || 'http://localhost:3000';
const CHECK_INTERVAL_MS = 3000; // Check every 3 seconds
let activeSessionId = process.argv[2] || 'sess-stu-101';

// Blacklist of unauthorized applications during examination
const BLACKLIST = [
  { name: 'discord.exe', displayName: 'Discord Communication App', risk: 'HIGH' },
  { name: 'telegram.exe', displayName: 'Telegram Messenger', risk: 'HIGH' },
  { name: 'whatsapp.exe', displayName: 'WhatsApp Desktop', risk: 'HIGH' },
  { name: 'slack.exe', displayName: 'Slack Messenger', risk: 'MEDIUM' },
  { name: 'zoom.exe', displayName: 'Zoom Video Conferencing', risk: 'HIGH' },
  { name: 'teams.exe', displayName: 'Microsoft Teams', risk: 'MEDIUM' },
  { name: 'skype.exe', displayName: 'Skype', risk: 'MEDIUM' },
  { name: 'teamviewer.exe', displayName: 'TeamViewer Remote Desktop', risk: 'CRITICAL' },
  { name: 'anydesk.exe', displayName: 'AnyDesk Remote Control', risk: 'CRITICAL' },
  { name: 'vncviewer.exe', displayName: 'VNC Remote Viewer', risk: 'CRITICAL' },
  { name: 'ultraviewer.exe', displayName: 'UltraViewer Remote Desktop', risk: 'CRITICAL' },
  { name: 'rustdesk.exe', displayName: 'RustDesk Remote Desktop', risk: 'CRITICAL' },
  { name: 'mstsc.exe', displayName: 'Windows Remote Desktop (RDP)', risk: 'CRITICAL' },
  { name: 'obs64.exe', displayName: 'OBS Studio Screen Recorder', risk: 'HIGH' },
  { name: 'obs32.exe', displayName: 'OBS Studio Screen Recorder', risk: 'HIGH' },
  { name: 'cheatengine-x86_64.exe', displayName: 'Cheat Engine Memory Scanner', risk: 'CRITICAL' },
  { name: 'cheatengine.exe', displayName: 'Cheat Engine Memory Scanner', risk: 'CRITICAL' },
  { name: 'chatgpt.exe', displayName: 'ChatGPT Desktop Client', risk: 'HIGH' },
  { name: 'sharex.exe', displayName: 'ShareX Screen Capture', risk: 'MEDIUM' }
];

console.log('===============================================================');
console.log('🛡️  SMARTPROCTOR AI - COMPANION OS PROCESS MONITOR');
console.log('===============================================================');
console.log(`📡 Connected Proctor Server: ${SERVER_URL}`);
console.log(`🎯 Active Candidate Session ID: ${activeSessionId}`);
console.log(`⏱️ Audit Frequency: Every ${CHECK_INTERVAL_MS / 1000} seconds`);
console.log(`📋 Monitored Blacklist Rules: ${BLACKLIST.length} applications`);
console.log('---------------------------------------------------------------');
console.log('🔍 Actively scanning operating system task list...\n');

// Track previously warned processes to prevent alert flooding
const reportedPids = new Set();

function scanRunningProcesses() {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'tasklist /FO CSV /NH' : 'ps -eo pid,comm';

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Error executing process scan:', error.message);
      return;
    }

    const detected = [];
    const lines = stdout.split('\n');

    lines.forEach(line => {
      const cleanLine = line.trim();
      if (!cleanLine) return;

      if (isWindows) {
        // Format: "imagename.exe","pid","session name","session#","mem usage"
        const parts = cleanLine.split('","').map(p => p.replace(/"/g, ''));
        if (parts.length >= 2) {
          const procName = parts[0].toLowerCase();
          const pid = parts[1];

          const matched = BLACKLIST.find(b => b.name.toLowerCase() === procName);
          if (matched) {
            detected.push({
              name: matched.displayName,
              exe: parts[0],
              pid: pid,
              risk: matched.risk
            });
          }
        }
      } else {
        const parts = cleanLine.trim().split(/\s+/);
        if (parts.length >= 2) {
          const pid = parts[0];
          const procName = parts[1].toLowerCase();
          const matched = BLACKLIST.find(b => b.name.toLowerCase().includes(procName));
          if (matched) {
            detected.push({
              name: matched.displayName,
              exe: parts[1],
              pid: pid,
              risk: matched.risk
            });
          }
        }
      }
    });

    if (detected.length > 0) {
      // Filter out those already reported in the current burst
      const newDetections = detected.filter(p => !reportedPids.has(p.pid));

      if (newDetections.length > 0) {
        console.log(`\n🚨 [SECURITY BREACH DETECTED] ${new Date().toLocaleTimeString()}`);
        newDetections.forEach(p => {
          console.log(`   ⚠️ App: ${p.name} | Binary: ${p.exe} | PID: ${p.pid} | Severity: ${p.risk}`);
          reportedPids.add(p.pid);
        });

        // Dispatch alert to Proctor Server
        sendAlertToServer(newDetections);
      }
    } else {
      process.stdout.write(`\r[${new Date().toLocaleTimeString()}] ✅ System Integrity Verified. No unauthorized applications detected.`);
    }
  });
}

function sendAlertToServer(unauthorizedProcesses) {
  const payload = JSON.stringify({
    sessionId: activeSessionId,
    unauthorizedProcesses: unauthorizedProcesses
  });

  const urlObj = new URL(SERVER_URL + '/api/proctor/processes');

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || 3000,
    path: '/api/proctor/processes',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = http.request(options, res => {
    if (res.statusCode === 200) {
      console.log('   📡 Violation successfully transmitted to Admin Proctor Dashboard.');
    } else {
      console.log(`   ⚠️ Server responded with status code: ${res.statusCode}`);
    }
  });

  req.on('error', err => {
    console.error(`   ❌ Failed to contact Proctor Server: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

// Start continuous scanning loop
setInterval(scanRunningProcesses, CHECK_INTERVAL_MS);
scanRunningProcesses();
