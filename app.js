(() => {
  'use strict';

  const cfg = window.PRONUNCIATION_CONFIG || {};
  const client = window.supabase?.createClient?.(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const FALLBACK_READINGS = [
    {
      id: 'demo-1', number: 1, slug: 'sunday-by-the-river', title: 'Sunday by the River',
      subtitle: 'A quiet afternoon that moves from a bustling high street to a peaceful riverside walk.',
      level: 'Warm-up', minutes: 2, active: true,
      sections: [
        'On Sunday afternoon, Maya left the bustling high street and wandered towards the river. The weather was mild, and the town felt unusually calm after a busy morning.',
        'She stopped beside a picturesque bookshop, bought a small travel journal, and continued along the promenade. A musician nearby was playing softly while families enjoyed their leisure time.',
        'Further along, the path became quieter. Maya slowed her pace, listened to the water, and noticed how different the town sounded when nobody seemed to be in a hurry.',
        'Before heading home, she found a charming café near the bridge. She ordered tea, wrote a few lines in her journal, and enjoyed the tranquil end to her afternoon.'
      ]
    },
    {
      id: 'demo-2', number: 2, slug: 'the-morning-train', title: 'The Morning Train',
      subtitle: 'A familiar commute with useful contrasts in rhythm, weak forms and connected speech.',
      level: 'Everyday rhythm', minutes: 2, active: true,
      sections: [
        'Daniel usually catches the half-past seven train into the city, but this morning the platform was unusually crowded. He checked the board twice and moved closer to the front.',
        'When the train arrived, everyone stepped forward at once. Daniel found a seat by the window, placed his bag beneath the table, and opened the article he had saved earlier.',
        'Outside, rows of houses gradually gave way to warehouses and office blocks. Inside, conversations softened as commuters settled into the familiar rhythm of the journey.',
        'By the time the train reached the final stop, Daniel had finished reading. He joined the crowd, walked briskly through the station, and headed towards his first meeting.'
      ]
    },
    {
      id: 'demo-3', number: 3, slug: 'an-unplanned-dinner', title: 'An Unplanned Dinner',
      subtitle: 'Natural conversational phrasing, linking and stress through a spontaneous evening with friends.',
      level: 'Connected speech', minutes: 2, active: true,
      sections: [
        'Priya had planned a quiet evening at home, but a message from an old friend changed everything. Within twenty minutes, she was walking towards a small restaurant nearby.',
        'The place was lively without being noisy. They chose a corner table, ordered several dishes to share, and spent the first hour catching up on work, travel and family news.',
        'Halfway through dinner, another friend happened to walk past the window. They waved him inside, pulled over an extra chair, and somehow turned a simple meal into a reunion.',
        'Nobody had arranged the evening in advance, which made it feel even better. Priya walked home later than expected, tired but grateful for the unexpected company.'
      ]
    },
    {
      id: 'demo-4', number: 4, slug: 'a-change-of-plan', title: 'A Change of Plan',
      subtitle: 'Longer thought groups and expressive intonation in a story about adapting when plans fall apart.',
      level: 'Intonation', minutes: 2, active: true,
      sections: [
        'The forecast had promised clear skies, so Leo and his sister planned to spend Saturday in the countryside. By breakfast, however, heavy rain was already hitting the windows.',
        'For a moment, both of them were disappointed. Then Leo suggested visiting a museum they had talked about for months but never quite managed to see.',
        'The exhibition was far more interesting than either of them expected. They stayed for nearly three hours, discussing photographs, old maps and a surprisingly detailed model railway.',
        'On the journey home, the rain finally stopped. Their original plan had failed completely, yet the day had still felt worthwhile, memorable and pleasantly spontaneous.'
      ]
    },
    {
      id: 'demo-5', number: 5, slug: 'the-presentation', title: 'The Presentation',
      subtitle: 'A confident, work-focused reading with deliberate stress, clarity and sentence endings.',
      level: 'Clear delivery', minutes: 2, active: true,
      sections: [
        'Aisha had prepared carefully for the presentation, but she still felt a sense of trepidation before entering the room. She paused outside, reviewed her opening line, and took a steady breath.',
        'Once she began speaking, the nerves gradually faded. Instead of rushing through the slides, she focused on one idea at a time and allowed important points to land properly.',
        'During the questions, a colleague challenged one of her assumptions. Aisha did not become defensive; she acknowledged the concern, clarified her reasoning, and invited another perspective.',
        'Afterwards, her manager praised the structure and calm delivery. Aisha knew there were still things to refine, but she left feeling considerably more confident than before.'
      ]
    },
    {
      id: 'demo-6', number: 6, slug: 'revision-room', title: 'The Revision Room',
      subtitle: 'A future cumulative reading built from the words learners genuinely need to revisit.',
      level: 'Community revision', minutes: 3, active: false,
      sections: ['This reading will be built from recurring target words after enough real feedback has been collected.']
    }
  ];

  const state = {
    session: null,
    isAdmin: false,
    readings: [],
    currentReading: null,
    mediaStream: null,
    mediaRecorder: null,
    audioChunks: [],
    audioBlob: null,
    audioUrl: null,
    recordStartedAt: null,
    recordDuration: 0,
    recordTimer: null,
    audioContext: null,
    analyser: null,
    analyserFrame: null,
    adminSubmissions: [],
    selectedSubmission: null,
    selectedToken: null,
    feedbackAudioBlob: null,
    feedbackRecorder: null,
    feedbackStream: null,
    feedbackChunks: []
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const formatDate = value => new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric' }).format(new Date(value));
  const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
  const cleanRedirectUrl = () => `${window.location.origin}${window.location.pathname}`;
  const isDemoReading = reading => String(reading?.id || '').startsWith('demo-');

  function showToast(message, ms = 3200) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.add('hidden'), ms);
  }

  function setStatus(el, message = '', type = '') {
    el.textContent = message;
    el.className = `form-status${type ? ` ${type}` : ''}`;
  }

  function setView(name) {
    $$('.view').forEach(v => v.classList.remove('is-visible'));
    $(`#view-${name}`)?.classList.add('is-visible');
    $$('.nav-link').forEach(n => n.classList.toggle('is-active', n.dataset.view === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'progress') loadProgress();
    if (name === 'discussion') loadComments();
    if (name === 'admin' && state.isAdmin) loadAdminQueue();
  }

  async function init() {
    bindUI();
    drawIdleVisualiser();
    await loadReadings();
    renderReadingGrid();

    if (!client) {
      showToast('Supabase client could not load. Check your internet connection.');
      return;
    }

    const { data } = await client.auth.getSession();
    state.session = data.session;
    await refreshAccountUI();
    await loadComments();

    client.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      await refreshAccountUI();
      if (session) setTimeout(processPendingSubmission, 150);
    });

    if (state.session) await processPendingSubmission();
  }

  function bindUI() {
    $$('.nav-link').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    $$('[data-view-target]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.viewTarget)));
    $('#startFirstReading').addEventListener('click', () => openReading(state.readings.find(r => r.active) || state.readings[0]));
    $('#backToLibrary').addEventListener('click', () => setView('home'));
    $('#recordButton').addEventListener('click', toggleRecording);
    $('#rerecordButton').addEventListener('click', resetRecording);
    $('#openSubmitButton').addEventListener('click', openSubmitModal);
    $('#submitRecordingButton').addEventListener('click', submitRecordingFlow);
    $$('[data-close-submit]').forEach(el => el.addEventListener('click', closeSubmitModal));
    $$('[data-open-auth]').forEach(el => el.addEventListener('click', openAuthModal));
    $$('[data-close-auth]').forEach(el => el.addEventListener('click', closeAuthModal));
    $('#sendMagicLinkButton').addEventListener('click', sendMagicLink);
    $('#accountButton').addEventListener('click', accountButtonAction);
    $('#signOutButton').addEventListener('click', signOut);
    $('#postCommentButton').addEventListener('click', postComment);
    $('#submitName').addEventListener('input', e => localStorage.setItem('pronunciation_display_name', e.target.value.trim()));
    $('#commentName').addEventListener('input', e => localStorage.setItem('pronunciation_display_name', e.target.value.trim()));
    document.addEventListener('click', e => {
      if (!e.target.closest('.account-wrap')) $('#accountMenu').classList.add('hidden');
    });
  }

  async function loadReadings() {
    if (!client) { state.readings = FALLBACK_READINGS; return; }
    const { data, error } = await client.from('readings').select('*').order('number', { ascending: true });
    if (error || !data?.length) {
      state.readings = FALLBACK_READINGS;
      return;
    }
    state.readings = data.map(r => ({ ...r, minutes: r.minutes || 2, sections: Array.isArray(r.sections) ? r.sections : [] }));
  }

  function renderReadingGrid() {
    const grid = $('#readingGrid');
    grid.innerHTML = state.readings.map(reading => `
      <article class="reading-card glass-card ${reading.active ? '' : 'is-locked'}" data-reading-id="${escapeHtml(reading.id)}">
        <div class="number"><span>Reading ${String(reading.number).padStart(2,'0')}</span><span>${escapeHtml(reading.level || 'Practice')}</span></div>
        <h3>${escapeHtml(reading.title)}</h3>
        <p>${escapeHtml(reading.subtitle || '')}</p>
        <div class="reading-card-footer"><span>${reading.minutes || 2} min · ${reading.sections?.length || 0} passages</span><b>${reading.active ? 'Open →' : 'Coming later'}</b></div>
      </article>`).join('');
    $$('.reading-card', grid).forEach(card => card.addEventListener('click', () => {
      const reading = state.readings.find(r => String(r.id) === card.dataset.readingId);
      if (reading?.active) openReading(reading);
    }));
  }

  function openReading(reading) {
    if (!reading) return;
    state.currentReading = reading;
    resetRecording();
    $('#readingNumber').textContent = `Reading ${String(reading.number).padStart(2,'0')} · ${reading.level || 'Practice'}`;
    $('#readingLength').textContent = `${reading.minutes || 2} min read`;
    $('#readingTitle').textContent = reading.title;
    $('#readingIntro').textContent = reading.subtitle || '';
    $('#passageText').innerHTML = (reading.sections || []).map(p => `<p>${escapeHtml(p)}</p>`).join('');
    setView('reading');
  }

  async function refreshAccountUI() {
    const button = $('#accountButton');
    const label = $('#accountLabel');
    const menu = $('#accountMenu');
    menu.classList.add('hidden');

    if (state.session?.user) {
      button.classList.add('signed-in');
      label.textContent = state.session.user.email?.split('@')[0] || 'Signed in';
      $('#accountEmail').textContent = state.session.user.email || '';
      $('#submitEmail').value = state.session.user.email || '';
      $('#submitEmail').disabled = true;
      state.isAdmin = await checkAdmin();
    } else {
      button.classList.remove('signed-in');
      label.textContent = 'Sign in';
      $('#accountEmail').textContent = '';
      $('#submitEmail').disabled = false;
      state.isAdmin = false;
    }

    $$('.admin-only').forEach(el => el.classList.toggle('hidden', !state.isAdmin));
    $('#progressSignedOut').classList.toggle('hidden', !!state.session);
    $('#progressContent').classList.toggle('hidden', !state.session);
    $('#commentAuthHint').textContent = state.session ? 'Your email stays private.' : 'You need to be signed in before posting.';
    const savedName = localStorage.getItem('pronunciation_display_name') || '';
    if (!$('#submitName').value) $('#submitName').value = savedName;
    if (!$('#commentName').value) $('#commentName').value = savedName;
  }

  async function checkAdmin() {
    try {
      const { data, error } = await client.rpc('is_admin');
      return !error && data === true;
    } catch { return false; }
  }

  function accountButtonAction() {
    if (!state.session) return openAuthModal();
    $('#accountMenu').classList.toggle('hidden');
  }

  async function signOut() {
    await client.auth.signOut();
    state.session = null;
    state.isAdmin = false;
    $('#accountMenu').classList.add('hidden');
    await refreshAccountUI();
    setView('home');
    showToast('Signed out.');
  }

  function openAuthModal() {
    $('#authModal').classList.remove('hidden');
    $('#authEmail').value = state.session?.user?.email || '';
    setStatus($('#authStatus'));
    setTimeout(() => $('#authEmail').focus(), 50);
  }
  function closeAuthModal() { $('#authModal').classList.add('hidden'); }

  async function sendMagicLink() {
    const email = $('#authEmail').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setStatus($('#authStatus'), 'Enter a valid email address.', 'error');
    setStatus($('#authStatus'), 'Sending your sign-in link…');
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: cleanRedirectUrl(), shouldCreateUser: true }
    });
    if (error) return setStatus($('#authStatus'), error.message, 'error');
    setStatus($('#authStatus'), 'Check your inbox. Open the link on this device and browser.', 'success');
  }

  async function toggleRecording() {
    if (state.mediaRecorder?.state === 'recording') return stopRecording();
    await startRecording();
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return showToast('This browser does not support microphone recording. Try a current version of Chrome, Edge, Safari or Firefox.');
    }
    try {
      resetRecording(false);
      state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mimeTypes = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'];
      const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
      state.mediaRecorder = new MediaRecorder(state.mediaStream, mimeType ? { mimeType } : undefined);
      state.audioChunks = [];
      state.mediaRecorder.ondataavailable = e => { if (e.data?.size) state.audioChunks.push(e.data); };
      state.mediaRecorder.onstop = finishRecording;
      state.mediaRecorder.start(250);
      state.recordStartedAt = Date.now();
      $('#recordButton').classList.add('recording');
      $('#recordingStateChip').textContent = 'Recording';
      $('#recordingStateChip').classList.add('recording');
      $('#recordPrompt').textContent = 'Recording now';
      $('#recordSubPrompt').textContent = 'Read naturally. Stop when you finish the whole story.';
      $('#playbackArea').classList.add('hidden');
      state.recordTimer = setInterval(() => {
        const seconds = (Date.now() - state.recordStartedAt) / 1000;
        $('#recordingTime').textContent = formatTime(seconds);
      }, 250);
      startVisualiser(state.mediaStream);
    } catch (err) {
      showToast(err?.name === 'NotAllowedError' ? 'Microphone permission was blocked. Please allow microphone access and try again.' : 'Could not start the microphone.');
    }
  }

  function stopRecording() {
    if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
  }

  function finishRecording() {
    const duration = Math.max(1, (Date.now() - state.recordStartedAt) / 1000);
    state.recordDuration = duration;
    const type = state.mediaRecorder?.mimeType || 'audio/webm';
    state.audioBlob = new Blob(state.audioChunks, { type });
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = URL.createObjectURL(state.audioBlob);
    $('#playbackAudio').src = state.audioUrl;
    $('#playbackArea').classList.remove('hidden');
    $('#recordButton').classList.remove('recording');
    $('#recordingStateChip').textContent = 'Recorded';
    $('#recordingStateChip').classList.remove('recording');
    $('#recordPrompt').textContent = 'Listen back';
    $('#recordSubPrompt').textContent = 'Keep it, or record another attempt before submitting.';
    $('#recordingTime').textContent = formatTime(duration);
    clearInterval(state.recordTimer);
    stopMediaStream();
    stopVisualiser();
  }

  function resetRecording(clearBlob = true) {
    if (state.mediaRecorder?.state === 'recording') {
      state.mediaRecorder.onstop = null;
      state.mediaRecorder.stop();
    }
    clearInterval(state.recordTimer);
    stopMediaStream();
    stopVisualiser();
    if (clearBlob) {
      state.audioBlob = null;
      state.recordDuration = 0;
      state.audioChunks = [];
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = null;
      $('#playbackAudio').removeAttribute('src');
      $('#playbackArea').classList.add('hidden');
      $('#recordingTime').textContent = '00:00';
    }
    $('#recordButton').classList.remove('recording');
    $('#recordingStateChip').textContent = 'Ready';
    $('#recordingStateChip').classList.remove('recording');
    $('#recordPrompt').textContent = 'Start recording';
    $('#recordSubPrompt').textContent = 'Your microphone stays in your browser until you submit.';
    drawIdleVisualiser();
  }

  function stopMediaStream() {
    state.mediaStream?.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
  }

  function drawIdleVisualiser() {
    const canvas = $('#visualiser');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = 'rgba(157,245,201,.22)';
    const bars = 44;
    for (let i=0;i<bars;i++) {
      const x = 16 + i * ((w-32)/bars);
      const bh = 4 + (Math.sin(i*.8)+1)*5;
      ctx.beginPath(); ctx.roundRect(x, h/2-bh/2, 4, bh, 2); ctx.fill();
    }
  }

  function startVisualiser(stream) {
    const canvas = $('#visualiser');
    const ctx = canvas.getContext('2d');
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 128;
    const source = state.audioContext.createMediaStreamSource(stream);
    source.connect(state.analyser);
    const data = new Uint8Array(state.analyser.frequencyBinCount);
    const draw = () => {
      state.analyserFrame = requestAnimationFrame(draw);
      state.analyser.getByteFrequencyData(data);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const barW = canvas.width / data.length;
      data.forEach((v,i) => {
        const pct = v / 255;
        const barH = 8 + pct * 118;
        const grad = ctx.createLinearGradient(0, canvas.height/2-barH/2, 0, canvas.height/2+barH/2);
        grad.addColorStop(0,'rgba(158,183,255,.4)'); grad.addColorStop(.5,'rgba(157,245,201,.95)'); grad.addColorStop(1,'rgba(158,183,255,.28)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(i*barW+2,canvas.height/2-barH/2,Math.max(2,barW-4),barH,4); ctx.fill();
      });
    };
    draw();
  }

  function stopVisualiser() {
    if (state.analyserFrame) cancelAnimationFrame(state.analyserFrame);
    state.analyserFrame = null;
    state.audioContext?.close?.().catch(()=>{});
    state.audioContext = null;
    state.analyser = null;
    if ($('#visualiser')) drawIdleVisualiser();
  }

  function openSubmitModal() {
    if (!state.audioBlob) return showToast('Record your reading first.');
    $('#submitModal').classList.remove('hidden');
    $('#submitName').value = localStorage.getItem('pronunciation_display_name') || $('#submitName').value || '';
    $('#submitEmail').value = state.session?.user?.email || $('#submitEmail').value || '';
    $('#submitEmail').disabled = !!state.session;
    setStatus($('#submitStatus'));
  }
  function closeSubmitModal() { $('#submitModal').classList.add('hidden'); }

  async function submitRecordingFlow() {
    const name = $('#submitName').value.trim();
    const email = (state.session?.user?.email || $('#submitEmail').value).trim().toLowerCase();
    if (name.length < 2) return setStatus($('#submitStatus'), 'Please enter a display name.', 'error');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setStatus($('#submitStatus'), 'Please enter a valid email address.', 'error');
    if (!state.currentReading || !state.audioBlob) return setStatus($('#submitStatus'), 'Your recording is missing. Please record again.', 'error');
    if (isDemoReading(state.currentReading)) return setStatus($('#submitStatus'), 'The interface is ready, but the Supabase setup SQL must be run before submissions can be stored.', 'error');

    localStorage.setItem('pronunciation_display_name', name);
    const duration = Math.max(1, state.recordDuration || 0);

    if (!state.session) {
      setStatus($('#submitStatus'), 'Saving your recording in this browser and sending a secure sign-in link…');
      await pendingStorePut({
        id: 'pending-submission', blob: state.audioBlob, readingId: state.currentReading.id,
        displayName: name, email, duration, createdAt: Date.now(), mimeType: state.audioBlob.type
      });
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: cleanRedirectUrl(), shouldCreateUser: true } });
      if (error) return setStatus($('#submitStatus'), error.message, 'error');
      setStatus($('#submitStatus'), 'Check your inbox. Open the sign-in link on this same browser to finish submitting automatically.', 'success');
      return;
    }

    if (state.session.user.email?.toLowerCase() !== email) {
      return setStatus($('#submitStatus'), `You are signed in as ${state.session.user.email}. Sign out first to submit under another email.`, 'error');
    }
    await uploadSubmission({ blob: state.audioBlob, readingId: state.currentReading.id, displayName: name, duration, mimeType: state.audioBlob.type }, $('#submitStatus'));
  }

  async function processPendingSubmission() {
    if (!state.session?.user) return;
    const pending = await pendingStoreGet('pending-submission');
    if (!pending) return;
    if (pending.email?.toLowerCase() !== state.session.user.email?.toLowerCase()) return;
    showToast('Finishing your saved pronunciation submission…', 5000);
    const status = $('#submitStatus');
    $('#submitModal').classList.remove('hidden');
    setStatus(status, 'You are signed in. Uploading your saved recording…');
    const ok = await uploadSubmission(pending, status, true);
    if (ok) await pendingStoreDelete('pending-submission');
  }

  async function uploadSubmission(payload, statusEl, fromPending = false) {
    try {
      setStatus(statusEl, 'Uploading your private recording…');
      const submissionId = crypto.randomUUID();
      const ext = payload.mimeType?.includes('mp4') ? 'm4a' : payload.mimeType?.includes('ogg') ? 'ogg' : 'webm';
      const audioPath = `${state.session.user.id}/${submissionId}.${ext}`;
      const { error: uploadError } = await client.storage.from('practice-audio').upload(audioPath, payload.blob, { contentType: payload.mimeType || 'audio/webm', upsert: false });
      if (uploadError) throw uploadError;

      const { error: rowError } = await client.from('submissions').insert({
        id: submissionId,
        user_id: state.session.user.id,
        reading_id: payload.readingId,
        display_name: payload.displayName,
        audio_path: audioPath,
        duration_seconds: Math.round(payload.duration || 0),
        status: 'submitted'
      });
      if (rowError) {
        await client.storage.from('practice-audio').remove([audioPath]).catch(()=>{});
        throw rowError;
      }

      setStatus(statusEl, 'Submitted privately. Your recording is now waiting for review.', 'success');
      showToast('Reading submitted for feedback.');
      setTimeout(() => {
        closeSubmitModal();
        if (!fromPending) resetRecording();
        setView('progress');
      }, 1300);
      return true;
    } catch (err) {
      setStatus(statusEl, err.message || 'Something went wrong while submitting.', 'error');
      return false;
    }
  }

  async function loadProgress() {
    if (!state.session || !client) return;
    $('#progressSignedOut').classList.add('hidden');
    $('#progressContent').classList.remove('hidden');
    const [{ data: submissions, error }, { data: marks }, { data: feedbackRows }] = await Promise.all([
      client.from('submissions').select('id,created_at,status,display_name,reading_id,readings(title,number)').order('created_at',{ascending:false}),
      client.from('word_feedback').select('id,submission_id,word,status,note,created_at').order('created_at',{ascending:false}),
      client.from('feedback').select('id,submission_id,overall_text,audio_path,published_at').order('published_at',{ascending:false})
    ]);
    if (error) return showToast('Could not load your progress yet.');
    const rows = submissions || [];
    const feedbackMap = new Map((feedbackRows || []).map(f => [f.submission_id, f]));
    await Promise.all((feedbackRows || []).filter(f => f.audio_path).map(async f => {
      const { data } = await client.storage.from('feedback-audio').createSignedUrl(f.audio_path, 3600);
      if (data?.signedUrl) f.signedUrl = data.signedUrl;
    }));
    $('#metricSessions').textContent = rows.length;
    $('#metricWords').textContent = (marks || []).length;
    $('#metricImproving').textContent = (marks || []).filter(m => m.status === 'improving').length;
    $('#metricConsistent').textContent = (marks || []).filter(m => m.status === 'consistently_correct').length;

    $('#submissionHistory').innerHTML = rows.length ? rows.map(s => {
      const fb = feedbackMap.get(s.id);
      return `<div class="history-item"><div><strong>Reading ${String(s.readings?.number || '').padStart(2,'0')} · ${escapeHtml(s.readings?.title || 'Reading')}</strong><p>${formatDate(s.created_at)}</p>${fb?.overall_text ? `<div class="learner-feedback"><span>Teacher feedback</span><p>${escapeHtml(fb.overall_text)}</p>${fb.signedUrl ? `<audio controls src="${escapeHtml(fb.signedUrl)}"></audio>` : ''}</div>` : ''}</div><span class="status-badge">${s.status === 'reviewed' ? 'Feedback ready' : 'Awaiting review'}</span></div>`;
    }).join('') : '<div class="history-item"><div><strong>No submissions yet</strong><p>Your completed readings will appear here.</p></div></div>';

    const latestByWord = new Map();
    (marks || []).forEach(m => { const key = m.word.toLowerCase(); if (!latestByWord.has(key)) latestByWord.set(key,m); });
    const latest = Array.from(latestByWord.values());
    $('#wordBank').innerHTML = latest.length ? latest.map(m => `<div class="word-pill-row"><div><strong>${escapeHtml(m.word)}</strong>${m.note ? `<small>${escapeHtml(m.note)}</small>` : ''}</div><span class="word-status ${escapeHtml(m.status)}">${friendlyStatus(m.status)}</span></div>`).join('') : '<div class="word-pill-row"><strong>No tracked words yet</strong><span class="word-status">Teacher tags appear here</span></div>';
  }

  function friendlyStatus(status) {
    return ({ needs_work:'Needs work', improving:'Improving', correct:'Correct', consistently_correct:'Consistently correct' })[status] || status || '';
  }

  async function loadComments() {
    if (!client) return;
    const { data, error } = await client.from('discussion_comments').select('id,display_name,body,created_at').eq('hidden',false).order('created_at',{ascending:false}).limit(50);
    const list = $('#commentsList');
    if (error) {
      list.innerHTML = '<div class="comment-item"><p>Discussion will appear here after the Supabase setup is complete.</p></div>';
      return;
    }
    list.innerHTML = data?.length ? data.map(c => `<article class="comment-item"><div class="comment-top"><strong>${escapeHtml(c.display_name)}</strong><time>${formatDate(c.created_at)}</time></div><p>${escapeHtml(c.body)}</p></article>`).join('') : '<div class="comment-item"><p>No comments yet. You can start the conversation after signing in.</p></div>';
  }

  async function postComment() {
    if (!state.session) return openAuthModal();
    const displayName = $('#commentName').value.trim();
    const body = $('#commentBody').value.trim();
    if (displayName.length < 2 || body.length < 2) return showToast('Add your display name and a comment first.');
    const { error } = await client.from('discussion_comments').insert({ user_id: state.session.user.id, display_name: displayName, body });
    if (error) return showToast(error.message || 'Could not post that comment.');
    localStorage.setItem('pronunciation_display_name', displayName);
    $('#commentBody').value = '';
    await loadComments();
    showToast('Comment posted.');
  }

  async function loadAdminQueue() {
    if (!state.isAdmin) return;
    const { data, error } = await client.from('submissions').select('id,created_at,status,display_name,duration_seconds,audio_path,user_id,reading_id,readings(title,number,sections)').order('created_at',{ascending:false}).limit(100);
    if (error) return showToast('Could not load the review queue.');
    state.adminSubmissions = data || [];
    $('#queueCount').textContent = state.adminSubmissions.filter(s => s.status !== 'reviewed').length;
    $('#adminQueue').innerHTML = state.adminSubmissions.length ? state.adminSubmissions.map(s => `
      <div class="queue-item ${state.selectedSubmission?.id===s.id?'active':''}" data-submission-id="${s.id}"><strong>${escapeHtml(s.display_name)}</strong><p>Reading ${String(s.readings?.number || '').padStart(2,'0')} · ${escapeHtml(s.readings?.title || '')}</p><small>${formatDate(s.created_at)} · ${s.status === 'reviewed' ? 'Reviewed' : 'New'}</small></div>`).join('') : '<div class="queue-item"><strong>All clear</strong><p>No submissions yet.</p></div>';
    $$('.queue-item[data-submission-id]', $('#adminQueue')).forEach(el => el.addEventListener('click', () => openAdminSubmission(el.dataset.submissionId)));
  }

  async function openAdminSubmission(id) {
    const submission = state.adminSubmissions.find(s => s.id === id);
    if (!submission) return;
    state.selectedSubmission = submission;
    state.selectedToken = null;
    state.feedbackAudioBlob = null;
    await loadAdminQueue();
    const [{ data: signed }, { data: marks }, { data: feedback }] = await Promise.all([
      client.storage.from('practice-audio').createSignedUrl(submission.audio_path, 3600),
      client.from('word_feedback').select('*').eq('submission_id', id).order('token_index'),
      client.from('feedback').select('*').eq('submission_id', id).maybeSingle()
    ]);
    renderReviewPanel(submission, signed?.signedUrl, marks || [], feedback || null);
  }

  function tokeniseSections(sections) {
    let tokenIndex = 0;
    return (sections || []).map((section, sectionIndex) => {
      const parts = section.split(/(\s+)/);
      const html = parts.map(part => {
        if (/^\s+$/.test(part)) return part;
        const bare = part.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu,'');
        if (!bare) return escapeHtml(part);
        const thisIndex = tokenIndex++;
        return `<button class="review-token" data-token-index="${thisIndex}" data-word="${escapeHtml(bare)}" type="button">${escapeHtml(part)}</button>`;
      }).join('');
      return `<p>${html}</p>${sectionIndex < sections.length-1 ? '' : ''}`;
    }).join('');
  }

  function renderReviewPanel(submission, audioUrl, marks, feedback) {
    const panel = $('#reviewPanel');
    panel.innerHTML = `
      <div class="review-header"><div><span class="eyebrow">${submission.status === 'reviewed' ? 'Reviewed submission' : 'New submission'}</span><h3>${escapeHtml(submission.display_name)}</h3><p>Reading ${String(submission.readings?.number || '').padStart(2,'0')} · ${escapeHtml(submission.readings?.title || '')} · ${formatDate(submission.created_at)}</p></div><span class="status-badge">${Math.round(submission.duration_seconds || 0)} sec</span></div>
      <div class="review-audio">${audioUrl ? `<audio controls src="${escapeHtml(audioUrl)}"></audio>` : '<p class="form-hint">Audio could not be opened.</p>'}</div>
      <div class="review-section"><h4>Mark exact words</h4><p>Click a word only when it is useful to track it. Unmarked words are not treated as incorrect.</p><div class="token-review">${tokeniseSections(submission.readings?.sections || [])}</div>
        <div id="markEditor" class="mark-editor hidden"><span class="eyebrow">Selected word</span><div id="selectedWord" class="selected-word"></div><div class="mark-editor-grid"><label>Status<select id="markStatus"><option value="needs_work">Needs work</option><option value="improving">Improving</option><option value="correct">Correct</option><option value="consistently_correct">Consistently correct</option></select></label><label>Short note<input id="markNote" maxlength="180" placeholder="Optional pronunciation note" /></label></div><div class="review-actions"><button id="removeMarkButton" class="button button-ghost compact">Remove tag</button><button id="saveMarkButton" class="button button-primary compact">Save word</button></div></div>
      </div>
      <div class="review-section"><h4>Overall feedback</h4><p>Keep this concise and useful. Voice feedback is optional.</p><label>Written feedback<textarea id="overallFeedback" rows="5" placeholder="What improved? What should they focus on next?">${escapeHtml(feedback?.overall_text || '')}</textarea></label>
        <div class="feedback-recorder"><button id="feedbackRecordButton" class="mini-record-button" type="button">●</button><div><strong id="feedbackRecordLabel">${feedback?.audio_path ? 'Existing voice feedback saved' : 'Add voice feedback'}</strong><small class="form-hint">Optional private audio note</small></div></div><audio id="feedbackPreview" class="hidden" controls></audio>
        <div class="review-actions"><button id="saveFeedbackButton" class="button button-primary">Save & mark reviewed</button></div></div>`;

    const markMap = new Map(marks.map(m => [Number(m.token_index), m]));
    $$('.review-token', panel).forEach(token => {
      const mark = markMap.get(Number(token.dataset.tokenIndex));
      if (mark) token.classList.add(`marked-${mark.status}`);
      token.addEventListener('click', () => selectReviewToken(token, markMap));
    });
    $('#saveMarkButton')?.addEventListener('click', saveSelectedMark);
    $('#removeMarkButton')?.addEventListener('click', removeSelectedMark);
    $('#feedbackRecordButton')?.addEventListener('click', toggleFeedbackRecording);
    $('#saveFeedbackButton')?.addEventListener('click', () => saveOverallFeedback(feedback));
  }

  function selectReviewToken(token, markMap) {
    const idx = Number(token.dataset.tokenIndex);
    state.selectedToken = { tokenIndex: idx, word: token.dataset.word };
    const existing = markMap.get(idx);
    $('#markEditor').classList.remove('hidden');
    $('#selectedWord').textContent = token.dataset.word;
    $('#markStatus').value = existing?.status || 'needs_work';
    $('#markNote').value = existing?.note || '';
    $('#markEditor').scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  async function saveSelectedMark() {
    if (!state.selectedSubmission || !state.selectedToken) return;
    const payload = {
      submission_id: state.selectedSubmission.id,
      token_index: state.selectedToken.tokenIndex,
      word: state.selectedToken.word,
      status: $('#markStatus').value,
      note: $('#markNote').value.trim() || null,
      admin_id: state.session.user.id
    };
    const { error } = await client.from('word_feedback').upsert(payload, { onConflict:'submission_id,token_index' });
    if (error) return showToast(error.message || 'Could not save that word.');
    showToast(`${state.selectedToken.word} saved as ${friendlyStatus(payload.status)}.`);
    await openAdminSubmission(state.selectedSubmission.id);
  }

  async function removeSelectedMark() {
    if (!state.selectedSubmission || !state.selectedToken) return;
    const { error } = await client.from('word_feedback').delete().eq('submission_id',state.selectedSubmission.id).eq('token_index',state.selectedToken.tokenIndex);
    if (error) return showToast('Could not remove that tag.');
    showToast('Word tag removed.');
    await openAdminSubmission(state.selectedSubmission.id);
  }

  async function toggleFeedbackRecording() {
    if (state.feedbackRecorder?.state === 'recording') {
      state.feedbackRecorder.stop();
      return;
    }
    try {
      state.feedbackStream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const type = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      state.feedbackRecorder = new MediaRecorder(state.feedbackStream, type ? {mimeType:type}:undefined);
      state.feedbackChunks = [];
      state.feedbackRecorder.ondataavailable = e => { if (e.data?.size) state.feedbackChunks.push(e.data); };
      state.feedbackRecorder.onstop = () => {
        state.feedbackAudioBlob = new Blob(state.feedbackChunks, { type: state.feedbackRecorder.mimeType || 'audio/webm' });
        state.feedbackStream?.getTracks().forEach(t=>t.stop());
        const preview = $('#feedbackPreview');
        preview.src = URL.createObjectURL(state.feedbackAudioBlob);
        preview.classList.remove('hidden');
        $('#feedbackRecordLabel').textContent = 'Voice feedback recorded';
        $('#feedbackRecordButton').textContent = '●';
      };
      state.feedbackRecorder.start();
      $('#feedbackRecordLabel').textContent = 'Recording voice feedback…';
      $('#feedbackRecordButton').textContent = '■';
    } catch { showToast('Could not access the microphone for voice feedback.'); }
  }

  async function saveOverallFeedback(existingFeedback) {
    if (!state.selectedSubmission) return;
    const text = $('#overallFeedback').value.trim();
    const base = { submission_id: state.selectedSubmission.id, admin_id: state.session.user.id, overall_text: text || null, published_at: new Date().toISOString() };
    let { data: saved, error } = await client.from('feedback').upsert(base,{onConflict:'submission_id'}).select().single();
    if (error) return showToast(error.message || 'Could not save feedback.');

    if (state.feedbackAudioBlob) {
      const ext = state.feedbackAudioBlob.type.includes('mp4') ? 'm4a' : 'webm';
      const path = `${state.selectedSubmission.user_id}/${saved.id}.${ext}`;
      const up = await client.storage.from('feedback-audio').upload(path,state.feedbackAudioBlob,{contentType:state.feedbackAudioBlob.type,upsert:true});
      if (up.error) return showToast(up.error.message || 'Written feedback saved, but voice feedback could not upload.');
      const updated = await client.from('feedback').update({audio_path:path}).eq('id',saved.id);
      if (updated.error) return showToast('Voice file uploaded, but its reference could not be saved.');
    }

    await client.from('submissions').update({status:'reviewed'}).eq('id',state.selectedSubmission.id);
    showToast('Feedback saved and submission marked reviewed.');
    await loadAdminQueue();
    await openAdminSubmission(state.selectedSubmission.id);
  }

  function pendingDb() {
    return new Promise((resolve,reject) => {
      const req = indexedDB.open('pronunciation-room',1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('pending')) req.result.createObjectStore('pending',{keyPath:'id'}); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }
  async function pendingStorePut(value) { const db = await pendingDb(); return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}); }
  async function pendingStoreGet(id) { const db=await pendingDb();return new Promise((resolve,reject)=>{const req=db.transaction('pending','readonly').objectStore('pending').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }
  async function pendingStoreDelete(id) { const db=await pendingDb();return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}); }

  document.addEventListener('DOMContentLoaded', init);
})();
