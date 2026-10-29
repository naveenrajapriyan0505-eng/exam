/**
 * SmartProctor AI - Student Examination Controller
 * Handles system integrity checks, exam state, timer, lockdown enforcement,
 * and communications with the AI proctoring backend.
 */

(function () {
  // Application State
  const state = {
    session: null,
    exam: null,
    availableExams: [],
    selectedExamId: 'exam-cs402',
    currentQuestionIndex: 0,
    answers: {},
    flaggedQuestions: new Set(),
    timerInterval: null,
    remainingSeconds: 45 * 60,
    proctorEngine: null,
    isExamActive: false,
    eventSource: null,
    faceRotationWarnings: 0,
    maxFaceWarnings: 3,
    isMicrophoneActive: false,
    setupMediaStream: null,
    setupAudioContext: null,
    setupAudioAnalyser: null
  };

  // DOM Elements
  const screens = {
    setup: document.getElementById('screen-setup'),
    exam: document.getElementById('screen-exam'),
    result: document.getElementById('screen-result'),
    terminated: document.getElementById('screen-terminated')
  };

  // Sounds (Web Audio synthetic beeps)
  function playAlertSound(type = 'warning') {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'danger') {
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // High pitch alarm
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      } else {
        osc.frequency.setValueAtTime(540, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
      }
    } catch (e) {
      // Audio autoplay restrictions
    }
  }

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', async () => {
    // 1. Enforce Student Authentication & 2422K Roll Number Requirement
    const storedRoll = localStorage.getItem('smartproctor_student_roll');
    const storedName = localStorage.getItem('smartproctor_student_name');
    const storedExam = localStorage.getItem('smartproctor_student_exam_id');
    const nameInput = document.getElementById('input-candidate-name');
    const rollInput = document.getElementById('input-candidate-roll');
    const navRoll = document.getElementById('display-auth-roll');

    if (storedRoll && storedRoll.toLowerCase().startsWith('2422k')) {
      if (rollInput) rollInput.value = storedRoll;
      if (nameInput && storedName) nameInput.value = storedName;
      if (navRoll) navRoll.textContent = storedRoll;
      if (storedExam) state.selectedExamId = storedExam;
    } else {
      window.location.replace('student-login.html');
      return;
    }

    setupEventListeners();
    await fetchAvailableExams();
    await checkCameraSupport();
  });

  // Fetch Available School & College Examinations
  async function fetchAvailableExams() {
    try {
      const res = await fetch('/api/exams');
      const data = await res.json();
      state.availableExams = data.exams || [];
      if (state.availableExams.length > 0) {
        state.selectedExamId = state.availableExams[0].id;
        populateStudentExamDropdown();
      }
    } catch (e) {
      console.error('Failed to load exams list for student:', e);
    }
  }

  function populateStudentExamDropdown() {
    const select = document.getElementById('select-exam-choice');
    if (!select) return;

    select.innerHTML = '';
    state.availableExams.forEach(ex => {
      const opt = document.createElement('option');
      opt.value = ex.id;
      opt.textContent = `${ex.examCode || 'EXAM'} • ${ex.title} — ${ex.institutionName}`;
      if (ex.id === state.selectedExamId) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener('change', e => {
      state.selectedExamId = e.target.value;
      updateStudentExamPreview();
    });

    updateStudentExamPreview();
  }

  function updateStudentExamPreview() {
    const cur = state.availableExams.find(e => e.id === state.selectedExamId) || state.availableExams[0];
    if (!cur) return;

    const instElem = document.getElementById('setup-inst-name');
    const deptElem = document.getElementById('setup-dept-name');
    const durMarksElem = document.getElementById('setup-dur-marks');
    const badgeElem = document.getElementById('setup-exam-badge');

    if (instElem) instElem.textContent = cur.institutionName || 'Apex Institute';
    if (deptElem) deptElem.textContent = cur.department || 'Academics';
    if (durMarksElem) durMarksElem.textContent = `${cur.durationMinutes || 45} Mins • ${cur.totalMarks || 50} Marks`;
    if (badgeElem) badgeElem.textContent = `${cur.examCode || 'EXAM'} • ${cur.institutionName || ''}`;
  }

  async function checkCameraSupport() {
    const camStatus = document.getElementById('status-cam');
    const micStatus = document.getElementById('status-mic');
    const previewVideo = document.getElementById('setup-video-preview');

    try {
      const testStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      state.setupMediaStream = testStream;
      if (previewVideo) previewVideo.srcObject = testStream;
      if (camStatus) {
        camStatus.innerHTML = '<span class="badge badge-success">✓ Active & Ready</span>';
      }

      const audioTracks = testStream.getAudioTracks();
      const hasAudio = audioTracks.length > 0 && audioTracks[0].enabled;
      state.isMicrophoneActive = hasAudio;

      if (micStatus) {
        micStatus.innerHTML = '<span class="badge badge-success">✓ Active & Calibrated (Mandatory)</span>';
      }

      updateSetupMicUI(hasAudio);
      startSetupAudioMonitor(testStream);
    } catch (err) {
      console.warn('Media devices check error:', err);
      state.isMicrophoneActive = false;
      if (camStatus) camStatus.innerHTML = '<span class="badge badge-danger">⚠️ Camera Blocked</span>';
      if (micStatus) micStatus.innerHTML = '<span class="badge badge-danger">⚠️ Mic Blocked (Mandatory)</span>';
      updateSetupMicUI(false);
    }
  }

  function updateSetupMicUI(isActive) {
    const card = document.getElementById('mandatory-mic-card');
    const label = document.getElementById('mic-switch-label');
    const toggle = document.getElementById('checkbox-mic-toggle');
    const textDb = document.getElementById('setup-mic-db-text');
    const iconWrap = document.getElementById('mic-icon-wrapper');

    if (toggle) toggle.checked = isActive;

    if (isActive) {
      if (card) card.classList.remove('blocked');
      if (label) {
        label.style.color = '#10b981';
        label.textContent = '● Microphone: ON (Mandatory)';
      }
      if (textDb) {
        textDb.style.color = '#10b981';
        textDb.textContent = 'Active & Ready';
      }
      if (iconWrap) iconWrap.classList.remove('blocked');
    } else {
      if (card) card.classList.add('blocked');
      if (label) {
        label.style.color = '#ef4444';
        label.textContent = '● Microphone: OFF (Blocked)';
      }
      if (textDb) {
        textDb.style.color = '#ef4444';
        textDb.textContent = 'Blocked / Denied';
      }
      if (iconWrap) iconWrap.classList.add('blocked');
    }
  }

  function startSetupAudioMonitor(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (state.setupAudioContext && state.setupAudioContext.state !== 'closed') {
        state.setupAudioContext.close();
      }
      state.setupAudioContext = new AudioCtx();
      if (state.setupAudioContext.state === 'suspended') {
        state.setupAudioContext.resume();
      }
      const source = state.setupAudioContext.createMediaStreamSource(stream);
      state.setupAudioAnalyser = state.setupAudioContext.createAnalyser();
      state.setupAudioAnalyser.fftSize = 128;
      state.setupAudioAnalyser.smoothingTimeConstant = 0.3;
      source.connect(state.setupAudioAnalyser);
      const dataArr = new Uint8Array(state.setupAudioAnalyser.frequencyBinCount);

      const meterFill = document.getElementById('setup-audio-level-fill');
      const micIconWrap = document.getElementById('mic-icon-wrapper');

      function audioLoop() {
        if (!state.isMicrophoneActive || state.isExamActive || !state.setupAudioAnalyser) return;
        state.setupAudioAnalyser.getByteFrequencyData(dataArr);
        let sum = 0;
        for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
        const avg = sum / dataArr.length / 255;
        const pct = Math.min(100, Math.round(avg * 280));

        if (meterFill) {
          meterFill.style.width = Math.max(4, pct) + '%';
          meterFill.className = pct > 20 ? 'audio-level-meter-fill speaking' : 'audio-level-meter-fill';
        }
        if (micIconWrap) {
          if (pct > 20) {
            micIconWrap.classList.add('speaking');
          } else {
            micIconWrap.classList.remove('speaking');
          }
        }
        requestAnimationFrame(audioLoop);
      }
      audioLoop();
    } catch (e) {
      console.warn('Audio monitor init error:', e);
    }
  }

  function showMicMandatoryModal(title, customHtml) {
    const modal = document.getElementById('modal-mic-mandatory');
    const titleElem = document.getElementById('mic-modal-title');
    const bodyElem = document.getElementById('mic-modal-body');

    if (titleElem && title) titleElem.textContent = title;
    if (bodyElem && customHtml) bodyElem.innerHTML = customHtml;
    if (modal) modal.style.display = 'flex';
    playAlertSound('warning');
  }

  function setupEventListeners() {
    // Start Exam Button
    const btnStart = document.getElementById('btn-start-exam');
    if (btnStart) {
      btnStart.addEventListener('click', handleStartExam);
    }

    // Navigation buttons
    const btnNext = document.getElementById('btn-next-question');
    const btnPrev = document.getElementById('btn-prev-question');
    const btnFlag = document.getElementById('btn-flag-question');
    const btnSubmit = document.getElementById('btn-submit-exam');

    if (btnNext) btnNext.addEventListener('click', () => changeQuestion(state.currentQuestionIndex + 1));
    if (btnPrev) btnPrev.addEventListener('click', () => changeQuestion(state.currentQuestionIndex - 1));
    if (btnFlag) btnFlag.addEventListener('click', toggleFlagQuestion);
    if (btnSubmit) btnSubmit.addEventListener('click', confirmSubmitExam);

    // Live Simulator buttons for presentation & testing
    const btnSimHead = document.getElementById('btn-sim-head');
    const btnSimPhone = document.getElementById('btn-sim-phone');
    const btnSimApp = document.getElementById('btn-sim-app');

    if (btnSimHead) {
      btnSimHead.addEventListener('click', () => {
        handleViolationDetected({
          type: 'HEAD_MOVEMENT',
          severity: 'LOW',
          details: 'Candidate rotated face away from computer monitor.',
          snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
        });
      });
    }

    if (btnSimPhone) {
      btnSimPhone.addEventListener('click', () => {
        handleViolationDetected({
          type: 'PHONE_DETECTED',
          severity: 'CRITICAL',
          details: 'Unauthorized mobile phone appeared on camera feed.',
          snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
        });
      });
    }

    if (btnSimApp) {
      btnSimApp.addEventListener('click', () => {
        handleViolationDetected({
          type: 'TAB_SWITCH',
          severity: 'CRITICAL',
          details: 'Candidate opened third-party website / switched application tab.',
          snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
        });
      });
    }

    // Speech Simulator buttons
    const btnSimSpeechWarn = document.getElementById('btn-sim-speech-warn');
    if (btnSimSpeechWarn) {
      btnSimSpeechWarn.addEventListener('click', () => {
        handleViolationDetected({
          type: 'SPEECH_WARNING',
          severity: 'MEDIUM',
          details: 'Human speech detected for 6.2 seconds.',
          snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
        });
      });
    }

    const btnSimSpeechExpel = document.getElementById('btn-sim-speech-expel');
    if (btnSimSpeechExpel) {
      btnSimSpeechExpel.addEventListener('click', () => {
        handleViolationDetected({
          type: 'SPEECH_EXPULSION',
          severity: 'CRITICAL',
          details: 'Continuous human speech detected for over 2 minutes (120 seconds). Solitary protocol breached.',
          snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
        });
      });
    }

    // Live Simulator: Test Laptop Microphone Turn Off / Hardware Mute
    const btnSimMicMute = document.getElementById('btn-sim-mic-mute');
    if (btnSimMicMute) {
      btnSimMicMute.addEventListener('click', () => {
        if (state.proctorEngine && state.proctorEngine.handleMicMutedEvent) {
          state.proctorEngine.handleMicMutedEvent();
        } else {
          handleViolationDetected({
            type: 'MIC_MUTED_DURING_EXAM',
            severity: 'CRITICAL',
            details: 'Candidate attempted to turn off or mute laptop microphone during examination.'
          });
        }
      });
    }

    // Modal Action: Recover / Unmute Laptop Microphone
    const btnRecoverLaptopMic = document.getElementById('btn-recover-laptop-mic');
    if (btnRecoverLaptopMic) {
      btnRecoverLaptopMic.addEventListener('click', async () => {
        btnRecoverLaptopMic.disabled = true;
        btnRecoverLaptopMic.innerHTML = '⏳ Unmuting & Re-activating...';
        if (state.proctorEngine && state.proctorEngine.recoverMicrophone) {
          const ok = await state.proctorEngine.recoverMicrophone();
          if (ok) {
            const tamperModal = document.getElementById('modal-mic-tamper-warning');
            if (tamperModal) tamperModal.style.display = 'none';
            const hudCard = document.querySelector('.hud-mic-card');
            if (hudCard) hudCard.classList.remove('mic-tampered');
            showToast('✓ Laptop microphone unmuted & active!', 'success');
          } else {
            showToast('⚠️ Microphone still muted. Please press your laptop microphone key (F4/Fn+F4) or check browser permissions!', 'danger');
          }
        }
        btnRecoverLaptopMic.disabled = false;
        btnRecoverLaptopMic.innerHTML = '🎙️ Unmute & Re-activate Microphone Now &rarr;';
      });
    }

    // Lockdown: Prevent Candidate from Turning Off Mic via HUD
    const hudMicCard = document.getElementById('hud-mic-card');
    if (hudMicCard) {
      hudMicCard.addEventListener('click', () => {
        showToast('🔒 Microphone is locked ON. Turning off microphone while attending the exam is strictly prohibited!', 'warning');
        playAlertSound('warning');
      });
    }

    // Live Simulator: Drop Trust to <= 50% to trigger automatic termination demonstration
    const btnSimAutoDisqualify = document.getElementById('btn-sim-auto-disqualify');
    if (btnSimAutoDisqualify) {
      btnSimAutoDisqualify.addEventListener('click', async () => {
        showToast('⚡ Simulating severe breach: plunging integrity trust score to <= 50%...', 'danger');
        try {
          const res = await fetch('/api/session/' + state.session.id + '/violation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: state.session.id,
              type: 'CRITICAL_BREACH',
              severity: 'CRITICAL',
              details: 'CRITICAL INFRACTION: Unauthorized secondary display & real-time generative bot assistant detected. Trust dropped <= 50%.',
              snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
            })
          });
          const data = await res.json();
          if (data && data.remainingTrust !== undefined) {
            updateTrustScore(data.remainingTrust, data.violationsCount);
            if (data.remainingTrust <= 50 || data.isTerminated) {
              handleExamTerminated(data.terminationReason, data.remainingTrust, data.violationsCount);
            }
          }
        } catch (err) {
          console.error('Sim auto-disqualify failed:', err);
          handleExamTerminated('Automatic Disqualification: Integrity Trust Score breached 50% safety threshold.', 45, 1);
        }
      });
    }

    // Modal Close
    const btnCloseWarningModal = document.getElementById('btn-close-proctor-warning');
    if (btnCloseWarningModal) {
      btnCloseWarningModal.addEventListener('click', () => {
        document.getElementById('modal-proctor-warning').style.display = 'none';
      });
    }

    // MANDATORY MICROPHONE INTERACTIVE HANDLERS
    const micToggle = document.getElementById('checkbox-mic-toggle');
    if (micToggle) {
      micToggle.addEventListener('click', (e) => {
        // Intercept user attempt to turn off or toggle the mandatory microphone option
        e.preventDefault();
        micToggle.checked = true; // MUST REMAIN ON
        showMicMandatoryModal(
          "⚠️ Microphone Option is Mandatory",
          `<div style="font-size: 1.05rem; font-weight: 800; color: #f87171; margin-bottom: 8px;">
            🗣️ It is MUST to keep the Microphone ON to enter into the exam!
          </div>
          <div>
            The proctoring system enforces strict solitary speech acoustic monitoring:
          </div>
          <ul style="margin: 8px 0 8px 20px; padding: 0; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.6;">
            <li>Speaking aloud for <strong>5 to 10 seconds</strong> triggers an immediate audio warning.</li>
            <li>Speaking continuously for <strong>2 to 3 minutes</strong> will automatically terminate and end your exam.</li>
          </ul>
          <div style="font-weight: 700; color: #10b981; margin-top: 8px;">
            ✓ The microphone option is mandatory and has been kept ON.
          </div>`
        );
      });
    }

    const btnForceMicOn = document.getElementById('btn-force-mic-on');
    if (btnForceMicOn) {
      btnForceMicOn.addEventListener('click', async () => {
        const modal = document.getElementById('modal-mic-mandatory');
        if (modal) modal.style.display = 'none';
        const toggle = document.getElementById('checkbox-mic-toggle');
        if (toggle) toggle.checked = true;
        await checkCameraSupport();
        showToast('✓ Microphone is turned ON and verified as mandatory.', 'success');
      });
    }

    const btnRetestMic = document.getElementById('btn-retest-mic');
    if (btnRetestMic) {
      btnRetestMic.addEventListener('click', async () => {
        btnRetestMic.disabled = true;
        btnRetestMic.innerHTML = '⏳ Testing...';
        await checkCameraSupport();
        btnRetestMic.disabled = false;
        btnRetestMic.innerHTML = '🔄 Retest Mic';
        if (state.isMicrophoneActive) {
          showToast('✓ Microphone is active, tested, and ready.', 'success');
        } else {
          showMicMandatoryModal(
            "🛑 Microphone Access Required",
            `<div style="font-size: 1.05rem; font-weight: 800; color: #f87171; margin-bottom: 8px;">
              ⚠️ Microphone Permission Blocked or Missing!
            </div>
            <div>
              It is MUST to turn ON and allow microphone access in your browser to enter the exam.
            </div>`
          );
        }
      });
    }
  }

  // --- START EXAM ---
  async function handleStartExam() {
    const candidateName = document.getElementById('input-candidate-name').value.trim() || 'Candidate User';
    const candidateRoll = document.getElementById('input-candidate-roll').value.trim();

    // STRICT VALIDATION: Roll Number must start with '2422k'
    if (!candidateRoll || !candidateRoll.toLowerCase().startsWith('2422k')) {
      alert("Access Denied: Invalid Student Roll Number format. Candidate Roll Number must begin with '2422K' (e.g. 2422K042, 2422K081).");
      window.location.href = 'student-login.html';
      return;
    }

    // STRICT VALIDATION 2: Microphone MUST BE ON (Mandatory to enter exam)
    const micToggleEl = document.getElementById('checkbox-mic-toggle');
    const isMicChecked = micToggleEl ? micToggleEl.checked : true;
    if (!state.isMicrophoneActive || !isMicChecked) {
      showMicMandatoryModal(
        "🛑 Entry Blocked: Microphone Must Be Turned ON",
        `<div style="font-size: 1.05rem; font-weight: 800; color: #f87171; margin-bottom: 8px;">
          ⚠️ It is MUST to turn ON the Microphone before entering the exam!
        </div>
        <div>
          The proctoring system enforces strict solitary speech acoustic monitoring:
        </div>
        <ul style="margin: 8px 0 8px 20px; padding: 0; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.6;">
          <li>Speaking for <strong>5 to 10 seconds</strong> gives an audio disciplinary warning.</li>
          <li>Speaking continuously for <strong>2 to 3 minutes</strong> automatically ends and terminates your exam.</li>
        </ul>
        <div style="font-weight: 700; color: #fca5a5; margin-top: 8px;">
          Please grant browser microphone permission and ensure the microphone option is ON to enter into the exam.
        </div>`
      );
      return;
    }

    // Clean up setup preview stream before launching proctor engine
    if (state.setupMediaStream) {
      state.setupMediaStream.getTracks().forEach(t => t.stop());
      state.setupMediaStream = null;
    }
    if (state.setupAudioContext && state.setupAudioContext.state !== 'closed') {
      state.setupAudioContext.close();
      state.setupAudioContext = null;
    }

    // Request Fullscreen
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (fsErr) {
      console.warn('Fullscreen request bypassed by browser:', fsErr);
    }

    // Register Session on Server with Selected Exam
    const chosenExamId = state.selectedExamId || 'exam-cs402';
    try {
      const regRes = await fetch('/api/sessions/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateName,
          candidateRoll,
          examId: chosenExamId
        })
      });
      const data = await regRes.json();
      state.session = data.session;
    } catch (e) {
      console.error('Registration failed:', e);
      state.session = {
        id: 'sess-stu-local',
        candidateName,
        candidateRoll,
        examId: chosenExamId,
        trustScore: 100,
        violationsCount: 0
      };
    }

    // Fetch Exam Questions for chosen exam
    try {
      const examRes = await fetch(`/api/exam/${chosenExamId}`);
      const examData = await examRes.json();
      state.exam = examData.exam;
      if (state.exam && state.exam.durationMinutes) {
        state.remainingSeconds = state.exam.durationMinutes * 60;
      }
    } catch (e) {
      console.error('Failed to load exam:', e);
    }

    // Switch to Exam Screen
    screens.setup.style.display = 'none';
    screens.exam.style.display = 'block';
    state.isExamActive = true;

    // Display Candidate Info & Exam Title
    document.getElementById('display-candidate-name').textContent = state.session.candidateName;
    document.getElementById('display-candidate-roll').textContent = state.session.candidateRoll;

    const displayHeader = document.getElementById('display-exam-header');
    if (displayHeader && state.exam) {
      displayHeader.textContent = `${state.exam.examCode || 'EXAM'}: ${state.exam.title} (${state.exam.institutionName})`;
    }

    // Reset automated Face Rotation counter
    state.faceRotationWarnings = 0;
    updateFaceRotationHUD(0);

    // Initialize AI Proctoring Engine
    initializeAIProctor();

    // Attach Lockdown Security Listeners
    setupLockdownHandlers();

    // Connect to Student Real-time SSE Channel
    connectStudentEvents();

    // Start Timer
    startExamTimer();

    // Build Question Palette & Render First Question
    buildQuestionPalette();
    renderQuestion(0);

    // Display instant notification that autonomous proctoring actions are live
    showToast('🤖 Autonomous AI Proctor Active: Real-time action & strike enforcement initialized. Zero admin check required.', 'info');
  }

  // --- INITIALIZE AI PROCTORING ENGINE ---
  async function initializeAIProctor() {
    const video = document.getElementById('proctor-live-video');
    const canvas = document.getElementById('proctor-hud-canvas');

    state.proctorEngine = new window.AIProctorEngine({
      videoElement: video,
      canvasElement: canvas,
      onViolation: handleViolationDetected,
      onStatusUpdate: updateProctorStatusHUD,
      onAudioUpdate: updateAudioStatusHUD,
      onMicMuteStateChange: handleMicMuteStateChange
    });

    try {
      await state.proctorEngine.initialize();
      state.proctorEngine.start();
      console.log('🛡️ AI Proctoring Engine Active and Monitoring.');
    } catch (err) {
      console.error('Proctor camera init failed:', err);
      showToast('⚠️ Camera access denied. Examination requires camera feed!', 'danger');
    }
  }

  // --- LAPTOP MICROPHONE MUTING INTEGRITY CONTROLLER ---
  function handleMicMuteStateChange(muteData) {
    const tamperModal = document.getElementById('modal-mic-tamper-warning');
    const hudMicStatus = document.getElementById('hud-mic-status');
    const hudCard = document.querySelector('.hud-mic-card');

    if (muteData.isMuted) {
      playAlertSound('danger');
      if (tamperModal) tamperModal.style.display = 'flex';
      if (hudMicStatus) {
        hudMicStatus.className = 'badge badge-danger';
        hudMicStatus.innerHTML = '🛑 LAPTOP MIC MUTED';
      }
      if (hudCard) {
        hudCard.classList.add('mic-tampered');
      }
      showToast('🛑 LAPTOP MICROPHONE MUTED! Turning off mic is strictly prohibited. Unmute now!', 'danger');
    } else {
      if (tamperModal) tamperModal.style.display = 'none';
      if (hudCard) {
        hudCard.classList.remove('mic-tampered');
      }
      if (hudMicStatus) {
        hudMicStatus.className = 'badge badge-success';
        hudMicStatus.innerHTML = '✓ Silent / Clear';
      }
      showToast('✓ Laptop microphone unmuted & active.', 'success');
    }
  }

  // --- FULLY AUTOMATED PROCTORING VIOLATION & ACTION CONTROLLER ---
  async function handleViolationDetected(violation) {
    if (!state.isExamActive) return;

    // RULE 0: LAPTOP MICROPHONE MUTED / TURNED OFF DURING EXAM
    if (violation.type === 'MIC_MUTED_DURING_EXAM') {
      playAlertSound('danger');
      showToast('🛑 LAPTOP MICROPHONE MUTED! Turning off mic is strictly prohibited!', 'danger');
      const tamperModal = document.getElementById('modal-mic-tamper-warning');
      if (tamperModal) tamperModal.style.display = 'flex';

      const hudMicStatus = document.getElementById('hud-mic-status');
      if (hudMicStatus) {
        hudMicStatus.className = 'badge badge-danger';
        hudMicStatus.innerHTML = '🛑 LAPTOP MIC MUTED';
      }
      const hudCard = document.querySelector('.hud-mic-card');
      if (hudCard) hudCard.classList.add('mic-tampered');

      fetch('/api/session/' + state.session.id + '/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          type: 'MIC_MUTED_DURING_EXAM',
          severity: 'CRITICAL',
          details: violation.details || 'Candidate turned off or muted laptop microphone during active examination.',
          snapshot: violation.snapshot
        })
      }).then(res => res.json()).then(data => {
        if (data && data.remainingTrust !== undefined) {
          updateTrustScore(data.remainingTrust, data.violationsCount);
        }
      }).catch(() => {});
      return;
    }

    // RULE 1: PHONE COMES ON CAMERA -> IMMEDIATE AUTOMATIC EXPULSION / TERMINATION (ZERO WARNINGS)
    const isPhone = violation.type === 'PHONE_DETECTED' || 
      (violation.type === 'OBJECT_DETECTED' && violation.details && violation.details.toLowerCase().includes('phone'));

    if (isPhone) {
      playAlertSound('danger');
      showToast('🛑 IMMEDIATE EXPULSION: Mobile phone detected on camera!', 'danger');
      const reason = 'Automatic Immediate Disqualification: Mobile phone detected on camera. Solitary exam protocol strictly prohibits electronic devices.';
      
      const warnModal = document.getElementById('modal-proctor-warning');
      if (warnModal) warnModal.style.display = 'none';

      fetch('/api/session/' + state.session.id + '/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          type: 'PHONE_DETECTED',
          severity: 'CRITICAL',
          details: 'CRITICAL INFRACTION: Mobile phone appeared on camera feed. Immediate automatic expulsion triggered.',
          snapshot: violation.snapshot
        })
      }).catch(() => {});

      handleExamTerminated(reason, 0, (state.session ? state.session.violationsCount : 0) + 1);
      return;
    }

    // RULE 2: THIRD-PARTY WEBSITE / TAB SWITCH / WINDOW BLUR / FULLSCREEN EXIT -> IMMEDIATE AUTOMATIC EXPULSION (ZERO WARNINGS)
    const isThirdPartyOrTab = violation.type === 'TAB_SWITCH' || 
      violation.type === 'FULLSCREEN_EXIT' || 
      violation.type === 'BACKGROUND_PROCESS' || 
      violation.type === 'THIRD_PARTY_SITE';

    if (isThirdPartyOrTab) {
      playAlertSound('danger');
      showToast('🛑 IMMEDIATE EXPULSION: Third-party website / tab switch detected!', 'danger');
      const reason = `Automatic Immediate Disqualification: Third-party website / unauthorized tab switch detected. Full browser lockdown breached.`;

      const warnModal = document.getElementById('modal-proctor-warning');
      if (warnModal) warnModal.style.display = 'none';

      fetch('/api/session/' + state.session.id + '/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          type: violation.type,
          severity: 'CRITICAL',
          details: violation.details || 'Unauthorized third-party website / application opened by candidate.',
          snapshot: violation.snapshot
        })
      }).catch(() => {});

      handleExamTerminated(reason, 0, (state.session ? state.session.violationsCount : 0) + 1);
      return;
    }

    // RULE 3A: CONTINUOUS SPEECH FOR 2 TO 3 MINUTES -> IMMEDIATE AUTOMATIC EXPULSION
    if (violation.type === 'SPEECH_EXPULSION') {
      playAlertSound('danger');
      showToast('🛑 IMMEDIATE EXPULSION: Speaking continuously for over 2 minutes!', 'danger');
      const reason = 'Automatic Disqualification: Continuous human speech detected for over 2 minutes (120s). Solitary examination protocol strictly prohibits verbal communication.';

      const warnModal = document.getElementById('modal-proctor-warning');
      if (warnModal) warnModal.style.display = 'none';

      fetch('/api/session/' + state.session.id + '/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          type: 'SPEECH_EXPULSION',
          severity: 'CRITICAL',
          details: violation.details || 'Continuous human speech for over 2 minutes detected by acoustic microphone sensor.',
          snapshot: violation.snapshot
        })
      }).catch(() => {});

      handleExamTerminated(reason, 0, (state.session ? state.session.violationsCount : 0) + 1);
      return;
    }

    // RULE 3B: INITIAL 5 TO 10 SECONDS OF SPEECH -> ISSUE WARNING ("Do not speak, if you speak 2-3 mins exam will end")
    if (violation.type === 'SPEECH_WARNING') {
      playAlertSound('warning');
      showToast('⚠️ AUDIO WARNING: Do not speak! If you speak for 2-3 mins the exam will end!', 'warning');
      showSpeechWarningModal(violation);

      fetch('/api/session/' + state.session.id + '/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          type: 'SPEECH_WARNING',
          severity: 'MEDIUM',
          details: violation.details || 'Acoustic sensor detected human speech for 5-10 seconds. Speech warning issued.',
          snapshot: violation.snapshot
        })
      }).then(res => res.json()).then(data => {
        if (data && data.remainingTrust !== undefined) {
          updateTrustScore(data.remainingTrust, data.violationsCount);
        }
      }).catch(() => {});
      return;
    }

    // RULE 3: ROTATED FACE -> 1ST WARNING, 2ND WARNING, 3RD WARNING, 4TH OCCURRENCE = AUTOMATIC EXPULSION ("comes out")
    const isFaceRotation = violation.type === 'HEAD_MOVEMENT' || violation.type === 'FACE_ROTATION';

    if (isFaceRotation) {
      state.faceRotationWarnings = (state.faceRotationWarnings || 0) + 1;
      updateFaceRotationHUD(state.faceRotationWarnings);

      // 4TH OCCURRENCE -> EXPELLED AUTOMATICALLY
      if (state.faceRotationWarnings >= 4) {
        playAlertSound('danger');
        showToast('🛑 EXAM TERMINATED: 4th Face Rotation reached. Expelled from exam!', 'danger');
        const reason = 'Automatic Disqualification: Candidate rotated face 4 times. Maximum allowed 3 warnings exceeded. Exam terminated automatically.';

        const warnModal = document.getElementById('modal-proctor-warning');
        if (warnModal) warnModal.style.display = 'none';

        fetch('/api/session/' + state.session.id + '/violation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.session.id,
            type: 'FACE_ROTATION_EXCEEDED',
            severity: 'CRITICAL',
            details: '4th face rotation occurrence detected. Expulsion threshold (4/4) reached.',
            snapshot: violation.snapshot
          })
        }).catch(() => {});

        handleExamTerminated(reason, 35, state.faceRotationWarnings);
        return;
      }

      // 1ST, 2ND, OR 3RD WARNING
      playAlertSound('warning');
      showFaceRotationWarningModal(state.faceRotationWarnings, violation);

      fetch('/api/session/' + state.session.id + '/violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          type: 'HEAD_MOVEMENT',
          severity: state.faceRotationWarnings === 3 ? 'HIGH' : 'MEDIUM',
          details: `Face rotation occurrence #${state.faceRotationWarnings}. Warning ${state.faceRotationWarnings} of 3 issued automatically.`,
          snapshot: violation.snapshot
        })
      }).then(res => res.json()).then(data => {
        if (data && data.remainingTrust !== undefined) {
          updateTrustScore(data.remainingTrust, data.violationsCount);
        }
      }).catch(() => {});

      return;
    }

    // Fallback: General other violation (e.g. multiple faces, audio)
    playAlertSound('danger');
    showToast(`🚨 VIOLATION: ${violation.details}`, 'danger');
    fetch('/api/session/' + state.session.id + '/violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.session.id,
        type: violation.type,
        severity: violation.severity || 'MEDIUM',
        details: violation.details,
        snapshot: violation.snapshot
      })
    }).then(res => res.json()).then(data => {
      if (data && data.remainingTrust !== undefined) {
        updateTrustScore(data.remainingTrust, data.violationsCount);
        if (data.isTerminated || data.remainingTrust <= 50) {
          handleExamTerminated(data.terminationReason, data.remainingTrust, data.violationsCount);
        }
      }
    }).catch(() => {});
  }

  // --- DISPLAY FACE ROTATION WARNING MODAL (1ST, 2ND, 3RD WARNING) ---
  function showFaceRotationWarningModal(count, violation) {
    const modal = document.getElementById('modal-proctor-warning');
    const modalTitle = document.getElementById('proctor-warning-title');
    const strikeLabel = document.getElementById('ai-strike-label');
    const warnText = document.getElementById('proctor-warning-text');
    const penaltyInfo = document.getElementById('modal-strike-penalty-info');
    const pill1 = document.getElementById('strike-pill-1');
    const pill2 = document.getElementById('strike-pill-2');
    const pill3 = document.getElementById('strike-pill-3');
    const pill4 = document.getElementById('strike-pill-4');

    if (modalTitle) {
      if (count === 1) {
        modalTitle.textContent = '⚠️ 1st Warning: Face Rotation Detected';
      } else if (count === 2) {
        modalTitle.textContent = '⚠️ 2nd Warning: Face Rotation Detected Again';
      } else if (count === 3) {
        modalTitle.textContent = '🛑 3rd Warning: FINAL WARNING - Face Rotation';
      }
    }

    if (strikeLabel) {
      strikeLabel.textContent = `Warning ${count} of 3 (4th = Auto Expulsion)`;
    }

    if (pill1) pill1.className = count >= 1 ? 'strike-pill active' : 'strike-pill';
    if (pill2) pill2.className = count >= 2 ? 'strike-pill active' : 'strike-pill';
    if (pill3) pill3.className = count >= 3 ? 'strike-pill active' : 'strike-pill';
    if (pill4) pill4.className = 'strike-pill';

    if (warnText) {
      if (count === 1) {
        warnText.innerHTML = `<strong>1st Warning:</strong> Your face turned or rotated away from the exam screen.<br><br>Please keep your face directly oriented towards the center of your monitor.<br><br><span style="color: #fbbf24; font-weight: 600;">Rule: You are allowed 3 warnings. A 4th face rotation will automatically terminate and disqualify your exam.</span>`;
      } else if (count === 2) {
        warnText.innerHTML = `<strong>2nd Warning:</strong> Your face rotated away a second time.<br><br>Only 1 warning remains! Keep your eyes and face on the screen at all times.<br><br><span style="color: #f87171; font-weight: 600;">⚠️ 2 of 3 warnings used. Next is your final warning.</span>`;
      } else if (count === 3) {
        warnText.innerHTML = `<strong>🛑 FINAL WARNING (3rd):</strong> Your face rotated away for the third time.<br><br><strong style="color: #f87171; font-size: 1.05rem;">CRITICAL: If you rotate your face one more time (4th occurrence), the AI proctor will AUTOMATICALLY EXPEL and TERMINATE your exam immediately with ZERO further warnings!</strong>`;
      }
    }

    if (penaltyInfo) {
      penaltyInfo.textContent = `Warning ${count} of 3 Issued Automatically • 4th Rotation = Auto Disqualification`;
    }

    if (modal) {
      modal.style.display = 'flex';
    }
  }

  // --- UPDATE HUD FACE ROTATION COUNTER ---
  function updateFaceRotationHUD(count) {
    const badge = document.getElementById('hud-strikes-count');
    const dot1 = document.getElementById('hud-strike-dot-1');
    const dot2 = document.getElementById('hud-strike-dot-2');
    const dot3 = document.getElementById('hud-strike-dot-3');
    const dot4 = document.getElementById('hud-strike-dot-4');

    if (badge) {
      if (count === 0) {
        badge.className = 'badge badge-success';
        badge.textContent = '0 / 3 Face Warnings';
      } else if (count === 1) {
        badge.className = 'badge badge-warning';
        badge.textContent = '1 / 3 (Warned)';
      } else if (count === 2) {
        badge.className = 'badge badge-warning';
        badge.textContent = '2 / 3 (Critical)';
      } else if (count === 3) {
        badge.className = 'badge badge-danger';
        badge.textContent = '3 / 3 (FINAL)';
      } else {
        badge.className = 'badge badge-danger';
        badge.textContent = '4 / 4 (TERMINATED)';
      }
    }

    if (dot1) {
      dot1.className = count >= 1 ? 'hud-strike-dot active' : 'hud-strike-dot';
      dot1.textContent = count >= 1 ? '1: Warned' : '1: Safe';
    }
    if (dot2) {
      dot2.className = count >= 2 ? 'hud-strike-dot active' : 'hud-strike-dot';
      dot2.textContent = count >= 2 ? '2: Warned' : '2: Safe';
    }
    if (dot3) {
      dot3.className = count >= 3 ? 'hud-strike-dot active' : 'hud-strike-dot';
      dot3.textContent = count >= 3 ? '3: FINAL' : '3: Safe';
    }
    if (dot4) {
      dot4.className = count >= 4 ? 'hud-strike-dot active' : 'hud-strike-dot';
      dot4.textContent = count >= 4 ? '4: EXPELLED' : '4: Expel';
    }
  }

  // --- DISPLAY SPEECH WARNING MODAL (5-10 SECONDS SPEAKING) ---
  function showSpeechWarningModal(violation) {
    const modal = document.getElementById('modal-proctor-warning');
    const modalTitle = document.getElementById('proctor-warning-title');
    const strikeLabel = document.getElementById('ai-strike-label');
    const warnText = document.getElementById('proctor-warning-text');
    const penaltyInfo = document.getElementById('modal-strike-penalty-info');

    if (modalTitle) {
      modalTitle.textContent = '⚠️ Audio Warning: Speech Detected! Do Not Speak';
    }

    if (strikeLabel) {
      strikeLabel.textContent = 'Microphone Alert: Speaking Detected';
    }

    if (warnText) {
      warnText.innerHTML = `
        <div style="font-size: 1.05rem; font-weight: 700; color: #fbbf24; margin-bottom: 8px;">
          🗣️ DO NOT SPEAK!
        </div>
        <div>
          The microphone sensor detected you speaking or talking aloud for <strong>5 to 10 seconds</strong>.
        </div>
        <br>
        <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 4px; padding: 12px; color: #f87171; font-weight: 600;">
          🛑 RULE ENFORCEMENT: If you speak continuously or simultaneously for <strong>2 to 3 minutes</strong>, your examination will automatically end and you will be expelled immediately!
        </div>
      `;
    }

    if (penaltyInfo) {
      penaltyInfo.textContent = 'Verbal Warning Issued • Strict Silence Enforced';
    }

    if (modal) {
      modal.style.display = 'flex';
    }
  }

  // --- UPDATE HUD LIVE MICROPHONE & SPEECH STATUS ---
  function updateAudioStatusHUD(audioData) {
    const micStatus = document.getElementById('hud-mic-status');
    const levelFill = document.getElementById('hud-audio-level-fill');
    const timerText = document.getElementById('hud-speech-timer-text');

    if (levelFill) {
      levelFill.style.width = Math.min(100, Math.max(4, audioData.level)) + '%';
      if (audioData.isSpeaking) {
        levelFill.className = audioData.speechDuration >= 5 ? 'audio-level-meter-fill danger' : 'audio-level-meter-fill speaking';
      } else {
        levelFill.className = 'audio-level-meter-fill';
      }
    }

    if (micStatus) {
      if (audioData.isSpeaking) {
        if (audioData.speechDuration >= 5) {
          micStatus.className = 'badge badge-danger';
          micStatus.innerHTML = `⚠️ Speaking: ${audioData.speechDuration}s / 120s`;
        } else {
          micStatus.className = 'badge badge-warning';
          micStatus.innerHTML = `🗣️ Voice Detected (${audioData.speechDuration}s)`;
        }
      } else {
        micStatus.className = 'badge badge-success';
        micStatus.innerHTML = '✓ Silent / Clear';
      }
    }

    if (timerText) {
      timerText.textContent = `Speaking: ${audioData.speechDuration || 0}s / 120s`;
      if (audioData.speechDuration >= 5) {
        timerText.style.color = '#f87171';
        timerText.style.fontWeight = '700';
      } else {
        timerText.style.color = 'var(--text-muted)';
        timerText.style.fontWeight = 'normal';
      }
    }
  }

  function updateTrustScore(score, count) {
    const fill = document.getElementById('trust-fill');
    const valText = document.getElementById('trust-value');
    const violBadge = document.getElementById('violations-count-badge');

    if (valText) valText.textContent = `${score}%`;
    if (violBadge) violBadge.textContent = `${count} Alert${count === 1 ? '' : 's'}`;

    if (fill) {
      fill.style.width = `${Math.max(0, Math.min(100, score))}%`;
      if (score > 75) {
        fill.style.background = 'var(--blue-gradient)';
      } else if (score > 50) {
        fill.style.background = 'var(--warning-gradient)';
      } else {
        fill.style.background = 'var(--danger-gradient)';
      }
    }

    // AUTOMATIC TERMINATION ENFORCEMENT: If trust score is 50% or below, end exam immediately
    if (score <= 50 && state.isExamActive) {
      const modal = document.getElementById('modal-proctor-warning');
      if (modal) modal.style.display = 'none';
      handleExamTerminated(
        `Autonomous Disqualification: Integrity Trust Score dropped to ${score}% (<= 50% threshold reached). Executed automatically by AI.`,
        score,
        count
      );
    }
  }

  function updateProctorStatusHUD(status) {
    const poseBadge = document.getElementById('hud-head-pose');
    const faceBadge = document.getElementById('hud-face-status');
    const objectBadge = document.getElementById('hud-object-status');

    if (poseBadge) {
      if (status.headPose === 'CENTER') {
        poseBadge.innerHTML = '<span class="badge badge-success">✓ Looking Forward</span>';
      } else {
        poseBadge.innerHTML = `<span class="badge badge-danger">⚠️ ${status.headPose.replace('_', ' ')}</span>`;
      }
    }

    if (faceBadge) {
      if (status.faceCount === 1) {
        faceBadge.innerHTML = '<span class="badge badge-success">1 Verified</span>';
      } else if (status.faceCount === 0) {
        faceBadge.innerHTML = '<span class="badge badge-danger">No Face Found</span>';
      } else {
        faceBadge.innerHTML = `<span class="badge badge-danger">⚠️ Multiple Faces (${status.faceCount})</span>`;
      }
    }

    if (objectBadge) {
      if (status.unauthorizedObjects.length === 0) {
        objectBadge.innerHTML = '<span class="badge badge-success">Clean Area</span>';
      } else {
        objectBadge.innerHTML = `<span class="badge badge-danger">⚠️ ${status.unauthorizedObjects.join(', ')}</span>`;
      }
    }
  }

  // --- LOCKDOWN SECURITY ENFORCEMENT ---
  function setupLockdownHandlers() {
    // 1. Tab Switching & Window Minimization Detection
    document.addEventListener('visibilitychange', () => {
      if (!state.isExamActive) return;
      if (document.hidden) {
        handleViolationDetected({
          type: 'TAB_SWITCH',
          severity: 'HIGH',
          details: 'Candidate navigated away from exam tab / minimized browser window.',
          snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
        });
      }
    });

    window.addEventListener('blur', () => {
      if (!state.isExamActive) return;
      handleViolationDetected({
        type: 'TAB_SWITCH',
        severity: 'MEDIUM',
        details: 'Exam window lost active operating system focus (Candidate clicked another window).',
        snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
      });
    });

    // 2. Fullscreen Exit Detection
    document.addEventListener('fullscreenchange', () => {
      if (!state.isExamActive) return;
      if (!document.fullscreenElement) {
        handleViolationDetected({
          type: 'FULLSCREEN_EXIT',
          severity: 'HIGH',
          details: 'Candidate exited compulsory full-screen examination mode.',
          snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
        });
      }
    });

    // 3. Disable Context Menu (Right Click)
    document.addEventListener('contextmenu', e => {
      if (state.isExamActive) {
        e.preventDefault();
        showToast('🔒 Right-click inspect is disabled during examination.', 'warning');
      }
    });

    // 4. Disable DevTools & Shortcut keys
    document.addEventListener('keydown', e => {
      if (!state.isExamActive) return;

      // F12 or Ctrl+Shift+I or Ctrl+Shift+J or Ctrl+U or Ctrl+C / Ctrl+V
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
        (e.ctrlKey && (e.key === 'u' || e.key === 'U' || e.key === 's' || e.key === 'S'))
      ) {
        e.preventDefault();
        showToast('🔒 Developer shortcuts & source inspection are strictly prohibited.', 'warning');
      }

      // Copy / Paste attempt
      if (e.ctrlKey && (e.key === 'c' || e.key === 'v' || e.key === 'C' || e.key === 'V')) {
        e.preventDefault();
        handleViolationDetected({
          type: 'COPY_PASTE',
          severity: 'MEDIUM',
          details: 'Unauthorized clipboard copy/paste shortcut attempted by candidate.',
          snapshot: state.proctorEngine ? state.proctorEngine.captureSnapshot() : null
        });
      }
    });
  }

  // --- REAL-TIME SSE MESSAGING FROM PROCTOR ADMIN ---
  function connectStudentEvents() {
    if (!state.session || !state.session.id) return;
    try {
      state.eventSource = new EventSource('/api/student-events/' + state.session.id);

      state.eventSource.addEventListener('proctor_warning', e => {
        const data = JSON.parse(e.data);
        playAlertSound('danger');
        document.getElementById('proctor-warning-text').textContent = data.message;
        document.getElementById('modal-proctor-warning').style.display = 'flex';
      });

      state.eventSource.addEventListener('exam_terminated', e => {
        const data = JSON.parse(e.data);
        handleExamTerminated(data.reason, data.trustScore, data.violationsCount);
      });
    } catch (e) {
      console.warn('SSE connection failed:', e);
    }
  }

  // --- AUTOMATIC EXAM TERMINATION / DISQUALIFICATION CONTROLLER ---
  function handleExamTerminated(reason, trustScore, violationsCount) {
    // Avoid duplicate execution if already terminated
    if (!state.isExamActive && screens.terminated && screens.terminated.style.display === 'block') {
      return;
    }
    state.isExamActive = false;

    // 1. Halt examination timer
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }

    // 2. Halt AI proctoring computer vision engine & release camera hardware
    if (state.proctorEngine) {
      try {
        state.proctorEngine.stop();
        if (state.proctorEngine.stream) {
          state.proctorEngine.stream.getTracks().forEach(t => t.stop());
        }
      } catch (err) {
        console.warn('Error stopping proctor stream:', err);
      }
    }

    // 3. Play high-pitch critical disqualification audio
    playAlertSound('danger');

    // 4. Exit fullscreen if enforced
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (e) {}

    // 5. Dismiss any open warning modal
    const warnModal = document.getElementById('modal-proctor-warning');
    if (warnModal) warnModal.style.display = 'none';

    // 6. Transition screens immediately to the Disqualification UI
    if (screens.setup) screens.setup.style.display = 'none';
    if (screens.exam) screens.exam.style.display = 'none';
    if (screens.result) screens.result.style.display = 'none';
    if (screens.terminated) {
      screens.terminated.style.display = 'block';
    }

    // 7. Populate candidate telemetry & forensic reason
    const finalTrust = trustScore !== undefined ? trustScore : (state.session ? state.session.trustScore : 50);
    const totalViolations = violationsCount !== undefined ? violationsCount : (state.session ? state.session.violationsCount : 1);
    const disqualificationReason = reason || `Automatic Disqualification: Integrity Trust Score dropped to ${finalTrust}% (50% safety limit breached).`;

    const nameElem = document.getElementById('term-candidate-name');
    const rollElem = document.getElementById('term-candidate-roll');
    const trustElem = document.getElementById('term-trust-score');
    const countElem = document.getElementById('term-violations-count');
    const reasonElem = document.getElementById('term-reason-text');
    const reportBtn = document.getElementById('term-report-btn');

    if (nameElem && state.session) nameElem.textContent = state.session.candidateName || 'Candidate';
    if (rollElem && state.session) rollElem.textContent = state.session.candidateRoll || 'CS2026-N/A';
    if (trustElem) trustElem.textContent = `${finalTrust}%`;
    if (countElem) countElem.textContent = `${totalViolations}`;
    if (reasonElem) reasonElem.textContent = disqualificationReason;

    if (reportBtn && state.session && state.session.id) {
      reportBtn.href = `report.html?sessionId=${encodeURIComponent(state.session.id)}`;
    }

    showToast('🛑 EXAM AUTOMATICALLY TERMINATED: Trust level reached 50% or below.', 'danger');
    console.warn(`🛑 [DISQUALIFICATION] Examination ended automatically. Trust Score: ${finalTrust}%, Infractions: ${totalViolations}.`);
  }

  // --- SIMULATION OF BACKGROUND APP BREACH ---
  async function simulateBackgroundAppBreach() {
    showToast('Simulating background process detection (Discord.exe)...', 'warning');
    try {
      const res = await fetch('/api/proctor/processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          unauthorizedProcesses: [
            { name: 'Discord Communication App', exe: 'Discord.exe', pid: 14280, risk: 'HIGH' }
          ]
        })
      });
      const data = await res.json();
      playAlertSound('danger');

      if (data && data.remainingTrust !== undefined) {
        updateTrustScore(data.remainingTrust, data.violationsCount);
        if (data.remainingTrust <= 50 || data.isTerminated) {
          handleExamTerminated(data.terminationReason, data.remainingTrust, data.violationsCount);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  // --- TIMER ---
  function startExamTimer() {
    const timerElem = document.getElementById('exam-countdown');
    state.timerInterval = setInterval(() => {
      state.remainingSeconds--;
      if (state.remainingSeconds <= 0) {
        clearInterval(state.timerInterval);
        alert('Time has expired! Automatically submitting your examination.');
        submitExam();
        return;
      }

      const mins = Math.floor(state.remainingSeconds / 60);
      const secs = state.remainingSeconds % 60;
      timerElem.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

      if (state.remainingSeconds < 300) {
        document.getElementById('timer-container').classList.add('timer-warning');
      }
    }, 1000);
  }

  // --- QUESTIONS & NAVIGATION ---
  function buildQuestionPalette() {
    const container = document.getElementById('question-palette');
    container.innerHTML = '';
    const total = state.exam.questions.length;

    for (let i = 0; i < total; i++) {
      const btn = document.createElement('button');
      btn.className = `palette-btn ${i === 0 ? 'current' : ''}`;
      btn.textContent = i + 1;
      btn.id = `palette-btn-${i}`;
      btn.addEventListener('click', () => changeQuestion(i));
      container.appendChild(btn);
    }
  }

  function renderQuestion(index) {
    state.currentQuestionIndex = index;
    const q = state.exam.questions[index];
    const total = state.exam.questions.length;

    // Update Header Counter
    document.getElementById('current-question-num').textContent = `Question ${index + 1} of ${total}`;
    document.getElementById('current-question-marks').textContent = `[${q.marks} Marks]`;

    // Render Question Text
    document.getElementById('question-body-text').textContent = q.question;

    // Render Code Block if present
    const codeContainer = document.getElementById('question-code-block');
    if (q.codeSnippet) {
      codeContainer.style.display = 'block';
      codeContainer.textContent = q.codeSnippet;
    } else {
      codeContainer.style.display = 'none';
    }

    // Render Options or Subjective Input
    const optionsContainer = document.getElementById('question-options-container');
    const subjectiveContainer = document.getElementById('question-subjective-container');

    if (q.type === 'mcq' || q.type === 'code') {
      optionsContainer.style.display = 'flex';
      subjectiveContainer.style.display = 'none';
      optionsContainer.innerHTML = '';

      q.options.forEach((optText, optIdx) => {
        const item = document.createElement('div');
        const isSelected = state.answers[q.id] === optIdx;
        item.className = `option-item ${isSelected ? 'selected' : ''}`;
        item.innerHTML = `
          <div class="option-circle"></div>
          <div style="font-size: 1.05rem;">${optText}</div>
        `;
        item.addEventListener('click', () => {
          state.answers[q.id] = optIdx;
          renderQuestion(index);
          updatePaletteStatus(index);
        });
        optionsContainer.appendChild(item);
      });
    } else if (q.type === 'subjective') {
      optionsContainer.style.display = 'none';
      subjectiveContainer.style.display = 'block';
      const textarea = document.getElementById('subjective-answer-input');
      textarea.value = state.answers[q.id] || '';
      textarea.oninput = () => {
        state.answers[q.id] = textarea.value;
        updatePaletteStatus(index);
      };
    }

    // Update Flag Button state
    const flagBtn = document.getElementById('btn-flag-question');
    if (state.flaggedQuestions.has(q.id)) {
      flagBtn.innerHTML = '🚩 Unflag';
      flagBtn.classList.add('btn-warning');
    } else {
      flagBtn.innerHTML = '🏳️ Flag for Review';
      flagBtn.classList.remove('btn-warning');
    }

    // Update Prev / Next Button disabled states
    document.getElementById('btn-prev-question').disabled = index === 0;
    const nextBtn = document.getElementById('btn-next-question');
    if (index === total - 1) {
      nextBtn.style.display = 'none';
      document.getElementById('btn-submit-exam').style.display = 'inline-flex';
    } else {
      nextBtn.style.display = 'inline-flex';
      document.getElementById('btn-submit-exam').style.display = 'none';
    }

    // Update Palette Current marker
    document.querySelectorAll('.palette-btn').forEach((b, idx) => {
      b.classList.toggle('current', idx === index);
    });
  }

  function changeQuestion(newIndex) {
    if (newIndex >= 0 && newIndex < state.exam.questions.length) {
      renderQuestion(newIndex);
    }
  }

  function toggleFlagQuestion() {
    const qId = state.exam.questions[state.currentQuestionIndex].id;
    if (state.flaggedQuestions.has(qId)) {
      state.flaggedQuestions.delete(qId);
    } else {
      state.flaggedQuestions.add(qId);
    }
    renderQuestion(state.currentQuestionIndex);
    updatePaletteStatus(state.currentQuestionIndex);
  }

  function updatePaletteStatus(index) {
    const q = state.exam.questions[index];
    const btn = document.getElementById(`palette-btn-${index}`);
    if (!btn) return;

    btn.className = `palette-btn ${index === state.currentQuestionIndex ? 'current' : ''}`;

    if (state.flaggedQuestions.has(q.id)) {
      btn.classList.add('flagged');
    } else if (state.answers[q.id] !== undefined && state.answers[q.id] !== '') {
      btn.classList.add('answered');
    }
  }

  // --- SUBMISSION ---
  function confirmSubmitExam() {
    const answeredCount = Object.keys(state.answers).length;
    const total = state.exam.questions.length;
    const confirmMsg = `Are you sure you want to finalize and submit your examination?\n\nAnswered: ${answeredCount} / ${total} questions.`;
    if (confirm(confirmMsg)) {
      submitExam();
    }
  }

  async function submitExam() {
    if (!state.isExamActive && screens.terminated && screens.terminated.style.display === 'block') {
      alert('Examination was disqualified due to trust score dropping to <= 50%. Submission cannot proceed.');
      return;
    }

    state.isExamActive = false;
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    if (state.proctorEngine) state.proctorEngine.stop();

    try {
      const res = await fetch('/api/session/' + state.session.id + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          answers: state.answers
        })
      });
      const data = await res.json();

      if (data.isTerminated || !data.success) {
        handleExamTerminated(data.terminationReason || data.error, 50, 2);
        return;
      }

      screens.exam.style.display = 'none';
      screens.result.style.display = 'block';

      document.getElementById('result-candidate-name').textContent = state.session.candidateName;
      document.getElementById('result-candidate-roll').textContent = state.session.candidateRoll;
      document.getElementById('result-score').textContent = `${data.score} / ${data.totalMarks}`;
      document.getElementById('result-trust').textContent = `${data.trustScore}%`;
      
      const badgeElem = document.getElementById('result-integrity-badge');
      if (data.trustScore > 75) {
        badgeElem.className = 'badge badge-success';
        badgeElem.textContent = 'High Integrity / Clean Record';
      } else if (data.trustScore > 45) {
        badgeElem.className = 'badge badge-warning';
        badgeElem.textContent = 'Moderate Warnings / Reviewed';
      } else {
        badgeElem.className = 'badge badge-danger';
        badgeElem.textContent = 'Flagged for Academic Audit';
      }
    } catch (e) {
      console.error('Submission failed:', e);
      alert('Examination recorded locally. Contact administrator.');
    }
  }

  // UI Toast helper
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.violation-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'violation-toast';
    toast.style.borderColor = type === 'danger' ? 'var(--color-danger)' : 'var(--cyan-glow)';
    toast.innerHTML = `
      <div style="font-size: 20px;">${type === 'danger' ? '⚠️' : 'ℹ️'}</div>
      <div style="font-size: 0.9rem; font-weight: 500;">${message}</div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 4500);
  }
})();
