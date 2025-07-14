if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

import { Scene } from './new_scene.js';
import './styles/main.css';

// --- Scene initialization after DOMContentLoaded for mobile safety ---
let scene = null;
window.addEventListener('DOMContentLoaded', () => {
  scene = new Scene();
  // Hide address bar on mobile after load
  setTimeout(() => {
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.scrollTo(0, 1);
    }
  }, 100);
});
// Ensure orientationchange triggers resize for scene/canvas
window.addEventListener('orientationchange', () => {
  if (scene && typeof scene.onResize === 'function') scene.onResize();
});

// --- Ambient sound and click sound system (moved from index.html) ---
let audioCtx, noiseSource, filter, gainNode;
let started = false;
const DEFAULT_AMBIENT_VOLUME = 0.08;
const BASE_FREQ = 320;
const MOD_DEPTH = 180; // Hz, how much the frequency oscillates
const MOD_RATE = 0.07; // Hz, how fast the oscillation is (0.07Hz = ~14s per cycle)
let freqModActive = false;
let freqModPhase = 0;

// Set initial sound state to off
let soundOn = false;

function startFreqModulation() {
  if (freqModActive) return;
  freqModActive = true;
  function modLoop() {
    if (!freqModActive || !filter) return;
    freqModPhase += (2 * Math.PI * MOD_RATE) / 60;
    if (freqModPhase > 2 * Math.PI) freqModPhase -= 2 * Math.PI;
    if (!window._ambientTransitioning) {
      filter.frequency.value = BASE_FREQ + Math.sin(freqModPhase) * MOD_DEPTH;
    }
    requestAnimationFrame(modLoop);
  }
  modLoop();
}
function stopFreqModulation() {
  freqModActive = false;
}

async function tryStartAmbient() {
  if (started) return;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  if (!noiseSource) {
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noiseSource = audioCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = BASE_FREQ;
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 0; // Start muted
    noiseSource.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    noiseSource.start();
    startFreqModulation();
  }
  started = true;
  window.removeEventListener('pointerdown', tryStartAmbient);
  window.removeEventListener('keydown', tryStartAmbient);
}
window.addEventListener('pointerdown', tryStartAmbient);
window.addEventListener('keydown', tryStartAmbient);

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
// --- Sound toggle logic ---
(function() {
  // Main overlay sound toggle (intro)
  const btn = document.getElementById('sound-toggle');
  if (btn) {
    btn.textContent = 'Sound: Off';
    if (window.gainNode) {
      window.gainNode.gain.value = 0;
    }
    btn.addEventListener('click', () => {
      soundOn = !soundOn;
      btn.textContent = soundOn ? 'Sound: On' : 'Sound: Off';
      if (window.gainNode) {
        window.gainNode.gain.value = soundOn ? window.DEFAULT_AMBIENT_VOLUME || 0.08 : 0;
      }
      // Sync footer icon
      const footerBtn = document.getElementById('footer-sound-toggle');
      if (footerBtn) {
        footerBtn.classList.toggle('sound-off', !soundOn);
        footerBtn.title = soundOn ? 'Mute sound' : 'Unmute sound';
      }
    });
    Object.defineProperty(window, 'gainNode', {
      get() { return gainNode; },
      configurable: true
    });
    Object.defineProperty(window, 'DEFAULT_AMBIENT_VOLUME', {
      get() { return DEFAULT_AMBIENT_VOLUME; },
      configurable: true
    });
  }
  // Footer sound toggle
  const footerBtn = document.getElementById('footer-sound-toggle');
  if (footerBtn) {
    // Set initial state
    footerBtn.classList.toggle('sound-off', !soundOn);
    footerBtn.title = soundOn ? 'Mute sound' : 'Unmute sound';
    footerBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      if (window.gainNode) {
        window.gainNode.gain.value = soundOn ? window.DEFAULT_AMBIENT_VOLUME || 0.08 : 0;
      }
      footerBtn.classList.toggle('sound-off', !soundOn);
      footerBtn.title = soundOn ? 'Mute sound' : 'Unmute sound';
      // Sync intro button
      const btn = document.getElementById('sound-toggle');
      if (btn) {
        btn.textContent = soundOn ? 'Sound: On' : 'Sound: Off';
      }
    });
  }

  // Ensure sound is off on init
  if (window.gainNode) {
    window.gainNode.gain.value = 0;
  }
})();

// --- Ensure all sound transitions respect soundOn state ---
window.setAmbientVolume = function(vol, duration = 0.7) {
  if (!soundOn) return; // Only allow if sound is on
  if (gainNode && filter && audioCtx) {
    window._ambientTransitioning = true;
    const startTime = audioCtx.currentTime;
    const startGain = gainNode.gain.value;
    const startFreq = filter.frequency.value;
    const endGain = vol;
    const endFreq = 4000;
    const animate = () => {
      const now = audioCtx.currentTime;
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeInOut(t);
      gainNode.gain.value = startGain + (endGain - startGain) * eased;
      filter.frequency.value = startFreq + (endFreq - startFreq) * eased;
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        gainNode.gain.value = endGain;
        filter.frequency.value = endFreq;
        window._ambientTransitioning = false;
      }
    };
    animate();
  }
};
window.resetAmbientVolume = function(duration = 1) {
  if (!soundOn) return; // Only allow if sound is on
  if (gainNode && filter && audioCtx) {
    window._ambientTransitioning = true;
    const startTime = audioCtx.currentTime;
    const startGain = gainNode.gain.value;
    const startFreq = filter.frequency.value;
    const endGain = DEFAULT_AMBIENT_VOLUME;
    const endFreq = BASE_FREQ;
    const animate = () => {
      const now = audioCtx.currentTime;
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeInOut(t);
      gainNode.gain.value = startGain + (endGain - startGain) * eased;
      filter.frequency.value = startFreq + (endFreq - startFreq) * eased;
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        gainNode.gain.value = endGain;
        filter.frequency.value = endFreq;
        window._ambientTransitioning = false;
      }
    };
    animate();
  }
};
window.playClickSound = function() {
  if (!soundOn) return; // Only allow if sound is on
  if (!audioCtx) return;
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1230;
  gain.gain.value = 0.12;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.045);
  osc.start(now);
  osc.stop(now + 0.15);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
};
window.playClickSoundTwo = function() {
  if (!soundOn) return;
  if (!audioCtx) return;

  function playOnce(delay = 0) {
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 430;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15 + delay);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

    playOnce(0.1); 
  playOnce(0.2); 
     // Play again after 120ms
};
// --- Typewriter animation cancellation logic ---
window._typewriterToken = 0;
window.resetTypewriterAnimation = function() {
  window._typewriterToken++;
};

// --- Overlay animation cancellation logic ---
window._timelineAnimToken = 0;
window._timelineAnimTimeouts = [];
window._timelineAnimFrames = [];
window.cancelTimelineOverlayAnimations = function() {
  window._timelineAnimToken++;
  window._timelineAnimTimeouts.forEach(clearTimeout);
  window._timelineAnimTimeouts = [];
  window._timelineAnimFrames.forEach(cancelAnimationFrame);
  window._timelineAnimFrames = [];
};

// Overlay update logic
window.updateTimelineOverlay = function({ year, event, species, contaminationRate, description, show, step, totalSteps, references }) {
  const header = document.querySelector('.overlay-header');
  const yearEl = document.querySelector('.overlay-year');
  const stat = document.querySelector('.overlay-stat');
  const statMain = document.querySelector('.overlay-stat-main');
  const statSublabel = document.querySelector('.overlay-stat-sublabel');
  const speciesEl = document.querySelector('.overlay-species');
  const footer = document.querySelector('.overlay-footer');
  const stepBars = document.querySelector('.overlay-step-bars');
  // Accept items_consumed as a raw value (for backward compatibility, fallback to contaminationRate)
  let itemsConsumed = typeof contaminationRate === 'number' && contaminationRate > 0 && contaminationRate < 1e6 ? contaminationRate : 0;
  if (typeof event === 'number' && event > 0) itemsConsumed = event;
  if (typeof window._lastItemsConsumed === 'undefined') window._lastItemsConsumed = 0;
  // If contaminationRate is a percent (0-1), but items_consumed is passed as event, prefer event
  if (typeof contaminationRate === 'number' && contaminationRate > 10) itemsConsumed = contaminationRate;
  // Header/footer always visible (no longer set by JS)
  // Show/hide stat+year block
  // Cancel previous overlay animations
  window.cancelTimelineOverlayAnimations();
  const myToken = window._timelineAnimToken;
  if (!show) {
    yearEl.style.opacity = 0;
    stat.style.opacity = 0;
    statMain.style.opacity = 0;
    statSublabel.style.opacity = 0;
    stepBars.innerHTML = '';
    return;
  }
  // Set content
  yearEl.textContent = '';
  // Animate statMain as a plain number (count up)
  let targetValue = itemsConsumed;
  statMain.textContent = '0';
  // speciesEl.textContent = species || ''; // Removed: do not show species
  // Step bars
  if (typeof step === 'number' && typeof totalSteps === 'number') {
    let bars = '';
    for (let i = 1; i <= totalSteps; i++) {
      bars += `<div class="step-bar${i === step ? ' active' : ''}"></div>`;
    }
    stepBars.innerHTML = bars;
  } else {
    stepBars.innerHTML = '';
  }
  // Highlight first part of description in pink
  let desc = description || '';
  let match = desc.match(/^(of [^,\s]+|of [^\s]+)/i);
  if (match) {
    statSublabel.innerHTML = `<span class='pink'>${match[0]}</span>` + desc.slice(match[0].length);
  } else {
    statSublabel.textContent = desc;
  }
  // Animate stat+year block in order: stat, year, typewriter
  // Remove transitions before resetting opacity to avoid unwanted fade
  yearEl.style.transition = 'none';
  statMain.style.transition = 'none';
  statSublabel.style.transition = 'none';
  yearEl.style.opacity = 0;
  statMain.style.opacity = 0;
  statSublabel.style.opacity = 0;
  statSublabel.style.display = 'none';
  stat.style.opacity = 1; // container always visible for layout
  statMain.textContent = '0'; // Reset stat to 0 before anim
  window.resetTypewriterAnimation();
  function addTimeout(fn, delay) {
    const id = setTimeout(fn, delay);
    window._timelineAnimTimeouts.push(id);
    return id;
  }
  function addFrame(fn) {
    const id = requestAnimationFrame(fn);
    window._timelineAnimFrames.push(id);
    return id;
  }

  // 1. Stat number (count up)
  addTimeout(() => {
    if (window._timelineAnimToken !== myToken) return;
    statMain.style.transition = 'opacity 0.5s';
    statMain.style.opacity = 1;
    if (window.playClickSound) window.playClickSound();
    let animStart = null;
    let animDuration = 1200;
    function animateCount(ts) {
      if (window._timelineAnimToken !== myToken) return;
      if (!animStart) animStart = ts;
      let elapsed = ts - animStart;
      let progress = Math.min(1, elapsed / animDuration);
      let val = Math.round(targetValue * progress);
      statMain.textContent = val.toLocaleString();
      if (progress < 1) {
        addFrame(animateCount);
      } else {
        statMain.textContent = targetValue.toLocaleString();
        // 2. Year (typewriter animation)
        yearEl.style.transition = 'none';
        yearEl.style.opacity = 1;
        yearEl.textContent = '';
        // Hide year until typewriter starts
        yearEl.style.visibility = 'hidden';
        let yearStr = String(year);
        let yearIdx = 0;
        const yearTypeToken = ++window._typewriterToken;
        function typeYear() {
          if (window._typewriterToken !== yearTypeToken || window._timelineAnimToken !== myToken) return;
          yearEl.textContent = yearStr.slice(0, yearIdx);
          if (yearIdx === 0) {
            yearEl.style.visibility = 'visible';
            if (window.playClickSound) {
              addTimeout(() => { if (window._typewriterToken === yearTypeToken && window._timelineAnimToken === myToken) window.playClickSoundTwo(); }, 80);
            }
          }
          if (yearIdx < yearStr.length) {
            yearIdx++;
            addTimeout(typeYear, 80);
          } else {
            // After year typewriter, play click sound and start description typewriter
            addTimeout(() => {
              if (window._timelineAnimToken !== myToken) return;
              window.playClickSound();
            }, 80);
            // 3. Typewriter description
            statSublabel.style.transition = '';
            statSublabel.style.display = 'block';
            statSublabel.style.opacity = 1;
            let sublabelHTML = '';
            let pinkSpan = null;
            let desc = description || '';
            let match = desc.match(/^(of [^,\s]+|of [^\s]+)/i);
            let sublabelText = '';
            if (match) {
              statSublabel.innerHTML = `<span class='pink'>${match[0]}</span>`;
              pinkSpan = statSublabel.querySelector('.pink');
              sublabelText = desc.slice(match[0].length);
              sublabelHTML = pinkSpan ? pinkSpan.outerHTML : '';
            } else {
              statSublabel.innerHTML = '';
              sublabelText = desc;
              sublabelHTML = '';
            }
            let i = 0;
            const typeToken = ++window._typewriterToken;
            function typeWriter() {
              if (window._typewriterToken !== typeToken || window._timelineAnimToken !== myToken) return;
              if (i === 0 && window.playClickSound) {
                addTimeout(() => { if (window._typewriterToken === typeToken && window._timelineAnimToken === myToken) window.playClickSoundTwo(); }, 80);
              }
              statSublabel.innerHTML = sublabelHTML + sublabelText.slice(0, i);
              if (i <= sublabelText.length) {
                i++;
                addTimeout(typeWriter, 9);
              } else {
                if (window._typewriterToken !== typeToken || window._timelineAnimToken !== myToken) return;
                if (references) {
                  statSublabel.innerHTML += ` <a alt=\"Click for related study\" href=\"${references}\" target=\"_blank\" rel=\"noopener noreferrer\">[+]</a>`;
                }
              }
            }
            typeWriter();
          }
        }
        typeYear();
      }
    }
    addFrame(animateCount);
  }, 200);
};