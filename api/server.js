const http = require('node:http');
const fs = require('node:fs');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { WebSocket, WebSocketServer } = require('ws');
const { runAgentGodoy } = require('./agent/godoy');
const { ContextEntryInputSchema, ChallengeUpdateSchema, PledgeInputSchema } = require('./agent/contracts');

const port = Number(process.env.PORT || 8080);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stravaPath = process.env.STRAVA_ACTIVITIES_PATH || '/data/strava/activities.csv';
const defaultUserId = 'user-alex';

function json(response, status, body, headers = {}) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
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
const sessionCookie = 'sidequest_session';
const streamChannels = new Map();
const hashToken = token => createHash('sha256').update(token).digest('hex');
const publicUser = user => user && ({id:user.id,displayName:user.display_name,handle:user.handle,initials:user.initials,accent:user.accent,avatarEmoji:user.avatar_emoji});
function cookies(request) {
  return String(request.headers.cookie||'').split(';').reduce((result,pair)=>{const split=pair.indexOf('=');if(split<0)return result;result[decodeURIComponent(pair.slice(0,split).trim())]=decodeURIComponent(pair.slice(split+1).trim());return result;},{});
}
async function requestUser(request) {
  const token=cookies(request)[sessionCookie];
  if(!token)return null;
  const result=await pool.query(`SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>NOW()`,[hashToken(token)]);
  return result.rows[0]||null;
}
function cookieHeader(request,token,maxAge=2592000) {
  const secure=String(request.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https'||request.headers.host==='genesis.hiddenlayers.co.uk';
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
async function createSession(request,userId) {
  const token=randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')`,[hashToken(token),userId]);
  return cookieHeader(request,token);
}
function getStreamChannel(streamId) {
  if(!streamChannels.has(streamId))streamChannels.set(streamId,{broadcaster:null,viewers:new Set(),chunks:[],cachedBytes:0});
  return streamChannels.get(streamId);
}
function streamSend(socket,payload) {
  if(socket?.readyState===WebSocket.OPEN)socket.send(typeof payload==='string'?payload:JSON.stringify(payload));
}
function streamBroadcast(channel,payload) {
  for(const viewer of channel.viewers)streamSend(viewer,payload);
  streamSend(channel.broadcaster,payload);
}
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
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx ON user_sessions(expires_at);
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
    ALTER TABLE interventions ADD COLUMN IF NOT EXISTS challenge_description TEXT NOT NULL DEFAULT 'Complete the challenge and record the result.';
    ALTER TABLE interventions ADD COLUMN IF NOT EXISTS funding_target_minor INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE interventions ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'GBP';
    ALTER TABLE interventions ADD COLUMN IF NOT EXISTS settlement_rule TEXT NOT NULL DEFAULT 'Completion requires a recorded outcome; a safety stop is responsible completion.';
    ALTER TABLE interventions ADD COLUMN IF NOT EXISTS editable_fields JSONB NOT NULL DEFAULT '["title","description","dueAt","stake"]'::jsonb;
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
    CREATE TABLE IF NOT EXISTS live_map_cheers (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES gps_run_sessions(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id), emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS live_map_cheers_session_time_idx ON live_map_cheers(session_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS live_streams (
      id TEXT PRIMARY KEY, broadcaster_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, sponsor_name TEXT NOT NULL, product_name TEXT NOT NULL,
      product_url TEXT, status TEXT NOT NULL DEFAULT 'live', peak_viewers INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ended_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS live_streams_status_time_idx ON live_streams(status,started_at DESC);
    CREATE TABLE IF NOT EXISTS live_stream_cheers (
      id TEXT PRIMARY KEY, stream_id TEXT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS live_stream_cheers_stream_time_idx ON live_stream_cheers(stream_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS engine_runs (
      id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL,
      mode TEXT NOT NULL, input_context JSONB NOT NULL, result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS person_context_entries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL, label TEXT NOT NULL, value TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS person_context_entries_user_time_idx ON person_context_entries(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS agent_assessments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      output JSONB NOT NULL, engine_mode TEXT NOT NULL, provider TEXT, model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS agent_assessments_user_time_idx ON agent_assessments(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS challenge_pledges (
      id TEXT PRIMARY KEY, intervention_id TEXT NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
      contributor_name TEXT NOT NULL, contributor_kind TEXT NOT NULL,
      amount_minor INTEGER NOT NULL, currency VARCHAR(3) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pledged', demo BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS challenge_pledges_intervention_time_idx ON challenge_pledges(intervention_id,created_at DESC);
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
    [userId,snapshot.stateLabel,snapshot.confidenceLabel,snapshot.confidenceScore,snapshot.insight,snapshot.interpretation,snapshot.evidence,JSON.stringify(snapshot.dataGaps),triggerType,triggerRef]);
  await pool.query(`INSERT INTO engine_runs(user_id,purpose,mode,input_context,result) VALUES($1,'running-state','deterministic-poc',$2,$3)`,
    [userId,{observationCount:context.summary.run_count,latestRunAt:context.summary.latest_run_at},snapshot]);
  return result.rows[0];
}
async function runAndPersistGodoy(userId,{allowModel=true}={}) {
  const [context,additionalContext]=await Promise.all([
    observationContext(userId),
    pool.query('SELECT id,category,label,value,created_at FROM person_context_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40',[userId])
  ]),snapshot=computeSnapshot(context),agent=await runAgentGodoy({context,snapshot,additionalContext:additionalContext.rows},{allowModel});
  const id=`assessment-${randomUUID()}`;
  const stored=await pool.query(`INSERT INTO agent_assessments(id,user_id,output,engine_mode,provider,model)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[id,userId,agent.result,agent.mode,agent.provider,agent.model]);
  await pool.query(`INSERT INTO engine_runs(user_id,purpose,mode,input_context,result) VALUES($1,'agent-godoy',$2,$3,$4)`,
    [userId,agent.mode,{observationCount:context.summary.run_count,contextEntryCount:additionalContext.rows.length,rawCoordinatesShared:false},agent.result]);
  return stored.rows[0];
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
    [item.id,snapshot.rows[0].id,userId,item.title,item.question,item.hypothesis,item.instructions,item.target,JSON.stringify(item.criteria),JSON.stringify(item.measures),item.stop]);
  await pool.query(`INSERT INTO engine_runs(user_id,purpose,mode,input_context,result) VALUES($1,'intervention','deterministic-poc',$2,$3)`,
    [userId,{snapshotId:snapshot.rows[0].id,typicalDistanceMeters:typical},item]);
  return result.rows[0];
}
async function ensureInitialLoop(){const snapshots=await pool.query('SELECT COUNT(*)::int AS count FROM health_snapshots WHERE user_id=$1',[defaultUserId]);if(!snapshots.rows[0].count)await analyse(defaultUserId);
  const assessments=await pool.query('SELECT COUNT(*)::int AS count FROM agent_assessments WHERE user_id=$1',[defaultUserId]);if(!assessments.rows[0].count)await runAndPersistGodoy(defaultUserId,{allowModel:false});
  const intervention=await generateIntervention(defaultUserId),notifications=await pool.query('SELECT COUNT(*)::int AS count FROM peer_notifications WHERE intervention_id=$1',[intervention.id]);
  if(!notifications.rows[0].count)await pool.query(`INSERT INTO peer_notifications(id,intervention_id,sender_user_id,recipient_user_id,message,demo)
    VALUES($1,$2,'user-mia',$3,'I am holding you to the +1 km — conversational pace, no heroics. 📣',TRUE)`,[`notification-${randomUUID()}`,intervention.id,defaultUserId]);}

async function getLoop(userId){const context=await observationContext(userId);const [user,snapshot,interventionResult,friends,assessment,contextEntries]=await Promise.all([
  pool.query('SELECT id,display_name,handle,initials,accent,avatar_emoji FROM users WHERE id=$1',[userId]),
  pool.query('SELECT * FROM health_snapshots WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]),
  pool.query('SELECT * FROM interventions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]),
  pool.query('SELECT id,display_name,handle,initials,accent,avatar_emoji FROM users WHERE id<>$1 ORDER BY display_name LIMIT 6',[userId]),
  pool.query('SELECT * FROM agent_assessments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]),
  pool.query('SELECT id,category,label,value,created_at FROM person_context_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40',[userId])]);
  if(!user.rows[0])return null;const intervention=interventionResult.rows[0]||null;let notifications=[],result=null,postSnapshot=null,pledges=[];
  if(intervention){const parts=await Promise.all([pool.query(`SELECT n.*,u.display_name AS sender_name,u.handle AS sender_handle,u.initials AS sender_initials,u.accent AS sender_accent,u.avatar_emoji
      FROM peer_notifications n JOIN users u ON u.id=n.sender_user_id WHERE n.intervention_id=$1 ORDER BY n.created_at DESC`,[intervention.id]),
    pool.query('SELECT * FROM intervention_results WHERE intervention_id=$1 LIMIT 1',[intervention.id]),
    pool.query("SELECT * FROM health_snapshots WHERE trigger_type='post-intervention' AND trigger_ref=$1 ORDER BY created_at DESC LIMIT 1",[intervention.id]),
    pool.query('SELECT * FROM challenge_pledges WHERE intervention_id=$1 ORDER BY created_at DESC',[intervention.id])]);
    notifications=parts[0].rows;result=parts[1].rows[0]||null;postSnapshot=parts[2].rows[0]||null;pledges=parts[3].rows;}
  const summary=context.summary,sourceLabel=Number(summary.strava_runs)>0?'Strava data export':Number(summary.gps_runs)>0?'Live GPS':'Seeded fallback';
  return {ok:true,user:user.rows[0],source:{label:sourceLabel,adapter:Number(summary.strava_runs)>0?'strava-export-v1':'neutral-observation-v1',runCount:summary.run_count,
    firstRunAt:summary.first_run_at,latestRunAt:summary.latest_run_at,heartRateRuns:summary.heart_rate_runs,rpeRuns:summary.rpe_runs,gpsRuns:summary.gps_runs,
    freshnessDays:summary.latest_run_at?Math.floor((Date.now()-new Date(summary.latest_run_at))/86400000):null,grain:'One aggregate record per run; raw export files remain server-side'},
    observations:context.observations,snapshot:snapshot.rows[0]||null,agentAssessment:assessment.rows[0]||null,contextEntries:contextEntries.rows,
    intervention,notifications,pledges,result,postSnapshot,friends:friends.rows,
    loop:[{key:'observe',label:'Observe',complete:Number(summary.run_count)>0},{key:'estimate',label:'Estimate',complete:Boolean(snapshot.rows[0])},{key:'ask',label:'Ask',complete:Boolean(intervention)},
      {key:'intervene',label:'Intervene',complete:Boolean(intervention&&intervention.status!=='proposed')},{key:'rally',label:'Rally',complete:notifications.length>0},{key:'reassess',label:'Reassess',complete:Boolean(postSnapshot)}],
    engine:{mode:assessment.rows[0]?.engine_mode||'deterministic-fallback',provider:assessment.rows[0]?.provider||null,model:assessment.rows[0]?.model||null,contract:'neutral observations + user context → validated assessment/questions/interventions'},disclaimer:'Running signals are not a medical diagnosis and do not establish fitness to exercise.'};}

function parseInput(schema,body) {
  const parsed=schema.safeParse(body);
  if(!parsed.success)throw new Error(parsed.error.issues.map(issue=>`${issue.path.join('.')||'input'}: ${issue.message}`).join('; '));
  return parsed.data;
}

async function adoptGodoyChallenge(userId,candidateId) {
  const [assessmentResult,snapshotResult,runResult]=await Promise.all([
    pool.query('SELECT * FROM agent_assessments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]),
    pool.query('SELECT * FROM health_snapshots WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[userId]),
    pool.query('SELECT distance_meters FROM run_observations WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT 4',[userId])
  ]),assessment=assessmentResult.rows[0],snapshot=snapshotResult.rows[0];
  if(!assessment||!snapshot)throw new Error('Run Agent Godoy before choosing a challenge');
  const candidate=assessment.output.interventions.find(item=>item.id===candidateId);
  if(!candidate)throw new Error('Challenge candidate not found in the latest assessment');
  const typical=median(runResult.rows.map(row=>Number(row.distance_meters)))||4000,target=Math.round(clamp(typical,2000,15000)/100)*100;
  const id=`intervention-${randomUUID()}`,dueAt=new Date(Date.now()+candidate.durationDays*86400000);
  const result=await pool.query(`INSERT INTO interventions(id,snapshot_id,user_id,title,question,hypothesis,instructions,target_distance_meters,
      success_criteria,measures_to_collect,safety_stop,generated_by,due_at,challenge_description,funding_target_minor,currency,settlement_rule,editable_fields)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [id,snapshot.id,userId,candidate.challenge.title,assessment.output.questions[0].question,candidate.rationale,candidate.instructions,target,
      JSON.stringify(candidate.successCriteria),JSON.stringify(candidate.measuresToCollect),candidate.safetyStop,assessment.engine_mode,dueAt.toISOString(),
      candidate.challenge.description,candidate.challenge.fundingCapMinor,candidate.challenge.currency,candidate.challenge.settlementRule,JSON.stringify(candidate.challenge.editableFields)]);
  return result.rows[0];
}

function abstractRoute(samples) {
  if(!samples.length)return [];
  const origin={latitude:Number(samples[0].latitude),longitude:Number(samples[0].longitude)},latitudeScale=Math.cos(origin.latitude*Math.PI/180);
  return samples.map((sample,index)=>{
    const north=(Number(sample.latitude)-origin.latitude)*111320,east=(Number(sample.longitude)-origin.longitude)*111320*latitudeScale;
    const angle=.61,rotatedX=east*Math.cos(angle)-north*Math.sin(angle),rotatedY=east*Math.sin(angle)+north*Math.cos(angle);
    return {x:round(rotatedX/12+Math.sin(index*.83)*.32,2),y:round(rotatedY/12+Math.cos(index*.71)*.26,2)};
  });
}
async function getLiveMap(userId) {
  const sessionResult=await pool.query(`SELECT s.id,s.status,s.distance_meters,s.moving_seconds,s.started_at,s.ended_at,u.display_name,u.avatar_emoji
    FROM gps_run_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.user_id=$1 AND (s.status='active' OR s.ended_at>NOW()-INTERVAL '6 hours')
    ORDER BY (s.status='active') DESC,s.started_at DESC LIMIT 1`,[userId]),session=sessionResult.rows[0];
  if(!session)return {ok:true,active:false,runner:null,route:[],cheers:[],message:'Waiting for the runner to start sharing.'};
  const [sampleResult,cheerResult]=await Promise.all([
    pool.query(`SELECT latitude,longitude,recorded_at FROM (
      SELECT latitude,longitude,recorded_at FROM gps_run_samples WHERE session_id=$1 ORDER BY recorded_at DESC LIMIT 180
    ) samples ORDER BY recorded_at ASC`,[session.id]),
    pool.query(`SELECT c.id,c.emoji,c.created_at,u.display_name,u.avatar_emoji
      FROM live_map_cheers c JOIN users u ON u.id=c.sender_user_id WHERE c.session_id=$1 ORDER BY c.created_at DESC LIMIT 8`,[session.id])
  ]);
  const samples=sampleResult.rows,distance=Number(session.distance_meters),seconds=Number(session.moving_seconds),pace=distance>=100?seconds/(distance/1000):null;
  return {ok:true,active:session.status==='active',runner:{displayName:session.display_name,avatarEmoji:session.avatar_emoji},route:abstractRoute(samples),
    stats:{distanceMeters:round(distance),movingSeconds:seconds,paceSecondsPerKm:pace?Math.round(pace):null,sampleCount:samples.length,
      updatedAt:samples.at(-1)?.recorded_at||session.started_at,startedAt:session.started_at},cheers:cheerResult.rows,
    privacy:{streetNames:false,rawCoordinatesExposed:false,description:'Abstract route geometry only; location and street data stay private.'}};
}

function outcomeFor(intervention,body){const distance=Math.round(Number(body.actualDistanceKm)*1000),seconds=Math.round(Number(body.movingMinutes)*60),rpe=Number(body.perceivedExertion),symptoms=Array.isArray(body.symptoms)?body.symptoms.filter(Boolean).slice(0,8):[];
  if(!Number.isFinite(distance)||distance<100||!Number.isFinite(seconds)||seconds<60)throw new Error('Enter a valid distance and moving time');if(!Number.isFinite(rpe)||rpe<0||rpe>10)throw new Error('Perceived effort must be from 0 to 10');
  let label='inconclusive',summary=`The run recorded ${round(distance/1000)} km at effort ${rpe}/10. More evidence is needed before changing the running baseline.`;
  if(symptoms.length){label='stop-signal';summary=`The run recorded a warning symptom (${symptoms.join(', ')}). The peer challenge is closed; do not use the app to push through symptoms.`;}
  else if(distance>=Number(intervention.target_distance_meters)*.95&&rpe<=5){label='supported';summary=`The ${round(distance/1000)} km signal run met the distance target at ${rpe}/10 effort with no warning symptoms reported.`;}
  return {distance,seconds,rpe,symptoms,label,summary};}

async function liveStreamDetails(streamId) {
  const [streamResult,cheerResult]=await Promise.all([
    pool.query(`SELECT s.*,u.display_name,u.handle,u.avatar_emoji,u.accent FROM live_streams s
      JOIN users u ON u.id=s.broadcaster_user_id WHERE s.id=$1`,[streamId]),
    pool.query(`SELECT c.id,c.emoji,c.created_at,u.display_name,u.handle,u.avatar_emoji FROM live_stream_cheers c
      JOIN users u ON u.id=c.sender_user_id WHERE c.stream_id=$1 ORDER BY c.created_at DESC LIMIT 30`,[streamId])
  ]);
  const stream=streamResult.rows[0];
  if(!stream)return null;
  const channel=streamChannels.get(streamId);
  return {id:stream.id,status:stream.status,title:stream.title,sponsorName:stream.sponsor_name,productName:stream.product_name,
    productUrl:stream.product_url,viewerCount:channel?.viewers.size||0,peakViewers:stream.peak_viewers,startedAt:stream.started_at,endedAt:stream.ended_at,
    broadcaster:{id:stream.broadcaster_user_id,displayName:stream.display_name,handle:stream.handle,avatarEmoji:stream.avatar_emoji,accent:stream.accent},cheers:cheerResult.rows};
}
async function requireUser(request,response) {
  const user=await requestUser(request);
  if(!user)json(response,401,{error:'Sign in to continue'});
  return user;
}

async function handler(request,response){const url=new URL(request.url,'http://api.internal'),path=url.pathname;
  try{
    if(request.method==='GET'&&path==='/health'){await pool.query('SELECT 1');response.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return response.end('ok\n');}
    if(request.method==='GET'&&path==='/api/status'){await pool.query('SELECT 1');return json(response,200,{ok:true,service:'sidequest-feedback-api',database:'connected',sourceAdapter:fs.existsSync(stravaPath)?'strava-export-v1':'neutral-observation-v1',generationMode:'deterministic-poc',modelProvider:null,diagnosticClaims:false,realtime:'websocket-fanout'});}
    if(request.method==='GET'&&path==='/api/auth/me'){const user=await requestUser(request);return user?json(response,200,{ok:true,user:publicUser(user)}):json(response,401,{error:'Not signed in'});}
    if(request.method==='POST'&&path==='/api/auth/register'){const body=await bodyJson(request),displayName=String(body.displayName||'').trim().replace(/\s+/g,' '),handle=String(body.handle||'').trim().toLowerCase().replace(/^@/,'');
      if(displayName.length<2||displayName.length>50)return json(response,400,{error:'Enter a name between 2 and 50 characters'});
      if(!/^[a-z0-9_]{3,24}$/.test(handle))return json(response,400,{error:'Handle must be 3–24 letters, numbers, or underscores'});
      const exists=await pool.query('SELECT id FROM users WHERE handle=$1',[`@${handle}`]);if(exists.rows[0])return json(response,409,{error:'That handle is already registered'});
      const initials=displayName.split(' ').slice(0,2).map(part=>part[0]).join('').toUpperCase(),accents=['#d7ff55','#ff7a66','#67d7ff','#b99cff','#ffd267'],id=`user-${randomUUID()}`;
      const result=await pool.query(`INSERT INTO users(id,display_name,handle,initials,accent,avatar_emoji,demo) VALUES($1,$2,$3,$4,$5,'🏃',FALSE) RETURNING *`,[id,displayName,`@${handle}`,initials,accents[Math.floor(Math.random()*accents.length)]]),cookie=await createSession(request,id);
      return json(response,201,{ok:true,user:publicUser(result.rows[0])},{'Set-Cookie':cookie});}
    if(request.method==='POST'&&path==='/api/auth/login'){const body=await bodyJson(request),handle=String(body.handle||'').trim().toLowerCase().replace(/^@/,'');
      const result=await pool.query('SELECT * FROM users WHERE handle=$1',[`@${handle}`]);if(!result.rows[0])return json(response,404,{error:'No user has that handle yet'});
      const cookie=await createSession(request,result.rows[0].id);return json(response,200,{ok:true,user:publicUser(result.rows[0])},{'Set-Cookie':cookie});}
    if(request.method==='POST'&&path==='/api/auth/logout'){const token=cookies(request)[sessionCookie];if(token)await pool.query('DELETE FROM user_sessions WHERE token_hash=$1',[hashToken(token)]);return json(response,200,{ok:true},{'Set-Cookie':cookieHeader(request,'',0)});}
    if(request.method==='GET'&&path==='/api/live/streams'){const result=await pool.query(`SELECT id FROM live_streams WHERE status='live' OR ended_at>NOW()-INTERVAL '6 hours' ORDER BY (status='live') DESC,started_at DESC LIMIT 20`),streams=await Promise.all(result.rows.map(row=>liveStreamDetails(row.id)));return json(response,200,{ok:true,streams});}
    if(request.method==='POST'&&path==='/api/live/streams/start'){const user=await requireUser(request,response);if(!user)return;const body=await bodyJson(request),title=String(body.title||'').trim().slice(0,100),sponsorName=String(body.sponsorName||'').trim().slice(0,80),productName=String(body.productName||'').trim().slice(0,100),productUrl=String(body.productUrl||'').trim().slice(0,500)||null;
      if(title.length<3||sponsorName.length<2||productName.length<2)return json(response,400,{error:'Add a stream title, sponsor, and featured product'});
      if(productUrl&&!/^https?:\/\//i.test(productUrl))return json(response,400,{error:'Product link must start with http:// or https://'});
      await pool.query("UPDATE live_streams SET status='ended',ended_at=NOW() WHERE broadcaster_user_id=$1 AND status='live'",[user.id]);
      const id=`stream-${randomUUID()}`;await pool.query(`INSERT INTO live_streams(id,broadcaster_user_id,title,sponsor_name,product_name,product_url) VALUES($1,$2,$3,$4,$5,$6)`,[id,user.id,title,sponsorName,productName,productUrl]);return json(response,201,{ok:true,stream:await liveStreamDetails(id)});}
    const streamDetail=path.match(/^\/api\/live\/streams\/([^/]+)$/);
    if(request.method==='GET'&&streamDetail){const stream=await liveStreamDetails(streamDetail[1]);return stream?json(response,200,{ok:true,stream}):json(response,404,{error:'Stream not found'});}
    const streamStop=path.match(/^\/api\/live\/streams\/([^/]+)\/stop$/);
    if(request.method==='POST'&&streamStop){const user=await requireUser(request,response);if(!user)return;const result=await pool.query("UPDATE live_streams SET status='ended',ended_at=COALESCE(ended_at,NOW()) WHERE id=$1 AND broadcaster_user_id=$2 RETURNING id",[streamStop[1],user.id]);if(!result.rows[0])return json(response,404,{error:'Live stream not found'});const channel=streamChannels.get(streamStop[1]);if(channel){streamBroadcast(channel,{type:'stream-ended'});channel.broadcaster?.close(1000,'Stream ended');}return json(response,200,{ok:true});}
    const streamCheer=path.match(/^\/api\/live\/streams\/([^/]+)\/cheers$/);
    if(request.method==='POST'&&streamCheer){const user=await requireUser(request,response);if(!user)return;const body=await bodyJson(request),emoji=String(body.emoji||'');if(!['🔥','👏','⚡','💚','🎉'].includes(emoji))return json(response,400,{error:'Choose an available cheer'});
      const active=await pool.query("SELECT id FROM live_streams WHERE id=$1 AND status='live'",[streamCheer[1]]);if(!active.rows[0])return json(response,409,{error:'This stream has ended'});
      const result=await pool.query('INSERT INTO live_stream_cheers(id,stream_id,sender_user_id,emoji) VALUES($1,$2,$3,$4) RETURNING *',[`stream-cheer-${randomUUID()}`,streamCheer[1],user.id,emoji]),event={type:'cheer',cheer:{...result.rows[0],display_name:user.display_name,handle:user.handle,avatar_emoji:user.avatar_emoji}};const channel=streamChannels.get(streamCheer[1]);if(channel)streamBroadcast(channel,event);return json(response,201,{ok:true,cheer:event.cheer});}
    if(request.method==='GET'&&path==='/api/feedback-loop'){const signedIn=await requestUser(request),loop=await getLoop(signedIn?.id||url.searchParams.get('userId')||defaultUserId);return loop?json(response,200,loop):json(response,404,{error:'User not found'});}
    if(request.method==='GET'&&path==='/api/agent-godoy/export'){const signedIn=await requestUser(request),userId=signedIn?.id||url.searchParams.get('userId')||defaultUserId,loop=await getLoop(userId);if(!loop)return json(response,404,{error:'User not found'});
      const payload={exportedAt:new Date().toISOString(),schemaVersion:'agent-godoy-v1',user:{id:loop.user.id,displayName:loop.user.display_name},source:loop.source,
        additionalContext:loop.contextEntries,assessment:loop.agentAssessment,activeChallenge:loop.intervention,pledges:loop.pledges,disclaimer:loop.disclaimer};
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="agent-godoy-export.json"','Cache-Control':'no-store'});return response.end(JSON.stringify(payload,null,2));}
    if(request.method==='POST'&&path==='/api/agent-godoy/analyse'){const user=await requireUser(request,response);if(!user)return;await bodyJson(request);await analyse(user.id);const assessment=await runAndPersistGodoy(user.id,{allowModel:true});return json(response,201,{ok:true,assessment});}
    if(request.method==='POST'&&path==='/api/context'){const user=await requireUser(request,response);if(!user)return;const body=await bodyJson(request),userId=user.id,entry=parseInput(ContextEntryInputSchema,{category:body.category,label:body.label,value:body.value});
      const result=await pool.query(`INSERT INTO person_context_entries(id,user_id,category,label,value) VALUES($1,$2,$3,$4,$5) RETURNING *`,[`context-${randomUUID()}`,userId,entry.category,entry.label,entry.value]);return json(response,201,{ok:true,entry:result.rows[0]});}
    const adopt=path.match(/^\/api\/agent-godoy\/challenges\/([^/]+)\/adopt$/);
    if(request.method==='POST'&&adopt){const user=await requireUser(request,response);if(!user)return;await bodyJson(request);const intervention=await adoptGodoyChallenge(user.id,decodeURIComponent(adopt[1]));return json(response,201,{ok:true,intervention});}
    if(request.method==='GET'&&path==='/api/live-map'){const map=await getLiveMap(url.searchParams.get('userId')||defaultUserId);return json(response,200,map);}
    if(request.method==='POST'&&path==='/api/live-map/cheers'){const user=await requireUser(request,response);if(!user)return;const body=await bodyJson(request),runnerId=String(body.runnerUserId||defaultUserId),senderId=user.id,emoji=String(body.emoji||'');
      if(!['🔥','👏','⚡','💚'].includes(emoji))return json(response,400,{error:'Choose an available cheer'});
      const session=await pool.query("SELECT id FROM gps_run_sessions WHERE user_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",[runnerId]);if(!session.rows[0])return json(response,409,{error:'The runner is not live yet'});
      const sender=await pool.query('SELECT id FROM users WHERE id=$1',[senderId]);if(!sender.rows[0])return json(response,400,{error:'Spectator not found'});
      const cheer=await pool.query('INSERT INTO live_map_cheers(id,session_id,sender_user_id,emoji) VALUES($1,$2,$3,$4) RETURNING *',[`cheer-${randomUUID()}`,session.rows[0].id,senderId,emoji]);return json(response,201,{ok:true,cheer:cheer.rows[0]});}
    if(request.method==='POST'&&path==='/api/feedback-loop/analyse'){const user=await requireUser(request,response);if(!user)return;await bodyJson(request);const snapshot=await analyse(user.id);return json(response,201,{ok:true,snapshot,engine:{mode:'deterministic-poc',provider:null}});}
    if(request.method==='POST'&&path==='/api/feedback-loop/interventions'){const user=await requireUser(request,response);if(!user)return;const body=await bodyJson(request),intervention=await generateIntervention(user.id,Boolean(body.force));return json(response,201,{ok:true,intervention});}
    if(request.method==='POST'&&path==='/api/gps-runs/start'){const user=await requireUser(request,response);if(!user)return;await bodyJson(request);const id=`gps-${randomUUID()}`,result=await pool.query('INSERT INTO gps_run_sessions(id,user_id) VALUES($1,$2) RETURNING *',[id,user.id]);return json(response,201,{ok:true,session:result.rows[0]});}
    const sample=path.match(/^\/api\/gps-runs\/([^/]+)\/samples$/);
    if(request.method==='POST'&&sample){const user=await requireUser(request,response);if(!user)return;const body=await bodyJson(request),latitude=Number(body.latitude),longitude=Number(body.longitude),accuracy=body.accuracy==null?null:Number(body.accuracy),recordedAt=new Date(body.recordedAt||Date.now());
      if(!Number.isFinite(latitude)||latitude < -90||latitude > 90||!Number.isFinite(longitude)||longitude < -180||longitude > 180)return json(response,400,{error:'Invalid coordinates'});
      if(!Number.isFinite(recordedAt.getTime())||Math.abs(Date.now()-recordedAt.getTime())>300000)return json(response,400,{error:'GPS sample must be fresh'});
      const session=await pool.query("SELECT * FROM gps_run_sessions WHERE id=$1 AND user_id=$2 AND status='active'",[sample[1],user.id]);if(!session.rows[0])return json(response,404,{error:'Active GPS run not found'});
      const previous=await pool.query('SELECT latitude,longitude,recorded_at FROM gps_run_samples WHERE session_id=$1 ORDER BY recorded_at DESC LIMIT 1',[sample[1]]);let added=0,seconds=0;
      if(previous.rows[0]){seconds=(recordedAt-new Date(previous.rows[0].recorded_at))/1000;const distance=haversine({latitude:Number(previous.rows[0].latitude),longitude:Number(previous.rows[0].longitude)},{latitude,longitude}),speed=seconds>0?distance/seconds:Infinity;
        if(seconds>0&&seconds<=120&&speed<=12&&distance<=600&&(accuracy==null||accuracy<=100))added=distance;else seconds=0;}
      await pool.query('INSERT INTO gps_run_samples(session_id,latitude,longitude,accuracy_meters,recorded_at) VALUES($1,$2,$3,$4,$5)',[sample[1],latitude,longitude,accuracy,recordedAt.toISOString()]);
      const updated=await pool.query('UPDATE gps_run_sessions SET distance_meters=distance_meters+$2,moving_seconds=moving_seconds+$3 WHERE id=$1 RETURNING *',[sample[1],added,Math.round(seconds)]),s=updated.rows[0];
      const pace=Number(s.distance_meters)>=100?Number(s.moving_seconds)/(Number(s.distance_meters)/1000):null;return json(response,201,{ok:true,session:s,acceptedDistanceMeters:round(added),paceSecondsPerKm:pace&&Math.round(pace)});}
    const finish=path.match(/^\/api\/gps-runs\/([^/]+)\/finish$/);
    if(request.method==='POST'&&finish){const user=await requireUser(request,response);if(!user)return;const body=await bodyJson(request),active=await pool.query("SELECT * FROM gps_run_sessions WHERE id=$1 AND user_id=$2 AND status='active'",[finish[1],user.id]),candidate=active.rows[0];
      if(!candidate)return json(response,404,{error:'Active GPS run not found'});if(Number(candidate.distance_meters)<20||Number(candidate.moving_seconds)<10)return json(response,400,{error:'Not enough accepted GPS movement to create a run observation'});
      const sessionResult=await pool.query("UPDATE gps_run_sessions SET status='complete',ended_at=NOW() WHERE id=$1 AND status='active' RETURNING *",[finish[1]]),session=sessionResult.rows[0];if(!session)return json(response,409,{error:'GPS run was already finished'});
      const rpe=Number(body.perceivedExertion),observation=await pool.query(`INSERT INTO run_observations(id,user_id,source,external_id,occurred_at,distance_meters,moving_seconds,perceived_exertion,demo)
        VALUES($1,$2,'gps-live',$3,$4,$5,$6,$7,FALSE) ON CONFLICT(source,external_id) DO UPDATE SET perceived_exertion=EXCLUDED.perceived_exertion RETURNING *`,
        [`observation-${session.id}`,session.user_id,session.id,session.started_at,session.distance_meters,session.moving_seconds,Number.isFinite(rpe)&&rpe>=0&&rpe<=10?rpe:null]);return json(response,201,{ok:true,observation:observation.rows[0]});}
    const share=path.match(/^\/api\/interventions\/([^/]+)\/share$/);
    if(request.method==='POST'&&share){const body=await bodyJson(request),senderId=String(body.senderUserId||''),sender=await pool.query('SELECT display_name FROM users WHERE id=$1',[senderId]);if(!sender.rows[0])return json(response,400,{error:'Friend not found'});
      const message=String(body.message||`${sender.rows[0].display_name} challenged you to close the loop.`).trim().slice(0,180),result=await pool.query(`INSERT INTO peer_notifications(id,intervention_id,sender_user_id,recipient_user_id,message)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[`notification-${randomUUID()}`,share[1],senderId,body.userId||defaultUserId,message]);return json(response,201,{ok:true,notification:result.rows[0]});}
    const accept=path.match(/^\/api\/interventions\/([^/]+)\/accept$/);
    if(request.method==='POST'&&accept){const result=await pool.query("UPDATE interventions SET status='accepted' WHERE id=$1 AND status='proposed' RETURNING *",[accept[1]]);return result.rows[0]?json(response,200,{ok:true,intervention:result.rows[0]}):json(response,409,{error:'Intervention is not awaiting acceptance'});}
    const challengeUpdate=path.match(/^\/api\/interventions\/([^/]+)\/challenge$/);
    if(request.method==='PATCH'&&challengeUpdate){const body=parseInput(ChallengeUpdateSchema,await bodyJson(request)),result=await pool.query(`UPDATE interventions SET title=$2,challenge_description=$3,due_at=$4,funding_target_minor=$5,currency=$6 WHERE id=$1 RETURNING *`,
      [challengeUpdate[1],body.title,body.description,body.dueAt,body.fundingTargetMinor,body.currency]);return result.rows[0]?json(response,200,{ok:true,intervention:result.rows[0]}):json(response,404,{error:'Intervention not found'});}
    const pledge=path.match(/^\/api\/interventions\/([^/]+)\/pledges$/);
    if(request.method==='POST'&&pledge){const body=parseInput(PledgeInputSchema,await bodyJson(request)),intervention=await pool.query('SELECT currency FROM interventions WHERE id=$1',[pledge[1]]);if(!intervention.rows[0])return json(response,404,{error:'Intervention not found'});if(intervention.rows[0].currency!==body.currency)return json(response,400,{error:`This challenge uses ${intervention.rows[0].currency}`});
      const result=await pool.query(`INSERT INTO challenge_pledges(id,intervention_id,contributor_name,contributor_kind,amount_minor,currency) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[`pledge-${randomUUID()}`,pledge[1],body.contributorName,body.contributorKind,body.amountMinor,body.currency]);return json(response,201,{ok:true,pledge:result.rows[0],paymentStatus:'pledge-only-not-charged'});}
    const resultMatch=path.match(/^\/api\/interventions\/([^/]+)\/result$/);
    if(request.method==='POST'&&resultMatch){const body=await bodyJson(request),interventionResult=await pool.query('SELECT * FROM interventions WHERE id=$1',[resultMatch[1]]);if(!interventionResult.rows[0])return json(response,404,{error:'Intervention not found'});const outcome=outcomeFor(interventionResult.rows[0],body);
      const result=await pool.query(`INSERT INTO intervention_results(id,intervention_id,actual_distance_meters,moving_seconds,perceived_exertion,symptoms,outcome_label,outcome_summary)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(intervention_id) DO UPDATE SET actual_distance_meters=EXCLUDED.actual_distance_meters,moving_seconds=EXCLUDED.moving_seconds,
        perceived_exertion=EXCLUDED.perceived_exertion,symptoms=EXCLUDED.symptoms,outcome_label=EXCLUDED.outcome_label,outcome_summary=EXCLUDED.outcome_summary,created_at=NOW() RETURNING *`,
        [`result-${randomUUID()}`,resultMatch[1],outcome.distance,outcome.seconds,outcome.rpe,JSON.stringify(outcome.symptoms),outcome.label,outcome.summary]);await pool.query("UPDATE interventions SET status='completed' WHERE id=$1",[resultMatch[1]]);return json(response,201,{ok:true,result:result.rows[0]});}
    const reassess=path.match(/^\/api\/interventions\/([^/]+)\/reassess$/);
    if(request.method==='POST'&&reassess){const intervention=await pool.query('SELECT * FROM interventions WHERE id=$1',[reassess[1]]),result=await pool.query('SELECT * FROM intervention_results WHERE intervention_id=$1',[reassess[1]]);if(!intervention.rows[0]||!result.rows[0])return json(response,409,{error:'Record an outcome before reassessing'});
      const snapshot=await analyse(intervention.rows[0].user_id,'post-intervention',reassess[1],result.rows[0]);await pool.query("UPDATE interventions SET status='assessed' WHERE id=$1",[reassess[1]]);return json(response,201,{ok:true,snapshot});}
    return json(response,404,{error:'Route not found'});
  }catch(error){console.error(error);return json(response,/valid|effort|fresh|coordinates/i.test(error.message)?400:500,{error:error.message||'Unexpected server error'});}}

const websocketServer=new WebSocketServer({noServer:true,maxPayload:2*1024*1024});
websocketServer.on('connection',(socket,request,context)=>{
  const {streamId,role,user}=context,channel=getStreamChannel(streamId);
  socket.streamId=streamId;socket.streamRole=role;socket.userId=user.id;
  if(role==='broadcaster'){
    channel.broadcaster=socket;
    streamBroadcast(channel,{type:'broadcaster-online',viewerCount:channel.viewers.size});
  }else{
    channel.viewers.add(socket);
    streamSend(socket,{type:'connected',role,viewerCount:channel.viewers.size,mimeType:channel.mimeType||null});
    if(channel.mimeType)streamSend(socket,{type:'media-start',mimeType:channel.mimeType,replay:true});
    for(const chunk of channel.chunks)if(socket.readyState===WebSocket.OPEN)socket.send(chunk,{binary:true});
    streamBroadcast(channel,{type:'viewer-count',viewerCount:channel.viewers.size});
    pool.query('UPDATE live_streams SET peak_viewers=GREATEST(peak_viewers,$2) WHERE id=$1',[streamId,channel.viewers.size]).catch(console.error);
  }
  socket.on('message',(message,isBinary)=>{
    if(role!=='broadcaster')return;
    if(!isBinary){try{const event=JSON.parse(message.toString());if(event.type==='media-start'&&/^video\/webm/i.test(event.mimeType||'')){channel.mimeType=String(event.mimeType).slice(0,120);channel.chunks=[];channel.cachedBytes=0;streamBroadcast(channel,{type:'media-start',mimeType:channel.mimeType});}}catch{}return;}
    if(message.length>2*1024*1024)return;
    const chunk=Buffer.from(message);
    if(channel.cachedBytes+chunk.length<=16*1024*1024){channel.chunks.push(chunk);channel.cachedBytes+=chunk.length;}
    for(const viewer of channel.viewers)if(viewer.readyState===WebSocket.OPEN&&viewer.bufferedAmount<4*1024*1024)viewer.send(chunk,{binary:true});
  });
  socket.on('close',()=>{
    if(role==='viewer'){
      channel.viewers.delete(socket);streamBroadcast(channel,{type:'viewer-count',viewerCount:channel.viewers.size});
    }else if(channel.broadcaster===socket){
      channel.broadcaster=null;streamBroadcast(channel,{type:'stream-ended'});
      pool.query("UPDATE live_streams SET status='ended',ended_at=COALESCE(ended_at,NOW()) WHERE id=$1 AND status='live'",[streamId]).catch(console.error);
    }
    if(!channel.broadcaster&&!channel.viewers.size)setTimeout(()=>{const current=streamChannels.get(streamId);if(current===channel&&!current.broadcaster&&!current.viewers.size)streamChannels.delete(streamId);},300000);
  });
});

async function handleUpgrade(request,socket,head) {
  try{
    const url=new URL(request.url,'http://api.internal');
    if(url.pathname!=='/api/live/ws'){socket.destroy();return;}
    const user=await requestUser(request),streamId=url.searchParams.get('streamId'),role=url.searchParams.get('role');
    if(!user||!streamId||!['broadcaster','viewer'].includes(role)){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    const result=await pool.query("SELECT broadcaster_user_id,status FROM live_streams WHERE id=$1",[streamId]),stream=result.rows[0];
    if(!stream||stream.status!=='live'||(role==='broadcaster'&&stream.broadcaster_user_id!==user.id)){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    const channel=getStreamChannel(streamId);
    if(role==='broadcaster'&&channel.broadcaster?.readyState===WebSocket.OPEN){socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    websocketServer.handleUpgrade(request,socket,head,websocket=>websocketServer.emit('connection',websocket,request,{streamId,role,user}));
  }catch(error){console.error('WebSocket upgrade failed',error);socket.destroy();}
}

async function start(){await ensureSchema();const source=await importStrava();await seedFallback();await ensureInitialLoop();const server=http.createServer(handler);server.on('upgrade',handleUpgrade);server.listen(port,'0.0.0.0',()=>console.log(`SideQuest feedback API listening on ${port}; Strava ${source.available?'available':'unavailable'}, ${source.imported} new runs`));}
start().catch(error=>{console.error('Failed to start API',error);process.exit(1);});
