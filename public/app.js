// ── BOARD HELPERS ──
function boardFlat(g) { return g.board().flat().filter(Boolean); }
function countPiece(g, type, color) { return boardFlat(g).filter(s => s.type===type && (!color||s.color===color)).length; }
function hasPiece(g, type, color) { return boardFlat(g).some(s => s.type===type && s.color===color); }
function isEndgame(g) { const q=countPiece(g,'q'); if(q===0) return true; return q<=1 && (countPiece(g,'b')+countPiece(g,'n'))<=2; }
function knightAttacks(sq) {
  const files='abcdefgh', f=files.indexOf(sq[0]), r=parseInt(sq[1]);
  return [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]
    .map(([df,dr])=>{const nf=f+df,nr=r+dr; return(nf>=0&&nf<=7&&nr>=1&&nr<=8)?files[nf]+nr:null;})
    .filter(Boolean);
}
function removePieceFromFen(fen, square) {
  try {
    const parts = fen.split(' ');
    const rows = parts[0].split('/');
    const file = square.charCodeAt(0)-97;
    const rank = 8-parseInt(square[1]);
    let row = '';
    for(const ch of rows[rank]) { if(/\d/.test(ch)) row+='1'.repeat(+ch); else row+=ch; }
    const arr = row.split(''); arr[file]='1'; let comp='',cnt=0;
    for(const ch of arr) { if(ch==='1') cnt++; else { if(cnt){comp+=cnt;cnt=0;} comp+=ch; } }
    if(cnt) comp+=cnt;
    rows[rank]=comp; parts[0]=rows.join('/');
    return parts.join(' ');
  } catch(e){ return null; }
}

// ── BINGO EVENTS ──
// detect(move, gameBefore, gameAfter) → true/false
// Only events that can be reliably auto-detected from chess.js are included.
const ALL_EVENTS = [
  { id:'castle_k',       icon:'0-0',   label:'Kingside\ncastle',          desc:'Either player castles kingside',                    detect:(m)=>m.flags.includes('k') },
  { id:'castle_q',       icon:'0-0-0', label:'Queenside\ncastle',         desc:'Either player castles queenside',                   detect:(m)=>m.flags.includes('q') },
  { id:'promote',        icon:'♟↑',   label:'Pawn\npromotes',            desc:'A pawn reaches the back rank',                      detect:(m)=>m.flags.includes('p') },
  { id:'en_passant',     icon:'e.p.',  label:'En\npassant',               desc:'En passant capture is made',                        detect:(m)=>m.flags.includes('e') },
  { id:'check',          icon:'+',     label:'Check\ngiven',              desc:'A player delivers check',                           detect:(_,__,a)=>a.in_check() },
  { id:'double_check',   icon:'++',    label:'Double\ncheck',             desc:'Two pieces give check simultaneously',
    detect:(m,_,a)=>{
      if(!a.in_check()) return false;
      const fen2=removePieceFromFen(a.fen(),m.to);
      if(!fen2) return false;
      try{ return new Chess(fen2).in_check(); }catch(e){ return false; }
    }
  },
  { id:'discovered_check',icon:'↗+',  label:'Discovered\ncheck',         desc:'A piece moves to reveal check from another piece',
    detect:(m,_,a)=>{
      if(!a.in_check()) return false;
      const fen2=removePieceFromFen(a.fen(),m.to);
      if(!fen2) return false;
      try{ const t=new Chess(fen2); return t.in_check() && !new Chess(a.fen()).in_check()===false; }catch(e){ return false; }
      // simpler: still in check without moved piece AND moved piece is not a queen/rook/bishop directly
    }
  },
  { id:'capture',        icon:'✕',     label:'Any\ncapture',              desc:'Any piece is taken',                                detect:(m)=>!!m.captured },
  { id:'queen_trade',    icon:'♛♛',   label:'Queen\ntrade',              desc:'Both queens leave the board',
    detect:(m,_,a)=>m.captured==='q' && !hasPiece(a,'q','w') && !hasPiece(a,'q','b')
  },
  { id:'bishop_pair_lost',icon:'♝off', label:'Bishop pair\nlost',        desc:'A player loses one of their two bishops',
    detect:(m,b,a)=>{ if(m.captured!=='b') return false; const lc=m.color==='w'?'b':'w'; return countPiece(b,'b',lc)===2&&countPiece(a,'b',lc)===1; }
  },
  { id:'rook_7th',       icon:'♜7',   label:'Rook on\n7th rank',         desc:'A rook reaches the opponent\'s 7th rank',
    detect:(m)=>m.piece==='r' && m.to[1]===(m.color==='w'?'7':'2')
  },
  { id:'back_rank_check',icon:'♜1+',  label:'Back rank\ncheck',          desc:'Rook or queen delivers check on back rank',
    detect:(m,_,a)=>a.in_check() && (m.piece==='r'||m.piece==='q') && m.to[1]===(m.color==='w'?'8':'1')
  },
  { id:'knight_fork',    icon:'♞⑉',   label:'Knight\nfork',              desc:'A knight attacks two or more valuable pieces',
    detect:(m,_,a)=>{
      if(m.piece!=='n') return false;
      const opp=m.color==='w'?'b':'w';
      const hits=boardFlat(a).filter(s=>s.color===opp&&['q','r','b','n','k'].includes(s.type)&&knightAttacks(m.to).includes(s.square));
      return hits.length>=2;
    }
  },
  { id:'passed_pawn',    icon:'→♟',   label:'Passed\npawn',              desc:'A pawn with no opposing pawns blocking its path',
    detect:(m,_,a)=>{
      if(m.piece!=='p') return false;
      const opp=m.color==='w'?'b':'w', file=m.to[0], rank=parseInt(m.to[1]);
      const files='abcdefgh', fi=files.indexOf(file);
      const adjFiles=[files[fi-1],file,files[fi+1]].filter(Boolean);
      const oppPawns=boardFlat(a).filter(s=>s.type==='p'&&s.color===opp);
      return !oppPawns.some(s=>adjFiles.includes(s.square[0])&&(m.color==='w'?parseInt(s.square[1])>rank:parseInt(s.square[1])<rank));
    }
  },
  { id:'isolated_pawn',  icon:'○♟',   label:'Isolated\npawn',            desc:'A pawn with no friendly pawns on adjacent files',
    detect:(m,_,a)=>{
      const files='abcdefgh';
      const pawns=boardFlat(a).filter(s=>s.type==='p'&&s.color===m.color);
      return pawns.some(p=>{ const fi=files.indexOf(p.square[0]); const adj=[files[fi-1],files[fi+1]].filter(Boolean); return !pawns.some(q=>q!==p&&adj.includes(q.square[0])); });
    }
  },
  { id:'pawn_chain',     icon:'△△△',  label:'Pawn\nchain',               desc:'Three or more connected pawns diagonally',
    detect:(m,_,a)=>{
      const files='abcdefgh', pawns=boardFlat(a).filter(s=>s.type==='p'&&s.color===m.color);
      return pawns.some(p=>{
        const fi=files.indexOf(p.square[0]), rank=parseInt(p.square[1]), dir=m.color==='w'?-1:1;
        const sup=pawns.filter(q=>q.square===(files[fi-1]?(files[fi-1]+(rank+dir)):null)||q.square===(files[fi+1]?(files[fi+1]+(rank+dir)):null));
        return sup.some(s=>{ const si=files.indexOf(s.square[0]),sr=parseInt(s.square[1]); return pawns.some(q=>q.square===(files[si-1]?(files[si-1]+(sr+dir)):null)||q.square===(files[si+1]?(files[si+1]+(sr+dir)):null)); });
      });
    }
  },
  { id:'pawn_storm',     icon:'▲▲▲',  label:'Pawn\nstorm',               desc:'Three or more pawns advanced past the midpoint on one wing',
    detect:(m,_,a)=>{
      const pawns=boardFlat(a).filter(s=>s.type==='p'&&s.color===m.color);
      const adv=pawns.filter(p=>m.color==='w'?parseInt(p.square[1])>=5:parseInt(p.square[1])<=4);
      const kFiles=['e','f','g','h'], qFiles=['a','b','c','d'];
      return adv.filter(p=>kFiles.includes(p.square[0])).length>=3 || adv.filter(p=>qFiles.includes(p.square[0])).length>=3;
    }
  },
  { id:'both_knights',   icon:'♞♞',   label:'Both knights\nlive',        desc:'Both knights survive into the endgame',
    detect:(m,_,a)=>isEndgame(a)&&countPiece(a,'n',m.color)===2
  },
  { id:'minor_takes_rook',icon:'♞>♜', label:'Minor takes\nrook',         desc:'A bishop or knight captures a rook',
    detect:(m)=>(m.piece==='b'||m.piece==='n')&&m.captured==='r'
  },
  { id:'pawn_takes_piece',icon:'♟>♝', label:'Pawn takes\npiece',         desc:'A pawn captures a bishop, knight, rook, or queen',
    detect:(m)=>m.piece==='p'&&m.captured&&m.captured!=='p'
  },
  { id:'long_diagonal',  icon:'♝⟋',   label:'Long\ndiagonal',            desc:'A bishop occupies a long diagonal square',
    detect:(m)=>m.piece==='b'&&['a1','b2','c3','d4','e5','f6','g7','h8','a8','b7','c6','d5','e4','f3','g2','h1'].includes(m.to)
  },
  { id:'threefold',      icon:'↺',    label:'Threefold\nrepetition',     desc:'The same position occurs three times',
    detect:(_,__,a)=>a.in_threefold_repetition()
  },
  { id:'king_takes',     icon:'♔✕',   label:'King\ncaptures',            desc:'The king captures a piece',
    detect:(m)=>m.piece==='k' && !!m.captured
  },
  { id:'queening_square',icon:'♛!',   label:'Pawn on\n6th rank',         desc:'A pawn reaches the 6th rank (one step from promotion)',
    detect:(m)=>m.piece==='p' && m.to[1]===(m.color==='w'?'6':'3')
  },
];

// ── STATE ──
let socket;
let myColor = null;
let myName = '';
let opponentName = '';
let roomId = '';
let game;
let board;
let bingoBoard = [];   // array of event objects for this player's card
let marked = new Set();
let triggeredIds = new Set(); // event IDs that have fired this game
let gameActive = false;
let selectedSquare = null;
let viewingMove = -1;
let moveHistory = [];

// ── TIME CONTROL STATE ──
let timeControl = { time: 300, inc: 0 };
let clocks = { w: 300, b: 300 };
let clockInterval = null;

// ── TIME PRESET SELECTION ──
document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    timeControl = { time: parseInt(btn.dataset.time), inc: parseInt(btn.dataset.inc) };
  });
});

// ── CLOCK HELPERS ──
function formatTime(secs) {
  if (secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateClockDisplay() {
  const turn = game ? game.turn() : 'w';
  ['w', 'b'].forEach(color => {
    const id = `clock-${color === 'w' ? 'white' : 'black'}`;
    const el = document.getElementById(id);
    if (!el) return;
    const secs = clocks[color];
    el.textContent = timeControl.time === 0 ? '∞' : formatTime(secs);
    el.classList.toggle('active', gameActive && turn === color);
    el.classList.toggle('low', timeControl.time > 0 && secs <= 10 && secs > 0);
  });
}

function startClock(turn) {
  stopClock();
  if (timeControl.time === 0) return; // no limit
  clockInterval = setInterval(() => {
    if (!gameActive) return stopClock();
    clocks[turn] = Math.max(0, clocks[turn] - 0.1);
    updateClockDisplay();
    if (clocks[turn] <= 0) {
      stopClock();
      socket.emit('flag', { color: turn });
    }
  }, 100);
}

function stopClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
}

function addIncrement(color) {
  if (timeControl.inc > 0 && timeControl.time > 0) {
    clocks[color] += timeControl.inc;
  }
}

// ── SOCKET SETUP ──
function initSocket() {
  socket = io();

  socket.on('opponent_joined', ({ name, timeControl: tc }) => {
    opponentName = name;
    if (tc) timeControl = tc;
    addLog(`${name} joined the game`, 'highlight');
    startGame();
  });

  socket.on('chess_move', ({ move, fen, pgn }) => {
    const before = new Chess(game.fen());
    game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    const after = new Chess(game.fen());
    const fullMove = game.history({ verbose: true }).slice(-1)[0];
    board.position(game.fen(), false);
    updateChessUI(game.pgn());
    addLog(`${opponentName}: ${move.san || move.from+move.to}`);
    addIncrement(move.color);
    startClock(game.turn());
    detectAndMarkEvents(fullMove || move, before, after);
  });

  socket.on('events_detected', ({ eventIds }) => {
    // Opponent detected events — mark matching cells on MY card
    let changed = false;
    eventIds.forEach(id => {
      if (triggeredIds.has(id)) return;
      triggeredIds.add(id);
      bingoBoard.forEach((ev, i) => {
        if (ev.id === id && !marked.has(i)) {
          marked.add(i);
          changed = true;
        }
      });
    });
    if (changed) {
      renderBingo();
      eventIds.forEach(id => {
        bingoBoard.forEach((ev, i) => {
          if (ev.id === id) {
            setTimeout(() => {
              const el = document.querySelectorAll('.bingo-cell')[i];
              if (el) {
                el.classList.remove('just-triggered');
                void el.offsetWidth;
                el.classList.add('just-triggered');
                setTimeout(() => el.classList.remove('just-triggered'), 600);
              }
            }, 50);
          }
        });
      });
      checkBingo();
    }
  });

  socket.on('game_over', ({ reason, winner, winnerId, lines, loserName }) => {
    endGame(reason, winner, winnerId, lines, loserName);
  });

  socket.on('opponent_disconnected', () => {
    addLog('Opponent disconnected', 'warn');
  });

  socket.on('clock_sync', ({ clocks: serverClocks }) => {
    clocks = serverClocks;
    updateClockDisplay();
  });

  socket.on('flag', ({ color, winner, winnerId, loserName }) => {
    stopClock();
    endGame('flag', winner, winnerId, null, loserName);
  });

  addRematchListeners();
}

// ── LOBBY ──
function setMsg(txt, cls='') {
  const el = document.getElementById('lobbyMsg');
  el.textContent = txt; el.className = 'lobby-msg '+cls;
}

async function createGame() {
  const name = document.getElementById('createName').value.trim();
  if (!name) return setMsg('Enter your name','error');
  myName = name; initSocket();
  socket.emit('create_room', { name, timeControl }, ({ roomId: rid, color }) => {
    roomId = rid; myColor = color;
    document.getElementById('lobbyCard').style.display = 'none';
    const wb = document.getElementById('waitingBox');
    wb.classList.add('show');
    document.getElementById('displayCode').textContent = rid;
    document.getElementById('headerCode').textContent = rid;

    // Build shareable link
    const shareUrl = `${window.location.origin}?join=${rid}`;
    document.getElementById('shareLinkBox').textContent = shareUrl;
    document.getElementById('shareLinkBox').classList.add('show');
    const subject = encodeURIComponent('Join my Chess Bingo game!');
    const body = encodeURIComponent(`I've created a Chess Bingo game — join me!\n\nClick this link to join: ${shareUrl}\n\nOr go to ${window.location.origin} and enter code: ${rid}`);
    document.getElementById('emailLink').href = `mailto:?subject=${subject}&body=${body}`;
  });
}

function joinGame() {
  const name = document.getElementById('joinName').value.trim();
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  if (!name) return setMsg('Enter your name','error');
  if (!code || code.length < 4) return setMsg('Enter a valid room code','error');
  myName = name; initSocket();
  socket.emit('join_room', { roomId: code, name }, (res) => {
    if (res.error) return setMsg(res.error,'error');
    roomId = code; myColor = res.color; opponentName = res.opponentName;
    if (res.timeControl) timeControl = res.timeControl;
    document.getElementById('headerCode').textContent = code;
    startGame();
  });
}

function copyLink() {
  const shareUrl = `${window.location.origin}?join=${roomId}`;
  navigator.clipboard.writeText(shareUrl).catch(() => {});
  const btns = document.querySelectorAll('.share-row .copy-btn');
  btns.forEach(b => { if (b.textContent === 'Copy link') { b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy link', 1500); } });
}

// Auto-fill join code if arriving via share link (?join=XXXXXX)
(function() {
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('join');
  if (joinCode) {
    document.getElementById('joinCode').value = joinCode.toUpperCase();
    document.getElementById('joinName').focus();
    document.getElementById('joinCode').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
})();

function copyCode() {
  navigator.clipboard.writeText(roomId).catch(()=>{});
  const btn = document.querySelector('.copy-btn');
  if (btn) { btn.textContent='Copied!'; setTimeout(()=>btn.textContent='Copy code',1500); }
}

// ── GAME START ──
function startGame() {
  gameActive = true;
  document.getElementById('lobbyScreen').classList.remove('active');
  document.getElementById('gameScreen').classList.add('active');

  const whiteName = myColor==='white' ? myName : opponentName;
  const blackName = myColor==='black' ? myName : opponentName;
  document.getElementById('badge-white-name').textContent = whiteName+(myColor==='white'?' (you)':'');
  document.getElementById('badge-black-name').textContent = blackName+(myColor==='black'?' (you)':'');
  document.getElementById('sidebar-white-name').textContent = whiteName+(myColor==='white'?' (you)':'');
  document.getElementById('sidebar-black-name').textContent = blackName+(myColor==='black'?' (you)':'');

  game = new Chess();
  // Initialise clocks
  clocks = { w: timeControl.time, b: timeControl.time };
  updateClockDisplay();
  buildBingoCard();

  // Defer board init so the DOM has painted and #chessboard has real dimensions
  requestAnimationFrame(() => {
    try {
      board = Chessboard('chessboard', {
        position: 'start',
        draggable: false,
        orientation: myColor,
        pieceTheme: 'https://lichess1.org/assets/piece/cburnett/{piece}.svg',
      });
    } catch(e) {
      console.error('Chessboard error:', e);
    }

    document.getElementById('chessboard').addEventListener('click', function(e) {
      const squareEl = e.target.closest('[data-square]');
      if (!squareEl) return;
      const square = squareEl.getAttribute('data-square');
      onSquareClick(square, game.get(square));
    });

    updateChessUI();
    addLog('Game started! Good luck.', 'highlight');
  });
}

// ── HIGHLIGHT HELPERS ──
const highlightedSquares = new Map();

function highlightSquare(square, type) {
  const el = document.querySelector(`[data-square="${square}"]`);
  if (!el) return;
  const isLight = el.classList.contains('white-1e1d7');
  if (type === 'selected') {
    el.style.background = isLight ? '#f6f669' : '#baca2b';
  } else if (type === 'move') {
    if (!el.querySelector('.move-dot')) {
      const dot = document.createElement('div');
      dot.className = 'move-dot';
      dot.style.cssText = 'position:absolute;border-radius:50%;width:28%;height:28%;background:rgba(0,0,0,0.2);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:10;';
      el.style.position = 'relative';
      el.appendChild(dot);
    }
  }
  highlightedSquares.set(square, el);
}

function clearHighlights() {
  document.querySelectorAll('.move-dot').forEach(d => d.remove());
  highlightedSquares.forEach(el => { el.style.background = ''; });
  highlightedSquares.clear();
}

// ── CHESS LOGIC ──
function onSquareClick(square, piece) {
  if (!gameActive) return;
  if (game.turn() !== myColor[0]) return;
  if (viewingMove !== -1) { goToMove(-1); return; }

  if (selectedSquare) {
    const before = new Chess(game.fen());
    const move = game.move({ from: selectedSquare, to: square, promotion: 'q' });
    clearHighlights(); selectedSquare = null;
    if (move !== null) {
      const after = new Chess(game.fen());
      board.position(game.fen());
      socket.emit('chess_move', { move, fen: game.fen(), pgn: game.pgn() });
      updateChessUI(game.pgn());
      addLog(`You: ${move.san}`);
      addIncrement(move.color);
      startClock(game.turn());
      detectAndMarkEvents(move, before, after);
      if (game.in_checkmate()) setTimeout(() => socket.emit('claim_checkmate'), 100);
      return;
    }
    if (!piece) return;
  }

  if (!piece) return;
  if (piece.color !== myColor[0]) return;
  if (selectedSquare === square) {
    clearHighlights();
    selectedSquare = null;
    return;
  }
  const moves = game.moves({ square, verbose: true });
  if (moves.length === 0) return;
  selectedSquare = square;
  highlightSquare(square, 'selected');
  moves.forEach(m => highlightSquare(m.to, 'move'));
}

// ── EVENT DETECTION ──
function detectAndMarkEvents(move, before, after) {
  const triggered = [];
  ALL_EVENTS.forEach(ev => {
    if (triggeredIds.has(ev.id)) return; // already fired
    try {
      if (ev.detect(move, before, after)) {
        triggeredIds.add(ev.id);
        triggered.push(ev.id);
      }
    } catch(e) {}
  });

  if (triggered.length === 0) return;

  // Mark matching cells on MY card
  let changed = false;
  triggered.forEach(id => {
    bingoBoard.forEach((ev, i) => {
      if (ev.id === id && !marked.has(i)) {
        marked.add(i);
        changed = true;
      }
    });
  });

  // Tell opponent about triggered events so they can mark their card too
  socket.emit('events_detected', { triggered: triggered.map(id => ({ eventId: id })) });

  if (changed) {
    renderBingo();
    triggered.forEach(id => {
      bingoBoard.forEach((ev, i) => {
        if (ev.id === id) {
          setTimeout(() => {
            const el = document.querySelectorAll('.bingo-cell')[i];
            if (el) {
              el.classList.remove('just-triggered');
              void el.offsetWidth;
              el.classList.add('just-triggered');
              setTimeout(() => el.classList.remove('just-triggered'), 600);
            }
          }, 50);
        }
      });
    });
    checkBingo();
  }
}

// ── CHESS UI ──
function updateChessUI(pgn) {
  const myTurn = game.turn() === myColor[0];
  const turnColor = game.turn() === 'w' ? 'White' : 'Black';
  document.getElementById('chessTurnLabel').textContent = myTurn ? 'Your turn' : `${turnColor} to move`;

  ['white','black'].forEach(c => {
    const isActive = game.turn() === c[0];
    document.getElementById(`badge-${c}`).classList.toggle('active-turn', isActive);
    const s = document.getElementById(`sidebar-${c}`);
    if (s) s.classList.toggle('active-turn', isActive);
  });

  if (!pgn) return;

  const hist = game.history({ verbose: true });
  const tmp = new Chess();
  moveHistory = hist.map(m => { tmp.move(m.san); return { san: m.san, fen: tmp.fen() }; });

  if (viewingMove === -1 || viewingMove >= moveHistory.length) viewingMove = -1;
  renderMoveList();
}

function renderMoveList() {
  const list = document.getElementById('moveList');
  if (!list) return;
  const activeIdx = viewingMove === -1 ? moveHistory.length - 1 : viewingMove;
  if (moveHistory.length === 0) { list.innerHTML = '<span class="mn" style="padding:0 6px">No moves yet</span>'; return; }
  let html = '';
  for (let i = 0; i < moveHistory.length; i += 2) {
    html += `<span class="mn">${Math.floor(i/2)+1}.</span>`;
    html += `<span class="mv${activeIdx===i?' active':''}" onclick="goToMove(${i})">${moveHistory[i].san}</span>`;
    if (moveHistory[i+1]) html += `<span class="mv${activeIdx===i+1?' active':''}" onclick="goToMove(${i+1})">${moveHistory[i+1].san}</span>`;
  }
  list.innerHTML = html;
  const activeEl = list.querySelector('.mv.active');
  if (activeEl) activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function goToMove(idx) {
  if (moveHistory.length === 0) return;
  if (idx < 0) idx = -1;
  else if (idx >= moveHistory.length) idx = -1;
  viewingMove = idx;
  const fen = idx === -1 ? moveHistory[moveHistory.length-1].fen : moveHistory[idx].fen;
  board.position(fen, false);
  renderMoveList();
}

// ── BINGO ──
function shuffle(arr) {
  const a = [...arr];
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

function buildBingoCard() {
  // Shuffle events and pick 24, insert FREE in the middle
  const picked = shuffle(ALL_EVENTS).slice(0, 24);
  picked.splice(12, 0, { id: 'free', icon: '♚', label: 'FREE\nSPACE', desc: '', free: true });
  bingoBoard = picked;
  marked = new Set([12]);
  triggeredIds = new Set();
  socket.emit('register_board', { eventIds: bingoBoard.map(e => e.id) });
  renderBingo();
}

function renderBingo() {
  const grid = document.getElementById('bingoGrid');
  grid.innerHTML = bingoBoard.map((ev, i) => {
    const isMarked = marked.has(i);
    const isFree = ev.free;
    const lines = ev.label.split('\n');
    return `<div class="bingo-cell${isFree?' free-cell':''}${isMarked?' marked':''}"
      ${isFree?'':` onclick="toggleCell(${i})"`} title="${ev.desc||''}">
      <span class="bingo-check">✕</span>
      <span class="bingo-cell-icon">${ev.icon}</span>
      <span class="bingo-cell-text">${lines.map(l=>`<span style="display:block">${l}</span>`).join('')}</span>
    </div>`;
  }).join('');
  const count = marked.size - 1;
  document.getElementById('bingoStatus').textContent = `${count} square${count!==1?'s':''} marked`;
}

function toggleCell(i) {
  // Manual toggle is disabled — all cells are auto-detected
  // (kept in case of future manual events)
}

function checkBingo() {
  const lines = [];
  for(let r=0;r<5;r++) lines.push([0,1,2,3,4].map(c=>r*5+c));
  for(let c=0;c<5;c++) lines.push([0,1,2,3,4].map(r=>r*5+c));
  lines.push([0,6,12,18,24]); lines.push([4,8,12,16,20]);
  const winning = lines.filter(l=>l.every(i=>marked.has(i)));
  const winCells = new Set(winning.flat());
  document.querySelectorAll('.bingo-cell').forEach((c,i)=>{ c.classList.toggle('bingo-line', winCells.has(i)&&marked.has(i)); });
  if (winning.length > 0) socket.emit('claim_bingo', { lines: winning });
}

// ── GAME OVER ──
function endGame(reason, winner, winnerId, lines, loserName) {
  gameActive = false;
  stopClock();
  cancelResign();
  const iWon = winnerId === socket.id;
  const icons = { bingo:'🎯', checkmate:'♛', resign:'🏳️', flag:'⏱️' };
  const msgs = {
    checkmate: iWon ? 'Checkmate! Your opponent\'s king has nowhere to go.' : `${winner} delivered checkmate.`,
    bingo:     iWon ? 'BINGO! You completed a line!' : `${winner} completed a bingo line!`,
    resign:    iWon ? `${loserName} resigned. Well played.` : 'You resigned.',
    flag:      iWon ? `${loserName} ran out of time!` : 'You ran out of time.',
  };
  document.getElementById('gameOverIcon').textContent = icons[reason]||'♟';
  document.getElementById('gameOverTitle').textContent = iWon ? 'You Win!' : `${winner} Wins`;
  document.getElementById('gameOverMsg').textContent = msgs[reason]||'';
  document.getElementById('rematchStatus').textContent = '';
  document.getElementById('rematchBtn').disabled = false;
  document.getElementById('rematchBtn').textContent = '⟳ Rematch';
  document.getElementById('rematchBtn').style.display = '';
  const actionBtns = document.getElementById('rematchActionBtns');
  if (actionBtns) actionBtns.style.display = 'none';

  // Build PGN with player names
  const whiteName = myColor === 'white' ? myName : opponentName;
  const blackName = myColor === 'black' ? myName : opponentName;
  const rawPgn = game ? game.pgn() : '';
  const taggedPgn = `[White "${whiteName}"]\n[Black "${blackName}"]\n\n${rawPgn}`;
  const lichessUrl = rawPgn
    ? `https://lichess.org/paste?pgn=${encodeURIComponent(taggedPgn)}`
    : 'https://lichess.org/analysis';
  document.getElementById('lichessBtn').href = lichessUrl;

  document.getElementById('gameOverOverlay').classList.add('show');
}

function requestRematch() {
  document.getElementById('rematchBtn').disabled = true;
  document.getElementById('rematchBtn').textContent = 'Waiting…';
  document.getElementById('rematchStatus').textContent = 'Rematch request sent — waiting for opponent';
  socket.emit('rematch_request');
}

function acceptRematch() {
  document.getElementById('rematchActionBtns').style.display = 'none';
  document.getElementById('rematchStatus').textContent = 'Accepted — starting rematch…';
  socket.emit('rematch_request');
}

function declineRematch() {
  document.getElementById('rematchActionBtns').style.display = 'none';
  document.getElementById('rematchStatus').textContent = 'Rematch declined.';
  socket.emit('rematch_declined');
}

// Add rematch socket listeners inside initSocket
function addRematchListeners() {
  socket.on('rematch_requested', ({ name }) => {
    document.getElementById('rematchStatus').textContent = `${name} wants a rematch!`;
    document.getElementById('rematchBtn').style.display = 'none';
    const btns = document.getElementById('rematchActionBtns');
    if (btns) btns.style.display = 'flex';
  });

  socket.on('rematch_declined', () => {
    document.getElementById('rematchBtn').disabled = false;
    document.getElementById('rematchBtn').textContent = '⟳ Rematch';
    document.getElementById('rematchStatus').textContent = 'Opponent declined the rematch.';
  });

  socket.on('rematch_start', ({ players }) => {
    // Find our new color
    const me = players.find(p => p.id === socket.id);
    if (!me) return;
    myColor = me.color;
    const opp = players.find(p => p.id !== socket.id);
    if (opp) opponentName = opp.name;

    // Reset game state
    document.getElementById('gameOverOverlay').classList.remove('show');
    document.getElementById('rematchBtn').style.display = '';
    document.getElementById('rematchBtn').disabled = false;
    document.getElementById('rematchBtn').textContent = '⟳ Rematch';
    const actionBtns = document.getElementById('rematchActionBtns');
    if (actionBtns) actionBtns.style.display = 'none';
    stopClock();
    clocks = { w: timeControl.time, b: timeControl.time };
    game = new Chess();
    moveHistory = [];
    viewingMove = -1;
    selectedSquare = null;
    clearHighlights();
    buildBingoCard();

    // Rebuild board with swapped orientation
    const boardEl = document.getElementById('chessboard');
    boardEl.innerHTML = '';
    board = Chessboard('chessboard', {
      position: 'start',
      draggable: false,
      orientation: myColor,
      pieceTheme: 'https://lichess1.org/assets/piece/cburnett/{piece}.svg',
    });

    // Update player names
    const whiteName = myColor === 'white' ? myName : opponentName;
    const blackName = myColor === 'black' ? myName : opponentName;
    document.getElementById('badge-white-name').textContent = whiteName + (myColor === 'white' ? ' (you)' : '');
    document.getElementById('badge-black-name').textContent = blackName + (myColor === 'black' ? ' (you)' : '');
    document.getElementById('sidebar-white-name').textContent = whiteName + (myColor === 'white' ? ' (you)' : '');
    document.getElementById('sidebar-black-name').textContent = blackName + (myColor === 'black' ? ' (you)' : '');

    updateChessUI();
    gameActive = true;
    addLog('Rematch started! Colors swapped.', 'highlight');
  });
}

let resignPending = false;
let resignTimeout = null;

function resignClick() {
  if (!gameActive) return;
  if (!resignPending) {
    // First click — show confirmation state
    resignPending = true;
    const btn = document.getElementById('resignBtn');
    btn.textContent = 'Confirm?';
    btn.classList.add('resign-confirm');
    // Auto-cancel after 3 seconds
    resignTimeout = setTimeout(cancelResign, 3000);
  } else {
    // Second click — confirm
    clearTimeout(resignTimeout);
    resignPending = false;
    stopClock();
    socket.emit('resign');
  }
}

function cancelResign() {
  resignPending = false;
  clearTimeout(resignTimeout);
  const btn = document.getElementById('resignBtn');
  if (btn) { btn.textContent = 'Resign'; btn.classList.remove('resign-confirm'); }
}

function resign() {
  // kept for compatibility — just triggers the click flow
  resignClick();
}

// ── LOG ──
function addLog(msg, cls='') {
  const el = document.getElementById('logEntries');
  if (!el) return;
  const now = new Date();
  const ts = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
  const div = document.createElement('div');
  div.className = 'log-entry'+(cls?' '+cls:'');
  div.innerHTML = `<span class="ts">${ts}</span>${msg}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

document.getElementById('joinCode').addEventListener('input', function() { this.value=this.value.toUpperCase(); });

// Populate tile guide on home page
(function() {
  const el = document.getElementById('tileGuide');
  if (!el) return;
  const freeSpace = `
    <div class="tile-item tile-item-free">
      <span class="tile-icon">♚</span>
      <div class="tile-info">
        <div class="tile-name">Free Space</div>
        <div class="tile-desc">The centre square is always pre-marked at the start of every game.</div>
      </div>
    </div>`;
  const tiles = ALL_EVENTS.map(ev => `
    <div class="tile-item">
      <span class="tile-icon">${ev.icon}</span>
      <div class="tile-info">
        <div class="tile-name">${ev.label.replace('\n',' ')}</div>
        <div class="tile-desc">${ev.desc}</div>
      </div>
    </div>`);
  // Insert free space at position 12 (middle of 5x5)
  tiles.splice(12, 0, freeSpace);
  el.innerHTML = tiles.join('');
})();