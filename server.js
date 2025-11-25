
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Game state (includes fruit)
const state = {
  width: 60,
  height: 30,
  players: {},
  leaderboard: [],
  fruit: { x: 30, y: 15 }
};

function respawnFruit() {
  state.fruit.x = Math.floor(Math.random() * (state.width - 4)) + 2;
  state.fruit.y = Math.floor(Math.random() * (state.height - 4)) + 2;
}
respawnFruit();

function createPlayer(id, name) {
  return {
    id,
    name,
    x: Math.floor(Math.random() * 50) + 5,
    y: Math.floor(Math.random() * 20) + 5,
    dir: 'STOP',
    tail: [],
    alive: true,
    score: 0
  };
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function tick() {
  for (const sid in state.players) {
    const p = state.players[sid];
    if (!p.alive || p.id === 0) continue;

    if (p.tail.length > 0) {
      for (let i = p.tail.length - 1; i > 0; i--) {
        p.tail[i] = p.tail[i - 1];
      }
      p.tail[0] = { x: p.x, y: p.y };
    }

    switch (p.dir) {
      case 'UP': p.y--; break;
      case 'DOWN': p.y++; break;
      case 'LEFT': p.x--; break;
      case 'RIGHT': p.x++; break;
    }

    if (p.x <= 0 || p.x >= state.width - 1 ||
        p.y <= 0 || p.y >= state.height - 1) {
      p.alive = false;
    }

    for (const otherid in state.players) {
      const op = state.players[otherid];
      if (op === p || !op.alive) continue;

      if (op.x === p.x && op.y === p.y) p.alive = false;

      for (const seg of op.tail) {
        if (seg.x === p.x && seg.y === p.y) p.alive = false;
      }
    }

    // Fruit collision
    if (p.x === state.fruit.x && p.y === state.fruit.y) {
      p.score += 10;
      p.tail.push({ x: p.x, y: p.y });
      respawnFruit();
    }

    if (p.alive) p.score++;
  }

  state.leaderboard = Object.values(state.players)
    .filter(p => p.id !== 0)
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);

  broadcast({ type: 'state', state });
}

wss.on('connection', ws => {
  ws.sid = Math.random().toString(36).slice(2, 9);
  ws.send(JSON.stringify({ type: 'requestName' }));

  ws.on('message', msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    if (data.type === 'setName') {
      const name = data.name.substring(0,20);
      const count = Object.values(state.players).filter(p=>p.id!==0).length;

      if (count < 2) {
        state.players[ws.sid] = createPlayer(count+1, name);
      } else {
        state.players[ws.sid] = { id:0, name, alive:false, tail:[] };
      }

      ws.send(JSON.stringify({
        type:'welcome',
        sid: ws.sid,
        player: state.players[ws.sid]
      }));
    }

    if (data.type === 'input' && state.players[ws.sid]) {
      state.players[ws.sid].dir = data.dir;
    }

    if (data.type === 'retry') {
      const p = state.players[ws.sid];
      if (p && p.id !== 0) {
        Object.assign(p, createPlayer(p.id, p.name));
      }
    }

    if (data.type === 'signal') {
      wss.clients.forEach(c => {
        if (c.sid === data.target && c.readyState === WebSocket.OPEN) {
          c.send(JSON.stringify({
            type:'signal',
            from: ws.sid,
            data: data.data
          }));
        }
      });
    }
  });

  ws.on('close', () => {
    delete state.players[ws.sid];
  });
});

setInterval(tick, 100);

server.listen(PORT, () => {
  console.log("Server running at http://localhost:" + PORT);
});
