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
  if (!header || !yearEl || !stat || !statMain || !statSublabel || !footer || !speciesEl || !stepBars) return;
  // Header/footer always visible (no longer set by JS)
  // Show/hide stat+year block
  if (!show) {
    yearEl.style.opacity = 0;
    stat.style.opacity = 0;
    statMain.style.opacity = 0;
    statSublabel.style.opacity = 0;
    stepBars.innerHTML = '';
    return;
  }
  // Set content
  yearEl.textContent = year;
  statMain.textContent = Math.round(contaminationRate * 100) + '%';
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
  // Animate stat+year block in order: year, contam rate, description
  yearEl.style.opacity = 0;
  statMain.style.opacity = 0;
  statSublabel.style.opacity = 0;
  statSublabel.style.display = 'none';
  stat.style.opacity = 1; // container always visible for layout
  statMain.textContent = '00%'; // Reset stat to 00% before anim
  // speciesEl.style.opacity = 0; // Removed: do not show species
  setTimeout(() => {
    yearEl.style.transition = 'opacity 0.5s';
    yearEl.style.opacity = 1;
     setTimeout(() => window.playClickSound(), 80); // 80ms delay before sound
    setTimeout(() => {
      statMain.style.transition = 'opacity 0.5s';
      statMain.style.opacity = 1;
      // Play click sound at start of stat-main animation
      if (window.playClickSound) window.playClickSound();
      
      // Start contamination percentage animation (no fade)
      let targetPercent = Math.round((contaminationRate || 0) * 100);
      let animStart = null;
      let animDuration = 1200;
      function animatePercent(ts) {
        if (!animStart) animStart = ts;
        let elapsed = ts - animStart;
        let progress = Math.min(1, elapsed / animDuration);
        let val = Math.round(targetPercent * progress);
        statMain.textContent = (val < 10 ? '0' : '') + val + '%';
        if (progress < 1) {
          requestAnimationFrame(animatePercent);
        } else {
          statMain.textContent = (targetPercent < 10 ? '0' : '') + targetPercent + '%';
          // Typewriter effect for sublabel after percent animation
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
          function typeWriter() {
            // Play click sound only at start of sublabel animation, with a short delay
            if (i === 0 && window.playClickSound) {
              setTimeout(() => window.playClickSoundTwo(), 80); // 80ms delay before sound
            }
            statSublabel.innerHTML = sublabelHTML + sublabelText.slice(0, i);
            if (i <= sublabelText.length) {
              i++;
              setTimeout(typeWriter, 9); // speed in ms per letter
            } else {
              // Append [SRC] link if references exists
              if (references) {
                statSublabel.innerHTML += ` <a alt="Click for related study" href="${references}" target="_blank" rel="noopener noreferrer">[+]</a>`;
              }
              // speciesEl.style.transition = 'opacity 0.5s';
              // speciesEl.style.opacity = 1; // Removed: do not show species
            }
          }
          typeWriter();
        }
      }
      requestAnimationFrame(animatePercent);
    }, 400);
  }, 200);
};