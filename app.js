(() => {
  'use strict';
  const cfg = window.PRONUNCIATION_CONFIG || {};
  const recoveryUrlHint = (() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/,''));
    return search.get('type') === 'recovery' || hash.get('type') === 'recovery';
  })();
  const client = window.supabase?.createClient?.(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const DAY = 86400000;
  const state = {
    session:null, profile:null, isAdmin:false, currentReading:null, currentSubmission:null,
    currentTargets:[], currentGlossary:[], selectedAvatar:'avatar-01',
    recorder:null, stream:null, chunks:[], recordingBlob:null, recordingStartedAt:0, recordingDurationSeconds:0, timer:null, audioCtx:null, analyser:null, anim:null,
    correctionRecorder:null, correctionStream:null, correctionChunks:[], correctionBlob:null, activeCorrection:null,
    attemptsChart:null,
    adminQueue:[], selectedAdminSubmission:null, reviewTokens:[], reviewTargets:[], reviewMarks:new Map(),
    reviewFeedbackBlob:null, reviewFeedbackRecorder:null, reviewFeedbackStream:null,
    correctionModelBlob:null, correctionModelRecorder:null, correctionModelStream:null,
    modelBlob:null, modelRecorder:null, modelStream:null, editingReadingId:null,
    wordInsights:[], leaderboardRows:[]
  };

  function showToast(message, ms=3400){ const el=$('#toast'); if(!el) return; el.textContent=message; el.classList.remove('hidden'); clearTimeout(showToast.t); showToast.t=setTimeout(()=>el.classList.add('hidden'),ms); }
  function setStatus(el,msg='',type=''){ if(!el)return; el.textContent=msg; el.className=`form-status${type?` ${type}`:''}`; }
  function esc(v=''){ return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function fmtDate(v, opts={day:'numeric',month:'short',year:'numeric'}){ if(!v)return '—'; return new Intl.DateTimeFormat('en-GB',opts).format(new Date(v)); }
  function fmtDateTime(v){ if(!v)return '—'; return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(v)); }
  function monthLabel(){ return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric'}).format(new Date()); }
  function pct(v){ return v==null?'—':`${Math.round(Number(v))}%`; }
  function avatarUrl(id){ const n=String(id||'avatar-01').replace(/\D/g,'').padStart(2,'0'); return `avatars/avatar-${n}.svg`; }
  function setAvatar(el,id){ if(el) el.style.backgroundImage=`url("${avatarUrl(id)}")`; }
  function normalizeWord(v=''){ return String(v).toLowerCase().trim().replace(/[^\p{L}\p{N}'-]+/gu,''); }
  function wordCount(v=''){ return (String(v).trim().match(/\b[\p{L}\p{N}'’-]+\b/gu)||[]).length; }
  function audioExt(blob){ return blob?.type?.includes('mp4')?'m4a':blob?.type?.includes('ogg')?'ogg':'webm'; }
  function nowIso(){ return new Date().toISOString(); }

  function touchActivity(){
    if(!state.session || state.isAdmin) return;
    localStorage.setItem('pr_last_seen', String(Date.now()));
    if(state.profile && (!state._lastProfileTouch || Date.now()-state._lastProfileTouch>5*60*1000)){
      state._lastProfileTouch=Date.now();
      client.from('learner_profiles').update({last_active_at:nowIso()}).eq('user_id',state.session.user.id).then(()=>{});
    }
  }

  async function enforceLocalInactivity(){
    const last=Number(localStorage.getItem('pr_last_seen')||0);
    if(last && Date.now()-last>30*DAY){
      await client.auth.signOut({scope:'local'}).catch(()=>{});
      localStorage.removeItem('pr_last_seen');
      return false;
    }
    return true;
  }

  function setView(name){
    if((name==='progress'||name==='community') && !state.profile){ openAuth(); return; }
    if(name==='admin' && !state.isAdmin){ showToast('Administrator access required.'); return; }
    $$('.view').forEach(v=>v.classList.remove('is-visible'));
    $(`#view-${name}`)?.classList.add('is-visible');
    $$('.nav-link').forEach(n=>n.classList.toggle('is-active',n.dataset.view===name));
    window.scrollTo({top:0,behavior:'smooth'});
    if(name==='current' && state.profile) loadCurrentExperience();
    if(name==='progress' && state.profile) loadProgress();
    if(name==='community' && state.profile) loadCommunity();
    if(name==='admin' && state.isAdmin) loadAdminOverview();
  }

  async function init(){
    bindUI(); drawIdleVisualiser();
    if(!client){ showToast('Supabase could not load.'); return; }
    client.auth.onAuthStateChange(async (event,session)=>{
      state.session=session;
      if(event==='PASSWORD_RECOVERY'){
        setTimeout(()=>openPasswordReset(),0);
      }
      await refreshIdentity();
      if(session) touchActivity();
    });
    const {data}=await client.auth.getSession(); state.session=data.session;
    if(state.session && !(await enforceLocalInactivity())) state.session=null;
    await refreshIdentity();
    if(recoveryUrlHint && state.session) setTimeout(()=>openPasswordReset(),0);
    document.addEventListener('click',touchActivity,{passive:true});
    document.addEventListener('keydown',touchActivity,{passive:true});
  }

  function bindUI(){
    $$('.nav-link').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
    $$('[data-view-target]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.viewTarget)));
    $$('[data-open-auth]').forEach(b=>b.addEventListener('click',openAuth));
    $$('[data-close-auth]').forEach(b=>b.addEventListener('click',closeAuth));
    $$('[data-close-coach-auth]').forEach(b=>b.addEventListener('click',closeCoachAuth));
    $$('[data-close-coach-recovery]').forEach(b=>b.addEventListener('click',closeCoachRecovery));
    $$('[data-close-profile]').forEach(b=>b.addEventListener('click',closeProfileModal));
    $$('[data-close-public-profile]').forEach(b=>b.addEventListener('click',()=>$('#publicProfileModal').classList.add('hidden')));
    $('#accountButton').addEventListener('click',accountAction);
    $('#coachSignInButton').addEventListener('click',openCoachAuth);
    $('#signOutButton').addEventListener('click',signOut);
    $('#editProfileButton').addEventListener('click',()=>openProfileModal(false));
    $('#sendSignInButton').addEventListener('click',requestSignInLink);
    $('#coachSignInSubmitButton').addEventListener('click',coachSignIn);
    $('#forgotCoachPasswordButton').addEventListener('click',openCoachRecovery);
    $('#sendCoachRecoveryButton').addEventListener('click',sendCoachRecovery);
    $('#saveNewCoachPasswordButton').addEventListener('click',saveNewCoachPassword);
    $('#cancelPasswordResetButton').addEventListener('click',cancelPasswordReset);
    $('#coachPassword').addEventListener('keydown',e=>{if(e.key==='Enter')coachSignIn();});
    $('#coachRecoveryEmail').addEventListener('keydown',e=>{if(e.key==='Enter')sendCoachRecovery();});
    $('#confirmCoachPassword').addEventListener('keydown',e=>{if(e.key==='Enter')saveNewCoachPassword();});
    $('#saveProfileButton').addEventListener('click',saveProfile);
    $('#recordButton').addEventListener('click',toggleMainRecording);
    $('#rerecordButton').addEventListener('click',()=>resetMainRecording());
    $('#submitReadingButton').addEventListener('click',submitMainReading);
    $$('.admin-tab').forEach(b=>b.addEventListener('click',()=>setAdminTab(b.dataset.adminTab)));
    $('#inviteStudentButton').addEventListener('click',inviteStudent);
    $('#inviteEmail').addEventListener('input',renderEmailSuggestion);
    $('#refreshUsageButton').addEventListener('click',loadResendUsage);
    $('#copyPromptButton').addEventListener('click',copyPassagePrompt);
    $('#passageMarkup').addEventListener('input',previewPassageMarkup);
    $('#newPassageButton').addEventListener('click',newPassageEditor);
    $('#saveDraftPassageButton').addEventListener('click',()=>savePassage(false));
    $('#publishPassageButton').addEventListener('click',()=>savePassage(true));
    $('#modelRecordButton').addEventListener('click',toggleModelRecording);
    $('#saveLiveSessionButton').addEventListener('click',saveLiveSession);
    document.addEventListener('click',e=>{if(!e.target.closest('.account-wrap'))$('#accountMenu').classList.add('hidden');});
  }

  async function refreshIdentity(){
    state.profile=null; state.isAdmin=false;
    if(!state.session){
      $('#signedOutHero').classList.remove('hidden'); $('#memberCurrent').classList.add('hidden');
      $$('.learner-nav,.learner-only,.admin-only').forEach(x=>x.classList.add('hidden'));
      $('#coachSignInButton').classList.remove('hidden');
      $('#accountButton').classList.add('hidden');
      $('#accountButton').classList.remove('is-signed-in'); $('#accountLabel').textContent='Account';
      return;
    }
    const {data:isAdmin}=await client.rpc('is_admin'); state.isAdmin=!!isAdmin;
    if(!state.isAdmin){
      const {data:p,error}=await client.from('learner_profiles').select('*').eq('user_id',state.session.user.id).maybeSingle();
      if(error){ console.error(error); showToast('Could not load your member profile.'); }
      state.profile=p;
      if(p?.status==='invited'){
        const t=nowIso();
        const {data:active}=await client.from('learner_profiles').update({status:'active',activated_at:p.activated_at||t,course_joined_at:p.course_joined_at||t,last_active_at:t}).eq('user_id',state.session.user.id).select().single();
        state.profile=active||p;
      }
    }
    $('#signedOutHero').classList.add('hidden'); $('#memberCurrent').classList.remove('hidden');
    $('#coachSignInButton').classList.add('hidden');
    $('#accountButton').classList.remove('hidden');
    $('#accountButton').classList.add('is-signed-in');
    $('#accountLabel').textContent=state.isAdmin?'Coach admin':(state.profile?.display_name||'Account');
    $('#accountName').textContent=state.isAdmin?'Administrator':(state.profile?.display_name||'Learner');
    $('#accountEmail').textContent=state.session.user.email||'';
    $$('.admin-only').forEach(x=>x.classList.toggle('hidden',!state.isAdmin));
    $$('.learner-nav,.learner-only').forEach(x=>x.classList.toggle('hidden',state.isAdmin||!state.profile));
    if(state.profile){
      state.selectedAvatar=state.profile.avatar_id||'avatar-01';
      const setupKey=`pr_profile_setup_${state.session.user.id}`;
      if(!localStorage.getItem(setupKey)){ setTimeout(()=>openProfileModal(true),300); localStorage.setItem(setupKey,'1'); }
      await loadCurrentExperience();
      touchActivity();
    } else if(state.isAdmin){
      await loadCurrentExperience();
    }
  }

  function accountAction(){ if(!state.session) return openAuth(); $('#accountMenu').classList.toggle('hidden'); }
  async function signOut(){ await client.auth.signOut(); localStorage.removeItem('pr_last_seen'); $('#accountMenu').classList.add('hidden'); setView('current'); }
  function openAuth(){ closeCoachAuth(); closeCoachRecovery(); $('#authModal').classList.remove('hidden'); $('#authEmail').focus(); }
  function closeAuth(){ $('#authModal').classList.add('hidden'); setStatus($('#authStatus')); }
  function openCoachAuth(){
    closeAuth(); closeCoachRecovery();
    $('#coachAuthModal').classList.remove('hidden');
    setStatus($('#coachAuthStatus'));
    setTimeout(()=>$('#coachEmail').focus(),0);
  }
  function closeCoachAuth(){ $('#coachAuthModal').classList.add('hidden'); setStatus($('#coachAuthStatus')); }
  function openCoachRecovery(){
    const existing=$('#coachEmail').value.trim();
    closeCoachAuth();
    $('#coachRecoveryModal').classList.remove('hidden');
    if(existing) $('#coachRecoveryEmail').value=existing;
    setStatus($('#coachRecoveryStatus'));
    setTimeout(()=>$('#coachRecoveryEmail').focus(),0);
  }
  function closeCoachRecovery(){ $('#coachRecoveryModal').classList.add('hidden'); setStatus($('#coachRecoveryStatus')); }
  function openPasswordReset(){
    closeAuth(); closeCoachAuth(); closeCoachRecovery();
    $('#passwordResetModal').classList.remove('hidden');
    setStatus($('#passwordResetStatus'));
    $('#newCoachPassword').value=''; $('#confirmCoachPassword').value='';
    setTimeout(()=>$('#newCoachPassword').focus(),0);
  }
  function cleanRecoveryUrl(){
    if(window.history?.replaceState) window.history.replaceState({},document.title,window.location.pathname);
  }
  async function coachSignIn(){
    const email=$('#coachEmail').value.trim(),password=$('#coachPassword').value,status=$('#coachAuthStatus');
    if(!/^\S+@\S+\.\S+$/.test(email)) return setStatus(status,'Enter a valid coach email address.','error');
    if(!password) return setStatus(status,'Enter your password.','error');
    setStatus(status,'Signing you in…');
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error) return setStatus(status,'Email or password is incorrect.','error');
    state.session=data.session;
    const {data:isAdmin,error:roleError}=await client.rpc('is_admin');
    if(roleError || !isAdmin){
      await client.auth.signOut({scope:'local'}).catch(()=>{});
      state.session=null;
      await refreshIdentity();
      return setStatus(status,'This sign-in is for the pronunciation coach only.','error');
    }
    await refreshIdentity();
    closeCoachAuth();
    $('#coachPassword').value='';
    setView('admin');
  }
  async function sendCoachRecovery(){
    const email=$('#coachRecoveryEmail').value.trim(),status=$('#coachRecoveryStatus');
    if(!/^\S+@\S+\.\S+$/.test(email)) return setStatus(status,'Enter a valid email address.','error');
    setStatus(status,'Sending your password reset link…');
    const redirectTo=`${window.location.origin}${window.location.pathname}`;
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo});
    if(error){
      console.error(error);
      return setStatus(status,'We could not send the recovery email right now. Please try again.','error');
    }
    setStatus(status,'Check your inbox. If this address belongs to a coach account, a password reset link is on its way.','success');
  }
  async function saveNewCoachPassword(){
    const password=$('#newCoachPassword').value,confirm=$('#confirmCoachPassword').value,status=$('#passwordResetStatus');
    if(password.length<10) return setStatus(status,'Use a password with at least 10 characters.','error');
    if(password!==confirm) return setStatus(status,'The two passwords do not match.','error');
    setStatus(status,'Saving your new password…');
    const {error}=await client.auth.updateUser({password});
    if(error) return setStatus(status,error.message||'Could not update your password.','error');
    const {data:isAdmin,error:roleError}=await client.rpc('is_admin');
    cleanRecoveryUrl();
    if(roleError || !isAdmin){
      await client.auth.signOut({scope:'local'}).catch(()=>{});
      state.session=null;
      $('#passwordResetModal').classList.add('hidden');
      await refreshIdentity();
      showToast('Password updated, but this account does not have coach access. Learners should use email sign-in links.');
      return;
    }
    setStatus(status,'Password saved. Opening your coach dashboard…','success');
    await refreshIdentity();
    setTimeout(()=>{ $('#passwordResetModal').classList.add('hidden'); setView('admin'); },500);
  }
  async function cancelPasswordReset(){
    await client.auth.signOut({scope:'local'}).catch(()=>{});
    state.session=null;
    cleanRecoveryUrl();
    $('#passwordResetModal').classList.add('hidden');
    await refreshIdentity();
    setView('current');
  }
  async function requestSignInLink(){
    const email=$('#authEmail').value.trim(); const status=$('#authStatus');
    if(!/^\S+@\S+\.\S+$/.test(email)) return setStatus(status,'Enter a valid email address.','error');
    setStatus(status,'Sending your secure sign-in link…');
    const {data,error}=await client.functions.invoke('request-signin-link',{body:{email}});
    if(error){
      const ctx=error.context; let msg='Could not send the link.';
      try{ const j=ctx?await ctx.json():null; msg=j?.message||j?.error||msg; }catch{}
      return setStatus(status,msg,error?.context?.status===429?'error':'error');
    }
    setStatus(status,'Check your inbox. If this email is registered and active, your sign-in link is on its way. If you don’t receive one, contact your pronunciation coach.','success');
  }

  function buildAvatarPicker(){
    const box=$('#avatarPicker'); box.innerHTML='';
    for(let i=1;i<=12;i++){
      const id=`avatar-${String(i).padStart(2,'0')}`; const b=document.createElement('button'); b.type='button'; b.className=`avatar-choice${id===state.selectedAvatar?' is-selected':''}`; b.style.backgroundImage=`url("${avatarUrl(id)}")`; b.title=`Avatar ${i}`;
      b.addEventListener('click',()=>{state.selectedAvatar=id; $$('.avatar-choice',box).forEach(x=>x.classList.remove('is-selected')); b.classList.add('is-selected');}); box.appendChild(b);
    }
  }
  function openProfileModal(force=false){ if(!state.profile)return; $('#profileNameInput').value=state.profile.display_name||''; $('#communityAudioToggle').checked=state.profile.community_audio_enabled!==false; state.selectedAvatar=state.profile.avatar_id||'avatar-01'; buildAvatarPicker(); $('#profileModal').classList.remove('hidden'); if(force) $('.modal-close',$('#profileModal'))?.classList.add('hidden'); else $('.modal-close',$('#profileModal'))?.classList.remove('hidden'); }
  function closeProfileModal(){ $('#profileModal').classList.add('hidden'); setStatus($('#profileStatus')); }
  async function saveProfile(){
    const name=$('#profileNameInput').value.trim(); if(!name) return setStatus($('#profileStatus'),'Choose a nickname.','error');
    const payload={display_name:name,avatar_id:state.selectedAvatar,community_audio_enabled:$('#communityAudioToggle').checked,last_active_at:nowIso()};
    const {data,error}=await client.from('learner_profiles').update(payload).eq('user_id',state.session.user.id).select().single();
    if(error)return setStatus($('#profileStatus'),error.message,'error'); state.profile=data; $('#accountLabel').textContent=name; closeProfileModal(); showToast('Profile saved.');
  }

  async function loadCurrentExperience(){
    if(!state.session) return;
    const now=nowIso();
    const {data:current,error}=await client.from('readings').select('id,number,title,subtitle,plain_text,markup_text,word_count,opens_at,closes_at,model_audio_path,publication_status').eq('publication_status','published').lte('opens_at',now).gt('closes_at',now).order('opens_at',{ascending:false}).limit(1).maybeSingle();
    if(error && error.code!=='PGRST116') console.error(error);
    state.currentReading=current||null; state.currentSubmission=null;
    if(!current){
      $('#currentReadingLayout').classList.add('hidden'); $('#noCurrentReading').classList.remove('hidden'); $('#readingWindowChip').textContent='Between readings';
      const {data:next}=await client.from('readings').select('title,opens_at').eq('publication_status','published').gt('opens_at',now).order('opens_at').limit(1).maybeSingle();
      $('#nextReadingMessage').textContent=next?`${next.title} opens ${fmtDateTime(next.opens_at)}.`:'The next reading will appear here when it is scheduled.';
      await loadActiveCorrection(); await loadUpcomingLive(); return;
    }
    $('#noCurrentReading').classList.add('hidden'); $('#currentReadingLayout').classList.remove('hidden');
    $('#readingWindowChip').textContent=`Closes ${fmtDateTime(current.closes_at)}`; $('#readingNumber').textContent=`Reading ${String(current.number).padStart(2,'0')}`; $('#readingTitle').textContent=current.title; $('#readingSubtitle').textContent=current.subtitle||''; $('#readingWordCount').textContent=`${current.word_count||wordCount(current.plain_text)} words`;
    await renderLearnerPassage(current);
    if(state.profile){
      const {data:sub}=await client.from('submissions').select('*').eq('user_id',state.session.user.id).eq('reading_id',current.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
      state.currentSubmission=sub||null;
      $('#alreadySubmittedBox').classList.toggle('hidden',!sub); $('#recorderBox').classList.toggle('hidden',!!sub);
      if(sub) await loadModelAudio(current);
    } else {
      // Admins can preview the live passage, but the learner recorder is intentionally hidden.
      $('#alreadySubmittedBox').classList.add('hidden'); $('#recorderBox').classList.add('hidden');
    }
    await loadActiveCorrection(); await loadUpcomingLive();
  }

  async function renderLearnerPassage(reading){
    let glossary=[];
    if(state.profile){ const {data}=await client.rpc('get_reading_glossary',{p_reading_id:reading.id}); glossary=data||[]; }
    state.currentGlossary=glossary;
    const meanings=new Map(glossary.map(x=>[normalizeWord(x.target_text),x.meaning]));
    const paras=String(reading.plain_text||'').split(/\n\s*\n/).filter(Boolean);
    $('#passageText').innerHTML=paras.map(p=>`<p>${esc(p).replace(/([\p{L}\p{N}'’-]+)/gu,w=>{const m=meanings.get(normalizeWord(w));return m?`<span class="glossary-word" title="${esc(m)}">${esc(w)}</span>`:esc(w);})}</p>`).join('');
  }

  async function loadModelAudio(reading){
    const box=$('#modelAudioBox'); box.classList.add('hidden'); $('#modelAudio').removeAttribute('src');
    if(!reading?.model_audio_path||!state.currentSubmission)return;
    const {data,error}=await client.storage.from('model-audio').createSignedUrl(reading.model_audio_path,3600);
    if(!error&&data?.signedUrl){ $('#modelAudio').src=data.signedUrl; box.classList.remove('hidden'); }
  }

  async function toggleMainRecording(){ if(state.recorder?.state==='recording') stopMainRecording(); else await startMainRecording(); }
  async function startMainRecording(){
    if(!state.profile){openAuth();return;} if(!state.currentReading)return;
    try{
      resetMainRecording(false); state.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
      const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4']; const mime=preferred.find(x=>MediaRecorder.isTypeSupported?.(x));
      state.chunks=[]; state.recordingDurationSeconds=0; state.recorder=new MediaRecorder(state.stream,mime?{mimeType:mime}:undefined); state.recorder.ondataavailable=e=>{if(e.data?.size)state.chunks.push(e.data)}; state.recorder.onstop=finishMainRecording; state.recorder.start(); state.recordingStartedAt=Date.now();
      $('#recordButton').classList.add('is-recording'); $('#recordPrompt').textContent='Recording…'; $('#recordSubPrompt').textContent='Press again to stop.'; $('#recordingStateChip').textContent='Recording'; $('#playbackArea').classList.add('hidden');
      state.timer=setInterval(()=>{const s=Math.floor((Date.now()-state.recordingStartedAt)/1000);$('#recordingTime').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`},500); startVisualiser(state.stream);
    }catch(e){console.error(e);showToast('Microphone access is required to record.');}
  }
  function stopMainRecording(){ if(state.recorder?.state==='recording')state.recorder.stop(); }
  function finishMainRecording(){
    state.recordingDurationSeconds=Math.max(0,Math.round((Date.now()-state.recordingStartedAt)/1000));
    clearInterval(state.timer); stopVisualiser(); state.stream?.getTracks().forEach(t=>t.stop());
    state.recordingBlob=new Blob(state.chunks,{type:state.recorder?.mimeType||'audio/webm'}); const url=URL.createObjectURL(state.recordingBlob); $('#playbackAudio').src=url; $('#playbackArea').classList.remove('hidden'); $('#recordButton').classList.remove('is-recording'); $('#recordPrompt').textContent='Recording ready'; $('#recordSubPrompt').textContent='Listen back before you submit.'; $('#recordingStateChip').textContent='Ready to submit';
  }
  function resetMainRecording(clear=true){
    if(state.recorder?.state==='recording')state.recorder.stop(); clearInterval(state.timer); stopVisualiser(); state.stream?.getTracks().forEach(t=>t.stop());
    if(clear){state.recordingBlob=null;state.recordingDurationSeconds=0;state.recordingStartedAt=0;} $('#playbackArea').classList.add('hidden'); $('#playbackAudio').removeAttribute('src'); $('#recordButton').classList.remove('is-recording'); $('#recordPrompt').textContent='Start recording'; $('#recordSubPrompt').textContent='Practise and re-record as often as you like before submitting.'; $('#recordingStateChip').textContent='Ready'; $('#recordingTime').textContent='00:00'; drawIdleVisualiser();
  }
  function drawIdleVisualiser(){ const c=$('#visualiser'); if(!c)return; const x=c.getContext('2d'); x.clearRect(0,0,c.width,c.height); x.strokeStyle='rgba(124,235,196,.28)'; x.lineWidth=2; x.beginPath(); for(let i=0;i<c.width;i+=12){const h=8+Math.sin(i/23)*5; x.moveTo(i,c.height/2-h);x.lineTo(i,c.height/2+h);} x.stroke(); }
  function startVisualiser(stream){
    try{state.audioCtx=new(window.AudioContext||window.webkitAudioContext)();state.analyser=state.audioCtx.createAnalyser();state.analyser.fftSize=256;state.audioCtx.createMediaStreamSource(stream).connect(state.analyser);const arr=new Uint8Array(state.analyser.frequencyBinCount);const c=$('#visualiser'),ctx=c.getContext('2d');const loop=()=>{state.anim=requestAnimationFrame(loop);state.analyser.getByteFrequencyData(arr);ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='rgba(124,235,196,.76)';const bw=c.width/arr.length;arr.forEach((v,i)=>{const h=Math.max(3,(v/255)*c.height*.72);ctx.fillRect(i*bw,c.height/2-h/2,Math.max(1,bw-1),h)});};loop();}catch{}
  }
  function stopVisualiser(){ if(state.anim)cancelAnimationFrame(state.anim);state.anim=null;state.audioCtx?.close?.().catch(()=>{});state.audioCtx=null;drawIdleVisualiser(); }

  async function submitMainReading(){
    if(!state.recordingBlob||!state.currentReading||!state.profile)return showToast('Record the passage first.');
    const btn=$('#submitReadingButton'); btn.disabled=true; btn.textContent='Submitting…';
    try{
      const ext=audioExt(state.recordingBlob); const tempId=crypto.randomUUID(); const path=`${state.session.user.id}/${tempId}.${ext}`;
      const up=await client.storage.from('practice-audio').upload(path,state.recordingBlob,{contentType:state.recordingBlob.type,upsert:false}); if(up.error)throw up.error;
      const duration=state.recordingDurationSeconds||0;
      const {data:sub,error}=await client.from('submissions').insert({user_id:state.session.user.id,reading_id:state.currentReading.id,display_name:state.profile.display_name,audio_path:path,duration_seconds:duration,status:'submitted',community_visible:true}).select().single();
      if(error){await client.storage.from('practice-audio').remove([path]);throw error;}
      state.currentSubmission=sub; resetMainRecording(); $('#alreadySubmittedBox').classList.remove('hidden');$('#recorderBox').classList.add('hidden');await loadModelAudio(state.currentReading); showToast('Reading submitted for feedback.');
    }catch(e){console.error(e);showToast(e.message||'Could not submit your reading.');}finally{btn.disabled=false;btn.textContent='Submit for feedback';}
  }

  async function loadActiveCorrection(){
    const card=$('#currentCorrectionCard'); card.classList.add('hidden'); state.activeCorrection=null;
    if(!state.profile)return;
    const {data:cycle}=await client.from('correction_cycles').select('*, readings(number,title)').eq('user_id',state.session.user.id).neq('status','approved').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(!cycle)return; state.activeCorrection=cycle;
    const {data:words}=await client.from('correction_cycle_words').select('*').eq('cycle_id',cycle.id).order('word_text');
    let modelUrl=''; if(cycle.model_audio_path){const {data}=await client.storage.from('correction-model-audio').createSignedUrl(cycle.model_audio_path,3600);modelUrl=data?.signedUrl||'';}
    card.innerHTML=`<div class="correction-head"><div><span class="eyebrow">Private correction practice</span><h2>${esc(cycle.readings?.title||'Focus words')}</h2><p class="muted">Listen to the model, practise privately, then submit all focus words together.</p></div><span class="state-chip">${cycle.status==='submitted'?'Waiting for review':cycle.status==='retry'?'Try again':'Ready to practise'}</span></div><div class="correction-words">${(words||[]).map(w=>`<span class="word-chip">${esc(w.word_text)}</span>`).join('')}</div><div class="correction-audio-grid"><div><span class="eyebrow">Admin model</span>${modelUrl?`<audio controls src="${esc(modelUrl)}"></audio>`:'<p class="muted">Model audio unavailable.</p>'}</div><div id="correctionLearnerBox"><span class="eyebrow">Your correction</span>${cycle.status==='submitted'?'<p class="muted">Your latest attempt is waiting for review.</p>':`<div class="inline-recorder"><button id="correctionRecordButton" class="record-mini">●</button><span id="correctionRecordLabel">Record all focus words</span><audio id="correctionPreview" controls class="hidden"></audio></div><button id="submitCorrectionButton" class="button button-primary full-width hidden" style="margin-top:12px">Submit correction attempt</button>`}${cycle.status==='retry'&&cycle.retry_note?`<p class="callout-copy">${esc(cycle.retry_note)}</p>`:''}</div></div>`;
    card.classList.remove('hidden');
    $('#correctionRecordButton')?.addEventListener('click',toggleCorrectionRecording); $('#submitCorrectionButton')?.addEventListener('click',submitCorrectionAttempt);
  }

  async function toggleCorrectionRecording(){ if(state.correctionRecorder?.state==='recording'){state.correctionRecorder.stop();return;} try{state.correctionStream=await navigator.mediaDevices.getUserMedia({audio:true});state.correctionChunks=[];state.correctionRecorder=new MediaRecorder(state.correctionStream);state.correctionRecorder.ondataavailable=e=>{if(e.data?.size)state.correctionChunks.push(e.data)};state.correctionRecorder.onstop=()=>{state.correctionBlob=new Blob(state.correctionChunks,{type:state.correctionRecorder.mimeType||'audio/webm'});state.correctionStream?.getTracks().forEach(t=>t.stop());$('#correctionPreview').src=URL.createObjectURL(state.correctionBlob);$('#correctionPreview').classList.remove('hidden');$('#submitCorrectionButton').classList.remove('hidden');$('#correctionRecordLabel').textContent='Correction ready';$('#correctionRecordButton').textContent='●';};state.correctionRecorder.start();$('#correctionRecordLabel').textContent='Recording… press to stop';$('#correctionRecordButton').textContent='■';}catch{showToast('Could not access your microphone.');} }
  async function submitCorrectionAttempt(){
    if(!state.correctionBlob||!state.activeCorrection)return;
    const btn=$('#submitCorrectionButton');btn.disabled=true;btn.textContent='Submitting…';
    try{const ext=audioExt(state.correctionBlob);const next=(state.activeCorrection.attempt_count||0)+1;const path=`${state.session.user.id}/${state.activeCorrection.id}-${next}.${ext}`;const up=await client.storage.from('correction-audio').upload(path,state.correctionBlob,{contentType:state.correctionBlob.type,upsert:false});if(up.error)throw up.error;const {error}=await client.rpc('submit_correction_attempt',{p_cycle_id:state.activeCorrection.id,p_audio_path:path});if(error){await client.storage.from('correction-audio').remove([path]);throw error;}showToast(`Correction attempt ${next} submitted.`);state.correctionBlob=null;await loadActiveCorrection();}catch(e){console.error(e);showToast(e.message||'Could not submit the correction.');}finally{btn.disabled=false;btn.textContent='Submit correction attempt';}
  }

  async function loadUpcomingLive(){
    const now=nowIso();const {data:s}=await client.from('live_sessions').select('*').eq('published',true).gte('starts_at',now).order('starts_at').limit(1).maybeSingle();
    const current=$('#upcomingLiveCard'),community=$('#communityLiveSession'),admin=$('#adminLivePreview');
    const html=s?`<div class="live-box"><span class="eyebrow">Weekly live session</span><h3>${esc(s.title)}</h3><p>${fmtDateTime(s.starts_at)}${s.note?` · ${esc(s.note)}`:''}</p></div>${s.join_url?`<a class="button button-primary" href="${esc(s.join_url)}" target="_blank" rel="noopener">Join live session</a>`:''}`:'<p class="muted">No live session is scheduled yet.</p>';
    if(current){current.innerHTML=html;current.classList.toggle('hidden',!s);} if(community)community.innerHTML=html;if(admin)admin.innerHTML=html;
  }

  async function loadProgress(){
    if(!state.profile)return;
    const uid=state.session.user.id;
    const [{data:subs},{data:readings},{data:snaps},{data:cycles},{data:streak}]=await Promise.all([
      client.from('submissions').select('id,reading_id,status,created_at,reviewed_at,completed_at,readings(number,title,opens_at,closes_at)').eq('user_id',uid).order('created_at'),
      client.from('readings').select('id,number,title,opens_at,closes_at,publication_status').in('publication_status',['published','archived']).order('number'),
      client.from('progress_snapshots').select('*').eq('user_id',uid).order('snapshot_at'),
      client.from('correction_cycles').select('id,reading_id,status,attempt_count,approved_at,readings(number,title)').eq('user_id',uid).order('created_at'),
      client.rpc('current_reading_streak',{p_user_id:uid})
    ]);
    const submissions=subs||[], allReadings=readings||[], snapshots=snaps||[], corrections=cycles||[];
    const submittedIds=new Set(submissions.map(s=>s.reading_id));
    const joined=new Date(state.profile.course_joined_at||state.profile.activated_at||state.profile.created_at||0).getTime();
    const now=Date.now();
    const eligible=allReadings.filter(r=>{
      const opened=new Date(r.opens_at||0).getTime(),closed=new Date(r.closes_at||0).getTime();
      return (opened>=joined||submittedIds.has(r.id)) && (closed<=now||submittedIds.has(r.id));
    });
    const completed=new Set(submissions.filter(s=>s.status!=='reopened').map(s=>s.reading_id)).size;
    const consistency=eligible.length?100*completed/eligible.length:100;
    const longevity=Math.floor(completed/5);
    $('#metricCompleted').textContent=completed; $('#metricAvailable').textContent=`${eligible.length} available so far`; $('#metricConsistency').textContent=`${Math.round(consistency)}%`; $('#metricLongevity').textContent=longevity; $('#metricStreak').textContent=streak||0;

    const latest=snapshots.at(-1)||null;
    const profileName=latest?.reader_profile||'Taking shape…'; $('#readerProfileName').textContent=profileName; setAvatar($('#profileAvatarLarge'),state.profile.avatar_id);
    $('#readerProfileDescription').textContent=profileName==='Taking shape…'?'Complete five reviewed readings to reveal your first pronunciation profile.':profileDescription(profileName);
    $('#progressScore').textContent=latest?.progress_score==null?'—':Math.round(Number(latest.progress_score)); $('#progressScoreHint').textContent=latest?.progress_score==null?'Your combined score appears after at least five readings and enough retention opportunities.':'Updated automatically from retention, mastery, consistency and longevity.';
    $('#scoreRetention').textContent=pct(latest?.retention_score); $('#scoreMastery').textContent=pct(latest?.mastery_score); $('#scoreConsistency').textContent=pct(latest?.overall_consistency??consistency); $('#scoreLongevity').textContent=latest?`${latest.longevity_points} pt${Number(latest.longevity_points)===1?'':'s'}`:`${longevity} pts`;
    setRate('core',latest?.core_success);setRate('moderate',latest?.moderate_success);setRate('challenging',latest?.challenging_success);

    renderAttemptsChart(submissions,corrections);
    $('#progressHistory').innerHTML=submissions.length?submissions.slice().reverse().map(s=>`<div class="history-item"><div><strong>Reading ${String(s.readings?.number||'').padStart(2,'0')} · ${esc(s.readings?.title||'')}</strong><p>Submitted ${fmtDate(s.created_at,{day:'numeric',month:'short'})}</p></div><span class="history-status">${friendlySubmissionStatus(s.status)}</span></div>`).join(''):'<p class="muted">Your reading history will appear here after your first submission.</p>';

    const {data:words}=await client.from('word_feedback').select('word,normalized_word,tier,created_at,submission_id').order('created_at',{ascending:false});
    const ownIds=new Set(submissions.map(s=>s.id)); const ownWords=(words||[]).filter(w=>ownIds.has(w.submission_id));
    const byReading=new Map(); for(const w of ownWords){const s=submissions.find(x=>x.id===w.submission_id);const key=s?.reading_id||'x';if(!byReading.has(key))byReading.set(key,{s,words:[]});byReading.get(key).words.push(w.word);}
    $('#focusWordHistory').innerHTML=byReading.size?[...byReading.values()].map(g=>`<div class="focus-group"><strong>Reading ${String(g.s?.readings?.number||'').padStart(2,'0')}</strong><small>${[...new Set(g.words)].map(esc).join(' · ')}</small></div>`).join(''):'<p class="muted">No focus words have been recorded yet.</p>';
  }

  function profileDescription(name){return ({'Voice Builder':'You are building a stronger pronunciation foundation across the reading targets.','Clear Reader':'Your core pronunciation is becoming increasingly secure.','Polished Reader':'You are handling a wider range of pronunciation challenges reliably.','Expressive Reader':'Your pronunciation is highly secure across increasingly challenging material.','Eloquent Reader':'You are showing strong pronunciation control across the full challenge range.'})[name]||'Your pronunciation profile is developing.';}
  function setRate(id,v){ const n=v==null?0:Number(v); $(`#${id}Rate`).textContent=v==null?'—':`${Math.round(n)}%`; $(`#${id}Bar`).style.width=v==null?'0%':`${Math.max(0,Math.min(100,n))}%`; }
  function friendlySubmissionStatus(s){return ({submitted:'Awaiting review',reviewed:'Feedback ready',correction_pending:'Correction practice',completed:'Completed',reopened:'Reopened'})[s]||s;}
  function renderAttemptsChart(submissions,cycles){
    const reviewed=submissions.filter(s=>s.reviewed_at||['reviewed','correction_pending','completed'].includes(s.status));
    const data=reviewed.map(s=>{const c=cycles.find(x=>x.reading_id===s.reading_id);return{label:`R${s.readings?.number||''}`,value:c?Number(c.attempt_count||0):0};});
    if(state.attemptsChart)state.attemptsChart.destroy(); const ctx=$('#attemptsChart'); if(!ctx)return;
    state.attemptsChart=new Chart(ctx,{type:'line',data:{labels:data.map(x=>x.label),datasets:[{label:'Attempts to mastery',data:data.map(x=>x.value),tension:.28,pointRadius:4,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#9da8b3'}},y:{beginAtZero:true,ticks:{precision:0,color:'#9da8b3'},grid:{color:'rgba(255,255,255,.06)'}}}}});
  }

  async function loadCommunity(){
    if(!state.profile)return;
    $('#leaderboardMonth').textContent=monthLabel();
    try{ await client.rpc('finalize_previous_month'); }catch(e){ console.debug('leaderboard archive',e); }
    const {data:rows,error}=await client.rpc('get_monthly_leaderboard',{p_month:new Date().toISOString().slice(0,10)}); if(error)console.error(error); state.leaderboardRows=rows||[]; renderLeaderboard();
    const {data:voices}=await client.rpc('get_community_voices',{p_limit:12}); await renderCommunityVoices(voices||[]); await loadUpcomingLive();
  }
  function renderLeaderboard(){
    const box=$('#leaderboardPodium'); if(!state.leaderboardRows.length){box.innerHTML='<div class="empty-state" style="grid-column:1/-1"><h3>The podium is still taking shape</h3><p>Eligible learners appear here once this month has enough completed reading windows.</p></div>';return;}
    const medal=p=>p===1?'🥇':p===2?'🥈':'🥉';
    box.innerHTML=state.leaderboardRows.map(r=>`<article class="podium-card position-${Math.min(3,Number(r.position))}" data-leader-id="${r.user_id}"><div class="podium-medal">${medal(Number(r.position))}</div><div class="avatar" style="background-image:url('${avatarUrl(r.avatar_id)}')"></div><h3>${esc(r.display_name)}</h3><div class="profile-tag">${esc(r.reader_profile||'Building profile')}</div><div class="podium-metrics"><span>This month <b>${r.monthly_completed}/${r.monthly_available} · ${Math.round(Number(r.monthly_consistency))}%</b></span><span>Overall <b>${r.overall_completed}/${r.overall_available} · ${Math.round(Number(r.overall_consistency))}%</b></span><span>Longevity <b>${r.longevity_points} pts</b></span><span>Previous Top 3 <b>${r.top3_finishes}</b></span></div></article>`).join('');
    $$('[data-leader-id]',box).forEach(c=>c.addEventListener('click',()=>openPublicProfile(state.leaderboardRows.find(r=>r.user_id===c.dataset.leaderId))));
  }
  function openPublicProfile(r){if(!r)return;const card=$('#publicProfileCard');card.innerHTML=`<button class="modal-close" data-close-public-profile>×</button><div class="avatar" style="background-image:url('${avatarUrl(r.avatar_id)}')"></div><h2>${esc(r.display_name)}</h2><div class="profile-tag">${esc(r.reader_profile)}</div><p class="muted">Monthly leaderboard cards celebrate commitment. Pronunciation performance does not affect the ranking.</p><div class="public-profile-stats"><div><span>This month</span><strong>${r.monthly_completed}/${r.monthly_available}</strong></div><div><span>Monthly consistency</span><strong>${Math.round(Number(r.monthly_consistency))}%</strong></div><div><span>Overall consistency</span><strong>${Math.round(Number(r.overall_consistency))}%</strong></div><div><span>Longevity</span><strong>${r.longevity_points} pts</strong></div><div><span>Current streak</span><strong>${r.current_streak}</strong></div><div><span>Top 3 finishes</span><strong>${r.top3_finishes}</strong></div></div>`; $('[data-close-public-profile]',card).addEventListener('click',()=>$('#publicProfileModal').classList.add('hidden'));$('#publicProfileModal').classList.remove('hidden');}
  async function renderCommunityVoices(rows){
    const box=$('#communityVoices'); if(!rows.length){box.innerHTML='<p class="muted">No member recordings are available to hear yet.</p>';return;}
    const html=[]; for(const r of rows){const {data}=await client.storage.from('practice-audio').createSignedUrl(r.audio_path,1800);if(!data?.signedUrl)continue;html.push(`<div class="voice-row"><div style="display:flex;gap:10px;align-items:center"><div class="avatar" style="width:42px;height:42px;background-image:url('${avatarUrl(r.avatar_id)}')"></div><div><strong>${esc(r.display_name)}</strong><p class="muted" style="margin:2px 0">${esc(r.reader_profile)} · Reading ${String(r.reading_number).padStart(2,'0')}</p></div></div><audio controls preload="none" src="${esc(data.signedUrl)}"></audio></div>`);} box.innerHTML=html.join('')||'<p class="muted">No member recordings are available to hear yet.</p>';
  }

  function setAdminTab(tab){ $$('.admin-tab').forEach(x=>x.classList.toggle('is-active',x.dataset.adminTab===tab)); $$('.admin-panel').forEach(x=>x.classList.toggle('is-active',x.id===`admin-${tab}`)); if(tab==='students')loadStudents();if(tab==='review')loadAdminQueue();if(tab==='corrections')loadCorrectionQueue();if(tab==='passages')loadPassageAdmin();if(tab==='words')loadWordInsights(true);if(tab==='live')loadUpcomingLive(); }
  async function loadAdminOverview(){
    if(!state.isAdmin)return;
    const now=nowIso(); const [{count:learners},{count:pending},{count:corr},{data:current}]=await Promise.all([
      client.from('learner_profiles').select('*',{count:'exact',head:true}).eq('status','active'),
      client.from('submissions').select('*',{count:'exact',head:true}).eq('status','submitted'),
      client.from('correction_cycles').select('*',{count:'exact',head:true}).eq('status','submitted'),
      client.from('readings').select('number,title,opens_at,closes_at').eq('publication_status','published').lte('opens_at',now).gt('closes_at',now).order('opens_at',{ascending:false}).limit(1).maybeSingle()
    ]);
    $('#adminLearners').textContent=learners||0;$('#adminPendingReviews').textContent=pending||0;$('#adminPendingCorrections').textContent=corr||0;$('#adminCurrentReading').textContent=current?`R${String(current.number).padStart(2,'0')}`:'—';$('#adminCurrentWindow').textContent=current?current.title:'Not scheduled';
    await Promise.all([loadResendUsage(),loadWordInsights(false),loadUpcomingLive()]);
  }

  function renderEmailSuggestion(){
    const input=$('#inviteEmail'),box=$('#emailSuggestion');const email=input.value.trim().toLowerCase();const parts=email.split('@');if(parts.length!==2){box.classList.add('hidden');return;}const d=parts[1];const map={'gmial.com':'gmail.com','gamil.com':'gmail.com','gmail.co':'gmail.com','hotnail.com':'hotmail.com','outlok.com':'outlook.com','outllook.com':'outlook.com','yaho.com':'yahoo.com','icloud.co':'icloud.com'};const suggestion=map[d];if(!suggestion){box.classList.add('hidden');return;}box.innerHTML=`Did you mean <button type="button" class="text-button">${esc(parts[0]+'@'+suggestion)}</button>?`;box.classList.remove('hidden');$('button',box).addEventListener('click',()=>{input.value=`${parts[0]}@${suggestion}`;box.classList.add('hidden');});
  }
  async function inviteStudent(){
    const name=$('#inviteName').value.trim(),email=$('#inviteEmail').value.trim(),status=$('#inviteStatus');if(!name||!/^\S+@\S+\.\S+$/.test(email))return setStatus(status,'Enter a name and valid email.','error');setStatus(status,'Sending invitation…');const {data,error}=await client.functions.invoke('admin-invite-student',{body:{action:'invite',display_name:name,email}});if(error||data?.error)return setStatus(status,data?.error||error.message,'error');setStatus(status,`Invitation sent to ${email}. It is valid for 24 hours.`,'success');$('#inviteName').value='';$('#inviteEmail').value='';loadStudents();
  }
  async function loadResendUsage(){
    const box=$('#resendUsage');box.innerHTML='<p class="muted">Loading usage…</p>';const {data,error}=await client.functions.invoke('get-resend-usage',{body:{}});if(error||!data?.emails){box.innerHTML=`<p class="muted">${esc(data?.error||'Usage unavailable. The usage card needs a full-access Resend key.')}</p>`;return;}const d=data.emails.daily,m=data.emails.monthly;const row=(label,x)=>{const limit=x?.limit,used=x?.used||0,p=limit?Math.min(100,100*used/limit):0;return`<div class="usage-row"><span>${label}</span><div class="usage-track"><i style="width:${p}%"></i></div><b>${used}${limit==null?'':` / ${limit}`}</b></div>`};box.innerHTML=row('Today',d)+row('This month',m);
  }

  async function loadStudents(){
    const {data:rows,error}=await client.from('learner_profiles').select('*').order('created_at',{ascending:false});const box=$('#studentList');if(error){box.innerHTML=`<p class="muted">${esc(error.message)}</p>`;return;}box.innerHTML=(rows||[]).map(p=>`<div class="student-row" data-student="${p.user_id}"><div style="display:flex;gap:10px;align-items:center"><div class="avatar" style="width:42px;height:42px;background-image:url('${avatarUrl(p.avatar_id)}')"></div><div><strong>${esc(p.display_name)}</strong><p>${esc(p.email)}</p></div></div><div style="text-align:right"><strong>${esc(p.status)}</strong><p>${p.last_active_at?`Active ${fmtDate(p.last_active_at,{day:'numeric',month:'short'})}`:'Not active yet'}</p></div></div>`).join('')||'<p class="muted">No learners yet.</p>';$$('[data-student]',box).forEach(r=>r.addEventListener('click',()=>openStudentDetail(r.dataset.student)));
  }
  async function openStudentDetail(uid){
    const [{data:p},{data:subs},{data:snap},{data:streak}]=await Promise.all([client.from('learner_profiles').select('*').eq('user_id',uid).single(),client.from('submissions').select('id,reading_id,status,created_at,readings(number,title)').eq('user_id',uid).order('created_at',{ascending:false}),client.from('progress_snapshots').select('*').eq('user_id',uid).order('snapshot_at',{ascending:false}).limit(1).maybeSingle(),client.rpc('current_reading_streak',{p_user_id:uid})]);if(!p)return;const completed=new Set((subs||[]).map(s=>s.reading_id)).size;const detail=$('#studentDetail');detail.innerHTML=`<div class="card-heading"><div><span class="eyebrow">Learner detail</span><h3>${esc(p.display_name)}</h3><p class="muted">${esc(p.email)}</p></div><div class="avatar" style="width:58px;height:58px;background-image:url('${avatarUrl(p.avatar_id)}')"></div></div><div class="student-detail-grid"><div><span>Reader Profile</span><strong>${esc(snap?.reader_profile||'Taking shape')}</strong></div><div><span>Progress Score</span><strong>${snap?.progress_score==null?'—':Math.round(Number(snap.progress_score))}</strong></div><div><span>Readings</span><strong>${completed}</strong></div><div><span>Current streak</span><strong>${streak||0}</strong></div><div><span>Consistency</span><strong>${pct(snap?.overall_consistency)}</strong></div><div><span>Longevity</span><strong>${snap?.longevity_points||Math.floor(completed/5)} pts</strong></div><div><span>Last active</span><strong>${p.last_active_at?fmtDate(p.last_active_at,{day:'numeric',month:'short'}):'—'}</strong></div><div><span>Community audio</span><strong>${p.community_audio_enabled?'On':'Private'}</strong></div></div><div class="review-actions"><button class="button button-ghost" id="adminSendLink">Send sign-in link</button>${p.status==='invited'?'<button class="button button-primary" id="adminResendInvite">Resend invitation</button>':''}</div><h4>Recent readings</h4><div class="history-list">${(subs||[]).slice(0,8).map(s=>`<div class="history-item"><div><strong>R${String(s.readings?.number||'').padStart(2,'0')} · ${esc(s.readings?.title||'')}</strong><p>${fmtDate(s.created_at,{day:'numeric',month:'short'})}</p></div><span class="history-status">${friendlySubmissionStatus(s.status)}</span></div>`).join('')||'<p class="muted">No readings submitted yet.</p>'}</div>`;detail.classList.remove('hidden');$('#adminSendLink').addEventListener('click',()=>adminSendLink(p,'send_signin'));$('#adminResendInvite')?.addEventListener('click',()=>adminSendLink(p,'invite'));
  }
  async function adminSendLink(p,action){const {data,error}=await client.functions.invoke('admin-invite-student',{body:{action,email:p.email,display_name:p.display_name}});if(error||data?.error)return showToast(data?.error||error.message,5000);showToast(action==='invite'?'Invitation resent.':'Sign-in link sent.');}

  async function loadAdminQueue(){
    const {data,error}=await client.from('submissions').select('id,user_id,reading_id,display_name,audio_path,status,created_at,reviewed_at,readings(number,title,plain_text,markup_text)').eq('status','submitted').order('created_at');state.adminQueue=data||[];$('#queueCount').textContent=state.adminQueue.length;const box=$('#adminQueue');if(error){box.innerHTML=`<p class="muted">${esc(error.message)}</p>`;return;}box.innerHTML=state.adminQueue.length?state.adminQueue.map(s=>`<div class="queue-item" data-submission="${s.id}"><div><strong>${esc(s.display_name)}</strong><p>Reading ${String(s.readings?.number||'').padStart(2,'0')} · ${fmtDate(s.created_at,{day:'numeric',month:'short'})}</p></div><span class="history-status">Review</span></div>`).join(''):'<p class="muted">No readings are waiting for review.</p>';$$('[data-submission]',box).forEach(x=>x.addEventListener('click',()=>openAdminSubmission(x.dataset.submission)));
  }

  function tokenise(text=''){
    const parts=String(text).match(/[\p{L}\p{N}'’-]+|\s+|[^\s\p{L}\p{N}'’-]+/gu)||[];let wordIndex=0;return parts.map(raw=>{const isWord=/^[\p{L}\p{N}'’-]+$/u.test(raw);return{raw,isWord,wordIndex:isWord?wordIndex++:null,normalized:isWord?normalizeWord(raw):''};});
  }
  function assignTargets(tokens,targets){
    const pool=new Map();(targets||[]).forEach(t=>{const k=t.normalized_target;if(!pool.has(k))pool.set(k,[]);pool.get(k).push(t);});const used=new Map();return tokens.map(t=>{if(!t.isWord)return t;const list=pool.get(t.normalized)||[];const n=used.get(t.normalized)||0;const target=list[n]||null;if(target)used.set(t.normalized,n+1);return{...t,target};});
  }

  async function openAdminSubmission(id){
    const s=state.adminQueue.find(x=>x.id===id)||(await client.from('submissions').select('id,user_id,reading_id,display_name,audio_path,status,created_at,reviewed_at,readings(number,title,plain_text,markup_text)').eq('id',id).single()).data;if(!s)return;state.selectedAdminSubmission=s;$$('.queue-item').forEach(x=>x.classList.toggle('is-active',x.dataset.submission===id));
    const [{data:urlData},{data:targets},{data:marks},{data:feedback}]=await Promise.all([client.storage.from('practice-audio').createSignedUrl(s.audio_path,3600),client.from('reading_targets').select('*').eq('reading_id',s.reading_id).order('marker_order'),client.from('word_feedback').select('*').eq('submission_id',id),client.from('feedback').select('*').eq('submission_id',id).maybeSingle()]);state.reviewTargets=targets||[];state.reviewTokens=assignTargets(tokenise(s.readings?.plain_text||''),state.reviewTargets);state.reviewMarks=new Map((marks||[]).map(m=>[Number(m.token_index),{word:m.word,normalized:m.normalized_word,tier:m.tier,target_id:m.target_id}]));state.reviewFeedbackBlob=null;state.correctionModelBlob=null;renderReviewPanel(s,urlData?.signedUrl||'',feedback);
  }

  function renderReviewPanel(s,audioUrl,feedback){
    const panel=$('#reviewPanel');
    const passage=state.reviewTokens.map(t=>{if(!t.isWord)return esc(t.raw).replace(/\n/g,'<br>');const mark=state.reviewMarks.has(t.wordIndex);const tier=t.target?.tier?` tier-${t.target.tier}`:'';return`<button type="button" class="review-token${tier}${mark?' flagged':''}" data-token-index="${t.wordIndex}" title="${t.target?`${t.target.tier} target`:'Click to flag as a focus word'}">${esc(t.raw)}</button>`;}).join('');
    panel.innerHTML=`<div class="review-head"><div><span class="eyebrow">Reading ${String(s.readings?.number||'').padStart(2,'0')}</span><h2 style="margin:7px 0">${esc(s.display_name)} · ${esc(s.readings?.title||'')}</h2><p class="muted">Click any mispronounced word in the passage. Blue = Core, orange = Moderate, red = Challenging. Learners never see these colours.</p></div></div><audio class="review-audio" controls src="${esc(audioUrl)}"></audio><div class="review-passage">${passage}</div><div class="review-focus-box"><h4>Focus words</h4><div id="reviewFocusWords" class="correction-words"></div><p class="muted">All selected words will be practised together in one private correction recording.</p></div><label>Overall feedback<textarea id="reviewOverallText" rows="4" placeholder="A short private note for the learner…">${esc(feedback?.overall_text||'')}</textarea></label><div class="dashboard-grid" style="margin-top:12px"><div class="review-selected"><span class="eyebrow">Optional voice feedback</span><div class="inline-recorder"><button id="reviewFeedbackRecord" class="record-mini">●</button><span id="reviewFeedbackLabel">Record voice feedback</span><audio id="reviewFeedbackPreview" controls class="hidden"></audio></div></div><div class="review-selected"><span class="eyebrow">Correction model</span><p class="muted">Required when you flag focus words. Record all focus words in one clip.</p><div class="inline-recorder"><button id="correctionModelRecord" class="record-mini">●</button><span id="correctionModelLabel">Record focus words</span><audio id="correctionModelPreview" controls class="hidden"></audio></div></div></div><div class="review-actions"><button id="publishReviewButton" class="button button-primary">Publish feedback</button></div><div id="reviewSaveStatus" class="form-status"></div>`;
    $$('[data-token-index]',panel).forEach(b=>b.addEventListener('click',()=>toggleReviewWord(Number(b.dataset.tokenIndex))));$('#reviewFeedbackRecord').addEventListener('click',toggleReviewFeedbackRecording);$('#correctionModelRecord').addEventListener('click',toggleCorrectionModelRecording);$('#publishReviewButton').addEventListener('click',publishReview);renderReviewFocusWords();
  }
  function toggleReviewWord(index){const t=state.reviewTokens.find(x=>x.wordIndex===index);if(!t)return;if(state.reviewMarks.has(index))state.reviewMarks.delete(index);else state.reviewMarks.set(index,{word:t.raw,normalized:t.normalized,tier:t.target?.tier||null,target_id:t.target?.id||null});const b=$(`[data-token-index="${index}"]`);b?.classList.toggle('flagged',state.reviewMarks.has(index));renderReviewFocusWords();}
  function renderReviewFocusWords(){const box=$('#reviewFocusWords');if(!box)return;box.innerHTML=state.reviewMarks.size?[...state.reviewMarks.values()].map(m=>`<span class="word-chip">${esc(m.word)}${m.tier?` · ${esc(m.tier)}`:''}</span>`).join(''):'<span class="muted">No focus words selected.</span>';}

  async function toggleReviewFeedbackRecording(){
    if(state.reviewFeedbackRecorder?.state==='recording'){state.reviewFeedbackRecorder.stop();return;}try{state.reviewFeedbackStream=await navigator.mediaDevices.getUserMedia({audio:true});const chunks=[];state.reviewFeedbackRecorder=new MediaRecorder(state.reviewFeedbackStream);state.reviewFeedbackRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};state.reviewFeedbackRecorder.onstop=()=>{state.reviewFeedbackBlob=new Blob(chunks,{type:state.reviewFeedbackRecorder.mimeType||'audio/webm'});state.reviewFeedbackStream?.getTracks().forEach(t=>t.stop());$('#reviewFeedbackPreview').src=URL.createObjectURL(state.reviewFeedbackBlob);$('#reviewFeedbackPreview').classList.remove('hidden');$('#reviewFeedbackLabel').textContent='Voice feedback ready';$('#reviewFeedbackRecord').textContent='●';};state.reviewFeedbackRecorder.start();$('#reviewFeedbackLabel').textContent='Recording…';$('#reviewFeedbackRecord').textContent='■';}catch{showToast('Could not access the microphone.');}
  }
  async function toggleCorrectionModelRecording(){
    if(state.correctionModelRecorder?.state==='recording'){state.correctionModelRecorder.stop();return;}try{state.correctionModelStream=await navigator.mediaDevices.getUserMedia({audio:true});const chunks=[];state.correctionModelRecorder=new MediaRecorder(state.correctionModelStream);state.correctionModelRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};state.correctionModelRecorder.onstop=()=>{state.correctionModelBlob=new Blob(chunks,{type:state.correctionModelRecorder.mimeType||'audio/webm'});state.correctionModelStream?.getTracks().forEach(t=>t.stop());$('#correctionModelPreview').src=URL.createObjectURL(state.correctionModelBlob);$('#correctionModelPreview').classList.remove('hidden');$('#correctionModelLabel').textContent='Focus-word model ready';$('#correctionModelRecord').textContent='●';};state.correctionModelRecorder.start();$('#correctionModelLabel').textContent='Recording…';$('#correctionModelRecord').textContent='■';}catch{showToast('Could not access the microphone.');}
  }

  async function publishReview(){
    const s=state.selectedAdminSubmission,status=$('#reviewSaveStatus');if(!s)return;const focus=[...state.reviewMarks.entries()];if(focus.length&&!state.correctionModelBlob)return setStatus(status,'Record one model clip containing all focus words before publishing.','error');const btn=$('#publishReviewButton');btn.disabled=true;btn.textContent='Publishing…';
    try{
      const adminId=state.session.user.id;const now=nowIso();
      await client.from('word_feedback').delete().eq('submission_id',s.id);
      if(focus.length){const rows=focus.map(([token,m])=>({submission_id:s.id,admin_id:adminId,token_index:token,word:m.word,normalized_word:m.normalized,tier:m.tier,target_id:m.target_id,status:'needs_work'}));const ins=await client.from('word_feedback').insert(rows);if(ins.error)throw ins.error;}
      let {data:fb,error:fbErr}=await client.from('feedback').upsert({submission_id:s.id,admin_id:adminId,overall_text:$('#reviewOverallText').value.trim()||null,published_at:now},{onConflict:'submission_id'}).select().single();if(fbErr)throw fbErr;
      if(state.reviewFeedbackBlob){const ext=audioExt(state.reviewFeedbackBlob),path=`${s.user_id}/${fb.id}.${ext}`;const up=await client.storage.from('feedback-audio').upload(path,state.reviewFeedbackBlob,{contentType:state.reviewFeedbackBlob.type,upsert:true});if(up.error)throw up.error;const u=await client.from('feedback').update({audio_path:path}).eq('id',fb.id);if(u.error)throw u.error;}
      if(focus.length){
        const {data:cycle,error:cErr}=await client.from('correction_cycles').insert({submission_id:s.id,user_id:s.user_id,reading_id:s.reading_id,status:'awaiting_learner'}).select().single();if(cErr)throw cErr;
        const wordRows=[...new Map(focus.map(([,m])=>[m.normalized,{cycle_id:cycle.id,word_text:m.word,normalized_word:m.normalized,tier:m.tier}])).values()];const cw=await client.from('correction_cycle_words').insert(wordRows);if(cw.error)throw cw.error;
        const ext=audioExt(state.correctionModelBlob),path=`${s.user_id}/${cycle.id}.${ext}`;const up=await client.storage.from('correction-model-audio').upload(path,state.correctionModelBlob,{contentType:state.correctionModelBlob.type,upsert:true});if(up.error)throw up.error;await client.from('correction_cycles').update({model_audio_path:path}).eq('id',cycle.id);
        const su=await client.from('submissions').update({status:'correction_pending',reviewed_at:now}).eq('id',s.id);if(su.error)throw su.error;
      }else{
        const su=await client.from('submissions').update({status:'completed',reviewed_at:now,completed_at:now}).eq('id',s.id);if(su.error)throw su.error;const {error:pErr}=await client.rpc('recalculate_progress',{p_user_id:s.user_id,p_reading_id:s.reading_id});if(pErr)console.error('progress recalculation',pErr);
      }
      const {data:notice,error:noticeErr}=await client.functions.invoke('send-feedback-notification',{body:{submission_id:s.id}});if(noticeErr)console.error(noticeErr);
      setStatus(status,noticeErr?'Feedback published. Email notification needs attention.':'Feedback published and the learner was notified.','success');showToast('Feedback published.');state.selectedAdminSubmission=null;await loadAdminQueue();await loadAdminOverview();$('#reviewPanel').innerHTML='<div class="empty-review"><span>✓</span><h3>Review published</h3><p>Select the next submission when you are ready.</p></div>';
    }catch(e){console.error(e);setStatus(status,e.message||'Could not publish the review.','error');}finally{btn.disabled=false;btn.textContent='Publish feedback';}
  }

  async function loadCorrectionQueue(){
    const {data:rows,error}=await client.from('correction_cycles').select('*, submissions(display_name), readings(number,title)').eq('status','submitted').order('updated_at');const box=$('#correctionQueue');if(error){box.innerHTML=`<p class="muted">${esc(error.message)}</p>`;return;}if(!rows?.length){box.innerHTML='<p class="muted">No correction attempts are waiting for review.</p>';return;}const html=[];for(const c of rows){let learner='';if(c.learner_audio_path){const {data}=await client.storage.from('correction-audio').createSignedUrl(c.learner_audio_path,3600);learner=data?.signedUrl||'';}const {data:words}=await client.from('correction_cycle_words').select('word_text').eq('cycle_id',c.id);html.push(`<div class="correction-row" data-cycle="${c.id}"><div><strong>${esc(c.submissions?.display_name||'Learner')} · Reading ${String(c.readings?.number||'').padStart(2,'0')}</strong><p class="muted">Attempt ${c.attempt_count} · ${(words||[]).map(x=>esc(x.word_text)).join(' · ')}</p>${learner?`<audio controls src="${esc(learner)}"></audio>`:''}</div><div style="min-width:260px"><label style="margin:0 0 8px">Retry note<input class="retry-note" placeholder="Optional short note" /></label><div style="display:flex;gap:8px"><button class="button button-ghost compact" data-retry>Try again</button><button class="button button-primary compact" data-approve>All correct</button></div></div></div>`);}box.innerHTML=html.join('');$$('[data-cycle]',box).forEach(row=>{const id=row.dataset.cycle; $('[data-retry]',row).addEventListener('click',()=>reviewCorrection(id,false,$('.retry-note',row).value.trim()));$('[data-approve]',row).addEventListener('click',()=>reviewCorrection(id,true,''));});
  }
  async function reviewCorrection(id,approved,note){
    const {data:c}=await client.from('correction_cycles').select('*').eq('id',id).single();if(!c)return;const now=nowIso();const attempt=(await client.from('correction_attempts').select('*').eq('correction_cycle_id',id).eq('attempt_number',c.attempt_count).maybeSingle()).data;
    try{
      if(approved){if(attempt)await client.from('correction_attempts').update({outcome:'approved',reviewed_at:now,audio_path:null}).eq('id',attempt.id);const del=[];if(c.learner_audio_path)del.push(client.storage.from('correction-audio').remove([c.learner_audio_path]));if(c.model_audio_path)del.push(client.storage.from('correction-model-audio').remove([c.model_audio_path]));await Promise.all(del);await client.from('correction_cycles').update({status:'approved',approved_at:now,retry_note:null,learner_audio_path:null,model_audio_path:null}).eq('id',id);await client.from('submissions').update({status:'completed',completed_at:now}).eq('id',c.submission_id);await client.rpc('recalculate_progress',{p_user_id:c.user_id,p_reading_id:c.reading_id});showToast('Correction mastered. Temporary audio deleted.');}
      else{if(attempt)await client.from('correction_attempts').update({outcome:'retry',reviewed_at:now,audio_path:null}).eq('id',attempt.id);if(c.learner_audio_path)await client.storage.from('correction-audio').remove([c.learner_audio_path]);await client.from('correction_cycles').update({status:'retry',retry_note:note||null,learner_audio_path:null}).eq('id',id);showToast('Learner can try again.');}
      await loadCorrectionQueue();await loadAdminOverview();
    }catch(e){console.error(e);showToast(e.message||'Could not update the correction.');}
  }

  function parseMarkup(markup=''){
    const targets=[];let order=0;const tierMap={C:'core',M:'moderate',H:'challenging'};
    const plain=String(markup).replace(/\[\[([CMH]):([^|\]]+?)(?:\|([^\]]+?))?\]\]/g,(_m,code,text,meaning)=>{const target=String(text).trim();targets.push({marker_order:order++,target_text:target,normalized_target:normalizeWord(target),tier:tierMap[code],meaning:code==='H'?(String(meaning||'').trim()||null):null});return target;});
    return{plain,targets,counts:{core:targets.filter(x=>x.tier==='core').length,moderate:targets.filter(x=>x.tier==='moderate').length,challenging:targets.filter(x=>x.tier==='challenging').length}};
  }
  function previewPassageMarkup(){
    const markup=$('#passageMarkup').value;const parsed=parseMarkup(markup);$('#passageTierSummary').innerHTML=`<span style="color:var(--blue)">Core ${parsed.counts.core}</span><span style="color:var(--orange)">Moderate ${parsed.counts.moderate}</span><span style="color:var(--red)">Challenging ${parsed.counts.challenging}</span><span>${wordCount(parsed.plain)} words</span>`;
    let idx=0;const html=String(markup).replace(/\[\[([CMH]):([^|\]]+?)(?:\|([^\]]+?))?\]\]/g,(_m,c,t)=>`<span class="admin-target-${c==='C'?'core':c==='M'?'moderate':'challenging'}">${esc(t.trim())}</span>`);$('#adminPassagePreview').innerHTML=html.split(/\n\s*\n/).map(p=>`<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
  }
  async function loadPassageAdmin(){
    const {data:rows,error}=await client.from('readings').select('id,number,title,subtitle,markup_text,plain_text,publication_status,opens_at,closes_at,model_audio_path,word_count').order('number',{ascending:false});const box=$('#passageList');if(error){box.innerHTML=`<p class="muted">${esc(error.message)}</p>`;return;}const now=Date.now();box.innerHTML=(rows||[]).map(r=>{const live=r.publication_status==='published'&&r.opens_at&&r.closes_at&&new Date(r.opens_at).getTime()<=now&&new Date(r.closes_at).getTime()>now;return`<div class="passage-row${live?' is-live':''}" data-reading="${r.id}"><div><strong>Reading ${String(r.number).padStart(2,'0')} · ${esc(r.title)}</strong><p>${live?'LIVE · ':''}${r.publication_status}${r.opens_at?` · ${fmtDateTime(r.opens_at)}`:''}</p></div><span class="history-status">${r.word_count||wordCount(r.plain_text)} words</span></div>`}).join('');$$('[data-reading]',box).forEach(x=>x.addEventListener('click',()=>editPassage(Number(x.dataset.reading),rows.find(r=>r.id===Number(x.dataset.reading)))));if(!state.editingReadingId)newPassageEditor(rows||[]);
  }
  function toLocalInput(v){if(!v)return'';const d=new Date(v),off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16);}
  function newPassageEditor(rows=[]){state.editingReadingId=null;state.modelBlob=null;$('#passageNumber').value=(rows.length?Math.max(...rows.map(r=>Number(r.number)||0))+1:'');$('#passageTitle').value='';$('#passageSubtitle').value='';$('#passageMarkup').value='';$('#passageOpens').value='';$('#passageCloses').value='';$('#modelPreview').classList.add('hidden');$('#modelPreview').removeAttribute('src');$('#modelRecordLabel').textContent='Record model reading';previewPassageMarkup();setStatus($('#passageStatus'));}
  function editPassage(id,r){state.editingReadingId=id;state.modelBlob=null;$('#passageNumber').value=r.number;$('#passageTitle').value=r.title||'';$('#passageSubtitle').value=r.subtitle||'';$('#passageMarkup').value=r.markup_text||r.plain_text||'';$('#passageOpens').value=toLocalInput(r.opens_at);$('#passageCloses').value=toLocalInput(r.closes_at);$('#modelPreview').classList.add('hidden');$('#modelRecordLabel').textContent=r.model_audio_path?'Model audio already saved · record to replace':'Record model reading';previewPassageMarkup();setStatus($('#passageStatus'));
  }
  function slugify(v){return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,70)||`reading-${Date.now()}`;}
  async function savePassage(publish){
    const status=$('#passageStatus'),num=Number($('#passageNumber').value),title=$('#passageTitle').value.trim(),subtitle=$('#passageSubtitle').value.trim(),markup=$('#passageMarkup').value.trim(),opens=$('#passageOpens').value,closes=$('#passageCloses').value;if(!num||!title||!markup)return setStatus(status,'Reading number, title and passage are required.','error');if(publish&&(!opens||!closes))return setStatus(status,'Choose an opening and closing time before publishing.','error');if(opens&&closes&&new Date(closes)<=new Date(opens))return setStatus(status,'Closing time must be after opening time.','error');const parsed=parseMarkup(markup);if(publish&&(parsed.counts.core<1||parsed.counts.moderate<1||parsed.counts.challenging<1))return setStatus(status,'Published passages need Core, Moderate and Challenging target markup.','error');setStatus(status,'Saving passage…');
    const payload={number:num,slug:`${String(num).padStart(2,'0')}-${slugify(title)}`,title,subtitle:subtitle||null,level:'Shared live reading',minutes:2,sections:parsed.plain.split(/\n\s*\n/).filter(Boolean),markup_text:markup,plain_text:parsed.plain,word_count:wordCount(parsed.plain),publication_status:publish?'published':'draft',active:publish,opens_at:opens?new Date(opens).toISOString():null,closes_at:closes?new Date(closes).toISOString():null,accent_code:'en-GB-modern-rp',created_by:state.session.user.id};
    try{let reading;if(state.editingReadingId){const {data,error}=await client.from('readings').update(payload).eq('id',state.editingReadingId).select().single();if(error)throw error;reading=data;}else{const {data,error}=await client.from('readings').insert(payload).select().single();if(error)throw error;reading=data;state.editingReadingId=reading.id;}await client.from('reading_targets').delete().eq('reading_id',reading.id);if(parsed.targets.length){const {error}=await client.from('reading_targets').insert(parsed.targets.map(t=>({...t,reading_id:reading.id})));if(error)throw error;}if(state.modelBlob){const ext=audioExt(state.modelBlob),path=`${reading.id}/model.${ext}`;const up=await client.storage.from('model-audio').upload(path,state.modelBlob,{contentType:state.modelBlob.type,upsert:true});if(up.error)throw up.error;await client.from('readings').update({model_audio_path:path}).eq('id',reading.id);}setStatus(status,publish?'Reading published to its scheduled window.':'Draft saved.','success');showToast(publish?'Reading scheduled.':'Draft saved.');state.modelBlob=null;await loadPassageAdmin();await loadAdminOverview();}catch(e){console.error(e);setStatus(status,e.message||'Could not save the passage.','error');}
  }
  async function toggleModelRecording(){if(state.modelRecorder?.state==='recording'){state.modelRecorder.stop();return;}try{state.modelStream=await navigator.mediaDevices.getUserMedia({audio:true});const chunks=[];state.modelRecorder=new MediaRecorder(state.modelStream);state.modelRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};state.modelRecorder.onstop=()=>{state.modelBlob=new Blob(chunks,{type:state.modelRecorder.mimeType||'audio/webm'});state.modelStream?.getTracks().forEach(t=>t.stop());$('#modelPreview').src=URL.createObjectURL(state.modelBlob);$('#modelPreview').classList.remove('hidden');$('#modelRecordLabel').textContent='Model recording ready';$('#modelRecordButton').textContent='●';};state.modelRecorder.start();$('#modelRecordLabel').textContent='Recording… press to stop';$('#modelRecordButton').textContent='■';}catch{showToast('Could not access the microphone.');}}
  async function copyPassagePrompt(){const prompt=`Create one natural British English (Modern RP) pronunciation reading for The Pronunciation Room.\n\nRequirements:\n- 120–150 words total.\n- One coherent, adult-friendly passage with natural meaning.\n- Exactly 10 Core pronunciation targets, marked [[C:word]].\n- Exactly 6 Moderate pronunciation targets, marked [[M:word]].\n- Exactly 4 Challenging pronunciation targets, marked [[H:word|short plain-English meaning]].\n- Mark only the target word itself, not punctuation.\n- Use each marked target naturally in the passage.\n- Mix useful British pronunciation challenges: vowels, consonants, clusters, stress, endings and spelling/pronunciation mismatches.\n- Do not make the vocabulary artificially difficult just to create red/challenging words.\n- Return only the title, one-sentence subtitle, and the marked passage.\n- Do not include explanations or a word list.`;try{await navigator.clipboard.writeText(prompt);showToast('ChatGPT passage prompt copied.');}catch{showToast('Could not copy the prompt.');}}

  async function loadWordInsights(full=false){
    const {data,error}=await client.rpc('get_word_insights');if(error){console.error(error);return;}state.wordInsights=data||[];const due=state.wordInsights.filter(x=>x.needs_reuse).slice(0,10);const compact=$('#overviewReuseWords');if(compact)compact.innerHTML=due.length?due.map(x=>`<span>${esc(x.word)} · ${x.unique_learners} learner${Number(x.unique_learners)===1?'':'s'}</span>`).join(''):'<p class="muted">No words are due for reuse yet.</p>';if(full){const box=$('#wordInsightsTable');box.innerHTML=state.wordInsights.length?`<table class="data-table"><thead><tr><th>Word</th><th>Learners flagged</th><th>Total flags</th><th>Avg attempts</th><th>Last reused</th><th>Reuse queue</th></tr></thead><tbody>${state.wordInsights.map(x=>`<tr><td><strong>${esc(x.word)}</strong></td><td>${x.unique_learners}</td><td>${x.total_flags}</td><td>${x.average_attempts??'—'}</td><td>${x.last_reused_at?fmtDate(x.last_reused_at,{day:'numeric',month:'short'}):'Never'}</td><td class="${x.needs_reuse?'priority-high':''}">${x.needs_reuse?'Prioritise':'Recently reused'}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Word insights will build as you flag real learner mistakes.</p>';}
  }

  async function saveLiveSession(){const starts=$('#liveStarts').value,ends=$('#liveEnds').value,url=$('#liveJoinUrl').value.trim(),note=$('#liveNote').value.trim(),status=$('#liveStatus');if(!starts)return setStatus(status,'Choose the session start time.','error');setStatus(status,'Publishing session…');const {error}=await client.from('live_sessions').insert({title:'Weekly Live Pronunciation Session',starts_at:new Date(starts).toISOString(),ends_at:ends?new Date(ends).toISOString():null,join_url:url||null,note:note||null,published:true,created_by:state.session.user.id});if(error)return setStatus(status,error.message,'error');setStatus(status,'Live session published.','success');showToast('Live session published.');await loadUpcomingLive();}

  document.addEventListener('DOMContentLoaded',init);
})();
