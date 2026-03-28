# Chess Bingo 🎯♟️

Two-player Chess Bingo — win by **checkmate** or **completing a bingo line** first.

## How to play

1. Player 1 creates a room and shares the 6-character room code
2. Player 2 enters the code to join
3. Play chess on the embedded board — each player also has their own bingo card
4. **Mark bingo squares manually** as events happen (e.g. en passant, a knight fork, queenside castle)
5. First player to get checkmate **or** complete a bingo row/column/diagonal wins

---

## Running locally

```bash
npm install
npm start
# open http://localhost:3000
```

For development with auto-restart:
```bash
npm run dev   # requires: npm install -g nodemon
```

---

## Deploying to Render (free tier)

1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo
4. Set these options:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Environment:** Node
5. Deploy — Render gives you a public URL instantly

### Other free options
- **Railway:** `railway up` after installing the CLI
- **Fly.io:** `fly launch` then `fly deploy`
- **Glitch:** Import from GitHub at glitch.com

---

## Project structure

```
chess-bingo/
├── server.js        # Express + Socket.io backend
├── package.json
├── public/
│   └── index.html   # Full frontend (chess + bingo UI)
└── README.md
```

## Tech stack

- **Backend:** Node.js, Express, Socket.io
- **Chess engine:** chess.js (move validation, checkmate detection)
- **Chess UI:** chessboard.js
- **Fonts:** Playfair Display, DM Mono (Google Fonts)
- **No build step** — pure HTML/CSS/JS frontend

---

## Customising bingo events

Edit the `ALL_EVENTS` array in `public/index.html` to change what events appear on bingo cards. Each event has:
```js
{ icon: "♞", label: "Knight\nfork", desc: "Knight attacks two pieces at once" }
```
