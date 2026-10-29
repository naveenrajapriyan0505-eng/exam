# SmartProctor AI: Autonomous Exam Management & AI Proctoring System
> **Final Year Engineering Project (2026)**  
> *Real-time Computer Vision Facial/Head Pose Tracking, Unauthorized Object Detection, and Operating System Background Application Auditing.*

---

## 📌 Project Overview & Highlights

**SmartProctor AI** is a state-of-the-art web application and invigilation platform engineered to secure remote online examinations against academic dishonesty. It features continuous AI computer vision analysis directly in the browser coupled with a native operating system background process daemon that monitors active tasks.

### 🌟 Core Proctoring Pillars

1. **👤 Continuous Head Movement & Gaze Tracking**
   - Tracks candidate facial orientation and bounding box centroid displacement in real time (30 FPS).
   - Flags suspicious conduct:
     - Turning head Left or Right away from the computer monitor.
     - Casting gaze downwards (looking at hidden notes or lap).
     - Absence of candidate (student left the desk).
     - Multiple faces in camera view (presence of an unauthorized collaborator).

2. **📱 Real-Time Unauthorized Object Detection (Computer Vision)**
   - Uses deep learning object detection (TensorFlow.js COCO-SSD / MobileNet).
   - Detects contraband items in the webcam frame:
     - **Cell Phones / Smartphones**
     - **Books / Printed Notes**
     - **Laptops / Secondary Screens**
   - Automatically timestamps and captures a photographic evidence frame stored in the candidate's forensic audit record.

3. **🖥️ Background Application & Process Monitoring**
   - **Browser-Level Lockdown**:
     - Page Visibility API & Window Blur detection (detects when candidate minimizes window or switches tabs).
     - Fullscreen enforcement (traps attempt to escape fullscreen mode).
     - Disables context menu (right-click inspect), developer shortcuts (F12, Ctrl+Shift+I), and clipboard operations (Ctrl+C, Ctrl+V).
   - **Operating System Companion Agent (`process-monitor.js` & `process-monitor.ps1`)**:
     - Audits active Windows task list every 3 seconds.
     - Detects blacklisted communication, remote control, and screen-sharing utilities:
       - *Discord, WhatsApp Desktop, Telegram, Zoom, Microsoft Teams, Slack*
       - *AnyDesk, TeamViewer, UltraViewer, RustDesk, Windows Remote Desktop (mstsc.exe)*
       - *OBS Studio screen recorders, Cheat Engine memory scanners, ChatGPT desktop*
     - Instantly transmits a **CRITICAL** severity breach alert to the Proctor Admin Dashboard!

4. **👨‍🏫 Live Proctor Admin Command Center**
   - Centralized multi-candidate live monitor grid showing real-time webcam snapshots, trust scores, and question progress.
   - Live Security Violation Ticker with acoustic chime alerts.
   - Remote candidate intervention:
     - **Send Proctor Warning Modal** (pops up an alert on the student's screen in real time).
     - **Force Terminate / Disqualify** candidate.
     - **Inspect Photographic Evidence** (view photo proof of candidate looking away or holding a cell phone).

5. **📊 Certified Academic Integrity Audit Report**
   - Generates official university-grade evaluation reports with:
     - Candidate credentials and biometric verification status.
     - Provisional academic test score.
     - Integrity Trust Score (0% – 100%).
     - Chronological infraction log with exact timestamps.
     - Signature blocks for Chief Invigilator and Head of Department.
     - Print / Export to PDF support.

---

## 🚀 Quick Start Guide

### 1. Launch the Server
Double-click `run.bat` or run the following in terminal:
```bash
# From d:\smart-proctor-ai
d:\tools\node\node.exe server.js
```
The server will start at: **`http://localhost:3000`**

### 2. Available Portals
| Portal | URL | Description |
|---|---|---|
| **Hub / Home** | `http://localhost:3000/index.html` | Architectural overview and portal selector |
| **Student Exam Room** | `http://localhost:3000/student.html` | Fullscreen proctored candidate workstation |
| **Proctor Live Command Center** | `http://localhost:3000/admin.html` | Real-time multi-student monitor & alert feed |
| **Integrity Audit Report** | `http://localhost:3000/report.html` | Official evaluation report & printable certificate |

### 3. Running the Companion OS Process Monitor
To monitor native Windows background applications during the exam:
```powershell
# In PowerShell:
powershell -ExecutionPolicy Bypass -File .\process-monitor.ps1

# Or with Node.js:
d:\tools\node\node.exe process-monitor.js
```

---

## 🧪 Viva Demonstration & Examiner Presentation Guide

For your college final year viva or project presentation, you can demonstrate the full system in 3 minutes:

1. **Open two browser windows side by side**:
   - Window 1 (Right): Admin Command Center (`http://localhost:3000/admin.html`)
   - Window 2 (Left): Student Exam Portal (`http://localhost:3000/student.html`)
2. In the **Student Portal**, click **"Authenticate Identity & Enter Examination Room"**.
   - Notice the student card appears immediately in the Admin Command Center!
3. **Demonstrate Computer Vision Head Pose & Object Tracking**:
   - Turn your head left or right away from the camera for 3 seconds -> Admin Dashboard chimes with 🚨 `HEAD_MOVEMENT` alert!
   - Hold up a mobile phone to your webcam -> HUD highlights a red box `CELL PHONE (96%)` and transmits a high-severity alert to the Admin!
   - You can also click the buttons under **"VIVA DEMO SIMULATION CONTROLS"** (`Test Head Turn`, `Test Cell Phone`, `Test Unauthorized App (Discord)`) for zero-friction demonstration!
4. **Demonstrate Proctor Intervention**:
   - On the Admin Dashboard, click **"⚠️ Warn"** on the student card.
   - Choose a preset or write a message and click **"Send Warning Now"**.
   - Watch the high-visibility warning modal immediately appear on the Student's screen!
5. **Demonstrate Background Process Detection**:
   - In terminal, start `d:\tools\node\node.exe process-monitor.js`.
   - Open Discord, WhatsApp, or run the test trigger. The admin console will immediately flag the student as **HIGH RISK** with an unauthorized background application alert!
6. **Demonstrate the Certified Report**:
   - Click **"Inspect"** -> **"Open Official Certified Report"** (or open `http://localhost:3000/report.html`).
   - Click **"🖨️ Print / Save PDF"** to demonstrate official university evaluation export.

---

## 🛠️ Project Structure

```
d:\smart-proctor-ai\
├── server.js              # HTTP & Server-Sent Events (SSE) server
├── process-monitor.js     # Node.js companion OS background process scanner
├── process-monitor.ps1    # Native PowerShell companion process scanner
├── package.json           # Project manifest
├── run.bat                # One-click Windows launcher
├── public/
│   ├── index.html         # Landing Hub & Architectural Overview
│   ├── student.html       # Candidate Proctored Examination Workstation
│   ├── admin.html         # Proctor Live Command Center & Alert Console
│   ├── report.html        # Certified Academic Integrity Audit Report
│   ├── css/
│   │   ├── styles.css     # Global cyber-aesthetic design system
│   │   ├── student.css    # Student workstation styles
│   │   └── admin.css      # Admin command center styles
│   └── js/
│       ├── ai-proctor.js  # Computer Vision: Head pose, object detection, audio
│       ├── student.js     # Exam logic, lockdown listeners, timer, submission
│       └── admin.js       # Live SSE alert ticker, student grid, inspector
└── data/                  # In-memory and persistent session records
```

---

## 🎓 Expected Viva Questions & Answers

1. **Q: How does the system detect head movement and looking away without specialized hardware?**  
   *A: It uses real-time 2D facial bounding box centroid displacement and normalized Euclidean distance from the calibrated camera center. When the centroid moves beyond the 32% or 68% horizontal threshold for greater than 2.5 seconds, the temporal sliding window classifies the behavior as sustained looking away.*

2. **Q: Why run object detection client-side in the browser instead of streaming video to the server?**  
   *A: Streaming raw 1080p video from 100 concurrent students requires massive network bandwidth (over 300 Mbps) and expensive GPU cloud servers. Running lightweight MobileNet COCO-SSD client-side processes frames at 30 FPS locally on the device with zero network lag, preserves candidate privacy, and only transmits lightweight metadata and occasional violation evidence snapshots.*

3. **Q: How do you bypass browser sandbox limitations to check running OS background applications?**  
   *A: While the browser enforces sandboxing for web security, we implement a hybrid multi-layer architecture: browser-level hooks track tab switching (`visibilitychange`) and window blur (`window.onblur`), while an accompanying lightweight OS daemon (`process-monitor.js` / `process-monitor.ps1`) audits the native OS task list (`tasklist` / `Get-Process`) and reports blacklisted applications directly to the invigilation server.*
