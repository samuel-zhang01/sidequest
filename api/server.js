const http = require('node:http');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const port = Number(process.env.PORT || 8080);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stravaPath = process.env.STRAVA_ACTIVITIES_PATH || '/data/strava/activities.csv';
const defaultUserId = 'user-alex';

function json(response, status, body) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(body));
}
function bodyJson(request, limit = 100000) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > limit) reject(new Error('Request body is too large')); });
    request.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    request.on('error', reject);
  });
}
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const round = (value, places = 1) => Math.round(Number(value) * 10 ** places) / 10 ** places;
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2;
};
function haversine(first, second) {
  const radius = 6371000, radians = degrees => degrees * Math.PI / 180;
  const lat = radians(second.latitude-first.latitude), lng = radians(second.longitude-first.longitude);
  const a = Math.sin(lat/2)**2 + Math.cos(radians(first.latitude))*Math.cos(radians(second.latitude))*Math.sin(lng/2)**2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function parseCsv(input) {
  const rows=[]; let row=[], field='', quoted=false;
  for (let i=0;i<input.length;i++) {
    const c=input[i], next=input[i+1];
    if (c==='"') { if (quoted && next==='"') { field+='"'; i++; } else quoted=!quoted; }
    else if (c===',' && !quoted) { row.push(field); field=''; }
    else if ((c==='\n'||c==='\r') && !quoted) { if(c==='\r'&&next==='\n')i++; row.push(field); field=''; if(row.some(Boolean))rows.push(row); row=[]; }
    else field+=c;
  }
  if(field||row.length){row.push(field);rows.push(row);} return rows;
}
function column(headers, name, occurrence=0) {
  let count=0; for(let i=0;i<headers.length;i++) if(headers[i]===name && count++===occurrence)return i; return -1;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL, handle TEXT NOT NULL UNIQUE,
      initials VARCHAR(3) NOT NULL, accent TEXT NOT NULL, avatar_emoji TEXT NOT NULL,
      demo BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS run_observations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL, external_id TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
      distance_meters NUMERIC(12,2) NOT NULL, moving_seconds INTEGER NOT NULL,
      elapsed_seconds INTEGER, average_heart_rate NUMERIC(6,2), max_heart_rate NUMERIC(6,2),
      elevation_gain_meters NUMERIC(9,2), perceived_exertion NUMERIC(4,1),
      demo BOOLEAN NOT NULL DEFAULT FALSE, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source, external_id)
    );
    CREATE INDEX IF NOT EXISTS run_observations_user_time_idx ON run_observations(user_id, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS health_snapshots (
      id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state_label TEXT NOT NULL, confidence_label TEXT NOT NULL, confidence_score INTEGER NOT NULL,
      insight TEXT NOT NULL, interpretation TEXT NOT NULL, evidence JSONB NOT NULL,
      data_gaps JSONB NOT NULL, engine_mode TEXT NOT NULL, trigger_type TEXT NOT NULL DEFAULT 'analysis',
      trigger_ref TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS interventions (
      id TEXT PRIMARY KEY, snapshot_id BIGINT NOT NULL REFERENCES health_snapshots(id),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,
      question TEXT NOT NULL, hypothesis TEXT NOT NULL, instructions TEXT NOT NULL,
      target_distance_meters INTEGER NOT NULL, success_criteria JSONB NOT NULL,
      measures_to_collect JSONB NOT NULL, safety_stop TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed', generated_by TEXT NOT NULL,
      due_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS peer_notifications (
      id TEXT PRIMARY KEY, intervention_id TEXT NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id), recipient_user_id TEXT NOT NULL REFERENCES users(id),
      message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'delivered', demo BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS intervention_results (
      id TEXT PRIMARY KEY, intervention_id TEXT NOT NULL UNIQUE REFERENCES interventions(id) ON DELETE CASCADE,
      actual_distance_meters INTEGER NOT NULL, moving_seconds INTEGER NOT NULL,
      perceived_exertion NUMERIC(4,1), symptoms JSONB NOT NULL, outcome_label TEXT NOT NULL,
      outcome_summary TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS gps_run_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active', distance_meters NUMERIC(12,2) NOT NULL DEFAULT 0,
      moving_seconds INTEGER NOT NULL DEFAULT 0, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ended_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS gps_run_samples (
      id BIGSERIAL PRIMARY KEY, session_id TEXT NOT NULL REFERENCES gps_run_sessions(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
      accuracy_meters DOUBLE PRECISION, recorded_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gps_run_samples_session_time_idx ON gps_run_samples(session_id, recorded_at DESC);
    CREATE TABLE IF NOT EXISTS engine_runs (
      id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL,
      mode TEXT NOT NULL, input_context JSONB NOT NULL, result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO users(id,display_name,handle,initials,accent,avatar_emoji,demo) VALUES
      ('user-alex','Alex Morgan','@alexruns','AM','#d7ff55','🏃',FALSE),
      ('user-mia','Mia Chen','@miacheers','MC','#ff7a66','📣',TRUE),
      ('user-noah','Noah Williams','@noahnudges','NW','#67d7ff','⚡',TRUE),
      ('user-priya','Priya Shah','@priyapushes','PS','#b99cff','🔥',TRUE)
    ON CONFLICT(id) DO NOTHING
  `);
}

async function importStrava() {
  if(!fs.existsSync(stravaPath))return {available:false, imported:0};
  const rows=parseCsv(fs.readFileSync(stravaPath,'utf8')); if(rows.length<2)return {available:true,imported:0};
  const h=rows[0], c={id:column(h,'Activity ID'),date:column(h,'Activity Date'),type:column(h,'Activity Type'),
    moving:column(h,'Moving Time'),elapsed:column(h,'Elapsed Time',1),distance:column(h,'Distance',1),
    avgHr:column(h,'Average Heart Rate'),maxHr:column(h,'Max Heart Rate',1),elevation:column(h,'Elevation Gain'),rpe:column(h,'Perceived Exertion')};
  let imported=0; const client=await pool.connect();
  try {
    await client.query('BEGIN');
    for(const row of rows.slice(1)) {
      if(!/run/i.test(row[c.type]||''))continue;
      const date=new Date(row[c.date]), distance=Number(row[c.distance]), moving=Math.round(Number(row[c.moving]));
      if(!Number.isFinite(date.getTime())||distance<100||moving<60)continue;
      const external=String(row[c.id]||`${date.toISOString()}-${distance}`);
      const result=await client.query(`
        INSERT INTO run_observations(id,user_id,source,external_id,occurred_at,distance_meters,moving_seconds,
          elapsed_seconds,average_heart_rate,max_heart_rate,elevation_gain_meters,perceived_exertion,demo)
        VALUES($1,$2,'strava-export',$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)
        ON CONFLICT(source,external_id) DO NOTHING
      `,[`strava-${external}`,defaultUserId,external,date.toISOString(),distance,moving,Number(row[c.elapsed])||null,
        Number(row[c.avgHr])||null,Number(row[c.maxHr])||null,Number(row[c.elevation])||null,Number(row[c.rpe])||null]);
      imported+=result.rowCount;
    }
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  return {available:true,imported};
}
async function seedFallback() {
  const count=await pool.query('SELECT COUNT(*)::int AS count FROM run_observations WHERE user_id=$1',[defaultUserId]);
  if(count.rows[0].count)return;
  const samples=[[8,49,151,4],[6.4,40,148,null],[7.2,45,150,5],[5.8,36,146,null],[6.8,43,149,null],[5.5,35,145,4],[7,45,151,null],[5.2,34,147,null]];
  for(let i=0;i<samples.length;i++) {
    const [km,minutes,hr,rpe]=samples[i];
    await pool.query(`INSERT INTO run_observations(id,user_id,source,external_id,occurred_at,distance_meters,moving_seconds,average_heart_rate,perceived_exertion,demo)
      VALUES($1,$2,'seeded-fallback',$3,NOW()-($4||' days')::interval,$5,$6,$7,$8,TRUE) ON CONFLICT(source,external_id) DO NOTHING`,
      [`fallback-${i}`,defaultUserId,`fallback-${i}`,String(i*3+2),km*1000,minutes*60,hr,rpe]);
  }
}

async function observationContext(userId) {
  const [summary, observations]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS run_count,MIN(occurred_at) AS first_run_at,MAX(occurred_at) AS latest_run_at,
      COUNT(average_heart_rate)::int AS heart_rate_runs,COUNT(perceived_exertion)::int AS rpe_runs,
      COUNT(*) FILTER(WHERE source='strava-export')::int AS strava_runs,
      COUNT(*) FILTER(WHERE source='gps-live')::int AS gps_runs FROM run_observations WHERE user_id=$1`,[userId]),
    pool.query(`SELECT id,source,occurred_at,ROUND(distance_meters)::int AS distance_meters,moving_seconds,
      average_heart_rate,max_heart_rate,elevation_gain_meters,perceived_exertion,demo
      FROM run_observations WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT 12`,[userId])
  ]);
  return {summary:summary.rows[0],observations:observations.rows};
}
function computeSnapshot(context) {
  const runs=context.observations.map(row=>({...row,distance_meters:Number(row.distance_meters),moving_seconds:Number(row.moving_seconds),
    average_heart_rate:row.average_heart_rate==null?null:Number(row.average_heart_rate),perceived_exertion:row.perceived_exertion==null?null:Number(row.perceived_exertion),
    pace:Number(row.moving_seconds)/(Number(row.distance_meters)/1000)})).filter(row=>Number.isFinite(row.pace));
  const recent=runs.slice(0,4), baseline=runs.slice(4,8);
  const recentKm=recent.reduce((sum,row)=>sum+row.distance_meters,0)/1000, baselineKm=baseline.reduce((sum,row)=>sum+row.distance_meters,0)/1000;
  const recentPace=median(recent.map(row=>row.pace)), baselinePace=median(baseline.map(row=>row.pace));
  const recentHr=median(recent.map(row=>row.average_heart_rate).filter(Boolean)), baselineHr=median(baseline.map(row=>row.average_heart_rate).filter(Boolean));
  const loadChange=baselineKm?((recentKm-baselineKm)/baselineKm)*100:null, paceChange=baselinePace?((recentPace-baselinePace)/baselinePace)*100:null;
  const hrChange=recentHr&&baselineHr?recentHr-baselineHr:null;
  const freshness=context.summary.latest_run_at?Math.floor((Date.now()-new Date(context.summary.latest_run_at))/86400000):null;
  let confidence=15;if(runs.length>=8)confidence+=30;if(recent.filter(r=>r.average_heart_rate).length>=3)confidence+=20;
  if(recent.filter(r=>r.perceived_exertion).length>=2)confidence+=10;if(freshness!=null&&freshness<=30)confidence+=25;confidence=clamp(confidence,0,100);
  let label='More running evidence needed';
  if(freshness!=null&&freshness>30)label='Historical baseline; new run needed';
  else if(loadChange!=null&&loadChange>35)label='Recent running load has risen';
  else if(paceChange!=null&&paceChange>8&&hrChange!=null&&hrChange>5)label='Recent runs required more effort';
  else if(runs.length>=8)label='Recent running response is broadly consistent';
  const gaps=[];if(Number(context.summary.rpe_runs)<Math.max(4,Number(context.summary.run_count)*.25))gaps.push('Perceived effort after each run (0–10)');
  gaps.push('Pain, dizziness and unusual breathlessness check','Sleep or resting-heart-rate context');
  const loadText=loadChange==null?'has no comparable baseline yet':`${loadChange>=0?'is up':'is down'} ${Math.abs(round(loadChange))}%`;
  return {stateLabel:label,confidenceLabel:confidence>=75?'good coverage':confidence>=50?'partial coverage':'limited coverage',confidenceScore:confidence,
    insight:`The latest four runs total ${round(recentKm)} km and ${loadText} versus the previous four. Median moving pace is ${recentPace?round(recentPace/60,2)+' min/km':'not available'}.`,
    interpretation:'This describes running load and response signals only. It cannot diagnose a health condition or establish that someone is safe to exercise.',
    evidence:{recentRunCount:recent.length,baselineRunCount:baseline.length,recentDistanceKm:round(recentKm),baselineDistanceKm:round(baselineKm),
      loadChangePct:loadChange==null?null:round(loadChange),recentPaceSecondsPerKm:recentPace==null?null:Math.round(recentPace),
      baselinePaceSecondsPerKm:baselinePace==null?null:Math.round(baselinePace),recentAverageHeartRate:recentHr==null?null:Math.round(recentHr),
      heartRateChange:hrChange==null?null:round(hrChange),freshnessDays:freshness},dataGaps:gaps};
}
async function analyse(userId,triggerType='analysis',triggerRef=null,postResult=null) {
  const context=await observationContext(userId), snapshot=computeSnapshot(context);
  if(postResult){snapshot.stateLabel=postResult.outcome_label==='supported'?'The signal run met its measurement target':postResult.outcome_label==='stop-signal'?'A stop signal was recorded':'The signal run was inconclusive';
    snapshot.insight=postResult.outcome_summary;snapshot.interpretation='This single result updates the running evidence, but it does not diagnose health or prove causation.';
    snapshot.confidenceScore=clamp(snapshot.confidenceScore+5,0,100);snapshot.confidenceLabel=snapshot.confidenceScore>=75?'good coverage':'partial coverage';}
  const result=await pool.query(`INSERT INTO health_snapshots(user_id,state_label,confidence_label,confidence_score,insight,interpretation,evidence,data_gaps,engine_mode,trigger_type,trigger_ref)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'deterministic-poc',$9,$10) RETURNING *`,
    [userId,snapshot.stateLabel,snapshot.confidenceLabel,snapshot.confidenceScore,snapshot.insight,snapshot.interpretation,snapshot.evidence,snapshot.dataGaps,triggerType,triggerRef]);
  await pool.query(`INSERT INTO engine_runs(user_id,purpose,mode,input_context,result) VALUES($1,'running-state','deterministic-poc',$2,$3)`,
    [userId,{observationCount:context.summary.run_count,latestRunAt:context.summary.latest_run_at},snapshot]);
  return result.rows[0];
}
async function generateIntervention(userId,force=false) {
  if(!force){const active=await pool.query("SELECT * FROM interventions WHERE user_id=$1 AND status IN('proposed','accepted') ORDER BY created_at DESC LIMIT 1",[userId]);if(active.rows[0])return active.rows[0];}
  let snapshot=await pool.query('SELECT * FROM health_snapshots WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]);
  if(!snapshot.rows[0]){await analyse(userId);snapshot=await pool.query('SELECT * FROM health_snapshots WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]);}
  const runResult=await pool.query('SELECT distance_meters FROM run_observations WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT 4',[userId]);
  const typical=median(runResult.rows.map(row=>Number(row.distance_meters)))||4000,target=Math.round(clamp(typical+1000,2000,15000)/100)*100;
  const item={id:`intervention-${randomUUID()}`,title:'The +1 km signal run',question:'Can one controlled kilometre add useful evidence without a large jump in effort?',
    hypothesis:'If the extra kilometre is completed at conversational effort, with no warning symptoms and a similar pace response, current distance tolerance is consistent with the recent baseline.',
    instructions:`On the next usual run, extend the normal distance by up to 1 km, aiming for ${round(target/1000)} km total. Keep the effort conversational; this is a measurement task, not a race.`,target,
    criteria:[`Reach about ${round(target/1000)} km without racing`,'Record perceived effort at 5/10 or below','No pain, chest discomfort, dizziness or unusual breathlessness','Review pace and heart-rate response against the recent baseline'],
    measures:['GPS distance','moving time and pace','heart rate when available','perceived effort','warning symptoms'],
    stop:'Stop rather than complete the challenge for pain, chest discomfort, dizziness, faintness or unusual breathlessness. Seek appropriate medical care when symptoms warrant it.'};
  const result=await pool.query(`INSERT INTO interventions(id,snapshot_id,user_id,title,question,hypothesis,instructions,target_distance_meters,success_criteria,measures_to_collect,safety_stop,generated_by,due_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'deterministic-poc',NOW()+INTERVAL '7 days') RETURNING *`,
    [item.id,snapshot.rows[0].id,userId,item.title,item.question,item.hypothesis,item.instructions,item.target,item.criteria,item.measures,item.stop]);
  await pool.query(`INSERT INTO engine_runs(user_id,purpose,mode,input_context,result) VALUES($1,'intervention','deterministic-poc',$2,$3)`,
    [userId,{snapshotId:snapshot.rows[0].id,typicalDistanceMeters:typical},item]);
  return result.rows[0];
}
async function ensureInitialLoop(){const snapshots=await pool.query('SELECT COUNT(*)::int AS count FROM health_snapshots WHERE user_id=$1',[defaultUserId]);if(!snapshots.rows[0].count)await analyse(defaultUserId);
  const intervention=await generateIntervention(defaultUserId),notifications=await pool.query('SELECT COUNT(*)::int AS count FROM peer_notifications WHERE intervention_id=$1',[intervention.id]);
  if(!notifications.rows[0].count)await pool.query(`INSERT INTO peer_notifications(id,intervention_id,sender_user_id,recipient_user_id,message,demo)
    VALUES($1,$2,'user-mia',$3,'I am holding you to the +1 km — conversational pace, no heroics. 📣',TRUE)`,[`notification-${randomUUID()}`,intervention.id,defaultUserId]);}

async function getLoop(userId){const context=await observationContext(userId);const [user,snapshot,interventionResult,friends]=await Promise.all([
  pool.query('SELECT id,display_name,handle,initials,accent,avatar_emoji FROM users WHERE id=$1',[userId]),
  pool.query('SELECT * FROM health_snapshots WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]),
  pool.query('SELECT * FROM interventions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]),
  pool.query('SELECT id,display_name,handle,initials,accent,avatar_emoji FROM users WHERE id<>$1 ORDER BY display_name LIMIT 6',[userId])]);
  if(!user.rows[0])return null;const intervention=interventionResult.rows[0]||null;let notifications=[],result=null,postSnapshot=null;
  if(intervention){const parts=await Promise.all([pool.query(`SELECT n.*,u.display_name AS sender_name,u.handle AS sender_handle,u.initials AS sender_initials,u.accent AS sender_accent,u.avatar_emoji
      FROM peer_notifications n JOIN users u ON u.id=n.sender_user_id WHERE n.intervention_id=$1 ORDER BY n.created_at DESC`,[intervention.id]),
    pool.query('SELECT * FROM intervention_results WHERE intervention_id=$1 LIMIT 1',[intervention.id]),
    pool.query("SELECT * FROM health_snapshots WHERE trigger_type='post-intervention' AND trigger_ref=$1 ORDER BY created_at DESC LIMIT 1",[intervention.id])]);
    notifications=parts[0].rows;result=parts[1].rows[0]||null;postSnapshot=parts[2].rows[0]||null;}
  const summary=context.summary,sourceLabel=Number(summary.strava_runs)>0?'Strava data export':Number(summary.gps_runs)>0?'Live GPS':'Seeded fallback';
  return {ok:true,user:user.rows[0],source:{label:sourceLabel,adapter:Number(summary.strava_runs)>0?'strava-export-v1':'neutral-observation-v1',runCount:summary.run_count,
    firstRunAt:summary.first_run_at,latestRunAt:summary.latest_run_at,heartRateRuns:summary.heart_rate_runs,rpeRuns:summary.rpe_runs,gpsRuns:summary.gps_runs,
    freshnessDays:summary.latest_run_at?Math.floor((Date.now()-new Date(summary.latest_run_at))/86400000):null,grain:'One aggregate record per run; raw export files remain server-side'},
    observations:context.observations,snapshot:snapshot.rows[0]||null,intervention,notifications,result,postSnapshot,friends:friends.rows,
    loop:[{key:'observe',label:'Observe',complete:Number(summary.run_count)>0},{key:'estimate',label:'Estimate',complete:Boolean(snapshot.rows[0])},{key:'ask',label:'Ask',complete:Boolean(intervention)},
      {key:'intervene',label:'Intervene',complete:Boolean(intervention&&intervention.status!=='proposed')},{key:'rally',label:'Rally',complete:notifications.length>0},{key:'reassess',label:'Reassess',complete:Boolean(postSnapshot)}],
    engine:{mode:'deterministic-poc',provider:null,contract:'neutral observations → structured insight/intervention'},disclaimer:'Running signals are not a medical diagnosis and do not establish fitness to exercise.'};}

function outcomeFor(intervention,body){const distance=Math.round(Number(body.actualDistanceKm)*1000),seconds=Math.round(Number(body.movingMinutes)*60),rpe=Number(body.perceivedExertion),symptoms=Array.isArray(body.symptoms)?body.symptoms.filter(Boolean).slice(0,8):[];
  if(!Number.isFinite(distance)||distance<100||!Number.isFinite(seconds)||seconds<60)throw new Error('Enter a valid distance and moving time');if(!Number.isFinite(rpe)||rpe<0||rpe>10)throw new Error('Perceived effort must be from 0 to 10');
  let label='inconclusive',summary=`The run recorded ${round(distance/1000)} km at effort ${rpe}/10. More evidence is needed before changing the running baseline.`;
  if(symptoms.length){label='stop-signal';summary=`The run recorded a warning symptom (${symptoms.join(', ')}). The peer challenge is closed; do not use the app to push through symptoms.`;}
  else if(distance>=Number(intervention.target_distance_meters)*.95&&rpe<=5){label='supported';summary=`The ${round(distance/1000)} km signal run met the distance target at ${rpe}/10 effort with no warning symptoms reported.`;}
  return {distance,seconds,rpe,symptoms,label,summary};}

async function handler(request,response){const url=new URL(request.url,'http://api.internal'),path=url.pathname;
  try{
    if(request.method==='GET'&&path==='/health'){await pool.query('SELECT 1');response.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return response.end('ok\n');}
    if(request.method==='GET'&&path==='/api/status'){await pool.query('SELECT 1');return json(response,200,{ok:true,service:'sidequest-feedback-api',database:'connected',sourceAdapter:fs.existsSync(stravaPath)?'strava-export-v1':'neutral-observation-v1',generationMode:'deterministic-poc',modelProvider:null,diagnosticClaims:false});}
    if(request.method==='GET'&&path==='/api/feedback-loop'){const loop=await getLoop(url.searchParams.get('userId')||defaultUserId);return loop?json(response,200,loop):json(response,404,{error:'User not found'});}
    if(request.method==='POST'&&path==='/api/feedback-loop/analyse'){const body=await bodyJson(request),snapshot=await analyse(body.userId||defaultUserId);return json(response,201,{ok:true,snapshot,engine:{mode:'deterministic-poc',provider:null}});}
    if(request.method==='POST'&&path==='/api/feedback-loop/interventions'){const body=await bodyJson(request),intervention=await generateIntervention(body.userId||defaultUserId,Boolean(body.force));return json(response,201,{ok:true,intervention});}
    if(request.method==='POST'&&path==='/api/gps-runs/start'){const body=await bodyJson(request),id=`gps-${randomUUID()}`,result=await pool.query('INSERT INTO gps_run_sessions(id,user_id) VALUES($1,$2) RETURNING *',[id,body.userId||defaultUserId]);return json(response,201,{ok:true,session:result.rows[0]});}
    const sample=path.match(/^\/api\/gps-runs\/([^/]+)\/samples$/);
    if(request.method==='POST'&&sample){const body=await bodyJson(request),latitude=Number(body.latitude),longitude=Number(body.longitude),accuracy=body.accuracy==null?null:Number(body.accuracy),recordedAt=new Date(body.recordedAt||Date.now());
      if(!Number.isFinite(latitude)||latitude < -90||latitude > 90||!Number.isFinite(longitude)||longitude < -180||longitude > 180)return json(response,400,{error:'Invalid coordinates'});
      if(!Number.isFinite(recordedAt.getTime())||Math.abs(Date.now()-recordedAt.getTime())>300000)return json(response,400,{error:'GPS sample must be fresh'});
      const session=await pool.query("SELECT * FROM gps_run_sessions WHERE id=$1 AND status='active'",[sample[1]]);if(!session.rows[0])return json(response,404,{error:'Active GPS run not found'});
      const previous=await pool.query('SELECT latitude,longitude,recorded_at FROM gps_run_samples WHERE session_id=$1 ORDER BY recorded_at DESC LIMIT 1',[sample[1]]);let added=0,seconds=0;
      if(previous.rows[0]){seconds=(recordedAt-new Date(previous.rows[0].recorded_at))/1000;const distance=haversine({latitude:Number(previous.rows[0].latitude),longitude:Number(previous.rows[0].longitude)},{latitude,longitude}),speed=seconds>0?distance/seconds:Infinity;
        if(seconds>0&&seconds<=120&&speed<=12&&distance<=600&&(accuracy==null||accuracy<=100))added=distance;else seconds=0;}
      await pool.query('INSERT INTO gps_run_samples(session_id,latitude,longitude,accuracy_meters,recorded_at) VALUES($1,$2,$3,$4,$5)',[sample[1],latitude,longitude,accuracy,recordedAt.toISOString()]);
      const updated=await pool.query('UPDATE gps_run_sessions SET distance_meters=distance_meters+$2,moving_seconds=moving_seconds+$3 WHERE id=$1 RETURNING *',[sample[1],added,Math.round(seconds)]),s=updated.rows[0];
      const pace=Number(s.distance_meters)>=100?Number(s.moving_seconds)/(Number(s.distance_meters)/1000):null;return json(response,201,{ok:true,session:s,acceptedDistanceMeters:round(added),paceSecondsPerKm:pace&&Math.round(pace)});}
    const finish=path.match(/^\/api\/gps-runs\/([^/]+)\/finish$/);
    if(request.method==='POST'&&finish){const body=await bodyJson(request),sessionResult=await pool.query("UPDATE gps_run_sessions SET status='complete',ended_at=NOW() WHERE id=$1 AND status='active' RETURNING *",[finish[1]]),session=sessionResult.rows[0];
      if(!session)return json(response,404,{error:'Active GPS run not found'});if(Number(session.distance_meters)<20||Number(session.moving_seconds)<10)return json(response,400,{error:'Not enough accepted GPS movement to create a run observation'});
      const rpe=Number(body.perceivedExertion),observation=await pool.query(`INSERT INTO run_observations(id,user_id,source,external_id,occurred_at,distance_meters,moving_seconds,perceived_exertion,demo)
        VALUES($1,$2,'gps-live',$3,$4,$5,$6,$7,FALSE) ON CONFLICT(source,external_id) DO UPDATE SET perceived_exertion=EXCLUDED.perceived_exertion RETURNING *`,
        [`observation-${session.id}`,session.user_id,session.id,session.started_at,session.distance_meters,session.moving_seconds,Number.isFinite(rpe)&&rpe>=0&&rpe<=10?rpe:null]);return json(response,201,{ok:true,observation:observation.rows[0]});}
    const share=path.match(/^\/api\/interventions\/([^/]+)\/share$/);
    if(request.method==='POST'&&share){const body=await bodyJson(request),senderId=String(body.senderUserId||''),sender=await pool.query('SELECT display_name FROM users WHERE id=$1',[senderId]);if(!sender.rows[0])return json(response,400,{error:'Friend not found'});
      const message=String(body.message||`${sender.rows[0].display_name} challenged you to close the loop.`).trim().slice(0,180),result=await pool.query(`INSERT INTO peer_notifications(id,intervention_id,sender_user_id,recipient_user_id,message)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[`notification-${randomUUID()}`,share[1],senderId,body.userId||defaultUserId,message]);return json(response,201,{ok:true,notification:result.rows[0]});}
    const accept=path.match(/^\/api\/interventions\/([^/]+)\/accept$/);
    if(request.method==='POST'&&accept){const result=await pool.query("UPDATE interventions SET status='accepted' WHERE id=$1 AND status='proposed' RETURNING *",[accept[1]]);return result.rows[0]?json(response,200,{ok:true,intervention:result.rows[0]}):json(response,409,{error:'Intervention is not awaiting acceptance'});}
    const resultMatch=path.match(/^\/api\/interventions\/([^/]+)\/result$/);
    if(request.method==='POST'&&resultMatch){const body=await bodyJson(request),interventionResult=await pool.query('SELECT * FROM interventions WHERE id=$1',[resultMatch[1]]);if(!interventionResult.rows[0])return json(response,404,{error:'Intervention not found'});const outcome=outcomeFor(interventionResult.rows[0],body);
      const result=await pool.query(`INSERT INTO intervention_results(id,intervention_id,actual_distance_meters,moving_seconds,perceived_exertion,symptoms,outcome_label,outcome_summary)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(intervention_id) DO UPDATE SET actual_distance_meters=EXCLUDED.actual_distance_meters,moving_seconds=EXCLUDED.moving_seconds,
        perceived_exertion=EXCLUDED.perceived_exertion,symptoms=EXCLUDED.symptoms,outcome_label=EXCLUDED.outcome_label,outcome_summary=EXCLUDED.outcome_summary,created_at=NOW() RETURNING *`,
        [`result-${randomUUID()}`,resultMatch[1],outcome.distance,outcome.seconds,outcome.rpe,outcome.symptoms,outcome.label,outcome.summary]);await pool.query("UPDATE interventions SET status='completed' WHERE id=$1",[resultMatch[1]]);return json(response,201,{ok:true,result:result.rows[0]});}
    const reassess=path.match(/^\/api\/interventions\/([^/]+)\/reassess$/);
    if(request.method==='POST'&&reassess){const intervention=await pool.query('SELECT * FROM interventions WHERE id=$1',[reassess[1]]),result=await pool.query('SELECT * FROM intervention_results WHERE intervention_id=$1',[reassess[1]]);if(!intervention.rows[0]||!result.rows[0])return json(response,409,{error:'Record an outcome before reassessing'});
      const snapshot=await analyse(intervention.rows[0].user_id,'post-intervention',reassess[1],result.rows[0]);await pool.query("UPDATE interventions SET status='assessed' WHERE id=$1",[reassess[1]]);return json(response,201,{ok:true,snapshot});}
    return json(response,404,{error:'Route not found'});
  }catch(error){console.error(error);return json(response,/valid|effort|fresh|coordinates/i.test(error.message)?400:500,{error:error.message||'Unexpected server error'});}}

async function start(){await ensureSchema();const source=await importStrava();await seedFallback();await ensureInitialLoop();http.createServer(handler).listen(port,'0.0.0.0',()=>console.log(`SideQuest feedback API listening on ${port}; Strava ${source.available?'available':'unavailable'}, ${source.imported} new runs`));}
start().catch(error=>{console.error('Failed to start API',error);process.exit(1);});
