'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const list = value => Array.isArray(value) ? value.filter(x => x && typeof x === 'object') : [];
  const str = (value, fallback = '暂无记录') => value === 'unknown' ? '未记录' : typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : fallback;
  const count = value => Number.isFinite(Number(value)) && value !== null && value !== '' && value !== undefined ? String(value) : '—';
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const clear = id => { const n = $(id); n.replaceChildren(); return n; };
  const text = (id, value) => { $(id).textContent = value; };
  const date = value => { if (value === null || value === undefined || value === '') return null; const d = new Date(typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : value); return Number.isNaN(d.valueOf()) ? null : d; };
  const time = value => { const d = date(value); return d ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d) : '时间未提供'; };
  const brief = value => str(value).split('/').pop();
  const stateNames = {unknown:'未记录',assigned:'已分配',pass:'正式接受',accepted:'正式接受',running:'执行中',evidence_collected:'证据齐备，待终审',task_fail:'题目需修订',platform_invalid:'平台异常',waiting_platform:'等待平台结果',reviewing:'审题中',completed:'已完成',queued:'排队中',active:'活动选题',session_paused:'会话暂停',selftest_passed:'自测通过',failed:'失败',selftest_failed:'自测失败',observing:'持续观察',verified:'已核验',partial:'部分完成'};
  const named = v => stateNames[v] || str(v);
  let snapshot = {}, publicationStatus = {}, history = [], currentView = 'latest', requestId = 0;
  const waiting = a => a.review_blocked !== true && (a.expected_review_wait === true || /正常等待|容量排队/.test(str(a.runtime,'')));
  const blocked = a => a.review_blocked === true || !waiting(a) && (Boolean(a.blocker) || /异常|堵塞|启动失败/.test(str(a.runtime,'')) || ['blocked','platform_invalid','platform_error'].includes(a.wait?.state));
  const badge = (label, tone = '') => el('span', 'badge ' + tone, label);
  const empty = (node, message) => node.append(el('p','empty',message));
  const para = (node, label, value) => { const p = el('p'); if(label) p.append(el('span','detail-label',label)); p.append(document.createTextNode(str(value))); node.append(p); };
  const section = (parent, title) => { const node=el('section','detail-section');node.append(el('h3','',title));parent.append(node);return node; };
  const statusBadge = a => a.review_blocked === true ? badge('评审待恢复','red') : waiting(a) ? badge('正常等待','blue') : blocked(a) ? badge('需关注','red') : badge(str(a.stage_label,'阶段待确认'),a.stage === 5 ? '' : 'gray');
  function renderFreshness() {
    const observed = date(snapshot.observed_at || snapshot.generated_at);
    const age = observed ? Math.max(0, (Date.now()-observed.valueOf())/60000) : null;
    const messages=[];
    const historical = currentView !== 'latest';
    text('freshness', historical ? '正在查看历史快照' : age === null ? '观测时间待确认' : age > 45 ? '观测数据已陈旧' : '最新观测已就绪');
    text('updated-at', observed ? '采集于 '+time(observed.valueOf())+' · '+Math.floor(age)+' 分钟前' : '');
    $('freshness-dot').style.background=historical?'var(--blue)':age===null||age>45?'var(--amber)':'var(--green)';
    if (historical) messages.push('当前为历史观测，所有指标与作者状态均对应所选时间。切回“最新观测”可查看最近状态。');
    else if (age>45 || publicationStatus.stale === true) messages.push('最近一次观测已超过45分钟，页面保留最后可用快照；这些状态不代表当前实时运行情况。');
    const failed = publicationStatus.ok === false || publicationStatus.success === false || ['failed','error','degraded','publish_failed','collection_failed'].includes(publicationStatus.status || publicationStatus.state) || Boolean(publicationStatus.last_error) || Boolean(publicationStatus.error_class);
    if(failed) messages.push('最近一次网站更新出现异常，正在展示已成功发布的数据。'+str(publicationStatus.message || publicationStatus.error_message,''));
    if(snapshot.publication?.lag_seconds>300) messages.push('本期发布延迟 '+Math.round(snapshot.publication.lag_seconds/60)+' 分钟。');
    $('notice').hidden=!messages.length;text('notice',messages.join(' '));
  }
  function renderKpis() {
    const m=snapshot.metrics||{}, authors=list(snapshot.authors), capacity=snapshot.capacity_detail?.reviewer_capacity||{};
    const cards=[['累计正式接受',m.cumulative_accepted_tasks,'道任务','累计 '+count(m.cumulative_accepted_versions)+' 个版本 · 含历史正式接受'],['当前选定版本',m.accepted_versions,'已接受','当前分配 '+count(m.assigned_versions)+' 个版本 · 与累计口径独立'],['作者观测',m.authors ?? authors.length,'位作者','运行 '+count(m.running_authors)+' · 正常等待 '+authors.filter(waiting).length+' · 调度阻塞 '+count(m.blocked_authors)],['评审中的版本',m.reviewing_versions,'个版本','首次排队 '+count(capacity.queued_selected_versions)+' · 证据齐备待终审 '+count(capacity.complete_batches_waiting_review)+' · 评审待恢复 '+count(m.review_blocked_versions)]];
    const root=clear('kpis');cards.forEach(([label,value,unit,note])=>{const card=el('article','kpi');card.append(el('div','kpi-label',label));const val=el('div','kpi-value',count(value));val.append(el('small','',unit));card.append(val,el('p','',note));root.append(card);});
  }
  function renderAuthors() {
    const authors=list(snapshot.authors), query=$('author-search').value.trim().toLowerCase(), phase=$('stage-filter').value, state=$('state-filter').value;
    const filtered=authors.filter(a=>(phase==='all'||str(a.stage_label,'阶段待确认')===phase)&&(state==='all'||state==='waiting'&&waiting(a)||state==='blocked'&&blocked(a)||state==='active'&&!waiting(a)&&!blocked(a))&&[a.role,a.title,a.summary,a.proposal_summary,a.latest_observed_action,a.activity_phase].filter(Boolean).join(' ').toLowerCase().includes(query));
    text('author-count',filtered.length+' / '+authors.length);const root=clear('author-grid');
    if(!filtered.length) return empty(root,authors.length?'没有匹配的作者，请尝试其他关键词或筛选条件。':'本期快照尚未提供作者记录。');
    filtered.forEach(a=>{const card=el('button','author-card');card.type='button';card.setAttribute('aria-label','查看 '+str(a.role)+' 的观测详情');const top=el('div','card-top');top.append(el('span','role',str(a.role)),statusBadge(a));card.append(top,el('h3','',str(a.title,'选题与数据探索')),el('p','card-summary',str(a.summary || a.proposal_summary,'尚未记录选题摘要')));const bottom=el('div','card-bottom');bottom.append(el('span','action',str(a.latest_observed_action || a.activity_phase || a.runtime,'活动待观察')),el('span','arrow','↗'));card.append(bottom);card.addEventListener('click',()=>showAuthor(a));root.append(card);});
  }
  function showAuthor(a) {
    const root=clear('author-detail');root.append(el('h2','detail-heading',str(a.title,'选题与数据探索')));const meta=el('div','detail-meta');meta.append(el('span','role',str(a.role)),statusBadge(a));if(a.current_commit)meta.append(badge('版本 '+str(a.current_commit).slice(0,12),'gray'));root.append(meta);
    let s=section(root,'选题思路');para(s,'',a.proposal_summary || a.summary);if(a.summary_source)para(s,'摘要来源',a.summary_source);
    s=section(root,'具体活动与阶段');para(s,'当前阶段',a.workflow_phase || a.stage_label);para(s,'最近动作',a.latest_observed_action);para(s,'动作时间',time(a.latest_action_at || a.last_activity));para(s,'运行观察',a.activity?.label || a.runtime);if(a.runtime_reason)para(s,'观察说明',a.runtime_reason);para(s,'下一步',a.next_step || a.wait?.next_action);const r=a.activity?.resources;if(r&&r.cpu_percent!==undefined)para(s,'资源观测','CPU '+count(r.cpu_percent)+'% · 进程 '+count(r.process_count)+'；仅代表采样时活动，不证明任务取得有效进展。');
    s=section(root,'等待与堵塞');para(s,'状态',waiting(a)?'正常评审或容量等待':blocked(a)?'存在需关注的堵塞':'未记录异常堵塞');para(s,'原因',a.review_blocker || a.expected_review_wait_reason || a.blocker || a.wait?.blocking_reason || '暂无具体原因记录');if(a.wait?.owner)para(s,'责任方',a.wait.owner);if(a.wait?.recovery_condition)para(s,'恢复条件',a.wait.recovery_condition);if(a.review_queue_wait)para(s,'排队时长',typeof a.review_queue_wait==='number'?Math.round(a.review_queue_wait/60)+' 分钟':a.review_queue_wait.label || ((a.review_queue_wait.elapsed_seconds ?? a.review_queue_wait.wait_seconds)!=null?Math.round((a.review_queue_wait.elapsed_seconds ?? a.review_queue_wait.wait_seconds)/60)+' 分钟':'未记录'));
    s=section(root,'当前版本的评审证据');const reviews=list(a.reviews);if(!reviews.length)para(s,'','当前快照未提供该作者的评审记录。');reviews.forEach(review=>{const box=el('div','detail-receipt');para(box,'结论',named(review.state));para(box,'版本',str(review.commit).slice(0,12));para(box,'评审员',review.role);para(box,'有效评测',count(review.valid_trials)+' / '+(Array.isArray(review.selected_job_ids)?review.selected_job_ids.length:'—'));para(box,'正式接受',review.accepted===true?'已正式接受':'尚未正式接受');s.append(box);});if(a.selftest?.status)para(s,'平台自测',named(a.selftest.status));if(a.feedback?.reason)para(s,a.feedback.scope==='current'?'当前反馈':'历史或未绑定版本反馈',a.feedback.reason);
    s=section(root,'接受后复盘与新选题');const accepted=list(a.acceptance_followup?.accepted_versions);if(!accepted.length)para(s,'','尚无已接受版本的后续记录。');accepted.forEach(v=>{para(s,'已接受',brief(v.task)+' · '+str(v.commit).slice(0,12));para(s,'经验贴',v.published===true?'已发布'+(v.comment_id?' · 评论 #'+v.comment_id:''):'尚未确认发布');});const ideas=list(a.acceptance_followup?.current_ideas);ideas.forEach(v=>para(s,'当前选题',str(v.title || v.idea_id)+' · '+named(v.state)));if(ideas.length)para(s,'观察边界','活动选题或候选登记不代表新任务已经交付。');
    $('author-dialog').showModal();document.body.classList.add('dialog-open');
  }
  function renderCapacity() {
    const c=snapshot.capacity_detail||{}, r=c.reviewer_capacity||{}, root=clear('capacity');
    [['评审会话',count(r.observed_active_sessions)+' / '+count(r.configured_roles),'活动 / 配置'],['评测执行',count(c.evaluation_workers?.active)+' / '+count(c.evaluator_parallel),'工作进程 / 上限'],['自测队列',count(c.queue_active)+' / '+count(c.selftest_workers),'活动 / 工作者'],['首次评审等待',count(r.queued_selected_versions),'版本 · 最长 '+(r.oldest_queue_wait_seconds==null?'未记录':Math.ceil(r.oldest_queue_wait_seconds/60)+' 分钟')]].forEach(([label,value,note])=>{const n=el('div','capacity-item');n.append(el('label','',label));const strong=el('strong','',value);strong.append(el('small','',note));n.append(strong);root.append(n);});
    const evalRoot=clear('evaluators'), evs=list(snapshot.evaluators);if(!evs.length)empty(evalRoot,'本期快照未提供评审员记录。');evs.forEach((e,i)=>{const card=el('article','evaluator-card'),head=el('div','evaluator-title');head.append(el('span','avatar',String(i+1).padStart(2,'0')),el('h3','',str(e.role)),badge(str(e.runtime,'状态待确认'),e.current?'':'gray'));card.append(head);const stats=el('div','evaluator-stats');[['已分配',e.assigned],['已启动',e.started],['当前接受',e.accepted]].forEach(([k,v])=>{const n=el('span','',k);n.append(el('b','',count(v)));stats.append(n);});card.append(stats,el('p','',e.live_review?.task?'当前审题 · '+brief(e.live_review.task):str(e.latest_action || e.runtime_reason,'暂无当前审题记录')));evalRoot.append(card);});
  }
  function renderFollowup() {
    const root=clear('followup-list'),authors=list(snapshot.authors).filter(a=>list(a.acceptance_followup?.accepted_versions).length);if(!authors.length)return empty(root,'本期尚无接受后复盘记录；正式接受与后续经验发布将分别展示。');authors.forEach(a=>{const card=el('article','followup-card');card.append(el('h3','',str(a.role)+' · 接受后的下一程'));const row=(label,value)=>{const n=el('div','followup-row');n.append(el('label','',label),el('p','',value));card.append(n);};list(a.acceptance_followup.accepted_versions).forEach(v=>{row('正式接受',brief(v.task)+' · '+str(v.commit).slice(0,8));row('经验复盘',v.published===true?'已发布'+(v.comment_id?' · 评论 #'+v.comment_id:'')+' · '+time(v.published_at):'尚未确认发布');});const ideas=list(a.acceptance_followup.current_ideas);row('当前选题',ideas.length?ideas.map(v=>str(v.title || v.idea_id)+'（'+named(v.state)+'）').join('；'):'未记录新选题');row('观察边界','新选题登记不等于已交付；旧接受版本独立保留。');root.append(card);});
  }
  function renderRepairs() {
    const issues=clear('issues');list(snapshot.issues).forEach(i=>issues.append(el('div','issue',str(i.title)+' · '+str(i.detail || i.scope,''))));const remediation=snapshot.remediation||{};text('repair-summary','工程整改核验 '+count(remediation.verified)+' / '+count(remediation.total)+' · 与科学接受独立');
    const root=clear('repairs-list'),bugs=list(snapshot.expansion_progress?.bugs);if(!bugs.length){empty(root,'本期未提供修复记录。');return;}bugs.slice().reverse().forEach(b=>{const d=el('details','repair-item'),summary=el('summary');summary.append(el('span','repair-id',str(b.id,'记录')),el('span','',str(b.summary || b.title,'工程修复')));d.append(summary,el('p','',str(b.status || b.detail,'状态尚未记录')));root.append(d);});
  }
  function render() {
    text('universe-name',str(snapshot.universe,'科学任务协作宇宙'));const phases=[...new Set(list(snapshot.authors).map(a=>str(a.stage_label,'阶段待确认')))];const old=$('stage-filter').value;$('stage-filter').replaceChildren(new Option('全部阶段','all'),...phases.map(p=>new Option(p,p)));if(phases.includes(old))$('stage-filter').value=old;
    renderFreshness();renderKpis();renderAuthors();renderCapacity();renderFollowup();renderRepairs();$('report-section').hidden=!snapshot.report_markdown;text('report-text',str(snapshot.report_markdown,''));
  }
  async function getJSON(path) { const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);return response.json(); }
  async function load(view='latest') {
    const id=++requestId;const button=$('refresh-button');button.disabled=true;
    try {
      let path='./data/latest.json';if(view!=='latest'){const entry=history.find(e=>String(e.id)===view);if(!entry)throw new Error('快照不存在');const url=new URL(entry.path,location.href),base=new URL('./data/',location.href);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||!url.pathname.endsWith('.json'))throw new Error('快照路径无效');path=url.href;}
      const results=await Promise.allSettled([getJSON(path),getJSON('./data/status.json')]);if(id!==requestId)return;if(results[0].status!=='fulfilled')throw results[0].reason;if(!results[0].value||typeof results[0].value!=='object'||Array.isArray(results[0].value))throw new Error('观测数据格式无效');snapshot=results[0].value;publicationStatus=results[1].status==='fulfilled'?results[1].value||{}:{};currentView=view;render();
    } catch(error) {if(id!==requestId)return;$('notice').hidden=false;text('notice','暂时无法读取观测数据（'+error.message+'）。'+(Object.keys(snapshot).length?'页面保留上次成功读取的快照。':'请稍后刷新；网站需要发布首份观测快照。'));text('freshness','数据连接异常');$('freshness-dot').style.background='var(--amber)';if(!Object.keys(snapshot).length){renderKpis();renderAuthors();renderCapacity();renderFollowup();renderRepairs();}}
    finally {if(id===requestId)button.disabled=false;}
  }
  async function loadHistory(){try{const data=await getJSON('./data/history.json');history=list(data.entries);const selected=$('snapshot-select').value;$('snapshot-select').replaceChildren(new Option('最新观测','latest'));history.forEach(e=>{if(e.id!==undefined&&typeof e.path==='string')$('snapshot-select').append(new Option(time(e.observed_at || e.generated_at)+' · '+String(e.id),String(e.id)));});if(history.some(e=>String(e.id)===selected))$('snapshot-select').value=selected;}catch{/* History is optional; current observation remains available. */}}
  $('author-search').addEventListener('input',renderAuthors);$('stage-filter').addEventListener('change',renderAuthors);$('state-filter').addEventListener('change',renderAuthors);$('snapshot-select').addEventListener('change',e=>load(e.target.value));$('refresh-button').addEventListener('click',()=>{ $('snapshot-select').value='latest';load('latest');loadHistory();});$('close-dialog').addEventListener('click',()=>$('author-dialog').close());$('author-dialog').addEventListener('close',()=>document.body.classList.remove('dialog-open'));$('author-dialog').addEventListener('click',e=>{if(e.target===$('author-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  load();loadHistory();setInterval(()=>{if(document.hidden)return;if(currentView==='latest')load();else renderFreshness();loadHistory();},60000);
})();
