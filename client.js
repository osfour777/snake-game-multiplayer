
// WebSocket
const ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://') + location.host);

let sid = null;
let player = null;
let state = null;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const cellW = canvas.width / 60;
const cellH = canvas.height / 30;

ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);

  if (msg.type === 'requestName') {
    document.getElementById('nameInputArea').style.display = 'block';
  }

  if (msg.type === 'welcome') {
    sid = msg.sid;
    player = msg.player;

    document.getElementById('gameArea').style.display = 'block';
    document.getElementById('nameInputArea').style.display = 'none';
  }

  if (msg.type === 'state') {
    state = msg.state;
  }

  if (msg.type === 'signal') handleSignal(msg.from, msg.data);
};

function submitName() {
  const name = document.getElementById('playerName').value.trim();
  if (!name) return alert("Enter valid name");
  ws.send(JSON.stringify({ type:'setName', name }));
}

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'w') sendDir('UP');
  if (k === 's') sendDir('DOWN');
  if (k === 'a') sendDir('LEFT');
  if (k === 'd') sendDir('RIGHT');
});

function sendDir(d) {
  ws.send(JSON.stringify({ type:'input', dir:d }));
}

document.getElementById('retry').onclick = () => {
  ws.send(JSON.stringify({ type:'retry' }));
};

function render() {
  ctx.fillStyle='#111';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  if (!state) return requestAnimationFrame(render);

  // Fruit
  ctx.fillStyle = 'yellow';
  ctx.fillRect(state.fruit.x*cellW, state.fruit.y*cellH, cellW, cellH);

  // Snakes
  for (const id in state.players) {
    const p = state.players[id];
    if (!p.alive) continue;

    ctx.fillStyle = p.id === 1 ? '#4CAF50' : '#FF5252';
    ctx.fillRect(p.x*cellW, p.y*cellH, cellW, cellH);

    ctx.fillStyle = '#AAA';
    for (const seg of p.tail) {
      ctx.fillRect(seg.x*cellW, seg.y*cellH, cellW, cellH);
    }
  }

  // Leaderboard
  let html = '';
  state.leaderboard.forEach((p,i)=>{
    html += `<div>${i+1}. ${p.name}: ${p.score}</div>`;
  });
  document.getElementById('leaderboard').innerHTML = html;

  requestAnimationFrame(render);
}
render();

//
// Voice (unchanged from earlier version)
//
let pcs = {};
let localStream = null;

document.getElementById('startVoice').onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ audio:true });

  const players = state.players;
  for (const other in players) {
    if (other === sid) continue;
    startRTC(other, true);
  }
};

document.getElementById('stopVoice').onclick = () => {
  if (localStream) localStream.getTracks().forEach(t=>t.stop());
  pcs = {};
};

function startRTC(remoteSid, caller) {
  if (pcs[remoteSid]) return pcs[remoteSid];
  const pc = new RTCPeerConnection();
  pcs[remoteSid] = pc;

  if (localStream) {
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  }

  pc.ontrack = ev => {
    const audio = document.createElement('audio');
    audio.srcObject = ev.streams[0];
    audio.autoplay = true;
    document.body.appendChild(audio);
  };

  pc.onicecandidate = ev => {
    if (ev.candidate) {
      ws.send(JSON.stringify({
        type:'signal',
        target:remoteSid,
        data:{ type:'ice', candidate:ev.candidate }
      }));
    }
  };

  if (caller) {
    pc.createOffer().then(o=>{
      pc.setLocalDescription(o);
      ws.send(JSON.stringify({
        type:'signal',
        target:remoteSid,
        data:{ type:'sdp', sdp:o }
      }));
    });
  }

  return pc;
}

async function handleSignal(from, data) {
  const pc = pcs[from] || startRTC(from,false);

  if (data.type === 'sdp') {
    await pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === 'offer') {
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      ws.send(JSON.stringify({
        type:'signal',
        target:from,
        data:{type:'sdp', sdp:ans}
      }));
    }
  }

  if (data.type === 'ice') {
    await pc.addIceCandidate(data.candidate);
  }
}
