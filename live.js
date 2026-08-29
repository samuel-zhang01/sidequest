(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const api = async (path, options = {}) => {
    const response = await fetch(path, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(body.error || `Request failed (${response.status})`);
    return body;
  };
  const post = (path, body = {}) => api(path, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
  const patch = (path, body = {}) => api(path, {
    method: 'PATCH', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body),
  });
  const wsUrl = (streamId, role) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/ws?streamId=${encodeURIComponent(streamId)}&role=${role}`;
  const escapeHtml = value => { const node = document.createElement('span'); node.textContent = String(value || ''); return node.innerHTML; };
  const pace = value => {
    if (!Number.isFinite(Number(value))) return '—';
    const seconds = Math.round(Number(value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}/km`;
  };
  const clock = seconds => `${String(Math.floor(Number(seconds || 0) / 60)).padStart(2, '0')}:${String(Math.round(Number(seconds || 0) % 60)).padStart(2, '0')}`;
  const setStatus = (target, message) => { const node = $(target); if (node) node.textContent = message; };

  const RECORDER_SLICE_MS = 1000;
  const MAX_SOCKET_BACKLOG = 2 * 1024 * 1024;
  const MAX_PENDING_MEDIA = 18;
  let me;
  let activeMode = 'me';
  let manualModeChoice = false;
  let broadcasting = false;
  let stopping = false;
  let broadcastStream;
  let viewedStream;
  let cameraStream;
  let mediaRecorder;
  let broadcastMimeType = '';
  let broadcastSocket;
  let broadcastReconnectTimer;
  let broadcastReconnectAttempts = 0;
  let viewerSocket;
  let viewerReconnectTimer;
  let viewerReconnectAttempts = 0;
  let leavingViewer = false;
  let gpsSession;
  let gpsWatch;
  let lastGps = 0;
  let gpsAcceptedDistance = 0;
  let gpsMovingSeconds = 0;
  let runnerMapTimer;
  let viewerMapTimer;
  let mediaSource;
  let sourceBuffer;
  let mediaQueue = [];
  let mediaObjectUrl = '';
  let chunkSendChain = Promise.resolve();
  let recorderDataSeen = 0;
  let recorderRequestTimer;
  let fallbackCaptureTimer;
  let fallbackCaptureBusy = false;
  let fallbackCanvas;
  let fallbackRequested = false;
  let playbackFallbackTimer;

  function switchMode(mode, {manual = true, announce = true} = {}) {
    if (!['me', 'watch'].includes(mode)) return;
    if (mode === 'me' && (viewerSocket || viewedStream)) closeViewer();
    activeMode = mode;
    if (manual) manualModeChoice = true;
    for (const value of ['me', 'watch']) {
      const button = $(`[data-mode="${value}"]`);
      const selected = value === mode;
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('aria-pressed', String(selected));
      $(`#${value}-mode`).hidden = !selected;
    }
    $('#you-live-chip').classList.toggle('hidden', !broadcasting || mode === 'me');
    if (announce) $('#mode-announcement').textContent = mode === 'me' ? 'Me mode. Your run controls are shown.' : 'Watch others mode. Live friends are shown.';
    const url = new URL(location.href);
    url.searchParams.set('mode', mode);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    if (mode === 'watch' && manual && !viewedStream) loadStreams({allowAutoJoin: true});
  }

  function renderStreams(streams) {
    const otherStreams = streams.filter(stream => stream.broadcaster.id !== me?.id);
    $('#live-friend-count').textContent = `${otherStreams.length} friend${otherStreams.length === 1 ? '' : 's'} live`;
    $('#streams').innerHTML = otherStreams.length ? otherStreams.map(stream => {
      const latest = stream.challenges?.[0];
      return `<button class="stream" data-stream="${stream.id}" aria-label="Watch ${escapeHtml(stream.broadcaster.displayName)} live"><span class="stream-author"><span class="face" style="background:${stream.broadcaster.accent}">${stream.broadcaster.avatarEmoji}</span><span><strong>${escapeHtml(stream.broadcaster.displayName)}</strong><span>${escapeHtml(stream.broadcaster.handle)} · ${stream.viewerCount} watching</span></span><b class="stream-live">Live</b></span><span class="stream-visual"><span class="stream-play" aria-hidden="true">▶</span></span><span class="stream-meta"><h3>${escapeHtml(stream.title)}</h3><p class="charity-line">Running for ${escapeHtml(stream.charityName)}</p><p>${latest ? `${escapeHtml(latest.challenger.displayName)} challenged ${(Number(latest.pledgeAmountMinor) / 100).toLocaleString(undefined, {style:'currency', currency:latest.currency})}` : 'Be the first to send a challenge'}</p><span class="stream-actions"><span class="watch-action">Watch live</span><span>Cheer</span><span>Challenge</span></span></span></button>`;
    }).join('') : '<div class="empty"><strong>Nobody else is live.</strong><br>Leave this view open and a friend’s run will appear automatically.</div>';
    document.querySelectorAll('[data-stream]').forEach(button => button.onclick = () => watchStream(button.dataset.stream));
  }

  async function loadStreams({allowAutoJoin = false} = {}) {
    if (!me) return;
    try {
      const result = await api('/api/live/streams');
      const streams = result.streams.filter(stream => stream.status === 'live');
      renderStreams(streams);
      const available = streams.find(stream => stream.broadcaster.id !== me.id);
      const shouldAutoJoin = available && !broadcasting && !viewerSocket && !viewedStream && (allowAutoJoin || (!manualModeChoice && activeMode === 'me'));
      if (shouldAutoJoin) {
        switchMode('watch', {manual: false});
        await watchStream(available.id);
      }
    } catch (error) {
      $('#streams').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function friendlyCameraError(error) {
    const name = error?.name;
    if (!window.isSecureContext) return Error('Camera access needs HTTPS. Open the public https:// address on your phone.');
    if (name === 'NotAllowedError' || name === 'SecurityError') return Error('Camera access is blocked. Allow camera access for this site, then try again.');
    if (name === 'NotReadableError' || name === 'AbortError') return Error('The camera is busy. Close other camera apps or tabs, then try again.');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return Error('No usable camera was found. Try Safari or Chrome directly instead of an in-app browser.');
    return Error(error?.message || 'The phone camera could not start.');
  }

  async function acquireCamera() {
    if (!window.isSecureContext) throw friendlyCameraError({name:'SecurityError'});
    if (!navigator.mediaDevices?.getUserMedia) throw Error('This browser cannot access the camera. Use a current Safari or Chrome browser.');
    const video = {facingMode:{ideal:'environment'}, width:{ideal:640}, height:{ideal:360}, frameRate:{ideal:24, max:30}};
    try {
      return {stream:await navigator.mediaDevices.getUserMedia({video, audio:{echoCancellation:true, noiseSuppression:true}}), videoOnly:false};
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw friendlyCameraError(error);
    }
    try { return {stream:await navigator.mediaDevices.getUserMedia({video, audio:false}), videoOnly:true}; }
    catch (error) {
      try { return {stream:await navigator.mediaDevices.getUserMedia({video:true, audio:false}), videoOnly:true}; }
      catch { throw friendlyCameraError(error); }
    }
  }

  function recorderCandidates(stream) {
    const audio = stream.getAudioTracks().length > 0;
    const safariFirst = /AppleWebKit/i.test(navigator.userAgent) && !/Chrome|Chromium/i.test(navigator.userAgent);
    const mp4 = audio ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'] : ['video/mp4;codecs=avc1.42E01E', 'video/mp4'];
    const webm = audio ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'] : ['video/webm;codecs=vp8', 'video/webm'];
    return [...(safariFirst ? [...mp4, ...webm] : [...webm, ...mp4]), ''];
  }

  async function startCompatibleRecorder(stream) {
    if (typeof MediaRecorder === 'undefined') throw Error('This browser cannot broadcast video. Update Safari or Chrome and try again.');
    let lastError;
    for (const mimeType of recorderCandidates(stream)) {
      if (mimeType && MediaRecorder.isTypeSupported && !MediaRecorder.isTypeSupported(mimeType)) continue;
      for (const options of [mimeType ? {mimeType} : {}, mimeType ? {mimeType, videoBitsPerSecond:500000, audioBitsPerSecond:48000} : {}]) {
        let recorder;
        try {
          recorder = new MediaRecorder(stream, options);
          recorder.ondataavailable = sendMediaChunk;
          recorder.onerror = event => recoverRecorder(event.error || Error('The camera recorder reported an error.'));
          recorder.onstop = () => {
            if (broadcasting && !stopping) recoverRecorder(Error('The camera recorder stopped unexpectedly.'));
          };
          try { recorder.start(RECORDER_SLICE_MS); }
          catch {
            recorder.start();
            recorderRequestTimer = setInterval(() => { if (recorder.state === 'recording') try { recorder.requestData(); } catch {} }, RECORDER_SLICE_MS);
          }
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 180);
            recorder.addEventListener('error', event => { clearTimeout(timer); reject(event.error || Error('Recorder failed during startup.')); }, {once:true});
          });
          return recorder;
        } catch (error) {
          lastError = error;
          if (recorder?.state && recorder.state !== 'inactive') try { recorder.stop(); } catch {}
          clearInterval(recorderRequestTimer); recorderRequestTimer = null;
        }
      }
    }
    throw Error(`Camera opened, but live recording could not start${lastError?.message ? `: ${lastError.message}` : '.'}`);
  }

  function sendMediaChunk(event) {
    if (!event.data?.size) return;
    recorderDataSeen += 1;
    const blob = event.data;
    chunkSendChain = chunkSendChain.then(async () => {
      if (broadcastSocket?.readyState !== WebSocket.OPEN || broadcastSocket.bufferedAmount > MAX_SOCKET_BACKLOG) return;
      broadcastSocket.send(await blob.arrayBuffer());
    }).catch(() => {});
  }

  async function restartRecorder() {
    if (!broadcasting || stopping || !cameraStream?.getVideoTracks().some(track => track.readyState === 'live')) return;
    clearInterval(recorderRequestTimer); recorderRequestTimer = null;
    const previous = mediaRecorder;
    if (previous) { previous.onstop = null; previous.onerror = null; previous.ondataavailable = null; }
    if (previous?.state !== 'inactive') try { previous.stop(); } catch {}
    mediaRecorder = await startCompatibleRecorder(cameraStream);
    broadcastMimeType = mediaRecorder.mimeType || broadcastMimeType || 'video/webm';
  }

  let recorderRecovering = false;
  async function recoverRecorder(error) {
    if (!broadcasting || stopping || recorderRecovering) return;
    recorderRecovering = true;
    $('#connection-state').textContent = 'Camera recovering';
    setStatus('#broadcast-status', `You are live. Recovering the camera recorder: ${error.message || 'unknown error'}`);
    try { await restartRecorder(); if (broadcastSocket?.readyState === WebSocket.OPEN) broadcastSocket.send(JSON.stringify({type:'media-start', mimeType:broadcastMimeType})); $('#connection-state').textContent = 'Live connected'; setStatus('#broadcast-status', 'You are live. Camera recording recovered.'); }
    catch (restartError) { $('#connection-state').textContent = 'Camera stopped'; setStatus('#broadcast-status', `Live connection remains open, but camera recording stopped: ${restartError.message}`); }
    finally { recorderRecovering = false; }
  }

  function handleBroadcasterMessage(message) {
    if (message.viewerCount != null) $('#broadcast-viewers').textContent = `${message.viewerCount} viewer${message.viewerCount === 1 ? '' : 's'}`;
    if (message.type === 'challenge') {
      addChallenge(message.challenge);
      showChallengeOverlay(message.challenge);
      setStatus('#broadcast-status', `You are live. ${message.challenge.challenger.displayName} sent a challenge.`);
    }
    if (message.type === 'challenge-response') updateChallenge(message.challenge);
    if (message.type === 'cheer') showReactionOverlay(message.cheer);
    if (message.type === 'fallback-viewers') setFallbackCapture(Number(message.viewerCount) > 0);
  }

  function setFallbackCapture(enabled) {
    clearInterval(fallbackCaptureTimer); fallbackCaptureTimer = null;
    if (!enabled || !broadcasting || !cameraStream) return;
    captureFallbackFrame();
    fallbackCaptureTimer = setInterval(captureFallbackFrame, 350);
  }

  function captureFallbackFrame() {
    if (fallbackCaptureBusy || !broadcasting || broadcastSocket?.readyState !== WebSocket.OPEN) return;
    const video = $('#local-video');
    if (video.readyState < 2 || !video.videoWidth) return;
    fallbackCaptureBusy = true;
    try {
      fallbackCanvas ||= document.createElement('canvas');
      const width = Math.min(480, video.videoWidth), height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      if (fallbackCanvas.width !== width || fallbackCanvas.height !== height) { fallbackCanvas.width = width; fallbackCanvas.height = height; }
      fallbackCanvas.getContext('2d', {alpha:false}).drawImage(video, 0, 0, width, height);
      const data = fallbackCanvas.toDataURL('image/jpeg', .52);
      if (data.length <= 350000 && broadcastSocket.bufferedAmount < MAX_SOCKET_BACKLOG) broadcastSocket.send(JSON.stringify({type:'fallback-frame', data}));
    } catch {} finally { fallbackCaptureBusy = false; }
  }

  function connectBroadcastSocket({initial = false} = {}) {
    return new Promise((resolve, reject) => {
      if (!broadcastStream || stopping) return reject(Error('No active stream to connect.'));
      const socket = new WebSocket(wsUrl(broadcastStream.id, 'broadcaster'));
      socket.binaryType = 'arraybuffer';
      broadcastSocket = socket;
      const timeout = setTimeout(() => { if (socket.readyState !== WebSocket.OPEN) { socket.close(); reject(Error('Live relay connection timed out.')); } }, 10000);
      socket.onopen = async () => {
        clearTimeout(timeout);
        if (socket !== broadcastSocket) return;
        broadcastReconnectAttempts = 0;
        $('#connection-state').textContent = 'Live connected';
        try {
          await restartRecorder();
          socket.send(JSON.stringify({type:'media-start', mimeType:broadcastMimeType}));
          resolve();
        } catch (error) { reject(error); }
      };
      socket.onmessage = event => { if (typeof event.data === 'string') try { handleBroadcasterMessage(JSON.parse(event.data)); } catch {} };
      socket.onerror = () => { if (initial) reject(Error('Could not open the live video channel.')); };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (socket !== broadcastSocket || stopping || !broadcasting) return;
        $('#connection-state').textContent = 'Reconnecting';
        setStatus('#broadcast-status', 'You are live locally. Reconnecting the video relay…');
        scheduleBroadcastReconnect();
      };
    });
  }

  function scheduleBroadcastReconnect() {
    clearTimeout(broadcastReconnectTimer);
    const delay = Math.min(5000, 500 * (2 ** Math.min(broadcastReconnectAttempts++, 4)));
    broadcastReconnectTimer = setTimeout(() => connectBroadcastSocket().catch(scheduleBroadcastReconnect), delay);
  }

  function updateBroadcastUi(isLive, videoOnly = false) {
    $('#runner-stage').classList.toggle('is-live', isLive);
    $('#broadcast-live').classList.toggle('hidden', !isLive);
    $('#start-button').classList.toggle('hidden', isLive);
    $('#stop-button').classList.toggle('hidden', !isLive);
    $('#creator-state').textContent = isLive ? `Broadcasting${videoOnly ? ' without microphone audio' : ''}` : 'Set up camera + route';
    $('#broadcast-form').querySelectorAll('input').forEach(input => input.disabled = isLive);
    $('#you-live-chip').classList.toggle('hidden', !isLive || activeMode === 'me');
  }

  async function startBroadcast(event) {
    event.preventDefault();
    if (broadcasting) return;
    manualModeChoice = true;
    switchMode('me', {manual:false});
    $('#start-button').disabled = true;
    setStatus('#broadcast-status', 'Requesting camera access…');
    let persisted = false;
    try {
      const capture = await acquireCamera();
      cameraStream = capture.stream;
      $('#local-video').srcObject = cameraStream;
      await $('#local-video').play().catch(() => {});
      $('#local-empty').classList.add('hidden');
      for (const track of cameraStream.getVideoTracks()) {
        track.onended = () => recoverRecorder(Error('Camera access ended.'));
        track.onmute = () => { if (broadcasting) $('#connection-state').textContent = 'Camera paused'; };
        track.onunmute = () => { if (broadcasting) $('#connection-state').textContent = 'Live connected'; };
      }
      setStatus('#broadcast-status', 'Starting the camera recorder…');
      mediaRecorder = await startCompatibleRecorder(cameraStream);
      broadcastMimeType = mediaRecorder.mimeType || 'video/webm';
      const result = await post('/api/live/streams/start', {
        title:$('#title').value, charityName:$('#charity').value, sponsorName:$('#sponsor').value,
        productName:$('#product').value, productUrl:$('#product-url').value,
      });
      persisted = true;
      broadcastStream = result.stream;
      broadcastStream.challenges ||= [];
      broadcasting = true;
      stopping = false;
      $('#broadcast-sponsor-copy').textContent = `${broadcastStream.sponsorName} · ${broadcastStream.productName}`;
      renderChallenges(broadcastStream.challenges, '#broadcast-challenges', '#broadcast-challenge-count');
      await connectBroadcastSocket({initial:true});
      updateBroadcastUi(true, capture.videoOnly);
      setStatus('#broadcast-status', `You are live${capture.videoOnly ? ' without microphone audio' : ''}. Video is ephemeral; route progress is recorded.`);
      if ($('#gps-toggle').checked) startGps(); else { $('#gps-signal').textContent = 'GPS off'; $('#gps-detail').textContent = 'Route sharing is off for this run.'; }
      clearInterval(runnerMapTimer); runnerMapTimer = setInterval(loadRunnerMap, 3000);
      loadStreams();
    } catch (error) {
      broadcasting = false;
      stopping = true;
      clearInterval(recorderRequestTimer); recorderRequestTimer = null;
      if (mediaRecorder?.state && mediaRecorder.state !== 'inactive') try { mediaRecorder.stop(); } catch {}
      broadcastSocket?.close(); broadcastSocket = null;
      cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null;
      if (persisted && broadcastStream) await post(`/api/live/streams/${broadcastStream.id}/stop`).catch(() => {});
      broadcastStream = null; mediaRecorder = null;
      $('#local-video').srcObject = null; $('#local-empty').classList.remove('hidden');
      $('#connection-state').textContent = 'Could not start';
      setStatus('#broadcast-status', error.message);
      updateBroadcastUi(false);
      stopping = false;
    } finally { $('#start-button').disabled = false; }
  }

  async function startGps() {
    if (!navigator.geolocation) {
      $('#gps-signal').textContent = 'GPS unavailable';
      $('#gps-detail').textContent = 'Video remains live; this browser has no GPS support.';
      return;
    }
    $('#gps-signal').textContent = 'GPS waiting';
    try {
      gpsSession = (await post('/api/gps-runs/start')).session;
      gpsWatch = navigator.geolocation.watchPosition(sendGps, error => {
        $('#gps-signal').textContent = error.code === 1 ? 'GPS denied' : 'GPS weak';
        $('#gps-detail').textContent = `Video remains live. ${error.message}`;
      }, {enableHighAccuracy:true, maximumAge:3000, timeout:15000});
    } catch (error) {
      $('#gps-signal').textContent = 'GPS unavailable';
      $('#gps-detail').textContent = `Video remains live. GPS could not start: ${error.message}`;
    }
  }

  async function sendGps(position) {
    if (!gpsSession || Date.now() - lastGps < 2500) return;
    lastGps = Date.now();
    try {
      const result = await post(`/api/gps-runs/${gpsSession.id}/samples`, {
        latitude:position.coords.latitude, longitude:position.coords.longitude,
        accuracy:position.coords.accuracy, recordedAt:new Date(position.timestamp).toISOString(),
      });
      gpsSession = result.session;
      gpsAcceptedDistance = Number(gpsSession.distance_meters);
      gpsMovingSeconds = Number(gpsSession.moving_seconds);
      $('#distance').textContent = `${(gpsAcceptedDistance / 1000).toFixed(2)} km`;
      $('#pace').textContent = result.paceSecondsPerKm ? pace(result.paceSecondsPerKm) : result.currentSpeedKph == null ? '—' : `${result.currentSpeedKph} km/h`;
      $('#moving-time').textContent = clock(gpsMovingSeconds);
      const accuracy = Math.round(Number(position.coords.accuracy || 0));
      $('#gps-signal').textContent = accuracy && accuracy > 40 ? 'GPS weak' : 'GPS connected';
      $('#gps-detail').textContent = accuracy ? `Last GPS fix now · ±${accuracy} m accuracy · abstract route only` : 'Last GPS fix now · abstract route only';
      loadRunnerMap();
    } catch (error) { $('#gps-signal').textContent = 'GPS retrying'; $('#gps-detail').textContent = error.message; }
  }

  async function stopBroadcast() {
    if (stopping || (!broadcasting && !broadcastStream)) return;
    stopping = true;
    broadcasting = false;
    updateBroadcastUi(false);
    $('#connection-state').textContent = 'Finishing';
    setStatus('#broadcast-status', 'Finishing your run…');
    clearTimeout(broadcastReconnectTimer); clearInterval(runnerMapTimer); clearInterval(recorderRequestTimer); clearInterval(fallbackCaptureTimer);
    if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
    const streamToStop = broadcastStream;
    const gpsToFinish = gpsSession;
    if (mediaRecorder?.state && mediaRecorder.state !== 'inactive') try { mediaRecorder.stop(); } catch {}
    cameraStream?.getTracks().forEach(track => track.stop());
    broadcastSocket?.close(1000, 'Runner finished');
    const tasks = [];
    if (streamToStop) tasks.push(post(`/api/live/streams/${streamToStop.id}/stop`));
    if (gpsToFinish) tasks.push(post(`/api/gps-runs/${gpsToFinish.id}/${gpsAcceptedDistance >= 20 && gpsMovingSeconds >= 10 ? 'finish' : 'cancel'}`, gpsAcceptedDistance >= 20 && gpsMovingSeconds >= 10 ? {perceivedExertion:4} : {}));
    const outcomes = await Promise.allSettled(tasks);
    const failure = outcomes.find(result => result.status === 'rejected');
    setStatus('#broadcast-status', failure ? `Stream ended. Run cleanup warning: ${failure.reason.message}` : 'Stream ended. Route, challenges and cheers are saved; video was not recorded.');
    broadcastSocket = null; broadcastStream = null; cameraStream = null; mediaRecorder = null;
    gpsSession = null; gpsWatch = null; gpsAcceptedDistance = 0; gpsMovingSeconds = 0; lastGps = 0;
    $('#local-video').srcObject = null; $('#local-empty').classList.remove('hidden');
    $('#gps-signal').textContent = 'GPS waiting'; $('#connection-state').textContent = 'Ready';
    stopping = false;
    loadStreams();
  }

  function addChallenge(challenge) {
    const target = broadcasting && challenge ? broadcastStream : viewedStream;
    if (!target) return;
    target.challenges ||= [];
    if (!target.challenges.some(item => item.id === challenge.id)) target.challenges.unshift(challenge);
    if (viewedStream?.id === target.id) renderChallenges(target.challenges, '#watch-challenges', '#watch-challenge-count');
    if (broadcastStream?.id === target.id) renderChallenges(target.challenges, '#broadcast-challenges', '#broadcast-challenge-count');
  }

  function updateChallenge(challenge) {
    for (const stream of [broadcastStream, viewedStream]) {
      if (!stream?.challenges) continue;
      const index = stream.challenges.findIndex(item => item.id === challenge.id);
      if (index >= 0) stream.challenges[index] = challenge;
    }
    if (viewedStream) renderChallenges(viewedStream.challenges, '#watch-challenges', '#watch-challenge-count');
    if (broadcastStream) renderChallenges(broadcastStream.challenges, '#broadcast-challenges', '#broadcast-challenge-count');
  }

  async function respondLiveChallenge(id, decision) {
    try {
      const result = await patch(`/api/live/challenges/${encodeURIComponent(id)}/response`, {decision});
      updateChallenge(result.challenge);
      setStatus('#broadcast-status', `Challenge ${decision}. Your choice was saved.`);
    } catch (error) { setStatus('#broadcast-status', error.message); }
  }

  function renderChallenges(challenges, target, countTarget) {
    const rows = challenges || [];
    $(countTarget).textContent = `${rows.length} ${target === '#broadcast-challenges' ? 'live' : 'sent'}`;
    const isRunner = target === '#broadcast-challenges';
    $(target).innerHTML = rows.length ? rows.map(item => `<article class="challenge-item"><div class="challenge-item-head"><span>${escapeHtml(item.challenger?.avatarEmoji || '🏃')}</span><strong>${escapeHtml(item.challenger?.displayName || 'A friend')}</strong><b>${(Number(item.pledgeAmountMinor || 0) / 100).toLocaleString(undefined, {style:'currency', currency:item.currency || 'GBP'})}</b></div><p><strong>${escapeHtml(item.message || 'Next kilometre challenge')}</strong><br>${pace(item.targetPaceSeconds)} · ${escapeHtml(item.charityName)}</p>${isRunner&&item.status==='pledged'?`<div class="challenge-response"><button class="button primary" data-live-response="accepted" data-live-challenge="${escapeHtml(item.id)}">Accept</button><button class="button" data-live-response="declined" data-live-challenge="${escapeHtml(item.id)}">Decline</button></div>`:`<span class="challenge-status">${escapeHtml(item.status)}</span>`}</article>`).join('') : '<div class="empty">None yet.</div>';
    document.querySelectorAll('[data-live-response]').forEach(button => button.onclick = () => respondLiveChallenge(button.dataset.liveChallenge, button.dataset.liveResponse));
  }

  function showChallengeOverlay(challenge) {
    const overlay = $('#broadcast-challenge-overlay');
    const money = (Number(challenge.pledgeAmountMinor || 0) / 100).toLocaleString(undefined, {style:'currency', currency:challenge.currency || 'GBP'});
    const card = document.createElement('div'); card.className = 'overlay-card';
    card.innerHTML = `<strong>${escapeHtml(challenge.challenger.displayName)} challenged ${money}</strong><span>${escapeHtml(challenge.message || 'Next kilometre challenge')} · ${pace(challenge.targetPaceSeconds)} · ${escapeHtml(challenge.charityName)}</span><span>Only if comfortable—safety stops count.</span>`;
    overlay.prepend(card); setTimeout(() => card.remove(), 6500);
  }

  function showReactionOverlay(cheer) {
    const overlay = $('#broadcast-reaction-overlay');
    const bubble = document.createElement('div'); bubble.className = 'reaction-bubble';
    bubble.textContent = `${cheer.emoji} ${cheer.display_name || cheer.displayName || 'A friend'}`;
    overlay.append(bubble); setTimeout(() => bubble.remove(), 4200);
  }

  function handleViewerMessage(message) {
    if (message.viewerCount != null) $('#watch-viewers').textContent = `${message.viewerCount} viewer${message.viewerCount === 1 ? '' : 's'}`;
    if (message.type === 'media-start') resetMedia(message.mimeType);
    if (message.type === 'cheer') { viewedStream.cheers ||= []; viewedStream.cheers.unshift(message.cheer); renderCheers(viewedStream.cheers); }
    if (message.type === 'challenge') addChallenge(message.challenge);
    if (message.type === 'challenge-response') updateChallenge(message.challenge);
    if (message.type === 'fallback-frame') showFallbackFrame(message.data);
    if (message.type === 'broadcaster-offline') { $('#watch-connection').textContent = 'Runner reconnecting'; setStatus('#watch-status', 'The runner is reconnecting…'); }
    if (message.type === 'broadcaster-online') { $('#watch-connection').textContent = 'Connected'; setStatus('#watch-status', 'Connected at the live edge. Video starts muted—tap Unmute for sound.'); }
    if (message.type === 'stream-ended') {
      $('#watch-connection').textContent = 'Ended'; setStatus('#watch-status', 'The runner ended this stream.');
      leavingViewer = true; viewerSocket?.close(); viewerSocket = null;
    }
  }

  function requestFrameFallback(reason) {
    clearTimeout(playbackFallbackTimer);
    if (fallbackRequested || viewerSocket?.readyState !== WebSocket.OPEN) return;
    fallbackRequested = true;
    viewerSocket.send(JSON.stringify({type:'fallback-request'}));
    $('#watch-connection').textContent = 'Compatibility mode';
    $('#remote-empty').classList.remove('hidden');
    $('#remote-empty').textContent = 'Connecting a phone-compatible video fallback…';
    setStatus('#watch-status', `${reason} Switching to the universal compatibility feed…`);
  }

  function showFallbackFrame(data) {
    if (!/^data:image\/jpeg;base64,/.test(data || '')) return;
    const image = $('#remote-fallback');
    image.src = data; image.classList.remove('hidden');
    $('#remote-video').classList.add('hidden'); $('#remote-empty').classList.add('hidden');
    $('#watch-connection').textContent = 'Connected';
    setStatus('#watch-status', 'Connected in phone compatibility mode. Video is live at a reduced frame rate.');
  }

  function connectViewerSocket() {
    if (!viewedStream || leavingViewer) return;
    const socket = new WebSocket(wsUrl(viewedStream.id, 'viewer'));
    viewerSocket = socket; socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (socket !== viewerSocket) return;
      fallbackRequested = false;
      viewerReconnectAttempts = 0; $('#watch-connection').textContent = 'Connected';
      setStatus('#watch-status', 'Connected at the live edge. Video starts muted—tap Unmute for sound.');
    };
    socket.onmessage = event => typeof event.data === 'string' ? (() => { try { handleViewerMessage(JSON.parse(event.data)); } catch {} })() : queueMedia(event.data);
    socket.onerror = () => { if (socket === viewerSocket) $('#watch-connection').textContent = 'Relay issue'; };
    socket.onclose = () => {
      if (socket !== viewerSocket || leavingViewer || !viewedStream) return;
      $('#watch-connection').textContent = 'Reconnecting'; setStatus('#watch-status', 'Live video disconnected. Rejoining…');
      scheduleViewerReconnect();
    };
  }

  function scheduleViewerReconnect() {
    clearTimeout(viewerReconnectTimer);
    const delay = Math.min(5000, 500 * (2 ** Math.min(viewerReconnectAttempts++, 4)));
    viewerReconnectTimer = setTimeout(async () => {
      if (!viewedStream || leavingViewer) return;
      try {
        const latest = await api(`/api/live/streams/${viewedStream.id}`);
        if (latest.stream.status === 'recovering') { setStatus('#watch-status', 'The runner is reconnecting after a service restart…'); scheduleViewerReconnect(); return; }
        if (latest.stream.status !== 'live') { handleViewerMessage({type:'stream-ended'}); return; }
        resetMediaSource(); connectViewerSocket();
      } catch { scheduleViewerReconnect(); }
    }, delay);
  }

  function resetMedia(mimeType) {
    resetMediaSource();
    const MediaSourceClass = window.ManagedMediaSource || window.MediaSource;
    if (!MediaSourceClass || (MediaSourceClass.isTypeSupported && !MediaSourceClass.isTypeSupported(mimeType))) {
      requestFrameFallback('This phone cannot decode the runner’s primary stream.');
      return;
    }
    try {
      mediaSource = new MediaSourceClass();
      mediaObjectUrl = URL.createObjectURL(mediaSource);
      $('#remote-video').src = mediaObjectUrl;
      mediaSource.addEventListener('sourceopen', () => {
        try {
          sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          try { sourceBuffer.mode = 'sequence'; } catch {}
          sourceBuffer.addEventListener('updateend', appendMedia);
          sourceBuffer.addEventListener('error', () => requestFrameFallback('The primary video decoder stopped.'));
          appendMedia();
        } catch (error) { requestFrameFallback(`Video format unavailable: ${error.message}.`); }
      }, {once:true});
      playbackFallbackTimer = setTimeout(() => {
        const video = $('#remote-video');
        if (video.readyState < 2 || !video.buffered.length) requestFrameFallback('The primary video did not start.');
      }, 4500);
    } catch (error) { requestFrameFallback(`Video could not initialise: ${error.message}.`); }
  }

  function resetMediaSource() {
    clearTimeout(playbackFallbackTimer); fallbackRequested = false;
    mediaQueue = []; sourceBuffer = null; mediaSource = null;
    const video = $('#remote-video'); video.removeAttribute('src'); video.srcObject = null; video.classList.remove('hidden'); video.load();
    const fallback = $('#remote-fallback'); if (fallback) { fallback.removeAttribute('src'); fallback.classList.add('hidden'); }
    if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl);
    mediaObjectUrl = '';
  }

  function queueMedia(chunk) {
    mediaQueue.push(chunk);
    if (mediaQueue.length > MAX_PENDING_MEDIA) mediaQueue = sourceBuffer ? mediaQueue.slice(-12) : [mediaQueue[0], ...mediaQueue.slice(-11)];
    appendMedia();
    $('#remote-video').play().catch(() => {});
  }

  function appendMedia() {
    if (!sourceBuffer || sourceBuffer.updating) return;
    const video = $('#remote-video');
    if (video.buffered.length) {
      const start = video.buffered.start(0), end = video.buffered.end(video.buffered.length - 1), lag = end - video.currentTime;
      if (lag > 2) video.currentTime = Math.max(start, end - .45);
      video.playbackRate = lag > 1 ? 1.06 : 1;
      if (end - start > 24) { try { sourceBuffer.remove(0, end - 12); return; } catch {} }
    }
    if (!mediaQueue.length) return;
    try { sourceBuffer.appendBuffer(mediaQueue.shift()); }
    catch (error) { setStatus('#watch-status', `Video playback paused: ${error.message}`); }
  }

  async function watchStream(streamId) {
    try {
      switchMode('watch', {manual:false});
      closeViewer({hide:false});
      leavingViewer = false;
      const result = await api(`/api/live/streams/${streamId}`);
      viewedStream = result.stream;
      if (viewedStream.status !== 'live') throw Error('That run has ended. Choose another live friend.');
      $('#watch').classList.remove('hidden'); $('#remote-empty').classList.remove('hidden');
      $('#watch-title').textContent = viewedStream.title;
      $('#watch-host').textContent = `${viewedStream.broadcaster.displayName} · ${viewedStream.broadcaster.handle}`;
      $('#watch-sponsor').textContent = `Sponsored by ${viewedStream.sponsorName}`;
      $('#watch-product').textContent = viewedStream.productName;
      const link = $('#watch-product-link'); link.classList.toggle('hidden', !viewedStream.productUrl); if (viewedStream.productUrl) link.href = viewedStream.productUrl;
      renderCheers(viewedStream.cheers); renderChallenges(viewedStream.challenges, '#watch-challenges', '#watch-challenge-count');
      $('#challenge-copy').textContent = `Next km at ${pace(Math.max(180, Number(viewedStream.averagePaceSeconds) - 5))} · ${viewedStream.charityName}`;
      $('#live-challenge-form').classList.toggle('hidden', viewedStream.broadcaster.id === me?.id);
      connectViewerSocket();
      clearInterval(viewerMapTimer); await loadViewerMap(); viewerMapTimer = setInterval(loadViewerMap, 3000);
      $('#watch').scrollIntoView({behavior:'smooth', block:'start'});
    } catch (error) { setStatus('#watch-status', error.message); }
  }

  function closeViewer({hide = true} = {}) {
    leavingViewer = true; clearTimeout(viewerReconnectTimer); clearInterval(viewerMapTimer);
    const socket = viewerSocket; viewerSocket = null; socket?.close(1000, 'Viewer left');
    viewedStream = null; resetMediaSource();
    if (hide) $('#watch').classList.add('hidden');
  }

  function renderCheers(cheers) {
    $('#cheer-feed').innerHTML = cheers?.length ? cheers.slice(0, 30).map(cheer => `<div class="feed-item"><strong>${escapeHtml(cheer.display_name)}</strong> sent ${escapeHtml(cheer.emoji)}</div>`).join('') : '<div class="empty">Be the first to cheer.</div>';
  }

  async function sendCheer(emoji) {
    if (!viewedStream) return;
    try { await post(`/api/live/streams/${viewedStream.id}/cheers`, {emoji}); }
    catch (error) { setStatus('#watch-status', error.message); }
  }

  async function sendLiveChallenge(event) {
    event.preventDefault(); if (!viewedStream) return;
    const button = event.submitter || event.currentTarget.querySelector('button'); button.disabled = true;
    try {
      const result = await post(`/api/live/streams/${viewedStream.id}/challenges`, {amountMinor:Math.round(Number($('#live-challenge-amount').value) * 100), currency:'GBP', taskType:$('#live-challenge-type').value, message:$('#live-challenge-message').value});
      addChallenge(result.challenge);
      setStatus('#watch-status', 'Challenge delivered to the runner. No payment was charged.');
    } catch (error) { setStatus('#watch-status', error.message); }
    finally { button.disabled = false; }
  }

  function routePoints(route) {
    if (!route.length) return '';
    const xs = route.map(point => Number(point.x)), ys = route.map(point => Number(point.y));
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return route.map(point => `${(8 + (Number(point.x) - minX) / Math.max(maxX - minX, 1) * 84).toFixed(2)},${(8 + (Number(point.y) - minY) / Math.max(maxY - minY, 1) * 44).toFixed(2)}`).join(' ');
  }

  async function loadRunnerMap() {
    if (!me || !broadcasting) return;
    try {
      const map = await api(`/api/live-map?userId=${encodeURIComponent(me.id)}`);
      const points = routePoints(map.route || []);
      $('#broadcast-route').setAttribute('points', points); $('#broadcast-route-shadow').setAttribute('points', points);
    } catch (error) { $('#gps-detail').textContent = `Map temporarily unavailable: ${error.message}`; }
  }

  async function loadViewerMap() {
    if (!viewedStream?.broadcaster) return;
    try {
      const map = await api(`/api/live-map?userId=${encodeURIComponent(viewedStream.broadcaster.id)}`);
      const stats = map.stats || {}, route = map.route || [], points = routePoints(route);
      $('#watch-distance').textContent = `${(Number(stats.distanceMeters || 0) / 1000).toFixed(2)} km`;
      $('#watch-pace').textContent = pace(stats.paceSecondsPerKm); $('#watch-time').textContent = clock(stats.movingSeconds);
      $('#route').setAttribute('points', points); $('#route-shadow').setAttribute('points', points);
      const freshness = stats.updatedAt ? Math.max(0, Math.round((Date.now() - new Date(stats.updatedAt)) / 1000)) : null;
      $('#watch-map-note').textContent = route.length ? `ABSTRACT ROUTE · ${freshness == null ? 'LIVE' : `${freshness}s AGO`}` : 'ABSTRACT ROUTE · WAITING FOR GPS';
    } catch (error) { $('#watch-map-note').textContent = 'ABSTRACT ROUTE · RETRYING'; setStatus('#watch-status', `Video connected. Map temporarily unavailable: ${error.message}`); }
  }

  function toggleFocus(container, button) {
    const next = !container.classList.contains('focus-mode');
    container.classList.toggle('focus-mode', next); container.classList.toggle('is-fullscreen', next);
    $('#runner-cockpit').classList.toggle('is-fullscreen', next && container.id === 'runner-stage');
    document.body.classList.toggle('has-focus-mode', next);
    button.setAttribute('aria-pressed', String(next)); button.textContent = next ? 'Exit full screen' : 'Full screen';
    if (next && container.requestFullscreen && !document.fullscreenElement) container.requestFullscreen().catch(() => {});
    else if (!next && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!next) button.focus();
  }

  function bindUi() {
    $('#runner-stage .stage-stats').classList.add('stats');
    $('.feed-heading h2').textContent = 'Friends running now';
    const remoteFallback = document.createElement('img');
    remoteFallback.id = 'remote-fallback'; remoteFallback.className = 'fallback-frame hidden'; remoteFallback.alt = 'Live compatibility feed from the runner';
    $('#remote-video').insertAdjacentElement('afterend', remoteFallback);
    const challengeForm = $('#live-challenge-form');
    challengeForm.classList.add('dynamic-challenge-compose');
    challengeForm.insertAdjacentHTML('afterbegin', `<select id="live-challenge-type" aria-label="Challenge type"><option value="pace-boost">Pace boost · next km</option><option value="hold-steady">Hold steady · next km</option><option value="finish-strong">Finish strong · 1 minute</option><option value="custom">Custom challenge</option></select><input id="live-challenge-message" maxlength="120" value="Push the next kilometre just above your recent average" aria-label="Challenge message">`);
    $('#live-challenge-type').onchange = event => {
      const messages = {'pace-boost':'Push the next kilometre just above your recent average','hold-steady':'Hold a comfortable, steady pace for the next kilometre','finish-strong':'Finish the next controlled minute feeling strong','custom':''};
      $('#live-challenge-message').value = messages[event.target.value];
      if (event.target.value === 'custom') $('#live-challenge-message').focus();
    };
    $('#remote-video').addEventListener('playing', () => { clearTimeout(playbackFallbackTimer); $('#remote-empty').classList.add('hidden'); $('#remote-fallback').classList.add('hidden'); $('#remote-video').classList.remove('hidden'); });
    $('#remote-video').addEventListener('error', () => requestFrameFallback('The primary video could not be decoded.'));
    document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => switchMode(button.dataset.mode));
    $('#broadcast-form').onsubmit = startBroadcast;
    $('#stop-button').onclick = stopBroadcast; $('#stage-stop-button').onclick = stopBroadcast;
    $('#live-challenge-form').onsubmit = sendLiveChallenge;
    $('#close-watch').onclick = () => closeViewer();
    document.querySelectorAll('[data-cheer]').forEach(button => button.onclick = () => sendCheer(button.dataset.cheer));
    $('#cockpit-toggle').setAttribute('aria-pressed', 'false');
    $('#cockpit-toggle').onclick = () => toggleFocus($('#runner-stage'), $('#cockpit-toggle'));
    $('#viewer-fullscreen').setAttribute('aria-pressed', 'false');
    $('#viewer-fullscreen').onclick = () => toggleFocus($('#viewer-stage'), $('#viewer-fullscreen'));
    $('#unmute-video').onclick = () => { const video = $('#remote-video'); video.muted = !video.muted; $('#unmute-video').textContent = video.muted ? 'Unmute' : 'Mute'; video.play().catch(() => {}); };
    $('#you-live-chip').onclick = () => switchMode('me');
    $('#nav-logout').onclick = async () => { if (broadcasting) await stopBroadcast(); await post('/api/auth/logout'); location.href = '/'; };
    $('#remote-video').muted = true;
    window.addEventListener('online', () => { if (broadcasting && broadcastSocket?.readyState !== WebSocket.OPEN) scheduleBroadcastReconnect(); if (viewedStream && viewerSocket?.readyState !== WebSocket.OPEN) scheduleViewerReconnect(); });
    window.addEventListener('pageshow', () => { if (broadcasting && broadcastSocket?.readyState !== WebSocket.OPEN) scheduleBroadcastReconnect(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadStreams(); if (broadcasting && broadcastSocket?.readyState !== WebSocket.OPEN) scheduleBroadcastReconnect(); } });
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) return;
      for (const [container, button] of [[$('#runner-stage'), $('#cockpit-toggle')], [$('#viewer-stage'), $('#viewer-fullscreen')]]) {
        if (!container.classList.contains('focus-mode')) continue;
        container.classList.remove('focus-mode', 'is-fullscreen'); button.setAttribute('aria-pressed', 'false'); button.textContent = 'Full screen';
      }
      $('#runner-cockpit').classList.remove('is-fullscreen'); document.body.classList.remove('has-focus-mode');
    });
  }

  bindUi();
  api('/api/auth/me').then(result => {
    if (!result.user) { location.href = '/?next=/live'; return; }
    me = result.user;
    $('#user-name').textContent = me.displayName; $('#avatar').textContent = me.initials;
    $('#creator-avatar').textContent = me.avatarEmoji; $('#creator-avatar').style.background = me.accent;
    $('#nav-avatar').textContent = me.initials; $('#nav-user-name').textContent = me.displayName;
    const requestedMode = new URL(location.href).searchParams.get('mode');
    if (requestedMode === 'watch') switchMode('watch', {manual:true, announce:false});
    else switchMode('me', {manual:requestedMode === 'me', announce:false});
    loadStreams({allowAutoJoin:requestedMode !== 'me'});
    setInterval(() => { if (document.visibilityState === 'visible') loadStreams(); }, 5000);
  }).catch(() => { location.href = '/?next=/live'; });
})();
