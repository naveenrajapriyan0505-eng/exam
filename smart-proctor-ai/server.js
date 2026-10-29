/**
 * SmartProctor AI - Exam Management & AI Proctoring System Server
 * Real-time HTTP + Server-Sent Events (SSE) & WebSocket Engine
 * Zero external dependency requirement for maximum reliability & instant execution
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- ADMIN SECURITY & AUTHENTICATION CONFIG ---
const ADMIN_CONFIG = {
  username: process.env.ADMIN_USER || 'admin',
  password: process.env.ADMIN_PASSWORD || 'proctor@2026',
  passkey: '9921', // Optional 4-digit quick emergency passkey
  name: 'Prof. S. R. Sharma',
  role: 'Chief Examination Controller'
};

// In-Memory store for active admin authentication tokens
const adminSessions = new Map(); // token -> { token, username, name, role, expiresAt }

function extractToken(req, body = {}) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return body.token || null;
}

function isValidAdmin(token) {
  if (!token) return false;
  const session = adminSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

// In-Memory Database with file backing
const state = {
  exams: [
    {
      id: 'exam-cs402',
      institutionName: 'Apex Institute of Technology & Engineering',
      institutionType: 'University / College',
      examCode: 'CS-402',
      title: 'CS-402: Artificial Intelligence & Autonomous Systems Final Exam',
      department: 'Computer Science & Engineering',
      durationMinutes: 45,
      totalMarks: 50,
      proctoringConfig: {
        headPose: true,
        objectDetection: true,
        backgroundApps: true,
        tabLockdown: true,
        maxViolations: 5
      },
      instructions: [
        'Ensure your webcam and microphone remain active throughout the examination.',
        'Continuous head pose tracking is active. Do not look away from your screen.',
        'Unauthorized objects (mobile phones, smartwatches, textbooks, earphones) are strictly prohibited.',
        'Opening new tabs, switching windows, or exiting full-screen mode will log an immediate violation.',
        'Background application activity (communication tools, remote desktop) is monitored in real-time.',
        'Accumulating more than 5 critical violations will lead to automatic disqualification.'
      ],
      questions: [
        {
          id: 1,
          type: 'mcq',
          marks: 5,
          question: 'In deep learning, which convolutional neural network architecture introduced residual connections (skip connections) to mitigate the vanishing gradient problem?',
          options: [
            'AlexNet (Krizhevsky et al.)',
            'VGG-16 (Simonyan & Zisserman)',
            'ResNet (He et al.)',
            'GoogLeNet / Inception-v1'
          ],
          correct: 2,
          explanation: 'ResNet (Deep Residual Learning) introduced skip/residual connections allowing gradients to flow back without attenuation.'
        },
        {
          id: 2,
          type: 'mcq',
          marks: 5,
          question: 'Which object detection framework performs regression on bounding box coordinates and class probabilities in a single pass across the entire image?',
          options: [
            'R-CNN',
            'Fast R-CNN',
            'YOLO (You Only Look Once)',
            'Selective Search'
          ],
          correct: 2,
          explanation: 'YOLO frames object detection as a single regression problem directly from full image pixels to bounding box coordinates.'
        },
        {
          id: 3,
          type: 'mcq',
          marks: 5,
          question: 'What is the primary computer vision technique used to detect head pose orientation from 2D facial landmark coordinates?',
          options: [
            'Perspective-n-Point (PnP) algorithm with 3D-to-2D correspondence',
            'Histogram of Oriented Gradients (HOG) without calibration',
            'Bilinear interpolation filtering',
            'K-Means clustering on pixel intensities'
          ],
          correct: 0,
          explanation: 'The Perspective-n-Point (PnP) solver (e.g. solvePnP) estimates 3D rotation (yaw, pitch, roll) from 2D facial landmarks mapped to a generic 3D head model.'
        },
        {
          id: 4,
          type: 'mcq',
          marks: 5,
          question: 'In an automated proctoring pipeline, what does detecting multiple faces in the camera frame typically indicate?',
          options: [
            'Camera lens distortion artifact',
            'Presence of an unauthorized collaborator or external helper in the test environment',
            'High ambient lighting interference',
            'Incompatible frame rate of the video sensor'
          ],
          correct: 1,
          explanation: 'Detecting multiple human faces signifies another person has entered the candidate test area, which violates solitary exam protocols.'
        },
        {
          id: 5,
          type: 'code',
          marks: 10,
          question: 'Analyze the following Python snippet. Complete the logic to calculate the student integrity trust score based on violation penalties:',
          codeSnippet: `def compute_trust_score(base_score, violations):
    # Base score starts at 100
    # Penalty weights:
    # 'HEAD_MOVEMENT': 4 pts
    # 'OBJECT_DETECTED': 15 pts (e.g. mobile phone)
    # 'BACKGROUND_PROCESS': 20 pts
    # 'TAB_SWITCH': 10 pts
    # 'NO_FACE': 8 pts
    # 'MULTIPLE_FACES': 25 pts
    penalties = {
        'HEAD_MOVEMENT': 4,
        'OBJECT_DETECTED': 15,
        'BACKGROUND_PROCESS': 20,
        'TAB_SWITCH': 10,
        'NO_FACE': 8,
        'MULTIPLE_FACES': 25
    }
    deductions = sum(penalties.get(v['type'], 5) for v in violations)
    return max(0, base_score - deductions)`,
          options: [
            'Deductions are summed and subtracted from base_score with lower bound at 0',
            'Deductions multiply the base score exponentially',
            'Score resets to 0 upon any single violation regardless of type',
            'Trust score increases when head turns away'
          ],
          correct: 0,
          explanation: 'The function computes weighted penalty deductions and bounds the result between 0 and 100.'
        },
        {
          id: 6,
          type: 'mcq',
          marks: 5,
          question: 'Which of the following browser security events cannot be blocked by client JavaScript, but CAN be reliably monitored and logged to detect student tab switching?',
          options: [
            'window.location.reload',
            'document.visibilitychange & window.onblur events',
            'localStorage.clear',
            'console.log redirection'
          ],
          correct: 1,
          explanation: 'The Page Visibility API (visibilitychange event and document.hidden) accurately informs the proctoring engine whenever the student switches tabs or minimizes the window.'
        },
        {
          id: 7,
          type: 'mcq',
          marks: 5,
          question: 'Why is client-side lightweight object detection (e.g. MobileNet COCO-SSD) advantageous for continuous proctoring compared to streaming raw 1080p video frames to a remote cloud server?',
          options: [
            'It consumes 100x more bandwidth than video streaming',
            'It enables sub-second real-time inference with zero candidate video bandwidth bottlenecks and respects privacy by processing frames on device',
            'It requires dedicated GPU servers for every student',
            'It only works when the user disconnects from the internet'
          ],
          correct: 1,
          explanation: 'Running inference client-side minimizes network bandwidth overhead, enables real-time 30fps detection without network latency, and enhances candidate privacy.'
        },
        {
          id: 8,
          type: 'subjective',
          marks: 10,
          question: 'Explain how an automated AI proctoring system balances false-positive tolerance (e.g. quick natural blinking, water sip) versus intentional academic dishonesty.',
          placeholder: 'Provide your detailed technical explanation here (minimum 3 sentences)...',
          criteria: 'Mentions temporal smoothing/sliding windows, confidence thresholds, multi-modal verification, and human-in-the-loop audit logs.'
        }
      ]
    },
    {
      id: 'exam-stanford-phy201',
      institutionName: 'Stanford University - School of Sciences',
      institutionType: 'University / College',
      examCode: 'PHY-201',
      title: 'PHY-201: Modern Quantum Mechanics & Wave Dynamics',
      department: 'Department of Physics & Astronomy',
      durationMinutes: 40,
      totalMarks: 35,
      proctoringConfig: {
        headPose: true,
        objectDetection: true,
        backgroundApps: true,
        tabLockdown: true,
        maxViolations: 4
      },
      instructions: [
        'Webcam video and audio stream must remain unobstructed.',
        'Continuous eye tracking and head pose orientation is monitored.',
        'No external formula books, secondary monitors, or headphones permitted.',
        'Tab switching will trigger an immediate high-priority proctor infraction.'
      ],
      questions: [
        {
          id: 1,
          type: 'mcq',
          marks: 5,
          question: 'According to the de Broglie hypothesis, what is the wavelength λ associated with a particle having momentum p?',
          options: [
            'λ = h / p',
            'λ = p / h',
            'λ = h * p',
            'λ = h / (2 * p^2)'
          ],
          correct: 0,
          explanation: 'The de Broglie relation states λ = h / p, where h is Planck constant and p is momentum.'
        },
        {
          id: 2,
          type: 'mcq',
          marks: 5,
          question: 'In the time-independent Schrödinger equation Hψ = Eψ, what does the Hamiltonian operator H represent physically?',
          options: [
            'Total relativistic mass of the system',
            'Total energy operator (sum of kinetic and potential energy operators)',
            'Vector magnetic potential operator',
            'Orbital angular momentum projection along the z-axis'
          ],
          correct: 1,
          explanation: 'The Hamiltonian operator represents the total energy observable in quantum mechanics.'
        },
        {
          id: 3,
          type: 'mcq',
          marks: 5,
          question: 'Heisenberg uncertainty principle asserts that the product of uncertainties in position (Δx) and momentum (Δp) satisfies which inequality?',
          options: [
            'Δx * Δp >= ħ / 2',
            'Δx * Δp <= ħ / 2',
            'Δx * Δp == 0',
            'Δx / Δp >= ħ'
          ],
          correct: 0,
          explanation: 'The canonical uncertainty relation is Δx * Δp >= ħ / 2 where ħ = h / (2π).'
        },
        {
          id: 4,
          type: 'subjective',
          marks: 10,
          question: 'Explain the physical significance of quantum tunneling across a rectangular potential barrier of finite height V0 where particle energy E < V0.',
          placeholder: 'Provide your detailed physical derivation and analysis here...',
          criteria: 'Mentions wave function exponential decay inside barrier, non-zero transmission probability, and applications like scanning tunneling microscopy.'
        },
        {
          id: 5,
          type: 'mcq',
          marks: 10,
          question: 'Which experiment directly demonstrated the quantization of atomic electron energy levels via electron-atom collisions?',
          options: [
            'Franck-Hertz Experiment',
            'Stern-Gerlach Experiment',
            'Davisson-Germer Experiment',
            'Michelson-Morley Experiment'
          ],
          correct: 0,
          explanation: 'The Franck-Hertz experiment (1914) confirmed Bohr model quantization of mercury atoms via inelastic electron collisions.'
        }
      ]
    },
    {
      id: 'exam-dps-math12',
      institutionName: 'Delhi Public School (DPS Global Academy)',
      institutionType: 'High School / K-12',
      examCode: 'MATH-12',
      title: 'MATH-12: Grade 12 Advanced Calculus & Analytical Geometry',
      department: 'Department of Senior Secondary Mathematics',
      durationMinutes: 30,
      totalMarks: 30,
      proctoringConfig: {
        headPose: true,
        objectDetection: true,
        backgroundApps: true,
        tabLockdown: true,
        maxViolations: 3
      },
      instructions: [
        'Keep scratch paper clearly visible within camera field of view.',
        'Programmable and graphic calculators are strictly prohibited.',
        'Exam session will terminate upon exceeding 3 proctor warnings.'
      ],
      questions: [
        {
          id: 1,
          type: 'mcq',
          marks: 5,
          question: 'What is the derivative of f(x) = ln(sin(x)) with respect to x?',
          options: [
            'cot(x)',
            'tan(x)',
            '-cot(x)',
            'sec^2(x)'
          ],
          correct: 0,
          explanation: 'By chain rule, d/dx[ln(sin(x))] = (1 / sin(x)) * cos(x) = cot(x).'
        },
        {
          id: 2,
          type: 'mcq',
          marks: 5,
          question: 'Evaluate the definite integral ∫ from 0 to π/2 of cos(x) dx:',
          options: [
            '1',
            '0',
            'π / 2',
            '-1'
          ],
          correct: 0,
          explanation: '∫ cos(x) dx = sin(x). sin(π/2) - sin(0) = 1 - 0 = 1.'
        },
        {
          id: 3,
          type: 'mcq',
          marks: 10,
          question: 'If vectors A = 2i + 3j - k and B = i - j + 2k, what is their dot product (scalar product) A • B?',
          options: [
            '-3',
            '3',
            '7',
            '-1'
          ],
          correct: 0,
          explanation: 'A • B = (2)(1) + (3)(-1) + (-1)(2) = 2 - 3 - 2 = -3.'
        },
        {
          id: 4,
          type: 'subjective',
          marks: 10,
          question: 'State Rolle Theorem and outline the necessary conditions for a function f(x) to satisfy it on a closed interval [a, b].',
          placeholder: 'State conditions and geometric interpretation...',
          criteria: 'Continuous on [a,b], differentiable on (a,b), and f(a) = f(b) implies exists c in (a,b) where f\'(c) = 0.'
        }
      ]
    }
  ],
  sessions: {},
  violations: [],
  adminSubscribers: new Set(),
  studentSubscribers: new Map() // sessionId -> Set of res
};

// Seed demo sessions so the Admin Dashboard has realistic data on launch
function seedInitialData() {
  const sampleSessions = [
    {
      id: 'sess-stu-101',
      examId: 'exam-cs402',
      candidateName: 'Aditya Sharma',
      candidateRoll: '2422K081',
      candidateEmail: 'aditya.sharma@university.edu',
      status: 'in-progress',
      startedAt: new Date(Date.now() - 22 * 60000).toISOString(),
      trustScore: 78,
      violationsCount: 3,
      currentQuestion: 5,
      currentViolations: [
        {
          id: 'viol-seed-1',
          type: 'HEAD_MOVEMENT',
          severity: 'LOW',
          details: 'Candidate looked away to the right for 3.4 seconds',
          timestamp: new Date(Date.now() - 15 * 60000).toLocaleTimeString()
        },
        {
          id: 'viol-seed-2',
          type: 'TAB_SWITCH',
          severity: 'MEDIUM',
          details: 'Window lost focus / switched application for 4.2 seconds',
          timestamp: new Date(Date.now() - 8 * 60000).toLocaleTimeString()
        },
        {
          id: 'viol-seed-3',
          type: 'HEAD_MOVEMENT',
          severity: 'LOW',
          details: 'Candidate head turned downward outside exam monitor zone',
          timestamp: new Date(Date.now() - 2 * 60000).toLocaleTimeString()
        }
      ]
    },
    {
      id: 'sess-stu-102',
      examId: 'exam-cs402',
      candidateName: 'Priya Patel',
      candidateRoll: '2422K114',
      candidateEmail: 'priya.patel@university.edu',
      status: 'flagged',
      startedAt: new Date(Date.now() - 31 * 60000).toISOString(),
      trustScore: 45,
      violationsCount: 4,
      currentQuestion: 7,
      currentViolations: [
        {
          id: 'viol-seed-4',
          type: 'OBJECT_DETECTED',
          severity: 'HIGH',
          details: 'Cell Phone / Mobile Device detected in camera frame (Confidence: 94%)',
          timestamp: new Date(Date.now() - 12 * 60000).toLocaleTimeString()
        },
        {
          id: 'viol-seed-5',
          type: 'BACKGROUND_PROCESS',
          severity: 'CRITICAL',
          details: 'Unauthorized background application detected: Discord.exe (PID: 14280)',
          timestamp: new Date(Date.now() - 10 * 60000).toLocaleTimeString()
        },
        {
          id: 'viol-seed-6',
          type: 'MULTIPLE_FACES',
          severity: 'HIGH',
          details: 'Second person face detected standing behind candidate desk',
          timestamp: new Date(Date.now() - 4 * 60000).toLocaleTimeString()
        }
      ]
    },
    {
      id: 'sess-stu-103',
      examId: 'exam-cs402',
      candidateName: 'Kavita Sundaram',
      candidateRoll: '2422K042',
      candidateEmail: 'kavita.s@university.edu',
      status: 'in-progress',
      startedAt: new Date(Date.now() - 10 * 60000).toISOString(),
      trustScore: 98,
      violationsCount: 0,
      currentQuestion: 3,
      currentViolations: []
    }
  ];

  sampleSessions.forEach(s => {
    state.sessions[s.id] = s;
    s.currentViolations.forEach(v => {
      state.violations.unshift({
        ...v,
        sessionId: s.id,
        candidateName: s.candidateName,
        candidateRoll: s.candidateRoll
      });
    });
  });
}

// Multi-Institution Exam File Persistence
const EXAMS_FILE = path.join(DATA_DIR, 'exams.json');

function initExamsPersistence() {
  try {
    if (fs.existsSync(EXAMS_FILE)) {
      const data = JSON.parse(fs.readFileSync(EXAMS_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        state.exams = data;
        return;
      }
    }
    saveExams();
  } catch (e) {
    console.error('Error initializing exams.json persistence:', e);
  }
}

function saveExams() {
  try {
    fs.writeFileSync(EXAMS_FILE, JSON.stringify(state.exams, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving exams.json:', e);
  }
}

seedInitialData();
initExamsPersistence();

// Broadcast event to connected Admin dashboards
function notifyAdmins(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  state.adminSubscribers.forEach(res => {
    try {
      res.write(payload);
    } catch (e) {
      state.adminSubscribers.delete(res);
    }
  });
}

// Broadcast event to specific student
function notifyStudent(sessionId, event, data) {
  const subs = state.studentSubscribers.get(sessionId);
  if (!subs) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  subs.forEach(res => {
    try {
      res.write(payload);
    } catch (e) {
      subs.delete(res);
    }
  });
}

// Helper: Parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) { // 15MB limit for webcam snapshots
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Helper: MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // --- API ROUTES ---

  // 0. Admin Authentication Endpoints (Access Lock)
  if (pathname === '/api/admin/login' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const username = (body.username || '').trim();
      const password = (body.password || '').trim();
      const passkey = (body.passkey || '').trim();

      const isUsernameMatch = username.toLowerCase() === ADMIN_CONFIG.username.toLowerCase();
      const isPasswordMatch = password === ADMIN_CONFIG.password;
      const isPasskeyMatch = passkey === ADMIN_CONFIG.passkey;

      if ((isUsernameMatch && isPasswordMatch) || isPasskeyMatch || (isUsernameMatch && isPasskeyMatch)) {
        // Generate secure 48-char random token
        const token = 'adm_' + crypto.randomBytes(24).toString('hex');
        const sessionData = {
          token,
          username: ADMIN_CONFIG.username,
          name: ADMIN_CONFIG.name,
          role: ADMIN_CONFIG.role,
          createdAt: Date.now(),
          expiresAt: Date.now() + 12 * 60 * 60 * 1000 // 12 hours validity
        };

        adminSessions.set(token, sessionData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          message: 'Admin authentication successful',
          token,
          user: {
            username: ADMIN_CONFIG.username,
            name: ADMIN_CONFIG.name,
            role: ADMIN_CONFIG.role
          }
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: 'Access Denied: Invalid administrator credentials or passkey.'
        }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 0.1 Verify Admin Token Status
  if (pathname === '/api/admin/verify' && (method === 'POST' || method === 'GET')) {
    try {
      let token = extractToken(req);
      if (!token && parsedUrl.query && parsedUrl.query.token) {
        token = parsedUrl.query.token;
      }
      if (!token && method === 'POST') {
        const body = await parseJsonBody(req);
        token = body.token;
      }

      if (isValidAdmin(token)) {
        const session = adminSessions.get(token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          valid: true,
          user: {
            username: session.username,
            name: session.name,
            role: session.role
          }
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          valid: false,
          error: 'Administrator session is locked or expired.'
        }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 0.2 Admin Logout
  if (pathname === '/api/admin/logout' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const token = extractToken(req, body);
      if (token && adminSessions.has(token)) {
        adminSessions.delete(token);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Admin terminal locked successfully.' }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }
  }

  // 0.3 Student Authentication (Requires Roll Number starting with '2422k')
  if (pathname === '/api/student/login' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const rollNumber = (body.rollNumber || '').trim();
      const name = (body.name || '').trim() || 'Candidate ' + rollNumber.toUpperCase();
      const examId = body.examId || 'exam-cs402';

      if (!rollNumber) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: 'Student Roll Number is required.'
        }));
      }

      // STRICT VALIDATION: Roll Number must start with '2422k' (case-insensitive)
      if (!rollNumber.toLowerCase().startsWith('2422k')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: "Access Denied: Only Student Roll Numbers starting with '2422K' are accepted (e.g. 2422K042, 2422K001)."
        }));
      }

      // Generate verified student authentication token
      const token = 'std_' + crypto.randomBytes(16).toString('hex');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: 'Student authentication verified successfully.',
        token,
        student: {
          rollNumber: rollNumber.toUpperCase(),
          name,
          examId
        }
      }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 1. Get All Exams
  if (pathname === '/api/exams' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, exams: state.exams }));
  }

  // 1.1 Create Custom Exam for Any School / College / University
  if (pathname === '/api/exams/create' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const token = extractToken(req, body);

      // Verify Admin Security Token if provided
      if (token && !isValidAdmin(token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Unauthorized Access: Please log in as an administrator.' }));
      }

      const institutionName = (body.institutionName || 'Autonomous Examination Board').trim();
      const institutionType = (body.institutionType || 'University / College').trim();
      const title = (body.title || '').trim();
      const department = (body.department || 'General Academics').trim();
      const examCode = (body.examCode || 'EXAM-' + Math.floor(100 + Math.random() * 900)).trim().toUpperCase();
      const durationMinutes = Math.max(5, parseInt(body.durationMinutes) || 45);

      if (!title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Examination Title is required.' }));
      }

      const rawQuestions = Array.isArray(body.questions) ? body.questions : [];
      if (rawQuestions.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'At least one examination question is required.' }));
      }

      // Normalize and sanitize questions
      const questions = rawQuestions.map((q, idx) => ({
        id: idx + 1,
        type: q.type || 'mcq',
        marks: parseInt(q.marks) || 5,
        question: (q.question || `Question ${idx + 1}`).trim(),
        options: Array.isArray(q.options) && q.options.length > 0 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'],
        correct: parseInt(q.correct) || 0,
        explanation: (q.explanation || '').trim(),
        codeSnippet: q.codeSnippet ? q.codeSnippet.trim() : null,
        placeholder: q.placeholder || 'Type your detailed answer here...',
        criteria: q.criteria || ''
      }));

      const totalMarks = body.totalMarks ? parseInt(body.totalMarks) : questions.reduce((sum, q) => sum + (q.marks || 5), 0);

      const defaultInstructions = [
        'Ensure your webcam and microphone remain active throughout the examination.',
        'Continuous 3D head pose and gaze tracking is active. Do not look away from your screen.',
        'Unauthorized objects (mobile phones, smartwatches, textbooks, earphones) are strictly prohibited.',
        'Opening new tabs, switching windows, or exiting full-screen mode will log an immediate violation.',
        'Background application activity is monitored continuously.',
        'Accumulating critical violations will lead to automatic flagging and disqualification.'
      ];

      const instructions = Array.isArray(body.instructions) && body.instructions.length > 0 
        ? body.instructions 
        : (typeof body.instructions === 'string' && body.instructions.trim().length > 0 
            ? body.instructions.split('\n').map(s => s.trim()).filter(Boolean)
            : defaultInstructions);

      const proctoringConfig = body.proctoringConfig || {
        headPose: true,
        objectDetection: true,
        backgroundApps: true,
        tabLockdown: true,
        maxViolations: 5
      };

      const slug = (examCode || institutionName).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
      const examId = 'exam-' + slug + '-' + Date.now().toString(36);

      const newExam = {
        id: examId,
        institutionName,
        institutionType,
        department,
        examCode,
        title,
        durationMinutes,
        totalMarks,
        instructions,
        proctoringConfig,
        questions,
        createdAt: new Date().toISOString()
      };

      state.exams.unshift(newExam);
      saveExams();

      // Broadcast new exam to proctors
      notifyAdmins('exam_created', { exam: newExam });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: `Examination '${title}' for ${institutionName} created successfully!`,
        exam: newExam
      }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 1.2 Delete Custom Exam
  if (pathname === '/api/exams/delete' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const token = extractToken(req, body);

      if (token && !isValidAdmin(token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Unauthorized Access' }));
      }

      const examId = body.examId;
      if (!examId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'examId is required' }));
      }
      if (state.exams.length <= 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Cannot delete the only remaining examination.' }));
      }

      state.exams = state.exams.filter(e => e.id !== examId);
      saveExams();
      notifyAdmins('exam_deleted', { examId });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Exam deleted successfully.' }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 2. Get specific exam
  if (pathname.startsWith('/api/exam/') && method === 'GET') {
    const examId = pathname.replace('/api/exam/', '');
    const exam = state.exams.find(e => e.id === examId) || state.exams[0];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, exam }));
  }

  // 3. Register Student Session
  if (pathname === '/api/sessions/register' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const candidateRoll = (body.candidateRoll || '').trim();

      if (!candidateRoll || !candidateRoll.toLowerCase().startsWith('2422k')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: "Access Denied: Only candidate roll numbers starting with '2422K' are allowed to start examinations."
        }));
      }

      const sessionId = 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
      
      const session = {
        id: sessionId,
        examId: body.examId || 'exam-cs402',
        candidateName: body.candidateName || 'Candidate',
        candidateRoll: candidateRoll.toUpperCase(),
        candidateEmail: body.candidateEmail || '',
        status: 'in-progress',
        startedAt: new Date().toISOString(),
        trustScore: 100,
        violationsCount: 0,
        aiStrikes: 0,
        isAutonomous: true,
        currentQuestion: 1,
        currentViolations: [],
        answers: {}
      };

      state.sessions[sessionId] = session;

      // Broadcast new student joined to Admin
      notifyAdmins('candidate_joined', { session });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, session }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 4. Get All Sessions (for Admin)
  if (pathname === '/api/sessions' && method === 'GET') {
    const sessionsList = Object.values(state.sessions);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      sessions: sessionsList,
      violations: state.violations.slice(0, 50),
      stats: {
        totalCandidates: sessionsList.length,
        active: sessionsList.filter(s => s.status === 'in-progress').length,
        flagged: sessionsList.filter(s => s.status === 'flagged').length,
        submitted: sessionsList.filter(s => s.status === 'submitted' || s.status === 'terminated').length,
        totalViolations: state.violations.length
      }
    }));
  }

  // 5. Get Single Session Details
  if (pathname.startsWith('/api/session/') && !pathname.includes('/violation') && !pathname.includes('/submit') && !pathname.includes('/heartbeat') && method === 'GET') {
    const sessionId = pathname.replace('/api/session/', '');
    const session = state.sessions[sessionId];
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Session not found' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, session }));
  }

  // 6. Record Violation (AI Proctor or Process Monitor)
  if (pathname.includes('/violation') && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const sessionId = body.sessionId || pathname.split('/')[3];
      const session = state.sessions[sessionId];

      const violationId = 'viol-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
      const violation = {
        id: violationId,
        sessionId: sessionId || 'unknown',
        candidateName: session ? session.candidateName : (body.candidateName || 'Unknown Candidate'),
        candidateRoll: session ? session.candidateRoll : (body.candidateRoll || 'N/A'),
        type: body.type || 'SUSPICIOUS_ACTIVITY',
        severity: body.severity || 'MEDIUM', // LOW, MEDIUM, HIGH, CRITICAL
        details: body.details || 'Suspicious behavior detected',
        snapshot: body.snapshot || null, // Base64 data URL from webcam
        timestamp: new Date().toLocaleTimeString(),
        dateTime: new Date().toISOString()
      };

      // Penalty mapping
      const penalties = {
        'HEAD_MOVEMENT': 4,
        'NO_FACE': 8,
        'MULTIPLE_FACES': 20,
        'OBJECT_DETECTED': 15,
        'BACKGROUND_PROCESS': 25,
        'TAB_SWITCH': 10,
        'FULLSCREEN_EXIT': 10,
        'COPY_PASTE': 8,
        'MIC_MUTED_DURING_EXAM': 20,
        'CRITICAL_BREACH': 55
      };

      const penalty = penalties[violation.type] || 5;

      if (session) {
        session.violationsCount = (session.violationsCount || 0) + 1;
        session.trustScore = Math.max(0, (session.trustScore || 100) - penalty);
        
        session.currentViolations = session.currentViolations || [];
        session.currentViolations.unshift({
          id: violation.id,
          type: violation.type,
          severity: violation.severity,
          details: violation.details,
          timestamp: violation.timestamp
        });

        const isPhone = violation.type === 'PHONE_DETECTED' || 
          (violation.type === 'OBJECT_DETECTED' && violation.details && violation.details.toLowerCase().includes('phone'));
        const isThirdPartyOrTab = violation.type === 'TAB_SWITCH' || 
          violation.type === 'FULLSCREEN_EXIT' || 
          violation.type === 'BACKGROUND_PROCESS' || 
          violation.type === 'THIRD_PARTY_SITE';
        const isFaceRotation = violation.type === 'HEAD_MOVEMENT' || 
          violation.type === 'FACE_ROTATION' || 
          violation.type === 'FACE_ROTATION_EXCEEDED';
        const isSpeechExpulsion = violation.type === 'SPEECH_EXPULSION';

        if (isFaceRotation) {
          session.faceRotationCount = (session.faceRotationCount || 0) + 1;
        }

        // FULLY AUTOMATED ZERO-TOLERANCE RULES:
        // Rule 1: Phone on camera -> Immediate Auto Termination
        // Rule 2: 3rd party website / tab switch -> Immediate Auto Termination
        // Rule 3: Continuous speech 2-3 minutes -> Immediate Auto Termination
        // Rule 4: 4th face rotation -> Immediate Auto Termination ("comes out")
        // Rule 5: Trust score <= 50% -> Immediate Auto Termination
        if (isPhone || isThirdPartyOrTab || isSpeechExpulsion || (isFaceRotation && session.faceRotationCount >= 4) || session.trustScore <= 50) {
          session.status = 'terminated';
          if (isPhone) {
            session.terminationReason = 'Automatic Immediate Disqualification: Mobile phone detected on camera. Contraband electronic devices are strictly prohibited.';
            session.trustScore = 0;
          } else if (isThirdPartyOrTab) {
            session.terminationReason = 'Automatic Immediate Disqualification: Unauthorized third-party website / tab switch / background application detected. Full exam lockdown breached.';
            session.trustScore = 0;
          } else if (isSpeechExpulsion) {
            session.terminationReason = 'Automatic Disqualification: Continuous human speech detected for over 2 minutes (120s). Solitary examination protocol strictly prohibits verbal communication.';
            session.trustScore = 0;
          } else if (isFaceRotation && session.faceRotationCount >= 4) {
            session.terminationReason = 'Automatic Disqualification: Candidate rotated face 4 times. Maximum allowed 3 warnings exceeded. Exam terminated automatically.';
          } else {
            session.terminationReason = `Automatic Disqualification: Integrity Trust Score dropped to ${session.trustScore}% (<=50% threshold breached). Prohibited infraction: ${violation.type.replace(/_/g, ' ')}.`;
          }
          session.terminatedAt = new Date().toISOString();

          violation.severity = 'CRITICAL';
          violation.details += ` [AUTONOMOUS ENFORCEMENT: Exam automatically terminated without manual admin check]`;

          // Notify student workstation immediately
          notifyStudent(session.id, 'exam_terminated', {
            reason: session.terminationReason,
            trustScore: session.trustScore,
            violationsCount: session.violationsCount
          });

          // Broadcast termination event to admin consoles
          notifyAdmins('candidate_terminated', { session });
        } else if (session.trustScore <= 70 || violation.severity === 'CRITICAL') {
          session.status = 'flagged';
        }
      }

      state.violations.unshift(violation);
      if (state.violations.length > 200) state.violations.pop();

      // Broadcast alert to all active proctor dashboards
      notifyAdmins('violation_alert', {
        violation,
        session: session ? {
          id: session.id,
          trustScore: session.trustScore,
          violationsCount: session.violationsCount,
          aiStrikes: session.aiStrikes,
          status: session.status
        } : null
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        violationId,
        remainingTrust: session ? session.trustScore : 100,
        violationsCount: session ? session.violationsCount : 1,
        aiStrikes: session ? session.aiStrikes : 1,
        status: session ? session.status : 'in-progress',
        isTerminated: session ? session.status === 'terminated' : false,
        terminationReason: session ? session.terminationReason : null
      }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 7. Student Heartbeat
  if (pathname.includes('/heartbeat') && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const sessionId = body.sessionId;
      const session = state.sessions[sessionId];
      if (session) {
        session.lastHeartbeat = Date.now();
        if (body.currentQuestion) session.currentQuestion = body.currentQuestion;
        if (body.cameraActive !== undefined) session.cameraActive = body.cameraActive;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 8. Submit Exam
  if (pathname.includes('/submit') && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const sessionId = body.sessionId;
      const session = state.sessions[sessionId];
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Session not found' }));
      }

      if (session.status === 'terminated') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: 'Examination was automatically terminated. Submission is prohibited.',
          isTerminated: true,
          terminationReason: session.terminationReason
        }));
      }

      session.status = 'submitted';
      session.submittedAt = new Date().toISOString();
      session.answers = body.answers || {};

      // Compute score
      const exam = state.exams.find(e => e.id === session.examId) || state.exams[0];
      let score = 0;
      exam.questions.forEach(q => {
        if (q.type === 'mcq' || q.type === 'code') {
          if (session.answers[q.id] !== undefined && session.answers[q.id] === q.correct) {
            score += q.marks;
          }
        } else if (q.type === 'subjective') {
          // Provide baseline score for demo answer length
          if (session.answers[q.id] && session.answers[q.id].length > 40) {
            score += 8;
          }
        }
      });
      session.finalScore = score;
      session.totalMarks = exam.totalMarks;

      notifyAdmins('candidate_submitted', { session });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: 'Exam submitted successfully',
        score,
        totalMarks: exam.totalMarks,
        trustScore: session.trustScore
      }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 9. Admin Proctor Control Action (Send Warning, Terminate, Clear) - PROTECTED
  if (pathname === '/api/admin/action' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const token = extractToken(req, body);

      // Verify Admin Security Lock
      if (!isValidAdmin(token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: 'Unauthorized Access: Admin terminal is locked. Please authenticate.'
        }));
      }

      const { sessionId, action, message } = body;
      const session = state.sessions[sessionId];

      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Session not found' }));
      }

      if (action === 'warn') {
        notifyStudent(sessionId, 'proctor_warning', {
          message: message || 'Proctor Warning: Please maintain eye contact with the screen and refrain from prohibited activities.'
        });
      } else if (action === 'terminate') {
        session.status = 'terminated';
        session.terminationReason = message || 'Terminated by Proctor for academic integrity violations.';
        notifyStudent(sessionId, 'exam_terminated', {
          reason: session.terminationReason,
          trustScore: session.trustScore,
          violationsCount: session.violationsCount
        });
        notifyAdmins('candidate_terminated', { session });
      } else if (action === 'pause') {
        notifyStudent(sessionId, 'exam_pause', {});
      } else if (action === 'resume') {
        notifyStudent(sessionId, 'exam_resume', {});
      } else if (action === 'clear_violation') {
        session.trustScore = Math.min(100, (session.trustScore || 80) + 10);
        if (session.trustScore > 60) session.status = 'in-progress';
        notifyAdmins('session_updated', { session });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, session }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 10. Companion Process Scanner Ingest Endpoint
  if (pathname === '/api/proctor/processes' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { sessionId, unauthorizedProcesses } = body;
      const session = state.sessions[sessionId];

      if (unauthorizedProcesses && unauthorizedProcesses.length > 0) {
        const details = `Blacklisted background application(s) detected running: ${unauthorizedProcesses.map(p => `${p.name} (PID: ${p.pid})`).join(', ')}`;
        
        const violation = {
          id: 'viol-proc-' + Date.now(),
          sessionId: sessionId || 'sess-stu-101',
          candidateName: session ? session.candidateName : 'Active Student',
          candidateRoll: session ? session.candidateRoll : 'CS2026-N/A',
          type: 'BACKGROUND_PROCESS',
          severity: 'CRITICAL',
          details,
          snapshot: null,
          timestamp: new Date().toLocaleTimeString(),
          dateTime: new Date().toISOString()
        };

        if (session) {
          session.violationsCount = (session.violationsCount || 0) + 1;
          session.trustScore = Math.max(0, (session.trustScore || 100) - 25);
          session.currentViolations = session.currentViolations || [];
          session.currentViolations.unshift(violation);

          if (session.trustScore <= 50) {
            session.status = 'terminated';
            session.terminationReason = `Automatic Disqualification: Integrity Trust Score dropped to ${session.trustScore}% (<=50% threshold breached) due to unauthorized background application (${unauthorizedProcesses[0].name}).`;
            session.terminatedAt = new Date().toISOString();

            notifyStudent(session.id, 'exam_terminated', {
              reason: session.terminationReason,
              trustScore: session.trustScore,
              violationsCount: session.violationsCount
            });
            notifyAdmins('candidate_terminated', { session });
          } else {
            session.status = 'flagged';
          }
        }

        state.violations.unshift(violation);
        notifyAdmins('violation_alert', { violation, session });

        // Also warn student if not yet terminated
        if (sessionId && session && session.status !== 'terminated') {
          notifyStudent(sessionId, 'proctor_warning', {
            message: `CRITICAL ALERT: Unauthorized background application detected (${unauthorizedProcesses[0].name}). Close it immediately or your exam will be terminated!`
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        count: (unauthorizedProcesses || []).length,
        remainingTrust: session ? session.trustScore : 100,
        violationsCount: session ? session.violationsCount : 0,
        status: session ? session.status : 'in-progress',
        isTerminated: session ? session.status === 'terminated' : false,
        terminationReason: session ? session.terminationReason : null
      }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 11. SSE Endpoint for Proctor Admin Live Updates
  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('event: connected\ndata: {"status":"connected"}\n\n');
    state.adminSubscribers.add(res);

    req.on('close', () => {
      state.adminSubscribers.delete(res);
    });
    return;
  }

  // 12. SSE Endpoint for Student Real-time Notifications
  if (pathname.startsWith('/api/student-events/') && method === 'GET') {
    const sessionId = pathname.replace('/api/student-events/', '');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('event: connected\ndata: {"status":"connected"}\n\n');

    if (!state.studentSubscribers.has(sessionId)) {
      state.studentSubscribers.set(sessionId, new Set());
    }
    state.studentSubscribers.get(sessionId).add(res);

    req.on('close', () => {
      const subs = state.studentSubscribers.get(sessionId);
      if (subs) {
        subs.delete(res);
        if (subs.size === 0) state.studentSubscribers.delete(sessionId);
      }
    });
    return;
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  
  // Security check to avoid path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Access denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback: check if .html extension is omitted
      if (fs.existsSync(filePath + '.html')) {
        filePath = filePath + '.html';
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end('<h1>404 Not Found</h1>');
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Internal Server Error');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🛡️  SMARTPROCTOR AI SERVER RUNNING`);
  console.log(`📍 Web URL: http://localhost:${PORT}`);
  console.log(`👨‍🎓 Student Portal: http://localhost:${PORT}/student.html`);
  console.log(`👨‍🏫 Admin / Proctor Dashboard: http://localhost:${PORT}/admin.html`);
  console.log(`📊 Integrity Reports: http://localhost:${PORT}/report.html`);
  console.log(`=======================================================`);
});
