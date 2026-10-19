# Midnight Dodgeball

Chaotic free-for-all dodgeball for up to 5 friends in the browser. Bowling balls, beach balls,
watermelons, boomerangs, a runaway chicken, ghosts, and a janitor who mops through mid-match.

The match runs on a small Node server, so it keeps going even if someone switches tabs, and it
works on any network.

## Put it on Render (about 5 minutes)

1. **Put the files on GitHub.**
   Create a new repository on github.com (it can be private). Click "uploading an existing file"
   and drag in everything from this folder: `server.js`, `sim.js`, `package.json`, `render.yaml`,
   `README.md`, `.gitignore` and the `public` folder. Commit.

2. **Create the service on Render.**
   Sign in at render.com with your GitHub account. Click **New → Blueprint**, pick the repository,
   and click **Apply**. Render reads `render.yaml` and sets everything up on the free plan.

   If you'd rather set it up by hand: **New → Web Service**, pick the repository, then use
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free

3. **Play.** When the deploy finishes you get a link like `https://midnight-dodgeball.onrender.com`.
   Open it, click **Copy invite link**, and send it to your friends.

## Good to know

- Free Render services go to sleep after 15 minutes with nobody playing. The first person to open
  the link after that waits about a minute while it wakes up ("Waking up the server…").
- Each room code is its own game. Up to 5 people play per round; anyone extra watches and joins
  the next round.
- "Fill empty spots with bots" tops every round up to 5 players.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| Click or J | Throw |
| Space | Dash (you can't be hit mid-dash) |

## Run it on your own computer

You need Node 18 or newer.

```
npm install
npm start
```

Then open http://localhost:3000. Friends on the same Wi-Fi can join at `http://<your-computer's-ip>:3000`.

## Files

- `server.js` serves the page and runs one match per room over WebSockets.
- `sim.js` is the game itself: balls, hits, bots, the janitor, lights out.
- `public/index.html` is everything the players see.
