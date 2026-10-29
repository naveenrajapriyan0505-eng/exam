/**
 * SmartProctor AI - Admin Proctor Command Center Controller
 * Manages real-time candidate grid, live violation ticker via SSE,
 * photographic evidence inspection, and remote proctor intervention controls.
 */

(function () {
  const state = {
    sessions: [],
    violations: [],
    exams: [],
    selectedExamId: 'all',
    selectedSession: null,
    audioAlertsEnabled: true,
    filterStatus: 'all',
    searchQuery: '',
    eventSource: null
  };

  // Audio Beep for Live Violations
  function playProctorChime(severity = 'MEDIUM') {
    if (!state.audioAlertsEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (severity === 'CRITICAL' || severity === 'HIGH') {
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(580, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      }
    } catch (e) {
      // Audio autoplay policy
    }
  }

  const STORAGE_KEY = 'smartproctor_admin_token';
  const USER_KEY = 'smartproctor_admin_user';

  function getAdminToken() {
    return localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
  }

  // Verify Admin Session on load
  async function verifyAdminAuth() {
    const token = getAdminToken();
    if (!token) {
      window.location.replace('admin-login.html?redirect=admin.html');
      return false;
    }

    try {
      const res = await fetch('/api/admin/verify', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.valid) {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
        window.location.replace('admin-login.html?expired=1');
        return false;
      }

      // Update controller profile in header if element exists
      if (data.user) {
        const nameElem = document.getElementById('nav-admin-name');
        const roleElem = document.getElementById('nav-admin-role');
        if (nameElem && data.user.name) nameElem.textContent = data.user.name;
        if (roleElem && data.user.role) roleElem.textContent = data.user.role;
      }
      return true;
    } catch (e) {
      console.warn('Network issue during auth verify:', e);
      return true;
    }
  }

  // Handle Logout / Lock Terminal
  async function handleLogout() {
    if (!confirm('Are you sure you want to lock the Proctor Command Terminal and sign out?')) return;
    const token = getAdminToken();
    try {
      if (token) {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ token })
        });
      }
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(USER_KEY);
      window.location.replace('admin-login.html?loggedout=1');
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const isAuthenticated = await verifyAdminAuth();
    if (!isAuthenticated) return;

    setupEventListeners();
    await fetchInitialData();
    connectRealtimeSSE();
  });

  function setupEventListeners() {
    // Logout / Lock Terminal
    const btnLogout = document.getElementById('btn-admin-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', handleLogout);
    }

    // Audio Toggle
    const btnToggleSound = document.getElementById('btn-toggle-sound');
    if (btnToggleSound) {
      btnToggleSound.addEventListener('click', () => {
        state.audioAlertsEnabled = !state.audioAlertsEnabled;
        btnToggleSound.innerHTML = state.audioAlertsEnabled ? '🔔 Sound: ON' : '🔕 Sound: MUTED';
      });
    }

    // Candidate Search
    const searchInput = document.getElementById('search-candidates');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        state.searchQuery = e.target.value.toLowerCase();
        renderStudentsGrid();
      });
    }

    // Filter Buttons
    document.querySelectorAll('.btn-filter').forEach(btn => {
      btn.addEventListener('click', e => {
        document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        state.filterStatus = e.target.getAttribute('data-status');
        renderStudentsGrid();
      });
    });

    // Multi-Institution Exam Filter Selector
    const filterExamSelect = document.getElementById('filter-exam-select');
    if (filterExamSelect) {
      filterExamSelect.addEventListener('change', e => {
        state.selectedExamId = e.target.value;
        updateActiveExamBadge();
        renderStudentsGrid();
      });
    }

    // Exam Creator Modal open button
    const btnOpenCreateExam = document.getElementById('btn-open-create-exam');
    if (btnOpenCreateExam) {
      btnOpenCreateExam.addEventListener('click', () => {
        initExamBuilder();
        document.getElementById('modal-create-exam').style.display = 'flex';
      });
    }

    // View All Exams Registry button
    const btnOpenExamsList = document.getElementById('btn-open-exams-list');
    if (btnOpenExamsList) {
      btnOpenExamsList.addEventListener('click', () => {
        renderAllExamsList();
        document.getElementById('modal-view-exams').style.display = 'flex';
      });
    }

    // Question Builder: Add question button
    const btnAddQuestion = document.getElementById('btn-add-question');
    if (btnAddQuestion) {
      btnAddQuestion.addEventListener('click', () => addBuilderQuestion());
    }

    // Question Builder: Rapid Template Presets
    document.querySelectorAll('.template-pill').forEach(pill => {
      pill.addEventListener('click', e => {
        const template = e.currentTarget.getAttribute('data-template');
        loadExamTemplate(template);
      });
    });

    // Create Exam Form Submission
    const formCreateExam = document.getElementById('form-create-exam');
    if (formCreateExam) {
      formCreateExam.addEventListener('submit', handleCreateExamSubmit);
    }

    // Close Modals
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
      });
    });

    // Send Warning Form Submit
    const btnSubmitWarning = document.getElementById('btn-submit-warning');
    if (btnSubmitWarning) {
      btnSubmitWarning.addEventListener('click', handleSendWarningSubmit);
    }

    // Preset Warning Pills
    document.querySelectorAll('.warning-preset-pill').forEach(pill => {
      pill.addEventListener('click', e => {
        document.getElementById('input-warning-msg').value = e.target.getAttribute('data-text');
      });
    });
  }

  // --- FETCH INITIAL STATE ---
  async function fetchInitialData() {
    try {
      await fetchExamsList();
      const res = await fetch('/api/sessions');
      const data = await res.json();
      state.sessions = data.sessions || [];
      state.violations = data.violations || [];
      updateKPIs(data.stats);
      renderStudentsGrid();
      renderAlertsFeed();
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }

  // --- CONNECT REAL-TIME SERVER-SENT EVENTS ---
  function connectRealtimeSSE() {
    try {
      state.eventSource = new EventSource('/api/events');

      // 1. Violation Alert Broadcasted
      state.eventSource.addEventListener('violation_alert', e => {
        const data = JSON.parse(e.data);
        const { violation, session } = data;

        // Play alert audio
        playProctorChime(violation.severity);

        // Prepend to violations list
        state.violations.unshift(violation);
        renderAlertsFeed();

        // Update student session in local state
        if (session) {
          const idx = state.sessions.findIndex(s => s.id === session.id);
          if (idx !== -1) {
            state.sessions[idx].trustScore = session.trustScore;
            state.sessions[idx].violationsCount = session.violationsCount;
            state.sessions[idx].status = session.status;
            if (violation.snapshot) {
              state.sessions[idx].lastSnapshot = violation.snapshot;
            }
          }
          renderStudentsGrid();
          refreshKPIs();
        }
      });

      // 2. Candidate Joined
      state.eventSource.addEventListener('candidate_joined', e => {
        const data = JSON.parse(e.data);
        state.sessions.unshift(data.session);
        renderStudentsGrid();
        refreshKPIs();
      });

      // 3. Candidate Submitted
      state.eventSource.addEventListener('candidate_submitted', e => {
        const data = JSON.parse(e.data);
        const idx = state.sessions.findIndex(s => s.id === data.session.id);
        if (idx !== -1) {
          state.sessions[idx] = data.session;
          renderStudentsGrid();
          refreshKPIs();
        }
      });

      // 4. Candidate Terminated / Disqualified (Trust Score <= 50% or Admin Disqualification)
      state.eventSource.addEventListener('candidate_terminated', e => {
        const data = JSON.parse(e.data);
        if (data.session) {
          const idx = state.sessions.findIndex(s => s.id === data.session.id);
          if (idx !== -1) {
            state.sessions[idx] = data.session;
          } else {
            state.sessions.unshift(data.session);
          }
          playProctorChime('CRITICAL');
          renderStudentsGrid();
          refreshKPIs();
        }
      });

      // 4. Exam Created via another terminal / instructor
      state.eventSource.addEventListener('exam_created', e => {
        const data = JSON.parse(e.data);
        if (data.exam) {
          state.exams.unshift(data.exam);
          populateExamsDropdown();
        }
      });

      // 5. Exam Deleted
      state.eventSource.addEventListener('exam_deleted', e => {
        const data = JSON.parse(e.data);
        state.exams = state.exams.filter(ex => ex.id !== data.examId);
        populateExamsDropdown();
      });
    } catch (e) {
      console.warn('SSE connection failed:', e);
    }
  }

  function updateKPIs(stats) {
    if (!stats) return;
    document.getElementById('kpi-total').textContent = stats.totalCandidates || state.sessions.length;
    document.getElementById('kpi-active').textContent = stats.active || 0;
    document.getElementById('kpi-flagged').textContent = stats.flagged || 0;
    document.getElementById('kpi-violations').textContent = stats.totalViolations || state.violations.length;
    
    // Average integrity score
    const avg = state.sessions.length > 0 
      ? Math.round(state.sessions.reduce((acc, s) => acc + (s.trustScore || 100), 0) / state.sessions.length)
      : 100;
    document.getElementById('kpi-avg-trust').textContent = `${avg}%`;
  }

  function refreshKPIs() {
    const total = state.sessions.length;
    const active = state.sessions.filter(s => s.status === 'in-progress' && (s.trustScore === undefined || s.trustScore > 50)).length;
    const flagged = state.sessions.filter(s => s.status === 'flagged' || s.status === 'terminated' || (s.trustScore !== undefined && s.trustScore <= 50)).length;
    const submitted = state.sessions.filter(s => s.status === 'submitted' || s.status === 'terminated').length;

    updateKPIs({
      totalCandidates: total,
      active,
      flagged,
      submitted,
      totalViolations: state.violations.length
    });
  }

  // --- RENDER STUDENTS GRID ---
  function renderStudentsGrid() {
    const container = document.getElementById('students-grid-container');
    if (!container) return;

    let filtered = state.sessions;
    if (state.selectedExamId && state.selectedExamId !== 'all') {
      filtered = filtered.filter(s => s.examId === state.selectedExamId);
    }
    if (state.filterStatus !== 'all') {
      if (state.filterStatus === 'terminated') {
        filtered = filtered.filter(s => s.status === 'terminated' || (s.trustScore !== undefined && s.trustScore <= 50));
      } else if (state.filterStatus === 'flagged') {
        filtered = filtered.filter(s => s.status === 'flagged' || (s.trustScore !== undefined && s.trustScore <= 70));
      } else {
        filtered = filtered.filter(s => s.status === state.filterStatus);
      }
    }
    if (state.searchQuery) {
      filtered = filtered.filter(s => 
        (s.candidateName && s.candidateName.toLowerCase().includes(state.searchQuery)) ||
        (s.candidateRoll && s.candidateRoll.toLowerCase().includes(state.searchQuery))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          No examinees found matching the selected school/college exam criteria.
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    filtered.forEach(session => {
      const isTerminated = session.status === 'terminated' || (session.trustScore !== undefined && session.trustScore <= 50);
      const isFlagged = session.status === 'flagged' || (session.trustScore !== undefined && session.trustScore <= 70);

      const card = document.createElement('div');
      card.className = `student-card ${isTerminated ? 'status-flagged' : (isFlagged ? 'status-flagged' : '')}`;
      if (isTerminated) {
        card.style.borderColor = 'rgba(239, 68, 68, 0.7)';
        card.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.25)';
      }
      
      let statusBadgeClass = 'badge-success';
      let statusText = '• IN-PROGRESS';
      if (isTerminated) {
        statusBadgeClass = 'badge-danger';
        statusText = '🛑 DISQUALIFIED (Trust <= 50%)';
      } else if (isFlagged) {
        statusBadgeClass = 'badge-danger';
        statusText = '⚠️ HIGH RISK';
      } else if (session.status === 'submitted') {
        statusBadgeClass = 'badge-info';
        statusText = '✓ SUBMITTED';
      }

      // Find exam title and institution for this session
      const examObj = state.exams.find(e => e.id === session.examId);
      const examBadgeText = examObj ? `${examObj.examCode || 'EXAM'} • ${examObj.institutionName}` : 'CS-402 • Apex Institute';

      // Find latest snapshot for this session
      const latestSnapshot = session.lastSnapshot || (session.currentViolations && session.currentViolations[0] && session.currentViolations[0].snapshot) || null;

      card.innerHTML = `
        <div class="student-card-thumb">
          ${latestSnapshot 
            ? `<img src="${latestSnapshot}" alt="Webcam Snapshot">` 
            : `<div class="no-snapshot">📷 Live Sensor Feed Active<br><span style="font-size: 0.72rem;">Candidate: ${session.candidateRoll}</span></div>`
          }
          <div style="position: absolute; top: 6px; right: 6px;">
            <span class="badge ${statusBadgeClass}" style="font-size: 0.68rem;">${statusText}</span>
          </div>
        </div>

        <div class="student-header-info">
          <div>
            <div class="student-name">${session.candidateName || 'Candidate'}</div>
            <div class="student-roll">${session.candidateRoll || 'CS2026-N/A'}</div>
            <div style="font-size: 0.72rem; color: var(--cyan-glow); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;" title="${examBadgeText}">
              ${examBadgeText}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.75rem; color: var(--text-muted);">Trust Score</div>
            <div style="font-size: 1.15rem; font-weight: 700; color: ${session.trustScore > 75 ? '#34d399' : (session.trustScore > 50 ? '#fbbf24' : '#f87171')};">
              ${session.trustScore !== undefined ? session.trustScore : 100}%
            </div>
          </div>
        </div>

        <div style="margin: 8px 0; font-size: 0.8rem; display: flex; justify-content: space-between; color: var(--text-secondary);">
          <span>Violations: <strong style="color: #fff;">${session.violationsCount || 0}</strong></span>
          <span>AI Strikes: <strong style="color: ${(session.aiStrikes || 0) >= 2 ? '#f87171' : '#fbbf24'};">${session.aiStrikes || 0} / 3</strong></span>
        </div>
        <div style="font-size: 0.72rem; color: #10b981; margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
          <span class="pulse-dot" style="background:#10b981;"></span> 🤖 Autonomous Enforcement (No Manual Check Needed)
        </div>

        <div class="card-actions-row">
          <button class="btn btn-outline btn-sm btn-action-inspect" data-id="${session.id}" style="flex: 1;">
            🔍 Inspect
          </button>
          ${isTerminated 
            ? `<span class="badge badge-danger" style="display: flex; align-items: center; justify-content: center; font-size: 0.72rem; padding: 4px 8px;">🛑 Disqualified</span>`
            : `<button class="btn btn-warning btn-sm btn-action-warn" data-id="${session.id}">⚠️ Warn</button>
               <button class="btn btn-danger btn-sm btn-action-terminate" data-id="${session.id}" title="Terminate Exam">🛑</button>`
          }
        </div>
      `;

      // Event listeners on card buttons
      card.querySelector('.btn-action-inspect').addEventListener('click', () => openInspectModal(session.id));
      const btnWarn = card.querySelector('.btn-action-warn');
      if (btnWarn) btnWarn.addEventListener('click', () => openWarningModal(session.id));
      const btnTerm = card.querySelector('.btn-action-terminate');
      if (btnTerm) btnTerm.addEventListener('click', () => confirmTerminateSession(session.id));

      container.appendChild(card);
    });
  }

  // --- RENDER LIVE VIOLATION ALERTS TICKER ---
  function renderAlertsFeed() {
    const container = document.getElementById('alerts-scroll-container');
    if (!container) return;

    if (state.violations.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 0.9rem;">
          No security breaches recorded yet. Test environment clean.
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    state.violations.forEach(v => {
      const item = document.createElement('div');
      item.className = `alert-item sev-${v.severity}`;

      const typeIcons = {
        'HEAD_MOVEMENT': '👤',
        'OBJECT_DETECTED': '📱',
        'BACKGROUND_PROCESS': '🖥️',
        'TAB_SWITCH': '🔀',
        'FULLSCREEN_EXIT': '🚪',
        'NO_FACE': '❓',
        'MULTIPLE_FACES': '👥',
        'COPY_PASTE': '📋',
        'AUDIO_DETECTED': '🎙️'
      };

      const icon = typeIcons[v.type] || '⚠️';

      item.innerHTML = `
        <div class="alert-item-top">
          <span style="font-weight: 600; color: #fff;">${v.candidateName} (${v.candidateRoll})</span>
          <span>${v.timestamp || 'Just now'}</span>
        </div>
        <div class="alert-item-title">
          <span>${icon}</span>
          <span>${v.type.replace(/_/g, ' ')} [${v.severity}]</span>
        </div>
        <div class="alert-item-desc">${v.details}</div>
        ${v.snapshot ? `
          <div style="margin-top: 8px;">
            <button class="btn btn-outline btn-sm btn-view-snap" style="font-size: 0.72rem; padding: 3px 8px;">
              📸 View Photo Proof
            </button>
          </div>
        ` : ''}
      `;

      if (v.snapshot) {
        item.querySelector('.btn-view-snap').addEventListener('click', e => {
          e.stopPropagation();
          openEvidenceModal(v);
        });
      }

      item.addEventListener('click', () => {
        openInspectModal(v.sessionId);
      });

      container.appendChild(item);
    });
  }

  // --- MODALS & PROCTOR ACTIONS ---
  function openWarningModal(sessionId) {
    state.selectedSession = state.sessions.find(s => s.id === sessionId);
    if (!state.selectedSession) return;

    document.getElementById('warning-modal-candidate-name').textContent = state.selectedSession.candidateName;
    document.getElementById('input-warning-msg').value = 'Proctor Warning: Please face your screen directly and refrain from looking away or opening unauthorized background software.';
    document.getElementById('modal-send-warning').style.display = 'flex';
  }

  async function handleSendWarningSubmit() {
    if (!state.selectedSession) return;
    const msg = document.getElementById('input-warning-msg').value.trim();
    if (!msg) return;

    const token = getAdminToken();

    try {
      const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          token,
          sessionId: state.selectedSession.id,
          action: 'warn',
          message: msg
        })
      });

      const data = await res.json();
      if (!res.ok && res.status === 401) {
        alert('Proctor terminal session expired. Please sign in again.');
        window.location.replace('admin-login.html?expired=1');
        return;
      }

      document.getElementById('modal-send-warning').style.display = 'none';
      alert(`Warning message successfully transmitted to ${state.selectedSession.candidateName}.`);
    } catch (e) {
      console.error(e);
      alert('Failed to transmit message.');
    }
  }

  async function confirmTerminateSession(sessionId) {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;

    const reason = prompt(`CRITICAL ACTION: Are you sure you want to DISQUALIFY and TERMINATE the examination for ${session.candidateName}?\n\nEnter termination reason:`, 'Gross violation of academic integrity: Repeated unauthorized contraband / background application breach.');
    if (!reason) return;

    const token = getAdminToken();

    try {
      const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          token,
          sessionId: session.id,
          action: 'terminate',
          message: reason
        })
      });

      if (!res.ok && res.status === 401) {
        alert('Proctor terminal session expired. Please sign in again.');
        window.location.replace('admin-login.html?expired=1');
        return;
      }

      session.status = 'terminated';
      renderStudentsGrid();
      refreshKPIs();
      alert(`Candidate ${session.candidateName} has been officially disqualified.`);
    } catch (e) {
      console.error(e);
    }
  }

  function openEvidenceModal(violation) {
    document.getElementById('evidence-modal-title').textContent = `${violation.type.replace(/_/g, ' ')} - Evidence Frame`;
    document.getElementById('evidence-modal-details').textContent = violation.details;
    document.getElementById('evidence-modal-candidate').textContent = `${violation.candidateName} (${violation.candidateRoll}) at ${violation.timestamp}`;
    
    const imgElem = document.getElementById('evidence-modal-img');
    imgElem.src = violation.snapshot;

    document.getElementById('modal-evidence-viewer').style.display = 'flex';
  }

  function openInspectModal(sessionId) {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;

    document.getElementById('inspect-candidate-name').textContent = session.candidateName;
    document.getElementById('inspect-candidate-roll').textContent = session.candidateRoll;
    document.getElementById('inspect-trust-score').textContent = `${session.trustScore || 100}%`;
    document.getElementById('inspect-status').textContent = session.status.toUpperCase();
    document.getElementById('inspect-violations-count').textContent = session.violationsCount || 0;

    const timelineContainer = document.getElementById('inspect-violations-timeline');
    const sessionViolations = state.violations.filter(v => v.sessionId === sessionId);

    if (sessionViolations.length === 0) {
      timelineContainer.innerHTML = '<div style="color: var(--text-muted); padding: 14px 0;">No infractions recorded for this candidate.</div>';
    } else {
      timelineContainer.innerHTML = '';
      sessionViolations.forEach(v => {
        const row = document.createElement('div');
        row.style.cssText = 'padding: 10px 0; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem;';
        row.innerHTML = `
          <div>
            <span class="badge ${v.severity === 'CRITICAL' ? 'badge-danger' : 'badge-warning'}" style="font-size: 0.68rem; margin-right: 6px;">${v.type}</span>
            <span>${v.details}</span>
          </div>
          <div style="color: var(--text-muted); font-size: 0.78rem; white-space: nowrap; margin-left: 12px;">
            ${v.timestamp}
          </div>
        `;
        timelineContainer.appendChild(row);
      });
    }

    // Report Link
    document.getElementById('inspect-report-link').href = `report.html?sessionId=${sessionId}`;

    document.getElementById('modal-candidate-inspect').style.display = 'flex';
  }

  // =========================================================================
  // --- MULTI-INSTITUTION & EXAM CREATOR CONTROLLER ---
  // =========================================================================

  async function fetchExamsList() {
    try {
      const res = await fetch('/api/exams');
      const data = await res.json();
      state.exams = data.exams || [];
      populateExamsDropdown();
    } catch (e) {
      console.error('Failed to fetch exams:', e);
    }
  }

  function populateExamsDropdown() {
    const select = document.getElementById('filter-exam-select');
    const badge = document.getElementById('active-exam-badge');
    const countElem = document.getElementById('count-total-exams');

    if (countElem) countElem.textContent = state.exams.length;
    if (!select) return;

    select.innerHTML = '<option value="all">🌐 All Institutions & Colleges (Fleet View)</option>';
    state.exams.forEach(ex => {
      const opt = document.createElement('option');
      opt.value = ex.id;
      opt.textContent = `${ex.examCode || 'EXAM'} • ${ex.title} (${ex.institutionName})`;
      if (ex.id === state.selectedExamId) opt.selected = true;
      select.appendChild(opt);
    });

    updateActiveExamBadge();
  }

  function updateActiveExamBadge() {
    const badge = document.getElementById('active-exam-badge');
    if (!badge) return;

    if (state.selectedExamId === 'all') {
      badge.textContent = `All Colleges (${state.exams.length} Exams Active)`;
      badge.className = 'badge badge-info';
    } else {
      const cur = state.exams.find(e => e.id === state.selectedExamId);
      if (cur) {
        badge.textContent = `${cur.examCode || 'EXAM'} • ${cur.institutionName}`;
        badge.className = 'badge badge-success';
      }
    }
  }

  // --- RENDER ALL REGISTERED EXAMS REGISTRY ---
  function renderAllExamsList() {
    const container = document.getElementById('all-exams-list-container');
    if (!container) return;

    if (state.exams.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">No examinations registered yet.</div>';
      return;
    }

    container.innerHTML = '';
    state.exams.forEach(ex => {
      const card = document.createElement('div');
      card.className = 'exam-summary-card';
      const candidateCount = state.sessions.filter(s => s.examId === ex.id).length;

      card.innerHTML = `
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span class="badge badge-warning" style="font-size: 0.68rem;">${ex.institutionType || 'College / University'}</span>
            <span style="font-size: 0.82rem; color: var(--cyan-glow); font-weight: 700;">${ex.institutionName}</span>
          </div>
          <h4 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 6px; color: #fff;">
            ${ex.examCode ? `[${ex.examCode}] ` : ''}${ex.title}
          </h4>
          <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; gap: 14px; flex-wrap: wrap;">
            <span>⏱️ <strong>${ex.durationMinutes || 45} mins</strong></span>
            <span>🎯 <strong>${ex.totalMarks || 50} Marks</strong></span>
            <span>❓ <strong>${(ex.questions || []).length} Questions</strong></span>
            <span>👥 <strong>${candidateCount} Enrolled Examinees</strong></span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="btn btn-outline btn-sm btn-filter-this-exam" data-id="${ex.id}">
            🔍 View Fleet
          </button>
          ${state.exams.length > 1 ? `
            <button class="btn btn-danger btn-sm btn-delete-exam" data-id="${ex.id}" style="padding: 4px 8px; font-size: 0.76rem;">
              🗑️ Delete
            </button>
          ` : ''}
        </div>
      `;

      card.querySelector('.btn-filter-this-exam').addEventListener('click', () => {
        state.selectedExamId = ex.id;
        document.getElementById('filter-exam-select').value = ex.id;
        updateActiveExamBadge();
        renderStudentsGrid();
        document.getElementById('modal-view-exams').style.display = 'none';
      });

      const btnDelete = card.querySelector('.btn-delete-exam');
      if (btnDelete) {
        btnDelete.addEventListener('click', () => deleteExam(ex.id, ex.title));
      }

      container.appendChild(card);
    });
  }

  async function deleteExam(examId, title) {
    if (!confirm(`Are you sure you want to permanently delete '${title}' from the examination registry?`)) return;
    const token = getAdminToken();

    try {
      const res = await fetch('/api/exams/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ token, examId })
      });
      const data = await res.json();
      if (data.success) {
        state.exams = state.exams.filter(e => e.id !== examId);
        if (state.selectedExamId === examId) state.selectedExamId = 'all';
        populateExamsDropdown();
        renderAllExamsList();
        renderStudentsGrid();
        alert('Examination deleted successfully.');
      } else {
        alert(data.error || 'Failed to delete exam.');
      }
    } catch (e) {
      console.error(e);
      alert('Error contacting server to delete exam.');
    }
  }

  // --- QUESTION BUILDER LOGIC ---
  let builderQuestions = [];

  function initExamBuilder() {
    const alertElem = document.getElementById('ce-alert-banner');
    if (alertElem) alertElem.style.display = 'none';

    // If empty, initialize with 2 default sample questions
    if (builderQuestions.length === 0) {
      loadExamTemplate('university_ai');
    } else {
      renderBuilderQuestions();
    }
  }

  function renderBuilderQuestions() {
    const container = document.getElementById('ce-questions-container');
    const countElem = document.getElementById('ce-question-count');
    if (countElem) countElem.textContent = builderQuestions.length;
    if (!container) return;

    container.innerHTML = '';
    builderQuestions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'builder-question-card';
      card.setAttribute('data-index', idx);

      const isMcq = q.type === 'mcq';
      const isCode = q.type === 'code';
      const isSub = q.type === 'subjective';

      card.innerHTML = `
        <div class="builder-q-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge badge-info" style="font-size: 0.72rem;">Question #${idx + 1}</span>
            <select class="modal-input qb-input-type" style="padding: 4px 8px; width: 140px; font-size: 0.8rem;">
              <option value="mcq" ${isMcq ? 'selected' : ''}>Multiple Choice (MCQ)</option>
              <option value="code" ${isCode ? 'selected' : ''}>Code Analysis</option>
              <option value="subjective" ${isSub ? 'selected' : ''}>Subjective / Essay</option>
            </select>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 0.8rem; color: var(--text-muted);">Marks:</span>
            <input type="number" class="modal-input qb-input-marks" value="${q.marks || 5}" min="1" max="50" style="width: 60px; padding: 4px 8px;">
            ${builderQuestions.length > 1 ? `
              <button type="button" class="btn btn-outline btn-sm btn-remove-q" data-index="${idx}" style="padding: 2px 8px; color: #f87171;" title="Remove this question">
                ✕
              </button>
            ` : ''}
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 4px;">Question Text / Statement</label>
          <input type="text" class="modal-input qb-input-question" value="${escapeHtml(q.question || '')}" placeholder="Enter question statement here..." required>
        </div>

        ${isCode ? `
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 4px;">Source Code Snippet</label>
            <textarea class="modal-input qb-input-code" rows="3" style="font-family: var(--font-mono); font-size: 0.82rem;" placeholder="def analyze(): ...">${escapeHtml(q.codeSnippet || '')}</textarea>
          </div>
        ` : ''}

        ${!isSub ? `
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 6px;">
              Answer Choices (Select radio button corresponding to the correct answer):
            </label>
            ${[0, 1, 2, 3].map(optIdx => `
              <div class="mcq-option-row">
                <input type="radio" name="correct_q_${idx}" class="mcq-radio qb-radio-correct" value="${optIdx}" ${q.correct === optIdx ? 'checked' : ''} title="Mark as correct answer">
                <span style="font-weight: 700; color: var(--cyan-glow); font-size: 0.85rem; width: 22px;">${String.fromCharCode(65 + optIdx)}:</span>
                <input type="text" class="modal-input qb-input-option" data-opt="${optIdx}" value="${escapeHtml((q.options && q.options[optIdx]) || `Option ${String.fromCharCode(65 + optIdx)}`)}" placeholder="Option text" required>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 4px;">Answer Key / Grading Evaluation Criteria</label>
            <input type="text" class="modal-input qb-input-criteria" value="${escapeHtml(q.criteria || '')}" placeholder="Key concepts candidate answer must address...">
          </div>
        `}

        <div>
          <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 4px;">Explanation / Rationale (Optional)</label>
          <input type="text" class="modal-input qb-input-explanation" value="${escapeHtml(q.explanation || '')}" placeholder="Explanation provided in official forensic scorecard">
        </div>
      `;

      // Type change listener
      card.querySelector('.qb-input-type').addEventListener('change', e => {
        syncBuilderQuestionsFromDOM();
        builderQuestions[idx].type = e.target.value;
        renderBuilderQuestions();
      });

      // Remove listener
      const btnRemove = card.querySelector('.btn-remove-q');
      if (btnRemove) {
        btnRemove.addEventListener('click', () => {
          syncBuilderQuestionsFromDOM();
          builderQuestions.splice(idx, 1);
          renderBuilderQuestions();
        });
      }

      container.appendChild(card);
    });
  }

  function addBuilderQuestion(data = null) {
    syncBuilderQuestionsFromDOM();
    builderQuestions.push(data || {
      type: 'mcq',
      question: '',
      marks: 5,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correct: 0,
      explanation: ''
    });
    renderBuilderQuestions();
  }

  function syncBuilderQuestionsFromDOM() {
    const cards = document.querySelectorAll('.builder-question-card');
    cards.forEach((card, idx) => {
      if (!builderQuestions[idx]) return;
      const q = builderQuestions[idx];

      const questionInput = card.querySelector('.qb-input-question');
      if (questionInput) q.question = questionInput.value;

      const marksInput = card.querySelector('.qb-input-marks');
      if (marksInput) q.marks = parseInt(marksInput.value) || 5;

      const codeInput = card.querySelector('.qb-input-code');
      if (codeInput) q.codeSnippet = codeInput.value;

      const criteriaInput = card.querySelector('.qb-input-criteria');
      if (criteriaInput) q.criteria = criteriaInput.value;

      const expInput = card.querySelector('.qb-input-explanation');
      if (expInput) q.explanation = expInput.value;

      // MCQ options & correct radio
      const optInputs = card.querySelectorAll('.qb-input-option');
      if (optInputs.length > 0) {
        q.options = [];
        optInputs.forEach(opt => q.options.push(opt.value));
        const checkedRadio = card.querySelector('.qb-radio-correct:checked');
        if (checkedRadio) q.correct = parseInt(checkedRadio.value) || 0;
      }
    });
  }

  // --- PRESET TEMPLATE LOADERS ---
  function loadExamTemplate(preset) {
    const instInput = document.getElementById('ce-institution');
    const typeSelect = document.getElementById('ce-type');
    const deptInput = document.getElementById('ce-dept');
    const codeInput = document.getElementById('ce-code');
    const titleInput = document.getElementById('ce-title');
    const durInput = document.getElementById('ce-duration');
    const marksInput = document.getElementById('ce-marks');
    const instrInput = document.getElementById('ce-instructions');

    if (preset === 'university_ai') {
      instInput.value = 'Apex Institute of Technology & Engineering';
      typeSelect.value = 'Engineering & Technology College';
      deptInput.value = 'Dept. of Computer Science & Engineering';
      codeInput.value = 'CS-402';
      titleInput.value = 'CS-402: Artificial Intelligence & Autonomous Systems Final Exam';
      durInput.value = '45';
      marksInput.value = '50';
      instrInput.value = 'Ensure your webcam and microphone remain active throughout the examination.\nContinuous 3D head pose and gaze tracking is active. Do not look away.\nUnauthorized objects (cell phones, earphones, books) are strictly prohibited.\nTab switching or exiting fullscreen logs an immediate violation.';
      builderQuestions = [
        {
          type: 'mcq',
          question: 'Which neural network architecture introduced residual connections (skip connections) to mitigate vanishing gradients?',
          options: ['AlexNet', 'VGG-16', 'ResNet (He et al.)', 'Inception-v1'],
          correct: 2,
          marks: 5,
          explanation: 'ResNet introduced skip connections allowing gradients to flow back unattenuated.'
        },
        {
          type: 'mcq',
          question: 'What is the primary computer vision technique used to detect 3D head pose orientation from 2D facial landmark coordinates?',
          options: ['Perspective-n-Point (PnP) solver with 3D model', 'Histogram of Oriented Gradients (HOG)', 'K-Means pixel clustering', 'Sobel edge filtering'],
          correct: 0,
          marks: 5,
          explanation: 'PnP estimates 3D rotation (yaw, pitch, roll) from 2D facial landmarks mapped to a canonical 3D head.'
        },
        {
          type: 'mcq',
          question: 'In an automated proctoring pipeline, what does detecting multiple faces in the camera frame indicate?',
          options: ['Camera sensor defect', 'Presence of an unauthorized collaborator in the test area', 'Ambient lighting artifact', 'Microphone clipping'],
          correct: 1,
          marks: 5,
          explanation: 'Multiple human faces signify another individual is present in the solitary testing zone.'
        },
        {
          type: 'code',
          question: 'Analyze this trust score penalty logic. What happens if a candidate exceeds 5 violations?',
          codeSnippet: 'def evaluate_status(trust_score, viol_count):\n    if trust_score <= 50 or viol_count >= 5:\n        return "FLAGGED_HIGH_RISK"\n    return "IN_PROGRESS"',
          options: ['Candidate status changes to FLAGGED_HIGH_RISK', 'Exam automatically awards full marks', 'Camera turns off', 'Violations reset to zero'],
          correct: 0,
          marks: 10,
          explanation: 'Once violations reach 5 or trust score drops below 50, candidate is flagged for audit.'
        }
      ];
    } else if (preset === 'college_physics') {
      instInput.value = 'Stanford University - School of Sciences';
      typeSelect.value = 'University / Higher Education';
      deptInput.value = 'Department of Physics & Astronomy';
      codeInput.value = 'PHY-201';
      titleInput.value = 'PHY-201: Modern Quantum Mechanics & Wave Dynamics Midterm';
      durInput.value = '40';
      marksInput.value = '35';
      instrInput.value = 'Webcam video and audio stream must remain unobstructed.\nContinuous eye tracking and head pose orientation is monitored.\nNo external formula books, secondary monitors, or headphones permitted.\nTab switching will trigger an immediate high-priority proctor infraction.';
      builderQuestions = [
        {
          type: 'mcq',
          question: 'According to the de Broglie hypothesis, what is the wavelength associated with a particle of momentum p?',
          options: ['λ = h / p', 'λ = p / h', 'λ = h * p', 'λ = h / (2 * p^2)'],
          correct: 0,
          marks: 5,
          explanation: 'The de Broglie relation states λ = h / p.'
        },
        {
          type: 'mcq',
          question: 'In the time-independent Schrödinger equation Hψ = Eψ, what does the Hamiltonian operator H represent?',
          options: ['Relativistic mass operator', 'Total energy operator (kinetic + potential)', 'Vector magnetic potential', 'Angular momentum z-projection'],
          correct: 1,
          marks: 5,
          explanation: 'Hamiltonian operator represents the total energy observable.'
        },
        {
          type: 'mcq',
          question: 'Which experiment directly verified electron energy level quantization via inelastic atomic collisions?',
          options: ['Franck-Hertz Experiment', 'Stern-Gerlach Experiment', 'Davisson-Germer Experiment', 'Michelson-Morley Experiment'],
          correct: 0,
          marks: 5,
          explanation: 'Franck-Hertz experiment confirmed discrete Bohr atomic energy levels.'
        },
        {
          type: 'subjective',
          question: 'Explain the physical significance of quantum tunneling across a rectangular potential barrier of finite height V0 where particle energy E < V0.',
          criteria: 'Mentions wave function exponential decay inside barrier, non-zero transmission probability, and scanning tunneling microscopy.',
          marks: 10,
          explanation: 'Quantum tunneling allows non-zero wave packet transmission through classically forbidden barriers.'
        }
      ];
    } else if (preset === 'school_math') {
      instInput.value = 'Delhi Public School (DPS Global Academy)';
      typeSelect.value = 'School / Senior Secondary (K-12)';
      deptInput.value = 'Department of Senior Secondary Mathematics';
      codeInput.value = 'MATH-12';
      titleInput.value = 'MATH-12: Grade 12 Advanced Calculus & Analytical Geometry';
      durInput.value = '30';
      marksInput.value = '30';
      instrInput.value = 'Keep scratch paper clearly visible within camera field of view.\nProgrammable and graphic calculators are strictly prohibited.\nExam session will terminate upon exceeding 3 proctor warnings.';
      builderQuestions = [
        {
          type: 'mcq',
          question: 'What is the derivative of f(x) = ln(sin(x)) with respect to x?',
          options: ['cot(x)', 'tan(x)', '-cot(x)', 'sec^2(x)'],
          correct: 0,
          marks: 5,
          explanation: 'By chain rule, d/dx[ln(sin(x))] = (1 / sin(x)) * cos(x) = cot(x).'
        },
        {
          type: 'mcq',
          question: 'Evaluate the definite integral ∫ from 0 to π/2 of cos(x) dx:',
          options: ['1', '0', 'π / 2', '-1'],
          correct: 0,
          marks: 5,
          explanation: '∫ cos(x) dx = sin(x). sin(π/2) - sin(0) = 1.'
        },
        {
          type: 'mcq',
          question: 'If vectors A = 2i + 3j - k and B = i - j + 2k, what is their dot product A • B?',
          options: ['-3', '3', '7', '-1'],
          correct: 0,
          marks: 10,
          explanation: '(2)(1) + (3)(-1) + (-1)(2) = 2 - 3 - 2 = -3.'
        },
        {
          type: 'subjective',
          question: 'State Rolle Theorem and outline the necessary conditions for a function f(x) to satisfy it on a closed interval [a, b].',
          criteria: 'Continuous on [a,b], differentiable on (a,b), and f(a) = f(b) implies exists c in (a,b) where f\'(c) = 0.',
          marks: 10,
          explanation: 'Rolle theorem provides existence of a horizontal tangent when endpoint values match.'
        }
      ];
    } else if (preset === 'college_biology') {
      instInput.value = 'Oxford International College';
      typeSelect.value = 'University / Higher Education';
      deptInput.value = 'Dept. of Biological & Medical Sciences';
      codeInput.value = 'BIO-301';
      titleInput.value = 'BIO-301: Molecular Genetics & CRISPR Cas9 Engineering';
      durInput.value = '50';
      marksInput.value = '40';
      instrInput.value = 'Continuous facial surveillance is mandatory.\nNo secondary monitors, notes, or smartwatches permitted.\nFull screen lockdown is strictly enforced throughout the test.';
      builderQuestions = [
        {
          type: 'mcq',
          question: 'What role does the guide RNA (gRNA) play in the CRISPR-Cas9 genome editing mechanism?',
          options: ['Directs Cas9 endonuclease to target DNA via Watson-Crick base pairing', 'Catalyzes non-homologous end-joining directly', 'Provides high-energy phosphate bonds', 'Methylates histone tails'],
          correct: 0,
          marks: 10,
          explanation: 'gRNA contains a 20-nucleotide guide sequence complementary to the target genomic DNA site.'
        },
        {
          type: 'mcq',
          question: 'Which enzyme synthesizes the RNA primers required for DNA polymerase III initiation during DNA replication?',
          options: ['DNA Primase', 'DNA Ligase', 'Topoisomerase I', 'Reverse Transcriptase'],
          correct: 0,
          marks: 10,
          explanation: 'DNA primase synthesizes short RNA primers to provide a free 3\'-OH group for elongation.'
        },
        {
          type: 'subjective',
          question: 'Explain the difference between Sanger chain-termination sequencing versus Next-Generation High-Throughput sequencing (NGS).',
          criteria: 'Mentions dideoxynucleotides (ddNTPs) terminating chains vs massively parallel cyclic reversible dye-terminators.',
          marks: 20,
          explanation: 'Sanger relies on capillary electrophoresis of ddNTP fragments, whereas NGS sequences millions of clusters in parallel.'
        }
      ];
    }

    renderBuilderQuestions();
  }

  // --- SUBMIT NEW SCHOOL / COLLEGE EXAM ---
  async function handleCreateExamSubmit(e) {
    e.preventDefault();
    syncBuilderQuestionsFromDOM();

    const alertBanner = document.getElementById('ce-alert-banner');
    const btnSubmit = document.getElementById('btn-submit-create-exam');

    if (builderQuestions.length === 0) {
      showAlert(alertBanner, 'error', 'Please add at least one question to the examination.');
      return;
    }

    const payload = {
      institutionName: document.getElementById('ce-institution').value.trim(),
      institutionType: document.getElementById('ce-type').value,
      department: document.getElementById('ce-dept').value.trim(),
      examCode: document.getElementById('ce-code').value.trim(),
      title: document.getElementById('ce-title').value.trim(),
      durationMinutes: parseInt(document.getElementById('ce-duration').value) || 45,
      totalMarks: parseInt(document.getElementById('ce-marks').value) || 50,
      instructions: document.getElementById('ce-instructions').value.trim(),
      proctoringConfig: {
        headPose: document.getElementById('ce-rule-head').checked,
        objectDetection: document.getElementById('ce-rule-obj').checked,
        backgroundApps: document.getElementById('ce-rule-apps').checked,
        tabLockdown: document.getElementById('ce-rule-fs').checked,
        maxViolations: parseInt(document.getElementById('ce-max-viol').value) || 5
      },
      questions: builderQuestions
    };

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Publishing to Network...';

    const token = getAdminToken();

    try {
      const res = await fetch('/api/exams/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ token, ...payload })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Prepend to local state
        state.exams.unshift(data.exam);
        state.selectedExamId = data.exam.id;
        populateExamsDropdown();
        renderStudentsGrid();

        alert(`🎉 Success! Exam '${data.exam.title}' for ${data.exam.institutionName} has been successfully created and published!`);
        document.getElementById('modal-create-exam').style.display = 'none';
      } else {
        showAlert(alertBanner, 'error', data.error || 'Failed to create examination.');
      }
    } catch (err) {
      console.error(err);
      showAlert(alertBanner, 'error', 'Network error: Unable to communicate with exam server.');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = '🚀 Publish Examination to Portal';
    }
  }

  function showAlert(elem, type, message) {
    if (!elem) return;
    elem.style.display = 'block';
    if (type === 'error') {
      elem.style.background = 'rgba(239, 68, 68, 0.2)';
      elem.style.border = '1px solid #ef4444';
      elem.style.color = '#fca5a5';
    } else {
      elem.style.background = 'rgba(16, 185, 129, 0.2)';
      elem.style.border = '1px solid #10b981';
      elem.style.color = '#6ee7b7';
    }
    elem.textContent = message;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
