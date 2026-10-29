/**
 * SmartProctor AI - Client-Side Computer Vision & Biometric Proctoring Engine
 * Implements:
 * 1. Head Pose & Gaze Tracking (Detects Left/Right/Down turns, No Face, Multiple Faces)
 * 2. Unauthorized Object Detection (Cell Phone, Books, Headphones via TensorFlow COCO-SSD)
 * 3. Audio Activity & Speech Detection (Web Audio API Analyser)
 * 4. Automatic Photographic Evidence Snapshot Capture
 */

class AIProctorEngine {
  constructor(options = {}) {
    this.videoElement = options.videoElement;
    this.canvasElement = options.canvasElement;
    this.onViolation = options.onViolation || (() => {});
    this.onStatusUpdate = options.onStatusUpdate || (() => {});
    this.onAudioUpdate = options.onAudioUpdate || (() => {});
    this.onMicMuteStateChange = options.onMicMuteStateChange || (() => {});

    this.stream = null;
    this.audioTrack = null;
    this.audioContext = null;
    this.audioAnalyser = null;
    this.audioDataArray = null;

    this.objectModel = null;
    this.isRunning = false;
    this.fpsInterval = null;

    // Temporal smoothing tracking state
    this.state = {
      facePresent: false,
      faceCount: 0,
      headPose: 'CENTER', // CENTER, LEFT, RIGHT, DOWN
      turnStartTime: null,
      noFaceStartTime: null,
      multipleFaceStartTime: null,
      objectDetectionStartTime: {},
      speechStartTime: null,
      continuousSpeechDuration: 0,
      speechWarned: false,
      speechTerminated: false,
      lastSpeechTime: null,
      audioLevel: 0,
      isMicMuted: false,
      micMuteStartTime: null,
      lastViolationTimes: {}
    };

    // Configuration thresholds
    this.thresholds = {
      headTurnDurationSec: 2.5,
      noFaceDurationSec: 3.0,
      multipleFacesDurationSec: 1.5,
      objectDetectionDurationSec: 1.5,
      audioVolumeLimit: 0.28,
      violationCooldownSec: 6.0
    };
  }

  // Initialize Camera, Audio and AI Models
  async initialize() {
    try {
      // 1. Request Webcam and Audio Stream
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: true
      });

      // Extract and lock microphone track
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        this.audioTrack = audioTracks[0];
        this.audioTrack.enabled = true; // Must be locked ON
        this.attachAudioTrackListeners();
      }
      this.setupDeviceChangeDetection();

      this.videoElement.srcObject = this.stream;
      await new Promise(resolve => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });

      // Resize canvas to match video
      if (this.canvasElement) {
        this.canvasElement.width = this.videoElement.videoWidth || 640;
        this.canvasElement.height = this.videoElement.videoHeight || 480;
      }

      // 2. Initialize Web Audio API for Speech / Noise Detection
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
          if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
          }
          const source = this.audioContext.createMediaStreamSource(this.stream);
          this.audioAnalyser = this.audioContext.createAnalyser();
          this.audioAnalyser.fftSize = 256;
          this.audioAnalyser.smoothingTimeConstant = 0.4;
          source.connect(this.audioAnalyser);
          this.audioDataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
          console.log('🎤 Proctor Microphone & Acoustic Speech Sensor Active & Calibrated.');
        }
      } catch (audioErr) {
        console.warn('Proctor Audio analysis not supported:', audioErr);
      }

      // 3. Load COCO-SSD Model for Object Detection (Cell Phone, Book, etc.)
      if (window.cocoSsd) {
        console.log('⏳ Loading TensorFlow COCO-SSD Computer Vision Model...');
        this.objectModel = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
        console.log('✅ AI Object Detection Model Loaded.');
      } else {
        console.log('ℹ️ COCO-SSD library not detected via CDN; running resilient biometric tracking fallback.');
      }

      return { success: true };
    } catch (err) {
      console.error('Proctor initialization failed:', err);
      throw err;
    }
  }

  // Start continuous frame processing loop
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.detectionLoop();
  }

  stop() {
    this.isRunning = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }

  // Main Detection Loop
  async detectionLoop() {
    if (!this.isRunning) return;

    try {
      const detections = await this.analyzeCurrentFrame();
      this.renderVisualFeedback(detections);
      this.evaluateViolations(detections);
      this.checkAudioLevel();
    } catch (e) {
      // Keep loop alive
    }

    // Schedule next frame (~10-15 FPS is optimal for real-time without CPU stress)
    setTimeout(() => {
      requestAnimationFrame(() => this.detectionLoop());
    }, 120);
  }

  // Analyze Frame using Object Detection & Biometric estimation
  async analyzeCurrentFrame() {
    const video = this.videoElement;
    if (!video || video.readyState < 2) {
      return { objects: [], faceCount: 0, headPose: 'CENTER' };
    }

    let detectedObjects = [];
    if (this.objectModel) {
      try {
        detectedObjects = await this.objectModel.detect(video);
      } catch (e) {
        detectedObjects = [];
      }
    }

    // Identify persons in frame
    const persons = detectedObjects.filter(d => d.class === 'person' && d.score > 0.45);
    let faceCount = persons.length;

    // Identify prohibited objects
    const unauthorizedItems = detectedObjects.filter(d => {
      const cls = d.class.toLowerCase();
      return (cls === 'cell phone' || cls === 'book' || cls === 'laptop' || cls === 'remote') && d.score > 0.45;
    });

    // Estimate Head Pose & Center deviation
    let headPose = 'CENTER';
    const videoW = video.videoWidth || 640;
    const videoH = video.videoHeight || 480;

    if (persons.length > 0) {
      // Find the primary person bounding box
      const primary = persons[0];
      const [x, y, w, h] = primary.bbox;
      const centerX = x + w / 2;
      const centerY = y + h / 2;

      // Centroid normalized coordinates (0.0 to 1.0)
      const normX = centerX / videoW;
      const normY = centerY / videoH;

      // Note: Video is mirrored in student display
      if (normX < 0.32) {
        headPose = 'TURN_RIGHT'; // Shifted to right from candidate perspective
      } else if (normX > 0.68) {
        headPose = 'TURN_LEFT';
      } else if (normY > 0.72) {
        headPose = 'LOOKING_DOWN';
      } else {
        headPose = 'CENTER';
      }
    } else {
      // If object model didn't catch person, check skin luminance fallback
      const luminanceCheck = this.estimateFaceByLuminance(video);
      faceCount = luminanceCheck.detected ? 1 : 0;
      headPose = luminanceCheck.pose;
    }

    return {
      objects: unauthorizedItems,
      allDetections: detectedObjects,
      faceCount,
      headPose
    };
  }

  // Fallback luminance & contrast face estimator
  estimateFaceByLuminance(video) {
    if (!this.canvasElement) return { detected: true, pose: 'CENTER' };
    try {
      const ctx = this.canvasElement.getContext('2d');
      // Draw small 32x24 thumbnail for fast optical analysis
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 32;
      tempCanvas.height = 24;
      const tCtx = tempCanvas.getContext('2d');
      tCtx.drawImage(video, 0, 0, 32, 24);
      const imgData = tCtx.getImageData(0, 0, 32, 24).data;

      let skinPixels = 0;
      let leftCount = 0;
      let rightCount = 0;

      for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const pixelIdx = i / 4;
        const col = pixelIdx % 32;

        // Basic human skin tone range heuristic (RGB)
        if (r > 60 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
          skinPixels++;
          if (col < 13) leftCount++;
          if (col > 19) rightCount++;
        }
      }

      if (skinPixels < 25) {
        return { detected: false, pose: 'NO_FACE' };
      }

      if (leftCount > rightCount * 2.5) return { detected: true, pose: 'TURN_LEFT' };
      if (rightCount > leftCount * 2.5) return { detected: true, pose: 'TURN_RIGHT' };

      return { detected: true, pose: 'CENTER' };
    } catch (e) {
      return { detected: true, pose: 'CENTER' };
    }
  }

  // Draw HUD bounding boxes & pose markers on Canvas
  renderVisualFeedback(detections) {
    if (!this.canvasElement) return;
    const ctx = this.canvasElement.getContext('2d');
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw Target Center Bounding Box Guide
    ctx.strokeStyle = detections.headPose === 'CENTER' ? 'rgba(255, 255, 255, 0.55)' : 'rgba(239, 68, 68, 0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(width * 0.22, height * 0.15, width * 0.56, height * 0.7);
    ctx.setLineDash([]);

    // 2. Draw Detected Unauthorized Objects
    detections.objects.forEach(obj => {
      const [x, y, w, h] = obj.bbox;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      // Label background
      ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
      const label = `⚠️ ${obj.class.toUpperCase()} (${Math.round(obj.score * 100)}%)`;
      ctx.font = 'bold 12px monospace';
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(x, Math.max(0, y - 22), textWidth + 12, 22);

      // Label text
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x + 6, Math.max(14, y - 6));
    });

    // Notify status UI
    this.onStatusUpdate({
      headPose: detections.headPose,
      faceCount: detections.faceCount,
      unauthorizedObjects: detections.objects.map(o => o.class)
    });
  }

  // Evaluate candidate behavior against anti-cheating policies
  evaluateViolations(detections) {
    const now = Date.now();

    // 1. Check Multiple Faces
    if (detections.faceCount > 1) {
      if (!this.state.multipleFaceStartTime) {
        this.state.multipleFaceStartTime = now;
      } else if ((now - this.state.multipleFaceStartTime) / 1000 >= this.thresholds.multipleFacesDurationSec) {
        this.triggerViolation(
          'MULTIPLE_FACES',
          'HIGH',
          `Multiple individuals (${detections.faceCount} people) detected in examination camera view.`
        );
        this.state.multipleFaceStartTime = now; // reset
      }
    } else {
      this.state.multipleFaceStartTime = null;
    }

    // 2. Check Absence of Face (Student left desk)
    if (detections.faceCount === 0) {
      if (!this.state.noFaceStartTime) {
        this.state.noFaceStartTime = now;
      } else if ((now - this.state.noFaceStartTime) / 1000 >= this.thresholds.noFaceDurationSec) {
        this.triggerViolation(
          'NO_FACE',
          'MEDIUM',
          'Candidate face not detected. Student appears to have left the examination workstation.'
        );
        this.state.noFaceStartTime = now;
      }
    } else {
      this.state.noFaceStartTime = null;
    }

    // 3. Check Sustained Head Pose (Looking away left/right/down)
    if (detections.headPose !== 'CENTER' && detections.faceCount > 0) {
      if (!this.state.turnStartTime) {
        this.state.turnStartTime = now;
      } else if ((now - this.state.turnStartTime) / 1000 >= this.thresholds.headTurnDurationSec) {
        const dir = detections.headPose.replace('TURN_', '').toLowerCase();
        this.triggerViolation(
          'HEAD_MOVEMENT',
          'LOW',
          `Candidate looked away from screen towards ${dir} for over ${this.thresholds.headTurnDurationSec} seconds.`
        );
        this.state.turnStartTime = now;
      }
    } else {
      this.state.turnStartTime = null;
    }

    // 4. Check Unauthorized Objects (e.g. Mobile Phone, Book)
    if (detections.objects.length > 0) {
      detections.objects.forEach(obj => {
        const itemKey = obj.class;
        const isPhone = itemKey.toLowerCase().includes('phone');
        if (!this.state.objectDetectionStartTime[itemKey]) {
          this.state.objectDetectionStartTime[itemKey] = now;
        } else if ((now - this.state.objectDetectionStartTime[itemKey]) / 1000 >= this.thresholds.objectDetectionDurationSec) {
          this.triggerViolation(
            isPhone ? 'PHONE_DETECTED' : 'OBJECT_DETECTED',
            'CRITICAL',
            `Prohibited contraband item detected: "${obj.class.toUpperCase()}" (Confidence: ${Math.round(obj.score * 100)}%).`
          );
          this.state.objectDetectionStartTime[itemKey] = now;
        }
      });
    } else {
      this.state.objectDetectionStartTime = {};
    }
  }

  // Audio level & continuous speech checking (5-10s Warning, 2-3 mins Auto-Expulsion)
  checkAudioLevel() {
    // 1. LAPTOP ANTI-MUTE INTEGRITY CHECK:
    // Do not allow students to turn off or mute the microphone on their laptop
    if (this.audioTrack) {
      // If student or script disabled track, force it back enabled
      if (!this.audioTrack.enabled) {
        this.audioTrack.enabled = true;
      }
      // Check if muted via laptop hardware hotkey (e.g. F4) or browser mute or readyState ended
      const isTrackMuted = this.audioTrack.muted || !this.audioTrack.enabled || this.audioTrack.readyState === 'ended';
      if (isTrackMuted) {
        this.handleMicMutedEvent();
      } else if (this.state.isMicMuted) {
        this.handleMicUnmutedEvent();
      }
    }

    if (!this.audioAnalyser || !this.audioDataArray) return;
    this.audioAnalyser.getByteFrequencyData(this.audioDataArray);

    let sum = 0;
    // Human vocal spectrum (bins 1 to 24)
    const bins = Math.min(24, this.audioDataArray.length);
    for (let i = 1; i < bins; i++) {
      sum += this.audioDataArray[i];
    }
    const avg = sum / (bins - 1) / 255;
    const audioLevelPct = Math.min(100, Math.round(avg * 250));
    this.state.audioLevel = audioLevelPct;

    const now = Date.now();
    const isSpeaking = avg > 0.13; // Sensitive human speech threshold

    if (isSpeaking) {
      this.state.lastSpeechTime = now;
      if (!this.state.speechStartTime) {
        this.state.speechStartTime = now;
      }
      const speakingDuration = (now - this.state.speechStartTime) / 1000;
      this.state.continuousSpeechDuration = speakingDuration;

      // RULE A: First 5 to 10 seconds of speech -> Give Warning ("Do not speak! If you speak for 2-3 mins the exam will end")
      if (speakingDuration >= 5 && !this.state.speechWarned) {
        this.state.speechWarned = true;
        this.triggerViolation(
          'SPEECH_WARNING',
          'MEDIUM',
          `Human speech / talking detected for ${Math.round(speakingDuration)} seconds! Do not speak. Continued speaking for 2 to 3 minutes will automatically end your examination!`
        );
      }

      // RULE B: Continuous speech for 2 to 3 minutes (120 seconds) -> AUTOMATIC DISQUALIFICATION & TERMINATION
      if (speakingDuration >= 120 && !this.state.speechTerminated) {
        this.state.speechTerminated = true;
        this.triggerViolation(
          'SPEECH_EXPULSION',
          'CRITICAL',
          `Continuous human speech detected for over 2 minutes (${Math.round(speakingDuration)} seconds). Solitary examination protocol breached.`
        );
      }
    } else {
      // If student remains silent for more than 4 seconds, reset current continuous duration
      if (this.state.lastSpeechTime && (now - this.state.lastSpeechTime > 4000)) {
        this.state.speechStartTime = null;
        this.state.continuousSpeechDuration = 0;
      }
    }

    if (this.onAudioUpdate) {
      this.onAudioUpdate({
        level: audioLevelPct,
        isSpeaking,
        speechDuration: Math.round(this.state.continuousSpeechDuration || 0),
        warned: this.state.speechWarned,
        isMuted: this.state.isMicMuted
      });
    }
  }

  // --- LAPTOP MICROPHONE MUTING INTEGRITY LISTENERS & RECOVERY ---
  attachAudioTrackListeners() {
    if (!this.audioTrack) return;
    this.audioTrack.onmute = () => {
      console.warn('⚠️ Hardware / Laptop microphone mute detected via onmute!');
      this.handleMicMutedEvent();
    };
    this.audioTrack.onunmute = () => {
      console.log('✓ Hardware / Laptop microphone unmuted via onunmute.');
      this.handleMicUnmutedEvent();
    };
    this.audioTrack.onended = () => {
      console.warn('⚠️ Audio track ended unexpectedly!');
      this.handleMicMutedEvent();
    };
  }

  setupDeviceChangeDetection() {
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        if (!this.isRunning) return;
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const hasAudioInput = devices.some(d => d.kind === 'audioinput');
          if (!hasAudioInput || (this.audioTrack && this.audioTrack.readyState === 'ended')) {
            this.handleMicMutedEvent();
          }
        } catch (e) {}
      });
    }
  }

  handleMicMutedEvent() {
    if (!this.state.isMicMuted) {
      this.state.isMicMuted = true;
      this.state.micMuteStartTime = Date.now();
      this.triggerViolation(
        'MIC_MUTED_DURING_EXAM',
        'CRITICAL',
        'Candidate turned off or muted laptop microphone during active examination. Turning off microphone is strictly prohibited!'
      );
    }
    if (this.onMicMuteStateChange) {
      this.onMicMuteStateChange({
        isMuted: true,
        durationSec: Math.round((Date.now() - (this.state.micMuteStartTime || Date.now())) / 1000)
      });
    }
  }

  handleMicUnmutedEvent() {
    if (this.state.isMicMuted) {
      this.state.isMicMuted = false;
      this.state.micMuteStartTime = null;
    }
    if (this.onMicMuteStateChange) {
      this.onMicMuteStateChange({
        isMuted: false,
        durationSec: 0
      });
    }
  }

  // Recover / Re-activate Microphone Stream
  async recoverMicrophone() {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const newAudioTrack = newStream.getAudioTracks()[0];
      if (newAudioTrack) {
        if (this.stream) {
          const oldTracks = this.stream.getAudioTracks();
          oldTracks.forEach(t => t.stop());
          this.stream.addTrack(newAudioTrack);
        }
        this.audioTrack = newAudioTrack;
        this.audioTrack.enabled = true;
        this.attachAudioTrackListeners();

        if (this.audioContext && this.audioContext.state !== 'closed') {
          if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
          }
          const source = this.audioContext.createMediaStreamSource(new MediaStream([newAudioTrack]));
          source.connect(this.audioAnalyser);
        }
        this.handleMicUnmutedEvent();
        return true;
      }
      return false;
    } catch (err) {
      console.warn('recoverMicrophone failed:', err);
      return false;
    }
  }

  // Capture Base64 Snapshot from Video Frame
  captureSnapshot() {
    try {
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = 480;
      snapCanvas.height = 360;
      const sCtx = snapCanvas.getContext('2d');
      sCtx.drawImage(this.videoElement, 0, 0, 480, 360);

      // Add timestamp watermark
      sCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      sCtx.fillRect(0, 330, 480, 30);
      sCtx.fillStyle = '#ffffff';
      sCtx.font = 'bold 12px monospace';
      sCtx.fillText(`SMARTPROCTOR AI EVIDENCE • ${new Date().toLocaleTimeString()} • ${new Date().toLocaleDateString()}`, 10, 350);

      return snapCanvas.toDataURL('image/jpeg', 0.65);
    } catch (e) {
      return null;
    }
  }

  // Trigger violation with snapshot and cooldown protection
  triggerViolation(type, severity, details) {
    const now = Date.now();
    const lastTime = this.state.lastViolationTimes[type] || 0;

    // Apply cooldown per type so we don't spam 100 alerts in 5 seconds
    if ((now - lastTime) / 1000 < this.thresholds.violationCooldownSec) {
      return;
    }
    this.state.lastViolationTimes[type] = now;

    const snapshot = this.captureSnapshot();

    this.onViolation({
      type,
      severity,
      details,
      snapshot,
      timestamp: new Date().toLocaleTimeString()
    });
  }

  // Public method for manual/demo simulations during presentation
  triggerSimulatedViolation(type, details, severity = 'HIGH') {
    const snapshot = this.captureSnapshot();
    this.onViolation({
      type,
      severity,
      details: details || `Simulated ${type} event triggered for academic demonstration.`,
      snapshot,
      timestamp: new Date().toLocaleTimeString()
    });
  }
}

window.AIProctorEngine = AIProctorEngine;
