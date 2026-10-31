# Scrum Poker, Planning Poker

A free, scrum poker (planning poker) tool for product owners and agile teams.

## 👉 Play it at [AmanTalwar.com](https://amantalwar.com)

No sign-up. Create a game, share the invite link, and estimate together.

## Features

- Create games with a custom estimate scale (default `?,0,1,2,3,5,8,13,20,40,100`)
- Optional per-item timer (60, 90 or 120 seconds) that reveals votes at zero
- Items with a title, Markdown details and related images
- Favorites and recently estimated items
- Auto-triangulation: after a reveal, similar-sized estimated items are suggested for comparison
- Hidden votes until the host reveals them, with average, median, range and a vote chart
- Real-time play between players, peer-to-peer, with no account or database
- Games are saved in your own browser (local storage)

## How it works

The host's browser acts as the game server using [PeerJS](https://peerjs.com) (WebRTC). Players join with a link such as `…/#join=ABC123`.
**Players currently need to be on the same Wi-Fi or network as the host.** Connecting across different networks is unreliable because there is no dedicated relay server. A hosted real-time database (for example Firebase) would remove this limit.
The host must keep their tab open while the game is running. Votes are only sent to other players after the host reveals them.

## Self-hosting

It is plain static files (`index.html`, `style.css`, `app.js`). Upload the folder to any web host and open `index.html`.
Players connect through PeerJS's free public signalling server, so it needs internet access and HTTPS hosting is recommended.

## Licence

[MIT](LICENSE) © Aman Talwar
